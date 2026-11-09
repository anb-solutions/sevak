import { beforeEach, describe, expect, it } from "vitest";
import { type Db, users } from "@sevak/db";
import { createMemoryDb } from "@sevak/db/memory";
import type { Viewer } from "./auth";
import { writeEvents } from "./events";
import { joinWithCode } from "./memberships";
import { writeOrganizations } from "./records";
import { readSignups, writeSignups } from "./signups";

let db: Db;
let asha: Viewer; // Admin
let mei: Viewer; // volunteer
let ravi: Viewer; // volunteer
let sam: Viewer; // not a volunteer

async function person(email: string): Promise<Viewer> {
  const [u] = await db.insert(users).values({ email }).returning();
  return { id: u!.id, email, isPlatformAdmin: false };
}

const signup = (id: string, email: string, extra: Record<string, unknown> = {}) => ({
  id,
  registrationId: `reg-${id}`,
  eventId: "ev-1",
  shiftId: "s1",
  name: email.split("@")[0],
  email,
  phone: "+17135550100",
  status: "confirmed",
  ...extra,
});

beforeEach(async () => {
  db = await createMemoryDb();
  asha = await person("asha@example.com");
  mei = await person("mei@example.com");
  ravi = await person("ravi@example.com");
  sam = await person("sam@example.com");
  await writeOrganizations(db, asha, { upsert: [{ id: "org-temple", name: "Temple", team: [], inviteCode: "SEVA4242" }] });
  await writeEvents(db, asha, {
    upsert: [
      {
        id: "ev-1",
        organizationId: "org-temple",
        title: "Seva",
        status: "published",
        visibility: "public",
        roles: [{ id: "r1", name: "Setup", shifts: [{ id: "s1", capacity: 2 }, { id: "s2", capacity: 1 }] }],
      },
      { id: "ev-draft", organizationId: "org-temple", title: "Draft", status: "draft", roles: [{ id: "r", shifts: [{ id: "s1", capacity: 5 }] }] },
    ],
  });
  await joinWithCode(db, mei, "SEVA4242", "");
  await joinWithCode(db, ravi, "SEVA4242", "");
});

describe("signing up", () => {
  it("lets a volunteer sign up, as themselves", async () => {
    const r = await writeSignups(db, mei, { upsert: [signup("su-1", "someone-else@example.com")] });
    expect(r.refused).toBe(0);
    expect((await readSignups(db, mei))[0]).toMatchObject({ id: "su-1", email: "mei@example.com", status: "confirmed" });
  });

  it("refuses people who don't volunteer with the organization, and draft events", async () => {
    expect(await writeSignups(db, sam, { upsert: [signup("su-1", "sam@example.com")] })).toMatchObject({ refused: 1, reason: "not_member" });
    expect((await writeSignups(db, mei, { upsert: [signup("su-2", "mei@example.com", { eventId: "ev-draft" })] })).refused).toBe(1);
  });

  it("never overbooks a shift", async () => {
    await writeSignups(db, mei, { upsert: [signup("su-1", "mei@example.com", { shiftId: "s2" })] });
    expect(await writeSignups(db, ravi, { upsert: [signup("su-2", "ravi@example.com", { shiftId: "s2" })] })).toMatchObject({ refused: 1, reason: "full" });
  });

  it("gives the last spot to only one of two people signing up at once", async () => {
    const results = await Promise.all([
      writeSignups(db, mei, { upsert: [signup("su-1", "mei@example.com", { shiftId: "s2" })] }),
      writeSignups(db, ravi, { upsert: [signup("su-2", "ravi@example.com", { shiftId: "s2" })] }),
    ]);
    expect(results.map((r) => r.refused).sort()).toEqual([0, 1]);
    expect((await readSignups(db, asha)).filter((s) => s.shiftId === "s2")).toHaveLength(1);
  });

  it("allows one confirmed spot per person per shift", async () => {
    await writeSignups(db, mei, { upsert: [signup("su-1", "mei@example.com")] });
    expect(await writeSignups(db, mei, { upsert: [signup("su-2", "mei@example.com")] })).toMatchObject({ refused: 1, reason: "already" });
  });
});

describe("who sees sign-ups", () => {
  it("shows others only that spots are taken, never names", async () => {
    await writeSignups(db, mei, { upsert: [signup("su-1", "mei@example.com")] });
    const seenByRavi = await readSignups(db, ravi);
    expect(seenByRavi).toEqual([{ id: "su-1", eventId: "ev-1", shiftId: "s1", status: "confirmed", anonymous: true }]);
    expect(JSON.stringify(await readSignups(db, null))).not.toContain("mei");
    expect((await readSignups(db, asha))[0]).toMatchObject({ email: "mei@example.com", name: "mei" });
  });
});

describe("after signing up", () => {
  beforeEach(async () => {
    await writeSignups(db, mei, { upsert: [signup("su-1", "mei@example.com")] });
  });

  it("lets you check in, log hours (always pending) and cancel", async () => {
    const [mine] = await readSignups(db, mei);
    const logged = { ...mine, checkInAt: "2027-01-10T15:00:00Z", hours: { minutes: 120, method: "duration", status: "approved", approvedMinutes: 999 } };
    expect((await writeSignups(db, mei, { upsert: [logged] })).refused).toBe(0);
    expect((await readSignups(db, mei))[0]).toMatchObject({ checkInAt: "2027-01-10T15:00:00Z", hours: { minutes: 120, status: "pending" } });
    expect((await readSignups(db, mei))[0]!.hours).not.toHaveProperty("approvedMinutes");

    expect((await writeSignups(db, mei, { upsert: [{ ...(await readSignups(db, mei))[0], status: "cancelled" }] })).refused).toBe(0);
    expect((await readSignups(db, ravi))).toEqual([]); // the spot is free again
  });

  it("lets the event's team approve hours; nobody else", async () => {
    const [mine] = await readSignups(db, mei);
    await writeSignups(db, mei, { upsert: [{ ...mine, hours: { minutes: 90, method: "duration" } }] });
    const [roster] = await readSignups(db, asha);
    const approved = { ...roster, hours: { ...(roster!.hours as object), status: "approved", decidedBy: "asha@example.com" } };
    expect((await writeSignups(db, ravi, { upsert: [{ ...approved, email: "mei@example.com" }] })).refused).toBe(1);
    expect((await writeSignups(db, asha, { upsert: [approved] })).refused).toBe(0);
    expect((await readSignups(db, mei))[0]).toMatchObject({ hours: { status: "approved" } });
  });

  it("doesn't let you move a sign-up to another shift, or delete it", async () => {
    const [mine] = await readSignups(db, mei);
    expect((await writeSignups(db, mei, { upsert: [{ ...mine, shiftId: "s2" }] })).refused).toBe(1);
    expect((await writeSignups(db, mei, { delete: ["su-1"] })).refused).toBe(1);
    expect((await writeSignups(db, asha, { delete: ["su-1"] })).refused).toBe(0);
  });
});
