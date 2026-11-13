import { beforeEach, describe, expect, it } from "vitest";
import { type Db, users } from "@sevak/db";
import { createMemoryDb } from "@sevak/db/memory";
import type { Viewer } from "./auth";
import { joinWithCode, organizationForCode, readMemberships, writeMemberships } from "./memberships";
import { readSynced, writeOrganizations, writeProfile } from "./records";

let db: Db;
let asha: Viewer; // Admin of the temple
let ravi: Viewer; // Coordinator
let mei: Viewer; // a volunteer
let sam: Viewer; // someone else

async function person(email: string): Promise<Viewer> {
  const [u] = await db.insert(users).values({ email }).returning();
  return { id: u!.id, email, isPlatformAdmin: false };
}

const request = (id: string, email: string, extra: Record<string, unknown> = {}) => ({ id, orgId: "org-temple", email, name: "Mei", status: "requested", ...extra });

beforeEach(async () => {
  db = await createMemoryDb();
  asha = await person("asha@example.com");
  ravi = await person("ravi@example.com");
  mei = await person("mei@example.com");
  sam = await person("sam@example.com");
  await writeOrganizations(db, asha, {
    upsert: [{ id: "org-temple", name: "Temple Volunteers", team: [{ email: "ravi@example.com", role: "coordinator" }], inviteCode: "SEVA4242" }],
  });
  await writeProfile(db, mei, { firstName: "Mei", lastName: "Lin", photo: "data:image/png;base64,AAAA" });
});

describe("asking to join", () => {
  it("is a request the organization's Admins see and decide, not its Coordinators", async () => {
    expect((await writeMemberships(db, mei, { upsert: [request("mem-1", "mei@example.com")] })).refused).toBe(0);
    expect(await readMemberships(db, asha)).toMatchObject([{ id: "mem-1", status: "requested" }]);
    expect(await readMemberships(db, ravi)).toEqual([]);
    expect(await readMemberships(db, sam)).toEqual([]);

    expect((await writeMemberships(db, ravi, { upsert: [request("mem-1", "mei@example.com", { status: "active" })] })).refused).toBe(1);
    const approved = await writeMemberships(db, asha, { upsert: [request("mem-1", "mei@example.com", { status: "active" })] });
    expect(approved.refused).toBe(0);
    expect((await readMemberships(db, mei))[0]).toMatchObject({ status: "active", decidedBy: "asha@example.com" });
  });

  it("can't approve yourself, or ask for someone else", async () => {
    await writeMemberships(db, mei, { upsert: [request("mem-1", "mei@example.com")] });
    expect((await writeMemberships(db, mei, { upsert: [request("mem-1", "mei@example.com", { status: "active" })] })).refused).toBe(1);
    expect((await writeMemberships(db, sam, { upsert: [request("mem-2", "mei@example.com")] })).refused).toBe(1);
    expect((await readMemberships(db, mei))[0]!.status).toBe("requested");
  });

  it("is approved straight away when the organization approves automatically", async () => {
    await writeOrganizations(db, asha, { upsert: [{ id: "org-temple", name: "Temple Volunteers", team: [{ email: "ravi@example.com", role: "coordinator" }], inviteCode: "SEVA4242", autoApprove: true }] });
    await writeMemberships(db, mei, { upsert: [request("mem-1", "mei@example.com")] });
    expect((await readMemberships(db, mei))[0]).toMatchObject({ status: "active", how: "auto-approved" });
  });

  it("needs an organization that exists", async () => {
    expect((await writeMemberships(db, mei, { upsert: [request("mem-1", "mei@example.com", { orgId: "org-nope" })] })).refused).toBe(1);
  });
});

