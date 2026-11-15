import { Bot, InlineKeyboard } from "grammy";
import {
  acceptRules, getOwnerByTgId, screenChannel, createDefaultPlans, deactivateChannelByChatId, getChannelBySlug, hasActiveAccess, listPlans, registerChannel,
  upsertOwner, AppError, type Sql,
} from "@obuna/core";
import { webAppButton } from "@obuna/telegram";

export interface BotDeps {
  sql: Sql;
  webAppUrl: string;
  botUsername: string;
  /** Monthly price (tiyin) for the starter plans of a newly connected channel. */
  defaultMonthlyPrice: number;
  /** Telegram ids of platform operators: moderation alerts and the support inbox. */
  platformAdminIds?: number[];
}

/** The rules an owner accepts before selling. Kept short; the full text is on /rules in the Mini App. */
export const RULES_SUMMARY =
  "Obuna orqali quyidagilarni sotish taqiqlanadi:\n" +
  "• 18+ va fahsh kontent\n" +
  "• zo'ravonlik, urush, terrorizm va ekstremizm targ'iboti, millatlararo adovat\n" +
  "• firibgarlik: «kafolatli daromad», soxta kurslar, piramidalar\n" +
  "• giyohvand moddalar, qimor va tikish\n" +
  "• o'zganing kontenti (o'g'irlangan kurslar, kinolar)\n" +
  "• O'zbekiston qonunlari taqiqlagan boshqa kontent\n\n" +
  "Qoidabuzarlikda platforma kanalni bloklaydi, pul yechishni to'xtatadi va obunachilarga pulni qaytarishi mumkin.";

// Channels have no "ban users" toggle in Telegram's admin UI (can_restrict_members stays false even with
// every right granted), so only the invite right is required. Removing expired members is best effort.
const ADMIN_RIGHTS = "invite_users";
const GROUP_ADMIN_RIGHTS = "invite_users+restrict_members";

/** Rights the bot must have in a channel, as the Uzbek labels the owner sees in Telegram. */
export function missingChannelRights(m: { can_invite_users?: boolean }): string[] {
  return m.can_invite_users ? [] : ["«Foydalanuvchilarni taklif qilish» (Add subscribers)"];
}

