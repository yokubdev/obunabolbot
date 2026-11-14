import { Body, Controller, Get, Inject, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { getOwnerByTgId, listSubscriberSubscriptions, setAutoRenew, upsertSubscriber, type Sql, type TgUser } from "@obuna/core";
import { CurrentUser, TelegramAuthGuard } from "../common/auth.js";
import { CONFIG, SQL } from "../tokens.js";
import type { AppConfig } from "../config.js";

@Controller("api/me")
@UseGuards(TelegramAuthGuard)
export class MeController {
  constructor(@Inject(SQL) private readonly sql: Sql, @Inject(CONFIG) private readonly cfg: AppConfig) {}

  @Get()
  async me(@CurrentUser() user: TgUser) {
    const owner = await getOwnerByTgId(this.sql, user.id);
    return {
      user,
      isOwner: !!owner,
      isPlatformAdmin: this.cfg.platformAdminIds.includes(user.id),
      botUsername: this.cfg.botUsername,
    };
  }

  @Get("subscriptions")
  async subscriptions(@CurrentUser() user: TgUser) {
    const sub = await upsertSubscriber(this.sql, user);
    return listSubscriberSubscriptions(this.sql, sub.id);
  }

  @Post("subscriptions/:id/auto-renew")
  async autoRenew(@CurrentUser() user: TgUser, @Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    const { on } = z.object({ on: z.boolean() }).parse(body);
    const sub = await upsertSubscriber(this.sql, user);
    return setAutoRenew(this.sql, sub.id, id, on);
  }
}
