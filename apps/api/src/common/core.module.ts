import { Global, Module, type OnApplicationShutdown, Inject } from "@nestjs/common";
import { Api } from "grammy";
import { createDb, type Sql } from "@obuna/core";
import { AtmosProvider, MockProvider } from "@obuna/atmos";
import { CONFIG, PAYMENTS, SQL, TG_API } from "../tokens.js";
import type { AppConfig } from "../config.js";

@Global()
@Module({})
export class CoreModule implements OnApplicationShutdown {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  static forConfig(cfg: AppConfig) {
    return {
      module: CoreModule,
      providers: [
        { provide: CONFIG, useValue: cfg },
        { provide: SQL, useFactory: () => createDb(cfg.databaseUrl) },
        {
          provide: PAYMENTS,
          useFactory: () =>
            cfg.atmos.mock
              ? new MockProvider()
              : new AtmosProvider({
                  baseUrl: cfg.atmos.baseUrl,
                  consumerKey: cfg.atmos.consumerKey,
                  consumerSecret: cfg.atmos.consumerSecret,
                  storeId: cfg.atmos.storeId,
                }),
        },
        { provide: TG_API, useFactory: () => new Api(cfg.botToken) },
      ],
      exports: [CONFIG, SQL, PAYMENTS, TG_API],
    };
  }

  async onApplicationShutdown() {
    await this.sql.end({ timeout: 5 });
  }
}
