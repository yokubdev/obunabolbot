import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Sql } from "./db.js";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

/** Applies every migrations/*.sql file not yet recorded in schema_migrations, in name order. */
export async function migrate(sql: Sql): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  const done = new Set((await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const body = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    applied.push(file);
  }
  return applied;
}
