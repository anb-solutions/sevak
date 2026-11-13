// The emails each change produces: to the right people, and nobody else.
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, users } from "@sevak/db";
import { createMemoryDb } from "@sevak/db/memory";
import type { Viewer } from "./auth";
import { readCertificates, writeCertificates } from "./certificates";
import { writeEvents } from "./events";
import { joinWithCode, readMemberships, writeMemberships } from "./memberships";
import { STAFF } from "./notify";
import { readOrganizations, writeOrganizations } from "./records";
import { writeSignups } from "./signups";

let db: Db;
let asha: Viewer;
let mei: Viewer;
let staff: Viewer;

async function person(email: string, isPlatformAdmin = false): Promise<Viewer> {
  const [u] = await db.insert(users).values({ email }).returning();
  return { id: u!.id, email, isPlatformAdmin };
}

const temple = (extra: Record<string, unknown> = {}) => ({ id: "org-temple", name: "Temple", team: [], inviteCode: "SEVA4242", website: "temple.example.org", ...extra });
const to = (mails: { to: string; subject: string }[]) => mails.map((m) => `${m.to}: ${m.subject}`);

beforeEach(async () => {
  db = await createMemoryDb();
  asha = await person("asha@example.com");
  mei = await person("mei@example.com");
  staff = await person("staff@example.com", true);
  await writeOrganizations(db, asha, { upsert: [temple()] });
});

describe("emails", () => {
  it("tells people added to a team, but not the person who added them", async () => {
    const r = await writeOrganizations(db, asha, { upsert: [temple({ team: [{ email: "ravi@example.com", role: "coordinator" }, { email: "asha@example.com", role: "admin" }] })] });
    expect(to(r.emails)).toEqual(["ravi@example.com: You're on the team of Temple"]);
    const again = await writeOrganizations(db, asha, { upsert: [{ ...(await readOrganizations(db, asha))[0], name: "Temple" }] });
    expect(again.emails).toEqual([]);
  });

  it("asks Sevak staff to review a verification request, and tells the organization the decision", async () => {
    const [mine] = await readOrganizations(db, asha);
    const asked = await writeOrganizations(db, asha, { upsert: [{ ...mine, verificationStatus: "pending", verification: { requestedAt: "x" } }] });
    expect(asked.emails.map((m) => m.to)).toEqual([STAFF]);
    const [pending] = await readOrganizations(db, staff);
    const verified = await writeOrganizations(db, staff, { upsert: [{ ...pending, verificationStatus: "verified" }] });
    expect(to(verified.emails)).toEqual(["asha@example.com: Temple is verified"]);
  });

  it("invites by email with the join link, and welcomes people who join", async () => {
    const r = await writeMemberships(db, asha, { upsert: [{ id: "mem-1", orgId: "org-temple", email: "mei@example.com", status: "invited" }] });
    expect(to(r.emails)).toEqual(["mei@example.com: You're invited to volunteer with Temple"]);
    expect(r.emails[0]!.link).toBe("join.html?code=SEVA4242");
    const [inv] = await readMemberships(db, mei);
    const accepted = await writeMemberships(db, mei, { upsert: [{ ...inv, status: "active" }] });
    expect(to(accepted.emails)).toEqual(["mei@example.com: Welcome to Temple"]);
  });

  it("tells Admins about a request to join, and the person about the decision", async () => {
    const asked = await writeMemberships(db, mei, { upsert: [{ id: "mem-1", orgId: "org-temple", email: "mei@example.com", name: "Mei", status: "requested" }] });
    expect(to(asked.emails)).toEqual(["asha@example.com: Mei asked to volunteer with Temple"]);
    const [req] = await readMemberships(db, asha);
    const approved = await writeMemberships(db, asha, { upsert: [{ ...req, status: "active" }] });
    expect(to(approved.emails)).toEqual(["mei@example.com: Temple approved your request"]);
  });

  it("welcomes people who join with a code, once", async () => {
    expect(to((await joinWithCode(db, mei, "SEVA4242", ""))!.emails)).toEqual(["mei@example.com: Welcome to Temple"]);
    expect((await joinWithCode(db, mei, "SEVA4242", ""))!.emails).toEqual([]);
  });

  it("confirms a sign-up, one email for several shifts", async () => {
    await writeEvents(db, asha, { upsert: [{ id: "ev-1", organizationId: "org-temple", title: "Seva", status: "published", roles: [{ id: "r", name: "Setup", shifts: [{ id: "s1", date: "2030-01-10", start: "09:00", end: "12:00", capacity: 5 }, { id: "s2", date: "2030-01-11", start: "09:00", end: "12:00", capacity: 5 }] }] }] });
    await joinWithCode(db, mei, "SEVA4242", "");
    const r = await writeSignups(db, mei, { upsert: ["s1", "s2"].map((s) => ({ id: "su-" + s, eventId: "ev-1", shiftId: s, email: "mei@example.com", status: "confirmed" })) });
    expect(to(r.emails)).toEqual(["mei@example.com: You're signed up: Seva"]);
    expect(r.emails[0]!.text).toContain("- Thu, Jan 10, 9:00 AM–12:00 PM · Setup\n- Fri, Jan 11, 9:00 AM–12:00 PM · Setup");
  });

  it("tells Admins about a certificate request, and the volunteer when it's declined", async () => {
    const asked = await writeCertificates(db, mei, { upsert: [{ id: "cert-1", orgId: "org-temple", name: "Mei", from: "2030-01-01", to: "2030-01-31", status: "requested" }] });
    expect(to(asked.emails)).toEqual(["asha@example.com: Certificate request from Mei"]);
    const [req] = await readCertificates(db, asha);
    const declined = await writeCertificates(db, asha, { upsert: [{ ...req, status: "declined", reason: "No hours yet" }] });
    expect(to(declined.emails)).toEqual(["mei@example.com: Your certificate request to Temple"]);
    expect(declined.emails[0]!.text).toContain("No hours yet");
  });
});

describe("the sign-up confirmation", () => {
  it("gives each shift in 12-hour time in the event's time zone, and where to go", async () => {
    await writeEvents(db, asha, {
      upsert: [{ id: "ev-c", organizationId: "org-temple", organizationName: "Temple", title: "Flute evening", status: "published", visibility: "public", timezone: "America/Chicago",
        location: { type: "in-person", venue: "Main hall", line1: "1 Temple Rd", city: "Houston", state: "TX" },
        roles: [{ id: "r", name: "Door", shifts: [{ id: "s", date: "2030-01-10", start: "17:00", end: "20:30", capacity: 5 }] }] }],
    });
    await joinWithCode(db, mei, "SEVA4242", "");
    const r = await writeSignups(db, mei, { upsert: [{ id: "su-c", registrationId: "r", eventId: "ev-c", shiftId: "s", name: "Mei", email: "mei@example.com", status: "confirmed" }] });
    const mail = r.emails.find((m) => m.to === "mei@example.com")!;
    expect(mail.subject).toBe("You're signed up: Flute evening");
    expect(mail.text).toContain("- Thu, Jan 10, 5:00 PM–8:30 PM CST · Door");
    expect(mail.text).toContain("Where: Main hall, 1 Temple Rd, Houston, TX");
    expect(mail.link).toBe("signup.html?view=mine");
  });
});
