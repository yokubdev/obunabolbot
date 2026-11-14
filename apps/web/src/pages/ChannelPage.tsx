import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { date, durationLabel, som } from "../lib/format";
import { haptic } from "../lib/telegram";
import type { PublicChannel, PublicPlan } from "../lib/types";
import { useApi } from "../lib/useApi";
import { Avatar, Button, Card, ErrorBox, Field, Icon, SectionTitle, Spinner, Toggle } from "../components/ui";

type PromoQuote = { code: string; planId: number; listPrice: number; discount: number; price: number };

type Step = { kind: "plans" } | { kind: "card" } | { kind: "otp"; paymentId: number; phone: string | null } | { kind: "done"; expiresAt: string };

const fmtCard = (v: string) => v.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");
const fmtExpiry = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};

export default function ChannelPage() {
  const { slug } = useParams();
  const { data, error, loading, reload } = useApi<{ channel: PublicChannel; plans: PublicPlan[] }>(`/api/channels/${slug}`);
  const [picked, setPicked] = useState<number | null>(null);
  const [step, setStep] = useState<Step>({ kind: "plans" });
  const [card, setCard] = useState("");
  const [expiry, setExpiry] = useState("");
  const [otp, setOtp] = useState("");
  const [autoRenew, setAutoRenew] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [params] = useSearchParams();
  const linkPromo = params.get("promo")?.trim().toUpperCase() || null;
  const [promoText, setPromoText] = useState(linkPromo ?? "");
  const [promoOpen, setPromoOpen] = useState(!!linkPromo);
  const [appliedCode, setAppliedCode] = useState<string | null>(linkPromo);
  const [promo, setPromo] = useState<PromoQuote | null>(null);
  const [promoErr, setPromoErr] = useState<string | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoTry, setPromoTry] = useState(0);
  const planId = data ? (picked ?? data.plans[1]?.id ?? data.plans[0]?.id ?? null) : null;

  // The discount depends on the plan (a code can be limited to one), so re-check it when the plan changes.
  useEffect(() => {
    if (!appliedCode || !planId) return;
    let stale = false;
    setPromoBusy(true);
    setPromoErr(null);
    api<Omit<PromoQuote, "planId">>("/api/checkout/promo", { body: { planId, code: appliedCode } })
      .then((q) => { if (!stale) setPromo({ ...q, planId }); })
      .catch((e) => { if (!stale) { setPromo(null); setPromoErr((e as Error).message); } })
      .finally(() => { if (!stale) setPromoBusy(false); });
    return () => { stale = true; };
  }, [appliedCode, planId, promoTry]);

  if (loading) return <Spinner />;
  if (error || !data) return <div className="p-4"><ErrorBox error={error ?? new Error("Topilmadi")} onRetry={reload} /></div>;

  const { channel, plans } = data;
  const plan = plans.find((p) => p.id === (picked ?? plans[1]?.id ?? plans[0]?.id)) ?? null;
  const monthly = (p: PublicPlan) => Math.round((p.price / p.durationDays) * 30);
  const base = plans[0] ? monthly(plans[0]) : 0;
  const quote = promo && plan && promo.planId === plan.id ? promo : null;
  const price = quote ? quote.price : plan?.price ?? 0;
  const applyPromo = () => {
    const code = promoText.trim().toUpperCase();
    if (!code) return;
    setPromo(null);
    setAppliedCode(code);
    setPromoTry((n) => n + 1);
  };
  const clearPromo = () => { setAppliedCode(null); setPromo(null); setPromoErr(null); setPromoText(""); };

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      haptic("error");
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const startPayment = () =>
    run(async () => {
      const r = await api<{ paymentId: number; phoneMask: string | null }>("/api/checkout", {
        body: { planId: plan!.id, autoRenew, cardNumber: card, expiry, promoCode: quote?.code },
      });
      setStep({ kind: "otp", paymentId: r.paymentId, phone: r.phoneMask });
    });

  const confirm = (paymentId: number) =>
    run(async () => {
      const r = await api<{ expiresAt: string }>(`/api/checkout/${paymentId}/confirm`, { body: { otp } });
      haptic("success");
      setStep({ kind: "done", expiresAt: r.expiresAt });
    });

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col">
      <main className="flex flex-1 flex-col gap-5 px-4 pb-32">
        {step.kind === "plans" && (
          <>
            <div className="-mx-4 h-28 bg-gradient-to-br from-accent-soft to-surface" />
            <header className="-mt-14 flex flex-col items-center gap-2 text-center">
              <div className="rounded-full border-4 border-bg"><Avatar name={channel.title} size={84} seed={channel.id} /></div>
              <h1 className="text-2xl font-bold tracking-tight">{channel.title}</h1>
              <p className="text-sm text-muted">{channel.subscribers} obunachi</p>
              {channel.description && <p className="max-w-xs text-sm leading-relaxed text-ink/85">{channel.description}</p>}
            </header>
            <SectionTitle>Obuna turlari</SectionTitle>
            <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="Tarif">
              {plans.map((p) => {
                const on = p.id === plan?.id;
                const save = base && p.durationDays > 31 ? Math.round((1 - monthly(p) / base) * 100) : 0;
                return (
                  <button key={p.id} role="radio" aria-checked={on} onClick={() => setPicked(p.id)}
                    className={`flex min-h-16 items-center gap-3 rounded-2xl border-2 bg-surface px-4 py-3 text-left transition ${on ? "border-accent" : "border-transparent"}`}>
                    <span className="flex flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-2 font-semibold">
                        {p.title}
                        {save > 0 && <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-bold text-accent">−{save}%</span>}
                      </span>
                      <span className="text-xs text-muted">
                        {p.durationDays > 31 ? `oyiga ${som(monthly(p))}` : `${durationLabel(p.durationDays)}, avtomatik uzayadi`}
                      </span>
                    </span>
                    <span className="font-bold">{som(p.price)}</span>
                  </button>
                );
              })}
            </div>
            {!promoOpen ? (
              <button className="self-start px-1 text-sm font-semibold text-accent" onClick={() => setPromoOpen(true)}>Promo-kodim bor</button>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex gap-2">
                  <input aria-label="Promo-kod" placeholder="PROMO-KOD" maxLength={20} autoCapitalize="characters"
                    value={promoText} onChange={(e) => setPromoText(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
                    onKeyDown={(e) => e.key === "Enter" && applyPromo()}
                    className="h-11 min-w-0 flex-1 rounded-xl bg-surface px-4 font-semibold tracking-wider outline-none focus:ring-2 focus:ring-accent" />
                  {quote ? (
                    <Button variant="soft" onClick={clearPromo}>Olib tashlash</Button>
                  ) : (
                    <Button variant="soft" disabled={promoBusy || promoText.length < 3} onClick={applyPromo}>{promoBusy ? "…" : "Qo'llash"}</Button>
                  )}
                </div>
                {quote && <p className="px-1 text-xs font-medium text-accent">{quote.code}: −{som(quote.discount)} birinchi to'lovga. Keyingi to'lovlar to'liq narxda.</p>}
                {promoErr && !quote && <p className="px-1 text-xs text-warn">{promoErr}</p>}
              </div>
            )}
            <Card className="divide-y divide-line">
              {[["lock", "Yopiq kanalga shaxsiy havola"], ["refresh", "Istalgan payt bekor qilish mumkin"], ["shield", "To'lov ATMOS orqali himoyalangan"]].map(([i, t]) => (
                <div key={t} className="flex items-center gap-3 px-4 py-3 text-sm"><Icon name={i!} className="text-accent" size={18} />{t}</div>
              ))}
            </Card>
          </>
        )}

        {step.kind !== "plans" && plan && (
          <Card className="mt-4 flex items-center gap-3 p-4">
            <Avatar name={channel.title} seed={channel.id} />
            <div className="flex flex-1 flex-col"><span className="font-semibold">{channel.title}</span><span className="text-xs text-muted">{plan.title}</span></div>
            <span className="flex flex-col items-end">
              {quote && <span className="text-xs text-muted line-through">{som(quote.listPrice)}</span>}
              <span className="text-lg font-bold">{som(price)}</span>
            </span>
          </Card>
        )}

        {step.kind === "card" && (
          <div className="flex flex-col gap-3">
            <SectionTitle>Karta</SectionTitle>
            <Field label="Karta raqami" inputMode="numeric" autoComplete="cc-number" placeholder="8600 0000 0000 0000"
              value={card} onChange={(e) => setCard(fmtCard(e.target.value))} />
            <Field label="Amal qilish muddati" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY"
              value={expiry} onChange={(e) => setExpiry(fmtExpiry(e.target.value))} />
            <div className="flex gap-2 px-1">
              {["UZCARD", "HUMO"].map((b) => <span key={b} className="rounded-md bg-raised px-2 py-1 text-[11px] font-bold text-muted">{b}</span>)}
            </div>
            <Toggle on={autoRenew} onChange={setAutoRenew} label="Avto-uzaytirish" hint="Kartani saqlab, har muddatda o'zimiz yechamiz" />
          </div>
        )}

        {step.kind === "otp" && (
          <div className="flex flex-col items-center gap-3 pt-6 text-center">
            <h2 className="text-lg font-semibold">SMS-kodni kiriting</h2>
            <p className="text-sm text-muted">{step.phone ? `${step.phone} raqamiga kod yuborildi` : "Kartaga ulangan raqamga kod yuborildi"}</p>
            <input aria-label="SMS-kod" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6}
              value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              className="mt-2 h-14 w-56 rounded-xl border border-line bg-surface text-center text-2xl font-semibold tracking-[0.5em] outline-none focus:ring-2 focus:ring-accent" />
          </div>
        )}

        {step.kind === "done" && (
          <div className="flex flex-col items-center gap-3 pt-10 text-center">
            <div className="flex size-18 items-center justify-center rounded-full bg-accent-soft text-accent"><Icon name="check" size={36} /></div>
            <h2 className="text-xl font-bold">Obuna faollashdi</h2>
            <p className="max-w-xs text-sm leading-relaxed text-muted">{date(step.expiresAt)} gacha. Kanalga kirish havolasini botga yubordik.</p>
          </div>
        )}

        {err && <p role="alert" className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">{err}</p>}
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t border-line bg-bg/90 px-4 pb-6 pt-3 backdrop-blur">
        <div className="mx-auto max-w-md">
          {step.kind === "plans" && plan && (
            <Button size="lg" className="w-full" onClick={() => setStep({ kind: "card" })}>Obuna bo'lish · {som(price)}</Button>
          )}
          {step.kind === "card" && (
            <div className="flex gap-2">
              <Button variant="soft" size="lg" onClick={() => setStep({ kind: "plans" })}>Orqaga</Button>
              <Button size="lg" className="flex-1" disabled={busy || card.length < 19 || expiry.length < 5} onClick={startPayment}>
                {busy ? "Yuborilmoqda…" : `${som(price)} to'lash`}
              </Button>
            </div>
          )}
          {step.kind === "otp" && (
            <Button size="lg" className="w-full" disabled={busy || otp.length < 4} onClick={() => confirm(step.paymentId)}>
              {busy ? "Tekshirilmoqda…" : "Tasdiqlash"}
            </Button>
          )}
          {step.kind === "done" && <Button size="lg" className="w-full" onClick={() => (window as any).Telegram?.WebApp?.close?.()}>Botga qaytish</Button>}
        </div>
      </footer>
    </div>
  );
}
