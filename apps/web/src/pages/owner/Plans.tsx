import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../../lib/api";
import { durationLabel, som } from "../../lib/format";
import type { Plan } from "../../lib/types";
import { useApi } from "../../lib/useApi";
import { Badge, Button, Card, ErrorBox, Field, Icon, Segmented, Sheet, Spinner } from "../../components/ui";
import type { OwnerCtx } from "./OwnerLayout";

export default function Plans() {
  const { overview } = useOutletContext<OwnerCtx>();
  const [channelId, setChannelId] = useState(String(overview.channels[0]?.id ?? ""));
  const { data, error, loading, reload } = useApi<Plan[]>(channelId ? `/api/owner/channels/${channelId}/plans` : null);
  const [editing, setEditing] = useState<Plan | "new" | null>(null);

  if (!overview.channels.length) return <Card className="p-8 text-center text-sm text-muted">Avval kanal ulang.</Card>;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Tariflar</h1>
        <Button onClick={() => setEditing("new")}><Icon name="plus" size={18} />Tarif qo'shish</Button>
      </div>
      {overview.channels.length > 1 && (
        <Segmented value={channelId} onChange={setChannelId} options={overview.channels.map((c) => ({ value: String(c.id), label: c.title }))} />
      )}
      {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data!.map((p) => (
            <Card key={p.id} className="flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col"><span className="text-lg font-semibold">{p.title}</span><span className="text-xs text-muted">{durationLabel(p.duration_days)}</span></div>
                {p.is_active ? <Badge tone="ok">Sotuvda</Badge> : <Badge>O'chirilgan</Badge>}
              </div>
              <span className="text-2xl font-bold tracking-tight">{som(p.price)}</span>
              <div className="flex gap-2">
                <Button variant="soft" className="flex-1" onClick={() => setEditing(p)}>Tahrirlash</Button>
                <Button variant="outline" onClick={async () => { await api(`/api/owner/plans/${p.id}`, { method: "PATCH", body: { isActive: !p.is_active } }); void reload(); }}>
                  {p.is_active ? "O'chirish" : "Yoqish"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <PlanSheet plan={editing} channelId={Number(channelId)} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />
    </div>
  );
}

function PlanSheet({ plan, channelId, onClose, onSaved }: { plan: Plan | "new" | null; channelId: number; onClose: () => void; onSaved: () => void }) {
  const isNew = plan === "new";
  const [title, setTitle] = useState("");
  const [days, setDays] = useState("30");
  const [price, setPrice] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState<unknown>(null);
  if (plan !== key) {
    setKey(plan);
    setTitle(plan && plan !== "new" ? plan.title : "");
    setDays(plan && plan !== "new" ? String(plan.duration_days) : "30");
    setPrice(plan && plan !== "new" ? String(plan.price / 100) : "");
    setErr(null);
  }
  const save = async () => {
    try {
      const priceTiyin = Math.round(Number(price.replace(/\s/g, "")) * 100);
      if (isNew) await api(`/api/owner/channels/${channelId}/plans`, { body: { title, durationDays: Number(days), price: priceTiyin } });
      else await api(`/api/owner/plans/${(plan as Plan).id}`, { method: "PATCH", body: { title, price: priceTiyin } });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Sheet open={!!plan} onClose={onClose} title={isNew ? "Yangi tarif" : "Tarifni tahrirlash"}>
      <Field label="Nomi" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="3 oy" />
      {isNew && <Field label="Muddat (kun)" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />}
      <Field label="Narx (so'm)" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d\s]/g, ""))} placeholder="125000" />
      {err && <p role="alert" className="text-sm text-warn">{err}</p>}
      <Button size="lg" onClick={save} disabled={!title || !price}>Saqlash</Button>
    </Sheet>
  );
}
