import "reflect-metadata";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";
import { createDb, migrate } from "@obuna/core";
import { AppModule } from "./app.module.js";
import { loadConfig } from "./config.js";

const cfg = loadConfig();

// Apply pending migrations on boot so a fresh database just works.
const sql = createDb(cfg.databaseUrl, { max: 1 });
const applied = await migrate(sql);
if (applied.length) console.log(`Migrations applied: ${applied.join(", ")}`);
await sql.end();

const app = await NestFactory.create<NestExpressApplication>(AppModule.forConfig(cfg));
app.enableCors({ origin: true, allowedHeaders: ["Authorization", "Content-Type", "X-Dev-User", "X-Dev-Name"] });
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
