# Deploy

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
