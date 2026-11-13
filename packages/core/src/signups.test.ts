import { beforeEach, describe, expect, it } from "vitest";
import { type Db, users } from "@sevak/db";
import { createMemoryDb } from "@sevak/db/memory";
import type { Viewer } from "./auth";
import { writeEvents } from "./events";
import { joinWithCode } from "./memberships";
import { readOrganizations, writeOrganizations } from "./records";
import { readSignups, shiftEnded, writeSignups } from "./signups";

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

describe("nobody approves their own hours (ATT-3)", () => {
  let bea: Viewer; // a second Admin
  let cora: Viewer; // Coordinator, the event's admin

  const logged = { hours: { minutes: 60, method: "duration" } };
  const decide = (s: Record<string, unknown> | undefined, by: string, status = "approved") => ({
    ...s,
    hours: { ...(s!.hours as object), status, decidedBy: by },
  });
  const find = async (who: Viewer, id: string) => (await readSignups(db, who)).find((x) => x.id === id);

  beforeEach(async () => {
    bea = await person("bea@example.com");
    cora = await person("cora@example.com");
    const [org] = await readOrganizations(db, asha);
    await writeOrganizations(db, asha, {
      upsert: [{ ...org, team: [{ email: "bea@example.com", role: "admin" }, { email: "cora@example.com", role: "coordinator" }] }],
    });
    await writeEvents(db, asha, {
      upsert: [{ id: "ev-1", organizationId: "org-temple", title: "Seva", status: "published", visibility: "public", eventAdmin: "cora@example.com",
        roles: [{ id: "r1", name: "Setup", shifts: [{ id: "s1", capacity: 5 }, { id: "s2", capacity: 1 }] }] }],
    });
    // Asha (an Admin) volunteers too, and logs her hours; so does Mei.
    await writeSignups(db, asha, { upsert: [signup("su-asha", "asha@example.com", logged)] });
    await writeSignups(db, mei, { upsert: [signup("su-mei", "mei@example.com")] });
    await writeSignups(db, mei, { upsert: [{ ...(await find(mei, "su-mei")), ...logged }] });
  });

  it("refuses an Admin approving or not approving their own hours", async () => {
    const mine = await find(asha, "su-asha");
    expect(mine).toMatchObject({ hours: { minutes: 60 } });
    expect(await writeSignups(db, asha, { upsert: [decide(mine, "asha@example.com")] })).toMatchObject({ refused: 1, reason: "own_hours" });
    expect(await writeSignups(db, asha, { upsert: [decide(mine, "asha@example.com", "rejected")] })).toMatchObject({ refused: 1, reason: "own_hours" });
    expect((await find(asha, "su-asha"))!.hours).not.toMatchObject({ status: "approved" });
  });

  it("refuses an Admin adding themselves with hours already approved", async () => {
    const r = await writeSignups(db, asha, { upsert: [signup("su-new", "asha@example.com", { shiftId: "s2", hours: { minutes: 60, status: "approved" } })] });
    expect(r).toMatchObject({ refused: 1, reason: "own_hours" });
  });

  it("lets a different Admin approve an Admin's hours, but not a Coordinator", async () => {
    const hers = await find(bea, "su-asha");
    expect(await writeSignups(db, cora, { upsert: [decide(hers, "cora@example.com")] })).toMatchObject({ refused: 1, reason: "own_hours" });
    expect((await writeSignups(db, bea, { upsert: [decide(hers, "bea@example.com")] })).refused).toBe(0);
    expect(await find(asha, "su-asha")).toMatchObject({ hours: { status: "approved", decidedBy: "bea@example.com" } });
  });

  it("lets Sevak staff approve an Admin's hours (an organization with one Admin)", async () => {
    const staff: Viewer = { ...(await person("staff@sevak.example")), isPlatformAdmin: true };
    expect((await writeSignups(db, staff, { upsert: [decide(await find(staff, "su-asha"), "staff@sevak.example")] })).refused).toBe(0);
  });

  it("still lets the event's Coordinator approve a volunteer's hours, and an Admin log their own", async () => {
    expect((await writeSignups(db, cora, { upsert: [decide(await find(cora, "su-mei"), "cora@example.com")] })).refused).toBe(0);
    const mine = await find(asha, "su-asha");
    const edited = { ...mine, hours: { minutes: 75, method: "duration", status: "pending" } };
    expect((await writeSignups(db, asha, { upsert: [edited] })).refused).toBe(0);
    expect(await find(asha, "su-asha")).toMatchObject({ hours: { minutes: 75, status: "pending" } });
  });

  it("refuses moving someone else's approved sign-up to yourself", async () => {
    await writeSignups(db, cora, { upsert: [decide(await find(cora, "su-mei"), "cora@example.com")] });
    const meis = await find(asha, "su-mei");
    expect(await writeSignups(db, asha, { upsert: [{ ...meis, email: "asha@example.com", name: "asha" }] })).toMatchObject({ refused: 1, reason: "own_hours" });
  });
});

