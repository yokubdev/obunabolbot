import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createDb, migrate, registerChannel, createPlan, upsertOwner, type Sql, acceptRules, setOwnerPhone } from "@obuna/core";
import { signInitData } from "@obuna/telegram";
import { AppModule } from "../src/app.module.js";
import { loadConfig } from "../src/config.js";
import { TG_API } from "../src/tokens.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const BOT = "123:TEST";

d("API end to end (mock ATMOS, fake Telegram)", () => {
  let app: INestApplication;
  let sql: Sql;
  const tg = {
    createChatInviteLink: vi.fn(async () => ({ invite_link: "https://t.me/+abc" })),
    unbanChatMember: vi.fn(async () => true),
    sendMessage: vi.fn(async () => ({})),
  };
  const as = (id: number, name = "User") => `tma ${signInitData({ id, first_name: name }, BOT)}`;

  beforeAll(async () => {
    sql = createDb(url!);
    await sql`DROP SCHEMA public CASCADE`;
    await sql`CREATE SCHEMA public`;
    await migrate(sql);
    const owner = await upsertOwner(sql, { id: 111, first_name: "Jasur" });
    const ch = await registerChannel(sql, owner.id, { id: -1001, title: "Fitness Akademiya" });
    await acceptRules(sql, owner.id, ch.id);
    await createPlan(sql, owner.id, ch.id, { title: "1 oy", duration_days: 30, price: 4_900_000 });

    const cfg = loadConfig({
      DATABASE_URL: url, BOT_TOKEN: BOT, HOLD_HOURS: "0", NEW_CHANNEL_HOLD_HOURS: "0", JOBS_SECRET: "js", WEBHOOK_SECRET: "ws", PLATFORM_ADMIN_IDS: "999", ATMOS_MOCK: "true",
    } as NodeJS.ProcessEnv);
    const mod = await Test.createTestingModule({ imports: [AppModule.forConfig(cfg)] })
      .overrideProvider(TG_API).useValue(tg)
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await sql?.end();
  });

  it("rejects requests without Telegram signature", async () => {
    await request(app.getHttpServer()).get("/api/me").expect(401);
    await request(app.getHttpServer()).get("/api/me").set("Authorization", "tma hash=bad").expect(401);
  });

  it("runs the full flow: channel page → pay → invite → cashbox → withdraw → payout", async () => {
    const http = request(app.getHttpServer());
    const page = await http.get("/api/channels/fitness-akademiya").expect(200);
    const planId = page.body.plans[0].id;
    expect(page.body.plans[0].price).toBe(4_900_000);

    const start = await http.post("/api/checkout").set("Authorization", as(222, "Aziz"))
      .send({ planId, autoRenew: true, cardNumber: "8600 1234 5678 4417", expiry: "09/28" }).expect(201);
    await http.post(`/api/checkout/${start.body.paymentId}/confirm`).set("Authorization", as(222, "Aziz"))
      .send({ otp: "000000" }).expect(402);
    const ok = await http.post(`/api/checkout/${start.body.paymentId}/confirm`).set("Authorization", as(222, "Aziz"))
      .send({ otp: "111111" }).expect(201);
    expect(ok.body.status).toBe("paid");
    expect(ok.body.autoRenew).toBe(true);
    expect(tg.createChatInviteLink).toHaveBeenCalledWith(-1001, expect.objectContaining({ creates_join_request: true }));
    expect(tg.sendMessage).toHaveBeenCalledWith(111, expect.stringContaining("44 100 so'm"));

    // Someone else cannot confirm or see this payment.
    await http.post(`/api/checkout/${start.body.paymentId}/confirm`).set("Authorization", as(333))
      .send({ otp: "111111" }).expect(404);

    const subs = await http.get("/api/me/subscriptions").set("Authorization", as(222, "Aziz")).expect(200);
    expect(subs.body[0].channel_title).toBe("Fitness Akademiya");

    await http.get("/api/owner/overview").set("Authorization", as(222)).expect(403);
    const ov = await http.get("/api/owner/overview").set("Authorization", as(111, "Jasur")).expect(200);
    expect(ov.body.wallet.available).toBe(4_410_000);
    expect(ov.body.stats.activeSubscribers).toBe(1);

    // First withdrawal: the payout profile comes first.
    await http.post("/api/owner/withdrawals").set("Authorization", as(111))
      .send({ amount: 4_000_000, cardNumber: "9860123456784417" }).expect(400); // under 100 000 so'm
    const [{ id: chId, owner_id: ownerId }] = await sql`SELECT id, owner_id FROM channels WHERE slug = 'fitness-akademiya'`;
    const yearly = await createPlan(sql, ownerId, chId, { title: "1 yil", duration_days: 365, price: 49_000_000 });
    const start2 = await http.post("/api/checkout").set("Authorization", as(222, "Aziz"))
      .send({ planId: yearly.id, autoRenew: false, cardNumber: "8600 1234 5678 4417", expiry: "09/28" }).expect(201);
    await http.post(`/api/checkout/${start2.body.paymentId}/confirm`).set("Authorization", as(222, "Aziz")).send({ otp: "111111" }).expect(201);
    const [offer] = await sql`SELECT offer_accepted_at FROM subscribers WHERE tg_id = 222`;
    expect(offer!.offer_accepted_at).not.toBeNull();

    const err = await http.post("/api/owner/withdrawals").set("Authorization", as(111))
      .send({ amount: 40_000_000, cardNumber: "9860123456784417" }).expect(409);
    expect(err.body.error.code).toBe("payout_profile_required");
    await http.post("/api/owner/payout-profile").set("Authorization", as(111)).send({ legalStatus: "self_employed", acceptTerms: false }).expect(400);
    let prof = await http.post("/api/owner/payout-profile").set("Authorization", as(111)).send({ legalStatus: "self_employed", acceptTerms: true }).expect(201);
    expect(prof.body.complete).toBe(false); // no phone yet
    await setOwnerPhone(sql, 111, "+998901234567"); // what the bot does when the owner shares the contact
    prof = await http.get("/api/owner/payout-profile").set("Authorization", as(111)).expect(200);
    expect(prof.body).toMatchObject({ complete: true, phone: "+998901234567", legalStatus: "self_employed", kyc: { status: "none" } });

    const w = await http.post("/api/owner/withdrawals").set("Authorization", as(111))
      .send({ amount: 40_000_000, cardNumber: "9860123456784417" }).expect(201);
    expect(w.body.card_number).toBe("•••• 4417");
    expect(w.body.payout_date).toBeTruthy();

    await http.get("/api/platform/withdrawals").set("Authorization", as(111)).expect(403);
    const pending = await http.get("/api/platform/withdrawals").set("Authorization", as(999)).expect(200);
    expect(pending.body).toHaveLength(1);
    // Only the platform operator sees the full card; the owner never gets the encrypted blob.
    expect(pending.body[0].card_number).toBe("9860123456784417");
    expect(pending.body[0].card_enc).toBeUndefined();
    expect(pending.body[0]).toMatchObject({ owner_phone: "+998901234567", legal_status: "self_employed" });
    await http.post(`/api/platform/withdrawals/${w.body.id}/paid`).set("Authorization", as(999)).expect(201);
    const wallet = await http.get("/api/owner/wallet").set("Authorization", as(111)).expect(200);
    expect(wallet.body.available).toBe(8_510_000);
    expect(wallet.body.withdrawals[0].status).toBe("paid");
    expect(JSON.stringify(wallet.body)).not.toMatch(/card_enc|9860123456784417/);
  });

  it("lets an owner manage plans but not another owner's", async () => {
    const http = request(app.getHttpServer());
    const ov = await http.get("/api/owner/overview").set("Authorization", as(111)).expect(200);
    const chId = ov.body.channels[0].id;
    const p = await http.post(`/api/owner/channels/${chId}/plans`).set("Authorization", as(111))
      .send({ title: "3 oy", durationDays: 90, price: 12_500_000 }).expect(201);
    await http.patch(`/api/owner/plans/${p.body.id}`).set("Authorization", as(111)).send({ isActive: false }).expect(200);
    await upsertOwner(sql, { id: 444, first_name: "Boshqa" });
    await http.patch(`/api/owner/plans/${p.body.id}`).set("Authorization", as(444)).send({ price: 1 }).expect(404);
  });

  it("protects the webhook and the jobs endpoint with secrets", async () => {
    const http = request(app.getHttpServer());
    await http.post("/internal/jobs").expect(403);
    await http.post("/internal/jobs").set("X-Jobs-Secret", "wrong").expect(403);
    const r = await http.post("/internal/jobs").set("X-Jobs-Secret", "js").expect(200);
    expect(r.body).toMatchObject({ renewed: 0, renewFailed: 0 });
    await http.post("/telegram/webhook").send({ update_id: 1 }).expect(401);
    await http.post("/telegram/webhook").set("X-Telegram-Bot-Api-Secret-Token", "nope").send({ update_id: 1 }).expect(401);
  });

  it("charges once when the SMS code is confirmed twice at the same time", async () => {
    const http = request(app.getHttpServer());
    const page = await http.get("/api/channels/fitness-akademiya").expect(200);
    const start = await http.post("/api/checkout").set("Authorization", as(555))
      .send({ planId: page.body.plans[0].id, autoRenew: false, cardNumber: "8600123456784417", expiry: "09/28" }).expect(201);
    const before = tg.sendMessage.mock.calls.length;
    const res = await Promise.all([1, 2].map(() =>
      http.post(`/api/checkout/${start.body.paymentId}/confirm`).set("Authorization", as(555)).send({ otp: "111111" })));
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    const [{ n }] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM ledger_entries WHERE payment_id = ${start.body.paymentId} AND type = 'payment'`;
    expect(n).toBe(1);
    expect(tg.sendMessage.mock.calls.length - before).toBe(2); // one invite, one owner sale note
  });

  it("cancels a payment after too many wrong SMS codes and limits new payments", async () => {
    const http = request(app.getHttpServer());
    const page = await http.get("/api/channels/fitness-akademiya").expect(200);
    const body = { planId: page.body.plans[0].id, autoRenew: false, cardNumber: "8600123456784417", expiry: "09/28" };
    const start = await http.post("/api/checkout").set("Authorization", as(666)).send(body).expect(201);
    for (let i = 0; i < 5; i++)
      await http.post(`/api/checkout/${start.body.paymentId}/confirm`).set("Authorization", as(666)).send({ otp: "000000" }).expect(402);
    await http.post(`/api/checkout/${start.body.paymentId}/confirm`).set("Authorization", as(666)).send({ otp: "111111" }).expect(400);
    for (let i = 0; i < 4; i++) await http.post("/api/checkout").set("Authorization", as(666)).send(body).expect(201);
    await http.post("/api/checkout").set("Authorization", as(666)).send(body).expect(429);
  });

  it("rejects stale and future-dated Telegram signatures", async () => {
    const http = request(app.getHttpServer());
    const now = Math.floor(Date.now() / 1000);
    await http.get("/api/me").set("Authorization", `tma ${signInitData({ id: 1, first_name: "x" }, BOT, now - 2 * 86400)}`).expect(401);
    await http.get("/api/me").set("Authorization", `tma ${signInitData({ id: 1, first_name: "x" }, BOT, now + 3600)}`).expect(401);
    await http.get("/api/me").set("Authorization", `tma ${signInitData({ id: 1, first_name: "x" }, "999:OTHER")}`).expect(401);
  });

  it("lets an owner create promo codes and a subscriber pay the discounted price", async () => {
    const http = request(app.getHttpServer());
    const ov = await http.get("/api/owner/overview").set("Authorization", as(111)).expect(200);
    const chId = ov.body.channels[0].id;
    const promo = await http.post(`/api/owner/channels/${chId}/promos`).set("Authorization", as(111))
      .send({ code: "yoz50", kind: "percent", value: 50 }).expect(201);
    expect(promo.body.code).toBe("YOZ50");
    await http.post(`/api/owner/channels/${chId}/promos`).set("Authorization", as(444))
      .send({ code: "STEAL", kind: "percent", value: 50 }).expect(404);
    await http.patch(`/api/owner/promos/${promo.body.id}`).set("Authorization", as(444)).send({ isActive: false }).expect(404);

    const page = await http.get("/api/channels/fitness-akademiya").expect(200);
    const planId = page.body.plans[0].id;
    const q = await http.post("/api/checkout/promo").set("Authorization", as(777)).send({ planId, code: "yoz50" }).expect(201);
    expect(q.body).toMatchObject({ listPrice: 4_900_000, discount: 2_450_000, price: 2_450_000 });
    const bad = await http.post("/api/checkout/promo").set("Authorization", as(777)).send({ planId, code: "NOPE" }).expect(400);
    expect(bad.body.error.code).toBe("promo_invalid");

    const start = await http.post("/api/checkout").set("Authorization", as(777))
      .send({ planId, autoRenew: false, cardNumber: "8600123456784417", expiry: "09/28", promoCode: "YOZ50" }).expect(201);
    expect(start.body.amount).toBe(2_450_000);
    await http.post(`/api/checkout/${start.body.paymentId}/confirm`).set("Authorization", as(777)).send({ otp: "111111" }).expect(201);
    await http.post("/api/checkout/promo").set("Authorization", as(777)).send({ planId, code: "YOZ50" }).expect(400);
    const list = await http.get(`/api/owner/channels/${chId}/promos`).set("Authorization", as(111)).expect(200);
    expect(list.body[0].used_count).toBe(1);
  });

  it("lets an owner set up the channel page and a newcomer start a free trial once", async () => {
    const http = request(app.getHttpServer());
    const ov = await http.get("/api/owner/overview").set("Authorization", as(111)).expect(200);
    const chId = ov.body.channels[0].id;
    await http.patch(`/api/owner/channels/${chId}`).set("Authorization", as(111))
      .send({ perks: ["Har kuni video"], welcomeText: "Xush kelibsiz!", trialDays: 3 }).expect(200);
    await http.patch(`/api/owner/channels/${chId}`).set("Authorization", as(444)).send({ trialDays: 30 }).expect(404);
    const page = await http.get("/api/channels/fitness-akademiya").expect(200);
    expect(page.body.channel).toMatchObject({ perks: ["Har kuni video"], trialDays: 3, chatType: "channel" });
    expect(page.body.channel.welcome_text).toBeUndefined();

    const sent = tg.sendMessage.mock.calls.length;
    await http.post("/api/checkout/trial").set("Authorization", as(888)).send({ channelId: chId }).expect(201);
    const texts = tg.sendMessage.mock.calls.slice(sent).map((c) => String(c[1]));
    expect(texts.some((t) => t.includes("Bepul sinov"))).toBe(true);
    expect(texts).toContain("Xush kelibsiz!");
    await http.post("/api/checkout/trial").set("Authorization", as(888)).send({ channelId: chId }).expect(409);
    // Someone who already paid is not a newcomer either.
    await http.post("/api/checkout/trial").set("Authorization", as(777)).send({ channelId: chId }).expect(409);
  });

  it("takes subscriber reports and lets only the platform block a channel", async () => {
    const http = request(app.getHttpServer());
    await http.post("/api/channels/fitness-akademiya/report").send({ reason: "fraud" }).expect(401);
    await http.post("/api/channels/fitness-akademiya/report").set("Authorization", as(901)).send({ reason: "nonsense" }).expect(400);
    const sent = tg.sendMessage.mock.calls.length;
    await http.post("/api/channels/fitness-akademiya/report").set("Authorization", as(901)).send({ reason: "fraud", note: "pul oldi" }).expect(201);
    expect(tg.sendMessage.mock.calls.slice(sent).some((c) => c[0] === 999 && String(c[1]).includes("shikoyat"))).toBe(true);

    await http.get("/api/platform/moderation").set("Authorization", as(111)).expect(403);
    const list = await http.get("/api/platform/moderation").set("Authorization", as(999)).expect(200);
    const row = list.body.find((r: { slug: string }) => r.slug === "fitness-akademiya");
    expect(row.open_reports).toBe(1);
    await http.post(`/api/platform/channels/${row.id}/moderation`).set("Authorization", as(999)).send({ status: "blocked" }).expect(400);
    await http.post(`/api/platform/channels/${row.id}/moderation`).set("Authorization", as(999)).send({ status: "blocked", reason: "Firibgarlik" }).expect(201);
    await http.get("/api/channels/fitness-akademiya").expect(404);
    await http.post("/api/owner/withdrawals").set("Authorization", as(111)).send({ amount: 10_000_000, cardNumber: "8600123456784417" }).expect(403);
    await http.post(`/api/platform/channels/${row.id}/moderation`).set("Authorization", as(999)).send({ status: "active" }).expect(201);
    await http.get("/api/channels/fitness-akademiya").expect(200);
  });

  it("runs the identity check through the platform operator (no MyID)", async () => {
    const http = request(app.getHttpServer());
    await http.post("/api/owner/kyc").set("Authorization", as(111)).send({ fullName: "Karimov Jasur", pinfl: "123" }).expect(400);
    const sent = tg.sendMessage.mock.calls.length;
    const k = await http.post("/api/owner/kyc").set("Authorization", as(111))
      .send({ fullName: "Karimov Jasur Akmalovich", pinfl: "31234567890123" }).expect(201);
    expect(k.body.kyc).toEqual({ status: "pending", fullName: "Karimov Jasur Akmalovich", pinfl: "••••••••••0123", note: null });
    expect(tg.sendMessage.mock.calls.slice(sent).some((c) => c[0] === 999)).toBe(true);
    await http.get("/api/platform/kyc").set("Authorization", as(111)).expect(403);
    const q = await http.get("/api/platform/kyc").set("Authorization", as(999)).expect(200);
    expect(q.body[0]).toMatchObject({ fullName: "Karimov Jasur Akmalovich", pinfl: "31234567890123" });
    await http.post(`/api/platform/owners/${q.body[0].ownerId}/kyc`).set("Authorization", as(999)).send({ status: "rejected" }).expect(400);
    await http.post(`/api/platform/owners/${q.body[0].ownerId}/kyc`).set("Authorization", as(999)).send({ status: "verified" }).expect(201);
    const prof = await http.get("/api/owner/payout-profile").set("Authorization", as(111)).expect(200);
    expect(prof.body.kyc.status).toBe("verified");
  });
});
