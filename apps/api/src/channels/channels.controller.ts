import { Controller, Get, Inject, Param } from "@nestjs/common";
import { getChannelBySlug, listPlans, type Sql } from "@obuna/core";
import { SQL } from "../tokens.js";

/** Public channel page: what a subscriber sees before paying. */
@Controller("api/channels")
export class ChannelsController {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  @Get(":slug")
  async get(@Param("slug") slug: string) {
    const ch = await getChannelBySlug(this.sql, slug);
    const [{ count }] = (await this.sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM subscriptions WHERE channel_id = ${ch.id} AND status = 'active'`) as unknown as [{ count: number }];
    const plans = await listPlans(this.sql, ch.id);
    return {
      channel: { id: ch.id, title: ch.title, slug: ch.slug, description: ch.description, subscribers: count },
      plans: plans.map((p) => ({ id: p.id, title: p.title, durationDays: p.duration_days, price: p.price })),
    };
  }
}
