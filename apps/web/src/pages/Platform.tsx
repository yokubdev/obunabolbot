import { api } from "../lib/api";
import { date, som } from "../lib/format";
import type { Withdrawal } from "../lib/types";
import { useApi } from "../lib/useApi";
import { Button, Card, ErrorBox, Spinner } from "../components/ui";

type Row = Withdrawal & { owner_name: string; card_number: string };

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
      <h1 className="text-2xl font-bold tracking-tight">Yechish so'rovlari</h1>
      {data!.length === 0 && <Card className="p-8 text-center text-sm text-muted">Kutilayotgan so'rov yo'q.</Card>}
      {data!.map((w) => (
        <Card key={w.id} className="flex flex-wrap items-center gap-3 p-4">
          <div className="flex flex-1 flex-col">
            <span className="font-semibold">{som(w.amount)} · {w.owner_name}</span>
            <span className="font-mono text-sm">{w.card_number.replace(/(\d{4})(?=\d)/g, "$1 ")}</span>
            <span className="text-xs text-muted">{date(w.created_at)}</span>
          </div>
          <Button variant="outline" onClick={() => act(w.id, "reject")}>Rad etish</Button>
          <Button onClick={() => act(w.id, "paid")}>O'tkazildi</Button>
        </Card>
      ))}
    </main>
  );
}
