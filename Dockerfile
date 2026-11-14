# One build for the whole monorepo, then a small image per service:
#   docker build --target api .   docker build --target bot .   docker build --target web .
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
