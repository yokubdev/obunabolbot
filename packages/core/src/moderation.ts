import type { Sql } from "./db.js";
import { AppError, notFound } from "./errors.js";
import type { Channel } from "./types.js";

export type ReportReason = "adult" | "violence" | "fraud" | "drugs" | "copyright" | "other";
export const REPORT_REASONS: ReportReason[] = ["adult", "violence", "fraud", "drugs", "copyright", "other"];
export const REPORT_LABELS: Record<ReportReason, string> = {
  adult: "18+ yoki fahsh kontent",
  violence: "Zo'ravonlik, urush yoki terrorizm targ'iboti",
  fraud: "Firibgarlik",
  drugs: "Giyohvand moddalar yoki qimor",
  copyright: "O'g'irlangan kontent",
  other: "Boshqa",
};

/** Distinct open reports that send a channel back to review. */
export const REPORTS_FOR_REVIEW = 3;
/** New channels: money is held longer while the channel has no track record. */
export const NEW_CHANNEL_DAYS = 14;

/**
 * Word stems that put a channel in review (never block on their own: a person decides).
 * Latin and Cyrillic Uzbek, Russian and English. Matched on word starts in lowercased text.
 */
const STEMS: Record<Exclude<ReportReason, "copyright" | "other">, string[]> = {
  adult: [
    "18+", "xxx", "porn", "порн", "секс", "sex", "seks", "эрот", "erot", "интим", "intim", "nude", "nudes", "голые",
    "onlyfans", "онлифанс", "шлюх", "fahsh", "фахш", "yalang'och", "яланғоч", "hentai", "хентай", "эскорт", "escort",
  ],
  violence: [
    "джихад", "jihod", "jihad", "игил", "isis", "terror", "террор", "shahid", "шахид", "расстрел", "o'ldiramiz", "вагнер", "wagner", 
  ],
  fraud: [
    "kafolatli daromad", "гарантированный доход", "100% profit", "100% foyda", "пассивный доход",
    "kapital ikki", "удвоение",
  ],
  drugs: [
    "наркот", "narkot", "закладк", "zakladk", "мефедрон", "mefedron", "гашиш", "gashish", "kokain", "кокаин",
    "giyohvand", "гиёҳванд", "казино", "kazino", "casino", "ставки", "stavka", "1xbet", "betting",
  ],
};

/** Returns the matched categories and words; empty when the text looks clean. */
export function screenText(text: string): { reasons: ReportReason[]; words: string[] } {
  const t = ` ${text.toLowerCase().replace(/[ʻʼ`’]/g, "'").replace(/\s+/g, " ")} `;
  const reasons: ReportReason[] = [];
  const words: string[] = [];
  for (const [reason, stems] of Object.entries(STEMS) as [ReportReason, string[]][]) {
    for (const s of stems) {
      // Word start: the stem must follow a non-letter, so "sexton" matches "sex" but "essex" does not.
      const i = t.indexOf(s);
      if (i >= 0 && !/[\p{L}\p{N}]/u.test(t[i - 1] ?? " ")) {
        if (!reasons.includes(reason)) reasons.push(reason);
        words.push(s.trim());
      }
    }
  }
  return { reasons, words };
}

const channelText = (c: Pick<Channel, "title" | "description" | "perks" | "welcome_text">) =>
  [c.title, c.description, ...(c.perks ?? []), c.welcome_text].join(" \n ");

/**
 * Screens a channel's own texts and sends it to review on a match. A blocked channel stays blocked.
 * Returns the matched words when the channel was newly sent to review, so the caller can alert the platform.
 */
export async function screenChannel(sql: Sql, channelId: number): Promise<string[] | null> {
  const [c] = await sql<Channel[]>`SELECT * FROM channels WHERE id = ${channelId}`;
  if (!c || c.moderation !== "active") return null;
  const words = screenText(channelText(c)).words.filter((w) => !c.reviewed_words.includes(w));
  if (!words.length) return null;
  await sql`UPDATE channels SET moderation = 'pending', moderation_reason = ${`Avtomatik: ${words.join(", ")}`}
            WHERE id = ${channelId} AND moderation = 'active'`;
  return words;
}

export async function acceptRules(sql: Sql, ownerId: number, channelId: number): Promise<Channel> {
  const [row] = await sql<Channel[]>`
    UPDATE channels SET rules_accepted_at = COALESCE(rules_accepted_at, now())
    WHERE id = ${channelId} AND owner_id = ${ownerId} RETURNING *`;
  if (!row) throw notFound("Kanal");
  return row;
}

/** Can this channel take new money right now? */
export function assertCanSell(c: Channel): void {
  if (!c.is_active || c.moderation === "blocked") throw new AppError("channel_inactive", "Kanal hozir obuna qabul qilmayapti");
  if (!c.rules_accepted_at) throw new AppError("rules_not_accepted", "Kanal egasi hali platforma qoidalariga rozilik bermagan");
}

/** A subscriber's report. One per subscriber per channel; a repeat updates the reason. */
export async function reportChannel(
  sql: Sql, channelId: number, subscriberId: number, reason: ReportReason, note: string,
): Promise<{ openReports: number; sentToReview: boolean }> {
  if (!REPORT_REASONS.includes(reason)) throw new AppError("bad_reason", "Sababni tanlang");
  await sql`
    INSERT INTO reports (channel_id, subscriber_id, reason, note) VALUES (${channelId}, ${subscriberId}, ${reason}, ${note.slice(0, 500)})
    ON CONFLICT (channel_id, subscriber_id) DO UPDATE SET reason = EXCLUDED.reason, note = EXCLUDED.note, status = 'open', created_at = now()`;
  const { n } = (await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM reports WHERE channel_id = ${channelId} AND status = 'open'`)[0]!;
  let sentToReview = false;
  if (n >= REPORTS_FOR_REVIEW) {
    const r = await sql`UPDATE channels SET moderation = 'pending', moderation_reason = ${`${n} ta shikoyat`}
                        WHERE id = ${channelId} AND moderation = 'active' RETURNING id`;
    sentToReview = r.length > 0;
  }
  return { openReports: n, sentToReview };
}

