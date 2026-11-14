import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Api } from "grammy";
import {
  AppError, assertCheckoutRate, claimPaymentForConfirm, commissionFor, confirmPayment, createPayment, getPayment, getPlan,
  markPaymentFailed, markPaymentPendingOtp, releasePaymentClaim, sessionIdOf, upsertSubscriber, type Sql, type TgUser,
} from "@obuna/core";
import { ProviderError, type CardPaymentProvider } from "@obuna/atmos";
import { grantAccess, notifyOwnerSale, notifyRenewed } from "@obuna/telegram";
import { CONFIG, PAYMENTS, SQL, TG_API } from "../tokens.js";
import type { AppConfig } from "../config.js";

@Injectable()
export class CheckoutService {
  private readonly log = new Logger("Checkout");

  constructor(
    @Inject(SQL) private readonly sql: Sql,
    @Inject(PAYMENTS) private readonly provider: CardPaymentProvider,
    @Inject(TG_API) private readonly tg: Api,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** Step 1: create the payment and send an SMS code to the card owner. */
  async start(user: TgUser, a: { planId: number; autoRenew: boolean; cardNumber: string; expiry: string }) {
    const subscriber = await upsertSubscriber(this.sql, user);
    await assertCheckoutRate(this.sql, subscriber.id);
    const { payment } = await createPayment(this.sql, {
      subscriberId: subscriber.id, planId: a.planId, provider: this.provider.name, autoRenew: a.autoRenew,
    });
    try {
      const { sessionId, phoneMask } = await this.provider.startCardPayment({
        paymentId: payment.id, amount: payment.amount, cardNumber: a.cardNumber.replace(/\D/g, ""), expiry: a.expiry,
      });
      await markPaymentPendingOtp(this.sql, payment.id, sessionId);
      return { paymentId: payment.id, amount: payment.amount, phoneMask };
    } catch (e) {
      await markPaymentFailed(this.sql, payment.id, (e as Error).message);
      throw e;
    }
  }

  /** Step 2: check the SMS code, charge, credit the owner's cashbox and send the invite link. */
  async confirm(user: TgUser, paymentId: number, otp: string) {
    const subscriber = await upsertSubscriber(this.sql, user);
    const claimed = await claimPaymentForConfirm(this.sql, paymentId, subscriber.id);
    if (!claimed) {
      const p = await getPayment(this.sql, paymentId).catch(() => null);
      if (!p || p.subscriber_id !== subscriber.id) throw new AppError("not_found", "To'lov topilmadi", 404);
      if (p.status === "paid") return this.fulfilled(paymentId);
      if (p.status === "confirming") throw new AppError("in_progress", "To'lov tekshirilmoqda, biroz kuting", 409);
      throw new AppError("bad_state", "To'lovni qaytadan boshlang");
    }
    const sessionId = sessionIdOf(claimed);
    if (!sessionId) {
      await markPaymentFailed(this.sql, paymentId, "no provider session");
      throw new AppError("bad_state", "To'lovni qaytadan boshlang");
    }

    let charged: { providerTxId: string; cardToken: string };
    try {
      charged = await this.provider.confirmCardPayment({ paymentId, amount: claimed.amount, sessionId, otp });
    } catch (e) {
      // A wrong code can be retried a few times; anything else ends this payment.
      if (e instanceof ProviderError && e.code === "bad_otp") await releasePaymentClaim(this.sql, paymentId);
      else await markPaymentFailed(this.sql, paymentId, (e as Error).message);
      throw e;
    }
    const result = await confirmPayment(
      this.sql, paymentId, { commissionBps: this.cfg.commissionBps, holdHours: this.cfg.holdHours },
      { providerTxId: charged.providerTxId, cardToken: claimed.auto_renew ? charged.cardToken : null },
    );
    if (!result.alreadyPaid) await this.notify(result, user);
    return this.fulfilled(paymentId);
  }

  private async fulfilled(paymentId: number) {
    const p = await getPayment(this.sql, paymentId);
    const [sub] = await this.sql<{ expires_at: Date; auto_renew: boolean }[]>`
      SELECT expires_at, auto_renew FROM subscriptions WHERE subscriber_id = ${p.subscriber_id} AND channel_id = ${p.channel_id}`;
    return { status: p.status, expiresAt: sub?.expires_at ?? null, autoRenew: sub?.auto_renew ?? false };
  }

  /** Telegram side effects never fail the payment: the money is already booked. */
  private async notify(r: Awaited<ReturnType<typeof confirmPayment>>, user: TgUser) {
    const plan = await getPlan(this.sql, r.payment.plan_id);
    const [owner] = await this.sql<{ tg_id: number }[]>`SELECT tg_id FROM owners WHERE id = ${r.channel.owner_id}`;
    const tasks = [
      r.wasActive
        ? notifyRenewed(this.tg, { tgUserId: user.id, channelTitle: r.channel.title, expiresAt: r.subscription.expires_at, amount: r.payment.amount })
        : grantAccess(this.tg, {
            tgChatId: r.channel.tg_chat_id, tgUserId: user.id, channelTitle: r.channel.title,
            expiresAt: r.subscription.expires_at, amount: r.payment.amount,
          }),
      notifyOwnerSale(this.tg, {
        ownerTgId: owner!.tg_id,
        subscriberName: [user.first_name, user.last_name].filter(Boolean).join(" "),
        planTitle: plan.title,
        amount: r.payment.amount,
        credited: r.payment.amount - commissionFor(r.payment.amount, this.cfg.commissionBps),
      }),
    ];
    for (const res of await Promise.allSettled(tasks))
      if (res.status === "rejected") this.log.warn(`Telegram xabari yuborilmadi: ${String(res.reason)}`);
  }
}
