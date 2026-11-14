import type { Sql } from "./db.js";
import { AppError, notFound } from "./errors.js";
import { commissionFor } from "./money.js";
import { getChannel, getPlan } from "./channels.js";
import type { Channel, Payment, Plan, Subscription } from "./types.js";

export interface LedgerConfig {
  /** Platform commission in basis points (1000 = 10%). */
  commissionBps: number;
  /** Hours before a payment becomes withdrawable (refund/chargeback window). */
  holdHours: number;
}

export async function createPayment(
  sql: Sql,
  args: { subscriberId: number; planId: number; provider: string; autoRenew: boolean },
): Promise<{ payment: Payment; plan: Plan; channel: Channel }> {
  const plan = await getPlan(sql, args.planId);
  if (!plan.is_active) throw new AppError("plan_inactive", "Bu tarif hozir sotilmayapti");
  const channel = await getChannel(sql, plan.channel_id);
  if (!channel.is_active) throw new AppError("channel_inactive", "Kanal hozir obuna qabul qilmayapti");
  const [payment] = await sql<Payment[]>`
    INSERT INTO payments (subscriber_id, channel_id, plan_id, amount, provider, status, auto_renew)
    VALUES (${args.subscriberId}, ${channel.id}, ${plan.id}, ${plan.price}, ${args.provider}, 'created', ${args.autoRenew})
    RETURNING *`;
  return { payment: payment!, plan, channel };
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

export function sessionIdOf(p: Payment): string | null {
  const m = p.provider_tx_id?.match(/^session:\d+:(.+)$/);
  return m ? m[1]! : null;
}

export interface RenewalRow { subscription_id: number; subscriber_id: number; plan_id: number; card_token: string; subscriber_tg_id: number }

/** Active auto-renew subscriptions ending within 24h that have no renewal attempt today. */
export const listDueRenewals = (sql: Sql) => sql<RenewalRow[]>`
  SELECT s.id AS subscription_id, s.subscriber_id, s.plan_id, s.card_token, sb.tg_id AS subscriber_tg_id
  FROM subscriptions s JOIN subscribers sb ON sb.id = s.subscriber_id
  WHERE s.status = 'active' AND s.auto_renew AND s.card_token IS NOT NULL
    AND s.expires_at < now() + interval '1 day'
    AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.subscriber_id = s.subscriber_id AND p.channel_id = s.channel_id
                    AND p.created_at > now() - interval '20 hours')`;

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

    const [paid] = await tx<Payment[]>`
      UPDATE payments SET status = 'paid', paid_at = now(),
        provider_tx_id = COALESCE(${opts.providerTxId ?? null}, provider_tx_id)
      WHERE id = ${paymentId} RETURNING *`;

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
