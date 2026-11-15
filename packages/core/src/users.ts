import type { Sql } from "./db.js";
import { displayName, type Owner, type Subscriber, type TgUser } from "./types.js";

/** Creates or refreshes an owner. Their virtual cashbox exists implicitly: balance = SUM(ledger). */
export async function upsertOwner(sql: Sql, u: TgUser): Promise<Owner> {
  const [row] = await sql<Owner[]>`
    INSERT INTO owners (tg_id, name, username) VALUES (${u.id}, ${displayName(u)}, ${u.username ?? null})
    ON CONFLICT (tg_id) DO UPDATE SET name = EXCLUDED.name, username = EXCLUDED.username
    RETURNING *`;
  return row!;
}

export async function getOwnerByTgId(sql: Sql, tgId: number): Promise<Owner | undefined> {
  const [row] = await sql<Owner[]>`SELECT * FROM owners WHERE tg_id = ${tgId}`;
  return row;
}

export async function upsertSubscriber(sql: Sql, u: TgUser): Promise<Subscriber> {
  const [row] = await sql<Subscriber[]>`
    INSERT INTO subscribers (tg_id, name, username, language_code)
    VALUES (${u.id}, ${displayName(u)}, ${u.username ?? null}, ${u.language_code?.slice(0, 8) ?? null})
    ON CONFLICT (tg_id) DO UPDATE SET name = EXCLUDED.name, username = EXCLUDED.username,
      language_code = COALESCE(EXCLUDED.language_code, subscribers.language_code),
      -- A user who writes to the bot or opens the Mini App again can be messaged again.
      bot_blocked = false
    RETURNING *`;
  return row!;
}

/** The subscriber accepted the public offer (shown next to the pay button). Kept from the first time. */
export async function acceptOffer(sql: Sql, subscriberId: number): Promise<void> {
  await sql`UPDATE subscribers SET offer_accepted_at = COALESCE(offer_accepted_at, now()) WHERE id = ${subscriberId}`;
}

/** Telegram answered 403 "bot was blocked by the user": stop sending reminders. */
export async function markBotBlocked(sql: Sql, tgId: number): Promise<void> {
  await sql`UPDATE subscribers SET bot_blocked = true WHERE tg_id = ${tgId}`;
}
