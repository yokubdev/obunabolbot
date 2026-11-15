/** Public offer for subscribers. A draft: the final text needs a lawyer's review before launch. */
const POINTS: [string, string][] = [
  ["Kim nimani sotadi", "Obunani kanal egasi (ijodkor) sotadi. Obuna platformasi to'lovni qabul qiladi, kirishni beradi va pulni ijodkorga o'tkazadi."],
  ["Kirish", "To'lovdan keyin bot sizni yopiq kanal yoki guruhga qo'shadi. Muddat tugaganda kirish yopiladi."],
  ["Avto-uzaytirish", "Yoqilgan bo'lsa, muddat tugashidan oldin o'sha narxda kartadan yechiladi. Narx o'zgarsa, avto-uzaytirish to'xtaydi. Uni istalgan vaqtda «Obunalarim» bo'limida o'chirasiz."],
  ["Bepul sinov", "Har bir kanal uchun bir marta, kartasiz. Muddat tugaganda kirish yopiladi."],
  ["Pulni qaytarish", "Kanal qoidabuzarlik uchun bloklansa, foydalanilmagan muddat uchun pul qaytarilishi mumkin. Boshqa holatlarda botga yozing, ko'rib chiqamiz."],
  ["Ma'lumotlar", "Telegram ismingiz, foydalanuvchi nomingiz, tilingiz va to'lovlar tarixi saqlanadi. Karta raqami to'lov provayderida saqlanadi, bizda faqat oxirgi 4 raqam."],
];

export default function Offer() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-5 px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Ommaviy oferta</h1>
      <p className="text-sm leading-relaxed text-muted">To'lov yoki bepul sinovni boshlash orqali quyidagi shartlarga rozilik bildirasiz.</p>
      {POINTS.map(([t, d]) => (
        <section key={t} className="flex flex-col gap-1">
          <h2 className="font-semibold">{t}</h2>
          <p className="text-sm leading-relaxed text-ink/85">{d}</p>
        </section>
      ))}
    </main>
  );
}
