import { beforeEach, describe, expect, it } from "vitest";
import { type Db, users } from "@sevak/db";
import { createMemoryDb } from "@sevak/db/memory";
import type { Viewer } from "./auth";
import { readEventsAndMain, writeEvents, writeMainEvents } from "./events";
import { joinWithCode } from "./memberships";
import { writeOrganizations } from "./records";

let db: Db;
let asha: Viewer; // Admin of the temple
let ravi: Viewer; // Coordinator of the temple
let mei: Viewer; // a volunteer with the temple
let sam: Viewer; // nobody to the temple
let staff: Viewer;

async function person(email: string, isPlatformAdmin = false): Promise<Viewer> {
  const [u] = await db.insert(users).values({ email }).returning();
  return { id: u!.id, email, isPlatformAdmin };
}

const temple = (extra: Record<string, unknown> = {}) => ({
  id: "org-temple",
  name: "Temple Volunteers",
  team: [{ email: "ravi@example.com", role: "coordinator" }],
  inviteCode: "SEVA4242",
  ...extra,
});

const event = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  organizationId: "org-temple",
  title: `Event ${id}`,
  status: "published",
  visibility: "public",
  active: true,
  roles: [{ id: "r1", name: "Setup", shifts: [{ id: "s1", date: "2027-01-10", start: "09:00", end: "12:00", capacity: 5 }] }],
  ...extra,
});

const titles = async (viewer: Viewer | null) => (await readEventsAndMain(db, viewer)).events.map((e) => e.id).sort();

beforeEach(async () => {
  db = await createMemoryDb();
  asha = await person("asha@example.com");
  ravi = await person("ravi@example.com");
  mei = await person("mei@example.com");
  sam = await person("sam@example.com");
  staff = await person("staff@example.com", true);
  await writeOrganizations(db, asha, { upsert: [temple()] });
  await joinWithCode(db, mei, "SEVA4242", "");
});

describe("who sees which events", () => {
  beforeEach(async () => {
    const r = await writeEvents(db, asha, {
      upsert: [
        event("ev-public"),
        event("ev-private", { visibility: "private" }),
        event("ev-draft", { status: "draft" }),
        event("ev-inactive", { active: false }),
      ],
    });
    expect(r.refused).toBe(0);
  });

  it("shows the team everything", async () => {
    expect(await titles(ravi)).toEqual(["ev-draft", "ev-inactive", "ev-private", "ev-public"]);
  });

  it("shows volunteers published, active events, public or private", async () => {
    expect(await titles(mei)).toEqual(["ev-private", "ev-public"]);
  });

  it("shows everyone else nothing until the organization is verified, then its public events", async () => {
    expect(await titles(sam)).toEqual([]);
    expect(await titles(null)).toEqual([]);
    await writeOrganizations(db, staff, { upsert: [temple({ verificationStatus: "verified", createdBy: "asha@example.com" })] });
    expect(await titles(sam)).toEqual(["ev-public"]);
    expect(await titles(null)).toEqual(["ev-public"]);
  });
});

describe("who changes events", () => {
  it("lets Admins and Coordinators add and edit", async () => {
    expect((await writeEvents(db, asha, { upsert: [event("ev-1")] })).refused).toBe(0);
    expect((await writeEvents(db, ravi, { upsert: [event("ev-1", { title: "Renamed" })] })).refused).toBe(0);
    expect((await readEventsAndMain(db, asha)).events[0]!.title).toBe("Renamed");
  });

  it("refuses people not on the team, including volunteers", async () => {
    await writeEvents(db, asha, { upsert: [event("ev-1")] });
    for (const who of [mei, sam]) {
      const r = await writeEvents(db, who, { upsert: [event("ev-1", { title: "Taken" }), event("ev-new")], delete: ["ev-1"] });
      expect(r.refused).toBe(3);
    }
    expect((await readEventsAndMain(db, asha)).events.map((e) => e.title)).toEqual(["Event ev-1"]);
  });

  it("can't move an event into, or out of, an organization you're not on", async () => {
    await writeOrganizations(db, sam, { upsert: [{ id: "org-sam", name: "Sam's", team: [] }] });
    await writeEvents(db, asha, { upsert: [event("ev-1")] });
    expect((await writeEvents(db, sam, { upsert: [event("ev-1", { organizationId: "org-sam" })] })).refused).toBe(1);
    expect((await writeEvents(db, asha, { upsert: [event("ev-1", { organizationId: "org-sam" })] })).refused).toBe(1);
  });

  it("lets only Admins delete (EVT-19)", async () => {
    await writeEvents(db, asha, { upsert: [event("ev-1")] });
    expect((await writeEvents(db, ravi, { delete: ["ev-1"] })).refused).toBe(1);
    expect((await writeEvents(db, asha, { delete: ["ev-1"] })).refused).toBe(0);
    expect(await titles(asha)).toEqual([]);
  });

  it("refuses demo records and bad ids", async () => {
    expect((await writeEvents(db, asha, { upsert: [event("demo-ev-1"), event("../x")] })).refused).toBe(2);
  });
});

describe("main events", () => {
  it("are shown to people who can see one of their events", async () => {
    await writeMainEvents(db, asha, { upsert: [{ id: "main-fest", organizationId: "org-temple", title: "Festival" }, { id: "main-empty", organizationId: "org-temple", title: "Later" }] });
    await writeEvents(db, asha, { upsert: [event("ev-1", { mainEventId: "main-fest" })] });
    expect((await readEventsAndMain(db, asha)).mainEvents.map((m) => m.id).sort()).toEqual(["main-empty", "main-fest"]);
    expect((await readEventsAndMain(db, mei)).mainEvents.map((m) => m.id)).toEqual(["main-fest"]);
    expect((await readEventsAndMain(db, sam)).mainEvents).toEqual([]);
  });

  it("follow the same rules for changes", async () => {
    expect((await writeMainEvents(db, sam, { upsert: [{ id: "main-1", organizationId: "org-temple" }] })).refused).toBe(1);
    await writeMainEvents(db, ravi, { upsert: [{ id: "main-1", organizationId: "org-temple" }] });
    expect((await writeMainEvents(db, ravi, { delete: ["main-1"] })).refused).toBe(1);
    expect((await writeMainEvents(db, asha, { delete: ["main-1"] })).refused).toBe(0);
  });
});
