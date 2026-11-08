// Applies pending migrations. Runs in each staging and production build on
// Vercel, before the new version goes live. Uses the direct (unpooled)
// connection when there is one, since migrations need a real session.
import { migrateDatabase } from "./index";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
await migrateDatabase(url);
console.log("Migrations applied.");
