import "dotenv/config";
import { Client } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

function parseDbName(connectionString: string): { adminUrl: string; dbName: string } {
  const url = new URL(connectionString);
  const dbName = url.pathname.replace(/^\//, "");
  if (!dbName) throw new Error("DATABASE_URL must include a database name");
  const adminUrl = new URL(connectionString);
  adminUrl.pathname = "/postgres";
  return { adminUrl: adminUrl.toString(), dbName };
}

async function ensureDatabaseExists() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const { adminUrl, dbName } = parseDbName(connectionString);

  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      dbName,
    ]);
    if (rowCount === 0) {
      console.log(`Creating database "${dbName}"...`);
      // Identifier cannot be parameterized; dbName is validated as a URL path segment above.
      await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }
}

async function runMigrations() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set(
      (await client.query("SELECT filename FROM _migrations")).rows.map((r) => r.filename)
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      console.log(`Applying ${file}...`);
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
    console.log("Migrations up to date.");
  } finally {
    await client.end();
  }
}

async function main() {
  await ensureDatabaseExists();
  await runMigrations();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
