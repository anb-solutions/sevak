// What the current screens save, kept on the server so it's the same on
// every device and shared with the people it should be. The screens keep
// their data in browser storage under keys like "sevak.organizations.v1";
// app/sync.js (added when the app serves the screens) loads those keys from
// here and sends every change back. This file decides who may read and
// change what. Screens move to React and proper tables over time.
//
//   sevak.profile.v1        your profile (only you)
//   sevak.organizations.v1  organizations: everyone sees the public part;
//                           the team (and Sevak staff) see and change the rest
//   sevak.memberships.v1    who volunteers with which organization
//                           (memberships.ts)
//   sevak.events.v1,        events and main events (events.ts)
//   sevak.mainEvents.v1
//   sevak.signups.v1        sign-ups, check-ins and hours (signups.ts)
//   sevak.certificates.v1,  certificates and signatures (certificates.ts)
//   sevak.signatures.v1
//   sevak.documents.v1      documents' details; files are stored apart
//                           (documents.ts)
//
// Records whose id starts with "demo-" are the screens' own demo data and
// stay in each browser; they never reach the server.
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { type Db, records, users } from "@sevak/db";
import type { Viewer } from "./auth";
import type { Mail } from "./notify";

export const PROFILE_KEY = "sevak.profile.v1";
export const ORGANIZATIONS_KEY = "sevak.organizations.v1";
export const MEMBERSHIPS_KEY = "sevak.memberships.v1";
export const EVENTS_KEY = "sevak.events.v1";
export const MAIN_EVENTS_KEY = "sevak.mainEvents.v1";
export const SIGNUPS_KEY = "sevak.signups.v1";
export const CERTIFICATES_KEY = "sevak.certificates.v1";
export const SIGNATURES_KEY = "sevak.signatures.v1";
export const DOCUMENTS_KEY = "sevak.documents.v1";
export const SYNCED_KEYS = [
  PROFILE_KEY,
  ORGANIZATIONS_KEY,
  MEMBERSHIPS_KEY,
  EVENTS_KEY,
  MAIN_EVENTS_KEY,
  SIGNUPS_KEY,
  CERTIFICATES_KEY,
  SIGNATURES_KEY,
  DOCUMENTS_KEY,
] as const;
export type SyncedKey = (typeof SYNCED_KEYS)[number];

export type Json = Record<string, unknown>;

const MAX_PROFILE_BYTES = 1_500_000; // room for a profile photo
const MAX_ORG_BYTES = 500_000;
export const INVITE_CODE = /^[A-HJ-NP-Z2-9]{8,16}$/;
export const MAX_ORGS_PER_PERSON = 10; // organizations one person can set up (staff aside)

export const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,80}$/)
  .refine((id) => !id.startsWith("demo-"), "Demo records stay in the browser.");

export const objectSchema = z.record(z.string(), z.unknown());

export function tooBig(value: unknown, max: number) {
  return JSON.stringify(value).length > max;
}

export const lower = (s: unknown) => String(s ?? "").trim().toLowerCase();
const str = (s: unknown) => (typeof s === "string" ? s.trim().slice(0, 200) : "");

// ---------- Profile ----------

export async function readProfile(db: Db, viewer: Viewer): Promise<Json | null> {
  const [row] = await db.select({ profile: users.profile }).from(users).where(eq(users.id, viewer.id));
  return row?.profile ? { ...row.profile, email: viewer.email } : null;
}

// Saves your profile (or clears it, with null). Your email is the one you
// signed in with; changing it needs a new sign-in, so it's kept as is.
export async function writeProfile(db: Db, viewer: Viewer, value: unknown): Promise<Json | null> {
  if (value === null) {
    await db.update(users).set({ profile: null, firstName: "", lastName: "", phone: null }).where(eq(users.id, viewer.id));
    return null;
  }
  const profile = objectSchema.parse(value);
  if (tooBig(profile, MAX_PROFILE_BYTES)) throw new RecordError("too_large");
  const saved = { ...profile, email: viewer.email };
  const phone = typeof profile.phone === "string" ? profile.phone : (profile.phone as Json | undefined)?.number;
  await db
    .update(users)
    .set({
      profile: saved,
      firstName: str(profile.firstName),
      lastName: str(profile.lastName),
      phone: typeof phone === "string" && /^\+[1-9]\d{6,14}$/.test(phone) ? phone : null,
    })
    .where(eq(users.id, viewer.id));
  return saved;
}

