// Database access for Sevak. With DATABASE_URL set it connects to Postgres;
// without it, it runs PGlite (Postgres inside Node) in memory, which is what
// local development, tests and Claude sessions use.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };

export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// Works for both drivers, so the same code runs in tests and production.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

// A fresh in-memory database with every migration applied. Used by tests and
// by local development when there's no DATABASE_URL.
export async function createMemoryDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return db;
}

// Connects to the Postgres at `url`. Migrations are applied separately, by
// `pnpm db:migrate` as a deploy step.
export function connect(url: string): Db {
  const client = postgres(url, { max: 10 });
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
