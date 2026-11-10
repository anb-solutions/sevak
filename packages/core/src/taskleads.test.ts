// Task leads (EVT-21): an Admin chooses a lead for a task (an event's role)
// from the organization's team or members; the lead sees that task's
// roster and nothing more; who leads a task is seen only by those who run
// the event and by the lead.
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, users } from "@sevak/db";
import { createMemoryDb } from "@sevak/db/memory";
import type { Viewer } from "./auth";
import { readEventsAndMain, writeEvents } from "./events";
import { joinWithCode, readMemberships, writeMemberships } from "./memberships";
import { type Json, writeOrganizations } from "./records";
import { readSignups, writeSignups } from "./signups";

let db: Db;
let asha: Viewer; // Admin
let cora: Viewer; // Coordinator, the event's admin
let dev: Viewer; // Coordinator, not the event's admin
let mei: Viewer; // volunteer, leads Setup
let ravi: Viewer; // volunteer, signed up for Setup
let pia: Viewer; // volunteer, signed up for Kitchen
let sam: Viewer; // not a member

async function person(email: string): Promise<Viewer> {
  const [u] = await db.insert(users).values({ email }).returning();
  return { id: u!.id, email, isPlatformAdmin: false };
}

const event = (roles: Json[], extra: Json = {}) => ({
  id: "ev-1", organizationId: "org-temple", title: "Seva", status: "published", visibility: "public", eventAdmin: "cora@example.com", roles, ...extra,
});
const setup = (lead?: string) => ({ id: "r1", name: "Setup", ...(lead === undefined ? {} : { lead }), shifts: [{ id: "s1", capacity: 5 }, { id: "s1b", capacity: 5 }] });
const kitchen = (lead?: string) => ({ id: "r2", name: "Kitchen", ...(lead === undefined ? {} : { lead }), shifts: [{ id: "s2", capacity: 5 }] });

const eventFor = async (who: Viewer | null) => (await readEventsAndMain(db, who)).events.find((e) => e.id === "ev-1");
const leadsFor = async (who: Viewer | null) => {
  const e = await eventFor(who);
  return e ? ((e.roles as Json[]).map((r) => (r.lead === undefined ? null : r.lead))) : null;
};
const stored = async () => leadsFor(asha);

beforeEach(async () => {
  db = await createMemoryDb();
  asha = await person("asha@example.com");
  cora = await person("cora@example.com");
  dev = await person("dev@example.com");
  mei = await person("mei@example.com");
  ravi = await person("ravi@example.com");
  pia = await person("pia@example.com");
  sam = await person("sam@example.com");
  await writeOrganizations(db, asha, {
    upsert: [{ id: "org-temple", name: "Temple", inviteCode: "SEVA4242", team: [{ email: "cora@example.com", role: "coordinator" }, { email: "dev@example.com", role: "coordinator" }] }],
  });
  for (const v of [mei, ravi, pia]) await joinWithCode(db, v, "SEVA4242", "");
  await writeEvents(db, asha, { upsert: [event([setup(), kitchen()])] });
});

describe("choosing a task's lead", () => {
  it("is for the organization's Admins, from its members or team", async () => {
    expect((await writeEvents(db, asha, { upsert: [event([setup(" Mei@Example.com "), kitchen("dev@example.com")])] })).refused).toBe(0);
    expect(await stored()).toEqual(["mei@example.com", "dev@example.com"]);
    // Removing a lead.
    expect((await writeEvents(db, asha, { upsert: [event([setup("mei@example.com"), kitchen("")])] })).refused).toBe(0);
    expect(await stored()).toEqual(["mei@example.com", null]);
  });

  it("refuses someone who isn't a member or on the team, and keeps the event as it was", async () => {
    await writeEvents(db, asha, { upsert: [event([setup("mei@example.com"), kitchen()])] });
    expect(await writeEvents(db, asha, { upsert: [event([setup("mei@example.com"), kitchen("sam@example.com")], { title: "Changed" })] })).toMatchObject({ refused: 1, reason: "lead_not_member" });
    expect(await writeEvents(db, asha, { upsert: [event([setup("nobody@example.com"), kitchen()])] })).toMatchObject({ refused: 1, reason: "lead_not_member" });
    const e = await eventFor(asha);
    expect(e).toMatchObject({ title: "Seva" });
    expect(await stored()).toEqual(["mei@example.com", null]);
  });

  it("isn't for Coordinators, even the event's admin: their saves keep each lead as it was", async () => {
    await writeEvents(db, asha, { upsert: [event([setup("mei@example.com"), kitchen()])] });
    // The event's admin sees the leads but can't change them.
    await writeEvents(db, cora, { upsert: [event([setup("cora@example.com"), kitchen("ravi@example.com")], { title: "Seva (Cora)" })] });
    expect(await eventFor(asha)).toMatchObject({ title: "Seva (Cora)" });
    expect(await stored()).toEqual(["mei@example.com", null]);
    // Another Coordinator doesn't see them, so saves without them; they stay.
    const seen = (await eventFor(dev))!;
    expect((seen.roles as Json[]).some((r) => "lead" in r)).toBe(false);
    await writeEvents(db, dev, { upsert: [{ ...seen, title: "Seva (Dev)" }] });
    expect(await eventFor(asha)).toMatchObject({ title: "Seva (Dev)" });
    expect(await stored()).toEqual(["mei@example.com", null]);
    // A Coordinator's new event starts with no leads.
    await writeEvents(db, dev, { upsert: [{ ...event([setup("dev@example.com")]), id: "ev-2", eventAdmin: "dev@example.com" }] });
    expect(((await readEventsAndMain(db, asha)).events.find((e) => e.id === "ev-2")!.roles as Json[])[0]!.lead).toBeUndefined();
  });

  it("is open to Sevak staff", async () => {
    const staff: Viewer = { ...(await person("staff@sevak.example")), isPlatformAdmin: true };
    expect((await writeEvents(db, staff, { upsert: [event([setup("pia@example.com"), kitchen()])] })).refused).toBe(0);
    expect(await stored()).toEqual(["pia@example.com", null]);
  });
});

