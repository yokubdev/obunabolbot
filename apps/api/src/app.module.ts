import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { CoreModule } from "./common/core.module.js";
import { ErrorsFilter } from "./common/errors.filter.js";
import { TelegramAuthGuard, OwnerGuard, PlatformAdminGuard } from "./common/auth.js";
import { ChannelsController } from "./channels/channels.controller.js";
import { CheckoutController } from "./checkout/checkout.controller.js";
import { CheckoutService } from "./checkout/checkout.service.js";
import { MeController } from "./me/me.controller.js";
import { OwnerController } from "./owner/owner.controller.js";
import { PlatformController } from "./platform/platform.controller.js";
import type { AppConfig } from "./config.js";

@Module({})
export class AppModule {
  static forConfig(cfg: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forConfig(cfg)],
      controllers: [ChannelsController, CheckoutController, MeController, OwnerController, PlatformController],
      providers: [
        CheckoutService, TelegramAuthGuard, OwnerGuard, PlatformAdminGuard,
        { provide: APP_FILTER, useClass: ErrorsFilter },
      ],
    };
  }
}
