export interface AppConfig {
  databaseUrl: string;
  botToken: string;
  botUsername: string;
  webAppUrl: string;
  port: number;
  commissionBps: number;
  holdHours: number;
  devAuth: boolean;
  platformAdminIds: number[];
  atmos: { mock: boolean; baseUrl: string; consumerKey: string; consumerSecret: string; storeId: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} is not set (see .env.example)`);
    return v;
  };
  return {
    databaseUrl: need("DATABASE_URL"),
    botToken: need("BOT_TOKEN"),
    botUsername: env.BOT_USERNAME ?? "obuna_bot",
    webAppUrl: env.WEBAPP_URL ?? "http://localhost:5173",
    port: Number(env.API_PORT ?? 3000),
    commissionBps: Number(env.COMMISSION_BPS ?? 1000),
    holdHours: Number(env.HOLD_HOURS ?? 24),
    devAuth: env.DEV_AUTH === "true",
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
