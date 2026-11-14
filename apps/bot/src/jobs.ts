import type { Api } from "grammy";
import {
  claimDueRenewals, claimReminders, confirmPayment, createPayment, expireDue, formatSom, markPaymentFailed, stopAutoRenew,
  type LedgerConfig, type Sql,
} from "@obuna/core";
import type { CardPaymentProvider } from "@obuna/atmos";
import { notifyRenewed, revokeAccess, sendReminder, webAppButton } from "@obuna/telegram";

export interface JobDeps {
  sql: Sql;
  api: Api;
  provider: CardPaymentProvider;
  ledger: LedgerConfig;
  webAppUrl: string;
  log?: (msg: string) => void;
}

/** One pass of the scheduler: auto-renew, remind, then expire. Safe to run often and concurrently-safe per row. */
export async function runJobs(d: JobDeps) {
  const log = d.log ?? (() => {});
  const renewUrl = (slug: string) => `${d.webAppUrl}/c/${slug}`;
  const stats = { renewed: 0, renewFailed: 0, reminded: 0, expired: 0 };

  for (const r of await claimDueRenewals(d.sql)) {
    // Never charge a card more than the subscriber agreed to, or for a plan that is no longer sold.
    if (!r.plan_active || (r.last_amount !== null && r.plan_price !== r.last_amount)) {
      await stopAutoRenew(d.sql, r.subscription_id);
      stats.renewFailed++;
      const why = r.plan_active ? `narx ${formatSom(r.plan_price)} ga o'zgardi` : "tarif endi sotilmayapti";
      await d.api
        .sendMessage(r.subscriber_tg_id, `«${r.channel_title}» obunasini avtomatik uzaytirmadik: ${why}. Davom ettirish uchun qo'lda uzaytiring.`, {
          reply_markup: webAppButton("Uzaytirish", renewUrl(r.channel_slug)),
        })
        .catch(() => {});
      continue;
    }
    let paymentId: number | null = null;
    try {
      const { payment, channel } = await createPayment(d.sql, {
        subscriberId: r.subscriber_id, planId: r.plan_id, provider: d.provider.name, autoRenew: true,
      });
      paymentId = payment.id;
      const { providerTxId } = await d.provider.chargeToken({ paymentId: payment.id, amount: payment.amount, cardToken: r.card_token });
      const res = await confirmPayment(d.sql, payment.id, d.ledger, { providerTxId, cardToken: r.card_token });
      stats.renewed++;
      await notifyRenewed(d.api, {
        tgUserId: r.subscriber_tg_id, channelTitle: channel.title, expiresAt: res.subscription.expires_at, amount: payment.amount,
      }).catch(() => {});
    } catch (e) {
      // One bad row must not stop the others; the claim keeps it from being retried for 20 hours.
      stats.renewFailed++;
      if (paymentId !== null) await markPaymentFailed(d.sql, paymentId, (e as Error).message).catch(() => {});
      log(`renewal ${r.subscription_id} failed: ${(e as Error).message}`);
    }
  }

  for (const days of [3, 1] as const) {
    for (const r of await claimReminders(d.sql, days)) {
      stats.reminded++;
      await sendReminder(d.api, {
        tgUserId: r.subscriber_tg_id, channelTitle: r.channel_title, expiresAt: r.expires_at,
        autoRenew: r.auto_renew, price: r.plan_price, renewUrl: renewUrl(r.channel_slug),
      }).catch((e) => log(`reminder failed: ${e}`));
    }
  }

  for (const r of await expireDue(d.sql)) {
    stats.expired++;
    await revokeAccess(d.api, {
      tgChatId: r.tg_chat_id, tgUserId: r.subscriber_tg_id, channelTitle: r.channel_title, renewUrl: renewUrl(r.channel_slug),
    }).catch((e) => log(`revoke failed: ${e}`));
  }
  return stats;
}
