import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { MONTHS, som, somShort } from "../../lib/format";
import { BarChart, Button, Card, Icon, SectionTitle, Stat, Avatar } from "../../components/ui";
import type { OwnerCtx } from "./OwnerLayout";

export default function Overview() {
  const { overview: o } = useOutletContext<OwnerCtx>();
  const [copied, setCopied] = useState<number | null>(null);
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
              <Avatar name={c.title} seed={c.id} size={40} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{c.title}</span>
                <span className="truncate text-xs text-muted">{c.link}</span>
              </div>
              <Button variant="soft" onClick={() => { void navigator.clipboard?.writeText(c.link); setCopied(c.id); }}>
                <Icon name={copied === c.id ? "check" : "copy"} size={16} />{copied === c.id ? "Nusxalandi" : "Havola"}
              </Button>
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
