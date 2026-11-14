import { Body, Controller, Get, Inject, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import {
  createPlan, getOwnedChannel, getOwnerStats, getWallet, listLedger, listOwnerChannels, listOwnerSubscribers,
  listPlans, listWithdrawals, requestWithdrawal, updateChannel, updatePlan, type Owner, type OwnerSubFilter, type Sql,
} from "@obuna/core";
import { CurrentOwner, OwnerGuard, TelegramAuthGuard } from "../common/auth.js";
import { CONFIG, SQL } from "../tokens.js";
import type { AppConfig } from "../config.js";

const PlanBody = z.object({
  title: z.string().min(1).max(40),
  durationDays: z.number().int().min(1).max(3660),
  price: z.number().int().positive(), // tiyin
});
const PlanPatch = z.object({
  title: z.string().min(1).max(40).optional(),
  price: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});
const ChannelPatch = z.object({ description: z.string().max(500).optional(), slug: z.string().optional() });
const WithdrawBody = z.object({ amount: z.number().int().positive(), cardNumber: z.string() });

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
        link: `https://t.me/${this.cfg.botUsername}?startapp=${c.slug}`,
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

  @Patch("channels/:id")
  patchChannel(@CurrentOwner() owner: Owner, @Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    return updateChannel(this.sql, owner.id, id, ChannelPatch.parse(body));
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
      withdrawals: withdrawals.map((w) => ({ ...w, card_number: `•••• ${w.card_number.slice(-4)}` })),
    };
  }

  @Post("withdrawals")
  async withdraw(@CurrentOwner() owner: Owner, @Body() body: unknown) {
    const b = WithdrawBody.parse(body);
    const w = await requestWithdrawal(this.sql, owner.id, b.amount, b.cardNumber);
    return { ...w, card_number: `•••• ${w.card_number.slice(-4)}` };
  }
}
