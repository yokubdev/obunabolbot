import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../../lib/api";
import { date, som } from "../../lib/format";
import { haptic } from "../../lib/telegram";
import type { PayoutProfile, WalletFull } from "../../lib/types";
import { ApiError } from "../../lib/api";
import { KycForm, PayoutSetup, STATUS_LABEL, payoutNote } from "./PayoutSetup";
import { useApi } from "../../lib/useApi";
import { Badge, Button, Card, ErrorBox, Field, Icon, SectionTitle, Sheet, Spinner, Stat } from "../../components/ui";
import type { OwnerCtx } from "./OwnerLayout";

const LABEL: Record<string, string> = {
  payment: "To'lov", commission: "Komissiya", withdrawal: "Kartaga yechildi", withdrawal_reversal: "Qaytarildi",
};

export default function Kassa() {
  const { overview, reload: reloadOverview } = useOutletContext<OwnerCtx>();
  const { data, error, loading, reload } = useApi<WalletFull>("/api/owner/wallet");
  const profileApi = useApi<PayoutProfile>("/api/owner/payout-profile");
  const [profileOverride, setProfile] = useState<PayoutProfile | null>(null);
  const profile = profileOverride ?? profileApi.data;
  const [needKyc, setNeedKyc] = useState(false);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [card, setCard] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBox error={error ?? new Error("Xatolik")} onRetry={reload} />;

  const withdraw = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/owner/withdrawals", { body: { amount: Math.round(Number(amount.replace(/\s/g, "")) * 100), cardNumber: card } });
      haptic("success");
      setOpen(false);
      setAmount("");
      await Promise.all([reload(), reloadOverview()]);
    } catch (e) {
      haptic("error");
      if (e instanceof ApiError && e.code === "kyc_required") setNeedKyc(true);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const overLimit = !!profile && profile.kyc.status !== "verified"
    && profile.withdrawnThisMonth + Number(amount || 0) * 100 > profile.kycMonthlyLimit;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Mening kassam</h1>
        <p className="text-sm text-muted">Ro'yxatdan o'tganingizda avtomatik ochilgan. Komissiya ({overview.commissionBps / 100}%) har to'lovdan ushlanadi.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="flex flex-col gap-2 bg-accent-soft p-5 md:col-span-1">
          <span className="text-sm text-accent">Yechish mumkin</span>
          <span className="text-3xl font-bold tracking-tight">{som(data.available)}</span>
          <Button className="mt-2" disabled={data.available < 10_000_000} onClick={() => { setAmount(String(Math.floor(data.available / 100))); setOpen(true); }}>
            <Icon name="arrowUp" size={18} />Pulni yechish
          </Button>
        </Card>
        <Stat label="Ushlab turilgan" value={som(data.pending)} note="Yangi to'lovlar biroz kutib ochiladi" />
        <Stat label="Shu oy komissiya" value={som(data.commissionThisMonth)} />
      </div>

      {profile && (
        <Card className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
          <span className="font-medium">To'lov ma'lumotlari:</span>
          {profile.complete ? (
            <>
              <span>{profile.phone}</span>
              <span className="text-muted">{profile.legalStatus && STATUS_LABEL[profile.legalStatus]}{profile.businessName ? ` · ${profile.businessName}` : ""}</span>
              {profile.kyc.status === "verified" ? <Badge tone="ok">Shaxs tasdiqlangan</Badge>
                : profile.kyc.status === "pending" ? <Badge tone="warn">Tekshirilmoqda</Badge> : null}
              <span className="text-muted">Keyingi to'lov: {date(profile.nextPayoutDate)}</span>
            </>
          ) : <span className="text-muted">Birinchi yechishda to'ldiriladi (1 daqiqa)</span>}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <SectionTitle>Kassa tarixi</SectionTitle>
          <Card className="divide-y divide-line">
            {data.ledger.length === 0 && <p className="p-6 text-center text-sm text-muted">Hali to'lovlar yo'q.</p>}
            {data.ledger.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-4 py-3">
                <span className={`flex size-9 items-center justify-center rounded-full ${l.amount > 0 ? "bg-accent-soft text-accent" : "bg-raised text-muted"}`}>
                  <Icon name={l.amount > 0 ? "arrowDown" : "arrowUp"} size={16} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">
                    {LABEL[l.type]}{l.subscriber_name ? ` · ${l.subscriber_name}` : ""}{l.card_number ? ` · ${l.card_number}` : ""}
                  </span>
                  <span className="text-xs text-muted">{date(l.created_at)}{l.plan_title ? ` · ${l.plan_title}` : ""}</span>
                </div>
                <span className={`whitespace-nowrap text-sm font-semibold ${l.amount > 0 ? "text-accent" : ""}`}>
                  {l.amount > 0 ? "+" : "−"}{som(Math.abs(l.amount))}
                </span>
              </div>
            ))}
          </Card>
        </section>
        <section className="flex flex-col gap-3">
          <SectionTitle>Yechish so'rovlari</SectionTitle>
          <Card className="divide-y divide-line">
            {data.withdrawals.length === 0 && <p className="p-6 text-center text-sm text-muted">Hali so'rov yo'q.</p>}
            {data.withdrawals.map((w) => (
              <div key={w.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="flex flex-1 flex-col"><span className="font-medium">{som(w.amount)}</span><span className="text-xs text-muted">{date(w.created_at)} · {w.card_number}{w.status === "pending" && w.payout_date ? ` · ${date(w.payout_date)} to'lanadi` : ""}</span></div>
                {w.status === "paid" ? <Badge tone="ok">O'tkazildi</Badge> : w.status === "pending" ? <Badge tone="warn">Jarayonda</Badge> : <Badge>Rad etildi</Badge>}
              </div>
            ))}
          </Card>
        </section>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title={profile && !profile.complete ? "To'lov ma'lumotlari" : "Pulni yechish"}>
        {!profile ? <Spinner /> : !profile.complete ? <PayoutSetup profile={profile} onChange={setProfile} /> : (needKyc || overLimit) && profile.kyc.status !== "verified" ? (
          <>
            <KycForm profile={profile} onChange={(p) => { setProfile(p); setErr(null); }} />
            {profile.kyc.status !== "pending" && <Button variant="ghost" onClick={() => { setNeedKyc(false); setAmount(String(Math.max(0, Math.floor((profile.kycMonthlyLimit - profile.withdrawnThisMonth) / 100)))); }}>Chegaragacha yechish</Button>}
          </>
        ) : <>
        <Field label="Summa (so'm)" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} />
        <Field label="Karta (Uzcard / Humo)" inputMode="numeric" placeholder="9860 0000 0000 0000" value={card}
          onChange={(e) => setCard(e.target.value.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 "))} />
        <p className="px-1 text-xs text-muted">{payoutNote(profile)}</p>
        {err && <p role="alert" className="text-sm text-warn">{err}</p>}
        <Button size="lg" disabled={busy || !amount || card.length < 19} onClick={withdraw}>{busy ? "Yuborilmoqda…" : "Tasdiqlash"}</Button>
        </>}
      </Sheet>
    </div>
  );
}
