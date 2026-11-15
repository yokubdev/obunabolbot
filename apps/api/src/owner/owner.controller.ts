import { Body, Controller, Get, Inject, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import {
  createPlan, createPromo, getOwnedChannel, listPromos, setPromoActive, getOwnerStats, getWallet, listLedger, listOwnerChannels, listOwnerSubscribers,
  listPlans, listWithdrawals, requestWithdrawal, updateChannel, updatePlan, type Owner, type OwnerSubFilter, type Sql,
  type Withdrawal,
} from "@obuna/core";
import { CurrentOwner, OwnerGuard, TelegramAuthGuard } from "../common/auth.js";
import { CONFIG, SQL } from "../tokens.js";
import type { AppConfig } from "../config.js";

const PlanBody = z.object({
  title: z.string().trim().min(1).max(40),
  durationDays: z.number().int().min(1).max(3660),
  price: z.number().int().positive().max(10_000_000_000), // tiyin
});
const PlanPatch = z.object({
  title: z.string().trim().min(1).max(40).optional(),
  price: z.number().int().positive().max(10_000_000_000).optional(),
  isActive: z.boolean().optional(),
});
const ChannelPatch = z.object({
  description: z.string().max(500).optional(),
  slug: z.string().optional(),
  perks: z.array(z.string().max(80)).max(6).optional(),
  welcomeText: z.string().max(1000).optional(),
  trialDays: z.number().int().min(0).max(30).optional(),
});
const WithdrawBody = z.object({ amount: z.number().int().positive(), cardNumber: z.string().max(32) });
const ChannelPatchStrict = ChannelPatch.strict();
const PromoBody = z.object({
  code: z.string().trim().min(3).max(20),
  kind: z.enum(["percent", "amount"]),
  value: z.number().int().positive().max(10_000_000_000),
  planId: z.number().int().positive().nullable().optional(),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict();
const PromoPatch = z.object({ isActive: z.boolean() }).strict();

/** What an owner may see of a payout: never the encrypted card blob. */
const publicWithdrawal = (w: Withdrawal) => ({
  id: w.id, amount: w.amount, status: w.status, note: w.note, created_at: w.created_at, processed_at: w.processed_at,
  card_number: `•••• ${w.card_number.slice(-4)}`,
});

/** The channel owner's panel: channels, plans, subscribers, revenue and the virtual cashbox. */
@Controller("api/owner")
@UseGuards(TelegramAuthGuard, OwnerGuard)
export class OwnerController {
  constructor(@Inject(SQL) private readonly sql: Sql, @Inject(CONFIG) private readonly cfg: AppConfig) {}

  @Get("overview")
  async overview(@CurrentOwner() owner: Owner) {
    const [channels, stats, wallet] = await Promise.all([
      listOwnerChannels(this.sql, owner.id),
      getOwnerStats(this.sql, owner.id),
      getWallet(this.sql, owner.id),
    ]);
    return {
      owner: { name: owner.name, username: owner.username },
      channels: channels.map((c) => ({
        ...c,
        link: `https://t.me/${this.cfg.botUsername}?start=${c.slug}`,
      })),
      stats,
      wallet,
      commissionBps: this.cfg.commissionBps,
    };
  }

  @Get("subscribers")
  subscribers(@CurrentOwner() owner: Owner, @Query("filter") filter = "all", @Query("q") q = "") {
    const f = (["all", "active", "expiring", "expired"].includes(filter) ? filter : "all") as OwnerSubFilter;
    return listOwnerSubscribers(this.sql, owner.id, f, q.slice(0, 64));
  }

  @Get("channels/:id/plans")
  async plans(@CurrentOwner() owner: Owner, @Param("id", ParseIntPipe) id: number) {
    await getOwnedChannel(this.sql, owner.id, id);
    return listPlans(this.sql, id, false);
  }

  @Post("channels/:id/plans")
  addPlan(@CurrentOwner() owner: Owner, @Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    const b = PlanBody.parse(body);
    return createPlan(this.sql, owner.id, id, { title: b.title, duration_days: b.durationDays, price: b.price });
  }

  @Patch("plans/:id")
  patchPlan(@CurrentOwner() owner: Owner, @Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    const b = PlanPatch.parse(body);
    return updatePlan(this.sql, owner.id, id, { title: b.title, price: b.price, is_active: b.isActive });
  }

  @Get("channels/:id/promos")
  promos(@CurrentOwner() owner: Owner, @Param("id", ParseIntPipe) id: number) {
    return listPromos(this.sql, owner.id, id);
  }

  @Post("channels/:id/promos")
  addPromo(@CurrentOwner() owner: Owner, @Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    const b = PromoBody.parse(body);
    return createPromo(this.sql, owner.id, id, {
      code: b.code, kind: b.kind, value: b.value, planId: b.planId ?? null, maxUses: b.maxUses ?? null,
      expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
    });
  }

  @Patch("promos/:id")
  patchPromo(@CurrentOwner() owner: Owner, @Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    return setPromoActive(this.sql, owner.id, id, PromoPatch.parse(body).isActive);
  }

  @Patch("channels/:id")
  patchChannel(@CurrentOwner() owner: Owner, @Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    return updateChannel(this.sql, owner.id, id, ChannelPatchStrict.parse(body));
  }

  @Get("wallet")
  async wallet(@CurrentOwner() owner: Owner) {
    const [summary, ledger, withdrawals] = await Promise.all([
      getWallet(this.sql, owner.id),
      listLedger(this.sql, owner.id),
      listWithdrawals(this.sql, owner.id),
    ]);
    return {
      ...summary,
      ledger,
      withdrawals: withdrawals.map(publicWithdrawal),
    };
  }

  @Post("withdrawals")
  async withdraw(@CurrentOwner() owner: Owner, @Body() body: unknown) {
    const b = WithdrawBody.parse(body);
    return publicWithdrawal(await requestWithdrawal(this.sql, owner.id, b.amount, b.cardNumber, this.cfg.cardKey));
  }
}
