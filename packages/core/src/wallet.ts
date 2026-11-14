import type { Sql } from "./db.js";
import { AppError, notFound } from "./errors.js";
import type { Withdrawal } from "./types.js";

export interface WalletSummary {
  /** Withdrawable now (tiyin). */
  available: number;
  /** Still in the hold window (tiyin). */
  pending: number;
  /** Commission charged since the 1st of this month (positive tiyin). */
  commissionThisMonth: number;
}

export async function getWallet(sql: Sql, ownerId: number): Promise<WalletSummary> {
  const [row] = await sql<{ available: number; pending: number; commission: number }[]>`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE available_at <= now()), 0)::bigint AS available,
      COALESCE(SUM(amount) FILTER (WHERE available_at > now()), 0)::bigint AS pending,
      COALESCE(-SUM(amount) FILTER (WHERE type = 'commission' AND created_at >= date_trunc('month', now())), 0)::bigint AS commission
    FROM ledger_entries WHERE owner_id = ${ownerId}`;
  return { available: row!.available, pending: row!.pending, commissionThisMonth: row!.commission };
}

export interface LedgerRow {
  id: number;
  amount: number;
  type: string;
  created_at: Date;
  available_at: Date;
  subscriber_name: string | null;
  plan_title: string | null;
  card_number: string | null;
}

export const listLedger = (sql: Sql, ownerId: number, limit = 50) => sql<LedgerRow[]>`
  SELECT l.id, l.amount, l.type, l.created_at, l.available_at,
         s.name AS subscriber_name, pl.title AS plan_title,
         CASE WHEN w.card_number IS NULL THEN NULL ELSE '•••• ' || right(w.card_number, 4) END AS card_number
  FROM ledger_entries l
  LEFT JOIN payments p ON p.id = l.payment_id
  LEFT JOIN subscribers s ON s.id = p.subscriber_id
  LEFT JOIN plans pl ON pl.id = p.plan_id
  LEFT JOIN withdrawals w ON w.id = l.withdrawal_id
  WHERE l.owner_id = ${ownerId}
  ORDER BY l.id DESC LIMIT ${limit}`;

export function normalizeCard(card: string): string {
  const digits = card.replace(/\D/g, "");
  if (!/^(8600|9860|5614|4|5)\d+$/.test(digits) || digits.length !== 16)
    throw new AppError("bad_card", "Karta raqami 16 xonali Uzcard yoki Humo bo'lishi kerak");
  return digits;
}

export const MIN_WITHDRAWAL = 1_000_000; // 10 000 so'm

/**
 * Takes money out of the cashbox immediately (a negative ledger entry) and queues a payout.
 * The owner row is locked so two parallel requests can never overdraw the balance.
 */
export async function requestWithdrawal(
  sql: Sql,
  ownerId: number,
  amount: number,
  card: string,
): Promise<Withdrawal> {
  if (!Number.isInteger(amount) || amount < MIN_WITHDRAWAL)
    throw new AppError("bad_amount", "Eng kam yechish summasi 10 000 so'm");
  const cardNumber = normalizeCard(card);
  return sql.begin(async (tx) => {
    await tx`SELECT id FROM owners WHERE id = ${ownerId} FOR UPDATE`;
    const { available } = (await tx<{ available: number }[]>`
      SELECT COALESCE(SUM(amount), 0)::bigint AS available
      FROM ledger_entries WHERE owner_id = ${ownerId} AND available_at <= now()`)[0]!;
    if (amount > available) throw new AppError("insufficient", "Kassada yetarli mablag' yo'q");
    const [w] = await tx<Withdrawal[]>`
      INSERT INTO withdrawals (owner_id, amount, card_number, status)
      VALUES (${ownerId}, ${amount}, ${cardNumber}, 'pending') RETURNING *`;
    await tx`
      INSERT INTO ledger_entries (owner_id, amount, type, withdrawal_id)
      VALUES (${ownerId}, ${-amount}, 'withdrawal', ${w!.id})`;
    return w!;
  });
}

export const listWithdrawals = (sql: Sql, ownerId: number) =>
  sql<Withdrawal[]>`SELECT * FROM withdrawals WHERE owner_id = ${ownerId} ORDER BY id DESC LIMIT 50`;

export const listPendingWithdrawals = (sql: Sql) => sql<(Withdrawal & { owner_name: string; owner_tg_id: number })[]>`
  SELECT w.*, o.name AS owner_name, o.tg_id AS owner_tg_id
  FROM withdrawals w JOIN owners o ON o.id = w.owner_id
  WHERE w.status = 'pending' ORDER BY w.id`;

/** Platform admin: the money was sent to the card (manually, or by a payout provider). */
export async function markWithdrawalPaid(sql: Sql, id: number): Promise<Withdrawal> {
  const [w] = await sql<Withdrawal[]>`
    UPDATE withdrawals SET status = 'paid', processed_at = now() WHERE id = ${id} AND status = 'pending' RETURNING *`;
  if (!w) throw notFound("Kutilayotgan so'rov");
  return w;
}

/** Platform admin: payout failed or refused; the money goes back to the cashbox. */
export async function rejectWithdrawal(sql: Sql, id: number, note: string): Promise<Withdrawal> {
  return sql.begin(async (tx) => {
    const [w] = await tx<Withdrawal[]>`
      UPDATE withdrawals SET status = 'rejected', processed_at = now(), note = ${note}
      WHERE id = ${id} AND status = 'pending' RETURNING *`;
    if (!w) throw notFound("Kutilayotgan so'rov");
    await tx`
      INSERT INTO ledger_entries (owner_id, amount, type, withdrawal_id)
      VALUES (${w.owner_id}, ${w.amount}, 'withdrawal_reversal', ${w.id})`;
    return w;
  });
}
