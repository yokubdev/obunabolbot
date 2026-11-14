import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../../lib/api";
import { date, durationLabel, som } from "../../lib/format";
import type { OwnerChannel, Plan, Promo } from "../../lib/types";
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
      {data && <Promos key={channelId} channel={overview.channels.find((c) => String(c.id) === channelId)!} plans={data} />}
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

function Promos({ channel, plans }: { channel: OwnerChannel; plans: Plan[] }) {
  const { data, error, loading, reload } = useApi<Promo[]>(`/api/owner/channels/${channel.id}/promos`);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const label = (p: Promo) => (p.kind === "percent" ? `−${p.value}%` : `−${som(p.value)}`);
  const status = (p: Promo) =>
    !p.is_active ? "O'chirilgan"
    : p.expires_at && new Date(p.expires_at) <= new Date() ? "Muddati tugagan"
    : p.max_uses !== null && p.used_count >= p.max_uses ? "Tugagan"
    : null;
  return (
    <section className="flex flex-col gap-3 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 className="text-xl font-bold tracking-tight">Promo-kodlar</h2>
          <span className="text-xs text-muted">Chegirma birinchi to'lovga beriladi, har obunachi bir marta foydalanadi.</span>
        </div>
        <Button variant="soft" onClick={() => setAdding(true)}><Icon name="plus" size={18} />Promo-kod</Button>
      </div>
      {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data!.length ? (
        <Card className="p-6 text-center text-sm text-muted">Hali promo-kod yo'q.</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data!.map((p) => {
            const st = status(p);
            const link = `${channel.link}_${p.code}`;
            return (
              <Card key={p.id} className="flex flex-col gap-2 p-5">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-lg font-bold tracking-wider">{p.code}</span>
                  {st ? <Badge>{st}</Badge> : <Badge tone="ok">{label(p)}</Badge>}
                </div>
                <span className="text-xs text-muted">
                  {p.plan_id ? plans.find((x) => x.id === p.plan_id)?.title ?? "Bitta tarif" : "Barcha tariflar"}
                  {" · "}{p.used_count}{p.max_uses !== null ? `/${p.max_uses}` : ""} marta ishlatilgan
                  {p.expires_at ? ` · ${date(p.expires_at)} gacha` : ""}
                </span>
                <div className="flex gap-2">
                  <Button variant="soft" className="flex-1" onClick={() => { void navigator.clipboard?.writeText(link); setCopied(p.id); }}>
                    <Icon name={copied === p.id ? "check" : "copy"} size={16} />{copied === p.id ? "Nusxalandi" : "Havola"}
                  </Button>
                  <Button variant="outline" onClick={async () => { await api(`/api/owner/promos/${p.id}`, { method: "PATCH", body: { isActive: !p.is_active } }); void reload(); }}>
                    {p.is_active ? "O'chirish" : "Yoqish"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <PromoSheet open={adding} channelId={channel.id} plans={plans} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void reload(); }} />
    </section>
  );
}

function PromoSheet({ open, channelId, plans, onClose, onSaved }: { open: boolean; channelId: number; plans: Plan[]; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("");
  const [planId, setPlanId] = useState("all");
  const [maxUses, setMaxUses] = useState("");
  const [days, setDays] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const n = Number(value.replace(/\s/g, ""));
      await api(`/api/owner/channels/${channelId}/promos`, {
        body: {
          code, kind, value: kind === "percent" ? n : Math.round(n * 100),
          planId: planId === "all" ? null : Number(planId),
          maxUses: maxUses ? Number(maxUses) : null,
          expiresAt: days ? new Date(Date.now() + Number(days) * 86400_000).toISOString() : null,
        },
      });
      setCode(""); setValue(""); setMaxUses(""); setDays("");
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Yangi promo-kod">
      <Field label="Kod" value={code} maxLength={20} placeholder="BAHOR25" autoCapitalize="characters"
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))} />
      <Segmented value={kind} onChange={setKind} options={[{ value: "percent", label: "Foiz" }, { value: "amount", label: "So'm" }]} />
      <Field label={kind === "percent" ? "Chegirma (%, 90 gacha)" : "Chegirma (so'm)"} inputMode="numeric" value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^\d\s]/g, ""))} placeholder={kind === "percent" ? "20" : "10000"} />
      <Segmented value={planId} onChange={setPlanId}
        options={[{ value: "all", label: "Barcha tariflar" }, ...plans.filter((p) => p.is_active).map((p) => ({ value: String(p.id), label: p.title }))]} />
      <Field label="Necha marta ishlatish mumkin (ixtiyoriy)" inputMode="numeric" value={maxUses} placeholder="Cheksiz"
        onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ""))} />
      <Field label="Necha kun amal qiladi (ixtiyoriy)" inputMode="numeric" value={days} placeholder="Muddatsiz"
        onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />
      {err && <p role="alert" className="text-sm text-warn">{err}</p>}
      <Button size="lg" onClick={save} disabled={busy || code.length < 3 || !value}>{busy ? "Saqlanmoqda…" : "Yaratish"}</Button>
    </Sheet>
  );
}
