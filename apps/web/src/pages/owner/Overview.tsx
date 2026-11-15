import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { MONTHS, som, somShort } from "../../lib/format";
import { Badge, BarChart, Button, Card, Field, Icon, SectionTitle, Sheet, Stat, Avatar } from "../../components/ui";
import { api } from "../../lib/api";
import type { OwnerChannel } from "../../lib/types";
import type { OwnerCtx } from "./OwnerLayout";

export default function Overview() {
  const { overview: o, reload } = useOutletContext<OwnerCtx>();
  const [copied, setCopied] = useState<number | null>(null);
  const [editing, setEditing] = useState<OwnerChannel | null>(null);
  const s = o.stats;
  const growth = s.revenuePrevMonth ? Math.round(((s.revenueThisMonth - s.revenuePrevMonth) / s.revenuePrevMonth) * 100) : null;
  const churn = s.activeSubscribers + s.churnedThisMonth ? (s.churnedThisMonth / (s.activeSubscribers + s.churnedThisMonth)) * 100 : 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Xush kelibsiz,</p>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{o.owner.name}</h1>
        </div>
      </header>

      {o.channels.filter((c) => !c.rules_accepted_at).map((c) => (
        <Card key={`rules-${c.id}`} className="flex flex-col gap-3 border border-warn/40 p-5">
          <span className="font-semibold">«{c.title}» uchun obuna sotish hali yoqilmagan</span>
          <span className="text-sm leading-relaxed text-muted">
            Platforma qoidalariga rozilik bering: 18+, zo'ravonlik va urush targ'iboti, firibgarlik, giyohvand moddalar, qimor
            va o'zganing kontentini sotish taqiqlanadi.{" "}
            <Link to="/rules" className="text-accent underline">To'liq qoidalar</Link>
          </span>
          <Button className="self-start" onClick={async () => { await api(`/api/owner/channels/${c.id}/accept-rules`, { body: {} }); void reload(); }}>
            Qoidalarga roziman
          </Button>
        </Card>
      ))}
      {o.channels.filter((c) => c.moderation !== "active").map((c) => (
        <Card key={`mod-${c.id}`} className="flex flex-col gap-1 bg-warn-soft p-5">
          <span className="font-semibold text-warn">
            «{c.title}» {c.moderation === "blocked" ? "bloklangan" : "tekshiruvda"}
          </span>
          <span className="text-sm leading-relaxed text-ink/80">
            {c.moderation === "blocked"
              ? `Sabab: ${c.moderation_reason ?? "qoidabuzarlik"}. Obuna sotish va pul yechish to'xtatilgan. E'tiroz bo'lsa, botga xabar yozing.`
              : "Moderator kanalni ko'rib chiqmoqda. Obuna sotilaveradi, tekshiruv tugaguncha pul yechib bo'lmaydi."}
          </span>
        </Card>
      ))}

      <Card className="relative overflow-hidden bg-accent-soft p-5 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-accent">Mening kassam · yechish mumkin</span>
            <span className="text-3xl font-bold tracking-tight md:text-4xl">{som(o.wallet.available)}</span>
            {o.wallet.pending > 0 && <span className="text-sm text-ink/75">Yana {som(o.wallet.pending)} 24 soatda ochiladi</span>}
          </div>
          <Link to="/owner/kassa" className="inline-flex h-11 items-center rounded-xl bg-accent px-5 text-sm font-bold text-accent-ink">Pulni yechish</Link>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Shu oy tushum" value={somShort(s.revenueThisMonth)}
          note={growth === null ? "birinchi oy" : `${growth >= 0 ? "+" : ""}${growth}% o'tgan oyga`} tone={growth !== null && growth < 0 ? "down" : "up"} />
        <Stat label="Faol obunachilar" value={String(s.activeSubscribers)} note={`+${s.newThisMonth} shu oy`} tone="up" />
        <Stat label="Chiqib ketish" value={`${churn.toFixed(1).replace(".", ",")}%`} note={`${s.churnedThisMonth} kishi uzaytirmadi`} />
        <Stat label="3 kunda tugaydi" value={String(s.expiringSoon)} note="eslatmalar avtomatik" />
      </div>

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Oylik tushum</h2>
          <span className="text-xs text-muted">so'm</span>
        </div>
        <BarChart data={s.monthly.map((m) => ({ label: MONTHS[Number(m.month.slice(5)) - 1]!, value: m.revenue, display: somShort(m.revenue) }))} />
      </Card>

      <section className="flex flex-col gap-3">
        <SectionTitle>Kanallarim</SectionTitle>
        <Card className="divide-y divide-line">
          {o.channels.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 p-4">
              <Avatar name={c.title} seed={c.id} size={40} src={`/api/channels/${c.slug}/photo`} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 truncate font-semibold">
                  {c.title}
                  {c.moderation === "pending" && <Badge tone="warn">Tekshiruvda</Badge>}
                  {c.moderation === "blocked" && <Badge tone="warn">Bloklangan</Badge>}
                </span>
                <span className="truncate text-xs text-muted">{c.link}</span>
              </div>
              <Button variant="soft" onClick={() => { void navigator.clipboard?.writeText(c.link); setCopied(c.id); }}>
                <Icon name={copied === c.id ? "check" : "copy"} size={16} />{copied === c.id ? "Nusxalandi" : "Havola"}
              </Button>
              <Button variant="outline" onClick={() => setEditing(c)}>Sozlash</Button>
            </div>
          ))}
        </Card>
      </section>
      <ChannelSheet channel={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />
    </div>
  );
}

