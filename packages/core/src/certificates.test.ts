import { beforeEach, describe, expect, it } from "vitest";
import { type Db, users } from "@sevak/db";
import { createMemoryDb } from "@sevak/db/memory";
import type { Viewer } from "./auth";
import { approvedMinutes, readCertificates, readSignatures, verifyCertificate, writeCertificates, writeSignatures } from "./certificates";
import { writeEvents } from "./events";
import { joinWithCode } from "./memberships";
import { readOrganizations, writeOrganizations } from "./records";
import { readSignups, writeSignups } from "./signups";

let db: Db;
let asha: Viewer; // Admin
let ravi: Viewer; // Coordinator
let mei: Viewer; // volunteer
let sam: Viewer; // someone else

async function person(email: string): Promise<Viewer> {
  const [u] = await db.insert(users).values({ email }).returning();
  return { id: u!.id, email, isPlatformAdmin: false };
}

const request = (extra: Record<string, unknown> = {}) => ({ id: "cert-1", orgId: "org-temple", email: "mei@example.com", name: "Mei", from: "2030-01-01", to: "2030-01-31", status: "requested", ...extra });

async function issued(minutes: number, code = "SVK-ABCD-EF23") {
  const [req] = await readCertificates(db, asha);
  return { ...req, status: "issued", code, signer: { name: "Asha" }, data: { code, volunteer: "Mei", org: { name: "Temple" }, from: "2030-01-01", to: "2030-01-31", minutes, shifts: 1, events: [{ id: "ev-1", title: "Seva" }], rows: [] } };
}

beforeEach(async () => {
  db = await createMemoryDb();
  asha = await person("asha@example.com");
  ravi = await person("ravi@example.com");
  mei = await person("mei@example.com");
  sam = await person("sam@example.com");
  await writeOrganizations(db, asha, { upsert: [{ id: "org-temple", name: "Temple", team: [{ email: "ravi@example.com", role: "coordinator" }], inviteCode: "SEVA4242" }] });
  await writeEvents(db, asha, {
    upsert: [{ id: "ev-1", organizationId: "org-temple", title: "Seva", status: "published", roles: [{ id: "r1", shifts: [{ id: "s1", date: "2030-01-10", capacity: 5 }, { id: "s2", date: "2030-02-10", capacity: 5 }] }] }],
  });
  await joinWithCode(db, mei, "SEVA4242", "");
  // Mei logs 2 h in January (approved 90 min) and 1 h in February (approved).
  await writeSignups(db, mei, { upsert: [{ id: "su-1", eventId: "ev-1", shiftId: "s1", email: "mei@example.com", status: "confirmed" }, { id: "su-2", eventId: "ev-1", shiftId: "s2", email: "mei@example.com", status: "confirmed" }] });
  for (const s of await readSignups(db, mei)) await writeSignups(db, mei, { upsert: [{ ...s, hours: { minutes: s.id === "su-1" ? 120 : 60, method: "duration" } }] });
  for (const s of await readSignups(db, asha)) {
    await writeSignups(db, asha, { upsert: [{ ...s, hours: { ...(s.hours as object), status: "approved", ...(s.id === "su-1" ? { approvedMinutes: 90 } : {}) } }] });
  }
});

describe("asking for a certificate", () => {
  it("is your own request, which the organization's Admins see and you can withdraw", async () => {
    expect((await writeCertificates(db, mei, { upsert: [request({ id: "cert-0", status: "issued", code: "SVK-AAAA-AAAA" })] })).refused).toBe(1);
    expect((await writeCertificates(db, mei, { upsert: [request({ email: "someone@example.com", code: "SVK-AAAA-AAAA" })] })).refused).toBe(0);
    const [mine] = await readCertificates(db, mei);
    expect(mine).toMatchObject({ email: "mei@example.com", status: "requested" });
    expect(mine).not.toHaveProperty("code");
    expect(await readCertificates(db, asha)).toHaveLength(1);
    expect(await readCertificates(db, ravi)).toEqual([]);
    expect(await readCertificates(db, sam)).toEqual([]);
    expect((await writeCertificates(db, mei, { delete: ["cert-1"] })).refused).toBe(0);
  });
});