describe("invitations", () => {
  it("are sent by the team and accepted by the person invited", async () => {
    const invite = { id: "mem-9", orgId: "org-temple", email: "Mei@Example.com", status: "invited" };
    expect((await writeMemberships(db, sam, { upsert: [invite] })).refused).toBe(1);
    expect((await writeMemberships(db, asha, { upsert: [invite] })).refused).toBe(0);
    const [mine] = await readMemberships(db, mei);
    expect(mine).toMatchObject({ email: "mei@example.com", status: "invited", invitedBy: "asha@example.com" });
    const accepted = await writeMemberships(db, mei, { upsert: [{ ...mine, status: "active", name: "Mei Lin" }] });
    expect(accepted.refused).toBe(0);
    expect((await readMemberships(db, asha))[0]).toMatchObject({ status: "active", how: "invitation", invitedBy: "asha@example.com" });
  });
});

describe("leaving and removing", () => {
  it("lets the person leave and an Admin remove; nobody else", async () => {
    await writeMemberships(db, mei, { upsert: [request("mem-1", "mei@example.com"), ] });
    expect((await writeMemberships(db, sam, { delete: ["mem-1"] })).refused).toBe(1);
    expect((await writeMemberships(db, mei, { delete: ["mem-1"] })).refused).toBe(0);
    await writeMemberships(db, mei, { upsert: [request("mem-2", "mei@example.com")] });
    expect((await writeMemberships(db, ravi, { delete: ["mem-2"] })).refused).toBe(1);
    expect((await writeMemberships(db, asha, { delete: ["mem-2"] })).refused).toBe(0);
    expect(await readMemberships(db, mei)).toEqual([]);
  });
});

describe("invite codes", () => {
  it("say which organization is inviting, without giving away the code", async () => {
    const org = await organizationForCode(db, " seva-4242 ");
    expect(org).toMatchObject({ id: "org-temple", name: "Temple Volunteers" });
    expect(JSON.stringify(org)).not.toContain("SEVA4242");
    expect(await organizationForCode(db, "NOPE99")).toBeNull();
    expect(await organizationForCode(db, "")).toBeNull();
  });

  it("join the organization straight away, with your profile", async () => {
    const result = await joinWithCode(db, mei, "seva4242", "Happy to help");
    expect(result?.organization).toMatchObject({ name: "Temple Volunteers" });
    expect((await readMemberships(db, asha))[0]).toMatchObject({ email: "mei@example.com", name: "Mei Lin", status: "active", how: "invitation", note: "Happy to help" });
    // Joining again keeps one record.
    await joinWithCode(db, mei, "SEVA4242", undefined);
    expect(await readMemberships(db, mei)).toHaveLength(1);
    expect(await joinWithCode(db, mei, "WRONG1", "")).toBeNull();
  });
});

describe("what a page loads", () => {
  it("includes your memberships when signed in, none when signed out", async () => {
    await joinWithCode(db, mei, "SEVA4242", "");
    expect((await readSynced(db, mei))["sevak.memberships.v1"]).toHaveLength(1);
    expect((await readSynced(db, null))["sevak.memberships.v1"]).toEqual([]);
  });
});

describe("what the organization sees of a volunteer", () => {
  it("follows their profile: named once they save one, cleared when they delete it", async () => {
    await joinWithCode(db, sam, "SEVA4242", "");
    expect((await readMemberships(db, asha)).find((m) => m.email === sam.email)).toMatchObject({ name: "sam@example.com" });
    await writeProfile(db, sam, { firstName: "Sam", lastName: "Rao", photo: "data:image/png;base64,BBBB", services: ["Cooking"], aboutMe: "Hi", address: { line1: "1 Main St" } });
    const named = (await readMemberships(db, asha)).find((m) => m.email === sam.email)!;
    expect(named).toMatchObject({ name: "Sam Rao", photo: "data:image/png;base64,BBBB", services: ["Cooking"], aboutMe: "Hi", status: "active" });
    expect(named).not.toHaveProperty("address");
    await writeProfile(db, sam, null);
    expect((await readMemberships(db, asha)).find((m) => m.email === sam.email)).toMatchObject({ name: "sam@example.com", photo: "", services: [], aboutMe: "", status: "active" });
  });
});
