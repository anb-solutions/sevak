// `pnpm db:seed`: loads the beta event into DATABASE_URL. Safe to run on every
// deploy (it does nothing if the event exists). Preview environments
// (SEVAK_ENV=preview) also get a made-up Admin, admin@example.org.
import { connect } from "@sevak/db";
import { seedBetaEvent } from "./seed";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const preview = process.env.SEVAK_ENV === "preview";
await seedBetaEvent(connect(url), preview ? { demoAdminEmail: "admin@example.org" } : {});
console.log(preview ? "Seeded the beta event and demo Admin." : "Seeded the beta event.");
process.exit(0);
