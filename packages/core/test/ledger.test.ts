import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimReminders, confirmPayment, createDb, createPayment, createPlan, expireDue, getWallet, hasActiveAccess,
  markWithdrawalPaid, migrate, registerChannel, rejectWithdrawal, requestWithdrawal, upsertOwner, upsertSubscriber,
  type Sql,
} from "../src/index.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const cfg = { commissionBps: 1000, holdHours: 0 };

d("virtual cashbox", () => {
  let sql: Sql;
  beforeAll(async () => {
    sql = createDb(url!);
    await sql`DROP SCHEMA public CASCADE`;
    await sql`CREATE SCHEMA public`;
    await migrate(sql);
  });
  afterAll(async () => sql.end());
  beforeEach(async () => {
    await sql`TRUNCATE ledger_entries, withdrawals, payments, subscriptions, plans, channels, subscribers, owners RESTART IDENTITY CASCADE`;
  });

  async function setup() {
    const owner = await upsertOwner(sql, { id: 111, first_name: "Jasur" });
    const channel = await registerChannel(sql, owner.id, { id: -1001, title: "Fitness Akademiya" });
    const plan = await createPlan(sql, owner.id, channel.id, { title: "1 oy", duration_days: 30, price: 4_900_000 });
    const sub = await upsertSubscriber(sql, { id: 222, first_name: "Aziz" });
    return { owner, channel, plan, sub };
  }

  async function pay(subscriberId: number, planId: number, c = cfg) {
    const { payment } = await createPayment(sql, { subscriberId, planId, provider: "mock", autoRenew: false });
    return confirmPayment(sql, payment.id, c);
  }

  it("credits payment minus commission and grants access", async () => {
    const { owner, channel, plan, sub } = await setup();
    expect(channel.slug).toBe("fitness-akademiya");
    const r = await pay(sub.id, plan.id);
    expect(r.alreadyPaid).toBe(false);
    expect(r.wasActive).toBe(false);
    const w = await getWallet(sql, owner.id);
    expect(w.available).toBe(4_410_000); // 49 000 - 10%
    expect(w.commissionThisMonth).toBe(490_000);
    expect(await hasActiveAccess(sql, 222, -1001)).toBe(true);
  });

  it("is idempotent when the same payment is confirmed twice", async () => {
    const { owner, plan, sub } = await setup();
    const { payment } = await createPayment(sql, { subscriberId: sub.id, planId: plan.id, provider: "mock", autoRenew: false });
    const [a, b] = await Promise.all([confirmPayment(sql, payment.id, cfg), confirmPayment(sql, payment.id, cfg)]);
    expect([a.alreadyPaid, b.alreadyPaid].sort()).toEqual([false, true]);
    expect((await getWallet(sql, owner.id)).available).toBe(4_410_000);
  });

  it("keeps new money on hold until the hold window passes", async () => {
    const { owner, plan, sub } = await setup();
    await pay(sub.id, plan.id, { commissionBps: 1000, holdHours: 24 });
    const w = await getWallet(sql, owner.id);
    expect(w.available).toBe(0);
    expect(w.pending).toBe(4_410_000);
  });

  it("extends an active subscription from its current end date", async () => {
    const { plan, sub } = await setup();
    const first = await pay(sub.id, plan.id);
    const second = await pay(sub.id, plan.id);
    expect(second.wasActive).toBe(true);
    const diffDays = (second.subscription.expires_at.getTime() - first.subscription.expires_at.getTime()) / 86400_000;
    expect(Math.round(diffDays)).toBe(30);
  });

  it("never lets parallel withdrawals overdraw the cashbox", async () => {
    const { owner, plan, sub } = await setup();
    await pay(sub.id, plan.id);
    const results = await Promise.allSettled([
      requestWithdrawal(sql, owner.id, 3_000_000, "9860 1234 5678 4417"),
      requestWithdrawal(sql, owner.id, 3_000_000, "9860 1234 5678 4417"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await getWallet(sql, owner.id)).available).toBe(1_410_000);
  });

  it("returns money to the cashbox when a withdrawal is rejected", async () => {
    const { owner, plan, sub } = await setup();
    await pay(sub.id, plan.id);
    const w1 = await requestWithdrawal(sql, owner.id, 2_000_000, "8600123456784417");
    const w2 = await requestWithdrawal(sql, owner.id, 1_000_000, "8600123456784417");
    await markWithdrawalPaid(sql, w1.id);
    await rejectWithdrawal(sql, w2.id, "karta bloklangan");
    expect((await getWallet(sql, owner.id)).available).toBe(2_410_000);
    await expect(markWithdrawalPaid(sql, w2.id)).rejects.toThrow();
  });

  it("rejects bad cards and tiny amounts", async () => {
    const { owner, plan, sub } = await setup();
    await pay(sub.id, plan.id);
    await expect(requestWithdrawal(sql, owner.id, 2_000_000, "1234")).rejects.toThrow(/Karta/);
    await expect(requestWithdrawal(sql, owner.id, 500, "9860123456784417")).rejects.toThrow(/10 000/);
  });

  it("reminds once and expires overdue subscriptions", async () => {
    const { plan, sub } = await setup();
    const r = await pay(sub.id, plan.id);
    await sql`UPDATE subscriptions SET expires_at = now() + interval '2 days' WHERE id = ${r.subscription.id}`;
    expect(await claimReminders(sql, 3)).toHaveLength(1);
    expect(await claimReminders(sql, 3)).toHaveLength(0);
    await sql`UPDATE subscriptions SET expires_at = now() + interval '5 hours' WHERE id = ${r.subscription.id}`;
    expect(await claimReminders(sql, 3)).toHaveLength(0);
    expect(await claimReminders(sql, 1)).toHaveLength(1);
    expect(await claimReminders(sql, 1)).toHaveLength(0);
    await sql`UPDATE subscriptions SET expires_at = now() - interval '1 minute' WHERE id = ${r.subscription.id}`;
    const expired = await expireDue(sql);
    expect(expired.map((e) => e.subscriber_tg_id)).toEqual([222]);
    expect(await hasActiveAccess(sql, 222, -1001)).toBe(false);
  });
});
