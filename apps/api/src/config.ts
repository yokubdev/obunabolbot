import { parseCardKey } from "@obuna/core";

export interface AppConfig {
  databaseUrl: string;
  botToken: string;
  botUsername: string;
  webAppUrl: string;
  port: number;
  commissionBps: number;
  holdHours: number;
  /** Payout hold for channels younger than 14 days. */
  newChannelHoldHours: number;
  devAuth: boolean;
  platformAdminIds: number[];
  webhookSecret: string;
  jobsSecret: string;
  defaultMonthlyPrice: number;
  /** Public https address of this service, e.g. https://obuna.up.railway.app. Enables Telegram auto-setup. */
  publicUrl: string;
  /** Run renewals/reminders/expiry in-process every N seconds (0 = only via POST /internal/jobs). */
  jobsIntervalSec: number;
  /** Built Mini App + panel (apps/web/dist) to serve from the same origin; empty = API only. */
  webDist: string;
  /** AES-256 key for payout card numbers (CARD_ENC_KEY, 32 bytes base64). */
  cardKey: Buffer;
  atmos: { mock: boolean; baseUrl: string; consumerKey: string; consumerSecret: string; storeId: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} is not set (see .env.example)`);
    return v;
  };
  const production = env.NODE_ENV === "production";
  if (production && env.DEV_AUTH === "true") throw new Error("DEV_AUTH=true is not allowed in production");
  if (production && !env.CARD_ENC_KEY) throw new Error("CARD_ENC_KEY is not set (openssl rand -base64 32)");
  if (production && (!env.WEBHOOK_SECRET || !env.JOBS_SECRET)) throw new Error("WEBHOOK_SECRET and JOBS_SECRET are required");
  return {
    // Development only: a fixed all-zero key, so local withdrawals work without setup.
    cardKey: env.CARD_ENC_KEY ? parseCardKey(env.CARD_ENC_KEY) : Buffer.alloc(32),
    databaseUrl: need("DATABASE_URL"),
    botToken: need("BOT_TOKEN"),
    botUsername: env.BOT_USERNAME ?? "obuna_bot",
    webAppUrl: env.WEBAPP_URL ?? env.PUBLIC_URL ?? "http://localhost:5173",
    port: Number(env.PORT ?? env.API_PORT ?? 3000),
    commissionBps: Number(env.COMMISSION_BPS ?? 1000),
    holdHours: Number(env.HOLD_HOURS ?? 24),
    newChannelHoldHours: Number(env.NEW_CHANNEL_HOLD_HOURS ?? 168),
    devAuth: env.DEV_AUTH === "true",
    webhookSecret: env.WEBHOOK_SECRET ?? "",
    jobsSecret: env.JOBS_SECRET ?? "",
    defaultMonthlyPrice: Number(env.DEFAULT_MONTHLY_PRICE ?? 5_000_000),
    publicUrl: (env.PUBLIC_URL ?? "").replace(/\/+$/, ""),
    jobsIntervalSec: Number(env.JOBS_INTERVAL_SEC ?? 0),
    webDist: env.WEB_DIST ?? "",
    platformAdminIds: (env.PLATFORM_ADMIN_IDS ?? "").split(",").map((s) => Number(s.trim())).filter(Boolean),
    atmos: {
      mock: env.ATMOS_MOCK !== "false",
      baseUrl: env.ATMOS_BASE_URL ?? "https://apigw.atmos.uz",
      consumerKey: env.ATMOS_CONSUMER_KEY ?? "",
      consumerSecret: env.ATMOS_CONSUMER_SECRET ?? "",
      storeId: env.ATMOS_STORE_ID ?? "",
    },
  };
}