/** Groups do have a ban toggle, and it is needed there: members can stay in a group indefinitely otherwise. */
export function missingGroupRights(m: { can_invite_users?: boolean; can_restrict_members?: boolean }): string[] {
  const out: string[] = [];
  if (!m.can_invite_users) out.push("«Havola orqali taklif qilish» (Invite users via link)");
  if (!m.can_restrict_members) out.push("«Foydalanuvchilarni bloklash» (Ban users)");
  return out;
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
  const admins = d.platformAdminIds ?? [];
  const tellAdmins = (text: string, extra?: Parameters<Bot["api"]["sendMessage"]>[2]) =>
    Promise.allSettled(admins.map((id) => bot.api.sendMessage(id, text, extra)));

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
          .url("Guruhimni ulash", `https://t.me/${d.botUsername}?startgroup&admin=${GROUP_ADMIN_RIGHTS}`)
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
        "Guruh uchun «Havola orqali taklif qilish» va «Bloklash» huquqlari kerak. " +
        "Savol yoki shikoyat bo'lsa, shu yerga oddiy xabar yozing, qo'llab-quvvatlashga boradi. " +
        "Kassa avtomatik ochiladi, tariflarni paneldan sozlaysiz.\n\nObunachilar uchun: /obunam",
    ),
  );

  // The bot was added to / removed from a channel. Whoever promoted it becomes the owner.
  bot.on("my_chat_member", async (ctx) => {
    const chat = ctx.chat;
    if (chat.type === "private") return;
    const m = ctx.myChatMember.new_chat_member;
    if (chat.type === "group") {
      // Basic groups have no join-request links; Telegram upgrades a group to a supergroup when, for example,
      // its history is made visible to new members.
      if (m.status === "administrator")
        await ctx.api
          .sendMessage(ctx.myChatMember.from.id,
            `«${chat.title}» oddiy guruh. Uni ulash uchun guruh sozlamalarida «Yangi a'zolar uchun chat tarixi»ni «Ko'rinadi» qiling (guruh supergroupga aylanadi), keyin botni qayta admin qiling.`)
          .catch(() => {});
      return;
    }
    const isGroup = chat.type === "supergroup";
    const kind = isGroup ? "guruh" : "kanal";
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
        .sendMessage(from.id, `«${chat.title}» ${kind}ini faqat ${kind} egasi (yaratuvchisi) ulay oladi. Botni egasi admin qilsin.`)
        .catch(() => {});
      return;
    }
    const missing = isGroup ? missingGroupRights(m) : missingChannelRights(m);
    if (missing.length) {
      await ctx.api.sendMessage(from.id, `«${chat.title}» ${kind}ida botga ${missing.join(" va ")} huquqini bering.`).catch(() => {});
      return;
    }
    const owner = await upsertOwner(d.sql, from);
    try {
      const channel = await registerChannel(d.sql, owner.id, {
        id: chat.id, title: chat.title ?? "Kanal", type: isGroup ? "supergroup" : "channel",
      });
      if ((await listPlans(d.sql, channel.id, false)).length === 0)
        await createDefaultPlans(d.sql, owner.id, channel.id, d.defaultMonthlyPrice);
      await ctx.api.sendMessage(
        from.id,
        `✅ «${channel.title}» ulandi va shaxsiy kassangiz ochildi.\n\n` +
          `Boshlang'ich tariflar qo'shildi (1, 3 va 12 oy), narxlarni paneldan o'zgartiring.\n` +
          `Obunachilar uchun havola: https://t.me/${d.botUsername}?startapp=${channel.slug}`,
        { reply_markup: webAppButton("Panelni ochish", app("/owner")) },
      );
      if (!channel.rules_accepted_at)
        await ctx.api.sendMessage(from.id, `Obuna sotishni boshlash uchun platforma qoidalariga rozilik bering.\n\n${RULES_SUMMARY}`, {
          reply_markup: new InlineKeyboard().text("✅ Qoidalarga roziman", `rules:${channel.id}`).row().webApp("To'liq qoidalar", app("/rules")),
        });
      const words = await screenChannel(d.sql, channel.id);
      if (words) await tellAdmins(`🔎 Yangi «${channel.title}» tekshiruvga tushdi (${words.join(", ")}). Platforma panelida ko'rib chiqing.`);
    } catch (e) {
      if (e instanceof AppError) await ctx.api.sendMessage(from.id, e.message).catch(() => {});
      else throw e;
    }
  });

  // The owner accepts the platform rules from the button under the connect message.
  bot.callbackQuery(/^rules:(\d+)$/, async (ctx) => {
    const owner = await getOwnerByTgId(d.sql, ctx.from.id);
    if (!owner) return ctx.answerCallbackQuery({ text: "Kanal topilmadi" });
    try {
      const ch = await acceptRules(d.sql, owner.id, Number(ctx.match[1]));
      await ctx.answerCallbackQuery({ text: "Rahmat! Obuna sotish yoqildi." });
      await ctx.editMessageText(`✅ «${ch.title}» uchun platforma qoidalariga rozilik berdingiz. Obuna sotish yoqildi.`).catch(() => {});
    } catch {
      await ctx.answerCallbackQuery({ text: "Kanal topilmadi" });
    }
  });

  // Support inbox: a private text that is not a command goes to the platform operators.
  // An operator answers by replying to that message; the bot sends the answer back.
  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat.type !== "private" || ctx.message.text.startsWith("/")) return next();
    const reply = ctx.message.reply_to_message;
    if (admins.includes(ctx.from.id) && reply?.from?.id === ctx.me.id) {
      const to = reply.text?.match(/\(id (\d+)\)/)?.[1];
      if (to) {
        await ctx.api.sendMessage(Number(to), `💬 Qo'llab-quvvatlash: ${ctx.message.text}`);
        await ctx.reply("Yuborildi.");
        return;
      }
    }
    if (!admins.length) return next();
    const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ");
    const handle = ctx.from.username ? ` @${ctx.from.username}` : "";
    await tellAdmins(`💬 ${name}${handle} (id ${ctx.from.id}):\n${ctx.message.text.slice(0, 3500)}\n\nJavob uchun shu xabarga reply qiling.`);
    await ctx.reply("Xabaringiz qo'llab-quvvatlashga yuborildi. Javob shu yerga keladi.");
  });

  // Channels using "request to join" links: approve only paying members.
  bot.on("chat_join_request", async (ctx) => {
    const req = ctx.chatJoinRequest;
    if (await hasActiveAccess(d.sql, req.from.id, req.chat.id)) await ctx.approveChatJoinRequest(req.from.id);
    else await ctx.declineChatJoinRequest(req.from.id);
  });
}
