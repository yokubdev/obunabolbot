import { createDb } from "./db.js";
import { migrate } from "./migrate.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const sql = createDb(url, { max: 1 });
const applied = await migrate(sql);
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Nothing to apply");
await sql.end();
