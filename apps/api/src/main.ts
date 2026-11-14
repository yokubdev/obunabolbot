import "reflect-metadata";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { createDb, migrate } from "@obuna/core";
import { rateLimit } from "./common/rate-limit.js";
import { AppModule } from "./app.module.js";
import { loadConfig } from "./config.js";

const cfg = loadConfig();

// Apply pending migrations on boot so a fresh database just works.
const sql = createDb(cfg.databaseUrl, { max: 1 });
const applied = await migrate(sql);
if (applied.length) console.log(`Migrations applied: ${applied.join(", ")}`);
await sql.end();

const app = await NestFactory.create<NestExpressApplication>(AppModule.forConfig(cfg));
// Railway/Render terminate TLS in front of us: trust one proxy hop so req.ip is the client.
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    // The Mini App runs inside Telegram's iframe (web.telegram.org) and loads telegram-web-app.js,
    // so framing must be allowed for Telegram and the CSP is scoped to what the app actually uses.
    frameguard: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": ["'self'", "https://telegram.org"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": ["'self'", "data:", "https:"],
        "connect-src": ["'self'"],
        "frame-ancestors": ["'self'", "https://web.telegram.org", "https://*.telegram.org"],
        // HSTS already forces https in production; this would only break local http testing.
        "upgrade-insecure-requests": null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
// Same-origin in production (the web app is served from here); any origin only in development.
app.enableCors({
  origin: cfg.publicUrl ? [cfg.publicUrl] : true,
  allowedHeaders: ["Authorization", "Content-Type", ...(cfg.devAuth ? ["X-Dev-User", "X-Dev-Name"] : [])],
});
// Coarse per-IP limits; the checkout and withdrawal routes have their own per-user limits in the DB.
app.use("/api", rateLimit({ windowMs: 60_000, max: 120 }));
app.use("/api/checkout", rateLimit({ windowMs: 60_000, max: 20 }));
app.enableShutdownHooks();

// One service for everything: the Mini App and owner panel are served from the same origin as /api.
if (cfg.webDist) {
  const dist = resolve(cfg.webDist);
  const index = join(dist, "index.html");
  if (!existsSync(index)) throw new Error(`WEB_DIST=${dist} has no index.html`);
  app.useStaticAssets(dist, { index: false, maxAge: "1h" });
  const apiPaths = /^\/(api|telegram|internal|healthz)(\/|$)/;
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" || apiPaths.test(req.path)) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(index); // SPA fallback: /c/<slug>, /my, /owner/... are client routes.
  });
}

await app.listen(cfg.port, "0.0.0.0");
console.log(`Obuna listening on :${cfg.port}${cfg.webDist ? " (API + web)" : " (API)"}`);
