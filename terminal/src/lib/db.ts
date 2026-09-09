import "server-only";
import { Pool, type QueryResultRow } from "pg";
import { env } from "@/lib/env";

declare global {
  var __terminalPgPool: Pool | undefined;
}

function createPool(): Pool {
  return new Pool({
    connectionString: env.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

// Reuse the pool across hot reloads in dev instead of opening a new one per request.
export const pool = globalThis.__terminalPgPool ?? createPool();
if (env.nodeEnv !== "production") {
  globalThis.__terminalPgPool = pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
) {
  return pool.query<T>(text, params);
}
