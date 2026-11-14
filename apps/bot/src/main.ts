import { Bot } from "grammy";
import { createDb, migrate } from "@obuna/core";
import { providerFromEnv } from "@obuna/atmos";
import { registerHandlers } from "./handlers.js";
import { runJobs } from "./jobs.js";

const env = process.env;
for (const k of ["DATABASE_URL", "BOT_TOKEN"]) if (!env[k]) throw new Error(`${k} is not set (see .env.example)`);

const sql = createDb(env.DATABASE_URL!);
await migrate(sql);

const webAppUrl = env.WEBAPP_URL ?? "http://localhost:5173";
const bot = new Bot(env.BOT_TOKEN!);
const me = await bot.api.getMe();
registerHandlers(bot, {
  sql,
  webAppUrl,
  botUsername: me.username,
  defaultMonthlyPrice: Number(env.DEFAULT_MONTHLY_PRICE ?? 5_000_000),
});
bot.catch((err) => console.error("bot error", err.error));

const ledger = { commissionBps: Number(env.COMMISSION_BPS ?? 1000), holdHours: Number(env.HOLD_HOURS ?? 24) };
const provider = providerFromEnv(env);
let running = false;
const tick = async () => {
  if (running) return;
  running = true;
  try {
    const s = await runJobs({ sql, api: bot.api, provider, ledger, webAppUrl, log: console.warn });
    if (s.renewed || s.renewFailed || s.reminded || s.expired) console.log("jobs", s);
  } catch (e) {
    console.error("jobs failed", e);
  } finally {
    running = false;
  }
};
const timer = setInterval(tick, Number(env.JOBS_INTERVAL_SEC ?? 600) * 1000);
void tick();

const stop = async () => {
  clearInterval(timer);
  await bot.stop();
  await sql.end({ timeout: 5 });
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

console.log(`@${me.username} ishga tushdi`);
await bot.start({ allowed_updates: ["message", "my_chat_member", "chat_join_request"] });
