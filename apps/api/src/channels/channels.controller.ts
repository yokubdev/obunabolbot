import { Body, Controller, Get, Inject, Param, Post, Res, UseGuards } from "@nestjs/common";
import { z } from "zod";
import type { Response } from "express";
import type { Api } from "grammy";
import {
  getChannelBySlug, listPlans, REPORT_LABELS, REPORT_REASONS, reportChannel, upsertSubscriber, type Sql, type TgUser,
} from "@obuna/core";
import { CurrentUser, TelegramAuthGuard } from "../common/auth.js";
import { notifyAdmins } from "../common/notify.js";

const ReportBody = z.object({
  reason: z.enum(REPORT_REASONS as [string, ...string[]]),
  note: z.string().trim().max(500).default(""),
}).strict();
import { CONFIG, SQL, TG_API } from "../tokens.js";
import type { AppConfig } from "../config.js";

type Photo = { body: Buffer; type: string } | null;
const PHOTO_TTL_MS = 6 * 3600_000;

/** Public channel page: what a subscriber sees before paying. */
@Controller("api/channels")
export class ChannelsController {
  /** Channel avatars by Telegram chat id, so Telegram is asked at most every few hours. */
  private readonly photos = new Map<number, { at: number; photo: Photo }>();

  constructor(
    @Inject(SQL) private readonly sql: Sql,
    @Inject(TG_API) private readonly tg: Api,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Get(":slug")
  async get(@Param("slug") slug: string) {
    const ch = await getChannelBySlug(this.sql, slug);
    const { count } = (await this.sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM subscriptions WHERE channel_id = ${ch.id} AND status = 'active'`)[0]!;
    const plans = await listPlans(this.sql, ch.id);
    return {
      channel: {
        id: ch.id, title: ch.title, slug: ch.slug, description: ch.description, subscribers: count,
        perks: ch.perks, trialDays: ch.trial_days, chatType: ch.chat_type, photoUrl: `/api/channels/${ch.slug}/photo`,
        canSell: ch.moderation !== "blocked" && !!ch.rules_accepted_at,
      },
      plans: plans.map((p) => ({ id: p.id, title: p.title, durationDays: p.duration_days, price: p.price })),
    };
  }

  /** A subscriber reports the channel; three open reports send it back to review. */
  @Post(":slug/report")
  @UseGuards(TelegramAuthGuard)
  async report(@Param("slug") slug: string, @CurrentUser() user: TgUser, @Body() body: unknown) {
    const b = ReportBody.parse(body);
    const ch = await getChannelBySlug(this.sql, slug);
    const sub = await upsertSubscriber(this.sql, user);
    const r = await reportChannel(this.sql, ch.id, sub.id, b.reason as keyof typeof REPORT_LABELS, b.note);
    await notifyAdmins(this.tg, this.cfg.platformAdminIds,
      `🚩 «${ch.title}» ustidan shikoyat: ${REPORT_LABELS[b.reason as keyof typeof REPORT_LABELS]}` +
        (b.note ? `\n«${b.note}»` : "") +
        `\nOchiq shikoyatlar: ${r.openReports}${r.sentToReview ? ". Kanal tekshiruvga tushdi." : ""}`);
    return { ok: true };
  }

  /** The channel's Telegram avatar, proxied so the bot token never reaches the browser. */
  @Get(":slug/photo")
  async photo(@Param("slug") slug: string, @Res() res: Response) {
    const ch = await getChannelBySlug(this.sql, slug);
    let hit = this.photos.get(ch.tg_chat_id);
    if (!hit || Date.now() - hit.at > PHOTO_TTL_MS) {
      hit = { at: Date.now(), photo: await this.fetchPhoto(ch.tg_chat_id).catch(() => null) };
      if (this.photos.size > 1000) this.photos.clear();
      this.photos.set(ch.tg_chat_id, hit);
    }
    if (!hit.photo) return res.status(404).json({ error: { code: "not_found", message: "Rasm yo'q" } });
    res.setHeader("Content-Type", hit.photo.type);
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(hit.photo.body);
  }

  private async fetchPhoto(chatId: number): Promise<Photo> {
    const chat = await this.tg.getChat(chatId);
    const fileId = chat.photo?.big_file_id;
    if (!fileId) return null;
    const file = await this.tg.getFile(fileId);
    if (!file.file_path) return null;
    const r = await fetch(`https://api.telegram.org/file/bot${this.cfg.botToken}/${file.file_path}`);
    if (!r.ok) return null;
    const body = Buffer.from(await r.arrayBuffer());
    if (body.length > 2_000_000) return null;
    return { body, type: "image/jpeg" };
  }
}
