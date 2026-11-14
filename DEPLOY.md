# Deploy

## Tez yo'l: Railway (bitta servis)

Docker image'ning standart target'i (`app`) hammasini bitta konteynerda ishga tushiradi:

```
https://<servis>.up.railway.app/          → Mini App va kanal egasi paneli (React)
https://<servis>.up.railway.app/api/*     → NestJS API
https://<servis>.up.railway.app/telegram/webhook → bot (grammY, webhook rejimi)
ichki taymer (JOBS_INTERVAL_SEC=600)      → avto-uzaytirish, eslatmalar, muddati tugaganlarni chiqarish
```

1. Railway → **New Project → Deploy from GitHub repo** → `obuna` reposi. `railway.json` Dockerfile'ni o'zi tanlaydi.
2. Shu loyihaga **+ New → Database → PostgreSQL** qo'shing.
3. Servis → **Settings → Networking → Generate Domain** (masalan `obuna-production.up.railway.app`).
4. Servis → **Variables**:

| O'zgaruvchi | Qiymat |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `BOT_TOKEN` | @BotFather bergan token |
| `BOT_USERNAME` | `obunalar_uz_bot` |
| `PUBLIC_URL` | `https://` + 3-qadamdagi domen |
| `WEBHOOK_SECRET` | istalgan uzun tasodifiy satr (faqat `A-Z a-z 0-9 _ -`) |
| `JOBS_SECRET` | boshqa tasodifiy satr |
| `PLATFORM_ADMIN_IDS` | Telegram ID'ingiz |
| `DEV_AUTH` | `false` |
| `ATMOS_MOCK` | `true` (sandbox kalitlari kelguncha) |

Deploy tugagach API o'zi: migratsiyalarni bajaradi, Telegram webhook'ni o'rnatadi, menyu tugmasi "Obunalarim",
buyruqlar va bot tavsifini qo'yadi. Logda `Telegram webhook -> ...` qatorini ko'rasiz. Tekshirish: `GET /healthz` → `{"ok":true}`.

BotFather'da qo'lda faqat bitta narsa (ixtiyoriy): `/newapp` → URL = `PUBLIC_URL`, shunda `t.me/<bot>/<app>` havolasi ham ishlaydi.
Kanal egalari uchun havola `t.me/<bot>?start=<kanal>` busiz ham ishlaydi.

Replika soni 1 bo'lsin (`railway.json`da shunday): jobs taymeri har replikada ishlaydi.

## Bepul variant: Render + Neon

`render.yaml` bor: Render → **New → Blueprint** → repo. Bazani Neon'da bepul oching va `DATABASE_URL`ga qo'ying.
Bepul instans 15 daqiqa harakatsiz qolsa uxlaydi, shuning uchun cron-job.org'da har 10 daqiqada
`POST https://<servis>.onrender.com/internal/jobs` (header `x-jobs-secret: <JOBS_SECRET>`) chaqiruvini sozlang:
u ham jobs'ni ishga tushiradi, ham servisni uyg'oq tutadi.

## O'z serveringiz (VPS, docker compose)

Hammasi bitta serverda, bitta domen ostida ishlaydi:

```
https://DOMAIN/        → React Mini App va kanal egasi paneli (Caddy)
https://DOMAIN/api/*   → NestJS API
bot                    → grammY (long polling, ochiq port kerak emas)
db                     → PostgreSQL (faqat ichki tarmoqda)
```

Caddy Let's Encrypt sertifikatini o'zi oladi (Telegram Mini App faqat HTTPS bilan ishlaydi).

## Kerak bo'ladigan narsalar

1. **Server:** Docker o'rnatilgan istalgan Linux VPS, kamida 1 vCPU / 1 GB RAM.
   O'zbekiston fuqarolarining shaxsiy ma'lumotlari O'zbekistondagi serverda saqlanishi talab qilinadi, shuning uchun mahalliy hostingni ko'rib chiqing.
2. **Domen yoki subdomen:** masalan `obuna.example.uz`; A yozuvi server IP manziliga qaratilgan bo'lsin.
3. **Bot token:** @BotFather → /newbot.
4. **Telegram ID'ingiz:** `PLATFORM_ADMIN_IDS` uchun (pul yechish so'rovlarini tasdiqlaysiz).
5. **ATMOS sandbox kalitlari** (keyinroq): consumer key, consumer secret, store id.

## Qadamlar

```bash
# serverda
git clone <repo> obuna && cd obuna
cp .env.example .env
nano .env        # BOT_TOKEN, DOMAIN, POSTGRES_PASSWORD, PLATFORM_ADMIN_IDS, DEV_AUTH=false
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f bot
```

Keyin @BotFather'da:

- `/setmenubutton` → botingiz → `https://DOMAIN/my`, nomi "Obunalarim"
- `/newapp` → botingiz → URL `https://DOMAIN` (shunda `t.me/<bot>?startapp=<kanal>` havolalari ishlaydi)

## Yangilash va zaxira

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec db pg_dump -U obuna obuna > backup-$(date +%F).sql
```

## Haqiqiy to'lovlarni yoqish

`.env` da `ATMOS_MOCK=false` va ATMOS kalitlarini kiriting. Avval sandbox'da sinang.
