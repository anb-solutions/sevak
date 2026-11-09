// Attacks from the pre-launch security review, each refused.
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, users } from "@sevak/db";
import { createMemoryDb } from "@sevak/db/memory";
import type { Viewer } from "./auth";
import { readCertificates, verifyCertificate, writeCertificates } from "./certificates";
import { acceptUpload, documentFor, PERSON_QUOTA_BYTES, readDocuments, UploadRefused, writeDocuments } from "./documents";
import { readEventsAndMain, writeEvents, writeMainEvents } from "./events";
import { readMemberships, writeMemberships } from "./memberships";
import { readOrganizations, writeOrganizations } from "./records";
import { readSignups, writeSignups } from "./signups";

let db: Db;
let boss: Viewer; // Admin of the victim organization
let vol: Viewer; // one of its volunteers
let evil: Viewer; // the attacker
let staff: Viewer;

async function person(email: string, isPlatformAdmin = false): Promise<Viewer> {
  const [u] = await db.insert(users).values({ email }).returning();
  return { id: u!.id, email, isPlatformAdmin };
}

const enc = (s: string) => new TextEncoder().encode(s);
const roles = [{ id: "r1", name: "Setup", shifts: [{ id: "s1", date: "2030-01-10", start: "09:00", end: "12:00", capacity: 5 }] }];

beforeEach(async () => {
  db = await createMemoryDb();
  boss = await person("boss@victim.org");
  vol = await person("vol@example.com");
  evil = await person("evil@example.com");
  staff = await person("staff@example.com", true);
  await writeOrganizations(db, boss, { upsert: [{ id: "org-v", name: "Victim", autoApprove: true }] });
  await writeEvents(db, boss, { upsert: [{ id: "ev-v", organizationId: "org-v", title: "Seva", status: "published", roles, eventAdmin: "boss@victim.org" }] });
  await writeMemberships(db, vol, { upsert: [{ id: "m-1", orgId: "org-v", email: vol.email, status: "requested" }] });
  await writeSignups(db, vol, { upsert: [{ id: "su-1", eventId: "ev-v", shiftId: "s1", email: vol.email, name: "Vol" }] });
  await writeDocuments(db, boss, { upsert: [{ id: "doc-ev", owner: "event:ev-v", name: "waivers" }] });
  await acceptUpload(db, boss, "doc-ev", enc("%PDF-1.4 waivers"));
  await writeOrganizations(db, evil, { upsert: [{ id: "org-a", name: "Attacker" }] });
});

describe("deleted organizations and events", () => {
  it("can't be taken over by reusing an event's id", async () => {
    expect((await writeEvents(db, boss, { delete: ["ev-v"] })).refused).toBe(0);
    expect((await writeEvents(db, evil, { upsert: [{ id: "ev-v", organizationId: "org-a", title: "x", status: "draft", roles: [] }] })).refused).toBe(1);
    expect((await readSignups(db, evil)).find((s) => s.id === "su-1")?.email).toBeUndefined();
    expect(await documentFor(db, evil, "doc-ev")).toBeNull();
  });

  it("can't be taken over by reusing an organization's id", async () => {
    expect((await writeOrganizations(db, boss, { delete: ["org-v"] })).refused).toBe(0);
    expect((await writeOrganizations(db, evil, { upsert: [{ id: "org-v", name: "Mine" }] })).refused).toBe(1);
    expect(await readMemberships(db, evil)).toEqual([]);
    expect((await readEventsAndMain(db, evil)).events).toEqual([]);
    // Its events went with it, and their ids can't be reused either.
    expect((await readEventsAndMain(db, staff)).events.find((e) => e.id === "ev-v")).toBeUndefined();
    expect((await writeEvents(db, evil, { upsert: [{ id: "ev-v", organizationId: "org-a", title: "x", status: "draft", roles: [] }] })).refused).toBe(1);
    // The volunteer keeps their own sign-up and hours.
    expect((await readSignups(db, vol)).find((s) => s.id === "su-1")).toBeTruthy();
  });
});

describe("certificates", () => {
  it("say who issued them from Sevak's records, and whether Sevak verified them", async () => {
    await writeEvents(db, evil, { upsert: [{ id: "ev-a", organizationId: "org-a", title: "Disaster relief", status: "published", roles }] });
    await writeMemberships(db, evil, { upsert: [{ id: "m-a", orgId: "org-a", email: evil.email, status: "requested" }] });
    await writeSignups(db, evil, { upsert: [{ id: "su-a", eventId: "ev-a", shiftId: "s1", email: evil.email }] });
    const [mine] = await readSignups(db, evil).then((l) => l.filter((s) => s.id === "su-a"));
    // Hours for one sign-up are at most a day.
    expect((await writeSignups(db, evil, { upsert: [{ ...mine, hours: { minutes: 600_000, status: "approved", approvedMinutes: 600_000 } }] })).refused).toBe(1);
    await writeSignups(db, evil, { upsert: [{ ...mine, hours: { minutes: 180, status: "approved", approvedMinutes: 180 } }] });
    await writeCertificates(db, evil, { upsert: [{ id: "cert-a", orgId: "org-a", name: "Jane Q. Public", from: "2030-01-01", to: "2030-01-31", status: "requested" }] });
    const [req] = await readCertificates(db, evil);
    const forged = { code: "SVK-AAAA-BBBB", minutes: 180, org: { name: "American Red Cross", verified: true }, events: [{ title: "Anything" }] };
    expect((await writeCertificates(db, evil, { upsert: [{ ...req, status: "issued", code: forged.code, data: forged }] })).refused).toBe(0);
    const shown = await verifyCertificate(db, forged.code);
    expect(shown!.data).toMatchObject({ org: { name: "Attacker", verified: false }, events: [{ title: "Disaster relief" }], minutes: 180 });
  });
});

