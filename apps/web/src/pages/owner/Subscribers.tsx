import { useState } from "react";
import { date, daysLeft, som } from "../../lib/format";
import type { OwnerSub } from "../../lib/types";
import { useApi } from "../../lib/useApi";
import { Avatar, Badge, Card, ErrorBox, Icon, Segmented, Spinner } from "../../components/ui";

type Filter = "all" | "active" | "expiring" | "expired";

export default function Subscribers() {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const { data, error, loading, reload } = useApi<OwnerSub[]>(`/api/owner/subscribers?filter=${filter}&q=${encodeURIComponent(q)}`);

  const status = (s: OwnerSub) =>
    s.status === "expired" ? <Badge>Chiqarilgan</Badge> : daysLeft(s.expires_at) <= 3 ? <Badge tone="warn">Tugayapti</Badge> : <Badge tone="ok">Faol</Badge>;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Obunachilar</h1>
      <div className="flex flex-col gap-3 lg:flex-row">
        <label className="flex h-11 items-center gap-2 rounded-xl bg-surface px-3 lg:w-80">
          <Icon name="users" size={18} className="text-muted" />
          <span className="sr-only">Qidirish</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ism yoki @username"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
        </label>
        <div className="lg:flex-1">
          <Segmented value={filter} onChange={setFilter} options={[
            { value: "all", label: "Hammasi" }, { value: "active", label: "Faol" },
            { value: "expiring", label: "Tugayapti" }, { value: "expired", label: "Chiqarilgan" },
          ]} />
        </div>
      </div>

      {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <>
          {/* Phone: cards */}
          <div className="flex flex-col gap-2 md:hidden">
            {data!.map((s) => (
              <Card key={s.id} className="flex items-center gap-3 p-3.5">
                <Avatar name={s.subscriber_name} seed={s.id} size={40} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{s.subscriber_name}</span>
                  <span className="text-xs text-muted">{s.plan_title} · {date(s.expires_at)} gacha</span>
                </div>
                {status(s)}
              </Card>
            ))}
          </div>
          {/* Desktop: table */}
          <Card className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-muted">
                <tr>{["Obunachi", "Kanal", "Tarif", "Tugash sanasi", "Jami to'lagan", "Holat"].map((h) => <th key={h} className="px-5 py-3.5 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data!.map((s) => (
                  <tr key={s.id}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={s.subscriber_name} seed={s.id} size={34} />
                        <div className="flex flex-col"><span className="font-medium">{s.subscriber_name}</span>
                          {s.subscriber_username && <span className="text-xs text-muted">@{s.subscriber_username}</span>}</div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted">{s.channel_title}</td>
                    <td className="px-5 py-3">{s.plan_title}{s.auto_renew && <span className="ml-1.5 text-xs text-accent">auto</span>}</td>
                    <td className="px-5 py-3">{date(s.expires_at)}</td>
                    <td className="px-5 py-3">{som(s.total_paid)}</td>
                    <td className="px-5 py-3">{status(s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {data!.length === 0 && <Card className="p-8 text-center text-sm text-muted">Hozircha obunachi yo'q. Kanal havolasini ulashing.</Card>}
        </>
      )}
    </div>
  );
}
