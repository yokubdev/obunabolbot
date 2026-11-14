# Obuna

Telegram yopiq kanallariga pullik obuna platformasi: obunachi Mini App orqali tarif tanlaydi va
Uzcard/Humo karta bilan (ATMOS) to'laydi, bot bir martalik havola beradi, muddat tugaganda kanaldan
chiqaradi. Har bir kanal egasiga **virtual kassa** avtomatik ochiladi: to'lovdan komissiya ushlanadi,
qolgani kassaga tushadi va ega uni kartasiga yechib oladi.

## Tuzilma

```
apps/
  api/      NestJS backend (REST, Telegram initData auth)
  bot/      grammY bot + rejalashtiruvchi (avto-uzaytirish, eslatma, chiqarish)
  web/      React + Vite: obunachi Mini App va kanal egasi paneli
packages/
  core/     PostgreSQL sxemasi, kassa (ledger), obuna logikasi + testlar
  atmos/    ATMOS to'lov mijozi (va lokal MockProvider)
  telegram/ initData tekshiruvi, bot xabarlari, havola berish/olish
```

## Ishga tushirish

```bash
pnpm install
docker compose up -d          # PostgreSQL
cp .env.example .env          # BOT_TOKEN va boshqalarni to'ldiring
pnpm build
pnpm seed                     # ixtiyoriy: demo ma'lumot (ega tg id 111)
pnpm dev:api                  # http://localhost:3000
pnpm dev:bot
pnpm dev:web                  # http://localhost:5173
```

Telegramsiz brauzerda sinash uchun (`DEV_AUTH=true`):

- obunachi: `http://localhost:5173/c/fitness-akademiya?dev=2001` (SMS-kod mock rejimida `111111`)
- kanal egasi: `http://localhost:5173/owner?dev=111`
- platforma admini (`PLATFORM_ADMIN_IDS=111`): `http://localhost:5173/platform?dev=111`

Telegram ichida ishlatish uchun `apps/web` ni https orqali oching (masalan, tunnel) va
`WEBAPP_URL` ga yozing; BotFather'da Mini App manzilini ham shu qiling.

## Testlar

```bash
createdb obuna_test
TEST_DATABASE_URL=postgres://localhost/obuna_test pnpm test
```

## Pul qanday yuradi

1. Obunachi to'laydi → ATMOS'da platformaning bitta kassasiga tushadi.
2. `ledger_entries` ga ikki yozuv: `+to'lov` va `−komissiya` (24 soat ushlab turiladi).
3. Kassa balansi har doim `SUM(ledger_entries.amount)`, alohida saqlanmaydi.
4. Ega pul yechadi → `−withdrawal` yozuvi darhol, so'rov `pending`.
5. Hozircha platforma admini pulni qo'lda o'tkazib `/platform` da "O'tkazildi" bosadi;
   rad etilsa, pul kassaga qaytadi. ATMOS kartaga payout yoqilgach, shu qadam avtomatlashtiriladi.

## Production'dan oldin

- ATMOS sandbox kalitlari bilan `ATMOS_MOCK=false` sinovi (endpointlar docs.atmos.uz bo'yicha yozilgan, real kalit bilan tekshirilmagan).
- Karta raqamlarini (`withdrawals.card_number`) shifrlash.
- ATMOS'dan kartaga payout va litsenziya masalasini tasdiqlash.
- Kunlik solishtirish (ATMOS hisoboti ↔ `payments`).
