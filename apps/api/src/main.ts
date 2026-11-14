import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { createDb, migrate } from "@obuna/core";
import { AppModule } from "./app.module.js";
import { loadConfig } from "./config.js";

const cfg = loadConfig();

// Apply pending migrations on boot so a fresh database just works.
const sql = createDb(cfg.databaseUrl, { max: 1 });
const applied = await migrate(sql);
if (applied.length) console.log(`Migrations applied: ${applied.join(", ")}`);
await sql.end();

const app = await NestFactory.create(AppModule.forConfig(cfg));
app.enableCors({ origin: true, allowedHeaders: ["Authorization", "Content-Type", "X-Dev-User", "X-Dev-Name"] });
app.enableShutdownHooks();
await app.listen(cfg.port);
console.log(`API http://localhost:${cfg.port}`);