describe("who sees who leads a task", () => {
  beforeEach(async () => {
    await writeEvents(db, asha, { upsert: [event([setup("mei@example.com"), kitchen("dev@example.com")])] });
  });

  it("those who run the event: its Admins and its event admin", async () => {
    expect(await leadsFor(asha)).toEqual(["mei@example.com", "dev@example.com"]);
    expect(await leadsFor(cora)).toEqual(["mei@example.com", "dev@example.com"]);
  });

  it("each lead, for their own task only", async () => {
    expect(await leadsFor(mei)).toEqual(["mei@example.com", null]);
    expect(await leadsFor(dev)).toEqual([null, "dev@example.com"]);
  });

  it("not other volunteers, nor people outside the organization", async () => {
    expect(await leadsFor(ravi)).toEqual([null, null]);
    for (const who of [sam, null]) {
      const e = await eventFor(who);
      expect(e === undefined || (e.roles as Json[]).every((r) => !("lead" in r))).toBe(true);
    }
  });
});

describe("a task lead's roster", () => {
  const signup = (id: string, who: Viewer, shiftId: string, extra: Json = {}) => ({
    id, registrationId: `reg-${id}`, eventId: "ev-1", shiftId, name: who.email.split("@")[0], email: who.email, phone: "+17135550100", status: "confirmed", ...extra,
  });
  const find = async (who: Viewer, id: string) => (await readSignups(db, who)).find((s) => s.id === id);

  beforeEach(async () => {
    await writeEvents(db, asha, { upsert: [event([setup("mei@example.com"), kitchen()])] });
    // Ravi signs up for Setup and logs his hours; Pia signs up for Kitchen,
    // and for Setup, then cancels that.
    await writeSignups(db, ravi, { upsert: [signup("su-ravi", ravi, "s1b")] });
    await writeSignups(db, ravi, { upsert: [{ ...(await find(ravi, "su-ravi")), hours: { minutes: 60, method: "duration" } }] });
    await writeSignups(db, pia, { upsert: [signup("su-pia", pia, "s2"), signup("su-pia-gone", pia, "s1")] });
    await writeSignups(db, pia, { upsert: [{ ...(await find(pia, "su-pia-gone")), status: "cancelled" }] });
    expect(await find(ravi, "su-ravi")).toMatchObject({ hours: { minutes: 60 } });
    expect(await find(pia, "su-pia-gone")).toMatchObject({ status: "cancelled" });
  });

  it("shows who's coming to their task and how to reach them, nothing more", async () => {
    expect(await find(mei, "su-ravi")).toEqual({ id: "su-ravi", eventId: "ev-1", shiftId: "s1b", status: "confirmed", name: "ravi", email: "ravi@example.com", phone: "+17135550100", roster: true });
  });

  it("not other tasks, and not cancelled sign-ups", async () => {
    expect(await find(mei, "su-pia")).toEqual({ id: "su-pia", eventId: "ev-1", shiftId: "s2", status: "confirmed", anonymous: true });
    expect(await find(mei, "su-pia-gone")).toBeUndefined();
  });

  it("isn't shown to other volunteers or to Coordinators who don't run the event", async () => {
    for (const who of [pia, dev]) expect(await find(who, "su-ravi")).toEqual({ id: "su-ravi", eventId: "ev-1", shiftId: "s1b", status: "confirmed", anonymous: true });
  });

  it("doesn't let the lead change anyone's sign-up", async () => {
    const r = await writeSignups(db, mei, { upsert: [signup("su-ravi", ravi, "s1b", { status: "cancelled" })] });
    expect(r.refused).toBe(1);
    expect(await find(ravi, "su-ravi")).toMatchObject({ status: "confirmed", hours: { minutes: 60 } });
  });

  it("goes when they're no longer the lead, or no longer a member", async () => {
    await writeEvents(db, asha, { upsert: [event([setup("pia@example.com"), kitchen()])] });
    expect(await find(mei, "su-ravi")).toMatchObject({ anonymous: true });
    expect(await find(pia, "su-ravi")).toMatchObject({ roster: true });
    // Pia leaves the organization: she sees neither the roster nor that she led it.
    const [membership] = (await readMemberships(db, pia)).filter((m) => m.orgId === "org-temple");
    await writeMemberships(db, pia, { delete: [membership!.id] });
    expect((await readSignups(db, pia)).find((s) => s.id === "su-ravi")?.name).toBeUndefined();
    const e = await eventFor(pia);
    expect(e === undefined || (e.roles as Json[]).every((r) => !("lead" in r))).toBe(true);
  });
});
