import type { Sql } from "./db.js";
import { AppError, notFound } from "./errors.js";
import { getChannel } from "./channels.js";
import { assertCanSell } from "./moderation.js";
import type { Plan, Subscription } from "./types.js";

export interface SubscriberSubRow {
  id: number;
  status: "active" | "expired";
  expires_at: Date;
  auto_renew: boolean;
  channel_id: number;
  channel_title: string;
  channel_slug: string;
  plan_title: string;
  plan_price: number;
}

export const listSubscriberSubscriptions = (sql: Sql, subscriberId: number) => sql<SubscriberSubRow[]>`
  SELECT s.id, s.status, s.expires_at, s.auto_renew, c.id AS channel_id, c.title AS channel_title,
         c.slug AS channel_slug, p.title AS plan_title, p.price AS plan_price
  FROM subscriptions s JOIN channels c ON c.id = s.channel_id JOIN plans p ON p.id = s.plan_id
  WHERE s.subscriber_id = ${subscriberId}
  ORDER BY (s.status = 'active') DESC, s.expires_at DESC`;

export async function setAutoRenew(sql: Sql, subscriberId: number, subscriptionId: number, on: boolean) {
  const [row] = await sql`
    UPDATE subscriptions SET auto_renew = ${on} AND card_token IS NOT NULL
    WHERE id = ${subscriptionId} AND subscriber_id = ${subscriberId} RETURNING id, auto_renew`;
  if (!row) throw notFound("Obuna");
  return row as { id: number; auto_renew: boolean };
}

export interface OwnerSubRow {
  id: number;
  status: "active" | "expired";
  expires_at: Date;
  auto_renew: boolean;
  subscriber_name: string;
  subscriber_username: string | null;
  subscriber_tg_id: number;
  channel_title: string;
  plan_title: string;
  total_paid: number;
}

export type OwnerSubFilter = "all" | "active" | "expiring" | "expired";

export const listOwnerSubscribers = (sql: Sql, ownerId: number, filter: OwnerSubFilter = "all", q = "") => sql<OwnerSubRow[]>`
  SELECT s.id, s.status, s.expires_at, s.auto_renew,
         sb.name AS subscriber_name, sb.username AS subscriber_username, sb.tg_id AS subscriber_tg_id,
         c.title AS channel_title, p.title AS plan_title,
         COALESCE((SELECT SUM(amount) FROM payments pm
                   WHERE pm.subscriber_id = s.subscriber_id AND pm.channel_id = s.channel_id AND pm.status = 'paid'), 0)::bigint AS total_paid
  FROM subscriptions s
  JOIN channels c ON c.id = s.channel_id
  JOIN subscribers sb ON sb.id = s.subscriber_id
  JOIN plans p ON p.id = s.plan_id
  WHERE c.owner_id = ${ownerId}
    AND (${filter} = 'all'
      OR (${filter} = 'active' AND s.status = 'active')
      OR (${filter} = 'expiring' AND s.status = 'active' AND s.expires_at < now() + interval '3 days')
      OR (${filter} = 'expired' AND s.status = 'expired'))
    AND (${q} = '' OR sb.name ILIKE ${"%" + q + "%"} OR sb.username ILIKE ${"%" + q + "%"})
  ORDER BY s.expires_at DESC
  LIMIT 200`;

export interface DueRow {
  subscription_id: number;
  subscriber_tg_id: number;
  tg_chat_id: number;
  channel_title: string;
  channel_slug: string;
  expires_at: Date;
  auto_renew: boolean;
  plan_price: number;
  /** Only set by claimReminders. */
  bot_blocked?: boolean;
}

/**
 * Returns active subscriptions due a reminder and marks them in the same statement, so each
 * reminder is sent once. `3` = ending in 1–3 days, `1` = ending within a day (also marks the 3-day one,
 * so a subscription first seen inside the last day gets a single message).
 */
export async function claimReminders(sql: Sql, days: 1 | 3): Promise<DueRow[]> {
  const window =
    days === 3
      ? sql`NOT s.reminded_3d AND s.expires_at >= now() + interval '1 day' AND s.expires_at < now() + interval '3 days'`
      : sql`NOT s.reminded_1d AND s.expires_at > now() AND s.expires_at < now() + interval '1 day'`;
  return sql<DueRow[]>`
    UPDATE subscriptions s SET reminded_3d = true, reminded_1d = ${days === 1} OR s.reminded_1d
    FROM channels c, subscribers sb, plans p
    WHERE c.id = s.channel_id AND sb.id = s.subscriber_id AND p.id = s.plan_id
      AND s.status = 'active' AND ${window}
    RETURNING s.id AS subscription_id, sb.tg_id AS subscriber_tg_id, c.tg_chat_id, c.title AS channel_title,
              c.slug AS channel_slug, s.expires_at, s.auto_renew, p.price AS plan_price, sb.bot_blocked`;
}

/** Marks overdue subscriptions expired and returns them so the bot can remove the members. */
export async function expireDue(sql: Sql): Promise<DueRow[]> {
  return sql<DueRow[]>`
    UPDATE subscriptions s SET status = 'expired'
    FROM channels c, subscribers sb, plans p
    WHERE c.id = s.channel_id AND sb.id = s.subscriber_id AND p.id = s.plan_id
      AND s.status = 'active' AND s.expires_at <= now()
    RETURNING s.id AS subscription_id, sb.tg_id AS subscriber_tg_id, c.tg_chat_id, c.title AS channel_title,
              c.slug AS channel_slug, s.expires_at, s.auto_renew, p.price AS plan_price`;
}

/** Is this Telegram user allowed in this chat right now? Used to approve join requests. */
export async function hasActiveAccess(sql: Sql, tgUserId: number, tgChatId: number): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM subscriptions s
    JOIN subscribers sb ON sb.id = s.subscriber_id JOIN channels c ON c.id = s.channel_id
    WHERE sb.tg_id = ${tgUserId} AND c.tg_chat_id = ${tgChatId} AND s.status = 'active' AND s.expires_at > now()`;
  return rows.length > 0;
}

/**
 * Starts a channel's free trial for a subscriber. Only someone who has never had a subscription to the
 * channel qualifies (the unique (subscriber, channel) row makes a second trial impossible, even concurrently).
 */
export async function startTrial(sql: Sql, subscriberId: number, channelId: number): Promise<Subscription> {
  const channel = await getChannel(sql, channelId);
  if (channel.trial_days <= 0) throw new AppError("no_trial", "Bu kanalda bepul sinov yo'q");
  assertCanSell(channel);
  const [plan] = await sql<Plan[]>`
    SELECT * FROM plans WHERE channel_id = ${channelId} AND is_active ORDER BY duration_days, sort LIMIT 1`;
  if (!plan) throw new AppError("no_trial", "Bu kanalda bepul sinov yo'q");
  const [row] = await sql<Subscription[]>`
    INSERT INTO subscriptions (subscriber_id, channel_id, plan_id, status, starts_at, expires_at, is_trial)
    VALUES (${subscriberId}, ${channelId}, ${plan.id}, 'active', now(), now() + make_interval(days => ${channel.trial_days}), true)
    ON CONFLICT (subscriber_id, channel_id) DO NOTHING
    RETURNING *`;
  if (!row) throw new AppError("trial_used", "Bepul sinovdan faqat yangi obunachilar foydalana oladi", 409);
  return row;
}
