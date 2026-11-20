import { Pool } from "pg";

let pool: Pool | null = null;

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function dbPool() {
  // Keep module evaluation side-effect free during `next build`; requests still fail clearly
  // when no database was configured because the placeholder host is not reachable.
  const connectionString =
    process.env.DATABASE_URL?.trim() || "postgresql://dotty:dotty@127.0.0.1:5432/dotty";

  pool ??= new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: "dotty",
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  return pool;
}

export async function closeDbPool() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