export interface ModerationRow {
  id: number; title: string; slug: string; moderation: Channel["moderation"]; moderation_reason: string | null;
  owner_name: string; owner_tg_id: number; created_at: Date; open_reports: number;
  reports: { reason: ReportReason; note: string; created_at: Date }[];
}

/** Channels the platform should look at: in review, blocked, or with open reports. */
export const listModeration = (sql: Sql) => sql<ModerationRow[]>`
  SELECT c.id, c.title, c.slug, c.moderation, c.moderation_reason, o.name AS owner_name, o.tg_id AS owner_tg_id, c.created_at,
         (SELECT COUNT(*)::int FROM reports r WHERE r.channel_id = c.id AND r.status = 'open') AS open_reports,
         COALESCE((SELECT json_agg(json_build_object('reason', r.reason, 'note', r.note, 'created_at', r.created_at) ORDER BY r.created_at DESC)
                   FROM reports r WHERE r.channel_id = c.id AND r.status = 'open'), '[]') AS reports
  FROM channels c JOIN owners o ON o.id = c.owner_id
  WHERE c.moderation <> 'active' OR EXISTS (SELECT 1 FROM reports r WHERE r.channel_id = c.id AND r.status = 'open')
  ORDER BY (c.moderation = 'pending') DESC, c.id DESC`;

/**
 * The platform's decision. Approving resolves open reports. Blocking stops sales and auto-renew;
 * withdrawals stay frozen while any channel of the owner is in review or blocked.
 */
export async function setModeration(
  sql: Sql, channelId: number, status: "active" | "blocked", reason: string | null,
): Promise<Channel> {
  return sql.begin(async (tx) => {
    const [cur] = await tx<Channel[]>`SELECT * FROM channels WHERE id = ${channelId} FOR UPDATE`;
    if (!cur) throw notFound("Kanal");
    // Approving also approves the words that are in the texts right now, so the same texts are not flagged again.
    const reviewed = status === "active" ? screenText(channelText(cur)).words : cur.reviewed_words;
    const [c] = await tx<Channel[]>`
      UPDATE channels SET moderation = ${status}, moderation_reason = ${status === "blocked" ? reason : null},
        reviewed_words = ${tx.array(reviewed)}
      WHERE id = ${channelId} RETURNING *`;
    if (!c) throw notFound("Kanal");
    await tx`UPDATE reports SET status = 'resolved' WHERE channel_id = ${channelId} AND status = 'open'`;
    if (status === "blocked") await tx`UPDATE subscriptions SET auto_renew = false WHERE channel_id = ${channelId}`;
    return c;
  });
}

/** Payouts wait while any of the owner's channels is under review or blocked. */
export async function assertPayoutsAllowed(sql: Sql, ownerId: number): Promise<void> {
  const [c] = await sql<{ title: string; moderation: string }[]>`
    SELECT title, moderation FROM channels WHERE owner_id = ${ownerId} AND moderation <> 'active' LIMIT 1`;
  if (c)
    throw new AppError("payouts_frozen",
      c.moderation === "blocked"
        ? `«${c.title}» bloklangan, pul yechish to'xtatilgan. Savol bo'lsa, qo'llab-quvvatlashga yozing.`
        : `«${c.title}» tekshiruvda, tekshiruv tugaguncha pul yechib bo'lmaydi.`, 403);
}