export class RecordError extends Error {
  constructor(public code: "too_large" | "invalid") {
    super(code);
  }
}

// ---------- Organizations ----------

// "admin", "coordinator" or null, the same way the screens decide it
// (app/orgs-store.js roleFor): Admins on the Team tab, the primary contact
// and whoever created it are Admins; others on the Team tab Coordinators.
export function orgRole(org: Json, email: string): "admin" | "coordinator" | null {
  if (!email) return null;
  const team = Array.isArray(org.team) ? (org.team as Json[]) : [];
  const roles = team.filter((m) => lower(m?.email) === email).map((m) => (m.role === "admin" ? "admin" : "coordinator"));
  if (lower((org.primaryContact as Json | undefined)?.email) === email) roles.push("admin");
  if (lower(org.createdBy) === email) roles.push("admin");
  if (roles.includes("admin")) return "admin";
  return roles.length ? "coordinator" : null;
}

// What anyone may see of an organization: enough for its events' pages and
// for joining it. Not its team, contacts, invite code or verification evidence.
export function publicOrganization(org: Json): Json {
  const address = (org.address ?? {}) as Json;
  const pick: Json = {};
  // autoApprove: whether asking to join is approved straight away.
  for (const key of ["id", "name", "description", "website", "logo", "taxStatus", "verificationStatus", "socials", "autoApprove"]) {
    if (org[key] !== undefined) pick[key] = org[key];
  }
  pick.address = { city: address.city, state: address.state, country: address.country };
  pick.team = [];
  pick.public = true; // marks a partial copy; see app/sync.js
  return pick;
}

function canSeeAll(org: Json, viewer: Viewer | null) {
  return !!viewer && (viewer.isPlatformAdmin || orgRole(org, viewer.email) !== null);
}

export async function readOrganizations(db: Db, viewer: Viewer | null): Promise<Json[]> {
  const rows = await db.select().from(records).where(eq(records.collection, "organizations")).orderBy(records.createdAt);
  return rows.map((r) => (canSeeAll(r.data, viewer) ? r.data : publicOrganization(r.data)));
}

const VERIFICATION_FIELDS = ["verificationStatus", "verification"] as const;
// What Sevak checks when it verifies an organization.
const IDENTITY_FIELDS = ["name", "website", "registrationNumber", "ein", "taxStatus"] as const;

// Only Sevak staff decide verification (ORG-3). An organization's Admins can
// ask for it (status "pending"), withdraw, or reset it to "unverified".
function keepStaffFields(next: Json, prev: Json | null): Json {
  const out = { ...next };
  const before = (prev?.verificationStatus as string | undefined) ?? "unverified";
  const after = (next.verificationStatus as string | undefined) ?? "unverified";
  const asking = after === "pending" && (before === "unverified" || before === "rejected");
  const resetting = after === "unverified";
  if (after === before || (!asking && !resetting)) {
    for (const f of VERIFICATION_FIELDS) {
      if (prev && prev[f] !== undefined) out[f] = prev[f];
      else delete out[f];
    }
    if (!prev) out.verificationStatus = "unverified";
    // Verified means Sevak checked these; changing one means checking again.
    if (before === "verified" && prev && IDENTITY_FIELDS.some((f) => stableJson(next[f] ?? "") !== stableJson(prev[f] ?? ""))) {
      out.verificationStatus = "pending";
      out.verification = { ...((prev.verification as Json | undefined) ?? {}), requestedAt: new Date().toISOString(), changedAfterVerification: true };
      delete (out.verification as Json).decidedAt;
      delete (out.verification as Json).decidedBy;
      delete (out.verification as Json).reason;
    }
  } else if (asking && out.verification && typeof out.verification === "object") {
    const v = { ...(out.verification as Json) };
    delete v.decidedAt;
    delete v.decidedBy;
    delete v.reason;
    out.verification = v;
  }
  return out;
}

