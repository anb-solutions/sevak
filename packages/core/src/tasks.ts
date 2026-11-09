// One-off database tasks, run as `pnpm db:migrate` / `pnpm db:seed` locally,
// and in Google Cloud as a Cloud Run job before each deploy (see
// .github/workflows/deploy.yml). In the deploy image this file is bundled
// into tasks.mjs.
//
//   migrate  apply pending migrations to DATABASE_URL
//   seed     add demo data, by hand only, and only with SEVAK_ENV=staging;
//            deploys never seed: staging and production hold only what
//            people create there
//   deploy   what each deploy runs: migrations (the same everywhere)
import { connect, migrateDatabase } from "@sevak/db";
import { seedBetaEvent } from "./seed";

const command = process.argv[2];
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (command !== "migrate" && command !== "seed" && command !== "deploy") {
  console.error("Usage: tasks migrate | tasks seed | tasks deploy");
  process.exit(2);
}
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

if (command === "migrate" || command === "deploy") {
  await migrateDatabase(url);
  console.log("Migrations applied.");
}
if (command === "seed") {
  const env = process.env.SEVAK_ENV ?? "";
  if (env !== "staging") {
    console.log(`Not seeding (SEVAK_ENV=${env || "unset"}). Only staging gets demo data.`);
  } else {
    await seedBetaEvent(connect(url), { demoAdminEmail: "admin@example.org" });
    console.log("Seeded staging with demo data.");
  }
}
process.exit(0);
