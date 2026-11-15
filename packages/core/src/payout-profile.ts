import type { Sql, Tx } from "./db.js";
import { AppError, notFound } from "./errors.js";
import { decryptCard, encryptCard } from "./cardvault.js";
import type { Owner } from "./types.js";

export type LegalStatus = "self_employed" | "business" | "individual";
export const LEGAL_STATUSES: LegalStatus[] = ["self_employed", "business", "individual"];

/** Withdrawals per calendar month above which an identity check is required (5 000 000 so'm). */
export const KYC_MONTHLY_LIMIT = 500_000_000;
/** Payouts are paid in one batch on this weekday (1 = Monday), Tashkent time. */
export const PAYOUT_WEEKDAY = 1;

/** "998 90 123-45-67", "+998901234567" → "+998901234567". Only Uzbek mobile numbers. */
export function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  const full = d.length === 9 ? `998${d}` : d;
  if (!/^998\d{9}$/.test(full)) throw new AppError("bad_phone", "Telefon raqami +998 bilan boshlanadigan 12 xonali bo'lishi kerak");
  return `+${full}`;
}

/** The next payout day strictly after today, as YYYY-MM-DD in Tashkent (UTC+5, no DST). */
export function nextPayoutDate(now = new Date()): string {
  const local = new Date(now.getTime() + 5 * 3600_000);
  const day = local.getUTCDay();
  const add = ((PAYOUT_WEEKDAY - day + 7) % 7) || 7;
  local.setUTCDate(local.getUTCDate() + add);
  return local.toISOString().slice(0, 10);
}

/** Saves the phone the owner shared through Telegram (the bot receives it as a contact from the user). */
export async function setOwnerPhone(sql: Sql, tgId: number, phone: string): Promise<boolean> {
  const r = await sql`UPDATE owners SET phone = ${normalizePhone(phone)} WHERE tg_id = ${tgId} RETURNING id`;
  return r.length > 0;
}

export async function savePayoutProfile(
  sql: Sql, ownerId: number,
  p: { legalStatus: LegalStatus; businessTin?: string | null; businessName?: string | null; acceptTerms: boolean },
): Promise<Owner> {
  if (!LEGAL_STATUSES.includes(p.legalStatus)) throw new AppError("bad_status", "Maqomni tanlang");
  if (!p.acceptTerms) throw new AppError("terms_required", "Shartlarga rozilik bering");
  let tin: string | null = null;
  let name: string | null = null;
  if (p.legalStatus === "business") {
    tin = (p.businessTin ?? "").replace(/\D/g, "");
    name = (p.businessName ?? "").trim();
    if (!/^\d{9}$/.test(tin)) throw new AppError("bad_tin", "STIR 9 xonali bo'lishi kerak");
    if (name.length < 2 || name.length > 120) throw new AppError("bad_name", "Korxona nomini kiriting");
  }
  const [row] = await sql<Owner[]>`
    UPDATE owners SET legal_status = ${p.legalStatus}, business_tin = ${tin}, business_name = ${name},
      payout_terms_accepted_at = COALESCE(payout_terms_accepted_at, now())
    WHERE id = ${ownerId} RETURNING *`;
  if (!row) throw notFound("Egasi");
  return row;
}

/** The owner asks for an identity check; an operator compares it with documents and decides. */
export async function submitKyc(sql: Sql, ownerId: number, k: { fullName: string; pinfl: string }, key: Buffer): Promise<Owner> {
  const fullName = k.fullName.trim().replace(/\s+/g, " ");
  const pinfl = k.pinfl.replace(/\D/g, "");
  if (fullName.length < 5 || fullName.length > 120 || fullName.split(" ").length < 2)
    throw new AppError("bad_name", "Familiya, ism va otasining ismini pasportdagidek yozing");
  if (!/^[3-6]\d{13}$/.test(pinfl)) throw new AppError("bad_pinfl", "JSHSHIR 14 xonali raqam bo'lishi kerak");
  const [row] = await sql<Owner[]>`
    UPDATE owners SET kyc_status = 'pending', kyc_full_name = ${fullName}, kyc_pinfl_enc = ${encryptCard(pinfl, key)},
      kyc_note = NULL, kyc_submitted_at = now()
    WHERE id = ${ownerId} AND kyc_status <> 'verified' RETURNING *`;
  if (!row) throw new AppError("already_verified", "Shaxsingiz allaqachon tasdiqlangan", 409);
  return row;
}

export async function decideKyc(sql: Sql, ownerId: number, status: "verified" | "rejected", note: string | null): Promise<Owner> {
  const [row] = await sql<Owner[]>`
    UPDATE owners SET kyc_status = ${status}, kyc_note = ${note},
      kyc_verified_at = ${status === "verified" ? sql`now()` : null}
    WHERE id = ${ownerId} AND kyc_status = 'pending' RETURNING *`;
  if (!row) throw new AppError("bad_state", "Tekshiruv so'rovi topilmadi", 404);
  return row;
}

/** Withdrawn (not rejected) since the 1st of the month, Tashkent time. */
export async function withdrawnThisMonth(sql: Sql | Tx, ownerId: number): Promise<number> {
  const { s } = (await (sql as Sql)<{ s: number }[]>`
    SELECT COALESCE(SUM(amount), 0)::bigint AS s FROM withdrawals
    WHERE owner_id = ${ownerId} AND status <> 'rejected'
      AND created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent'`)[0]!;
  return s;
}

/** What the owner sees about their own payout profile. The PINFL is shown masked. */
export function publicProfile(o: Owner, key: Buffer, withdrawn: number) {
  let pinfl: string | null = null;
  try { pinfl = o.kyc_pinfl_enc ? `••••••••••${decryptCard(o.kyc_pinfl_enc, key).slice(-4)}` : null; } catch { pinfl = null; }
  return {
    phone: o.phone, legalStatus: o.legal_status, businessTin: o.business_tin, businessName: o.business_name,
    termsAccepted: !!o.payout_terms_accepted_at,
    complete: !!(o.phone && o.legal_status && o.payout_terms_accepted_at),
    kyc: { status: o.kyc_status, fullName: o.kyc_full_name, pinfl, note: o.kyc_note },
    withdrawnThisMonth: withdrawn, kycMonthlyLimit: KYC_MONTHLY_LIMIT, nextPayoutDate: nextPayoutDate(),
  };
}

/** Checks done before a withdrawal: profile complete, identity checked above the monthly limit. */
export function checkPayoutProfile(o: Owner, withdrawn: number, amount: number): void {
  if (!o.phone || !o.legal_status || !o.payout_terms_accepted_at)
    throw new AppError("payout_profile_required", "Pul yechishdan oldin telefon, maqom va shartlarni to'ldiring", 409);
  if (o.kyc_status !== "verified" && withdrawn + amount > KYC_MONTHLY_LIMIT)
    throw new AppError("kyc_required",
      o.kyc_status === "pending"
        ? "Oyiga 5 mln so'mdan ko'p yechish uchun shaxsingiz tekshirilmoqda, tasdiqlangach yecha olasiz"
        : "Oyiga 5 mln so'mdan ko'p yechish uchun shaxsingizni tasdiqlang", 403);
}

/** Platform operator: identity checks waiting for a decision, oldest first. */
export const listKycQueue = (sql: Sql) => sql<Owner[]>`
  SELECT * FROM owners WHERE kyc_status = 'pending' ORDER BY kyc_submitted_at`;