describe("who sees volunteers' sign-ups", () => {
  it("an Admin sees every event's; a Coordinator only the events they run", async () => {
    const cora = await person("cora@example.com");
    const [org] = await readOrganizations(db, asha);
    await writeOrganizations(db, asha, { upsert: [{ ...org, team: [{ email: "cora@example.com", role: "coordinator" }] }] });
    await writeSignups(db, mei, { upsert: [signup("su-1", "mei@example.com")] });
    const seen = async (who: Viewer) => (await readSignups(db, who)).find((s) => s.id === "su-1")!;

    expect(await seen(asha)).toMatchObject({ name: "mei", email: "mei@example.com", phone: "+17135550100" });
    // Not the event's admin: only that a spot is taken.
    expect(await seen(cora)).toEqual({ id: "su-1", eventId: "ev-1", shiftId: "s1", status: "confirmed", anonymous: true });
    expect((await writeSignups(db, cora, { upsert: [{ ...signup("su-1", "mei@example.com"), checkInAt: "2030-01-10T09:00:00Z" }] })).refused).toBe(1);
    expect((await writeSignups(db, cora, { delete: ["su-1"] })).refused).toBe(1);

    // Made the event's admin: its roster, to check people in.
    await writeEvents(db, asha, { upsert: [{ id: "ev-1", organizationId: "org-temple", title: "Seva", status: "published", visibility: "public", eventAdmin: "cora@example.com", roles: [{ id: "r1", name: "Setup", shifts: [{ id: "s1", capacity: 2 }, { id: "s2", capacity: 1 }] }] }] });
    expect(await seen(cora)).toMatchObject({ name: "mei", email: "mei@example.com", phone: "+17135550100" });
    expect((await writeSignups(db, cora, { upsert: [{ ...(await seen(cora)), checkInAt: "2030-01-10T09:00:00Z" }] })).refused).toBe(0);
  });
});

describe("shifts that are over", () => {
  const event = { timezone: "America/Chicago" };
  it("are over once their end has passed in the event's time zone", () => {
    const shift = { date: "2030-01-10", start: "09:00", end: "12:00" };
    expect(shiftEnded(event, shift, new Date("2030-01-10T17:59:00Z"))).toBe(false); // 11:59 in Chicago
    expect(shiftEnded(event, shift, new Date("2030-01-10T18:00:00Z"))).toBe(true);
    expect(shiftEnded(event, { date: "2030-01-10", start: "20:00", end: "02:00" }, new Date("2030-01-11T07:00:00Z"))).toBe(false); // overnight
    expect(shiftEnded(event, { capacity: 3 }, new Date("2100-01-01"))).toBe(false);
  });

  it("can't be signed up for, but the event's team can still add someone", async () => {
    await writeEvents(db, asha, {
      upsert: [{ id: "ev-past", organizationId: "org-temple", title: "Last year", status: "published", visibility: "public", timezone: "UTC",
        roles: [{ id: "r", name: "Setup", shifts: [{ id: "sp", date: "2020-01-10", start: "09:00", end: "12:00", capacity: 5 }] }] }],
    });
    const late = { ...signup("su-late", "mei@example.com"), eventId: "ev-past", shiftId: "sp" };
    expect(await writeSignups(db, mei, { upsert: [late] })).toMatchObject({ refused: 1, reason: "ended" });
    const walkIn = { ...signup("su-walkin", "ravi@example.com"), eventId: "ev-past", shiftId: "sp" };
    expect((await writeSignups(db, asha, { upsert: [walkIn] })).refused).toBe(0);
  });
});
