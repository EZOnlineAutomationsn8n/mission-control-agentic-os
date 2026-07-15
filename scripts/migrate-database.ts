import { promises as fs } from "node:fs";
import path from "node:path";
import { databasePool } from "../src/lib/persistence/database";

const directory = path.join(process.cwd(), "migrations");
const files = (await fs.readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
const pool = databasePool();
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('mission-control-migrations'))");
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  for (const file of files) {
    const exists = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
    if (exists.rowCount) continue;
    await client.query(await fs.readFile(path.join(directory, file), "utf8"));
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    console.log(`applied ${file}`);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
