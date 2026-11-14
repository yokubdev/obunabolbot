/**
 * Demo data for local development: owner (Telegram id 111) with one channel, 3 plans and
 * a few months of paying subscribers. Open the web app with ?dev=111 to see the owner panel,
 * or ?dev=1001 to see a subscriber.
 */
import { createDb } from "./db.js";
import { migrate } from "./migrate.js";
import { upsertOwner, upsertSubscriber } from "./users.js";
import { createDefaultPlans, registerChannel, updateChannel } from "./channels.js";
import { confirmPayment, createPayment } from "./payments.js";

const sql = createDb(process.env.DATABASE_URL!, { max: 1 });
await migrate(sql);
const owner = await upsertOwner(sql, { id: 111, first_name: "Jasur", last_name: "Karimov", username: "jasurk" });
const channel = await registerChannel(sql, owner.id, { id: -1001234567890, title: "Fitness Akademiya" });
await updateChannel(sql, owner.id, channel.id, {
  description: "Haftalik mashg'ulot rejalari, ovqatlanish menyusi va har payshanba jonli efir.",
});
const [p1, p3, p12] = await createDefaultPlans(sql, owner.id, channel.id, 4_900_000);
const names = ["Aziz Rahimov", "Malika Yusupova", "Sevara Nazarova", "Bekzod Aliyev", "Dilnoza Tursunova", "Otabek Saidov", "Nodira Qodirova", "Sardor Ergashev"];
const cfg = { commissionBps: 1000, holdHours: 24 };
for (const [i, name] of names.entries()) {
  const [first, last] = name.split(" ");
  const sub = await upsertSubscriber(sql, { id: 1001 + i, first_name: first!, last_name: last, username: first!.toLowerCase() });
  const plan = [p1, p3, p12, p1][i % 4]!;
  const { payment } = await createPayment(sql, { subscriberId: sub.id, planId: plan.id, provider: "mock", autoRenew: i % 2 === 0 });
  const r = await confirmPayment(sql, payment.id, cfg, { cardToken: i % 2 === 0 ? "mock-token" : null });
  // Spread payments over the last months so the chart has a shape.
  const daysAgo = i * 17;
  await sql`UPDATE payments SET paid_at = now() - make_interval(days => ${daysAgo}), created_at = now() - make_interval(days => ${daysAgo}) WHERE id = ${payment.id}`;
  await sql`UPDATE ledger_entries SET created_at = now() - make_interval(days => ${daysAgo}),
              available_at = now() - make_interval(days => ${daysAgo}) + interval '24 hours' WHERE payment_id = ${payment.id}`;
  if (i === 4) await sql`UPDATE subscriptions SET expires_at = now() + interval '2 days' WHERE id = ${r.subscription.id}`;
  if (i === 7) await sql`UPDATE subscriptions SET status = 'expired', expires_at = now() - interval '3 days' WHERE id = ${r.subscription.id}`;
}
console.log(`Seeded: owner tg 111, channel /c/${channel.slug}, ${names.length} subscribers`);
await sql.end();