describe("documents", () => {
  it("keep one quota per person, however the email is written", async () => {
    const nine = new Uint8Array(9 * 1024 * 1024).fill(65);
    const ways = ["profile:vol@example.com", "profile:VOL@example.com", "profile: vol@example.com ", "profile:Vol@Example.com"];
    const fits = Math.floor(PERSON_QUOTA_BYTES / nine.length);
    for (let i = 0; i <= fits; i++) {
      await writeDocuments(db, vol, { upsert: [{ id: `doc-${i}`, owner: ways[i % ways.length], name: `f${i}` }] });
      if (i < fits) await acceptUpload(db, vol, `doc-${i}`, nine);
      else await expect(acceptUpload(db, vol, `doc-${i}`, nine)).rejects.toThrow(UploadRefused);
    }
    expect((await readDocuments(db, vol)).every((d) => d.owner === "profile:vol@example.com")).toBe(true);
  });

  it("can't be put in someone's documents by an organization they didn't ask", async () => {
    const plant = { id: "doc-x", owner: "profile:vol@example.com", name: "Certificate · urgent", source: "certificate", orgId: "org-a" };
    expect((await writeDocuments(db, evil, { upsert: [plant] })).refused).toBe(1);
  });

  it("can be added once, as a certificate's PDF, by the organization asked for it", async () => {
    await writeCertificates(db, vol, { upsert: [{ id: "cert-v", orgId: "org-v", name: "Vol", from: "2030-01-01", to: "2030-01-31", status: "requested" }] });
    const pdf = { id: "doc-c", owner: "profile:vol@example.com", name: "Certificate · Victim", source: "certificate", orgId: "org-v" };
    expect((await writeDocuments(db, boss, { upsert: [pdf] })).refused).toBe(0);
    await acceptUpload(db, boss, "doc-c", enc("%PDF-1.4 cert"));
    await expect(acceptUpload(db, boss, "doc-c", enc("%PDF-1.4 replaced"))).rejects.toThrow(UploadRefused);
    expect((await writeDocuments(db, boss, { upsert: [{ ...pdf, name: "Certificate · renamed" }] })).refused).toBe(1);
    expect((await readDocuments(db, vol)).some((d) => d.id === "doc-c")).toBe(true);
  });
});

describe("smaller leaks", () => {
  it("doesn't show another organization's main events", async () => {
    await writeMainEvents(db, boss, { upsert: [{ id: "main-v", organizationId: "org-v", title: "Secret", status: "draft", notes: "private" }] });
    await writeEvents(db, evil, { upsert: [{ id: "ev-x", organizationId: "org-a", title: "x", status: "draft", mainEventId: "main-v", roles: [] }] });
    expect((await readEventsAndMain(db, evil)).mainEvents.find((m) => m.id === "main-v")).toBeUndefined();
  });

  it("doesn't let anyone claim a sign-up with no email", async () => {
    await writeSignups(db, boss, { upsert: [{ id: "su-team", eventId: "ev-v", shiftId: "s1", name: "Walk-in", status: "confirmed" }] });
    const r = await writeSignups(db, evil, { upsert: [{ id: "su-team", eventId: "ev-v", shiftId: "s1", email: evil.email, status: "cancelled" }] });
    expect(r.refused).toBe(1);
  });

  it("asks Sevak to check again when a verified organization changes its name", async () => {
    const [org] = await readOrganizations(db, boss).then((l) => l.filter((o) => o.id === "org-v"));
    await writeOrganizations(db, boss, { upsert: [{ ...org, verificationStatus: "pending" }] });
    const [pending] = (await readOrganizations(db, staff)).filter((o) => o.id === "org-v");
    await writeOrganizations(db, staff, { upsert: [{ ...pending, verificationStatus: "verified" }] });
    const [verified] = (await readOrganizations(db, boss)).filter((o) => o.id === "org-v");
    await writeOrganizations(db, boss, { upsert: [{ ...verified, description: "New words" }] });
    expect((await readOrganizations(db, boss)).find((o) => o.id === "org-v")!.verificationStatus).toBe("verified");
    const renamed = await writeOrganizations(db, boss, { upsert: [{ ...verified, name: "American Red Cross" }] });
    expect(renamed.value.find((o) => o.id === "org-v")!.verificationStatus).toBe("pending");
    expect(renamed.emails.map((m) => m.to)).toContain("@staff");
  });

  it("doesn't show who runs an event to people outside its team", async () => {
    expect((await readEventsAndMain(db, vol)).events[0]).not.toHaveProperty("eventAdmin");
    expect((await readEventsAndMain(db, null)).events.every((e) => !("eventAdmin" in e))).toBe(true);
    expect((await readEventsAndMain(db, boss)).events.find((e) => e.id === "ev-v")).toHaveProperty("eventAdmin");
  });
});
