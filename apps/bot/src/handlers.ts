import { Bot, InlineKeyboard } from "grammy";
import {
  createDefaultPlans, deactivateChannelByChatId, getChannelBySlug, hasActiveAccess, listPlans, registerChannel,
  upsertOwner, AppError, type Sql,
} from "@obuna/core";
import { webAppButton } from "@obuna/telegram";

export interface BotDeps {
  sql: Sql;
  webAppUrl: string;
  botUsername: string;
  /** Monthly price (tiyin) for the starter plans of a newly connected channel. */
  defaultMonthlyPrice: number;
}

// Channels have no "ban users" toggle in Telegram's admin UI (can_restrict_members stays false even with
// every right granted), so only the invite right is required. Removing expired members is best effort.
const ADMIN_RIGHTS = "invite_users";

/** Rights the bot must have in a channel, as the Uzbek labels the owner sees in Telegram. */
export function missingChannelRights(m: { can_invite_users?: boolean }): string[] {
  return m.can_invite_users ? [] : ["«Foydalanuvchilarni taklif qilish» (Add subscribers)"];
}

/** "kanal-slug_PROMO" → ["kanal-slug", "PROMO"]. */
export function splitStartPayload(payload: string): [string, string | null] {
  const i = payload.indexOf("_");
  if (i < 0) return [payload, null];
  const promo = payload.slice(i + 1).toUpperCase();
  return [payload.slice(0, i), /^[A-Z0-9_]{3,20}$/.test(promo) ? promo : null];
}

export function registerHandlers(bot: Bot, d: BotDeps) {
  const app = (path: string) => `${d.webAppUrl}${path}`;

  bot.command("start", async (ctx) => {
    const payload = ctx.match?.trim();
    if (payload) {
      // t.me/<bot>?start=<slug> or <slug>_<PROMO>: a subscriber came from a channel's link.
      // Slugs never contain "_", so everything after the first one is a promo code.
      const [slug, promo] = splitStartPayload(payload);
      try {
        const ch = await getChannelBySlug(d.sql, slug);
        const path = promo ? `/c/${ch.slug}?promo=${encodeURIComponent(promo)}` : `/c/${ch.slug}`;
        await ctx.reply(
          promo
            ? `«${ch.title}» yopiq kanaliga obuna bo'lish uchun tarifni tanlang. Promo-kod: ${promo}`
            : `«${ch.title}» yopiq kanaliga obuna bo'lish uchun tarifni tanlang.`,
          { reply_markup: webAppButton("Tariflarni ko'rish", app(path)) },
        );
        return;
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
      }
    }
    await ctx.reply(
      "Assalomu alaykum! Bu bot orqali yopiq Telegram kanallarga pullik obuna bo'lasiz yoki o'z kanalingizga obuna sotasiz.",
      {
        reply_markup: new InlineKeyboard()
          .webApp("Mening obunalarim", app("/my"))
          .row()
          .url("Kanalimni ulash", `https://t.me/${d.botUsername}?startchannel&admin=${ADMIN_RIGHTS}`)
          .row()
          .webApp("Kanal egasi paneli", app("/owner")),
      },
    );
  });

  bot.command("obunam", (ctx) => ctx.reply("Obunalaringiz:", { reply_markup: webAppButton("Ochish", app("/my")) }));
  bot.command("panel", (ctx) => ctx.reply("Kanal egasi paneli:", { reply_markup: webAppButton("Ochish", app("/owner")) }));
  bot.command("yordam", (ctx) =>
    ctx.reply(
      "Kanal egalari uchun: botni kanalingizga admin qiling («Foydalanuvchilarni taklif qilish» huquqi bilan). " +
        "Kassa avtomatik ochiladi, tariflarni paneldan sozlaysiz.\n\nObunachilar uchun: /obunam",
    ),
  );

  // The bot was added to / removed from a channel. Whoever promoted it becomes the owner.
  bot.on("my_chat_member", async (ctx) => {
    const chat = ctx.chat;
    if (chat.type !== "channel") return;
    const m = ctx.myChatMember.new_chat_member;
    if (m.status !== "administrator") {
      await deactivateChannelByChatId(d.sql, chat.id);
      return;
    }
    const from = ctx.myChatMember.from;
    // Only the channel's creator may connect it: otherwise any admin could sell access to
    // someone else's channel and collect the money into their own cashbox.
    const promoter = await ctx.api.getChatMember(chat.id, from.id).catch(() => null);
    if (promoter?.status !== "creator") {
      await ctx.api
        .sendMessage(from.id, `«${chat.title}» kanalini faqat kanal egasi (yaratuvchisi) ulay oladi. Botni egasi admin qilsin.`)
        .catch(() => {});
      return;
    }
    const missing = missingChannelRights(m);
    if (missing.length) {
      await ctx.api.sendMessage(from.id, `«${chat.title}» kanalida botga ${missing.join(" va ")} huquqini bering.`).catch(() => {});
      return;
    }
    const owner = await upsertOwner(d.sql, from);
    try {
      const channel = await registerChannel(d.sql, owner.id, { id: chat.id, title: chat.title ?? "Kanal" });
      if ((await listPlans(d.sql, channel.id, false)).length === 0)
        await createDefaultPlans(d.sql, owner.id, channel.id, d.defaultMonthlyPrice);
      await ctx.api.sendMessage(
        from.id,
        `✅ «${channel.title}» ulandi va shaxsiy kassangiz ochildi.\n\n` +
          `Boshlang'ich tariflar qo'shildi (1, 3 va 12 oy), narxlarni paneldan o'zgartiring.\n` +
          `Obunachilar uchun havola: https://t.me/${d.botUsername}?start=${channel.slug}`,
        { reply_markup: webAppButton("Panelni ochish", app("/owner")) },
      );
    } catch (e) {
      if (e instanceof AppError) await ctx.api.sendMessage(from.id, e.message).catch(() => {});
      else throw e;
    }
  });

  // Channels using "request to join" links: approve only paying members.
  bot.on("chat_join_request", async (ctx) => {
    const req = ctx.chatJoinRequest;
    if (await hasActiveAccess(d.sql, req.from.id, req.chat.id)) await ctx.approveChatJoinRequest(req.from.id);
    else await ctx.declineChatJoinRequest(req.from.id);
  });
}
