// Limits that stop one person from flooding inboxes or filling the database.
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, users } from "@sevak/db";
import { createMemoryDb } from "@sevak/db/memory";
import type { Viewer } from "./auth";
import { readCertificates, writeCertificates } from "./certificates";
import { MAX_EVENTS_PER_ORG, writeEvents } from "./events";
import { allowedMails, hit, HOUR, MAIL_LIMITS } from "./limits";
import { readMemberships, writeMemberships } from "./memberships";
import { clean, type Mail } from "./notify";
import { MAX_ORGS_PER_PERSON, readOrganizations, writeOrganizations } from "./records";

let db: Db;
let asha: Viewer;
let mei: Viewer;
let staff: Viewer;

async function person(email: string, isPlatformAdmin = false): Promise<Viewer> {
  const [u] = await db.insert(users).values({ email }).returning();
  return { id: u!.id, email, isPlatformAdmin };
}

const mail = (to: string, orgId?: string): Mail => ({ to, subject: "Hello", text: "Hi", ...(orgId ? { orgId } : {}) });

beforeEach(async () => {
  db = await createMemoryDb();
  asha = await person("asha@example.com");
  mei = await person("mei@example.com");
  staff = await person("staff@example.com", true);
  await writeOrganizations(db, asha, { upsert: [{ id: "org-temple", name: "Temple", team: [], inviteCode: "SEVA4242" }] });
});

describe("counting", () => {
  it("holds for hits sent all at once", async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => hit(db, "k", 10, HOUR)));
    expect(results.filter(Boolean)).toHaveLength(10);
  });
});

describe("emails", () => {
  it("lets an unverified organization send only a few a day", async () => {
    const many = Array.from({ length: 50 }, (_, i) => mail(`v${i}@example.com`, "org-temple"));
    expect(await allowedMails(db, asha, many)).toHaveLength(MAIL_LIMITS.perUnverifiedOrgDay);
  });

  it("lets a verified one send more", async () => {
    const [org] = await readOrganizations(db, asha);
    await writeOrganizations(db, staff, { upsert: [{ ...org, verificationStatus: "verified" }] });
    const many = Array.from({ length: 50 }, (_, i) => mail(`v${i}@example.com`, "org-temple"));
    expect(await allowedMails(db, asha, many)).toHaveLength(50);
  });

  it("limits emails to one address, whoever causes them", async () => {
    const many = Array.from({ length: 30 }, () => mail("victim@example.com"));
    expect(await allowedMails(db, mei, many)).toHaveLength(MAIL_LIMITS.perRecipientDay);
  });

  it("limits how many one person's changes cause", async () => {
    const many = Array.from({ length: 120 }, (_, i) => mail(`v${i}@example.com`));
    expect(await allowedMails(db, mei, many)).toHaveLength(MAIL_LIMITS.perPersonHour);
  });

  it("puts names in on one line, not too long", () => {
    expect(clean("URGENT\n\ncall‮now  " + "x".repeat(200))).toMatch(/^URGENT call now x+…$/);
    expect(clean("URGENT " + "x".repeat(200)).length).toBe(80);
  });
});

describe("saving", () => {
  it("lets one person set up only so many organizations", async () => {
    const orgs = Array.from({ length: MAX_ORGS_PER_PERSON + 2 }, (_, i) => ({ id: `org-m${i}`, name: `Mine ${i}`, team: [] }));
    const r = await writeOrganizations(db, mei, { upsert: orgs });
    expect(r).toMatchObject({ refused: 2, reason: "too_many" });
    expect((await writeOrganizations(db, staff, { upsert: [{ id: "org-staff", name: "Staff's", team: [] }] })).refused).toBe(0);
  });

  it("lets an organization have only so many events", async () => {
    const ev = (i: number) => ({ id: `ev-${i}`, organizationId: "org-temple", title: `E${i}`, status: "draft" });
    for (let i = 0; i < MAX_EVENTS_PER_ORG; i += 100) await writeEvents(db, asha, { upsert: Array.from({ length: 100 }, (_, j) => ev(i + j)) });
    expect(await writeEvents(db, asha, { upsert: [ev(MAX_EVENTS_PER_ORG)] })).toMatchObject({ refused: 1, reason: "too_many" });
    expect((await writeEvents(db, asha, { upsert: [{ ...ev(0), title: "Changed" }] })).refused).toBe(0);
  });

  it("keeps one membership per person and organization", async () => {
    const ask = (id: string) => ({ id, orgId: "org-temple", email: "mei@example.com", name: "Mei", status: "requested" });
    expect((await writeMemberships(db, mei, { upsert: [ask("mem-1")] })).refused).toBe(0);
    const again = await writeMemberships(db, mei, { upsert: [ask("mem-2"), ask("mem-3")] });
    expect(again).toMatchObject({ refused: 2, reason: "already_asked" });
    expect(again.emails).toEqual([]);
    expect(await readMemberships(db, asha)).toHaveLength(1);
  });

  it("doesn't let someone who was declined join by automatic approval", async () => {
    const m = (status: string) => ({ id: "mem-1", orgId: "org-temple", email: "mei@example.com", status });
    await writeMemberships(db, mei, { upsert: [m("requested")] });
    await writeMemberships(db, asha, { upsert: [m("declined")] });
    const [org] = await readOrganizations(db, asha);
    await writeOrganizations(db, asha, { upsert: [{ ...org, autoApprove: true }] });
    await writeMemberships(db, mei, { upsert: [m("active")] });
    expect((await readMemberships(db, asha))[0]!.status).not.toBe("active");
  });

  it("allows a few open certificate requests per organization", async () => {
    const ask = (i: number) => ({ id: `cert-${i}`, orgId: "org-temple", from: "2030-01-01", to: "2030-01-31", status: "requested" });
    const r = await writeCertificates(db, mei, { upsert: [0, 1, 2, 3, 4].map(ask) });
    expect(r).toMatchObject({ refused: 2, reason: "already_asked" });
    expect(await readCertificates(db, mei)).toHaveLength(3);
  });

  it("refuses invite codes that are short enough to guess", async () => {
    const [org] = await readOrganizations(db, asha);
    await writeOrganizations(db, asha, { upsert: [{ ...org, inviteCode: "ABC234" }] });
    expect((await readOrganizations(db, asha))[0]!.inviteCode).toBe("SEVA4242");
    await writeOrganizations(db, asha, { upsert: [{ ...org, inviteCode: "XK7P2QMN" }] });
    expect((await readOrganizations(db, asha))[0]!.inviteCode).toBe("XK7P2QMN");
  });
});
