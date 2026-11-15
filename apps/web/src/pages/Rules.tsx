import { Card } from "../components/ui";

/** Platform rules every channel owner accepts before selling. */
export const BANNED: [string, string][] = [
  ["18+ va fahsh kontent", "Pornografiya, erotika, yalang'ochlik, eskort va shunga o'xshash xizmatlar."],
  ["Zo'ravonlik va ekstremizm", "Urush, terrorizm, zo'ravonlik, ekstremizm va separatizm targ'iboti, millatlararo yoki diniy adovat, konstitutsiyaviy tuzumni zo'rlik bilan o'zgartirishga chaqiriq."],
  ["Firibgarlik", "«Kafolatli daromad», moliyaviy piramidalar, soxta signal va kurslar, va'da qilingan narsani bermaslik."],
  ["Giyohvand moddalar va qimor", "Giyohvand moddalar savdosi yoki targ'iboti, kazino, tikish (stavka), lotereyalar."],
  ["O'zganing kontenti", "Mualliflik huquqi sizga tegishli bo'lmagan kurslar, kitoblar, kinolar va boshqa materiallar."],
  ["Qonunga zid boshqa kontent", "O'zbekiston Respublikasi qonunlari taqiqlagan har qanday ma'lumot."],
];

export default function Rules() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-5 px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Platforma qoidalari</h1>
      <p className="text-sm leading-relaxed text-muted">
        Obuna orqali faqat qonuniy kontentga obuna sotiladi. Kanal egasi kanalni ulaganda shu qoidalarga rozilik beradi.
      </p>
      <Card className="flex flex-col divide-y divide-line">
        {BANNED.map(([t, d]) => (
          <div key={t} className="flex flex-col gap-1 p-4">
            <span className="font-semibold">{t}</span>
            <span className="text-sm leading-relaxed text-muted">{d}</span>
          </div>
        ))}
      </Card>
      <h2 className="text-lg font-semibold">Qoida buzilsa</h2>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-ink/85">
        <li>Kanal tekshiruvga tushadi: obuna sotilaveradi, lekin tekshiruv tugaguncha pul yechib bo'lmaydi.</li>
        <li>Qoidabuzarlik tasdiqlansa, kanal bloklanadi: yangi obuna va avto-uzaytirish to'xtaydi, pul yechish muzlatiladi, obunachilarga pul qaytarilishi mumkin.</li>
        <li>Bloklash sababi egasiga yoziladi. E'tiroz bo'lsa, botga oddiy xabar yozing, qo'llab-quvvatlashga boradi.</li>
        <li>Yangi kanallar uchun birinchi 14 kun tushum 7 kun ushlab turiladi.</li>
      </ul>
      <p className="text-sm leading-relaxed text-muted">
        Qoidabuzar kanalni ko'rsangiz, kanal sahifasidagi «Shikoyat qilish» tugmasini bosing.
      </p>
    </main>
  );
}
