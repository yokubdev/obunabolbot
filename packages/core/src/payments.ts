import type { Sql } from "./db.js";
import { AppError, notFound } from "./errors.js";
import { commissionFor } from "./money.js";
import { getChannel, getPlan } from "./channels.js";
import { resolvePromo, type AppliedPromo } from "./promos.js";
import type { Channel, Payment, Plan, Subscription } from "./types.js";

export interface LedgerConfig {
  /** Platform commission in basis points (1000 = 10%). */
  commissionBps: number;
  /** Hours before a payment becomes withdrawable (refund/chargeback window). */
  holdHours: number;
}

export async function createPayment(
  sql: Sql,
  args: { subscriberId: number; planId: number; provider: string; autoRenew: boolean; promoCode?: string | null },
): Promise<{ payment: Payment; plan: Plan; channel: Channel; promo: AppliedPromo | null }> {
  const plan = await getPlan(sql, args.planId);
  if (!plan.is_active) throw new AppError("plan_inactive", "Bu tarif hozir sotilmayapti");
  const channel = await getChannel(sql, plan.channel_id);
  if (!channel.is_active) throw new AppError("channel_inactive", "Kanal hozir obuna qabul qilmayapti");
  const promo = args.promoCode ? await resolvePromo(sql, plan, args.promoCode, args.subscriberId) : null;
  const [payment] = await sql<Payment[]>`
    INSERT INTO payments (subscriber_id, channel_id, plan_id, amount, list_price, promo_code_id, provider, status, auto_renew)
    VALUES (${args.subscriberId}, ${channel.id}, ${plan.id}, ${promo ? promo.price : plan.price}, ${plan.price},
            ${promo ? promo.promo.id : null}, ${args.provider}, 'created', ${args.autoRenew})
    RETURNING *`;
  return { payment: payment!, plan, channel, promo };
}

export async function getPayment(sql: Sql, id: number): Promise<Payment> {
  const [row] = await sql<Payment[]>`SELECT * FROM payments WHERE id = ${id}`;
  if (!row) throw notFound("To'lov");
  return row;
}

/** Stores the provider's SMS session while we wait for the code. */
export async function markPaymentPendingOtp(sql: Sql, id: number, sessionId: string): Promise<void> {
  await sql`UPDATE payments SET status = 'pending_otp', provider_tx_id = ${`session:${id}:${sessionId}`}
            WHERE id = ${id} AND status IN ('created', 'pending_otp')`;
}

/** Card payments a subscriber may start per 10 minutes: every start sends an SMS to the card holder. */
export const MAX_CHECKOUTS_PER_10_MIN = 5;
/** Wrong SMS codes allowed before the payment is cancelled. */
export const MAX_OTP_ATTEMPTS = 5;