// What a Coordinator may change: only taking themselves off the team.
function isLeaving(next: Json, prev: Json, email: string) {
  const expected: Json = { ...prev, team: ((prev.team as Json[] | undefined) ?? []).filter((m) => lower(m?.email) !== email) };
  if (lower(prev.createdBy) === email) delete expected.createdBy;
  return stableJson(expected) === stableJson(next);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Json;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export const organizationOpsSchema = z.object({
  upsert: z.array(objectSchema).max(50).default([]),
  delete: z.array(z.string()).max(50).default([]),
});

// Applies changes from a screen: organizations to add or update, and ids to
// delete. Each one is checked on its own; what isn't allowed is left as it
// was. Returns how many were refused and the organizations as you now see them.
export async function writeOrganizations(db: Db, viewer: Viewer, ops: unknown): Promise<{ refused: number; reason?: string; value: Json[]; emails: Mail[] }> {
  const { upsert, delete: remove } = organizationOpsSchema.parse(ops);
  const { addedToTeam, verificationDecided, verificationRequested } = await import("./notify");
  let refused = 0;
  let reason: string | undefined;
  const emails: Mail[] = [];

  await db.transaction(async (tx) => {
    const ids = [...upsert.map((o) => String(o.id ?? "")), ...remove];
    const existing = ids.length
      ? await tx.select().from(records).where(and(eq(records.collection, "organizations"), inArray(records.id, ids))).for("update")
      : [];
    const byId = new Map(existing.map((r) => [r.id, r.data]));
    const gone = await buried(tx, "organizations", ids);

    for (const raw of upsert) {
      const id = idSchema.safeParse(raw.id);
      if (!id.success || tooBig(raw, MAX_ORG_BYTES) || raw.public === true || (!byId.has(id.data) && gone.has(id.data))) {
        refused++;
        continue;
      }
      const prev = byId.get(id.data) ?? null;
      const role = prev ? orgRole(prev, viewer.email) : null;
      let next: Json;
      if (!prev && !viewer.isPlatformAdmin) {
        const [mine] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(records)
          .where(and(eq(records.collection, "organizations"), sql`lower(${records.data}->>'createdBy') = ${viewer.email}`));
        if ((mine?.n ?? 0) >= MAX_ORGS_PER_PERSON) {
          refused++;
          reason ??= "too_many";
          continue;
        }
      }
      if (!prev) {
        // Anyone signed in can set up an organization, and is its Admin.
        next = viewer.isPlatformAdmin ? { ...raw, createdBy: raw.createdBy ?? viewer.email } : keepStaffFields({ ...raw, createdBy: viewer.email }, null);
      } else if (viewer.isPlatformAdmin) {
        next = raw;
      } else if (role === "admin") {
        next = keepStaffFields(raw, prev);
      } else if (role === "coordinator" && isLeaving(raw, prev, viewer.email)) {
        next = raw;
      } else {
        refused++;
        continue;
      }
      // A new invite code must be long enough not to be guessed.
      if (next.inviteCode !== prev?.inviteCode && next.inviteCode !== undefined && !(typeof next.inviteCode === "string" && INVITE_CODE.test(next.inviteCode))) {
        if (prev?.inviteCode !== undefined) next = { ...next, inviteCode: prev.inviteCode };
        else {
          next = { ...next };
          delete next.inviteCode;
        }
      }
      await tx
        .insert(records)
        .values({ collection: "organizations", id: id.data, orgId: id.data, data: next, updatedBy: viewer.id })
        .onConflictDoUpdate({ target: [records.collection, records.id], set: { data: next, updatedAt: new Date(), updatedBy: viewer.id } });
      byId.set(id.data, next);

      // Who to tell: people newly on the team, and about verification.
      const before = new Set(((prev?.team as Json[] | undefined) ?? []).map((m) => lower(m?.email)));
      for (const m of (next.team as Json[] | undefined) ?? []) {
        const email = lower(m?.email);
        if (email.includes("@") && email !== viewer.email && !before.has(email)) emails.push(addedToTeam(next, email, String(m.role)));
      }
      const was = prev?.verificationStatus ?? "unverified";
      if (next.verificationStatus !== was) {
        if (next.verificationStatus === "pending") emails.push(verificationRequested(next));
        else if (was === "pending" && (next.verificationStatus === "verified" || next.verificationStatus === "rejected")) {
          emails.push(...verificationDecided(next, next.verificationStatus === "verified", String((next.verification as Json | undefined)?.reason ?? "")));
        }
      }
    }

    for (const id of remove) {
      const prev = byId.get(id);
      if (!prev) continue; // already gone
      if (!viewer.isPlatformAdmin && orgRole(prev, viewer.email) !== "admin") {
        refused++;
        continue;
      }
      await tx.delete(records).where(and(eq(records.collection, "organizations"), eq(records.id, id)));
      await bury(tx, "organizations", id, viewer);
      // Its events, who volunteers with it and its connections (Zeffy) go too. Sign-ups (with their
      // hours), certificates and documents stay with the people they're for.
      const owned = await tx
        .select({ collection: records.collection, id: records.id })
        .from(records)
        .where(and(inArray(records.collection, ["events", "mainEvents", "memberships", "integrations"]), eq(records.orgId, id)));
      for (const r of owned) {
        await tx.delete(records).where(and(eq(records.collection, r.collection), eq(records.id, r.id)));
        if (r.collection === "events" || r.collection === "mainEvents") await bury(tx, r.collection, r.id, viewer);
      }
      byId.delete(id);
    }
  });

  return { refused, reason, value: await readOrganizations(db, viewer), emails };
}

// ---------- Deleted ids ----------

// Sign-ups, certificates and documents point at organizations and events by
// id. When one is deleted, its id is kept here so nobody can create a new
// one with the same id and so see what pointed at the old one.
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function bury(tx: Tx, collection: string, id: string, viewer: Viewer) {
  await tx
    .insert(records)
    .values({ collection: "deleted", id: `${collection}:${id}`, data: { at: new Date().toISOString(), by: viewer.email }, updatedBy: viewer.id })
    .onConflictDoNothing();
}

export async function buried(tx: Tx, collection: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await tx
    .select({ id: records.id })
    .from(records)
    .where(and(eq(records.collection, "deleted"), inArray(records.id, ids.map((id) => `${collection}:${id}`))));
  return new Set(rows.map((r) => r.id.slice(collection.length + 1)));
}

// ---------- Everything a page loads ----------

export async function readSynced(db: Db, viewer: Viewer | null): Promise<Record<SyncedKey, unknown>> {
  const { readMemberships } = await import("./memberships");
  const { readEventsAndMain } = await import("./events");
  const { readSignups } = await import("./signups");
  const { readCertificates, readSignatures } = await import("./certificates");
  const { readDocuments } = await import("./documents");
  const { events, mainEvents } = await readEventsAndMain(db, viewer);
  return {
    [PROFILE_KEY]: viewer ? await readProfile(db, viewer) : null,
    [ORGANIZATIONS_KEY]: await readOrganizations(db, viewer),
    [MEMBERSHIPS_KEY]: viewer ? await readMemberships(db, viewer) : [],
    [EVENTS_KEY]: events,
    [MAIN_EVENTS_KEY]: mainEvents,
    [SIGNUPS_KEY]: await readSignups(db, viewer),
    [CERTIFICATES_KEY]: viewer ? await readCertificates(db, viewer) : [],
    [SIGNATURES_KEY]: viewer ? await readSignatures(db, viewer) : {},
    [DOCUMENTS_KEY]: viewer ? await readDocuments(db, viewer) : [],
  };
}

// Every organization's full record, by id (for access checks).
export async function organizationsById(db: Db): Promise<Map<string, Json>> {
  const rows = await db.select().from(records).where(eq(records.collection, "organizations"));
  return new Map(rows.map((r) => [r.id, r.data]));
}
