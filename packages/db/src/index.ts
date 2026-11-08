// Database access for Sevak: PostgreSQL through Drizzle. Production and
// staging connect with DATABASE_URL. Local development and tests use an
// in-memory database instead, from "@sevak/db/memory", which production code
// never loads.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };

// Where the SQL migrations are. The deploy image sets SEVAK_MIGRATIONS_DIR,
// because there the code is bundled into one file.
export const migrationsFolder =
  process.env.SEVAK_MIGRATIONS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// Works for every driver, so the same code runs in tests and production.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

// Connects to the Postgres at `url`. Prepared statements are off so the same
// code works through a connection pooler (such as Neon's) as well as directly.
export function connect(url: string): Db {
  const client = postgres(url, { max: 5, prepare: false });
  return drizzlePostgres(client, { schema });
}

export async function migrateDatabase(url: string) {
  const client = postgres(url, { max: 1 });
  try {
    await migratePostgres(drizzlePostgres(client, { schema }), { migrationsFolder });
  } finally {
    await client.end();
  }
}