describe("issuing", () => {
  beforeEach(async () => {
    await writeCertificates(db, mei, { upsert: [request()] });
  });

  it("counts the approved hours on record for the period", async () => {
    expect(await approvedMinutes(db, "mei@example.com", "org-temple", "2030-01-01", "2030-01-31")).toBe(90);
    expect(await approvedMinutes(db, "mei@example.com", "org-temple", "2030-01-01", "2030-12-31")).toBe(150);
  });

  it("is for the organization's Admins only", async () => {
    for (const who of [mei, ravi, sam]) expect((await writeCertificates(db, who, { upsert: [await issued(90)] })).refused).toBe(1);
    expect((await writeCertificates(db, asha, { upsert: [await issued(90)] })).refused).toBe(0);
    expect((await readCertificates(db, mei))[0]).toMatchObject({ status: "issued", code: "SVK-ABCD-EF23", decidedBy: "asha@example.com" });
  });

  it("can't claim more (or less) than the approved hours", async () => {
    expect(await writeCertificates(db, asha, { upsert: [await issued(600)] })).toMatchObject({ refused: 1, reason: "hours_mismatch" });
    expect((await readCertificates(db, mei))[0]!.status).toBe("requested");
  });

  it("can't be changed once issued, and numbers are unique", async () => {
    await writeCertificates(db, asha, { upsert: [await issued(90)] });
    const [cert] = await readCertificates(db, asha);
    const tampered = { ...cert, data: { ...(cert!.data as object), minutes: 6000 } };
    expect((await writeCertificates(db, asha, { upsert: [tampered] })).refused).toBe(1);
    await writeCertificates(db, mei, { upsert: [request({ id: "cert-2" })] });
    const second = { ...(await readCertificates(db, asha)).find((c) => c.id === "cert-2"), status: "issued", code: "SVK-ABCD-EF23", data: { code: "SVK-ABCD-EF23", minutes: 90 } };
    expect((await writeCertificates(db, asha, { upsert: [second] })).refused).toBe(1);
  });

  describe("is never your own (an Admin's needs a different Admin)", () => {
    // Asha, the Admin, volunteers too, and asks for a certificate for her
    // own hours, which someone else approved (ATT-3).
    let own: Record<string, unknown>;
    const asIssued = () => ({ ...own, status: "issued", code: "SVK-ASHA-ABCD", signer: { name: "Asha" }, data: { code: "SVK-ASHA-ABCD", minutes: 60 } });
    async function ashaAsks(approver: Viewer) {
      await writeSignups(db, asha, { upsert: [{ id: "su-a", eventId: "ev-1", shiftId: "s1", email: "asha@example.com", status: "confirmed", hours: { minutes: 60, method: "duration" } }] });
      const s = (await readSignups(db, approver)).find((x) => x.id === "su-a");
      expect((await writeSignups(db, approver, { upsert: [{ ...s, hours: { ...(s!.hours as object), status: "approved" } }] })).refused).toBe(0);
      await writeCertificates(db, asha, { upsert: [request({ id: "cert-a", email: "asha@example.com", name: "Asha" })] });
      own = (await readCertificates(db, asha)).find((c) => c.id === "cert-a")!;
      expect(own).toMatchObject({ status: "requested", email: "asha@example.com" });
    }
    const status = async () => (await readCertificates(db, asha)).find((c) => c.id === "cert-a");

    it("refuses an Admin issuing or declining their own, even with the right hours", async () => {
      const bea = await person("bea@example.com");
      const [org] = await readOrganizations(db, asha);
      await writeOrganizations(db, asha, { upsert: [{ ...org, team: [...(org!.team as object[]), { email: "bea@example.com", role: "admin" }] }] });
      await ashaAsks(bea);
      expect(await writeCertificates(db, asha, { upsert: [asIssued()] })).toMatchObject({ refused: 1, reason: "own_certificate" });
      expect(await writeCertificates(db, asha, { upsert: [{ ...own, status: "declined", reason: "No" }] })).toMatchObject({ refused: 1, reason: "own_certificate" });
      expect(await status()).toMatchObject({ status: "requested" });
      // A different Admin issues it.
      expect((await writeCertificates(db, bea, { upsert: [asIssued()] })).refused).toBe(0);
      expect(await status()).toMatchObject({ status: "issued", decidedBy: "bea@example.com", data: { minutes: 60, volunteer: "Asha" } });
    });

    it("comes from Sevak staff for an organization's only Admin, but never staff's own", async () => {
      const staff: Viewer = { ...(await person("staff@sevak.example")), isPlatformAdmin: true };
      await ashaAsks(staff);
      expect(await writeCertificates(db, { ...asha, isPlatformAdmin: true }, { upsert: [asIssued()] })).toMatchObject({ refused: 1, reason: "own_certificate" });
      expect((await writeCertificates(db, staff, { upsert: [asIssued()] })).refused).toBe(0);
      expect(await status()).toMatchObject({ status: "issued", decidedBy: "staff@sevak.example" });
    });
  });

  it("can be declined with a reason, by an Admin", async () => {
    const [req] = await readCertificates(db, asha);
    expect((await writeCertificates(db, mei, { upsert: [{ ...req, status: "declined" }] })).refused).toBe(1);
    await writeCertificates(db, asha, { upsert: [{ ...req, status: "declined", reason: "Wrong dates" }] });
    expect((await readCertificates(db, mei))[0]).toMatchObject({ status: "declined", reason: "Wrong dates" });
    expect((await writeCertificates(db, mei, { delete: ["cert-1"] })).refused).toBe(1);
  });
});

describe("checking a certificate by its number", () => {
  it("shows only what proves it, for issued certificates", async () => {
    await writeCertificates(db, mei, { upsert: [request()] });
    expect(await verifyCertificate(db, "SVK-ABCD-EF23")).toBeNull();
    await writeCertificates(db, asha, { upsert: [await issued(90)] });
    const found = await verifyCertificate(db, " svk-abcd-ef23 ");
    expect(found).toMatchObject({ code: "SVK-ABCD-EF23", data: { volunteer: "Mei", org: { name: "Temple" }, minutes: 90, events: [{ title: "Seva" }] } });
    expect(JSON.stringify(found)).not.toContain("mei@example.com");
    expect(await verifyCertificate(db, "not-a-code")).toBeNull();
  });
});

describe("signatures", () => {
  it("are each person's own", async () => {
    await writeSignatures(db, asha, { "asha@example.com": { image: "data:image/png;base64,AAA", title: "President" }, "mei@example.com": { image: "x" } });
    expect(await readSignatures(db, asha)).toMatchObject({ "asha@example.com": { title: "President" } });
    expect(await readSignatures(db, mei)).toEqual({});
  });
});
