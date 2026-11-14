import type { Sql } from "./db.js";
import { AppError, notFound } from "./errors.js";
import type { Channel, Plan } from "./types.js";

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[ʻʼ'`’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base || "kanal";
}

/** Registers (or re-activates) a channel when the bot is made admin there. */
export async function registerChannel(
  sql: Sql,
  ownerId: number,
  chat: { id: number; title: string },
): Promise<Channel> {
  const existing = await sql<Channel[]>`SELECT * FROM channels WHERE tg_chat_id = ${chat.id}`;
  if (existing[0]) {
    if (existing[0].owner_id !== ownerId) throw new AppError("channel_taken", "Bu kanal boshqa egaga ulangan", 409);
    const [row] = await sql<Channel[]>`
      UPDATE channels SET title = ${chat.title}, is_active = true WHERE id = ${existing[0].id} RETURNING *`;
    return row!;
  }
  let slug = slugify(chat.title);
  const taken = await sql`SELECT 1 FROM channels WHERE slug = ${slug}`;
  if (taken.length) slug = `${slug}-${Math.abs(chat.id) % 100000}`;
  const [row] = await sql<Channel[]>`
    INSERT INTO channels (owner_id, tg_chat_id, title, slug) VALUES (${ownerId}, ${chat.id}, ${chat.title}, ${slug})
    RETURNING *`;
  return row!;
}

export async function deactivateChannelByChatId(sql: Sql, chatId: number): Promise<void> {
  await sql`UPDATE channels SET is_active = false WHERE tg_chat_id = ${chatId}`;
}

export const listOwnerChannels = (sql: Sql, ownerId: number) =>
  sql<Channel[]>`SELECT * FROM channels WHERE owner_id = ${ownerId} ORDER BY id`;

export async function getChannel(sql: Sql, id: number): Promise<Channel> {
  const [row] = await sql<Channel[]>`SELECT * FROM channels WHERE id = ${id}`;
  if (!row) throw notFound("Kanal");
  return row;
}

export async function getChannelBySlug(sql: Sql, slug: string): Promise<Channel> {
  const [row] = await sql<Channel[]>`SELECT * FROM channels WHERE slug = ${slug} AND is_active`;
  if (!row) throw notFound("Kanal");
  return row;
}

export async function getOwnedChannel(sql: Sql, ownerId: number, channelId: number): Promise<Channel> {
  const ch = await getChannel(sql, channelId);
  if (ch.owner_id !== ownerId) throw notFound("Kanal");
  return ch;
}

export async function updateChannel(
  sql: Sql,
  ownerId: number,
  channelId: number,
  patch: { description?: string; slug?: string },
): Promise<Channel> {
  await getOwnedChannel(sql, ownerId, channelId);
  if (patch.slug !== undefined && !/^[a-z0-9-]{3,32}$/.test(patch.slug))
    throw new AppError("bad_slug", "Havola nomi 3–32 ta lotin harf, raqam yoki '-' bo'lishi kerak");
  const [row] = await sql<Channel[]>`
    UPDATE channels SET
      description = COALESCE(${patch.description ?? null}, description),
      slug = COALESCE(${patch.slug ?? null}, slug)
    WHERE id = ${channelId} RETURNING *`;
  return row!;
}

export const listPlans = (sql: Sql, channelId: number, onlyActive = true) =>
  onlyActive
    ? sql<Plan[]>`SELECT * FROM plans WHERE channel_id = ${channelId} AND is_active ORDER BY sort, duration_days`
    : sql<Plan[]>`SELECT * FROM plans WHERE channel_id = ${channelId} ORDER BY sort, duration_days`;

export async function getPlan(sql: Sql, id: number): Promise<Plan> {
  const [row] = await sql<Plan[]>`SELECT * FROM plans WHERE id = ${id}`;
  if (!row) throw notFound("Tarif");
  return row;
}

function validatePlan(p: { title: string; duration_days: number; price: number }) {
  if (!p.title.trim()) throw new AppError("bad_plan", "Tarif nomi bo'sh");
  if (!Number.isInteger(p.duration_days) || p.duration_days < 1 || p.duration_days > 3660)
    throw new AppError("bad_plan", "Muddat 1–3660 kun bo'lishi kerak");
  if (!Number.isInteger(p.price) || p.price < 100_000) throw new AppError("bad_plan", "Narx kamida 1 000 so'm");
}

export async function createPlan(
  sql: Sql,
  ownerId: number,
  channelId: number,
  p: { title: string; duration_days: number; price: number },
): Promise<Plan> {
  await getOwnedChannel(sql, ownerId, channelId);
  validatePlan(p);
  const [row] = await sql<Plan[]>`
    INSERT INTO plans (channel_id, title, duration_days, price)
    VALUES (${channelId}, ${p.title.trim()}, ${p.duration_days}, ${p.price}) RETURNING *`;
  return row!;
}

export async function updatePlan(
  sql: Sql,
  ownerId: number,
  planId: number,
  p: { title?: string; price?: number; is_active?: boolean },
): Promise<Plan> {
  const plan = await getPlan(sql, planId);
  await getOwnedChannel(sql, ownerId, plan.channel_id);
  validatePlan({ title: p.title ?? plan.title, duration_days: plan.duration_days, price: p.price ?? plan.price });
  const [row] = await sql<Plan[]>`
    UPDATE plans SET
      title = ${p.title?.trim() ?? plan.title},
      price = ${p.price ?? plan.price},
      is_active = ${p.is_active ?? plan.is_active}
    WHERE id = ${planId} RETURNING *`;
  return row!;
}

/** Creates the default 1 / 3 / 12 month plans for a fresh channel. */
export async function createDefaultPlans(sql: Sql, ownerId: number, channelId: number, monthlyPrice: number) {
  const plans = [
    { title: "1 oy", duration_days: 30, price: monthlyPrice },
    { title: "3 oy", duration_days: 90, price: Math.round((monthlyPrice * 3 * 0.85) / 100_000) * 100_000 },
    { title: "12 oy", duration_days: 365, price: Math.round((monthlyPrice * 12 * 0.66) / 100_000) * 100_000 },
  ];
  const out: Plan[] = [];
  for (const p of plans) out.push(await createPlan(sql, ownerId, channelId, p));
  return out;
}
