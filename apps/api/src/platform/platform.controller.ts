import { Body, Controller, Get, Inject, Logger, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import type { Api } from "grammy";
import { z } from "zod";
import {
  decideKyc, decryptCard, formatSom, listKycQueue, listModeration, listPendingWithdrawals, markWithdrawalPaid, rejectWithdrawal, setModeration,
  type Sql, type Withdrawal,
} from "@obuna/core";

const ModerationBody = z.discriminatedUnion("status", [
  z.object({ status: z.literal("active") }),
  z.object({ status: z.literal("blocked"), reason: z.string().trim().min(3).max(300) }),
]);
const KycDecision = z.discriminatedUnion("status", [
  z.object({ status: z.literal("verified") }),
  z.object({ status: z.literal("rejected"), note: z.string().trim().min(3).max(300) }),
]);
import { CONFIG } from "../tokens.js";
import type { AppConfig } from "../config.js";
import { PlatformAdminGuard, TelegramAuthGuard } from "../common/auth.js";
import { SQL, TG_API } from "../tokens.js";

/**
 * Platform operator: pays out withdrawals by hand until ATMOS card payouts are enabled.
 * "Paid" means the money was sent to the card; "reject" returns it to the owner's cashbox.
 */
@Controller("api/platform")
@UseGuards(TelegramAuthGuard, PlatformAdminGuard)
export class PlatformController {
  private readonly log = new Logger("Platform");

  constructor(
    @Inject(SQL) private readonly sql: Sql,
    @Inject(TG_API) private readonly tg: Api,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** The full card number is decrypted only here, for the operator who sends the payout. */
  @Get("withdrawals")
  async pending() {
    const rows = await listPendingWithdrawals(this.sql);
    return rows.map(({ card_enc, ...w }) => ({
      ...w,
      card_number: card_enc ? decryptCard(card_enc, this.cfg.cardKey) : `•••• ${w.card_number}`,
    }));
  }

  private strip = ({ card_enc: _, ...w }: Withdrawal) => w;

  @Post("withdrawals/:id/paid")
  async paid(@Param("id", ParseIntPipe) id: number) {
    const w = await markWithdrawalPaid(this.sql, id);
    await this.tell(w.owner_id, `✅ ${formatSom(w.amount)} •••• ${w.card_number.slice(-4)} kartangizga o'tkazildi.`);
    return this.strip(w);
  }

  @Post("withdrawals/:id/reject")
  async reject(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    const { note } = z.object({ note: z.string().min(1).max(200) }).parse(body);
    const w = await rejectWithdrawal(this.sql, id, note);
    await this.tell(w.owner_id, `⚠️ ${formatSom(w.amount)} yechib bo'lmadi: ${note}. Pul kassangizga qaytarildi.`);
    return this.strip(w);
  }

  /**
   * Identity checks (instead of MyID). The PINFL is decrypted only here, so the operator can compare
   * it and the full name with the passport photo the creator sends to support.
   */
  @Get("kyc")
  async kycQueue() {
    const rows = await listKycQueue(this.sql);
    return rows.map((o) => ({
      ownerId: o.id, name: o.name, username: o.username, tgId: o.tg_id, phone: o.phone, legalStatus: o.legal_status,
      fullName: o.kyc_full_name, submittedAt: o.kyc_submitted_at,
      pinfl: o.kyc_pinfl_enc ? decryptCard(o.kyc_pinfl_enc, this.cfg.cardKey) : null,
    }));
  }

  @Post("owners/:id/kyc")
  async decideKyc(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    const b = KycDecision.parse(body);
    const o = await decideKyc(this.sql, id, b.status, b.status === "rejected" ? b.note : null);
    await this.tell(o.id, b.status === "verified"
      ? "✅ Shaxsingiz tasdiqlandi. Endi oylik chegarasiz pul yechishingiz mumkin."
      : `⚠️ Shaxsingizni tasdiqlab bo'lmadi: ${b.note}. Ma'lumotlarni to'g'rilab, qayta yuboring.`);
    return { ownerId: o.id, kycStatus: o.kyc_status };
  }

  /** Channels in review, blocked, or with open reports. */
  @Get("moderation")
  moderation() {
    return listModeration(this.sql);
  }

  @Post("channels/:id/moderation")
  async moderate(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    const b = ModerationBody.parse(body);
    const c = await setModeration(this.sql, id, b.status, b.status === "blocked" ? b.reason : null);
    await this.tell(c.owner_id, b.status === "blocked"
      ? `⛔ «${c.title}» platforma qoidalarini buzgani uchun bloklandi: ${b.reason}\n` +
        `Obuna sotish va pul yechish to'xtatildi. E'tirozingiz bo'lsa, shu botga oddiy xabar yozing, qo'llab-quvvatlashga boradi.`
      : `✅ «${c.title}» tekshiruvdan o'tdi. Obuna va pul yechish odatdagidek ishlaydi.`);
    return c;
  }

  private async tell(ownerId: number, text: string) {
    const [o] = await this.sql<{ tg_id: number }[]>`SELECT tg_id FROM owners WHERE id = ${ownerId}`;
    if (o) await this.tg.sendMessage(o.tg_id, text).catch((e) => this.log.warn(String(e)));
  }
}
