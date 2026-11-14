# One build for the whole monorepo, then a small image per service:
#   docker build --target api .   docker build --target bot .   docker build --target web .
# The default (last) target `app` is everything in one container: API + bot webhook + jobs + web.
# Railway/Render build that one.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# The Mini App calls the API on the same domain (/api), so no API URL is baked in.
ENV VITE_API_URL=""
RUN pnpm build
RUN pnpm deploy --filter @obuna/api --prod --legacy /out/api \
 && pnpm deploy --filter @obuna/bot --prod --legacy /out/bot

FROM node:22-alpine AS api
WORKDIR /app
COPY --from=build /out/api ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM node:22-alpine AS bot
WORKDIR /app
COPY --from=build /out/bot ./
ENV NODE_ENV=production
CMD ["node", "dist/main.js"]

FROM caddy:2-alpine AS web
COPY --from=build /app/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile

FROM node:22-alpine AS app
WORKDIR /app
COPY --from=build /out/api ./
COPY --from=build /app/apps/web/dist ./public
ENV NODE_ENV=production WEB_DIST=/app/public JOBS_INTERVAL_SEC=600
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/healthz || exit 1
CMD ["node", "dist/main.js"]
