import type { Sql } from "./db.js";

export interface OwnerStats {
  revenueThisMonth: number;
  revenuePrevMonth: number;
  activeSubscribers: number;
  newThisMonth: number;
  expiringSoon: number;
  churnedThisMonth: number;
  monthly: { month: string; revenue: number }[];
}

export async function getOwnerStats(sql: Sql, ownerId: number): Promise<OwnerStats> {
  const [r] = await sql<Omit<OwnerStats, "monthly">[]>`
    SELECT
      COALESCE((SELECT SUM(p.amount) FROM payments p JOIN channels c ON c.id = p.channel_id
        WHERE c.owner_id = ${ownerId} AND p.status = 'paid' AND p.paid_at >= date_trunc('month', now())), 0)::bigint AS "revenueThisMonth",
      COALESCE((SELECT SUM(p.amount) FROM payments p JOIN channels c ON c.id = p.channel_id
        WHERE c.owner_id = ${ownerId} AND p.status = 'paid'
          AND p.paid_at >= date_trunc('month', now()) - interval '1 month' AND p.paid_at < date_trunc('month', now())), 0)::bigint AS "revenuePrevMonth",
      (SELECT COUNT(*) FROM subscriptions s JOIN channels c ON c.id = s.channel_id
        WHERE c.owner_id = ${ownerId} AND s.status = 'active')::int AS "activeSubscribers",
      (SELECT COUNT(*) FROM subscriptions s JOIN channels c ON c.id = s.channel_id
        WHERE c.owner_id = ${ownerId} AND s.created_at >= date_trunc('month', now()))::int AS "newThisMonth",
      (SELECT COUNT(*) FROM subscriptions s JOIN channels c ON c.id = s.channel_id
        WHERE c.owner_id = ${ownerId} AND s.status = 'active' AND s.expires_at < now() + interval '3 days')::int AS "expiringSoon",
      (SELECT COUNT(*) FROM subscriptions s JOIN channels c ON c.id = s.channel_id
        WHERE c.owner_id = ${ownerId} AND s.status = 'expired' AND s.expires_at >= date_trunc('month', now()))::int AS "churnedThisMonth"`;
  const monthly = await sql<{ month: string; revenue: number }[]>`
    SELECT to_char(m, 'YYYY-MM') AS month,
      COALESCE((SELECT SUM(p.amount) FROM payments p JOIN channels c ON c.id = p.channel_id
        WHERE c.owner_id = ${ownerId} AND p.status = 'paid'
          AND p.paid_at >= m AND p.paid_at < m + interval '1 month'), 0)::bigint AS revenue
    FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') AS m
    ORDER BY m`;
  return { ...r!, monthly };
}
