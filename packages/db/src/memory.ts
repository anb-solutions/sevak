// An in-memory PostgreSQL (PGlite) with every migration applied, for local
// development and tests. Never used in staging or production.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { type Db, migrationsFolder, schema } from "./index";

export async function createMemoryDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
  return db;
}
