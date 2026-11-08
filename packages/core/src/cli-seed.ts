// `pnpm db:seed`: fills the staging database with demo data (the sample event
// and a made-up Admin, admin@example.org). Runs in every build and does
// nothing when the data is already there. Production is never seeded:
// organizations and events there are created by real people in the app.
import { connect } from "@sevak/db";
import { seedBetaEvent } from "./seed";

const env = process.env.SEVAK_ENV || process.env.VERCEL_TARGET_ENV || "";
if (env !== "staging") {
  console.log(`Not seeding (environment: ${env || "unset"}). Only staging gets demo data.`);
  process.exit(0);
}
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
await seedBetaEvent(connect(url), { demoAdminEmail: "admin@example.org" });
console.log("Seeded staging with demo data.");
process.exit(0);
