// Exactly what each kind of person gets when a page loads (readSynced), on a
// dataset with every case: verified and unverified organizations; public,
// private, draft and inactive events; Admins, Coordinators (running an
// event or not), volunteers, outsiders, Sevak staff and the signed-out.
// The snapshot was taken before page loads were made to read only the rows
// each person may see, so that change can't show anyone more, or less.
import { beforeAll, describe, expect, it } from "vitest";
import { type Db, users } from "@sevak/db";
import { createMemoryDb } from "@sevak/db/memory";
import type { Viewer } from "./auth";
import { writeCertificates } from "./certificates";
import { acceptUpload, writeDocuments } from "./documents";
import { writeEvents, writeMainEvents } from "./events";
import { writeMemberships } from "./memberships";
import { readOrganizations, readSynced, writeOrganizations, writeProfile } from "./records";
import { writeSignups } from "./signups";

let db: Db;
const people: Record<string, Viewer> = {};

async function person(name: string, isPlatformAdmin = false): Promise<Viewer> {
  const email = `${name}@example.com`;
  const [u] = await db.insert(users).values({ email }).returning();
  people[name] = { id: u!.id, email, isPlatformAdmin };
  return people[name]!;
}

const shift = (id: string, date = "2030-01-10") => ({ id, date, start: "09:00", end: "12:00", capacity: 5 });
const event = (id: string, orgId: string, extra: Record<string, unknown> = {}) => ({
  id,
  organizationId: orgId,
  title: id,
  status: "published",
  visibility: "public",
  active: true,
  startDate: "2030-01-10",
  endDate: "2030-01-10",
  roles: [{ id: `${id}-r`, name: "Setup", shifts: [shift(`${id}-s1`), shift(`${id}-s2`)] }],
  ...extra,
});

