import { beforeEach, describe, expect, it } from "vitest";
import { type Db, users } from "@sevak/db";
import { createMemoryDb } from "@sevak/db/memory";
import type { Viewer } from "./auth";
import { readOrganizations, readProfile, readSynced, writeOrganizations, writeProfile } from "./records";

let db: Db;
let asha: Viewer; // creates the organization: its Admin
let ravi: Viewer; // a Coordinator on its team
let mei: Viewer; // not on the team
let staff: Viewer;

async function person(email: string, isPlatformAdmin = false): Promise<Viewer> {
  const [u] = await db.insert(users).values({ email }).returning();
  return { id: u!.id, email, isPlatformAdmin };
}

const org = (extra: Record<string, unknown> = {}) => ({
  id: "org-temple",
  name: "Temple Volunteers",
  description: "Seva at the temple",
  address: { line1: "1 Main St", city: "Houston", state: "TX", country: "US" },
  primaryContact: { name: "Asha", email: "asha@example.com", phone: { number: "+17135550100" } },
  team: [{ name: "Ravi", email: "ravi@example.com", role: "coordinator" }],
  inviteCode: "SEVA4242",
  verificationStatus: "unverified",
  ...extra,
});

beforeEach(async () => {
  db = await createMemoryDb();
  asha = await person("asha@example.com");
  ravi = await person("ravi@example.com");
  mei = await person("mei@example.com");
  staff = await person("staff@example.com", true);
  const result = await writeOrganizations(db, asha, { upsert: [org()] });
  expect(result.refused).toBe(0);
});

describe("profile", () => {
  it("is saved for you only, with the email you signed in with", async () => {
    const saved = await writeProfile(db, asha, { firstName: "Asha", lastName: "Rao", email: "someone-else@example.com", phone: { number: "+17135550100" } });
    expect(saved!.email).toBe("asha@example.com");
    expect(await readProfile(db, asha)).toMatchObject({ firstName: "Asha", email: "asha@example.com" });
    expect(await readProfile(db, mei)).toBeNull();
  });

  it("can be cleared", async () => {
    await writeProfile(db, asha, { firstName: "Asha" });
    await writeProfile(db, asha, null);
    expect(await readProfile(db, asha)).toBeNull();
  });

  it("refuses something that isn't a profile", async () => {
    await expect(writeProfile(db, asha, "hello")).rejects.toThrow();
    await expect(writeProfile(db, asha, { photo: "x".repeat(2_000_000) })).rejects.toThrow("too_large");
  });
});

describe("organizations", () => {
  it("records who set one up, as its Admin", async () => {
    const [saved] = await readOrganizations(db, asha);
    expect(saved).toMatchObject({ id: "org-temple", createdBy: "asha@example.com", inviteCode: "SEVA4242" });
  });

  it("shows only the public part to people not on the team, and to visitors", async () => {
    for (const viewer of [mei, null]) {
      const [seen] = await readOrganizations(db, viewer);
      expect(seen).toMatchObject({ id: "org-temple", name: "Temple Volunteers", public: true, address: { city: "Houston" } });
      const text = JSON.stringify(seen);
      for (const secret of ["SEVA4242", "asha@example.com", "ravi@example.com", "1 Main St", "+1713"]) expect(text).not.toContain(secret);
    }
    expect((await readOrganizations(db, ravi))[0]).toMatchObject({ inviteCode: "SEVA4242" });
  });

  it("lets its Admins change it", async () => {
    const result = await writeOrganizations(db, asha, { upsert: [org({ name: "Temple Seva" })] });
    expect(result.refused).toBe(0);
    expect((await readOrganizations(db, null))[0]!.name).toBe("Temple Seva");
  });

  it("refuses changes from people not on the team", async () => {
    const result = await writeOrganizations(db, mei, { upsert: [org({ name: "Taken over", team: [{ email: "mei@example.com", role: "admin" }] })], delete: ["org-temple"] });
    expect(result.refused).toBe(2);
    expect((await readOrganizations(db, asha))[0]).toMatchObject({ name: "Temple Volunteers", team: [{ email: "ravi@example.com" }] });
  });

  it("lets a Coordinator leave the team, but not change anything else", async () => {
    const [current] = await readOrganizations(db, ravi);
    const renamed = await writeOrganizations(db, ravi, { upsert: [{ ...current, name: "Ravi's now" }] });
    expect(renamed.refused).toBe(1);
    expect((await writeOrganizations(db, ravi, { delete: ["org-temple"] })).refused).toBe(1);

    const left = await writeOrganizations(db, ravi, { upsert: [{ ...current, team: [] }] });
    expect(left.refused).toBe(0);
    expect(left.value[0]).toMatchObject({ public: true });
    expect((await readOrganizations(db, asha))[0]!.team).toEqual([]);
  });

  it("only lets Sevak staff verify an organization", async () => {
    await writeOrganizations(db, asha, { upsert: [org({ verificationStatus: "verified" })] });
    expect((await readOrganizations(db, asha))[0]!.verificationStatus).toBe("unverified");

    await writeOrganizations(db, asha, { upsert: [org({ verificationStatus: "pending", verification: { requestedBy: "asha@example.com", decidedBy: "asha@example.com" } })] });
    expect((await readOrganizations(db, asha))[0]).toMatchObject({ verificationStatus: "pending", verification: { requestedBy: "asha@example.com" } });
    expect((await readOrganizations(db, asha))[0]!.verification).not.toHaveProperty("decidedBy");

    const [pending] = await readOrganizations(db, staff);
    await writeOrganizations(db, staff, { upsert: [{ ...pending, verificationStatus: "verified" }] });
    expect((await readOrganizations(db, null))[0]!.verificationStatus).toBe("verified");

    // Saving its profile again can't change that.
    const [mine] = await readOrganizations(db, asha);
    await writeOrganizations(db, asha, { upsert: [{ ...mine, verificationStatus: "pending" }] });
    expect((await readOrganizations(db, null))[0]!.verificationStatus).toBe("verified");
  });

  it("can't be set up already verified, or with someone else as its creator", async () => {
    await writeOrganizations(db, mei, { upsert: [{ id: "org-mei", name: "Mei's", verificationStatus: "verified", createdBy: "asha@example.com" }] });
    const mine = (await readOrganizations(db, mei)).find((o) => o.id === "org-mei");
    expect(mine).toMatchObject({ verificationStatus: "unverified", createdBy: "mei@example.com" });
  });

  it("lets its Admins delete it", async () => {
    expect((await writeOrganizations(db, asha, { delete: ["org-temple"] })).value).toEqual([]);
  });

  it("refuses demo records, bad ids and public copies", async () => {
    const [publicCopy] = await readOrganizations(db, mei);
    const result = await writeOrganizations(db, mei, { upsert: [{ id: "demo-org", name: "Demo" }, { id: "../x", name: "Bad" }, publicCopy!] });
    expect(result.refused).toBe(3);
    expect(result.value).toHaveLength(1);
  });

  it("refuses something that isn't a list of changes", async () => {
    await expect(writeOrganizations(db, asha, { upsert: "nope" })).rejects.toThrow();
  });
});

describe("what a page loads", () => {
  it("has your profile when you're signed in, and organizations for everyone", async () => {
    await writeProfile(db, asha, { firstName: "Asha" });
    expect(await readSynced(db, asha)).toMatchObject({ "sevak.profile.v1": { firstName: "Asha" }, "sevak.organizations.v1": [{ id: "org-temple" }] });
    expect(await readSynced(db, null)).toMatchObject({ "sevak.profile.v1": null, "sevak.organizations.v1": [{ public: true }] });
  });
});
