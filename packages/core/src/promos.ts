import type { Sql } from "./db.js";
import { AppError, notFound } from "./errors.js";
import { getOwnedChannel, getPlan } from "./channels.js";
import type { Plan } from "./types.js";

export interface PromoCode {
  id: number;
  channel_id: number;
  code: string;
  kind: "percent" | "amount";
  value: number;
  plan_id: number | null;
  max_uses: number | null;
  used_count: number;
  expires_at: Date | null;
  is_active: boolean;
  created_at: Date;
}

/** The lowest price a discount may bring a plan to: 1 000 so'm (payments need a real charge). */
export const MIN_DISCOUNTED_PRICE = 100_000;
export const MAX_PERCENT = 90;

export const normalizeCode = (code: string) => code.trim().toUpperCase();

export interface PromoInput {
  code: string;
  kind: "percent" | "amount";
  value: number;
  planId?: number | null;
  maxUses?: number | null;
  expiresAt?: Date | null;
}

export async function createPromo(sql: Sql, ownerId: number, channelId: number, p: PromoInput): Promise<PromoCode> {
  await getOwnedChannel(sql, ownerId, channelId);
  const code = normalizeCode(p.code);
  if (!/^[A-Z0-9_]{3,20}$/.test(code))
    throw new AppError("bad_promo", "Kod 3–20 ta lotin harf, raqam yoki '_' bo'lishi kerak");
  if (!Number.isInteger(p.value) || p.value <= 0) throw new AppError("bad_promo", "Chegirma musbat bo'lishi kerak");
  if (p.kind === "percent" && p.value > MAX_PERCENT) throw new AppError("bad_promo", `Chegirma ko'pi bilan ${MAX_PERCENT}%`);
  if (p.planId) {
    const plan = await getPlan(sql, p.planId);
    if (plan.channel_id !== channelId) throw notFound("Tarif");
  }
  if (p.maxUses != null && (!Number.isInteger(p.maxUses) || p.maxUses < 1 || p.maxUses > 1_000_000))
    throw new AppError("bad_promo", "Foydalanish soni 1 dan katta bo'lishi kerak");
  if (p.expiresAt && p.expiresAt.getTime() <= Date.now()) throw new AppError("bad_promo", "Tugash sanasi kelajakda bo'lishi kerak");
  const [taken] = await sql`SELECT 1 FROM promo_codes WHERE channel_id = ${channelId} AND code = ${code}`;
  if (taken) throw new AppError("promo_taken", "Bu kod allaqachon bor", 409);
  const [row] = await sql<PromoCode[]>`
    INSERT INTO promo_codes (channel_id, code, kind, value, plan_id, max_uses, expires_at)
    VALUES (${channelId}, ${code}, ${p.kind}, ${p.value}, ${p.planId ?? null}, ${p.maxUses ?? null}, ${p.expiresAt ?? null})
    RETURNING *`;
  return row!;
}

export async function listPromos(sql: Sql, ownerId: number, channelId: number): Promise<PromoCode[]> {
  await getOwnedChannel(sql, ownerId, channelId);
  return sql<PromoCode[]>`SELECT * FROM promo_codes WHERE channel_id = ${channelId} ORDER BY id DESC`;
}

export async function setPromoActive(sql: Sql, ownerId: number, promoId: number, isActive: boolean): Promise<PromoCode> {
  const [p] = await sql<PromoCode[]>`SELECT * FROM promo_codes WHERE id = ${promoId}`;
  if (!p) throw notFound("Promo-kod");
  await getOwnedChannel(sql, ownerId, p.channel_id);
  const [row] = await sql<PromoCode[]>`UPDATE promo_codes SET is_active = ${isActive} WHERE id = ${promoId} RETURNING *`;
  return row!;
}

/** Discount in tiyin for a plan, never bringing the price below MIN_DISCOUNTED_PRICE. */
export function discountFor(promo: Pick<PromoCode, "kind" | "value">, price: number): number {
  const raw = promo.kind === "percent" ? Math.floor((price * promo.value) / 100) : promo.value;
  return Math.max(0, Math.min(raw, price - MIN_DISCOUNTED_PRICE));
}

export interface AppliedPromo {
  promo: PromoCode;
  listPrice: number;
  discount: number;
  price: number;
}

/**
 * Checks a code for a plan and a subscriber. One message for every reason a code does not apply,
 * so codes cannot be probed for existence.
 */
export async function resolvePromo(sql: Sql, plan: Plan, rawCode: string, subscriberId: number | null): Promise<AppliedPromo> {
  const invalid = () => new AppError("promo_invalid", "Promo-kod yaroqsiz yoki muddati tugagan");
  const code = normalizeCode(rawCode);
  if (!/^[A-Z0-9_]{3,20}$/.test(code)) throw invalid();
  const [promo] = await sql<PromoCode[]>`
    SELECT * FROM promo_codes WHERE channel_id = ${plan.channel_id} AND code = ${code}`;
  if (!promo || !promo.is_active) throw invalid();
  if (promo.expires_at && promo.expires_at.getTime() <= Date.now()) throw invalid();
  if (promo.max_uses !== null && promo.used_count >= promo.max_uses) throw invalid();
  if (promo.plan_id !== null && promo.plan_id !== plan.id) throw invalid();
  if (subscriberId !== null) {
    const [used] = await sql`
      SELECT 1 FROM payments WHERE promo_code_id = ${promo.id} AND subscriber_id = ${subscriberId} AND status = 'paid'`;
    if (used) throw new AppError("promo_used", "Bu promo-koddan allaqachon foydalangansiz");
  }
  const discount = discountFor(promo, plan.price);
  if (discount <= 0) throw invalid();
  return { promo, listPrice: plan.price, discount, price: plan.price - discount };
}
