// The audit log writes down who changed what: created, changed (with the
// fields) and deleted, with decisions such as hours, but not what people
// typed.
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, users } from "@sevak/db";
import { createMemoryDb } from "@sevak/db/memory";
import { historyOf, recordChanges, snapshot } from "./audit";
import type { Viewer } from "./auth";
import { writeEvents } from "./events";
import { joinWithCode } from "./memberships";
import { writeOrganizations } from "./records";
import { writeSignups } from "./signups";

let db: Db;
let asha: Viewer;
let mei: Viewer;

async function person(email: string): Promise<Viewer> {
  const [u] = await db.insert(users).values({ email }).returning();
  return { id: u!.id, email, isPlatformAdmin: false };
}

// A change as the API makes it: what was there, the change, what's there now.
async function logged<T>(viewer: Viewer, collection: string, ids: string[], change: () => Promise<T>) {
  const before = await snapshot(db, collection, ids);
  await change();
  return recordChanges(db, viewer, collection, before, ids);
}

beforeEach(async () => {
  db = await createMemoryDb();
  asha = await person("asha@example.com");
  mei = await person("mei@example.com");
  await writeOrganizations(db, asha, { upsert: [{ id: "org-t", name: "Temple", team: [], inviteCode: "SEVA4242" }] });
  await writeEvents(db, asha, { upsert: [{ id: "ev", organizationId: "org-t", title: "Seva", status: "published", roles: [{ id: "r", shifts: [{ id: "s", capacity: 3 }] }] }] });
  await joinWithCode(db, mei, "SEVA4242", "");
});

describe("the audit log", () => {
  it("writes down who created, changed and deleted a record, and the decision", async () => {
    const su = { id: "su-1", registrationId: "r1", eventId: "ev", shiftId: "s", name: "Mei Lin", email: "mei@example.com", phone: "+17135550100", status: "confirmed" };
    expect(await logged(mei, "signups", ["su-1"], () => writeSignups(db, mei, { upsert: [su] }))).toBe(1);
    const approved = { ...su, hours: { minutes: 120, status: "approved", decidedBy: "asha@example.com" } };
    expect(await logged(asha, "signups", ["su-1"], () => writeSignups(db, asha, { upsert: [approved] }))).toBe(1);
    // Nothing changed: nothing written.
    expect(await logged(asha, "signups", ["su-1"], () => writeSignups(db, asha, { upsert: [approved] }))).toBe(0);
    expect(await logged(asha, "signups", ["su-1"], () => writeSignups(db, asha, { delete: ["su-1"] }))).toBe(1);

    const history = await historyOf(db, "signups", "su-1");
    expect(history.map((h) => [h.action, h.actorEmail])).toEqual(
      expect.arrayContaining([["created", "mei@example.com"], ["changed", "asha@example.com"], ["deleted", "asha@example.com"]]),
    );
    const change = history.find((h) => h.action === "changed")!;
    expect(change.orgId).toBe("org-t");
    expect(change.detail).toMatchObject({ fields: ["hours"], hours: { status: "approved", minutes: 120 }, email: "mei@example.com" });
    // Not the name or phone people typed.
    expect(JSON.stringify(history)).not.toContain("Mei Lin");
    expect(JSON.stringify(history)).not.toContain("+17135550100");
  });

  it("writes down nothing for a change that was refused", async () => {
    const forged = { id: "ev", organizationId: "org-t", title: "Mine now", status: "published", roles: [] };
    expect(await logged(mei, "events", ["ev"], () => writeEvents(db, mei, { upsert: [forged] }))).toBe(0);
  });

  it("keeps a team's roles when they change", async () => {
    const team = [{ email: "Ravi@example.com", name: "Ravi", role: "admin" }];
    await logged(asha, "organizations", ["org-t"], () => writeOrganizations(db, asha, { upsert: [{ id: "org-t", name: "Temple", team, inviteCode: "SEVA4242" }] }));
    const [last] = await historyOf(db, "organizations", "org-t");
    expect(last!.detail).toMatchObject({ fields: expect.arrayContaining(["team"]), team: ["ravi@example.com:admin"] });
  });
});
