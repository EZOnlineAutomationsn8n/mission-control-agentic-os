import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

declare global {
  // Reuse the pool across Next.js development reloads and server route modules.
  var missionControlDatabasePool: Pool | undefined;
}

export function databaseEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function databasePool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if (!globalThis.missionControlDatabasePool) {
    globalThis.missionControlDatabasePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_SIZE || 10),
      connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 5_000),
      idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 30_000),
      ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: true } : false,
    });
  }
  return globalThis.missionControlDatabasePool;
}

export function databaseQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  return databasePool().query<T>(text, values);
}

export async function withDatabaseTransaction<T>(
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await databasePool().connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