export async function assertCheckoutRate(sql: Sql, subscriberId: number): Promise<void> {
  const { n } = (await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM payments
    WHERE subscriber_id = ${subscriberId} AND created_at > now() - interval '10 minutes'`)[0]!;
  if (n >= MAX_CHECKOUTS_PER_10_MIN)
    throw new AppError("rate_limited", "Juda ko'p urinish. 10 daqiqadan keyin qayta urinib ko'ring", 429);
}

/**
 * Claims a payment for confirmation: pending_otp → confirming, counting the attempt.
 * Only one request can hold the claim, so the provider is never asked to charge twice.
 * Returns null when the payment is not claimable (already paid, in progress, failed, or out of attempts).
 */
export async function claimPaymentForConfirm(sql: Sql, id: number, subscriberId: number): Promise<Payment | null> {
  const [row] = await sql<Payment[]>`
    UPDATE payments SET status = 'confirming', otp_attempts = otp_attempts + 1
    WHERE id = ${id} AND subscriber_id = ${subscriberId} AND status = 'pending_otp' AND otp_attempts < ${MAX_OTP_ATTEMPTS}
    RETURNING *`;
  return row ?? null;
}

/** Wrong SMS code: give the claim back so the subscriber can try again (until attempts run out). */
export async function releasePaymentClaim(sql: Sql, id: number): Promise<void> {
  await sql`
    UPDATE payments SET status = CASE WHEN otp_attempts >= ${MAX_OTP_ATTEMPTS} THEN 'failed' ELSE 'pending_otp' END,
      error = CASE WHEN otp_attempts >= ${MAX_OTP_ATTEMPTS} THEN 'too many wrong codes' ELSE error END
    WHERE id = ${id} AND status = 'confirming'`;
}

export function sessionIdOf(p: Payment): string | null {
  const m = p.provider_tx_id?.match(/^session:\d+:(.+)$/);
  return m ? m[1]! : null;
}

export interface RenewalRow {
  subscription_id: number;
  subscriber_id: number;
  plan_id: number;
  card_token: string;
  subscriber_tg_id: number;
  channel_title: string;
  channel_slug: string;
  /** The plan's current price and state, and what the subscriber last paid for it. */
  plan_price: number;
  plan_active: boolean;
  last_amount: number | null;
}

/**
 * Claims the auto-renew subscriptions ending within 24h that had no renewal attempt in the last 20h.
 * The claim (renew_attempted_at) is taken in the same statement, so overlapping job runs
 * (in-process timer plus an external cron) can never both charge the same card.
 */
export const claimDueRenewals = (sql: Sql) => sql<RenewalRow[]>`
  WITH due AS (
    UPDATE subscriptions s SET renew_attempted_at = now()
    WHERE s.status = 'active' AND s.auto_renew AND s.card_token IS NOT NULL
      AND s.expires_at < now() + interval '1 day'
      AND (s.renew_attempted_at IS NULL OR s.renew_attempted_at < now() - interval '20 hours')
    RETURNING s.*
  )
  SELECT d.id AS subscription_id, d.subscriber_id, d.plan_id, d.card_token, sb.tg_id AS subscriber_tg_id,
         c.title AS channel_title, c.slug AS channel_slug, pl.price AS plan_price, pl.is_active AS plan_active,
         (SELECT COALESCE(p.list_price, p.amount) FROM payments p WHERE p.subscriber_id = d.subscriber_id AND p.channel_id = d.channel_id
            AND p.status = 'paid' ORDER BY p.paid_at DESC LIMIT 1) AS last_amount
  FROM due d
  JOIN subscribers sb ON sb.id = d.subscriber_id
  JOIN channels c ON c.id = d.channel_id
  JOIN plans pl ON pl.id = d.plan_id`;

/** Stops auto-renew (price changed, plan withdrawn, card declined): the subscriber renews by hand. */
export async function stopAutoRenew(sql: Sql, subscriptionId: number): Promise<void> {
  await sql`UPDATE subscriptions SET auto_renew = false WHERE id = ${subscriptionId}`;
}

export async function markPaymentFailed(sql: Sql, id: number, error: string): Promise<void> {
  await sql`UPDATE payments SET status = 'failed', error = ${error} WHERE id = ${id} AND status <> 'paid'`;
}

export interface ConfirmResult {
  payment: Payment;
  subscription: Subscription;
  channel: Channel;
  /** True when this call did nothing because the payment was already confirmed (webhook retry etc). */
  alreadyPaid: boolean;
  /** True when the subscriber already had an active subscription (renewal: no new invite needed). */
  wasActive: boolean;
}

/**
 * Confirms a payment exactly once: marks it paid, credits the owner's virtual cashbox
 * (payment minus commission, held for `holdHours`), and creates or extends the subscription.
 * Everything happens in one DB transaction with the payment row locked, so retries are safe.
 */
export async function confirmPayment(
  sql: Sql,
  paymentId: number,
  cfg: LedgerConfig,
  opts: { cardToken?: string | null; providerTxId?: string } = {},
): Promise<ConfirmResult> {
  return sql.begin(async (tx) => {
    const [payment] = await tx<Payment[]>`SELECT * FROM payments WHERE id = ${paymentId} FOR UPDATE`;
    if (!payment) throw notFound("To'lov");
    const [channel] = await tx<Channel[]>`SELECT * FROM channels WHERE id = ${payment.channel_id}`;
    const [plan] = await tx<Plan[]>`SELECT * FROM plans WHERE id = ${payment.plan_id}`;

    if (payment.status === "paid") {
      const [sub] = await tx<Subscription[]>`
        SELECT * FROM subscriptions WHERE subscriber_id = ${payment.subscriber_id} AND channel_id = ${payment.channel_id}`;
      return { payment, subscription: sub!, channel: channel!, alreadyPaid: true, wasActive: true };
    }
    if (payment.status === "failed") throw new AppError("payment_failed", "To'lov bekor qilingan");
    // Never book money for a payment that the provider has not been asked to charge.
    if (payment.status === "pending_otp") throw new AppError("bad_state", "To'lov tasdiqlanmagan");

    const [paid] = await tx<Payment[]>`
      UPDATE payments SET status = 'paid', paid_at = now(),
        provider_tx_id = COALESCE(${opts.providerTxId ?? null}, provider_tx_id)
      WHERE id = ${paymentId} RETURNING *`;
    if (payment.promo_code_id !== null)
      await tx`UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ${payment.promo_code_id}`;

    const commission = commissionFor(payment.amount, cfg.commissionBps);
    const availableAt = new Date(Date.now() + cfg.holdHours * 3600_000);
    await tx`
      INSERT INTO ledger_entries (owner_id, amount, type, payment_id, available_at)
      VALUES (${channel!.owner_id}, ${payment.amount}, 'payment', ${paymentId}, ${availableAt})`;
    if (commission > 0) {
      await tx`
        INSERT INTO ledger_entries (owner_id, amount, type, payment_id, available_at)
        VALUES (${channel!.owner_id}, ${-commission}, 'commission', ${paymentId}, ${availableAt})`;
    }

    const [existing] = await tx<Subscription[]>`
      SELECT * FROM subscriptions WHERE subscriber_id = ${payment.subscriber_id} AND channel_id = ${payment.channel_id}
      FOR UPDATE`;
    const wasActive = !!existing && existing.status === "active" && existing.expires_at > new Date();
    const durationMs = plan!.duration_days * 86400_000;
    const cardToken = opts.cardToken ?? existing?.card_token ?? null;
    let subscription: Subscription;
    if (!existing) {
      const now = new Date();
      subscription = (await tx<Subscription[]>`
        INSERT INTO subscriptions (subscriber_id, channel_id, plan_id, status, starts_at, expires_at, auto_renew, card_token)
        VALUES (${payment.subscriber_id}, ${payment.channel_id}, ${payment.plan_id}, 'active', ${now},
                ${new Date(now.getTime() + durationMs)}, ${payment.auto_renew && !!cardToken}, ${cardToken})
        RETURNING *`)[0]!;
    } else {
      const base = wasActive ? existing.expires_at : new Date();
      subscription = (await tx<Subscription[]>`
        UPDATE subscriptions SET
          plan_id = ${payment.plan_id}, status = 'active',
          starts_at = ${wasActive ? existing.starts_at : new Date()},
          expires_at = ${new Date(base.getTime() + durationMs)},
          auto_renew = ${payment.auto_renew && !!cardToken}, card_token = ${cardToken},
          reminded_3d = false, reminded_1d = false
        WHERE id = ${existing.id} RETURNING *`)[0]!;
    }
    return { payment: paid!, subscription, channel: channel!, alreadyPaid: false, wasActive };
  });
}
