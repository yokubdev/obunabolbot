import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { date, som } from "../../lib/format";
import { haptic, insideTelegram, requestPhone } from "../../lib/telegram";
import type { LegalStatus, PayoutProfile } from "../../lib/types";
import { Badge, Button, Field, Icon, Segmented } from "../../components/ui";

const STATUS_HINT: Record<LegalStatus, string> = {
  self_employed: "Soliq ilovasida o'zini o'zi band qilgan sifatida ro'yxatdan o'tgansiz. Yiliga 100 mln so'mgacha soliq yo'q.",
  business: "YaTT yoki MChJ. STIR va nomini kiriting.",
  individual: "Hali ro'yxatdan o'tmagansiz. Pul yechish mumkin, lekin Soliq ilovasida o'zini o'zi band qilgan sifatida ro'yxatdan o'tishni tavsiya qilamiz.",
};

export const STATUS_LABEL: Record<LegalStatus, string> = {
  self_employed: "O'zini o'zi band", business: "YaTT / MChJ", individual: "Hali yo'q",
};

/**
 * First-withdrawal onboarding: phone (shared through Telegram, not typed), tax status and payout terms.
 * onChange gets the saved profile.
 */
export function PayoutSetup({ profile, onChange }: { profile: PayoutProfile; onChange: (p: PayoutProfile) => void }) {
  const [status, setStatus] = useState<LegalStatus>(profile.legalStatus ?? "self_employed");
  const [tin, setTin] = useState(profile.businessTin ?? "");
  const [bizName, setBizName] = useState(profile.businessName ?? "");
  const [agree, setAgree] = useState(profile.termsAccepted);
  const [waitingPhone, setWaitingPhone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The phone reaches the bot as a contact message; poll until the API has it.
  useEffect(() => {
    if (!waitingPhone) return;
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      const p = await api<PayoutProfile>("/api/owner/payout-profile").catch(() => null);
      if (p?.phone) { setWaitingPhone(false); onChange(p); haptic("success"); }
      else if (tries > 15) { setWaitingPhone(false); setErr("Raqam kelmadi. Qayta urinib ko'ring."); }
    }, 1500);
    return () => clearInterval(t);
  }, [waitingPhone, onChange]);

  const sharePhone = async () => {
    setErr(null);
    if (!insideTelegram) return setErr("Raqamni ulashish faqat Telegram ichida ishlaydi.");
    if (await requestPhone()) setWaitingPhone(true);
    else setErr("Raqam ulashilmadi.");
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const p = await api<PayoutProfile>("/api/owner/payout-profile", {
        body: { legalStatus: status, businessTin: status === "business" ? tin : null, businessName: status === "business" ? bizName : null, acceptTerms: true },
      });
      haptic("success");
      onChange(p);
    } catch (e) {
      haptic("error");
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Birinchi marta pul yechishdan oldin bir daqiqalik ma'lumot. Bu faqat bir marta so'raladi.</p>

      <div className="flex flex-col gap-2">
        <span className="px-1 text-sm font-medium">1. Telefon raqam</span>
        {profile.phone ? (
          <div className="flex items-center gap-2 rounded-xl bg-raised px-4 py-3 text-sm"><Icon name="check" size={16} className="text-accent" />{profile.phone}</div>
        ) : (
          <Button variant="soft" disabled={waitingPhone} onClick={sharePhone}>
            {waitingPhone ? "Kutilmoqda…" : "Telegramdagi raqamni ulashish"}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="px-1 text-sm font-medium">2. Soliq maqomi</span>
        <Segmented<LegalStatus> value={status} onChange={setStatus}
          options={(Object.keys(STATUS_LABEL) as LegalStatus[]).map((v) => ({ value: v, label: STATUS_LABEL[v] }))} />
        <p className="px-1 text-xs text-muted">{STATUS_HINT[status]}</p>
        {status === "business" && (
          <>
            <Field label="STIR" inputMode="numeric" value={tin} onChange={(e) => setTin(e.target.value.replace(/\D/g, "").slice(0, 9))} />
            <Field label="YaTT yoki korxona nomi" value={bizName} onChange={(e) => setBizName(e.target.value.slice(0, 120))} />
          </>
        )}
      </div>

      <label className="flex items-start gap-3 px-1 text-sm">
        <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          Pul yechish shartlariga roziman: pul har dushanba to'lanadi, eng kam summa 100 000 so'm, oyiga 5 mln so'mdan ko'p
          yechish uchun shaxsni tasdiqlash kerak, qoidabuzarlikda to'lov to'xtatiladi. Soliqni o'zim to'layman.
        </span>
      </label>

      {err && <p role="alert" className="text-sm text-warn">{err}</p>}
      <Button size="lg" disabled={busy || !profile.phone || !agree || (status === "business" && (tin.length !== 9 || bizName.trim().length < 2))} onClick={save}>
        {busy ? "Saqlanmoqda…" : "Saqlash"}
      </Button>
    </div>
  );
}

/** Identity check instead of MyID: full name and PINFL, checked by an operator against the passport. */
export function KycForm({ profile, onChange }: { profile: PayoutProfile; onChange: (p: PayoutProfile) => void }) {
  const [fullName, setFullName] = useState(profile.kyc.fullName ?? "");
  const [pinfl, setPinfl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const k = profile.kyc;

  if (k.status === "verified") return <Badge tone="ok">Shaxs tasdiqlangan</Badge>;
  if (k.status === "pending")
    return (
      <p className="text-sm text-muted">
        <Badge tone="warn">Tekshirilmoqda</Badge> {k.fullName}, JSHSHIR {k.pinfl}. Odatda 1 ish kuni. Operator pasport rasmini shu bot orqali so'rashi mumkin.
      </p>
    );

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      onChange(await api<PayoutProfile>("/api/owner/kyc", { body: { fullName, pinfl } }));
      haptic("success");
    } catch (e) {
      haptic("error");
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Oyiga {som(profile.kycMonthlyLimit)} dan ko'p yechish uchun shaxsingizni tasdiqlang. Bu oy yechilgan: {som(profile.withdrawnThisMonth)}.
      </p>
      {k.status === "rejected" && k.note && <p className="text-sm text-warn">Oldingi so'rov rad etildi: {k.note}</p>}
      <Field label="Familiya, ism, otasining ismi (pasportdagidek)" value={fullName} onChange={(e) => setFullName(e.target.value.slice(0, 120))} />
      <Field label="JSHSHIR (14 raqam, pasportning orqasida)" inputMode="numeric" value={pinfl}
        onChange={(e) => setPinfl(e.target.value.replace(/\D/g, "").slice(0, 14))} />
      {err && <p role="alert" className="text-sm text-warn">{err}</p>}
      <Button disabled={busy || pinfl.length !== 14 || fullName.trim().split(/\s+/).length < 2} onClick={submit}>
        {busy ? "Yuborilmoqda…" : "Tekshiruvga yuborish"}
      </Button>
    </div>
  );
}

export const payoutNote = (p: PayoutProfile) => `Keyingi to'lov kuni: ${date(p.nextPayoutDate)} (dushanba). Eng kam summa 100 000 so'm.`;
