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
    INSERT INTO subscribers (tg_id, name, username) VALUES (${u.id}, ${displayName(u)}, ${u.username ?? null})
    ON CONFLICT (tg_id) DO UPDATE SET name = EXCLUDED.name, username = EXCLUDED.username
    RETURNING *`;
  return row!;
}
