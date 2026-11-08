// One-off database tasks, run as `pnpm db:migrate` / `pnpm db:seed` locally,
// and in Google Cloud as a Cloud Run job before each deploy (see
// .github/workflows/deploy.yml). In the deploy image this file is bundled
// into tasks.mjs.
//
//   migrate  apply pending migrations to DATABASE_URL
//   seed     add demo data, on staging only (SEVAK_ENV=staging); production
//            is never seeded: real people create organizations there
import { connect, migrateDatabase } from "@sevak/db";
import { seedBetaEvent } from "./seed";

const command = process.argv[2];
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (command !== "migrate" && command !== "seed") {
  console.error("Usage: tasks migrate | tasks seed");
  process.exit(2);
}
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

if (command === "migrate") {
  await migrateDatabase(url);
  console.log("Migrations applied.");
} else {
  const env = process.env.SEVAK_ENV ?? "";
  if (env !== "staging") {
    console.log(`Not seeding (SEVAK_ENV=${env || "unset"}). Only staging gets demo data.`);
  } else {
    await seedBetaEvent(connect(url), { demoAdminEmail: "admin@example.org" });
    console.log("Seeded staging with demo data.");
  }
}
process.exit(0);
