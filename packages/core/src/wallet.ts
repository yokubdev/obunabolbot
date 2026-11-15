import type { Sql } from "./db.js";
import { AppError, notFound } from "./errors.js";
import type { Owner, Withdrawal } from "./types.js";
import { encryptCard } from "./cardvault.js";
import { assertPayoutsAllowed } from "./moderation.js";
import { checkPayoutProfile, nextPayoutDate, withdrawnThisMonth } from "./payout-profile.js";

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
      COALESCE(SUM(amount) FILTER (WHERE available_at <= now() OR type = 'withdrawal'), 0)::bigint AS available,
      COALESCE(SUM(amount) FILTER (WHERE available_at > now() AND type <> 'withdrawal'), 0)::bigint AS pending,
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
  const digits = card.replace(/[\s-]/g, "");
  if (!/^\d{16}$/.test(digits) || !/^(8600|9860|5614|4|5)/.test(digits))
    throw new AppError("bad_card", "Karta raqami 16 xonali Uzcard yoki Humo bo'lishi kerak");
  return digits;
}

export const MIN_WITHDRAWAL = 10_000_000; // 100 000 so'm
/** At most this many payout requests per owner per day (limits damage from a hijacked account). */
export const MAX_WITHDRAWALS_PER_DAY = 5;

/**
 * Takes money out of the cashbox immediately (a negative ledger entry) and queues a payout.
 * The owner row is locked so two parallel requests can never overdraw the balance.
 */
export async function requestWithdrawal(
  sql: Sql,
  ownerId: number,
  amount: number,
  card: string,
  cardKey: Buffer,
): Promise<Withdrawal> {
  if (!Number.isInteger(amount) || amount < MIN_WITHDRAWAL)
    throw new AppError("bad_amount", "Eng kam yechish summasi 100 000 so'm");
  const cardNumber = normalizeCard(card);
  await assertPayoutsAllowed(sql, ownerId);
  return sql.begin(async (tx) => {
    const [owner] = await tx<Owner[]>`SELECT * FROM owners WHERE id = ${ownerId} FOR UPDATE`;
    if (!owner) throw notFound("Egasi");
    // Inside the lock, so parallel requests can't jointly pass the monthly identity-check limit.
    checkPayoutProfile(owner, await withdrawnThisMonth(tx, ownerId), amount);
    const { available } = (await tx<{ available: number }[]>`
      SELECT COALESCE(SUM(amount), 0)::bigint AS available
      FROM ledger_entries WHERE owner_id = ${ownerId}
        -- Withdrawals count at once: their available_at is another transaction's now(), which can be
        -- later than this transaction's now() and would otherwise let parallel requests overdraw.
        AND (available_at <= now() OR type = 'withdrawal')`)[0]!;
    if (amount > available) throw new AppError("insufficient", "Kassada yetarli mablag' yo'q");
    const { today } = (await tx<{ today: number }[]>`
      SELECT COUNT(*)::int AS today FROM withdrawals WHERE owner_id = ${ownerId} AND created_at > now() - interval '1 day'`)[0]!;
    if (today >= MAX_WITHDRAWALS_PER_DAY)
      throw new AppError("too_many", "Bir kunda ko'pi bilan 5 ta yechish so'rovi", 429);
    const [w] = await tx<Withdrawal[]>`
      INSERT INTO withdrawals (owner_id, amount, card_number, card_enc, status, payout_date)
      VALUES (${ownerId}, ${amount}, ${cardNumber.slice(-4)}, ${encryptCard(cardNumber, cardKey)}, 'pending', ${nextPayoutDate()})
      RETURNING *`;
    await tx`
      INSERT INTO ledger_entries (owner_id, amount, type, withdrawal_id)
      VALUES (${ownerId}, ${-amount}, 'withdrawal', ${w!.id})`;
    return w!;
  });
}

export const listWithdrawals = (sql: Sql, ownerId: number) =>
  sql<Withdrawal[]>`SELECT * FROM withdrawals WHERE owner_id = ${ownerId} ORDER BY id DESC LIMIT 50`;

/** Includes card_enc: only the platform admin endpoint may read it, and it decrypts there. */
export interface PendingWithdrawal extends Withdrawal {
  owner_name: string; owner_tg_id: number; owner_phone: string | null; legal_status: string | null;
  business_tin: string | null; business_name: string | null; kyc_status: string; kyc_full_name: string | null;
}

/** With who the creator is, so the operator knows whom the payout goes to (and for tax reporting). */
export const listPendingWithdrawals = (sql: Sql) => sql<PendingWithdrawal[]>`
  SELECT w.*, o.name AS owner_name, o.tg_id AS owner_tg_id, o.phone AS owner_phone, o.legal_status,
         o.business_tin, o.business_name, o.kyc_status, o.kyc_full_name
  FROM withdrawals w JOIN owners o ON o.id = w.owner_id
  WHERE w.status = 'pending' ORDER BY w.payout_date NULLS FIRST, w.id`;

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
