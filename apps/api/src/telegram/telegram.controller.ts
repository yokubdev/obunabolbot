import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  Res,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Bot, webhookCallback } from "grammy";
import type { Request, Response } from "express";
import type { Sql } from "@obuna/core";
import type { CardPaymentProvider } from "@obuna/atmos";
import { registerHandlers, runJobs } from "@obuna/bot";
import { CONFIG, PAYMENTS, SQL } from "../tokens.js";
import type { AppConfig } from "../config.js";

/**
 * Webhook mode: Telegram pushes updates to /telegram/webhook, so the bot lives inside the API and
 * one service (Railway, Render, a VPS) runs everything. Background jobs run on an in-process timer
 * (JOBS_INTERVAL_SEC) and/or via POST /internal/jobs from an external cron.
 * Long polling (apps/bot) is only for local development.
 */
@Controller()
export class TelegramController implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("Telegram");
  private bot!: Bot;
  private handle!: (req: Request, res: Response) => Promise<unknown>;
  private timer?: NodeJS.Timeout;
  private jobsRunning = false;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(SQL) private readonly sql: Sql,
    @Inject(PAYMENTS) private readonly provider: CardPaymentProvider,
  ) {}

  onModuleInit() {
    this.bot = new Bot(this.cfg.botToken);
    registerHandlers(this.bot, {
      sql: this.sql,
      webAppUrl: this.cfg.webAppUrl,
      botUsername: this.cfg.botUsername,
      defaultMonthlyPrice: this.cfg.defaultMonthlyPrice,
    });
    this.bot.catch((e) => this.log.error(e.error));
    this.handle = webhookCallback(this.bot, "express", { secretToken: this.cfg.webhookSecret || undefined });
  }

  /** With PUBLIC_URL set, points Telegram at this service on every boot: webhook, menu button, commands. */
  onApplicationBootstrap() {
    if (this.cfg.jobsIntervalSec > 0) {
      this.timer = setInterval(() => void this.tick(), this.cfg.jobsIntervalSec * 1000);
    }
    // Not awaited: a slow Telegram API must not hold back the HTTP server (and the health check).
    void this.setupTelegram();
  }

  private async setupTelegram() {
    if (!this.cfg.publicUrl) return;
    if (!this.cfg.webhookSecret) {
      this.log.warn("PUBLIC_URL is set but WEBHOOK_SECRET is empty: webhook not registered");
      return;
    }
    try {
      const api = this.bot.api;
      await api.setWebhook(`${this.cfg.publicUrl}/telegram/webhook`, {
        secret_token: this.cfg.webhookSecret,
        allowed_updates: ["message", "my_chat_member", "chat_join_request"],
      });
      await api.setChatMenuButton({
        menu_button: { type: "web_app", text: "Obunalarim", web_app: { url: `${this.cfg.webAppUrl}/my` } },
      });
      await api.setMyCommands([
        { command: "start", description: "Boshlash" },
        { command: "obunam", description: "Mening obunalarim" },
        { command: "panel", description: "Kanal egasi paneli" },
        { command: "yordam", description: "Yordam" },
      ]);
      await api.setMyShortDescription(
        "Yopiq Telegram kanallarga obuna: Uzcard/Humo bilan to'lov, avtomatik kirish havolasi.",
      );
      await api.setMyDescription(
        "Obuna boti yopiq kanallarga pullik kirishni boshqaradi.\n\n" +
          "Obunachilar: tarif tanlang, Uzcard yoki Humo bilan to'lang, kanalga shaxsiy havola oling.\n" +
          "Kanal egalari: botni kanalingizga admin qiling, narxlarni belgilang, daromad virtual kassangizga tushadi.",
      );
      this.log.log(`Telegram webhook -> ${this.cfg.publicUrl}/telegram/webhook`);
    } catch (e) {
      this.log.error(`Telegram setup failed: ${(e as Error).message}`);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.jobsRunning) return;
    this.jobsRunning = true;
    try {
      const s = await this.runJobs();
      if (s.renewed || s.renewFailed || s.reminded || s.expired) this.log.log(`jobs ${JSON.stringify(s)}`);
    } catch (e) {
      this.log.error(`jobs failed: ${(e as Error).message}`);
    } finally {
      this.jobsRunning = false;
    }
  }

  private runJobs() {
    return runJobs({
      sql: this.sql,
      api: this.bot.api,
      provider: this.provider,
      ledger: { commissionBps: this.cfg.commissionBps, holdHours: this.cfg.holdHours },
      webAppUrl: this.cfg.webAppUrl,
      log: (m) => this.log.warn(m),
    });
  }

  @Get("healthz")
  async health() {
    await this.sql`SELECT 1`;
    return { ok: true };
  }

  @Post("telegram/webhook")
  async webhook(@Req() req: Request, @Res() res: Response) {
    // Checked here, before grammY's lazy getMe(), so forged requests never reach Telegram.
    if (!this.cfg.webhookSecret || req.header("x-telegram-bot-api-secret-token") !== this.cfg.webhookSecret) {
      res.status(401).json({ error: { code: "unauthorized", message: "secret token is wrong" } });
      return;
    }
    await this.handle(req, res);
  }

  @Post("internal/jobs")
  @HttpCode(200)
  async jobs(@Headers("x-jobs-secret") secret: string | undefined) {
    if (!this.cfg.jobsSecret || secret !== this.cfg.jobsSecret) throw new ForbiddenException();
    return this.runJobs();
  }
}
