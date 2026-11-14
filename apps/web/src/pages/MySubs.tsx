import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { date, daysLeft, som } from "../lib/format";
import type { MySub } from "../lib/types";
import { useApi } from "../lib/useApi";
import { Avatar, Badge, Card, ErrorBox, Segmented, Spinner, Toggle } from "../components/ui";

export default function MySubs() {
  const { data, error, loading, reload } = useApi<MySub[]>("/api/me/subscriptions");
  const [tab, setTab] = useState<"active" | "expired">("active");
  if (loading && !data) return <Spinner />;
  if (error) return <div className="p-4"><ErrorBox error={error} onRetry={reload} /></div>;
  const list = (data ?? []).filter((s) => s.status === tab);
  const count = (s: MySub["status"]) => (data ?? []).filter((x) => x.status === s).length;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <h1 className="pt-2 text-2xl font-bold tracking-tight">Mening obunalarim</h1>
      <Segmented value={tab} onChange={setTab} options={[{ value: "active", label: `Faol · ${count("active")}` }, { value: "expired", label: `Tugagan · ${count("expired")}` }]} />
      {list.length === 0 && <Card className="p-6 text-center text-sm text-muted">Bu yerda hozircha hech narsa yo'q.</Card>}
      {list.map((s) => {
        const left = daysLeft(s.expires_at);
        return (
          <Card key={s.id} className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-3">
              <Avatar name={s.channel_title} seed={s.channel_id} />
              <div className="flex flex-1 flex-col">
                <span className="font-semibold">{s.channel_title}</span>
                <span className="text-xs text-muted">
                  {s.status === "active" ? `${s.plan_title} · ${date(s.expires_at)} gacha` : `Tugagan: ${date(s.expires_at)}`}
                </span>
              </div>
              {s.status === "expired" ? <Badge>Tugagan</Badge> : left <= 3 ? <Badge tone="warn">{left} kun qoldi</Badge> : <Badge tone="ok">Faol</Badge>}
            </div>
            {s.status === "active" ? (
              <Toggle on={s.auto_renew} label="Avto-uzaytirish" hint={s.auto_renew ? `Keyingi to'lov ${som(s.plan_price)}` : "O'chirilgan"}
                onChange={async (on) => { await api(`/api/me/subscriptions/${s.id}/auto-renew`, { body: { on } }).catch(() => {}); void reload(); }} />
            ) : (
              <Link to={`/c/${s.channel_slug}`} className="flex h-11 items-center justify-center rounded-xl bg-raised text-sm font-semibold">Qayta obuna bo'lish</Link>
            )}
          </Card>
        );
      })}
    </main>
  );
}
