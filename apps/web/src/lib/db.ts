// One database connection for the app. With DATABASE_URL it uses Postgres;
// otherwise (local development) an in-memory PGlite database with demo data.
import { connect, createMemoryDb, type Db } from "@sevak/db";
import { seedBetaEvent } from "@sevak/core";

const globalForDb = globalThis as unknown as { sevakDb?: Promise<Db> };

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) return connect(url);
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL must be set in production.");
  }
  const db = await createMemoryDb();
  await seedBetaEvent(db, { demoAdminEmail: "admin@example.org" });
  console.log("Using an in-memory database with demo data (no DATABASE_URL set).");
  return db;
}

export function getDb(): Promise<Db> {
  globalForDb.sevakDb ??= open();
  return globalForDb.sevakDb;
}
