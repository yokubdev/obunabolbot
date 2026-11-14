import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import {
  confirmPayment, createDb, createPayment, createPlan, getWallet, migrate, registerChannel, upsertOwner, upsertSubscriber,
  type Sql,
} from "@obuna/core";
import { MockProvider } from "@obuna/atmos";
import { runJobs } from "../src/jobs.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const ledger = { commissionBps: 1000, holdHours: 0 };

d("scheduler", () => {
  let sql: Sql;
  const api = {
    sendMessage: vi.fn(async () => ({})),
    banChatMember: vi.fn(async () => true),
    unbanChatMember: vi.fn(async () => true),
  };
  beforeAll(async () => {
    sql = createDb(url!);
    await sql`DROP SCHEMA public CASCADE`;
    await sql`CREATE SCHEMA public`;
    await migrate(sql);
  });
  afterAll(async () => sql.end());

  it("renews saved cards, reminds, and removes unpaid members", async () => {
    const owner = await upsertOwner(sql, { id: 1, first_name: "Owner" });
    const ch = await registerChannel(sql, owner.id, { id: -100, title: "Kanal" });
    const plan = await createPlan(sql, owner.id, ch.id, { title: "1 oy", duration_days: 30, price: 1_000_000 });
    const renewing = await upsertSubscriber(sql, { id: 10, first_name: "Auto" });
    const lapsing = await upsertSubscriber(sql, { id: 20, first_name: "Manual" });
    for (const [s, auto] of [[renewing, true], [lapsing, false]] as const) {
      const { payment } = await createPayment(sql, { subscriberId: s.id, planId: plan.id, provider: "mock", autoRenew: auto });
      await confirmPayment(sql, payment.id, ledger, { cardToken: auto ? "tok" : null });
    }
    // Both end in 12 hours; payments were "made" 2 days ago.
    await sql`UPDATE subscriptions SET expires_at = now() + interval '12 hours'`;
    await sql`UPDATE payments SET created_at = now() - interval '2 days'`;

    const first = await runJobs({ sql, api: api as unknown as Api, provider: new MockProvider(), ledger, webAppUrl: "https://app" });
    expect(first).toMatchObject({ renewed: 1, renewFailed: 0, reminded: 1, expired: 0 });
    expect((await getWallet(sql, owner.id)).available).toBe(2_700_000); // 3 payments × 9 000 so'm

    await sql`UPDATE subscriptions SET expires_at = now() - interval '1 minute' WHERE subscriber_id = ${lapsing.id}`;
    const second = await runJobs({ sql, api: api as unknown as Api, provider: new MockProvider(), ledger, webAppUrl: "https://app" });
    expect(second).toMatchObject({ renewed: 0, expired: 1 });
    expect(api.banChatMember).toHaveBeenCalledWith(-100, 20);
    expect(api.banChatMember).not.toHaveBeenCalledWith(-100, 10);
  });

  it("never auto-renews at a changed price", async () => {
    const owner = await upsertOwner(sql, { id: 2, first_name: "Owner2" });
    const ch = await registerChannel(sql, owner.id, { id: -200, title: "Kanal 2" });
    const plan = await createPlan(sql, owner.id, ch.id, { title: "1 oy", duration_days: 30, price: 1_000_000 });
    const s = await upsertSubscriber(sql, { id: 30, first_name: "Auto2" });
    const { payment } = await createPayment(sql, { subscriberId: s.id, planId: plan.id, provider: "mock", autoRenew: true });
    await confirmPayment(sql, payment.id, ledger, { cardToken: "tok" });
    await sql`UPDATE subscriptions SET expires_at = now() + interval '12 hours' WHERE subscriber_id = ${s.id}`;
    await sql`UPDATE plans SET price = 2_000_000 WHERE id = ${plan.id}`;
    const before = (await getWallet(sql, owner.id)).available;
    const r = await runJobs({ sql, api: api as unknown as Api, provider: new MockProvider(), ledger, webAppUrl: "https://app" });
    expect(r.renewed).toBe(0);
    expect((await getWallet(sql, owner.id)).available).toBe(before);
    const [sub] = await sql`SELECT auto_renew FROM subscriptions WHERE subscriber_id = ${s.id}`;
    expect(sub!.auto_renew).toBe(false);
    expect(api.sendMessage).toHaveBeenCalledWith(30, expect.stringContaining("narx"), expect.anything());
  });
});
