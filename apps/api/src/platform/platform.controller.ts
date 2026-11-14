import { Body, Controller, Get, Inject, Logger, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import type { Api } from "grammy";
import { z } from "zod";
import { decryptCard, formatSom, listPendingWithdrawals, markWithdrawalPaid, rejectWithdrawal, type Sql, type Withdrawal } from "@obuna/core";
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

  private async tell(ownerId: number, text: string) {
    const [o] = await this.sql<{ tg_id: number }[]>`SELECT tg_id FROM owners WHERE id = ${ownerId}`;
    if (o) await this.tg.sendMessage(o.tg_id, text).catch((e) => this.log.warn(String(e)));
  }
}
