import { InlineKeyboard, type Api } from "grammy";
import { formatSom } from "@obuna/core";

const fmtDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

export const webAppButton = (text: string, url: string) => new InlineKeyboard().webApp(text, url);

/**
 * Sends the subscriber a personal invite link that creates a join request (valid 24h).
 * The bot approves the request only for a user with an active subscription, so a forwarded
 * link is useless to anyone else. The user is unbanned first in case an earlier subscription ended with a ban.
 */
export async function grantAccess(
  api: Api,
  a: { tgChatId: number; tgUserId: number; channelTitle: string; expiresAt: Date; amount: number },
): Promise<void> {
  await api.unbanChatMember(a.tgChatId, a.tgUserId, { only_if_banned: true }).catch(() => {});
  const link = await api.createChatInviteLink(a.tgChatId, {
    creates_join_request: true,
    expire_date: Math.floor(Date.now() / 1000) + 24 * 3600,
    name: `obuna-${a.tgUserId}`.slice(0, 32),
  });
  await api.sendMessage(
    a.tgUserId,
    `✅ To'lov qabul qilindi: ${formatSom(a.amount)}\n\n` +
      `«${a.channelTitle}» obunasi ${fmtDate(a.expiresAt)} gacha faol.\n` +
      `Havolani bosing va «Qo'shilish so'rovi»ni yuboring: bot uni darhol tasdiqlaydi. Havola faqat siz uchun ishlaydi.`,
    { reply_markup: new InlineKeyboard().url("Kanalga kirish", link.invite_link) },
  );
}

export async function notifyRenewed(api: Api, a: { tgUserId: number; channelTitle: string; expiresAt: Date; amount: number }) {
  await api.sendMessage(
    a.tgUserId,
    `🔁 «${a.channelTitle}» obunasi uzaytirildi: ${formatSom(a.amount)}. Yangi muddat: ${fmtDate(a.expiresAt)}.`,
  );
}

export async function notifyOwnerSale(
  api: Api,
  a: { ownerTgId: number; subscriberName: string; planTitle: string; amount: number; credited: number },
) {
  await api.sendMessage(
    a.ownerTgId,
    `💰 Yangi to'lov: ${a.subscriberName} · ${a.planTitle} · ${formatSom(a.amount)}\n` +
      `Komissiya ushlanib, kassangizga ${formatSom(a.credited)} qo'shildi.`,
  );
}

export async function sendReminder(
  api: Api,
  a: { tgUserId: number; channelTitle: string; expiresAt: Date; autoRenew: boolean; price: number; renewUrl: string },
) {
  const text = a.autoRenew
    ? `🔔 «${a.channelTitle}» obunasi ${fmtDate(a.expiresAt)} da tugaydi. Shu kuni kartangizdan ${formatSom(a.price)} avtomatik yechiladi.`
    : `🔔 «${a.channelTitle}» obunasi ${fmtDate(a.expiresAt)} da tugaydi. Kanalda qolish uchun obunani uzaytiring.`;
  await api.sendMessage(a.tgUserId, text, { reply_markup: webAppButton("Uzaytirish", a.renewUrl) });
}

/** Removes the member and immediately unbans, so they can rejoin after paying again. */
export async function revokeAccess(
  api: Api,
  a: { tgChatId: number; tgUserId: number; channelTitle: string; renewUrl: string },
) {
  await api.banChatMember(a.tgChatId, a.tgUserId).catch(() => {});
  await api.unbanChatMember(a.tgChatId, a.tgUserId, { only_if_banned: true }).catch(() => {});
  await api
    .sendMessage(
      a.tgUserId,
      `«${a.channelTitle}» obunasi tugadi va kanalga kirish yopildi. Qayta obuna bo'lsangiz, darhol yangi havola beramiz.`,
      { reply_markup: webAppButton("Qayta obuna bo'lish", a.renewUrl) },
    )
    .catch(() => {});
}