// Times change from run to run, and records saved together have no set
// order (the pages don't rely on one); everything else must not change.
const byId = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    const list = value.map(byId);
    return list.every((x) => x && typeof x === "object" && "id" in (x as object)) ? list.sort((a, b) => String((a as { id: unknown }).id).localeCompare(String((b as { id: unknown }).id))) : list;
  }
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, byId(v)]));
  return value;
};
const stable = (value: unknown) => byId(JSON.parse(JSON.stringify(value).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<time>")));

beforeAll(async () => {
  db = await createMemoryDb();
  const ada = await person("ada"); // Admin of the verified organization
  const cora = await person("cora"); // its Coordinator, event admin of ev-v-pub
  const carl = await person("carl"); // its Coordinator, running nothing
  const una = await person("una"); // Admin of the unverified organization
  const mei = await person("mei"); // volunteer with both
  const sam = await person("sam"); // asked to join the verified one
  const dev = await person("dev"); // declined
  await person("out"); // signed in, nothing to do with either
  const staff = await person("staff", true);

  await writeOrganizations(db, ada, {
    upsert: [{ id: "org-v", name: "Verified", inviteCode: "VERI2345", team: [{ email: "cora@example.com", name: "Cora", role: "coordinator" }, { email: "carl@example.com", name: "Carl", role: "coordinator" }], primaryContact: { name: "Ada", email: "ada@example.com", phone: "+15550000001" }, address: { city: "Houston", line1: "1 Main St" } }],
  });
  const [v] = (await readOrganizations(db, ada)).filter((o) => o.id === "org-v");
  await writeOrganizations(db, ada, { upsert: [{ ...v, verificationStatus: "pending" }] });
  const [pending] = (await readOrganizations(db, staff)).filter((o) => o.id === "org-v");
  await writeOrganizations(db, staff, { upsert: [{ ...pending, verificationStatus: "verified" }] });
  await writeOrganizations(db, una, { upsert: [{ id: "org-u", name: "Unverified", inviteCode: "UNVE2345", team: [] }] });

  await writeMainEvents(db, ada, { upsert: [{ id: "main-v", organizationId: "org-v", title: "Festival" }, { id: "main-v-hidden", organizationId: "org-v", title: "Hidden" }] });
  await writeEvents(db, ada, {
    upsert: [
      event("ev-v-pub", "org-v", { mainEventId: "main-v", eventAdmin: "cora@example.com" }),
      event("ev-v-priv", "org-v", { visibility: "private" }),
      event("ev-v-draft", "org-v", { status: "draft", mainEventId: "main-v-hidden" }),
      event("ev-v-off", "org-v", { active: false }),
    ],
  });
  await writeEvents(db, una, { upsert: [event("ev-u-pub", "org-u"), event("ev-u-priv", "org-u", { visibility: "private" })] });

  for (const p of [mei, sam, dev]) await writeProfile(db, p, { firstName: p.email.split("@")[0], lastName: "Test", phone: "+15551112222", aboutMe: "about " + p.email });
  await writeMemberships(db, ada, { upsert: [{ id: "m-mei-v", orgId: "org-v", email: "mei@example.com", status: "invited" }] });
  await writeMemberships(db, mei, { upsert: [{ id: "m-mei-v", orgId: "org-v", email: "mei@example.com", status: "active" }] });
  await writeMemberships(db, una, { upsert: [{ id: "m-mei-u", orgId: "org-u", email: "mei@example.com", status: "invited" }] });
  await writeMemberships(db, mei, { upsert: [{ id: "m-mei-u", orgId: "org-u", email: "mei@example.com", status: "active" }] });
  await writeMemberships(db, sam, { upsert: [{ id: "m-sam-v", orgId: "org-v", email: "sam@example.com", name: "Sam", status: "requested" }] });
  await writeMemberships(db, dev, { upsert: [{ id: "m-dev-v", orgId: "org-v", email: "dev@example.com", name: "Dev", status: "requested" }] });
  await writeMemberships(db, ada, { upsert: [{ id: "m-dev-v", orgId: "org-v", email: "dev@example.com", status: "declined" }] });

  const su = (id: string, eventId: string, shiftId: string, email: string) => ({ id, eventId, shiftId, email, name: email.split("@")[0], phone: "+15551112222", status: "confirmed" });
  await writeSignups(db, mei, { upsert: [su("su-1", "ev-v-pub", "ev-v-pub-s1", "mei@example.com"), su("su-2", "ev-v-priv", "ev-v-priv-s1", "mei@example.com"), su("su-3", "ev-u-pub", "ev-u-pub-s1", "mei@example.com")] });
  await writeSignups(db, ada, { upsert: [su("su-4", "ev-v-pub", "ev-v-pub-s2", "walkin@example.com"), su("su-5", "ev-v-draft", "ev-v-draft-s1", "walkin@example.com")] });

  await writeCertificates(db, mei, { upsert: [{ id: "c-1", orgId: "org-v", name: "Mei", from: "2030-01-01", to: "2030-01-31", status: "requested" }] });
  await writeDocuments(db, mei, { upsert: [{ id: "d-mei", owner: "profile:mei@example.com", name: "Mei's" }] });
  await writeDocuments(db, ada, { upsert: [{ id: "d-org", owner: "org:org-v", name: "Policy" }, { id: "d-ev", owner: "event:ev-v-pub", name: "Run sheet" }] });
  await writeDocuments(db, una, { upsert: [{ id: "d-u", owner: "org:org-u", name: "Theirs" }] });
  await acceptUpload(db, ada, "d-org", new TextEncoder().encode("%PDF-1.4 policy"));
});

describe("what a page load gives each person", () => {
  for (const who of ["signed out", "out", "mei", "sam", "dev", "carl", "cora", "ada", "una", "staff"]) {
    it(who, async () => {
      const viewer = who === "signed out" ? null : people[who]!;
      expect(stable(await readSynced(db, viewer))).toMatchSnapshot();
    });
  }
});
