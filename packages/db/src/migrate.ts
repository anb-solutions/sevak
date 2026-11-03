// Applies pending migrations to DATABASE_URL. Railway runs this before each deploy.
import { migrateDatabase } from "./index";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
await migrateDatabase(url);
console.log("Migrations applied.");
