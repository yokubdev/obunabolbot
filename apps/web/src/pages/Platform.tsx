import { api } from "../lib/api";
import { date, som } from "../lib/format";
import { useState } from "react";
import type { LegalStatus, ModerationRow, Withdrawal } from "../lib/types";
import { useApi } from "../lib/useApi";
import { Badge, Button, Card, ErrorBox, Spinner } from "../components/ui";

const REASON: Record<string, string> = {
  adult: "18+", violence: "Zo'ravonlik/urush", fraud: "Firibgarlik", drugs: "Giyohvand/qimor", copyright: "O'g'irlangan", other: "Boshqa",
};

/** Channels in review, blocked or reported: the operator approves or blocks with a reason. */
function Moderation() {
  const { data, error, loading, reload } = useApi<ModerationRow[]>("/api/platform/moderation");
  const [reason, setReason] = useState<Record<number, string>>({});
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const decide = async (id: number, status: "active" | "blocked") => {
    await api(`/api/platform/channels/${id}/moderation`, { body: status === "blocked" ? { status, reason: reason[id] } : { status } });
    void reload();
  };
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-bold tracking-tight">Moderatsiya</h2>
      {data!.length === 0 && <Card className="p-6 text-center text-sm text-muted">Tekshiruvda kanal yoki ochiq shikoyat yo'q.</Card>}
      {data!.map((c) => (
        <Card key={c.id} className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/c/${c.slug}`} className="font-semibold underline">{c.title}</a>
            <Badge tone={c.moderation === "active" ? "neutral" : "warn"}>{c.moderation === "pending" ? "Tekshiruvda" : c.moderation === "blocked" ? "Bloklangan" : "Faol"}</Badge>
            <span className="text-xs text-muted">{c.owner_name} · tg {c.owner_tg_id} · {date(c.created_at)}</span>
          </div>
          {c.moderation_reason && <span className="text-sm text-muted">Sabab: {c.moderation_reason}</span>}
          {c.reports.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {c.reports.map((r, i) => <li key={i}>🚩 {REASON[r.reason] ?? r.reason}{r.note ? `: ${r.note}` : ""}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <input placeholder="Bloklash sababi" value={reason[c.id] ?? ""} onChange={(e) => setReason({ ...reason, [c.id]: e.target.value })}
              className="h-11 min-w-0 flex-1 rounded-xl bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-accent" />
            <Button variant="outline" disabled={(reason[c.id] ?? "").trim().length < 3} onClick={() => decide(c.id, "blocked")}>Bloklash</Button>
            <Button onClick={() => decide(c.id, "active")}>{c.moderation === "blocked" ? "Blokdan chiqarish" : "Tasdiqlash"}</Button>
          </div>
        </Card>
      ))}
    </section>
  );
}

type Row = Withdrawal & {
  owner_name: string; card_number: string; owner_phone: string | null; legal_status: LegalStatus | null;
  business_tin: string | null; business_name: string | null; kyc_status: string; kyc_full_name: string | null;
};
const LEGAL: Record<LegalStatus, string> = { self_employed: "o'zini o'zi band", business: "YaTT/MChJ", individual: "maqomsiz" };

interface KycRow { ownerId: number; name: string; username: string | null; tgId: number; phone: string | null; legalStatus: LegalStatus | null; fullName: string; pinfl: string; submittedAt: string }

/** Identity checks (instead of MyID): compare the full name and PINFL with the passport photo sent to support. */
function KycQueue() {
  const { data, reload } = useApi<KycRow[]>("/api/platform/kyc");
  if (!data?.length) return null;
  const decide = async (id: number, status: "verified" | "rejected") => {
    const note = status === "rejected" ? prompt("Rad etish sababi") : null;
    if (status === "rejected" && !note) return;
    await api(`/api/platform/owners/${id}/kyc`, { body: status === "rejected" ? { status, note } : { status } });
    void reload();
  };
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold tracking-tight">Shaxsni tekshirish</h1>
      {data.map((k) => (
        <Card key={k.ownerId} className="flex flex-wrap items-center gap-3 p-4">
          <div className="flex flex-1 flex-col">
            <span className="font-semibold">{k.fullName}</span>
            <span className="font-mono text-sm">JSHSHIR {k.pinfl}</span>
            <span className="text-xs text-muted">
              {k.name}{k.username ? ` @${k.username}` : ""} · tg {k.tgId} · {k.phone ?? "telefon yo'q"}{k.legalStatus ? ` · ${LEGAL[k.legalStatus]}` : ""} · {date(k.submittedAt)}
            </span>
          </div>
          <Button variant="outline" onClick={() => decide(k.ownerId, "rejected")}>Rad etish</Button>
          <Button onClick={() => decide(k.ownerId, "verified")}>Tasdiqlash</Button>
        </Card>
      ))}
    </section>
  );
}

/** Platform operator: manual payouts until ATMOS card payouts are switched on. */
export default function Platform() {
  const { data, error, loading, reload } = useApi<Row[]>("/api/platform/withdrawals");
  if (loading && !data) return <Spinner />;
  if (error) return <div className="p-4"><ErrorBox error={error} onRetry={reload} /></div>;
  const act = async (id: number, kind: "paid" | "reject") => {
    const note = kind === "reject" ? prompt("Sabab") : null;
    if (kind === "reject" && !note) return;
    await api(`/api/platform/withdrawals/${id}/${kind}`, { body: kind === "reject" ? { note } : {} });
    void reload();
  };
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 md:p-8">
      <KycQueue />
      <Moderation />
      <h1 className="text-2xl font-bold tracking-tight">Yechish so'rovlari</h1>
      {data!.length === 0 && <Card className="p-8 text-center text-sm text-muted">Kutilayotgan so'rov yo'q.</Card>}
      {data!.map((w) => (
        <Card key={w.id} className="flex flex-wrap items-center gap-3 p-4">
          <div className="flex flex-1 flex-col">
            <span className="font-semibold">{som(w.amount)} · {w.owner_name}</span>
            <span className="font-mono text-sm">{w.card_number.replace(/(\d{4})(?=\d)/g, "$1 ")}</span>
            <span className="text-xs text-muted">
              {date(w.created_at)}{w.payout_date ? ` · to'lov kuni ${date(w.payout_date)}` : ""} · {w.owner_phone ?? "telefon yo'q"}
              {w.legal_status ? ` · ${LEGAL[w.legal_status]}` : ""}{w.business_name ? ` (${w.business_name}, STIR ${w.business_tin})` : ""}
              {w.kyc_status === "verified" ? ` · ✅ ${w.kyc_full_name}` : ""}
            </span>
          </div>
          <Button variant="outline" onClick={() => act(w.id, "reject")}>Rad etish</Button>
          <Button onClick={() => act(w.id, "paid")}>O'tkazildi</Button>
        </Card>
      ))}
    </main>
  );
}
