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

const ADMIN_RIGHTS = "invite_users+restrict_members";

export function registerHandlers(bot: Bot, d: BotDeps) {
  const app = (path: string) => `${d.webAppUrl}${path}`;

  bot.command("start", async (ctx) => {
    const payload = ctx.match?.trim();
    if (payload) {
      // t.me/<bot>?start=<slug>: a subscriber came from a channel's link.
      try {
        const ch = await getChannelBySlug(d.sql, payload);
        await ctx.reply(`«${ch.title}» yopiq kanaliga obuna bo'lish uchun tarifni tanlang.`, {
          reply_markup: webAppButton("Tariflarni ko'rish", app(`/c/${ch.slug}`)),
        });
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
      "Kanal egalari uchun: botni kanalingizga admin qiling («Foydalanuvchilarni taklif qilish» va «Bloklash» huquqlari bilan). " +
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
    const missing = [!m.can_invite_users && "«Foydalanuvchilarni taklif qilish»", !m.can_restrict_members && "«Bloklash»"].filter(Boolean);
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
