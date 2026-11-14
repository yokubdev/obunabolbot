import type { Api } from "grammy";
import {
  claimReminders, confirmPayment, createPayment, expireDue, listDueRenewals, markPaymentFailed, type LedgerConfig, type Sql,
} from "@obuna/core";
import type { CardPaymentProvider } from "@obuna/atmos";
import { notifyRenewed, revokeAccess, sendReminder } from "@obuna/telegram";

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

  for (const r of await listDueRenewals(d.sql)) {
    const { payment, channel } = await createPayment(d.sql, {
      subscriberId: r.subscriber_id, planId: r.plan_id, provider: d.provider.name, autoRenew: true,
    });
    try {
      const { providerTxId } = await d.provider.chargeToken({ paymentId: payment.id, amount: payment.amount, cardToken: r.card_token });
      const res = await confirmPayment(d.sql, payment.id, d.ledger, { providerTxId, cardToken: r.card_token });
      stats.renewed++;
      await notifyRenewed(d.api, {
        tgUserId: r.subscriber_tg_id, channelTitle: channel.title, expiresAt: res.subscription.expires_at, amount: payment.amount,
      }).catch(() => {});
    } catch (e) {
      stats.renewFailed++;
      await markPaymentFailed(d.sql, payment.id, (e as Error).message);
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
