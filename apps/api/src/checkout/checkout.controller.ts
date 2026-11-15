import { Body, Controller, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import type { TgUser } from "@obuna/core";
import { CurrentUser, TelegramAuthGuard } from "../common/auth.js";
import { CheckoutService } from "./checkout.service.js";

const StartBody = z.object({
  planId: z.number().int().positive(),
  autoRenew: z.boolean().default(true),
  cardNumber: z.string().regex(/^[\d ]{16,19}$/, "16 xonali karta raqami"),
  expiry: z.string().regex(/^\d{2}\/?\d{2}$/, "MM/YY"),
  promoCode: z.string().trim().max(20).optional(),
});
const TrialBody = z.object({ channelId: z.number().int().positive() });
const PromoBody = z.object({ planId: z.number().int().positive(), code: z.string().trim().min(1).max(20) });
const ConfirmBody = z.object({ otp: z.string().regex(/^\d{4,6}$/) });

/** "09/28" (MM/YY, as printed on the card) → "2809" (YYmm, as ATMOS expects). */
const toAtmosExpiry = (e: string) => {
  const d = e.replace("/", "");
  return d.slice(2) + d.slice(0, 2);
};

@Controller("api/checkout")
@UseGuards(TelegramAuthGuard)
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post()
  start(@CurrentUser() user: TgUser, @Body() body: unknown) {
    const b = StartBody.parse(body);
    return this.checkout.start(user, { ...b, expiry: toAtmosExpiry(b.expiry) });
  }

  /** Shows the discounted price before the subscriber enters a card. */
  @Post("promo")
  promo(@CurrentUser() user: TgUser, @Body() body: unknown) {
    const b = PromoBody.parse(body);
    return this.checkout.checkPromo(user, b.planId, b.code);
  }

  /** Free trial: no card, once per subscriber per channel. */
  @Post("trial")
  trial(@CurrentUser() user: TgUser, @Body() body: unknown) {
    return this.checkout.startTrial(user, TrialBody.parse(body).channelId);
  }

  @Post(":id/confirm")
  confirm(@CurrentUser() user: TgUser, @Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    return this.checkout.confirm(user, id, ConfirmBody.parse(body).otp);
  }
}