const area = "min-h-24 w-full resize-y bg-transparent text-[15px] leading-snug text-ink outline-none placeholder:text-muted/60";

/** The owner's channel page settings: what subscribers see before paying and what they get after. */
function ChannelSheet({ channel, onClose, onSaved }: { channel: OwnerChannel | null; onClose: () => void; onSaved: () => void }) {
  const [key, setKey] = useState<unknown>(null);
  const [description, setDescription] = useState("");
  const [slug, setSlug] = useState("");
  const [perks, setPerks] = useState("");
  const [welcome, setWelcome] = useState("");
  const [trial, setTrial] = useState("0");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (channel !== key) {
    setKey(channel);
    setDescription(channel?.description ?? "");
    setSlug(channel?.slug ?? "");
    setPerks(channel?.perks.join("\n") ?? "");
    setWelcome(channel?.welcome_text ?? "");
    setTrial(String(channel?.trial_days ?? 0));
    setErr(null);
  }
  const save = async () => {
    if (!channel) return;
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/owner/channels/${channel.id}`, {
        method: "PATCH",
        body: {
          description, welcomeText: welcome, trialDays: Number(trial || 0),
          perks: perks.split("\n").map((p) => p.trim()).filter(Boolean),
          ...(slug !== channel.slug ? { slug } : {}),
        },
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={!!channel} onClose={onClose} title={channel ? `«${channel.title}» sozlamalari` : ""}>
      <label className="flex flex-col gap-1 rounded-xl bg-surface px-4 py-3 text-xs text-muted focus-within:ring-2 focus-within:ring-accent">
        Tavsif (kanal sahifasida)
        <textarea className={area} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Kanalda nima haqida yozasiz" />
      </label>
      <label className="flex flex-col gap-1 rounded-xl bg-surface px-4 py-3 text-xs text-muted focus-within:ring-2 focus-within:ring-accent">
        Obunada nimalar bor (har qatorda bittasi, 6 tagacha)
        <textarea className={area} value={perks} onChange={(e) => setPerks(e.target.value)}
          placeholder={"Har kuni 2 ta mashg'ulot videosi\nShaxsiy ovqatlanish rejasi\nYopiq chatda savol-javob"} />
      </label>
      <label className="flex flex-col gap-1 rounded-xl bg-surface px-4 py-3 text-xs text-muted focus-within:ring-2 focus-within:ring-accent">
        Xush kelibsiz xabari (to'lovdan keyin bot yuboradi)
        <textarea className={area} maxLength={1000} value={welcome} onChange={(e) => setWelcome(e.target.value)}
          placeholder="Xush kelibsiz! Avval qadalgan xabarni o'qing." />
      </label>
      <Field label="Bepul sinov (kun, 0 = o'chiq, 30 gacha)" inputMode="numeric" value={trial} maxLength={2}
        onChange={(e) => setTrial(e.target.value.replace(/\D/g, ""))}
        hint="Har bir yangi obunachi bir marta, kartasiz sinab ko'radi" />
      <Field label="Havola nomi" value={slug} maxLength={32} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
        hint={`t.me/…?startapp=${slug}`} />
      {err && <p role="alert" className="text-sm text-warn">{err}</p>}
      <Button size="lg" onClick={save} disabled={busy}>{busy ? "Saqlanmoqda…" : "Saqlash"}</Button>
    </Sheet>
  );
}
