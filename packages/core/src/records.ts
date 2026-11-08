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
//
// Records whose id starts with "demo-" are the screens' own demo data and
// stay in each browser; they never reach the server.
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { type Db, records, users } from "@sevak/db";
import type { Viewer } from "./auth";

export const PROFILE_KEY = "sevak.profile.v1";
export const ORGANIZATIONS_KEY = "sevak.organizations.v1";
export const MEMBERSHIPS_KEY = "sevak.memberships.v1";
export const SYNCED_KEYS = [PROFILE_KEY, ORGANIZATIONS_KEY, MEMBERSHIPS_KEY] as const;
export type SyncedKey = (typeof SYNCED_KEYS)[number];

export type Json = Record<string, unknown>;

const MAX_PROFILE_BYTES = 1_500_000; // room for a profile photo
const MAX_ORG_BYTES = 500_000;

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
export async function writeOrganizations(db: Db, viewer: Viewer, ops: unknown): Promise<{ refused: number; value: Json[] }> {
  const { upsert, delete: remove } = organizationOpsSchema.parse(ops);
  let refused = 0;

  await db.transaction(async (tx) => {
    const ids = [...upsert.map((o) => String(o.id ?? "")), ...remove];
    const existing = ids.length
      ? await tx.select().from(records).where(and(eq(records.collection, "organizations"), inArray(records.id, ids))).for("update")
      : [];
    const byId = new Map(existing.map((r) => [r.id, r.data]));

    for (const raw of upsert) {
      const id = idSchema.safeParse(raw.id);
      if (!id.success || tooBig(raw, MAX_ORG_BYTES) || raw.public === true) {
        refused++;
        continue;
      }
      const prev = byId.get(id.data) ?? null;
      const role = prev ? orgRole(prev, viewer.email) : null;
      let next: Json;
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
      await tx
        .insert(records)
        .values({ collection: "organizations", id: id.data, orgId: id.data, data: next, updatedBy: viewer.id })
        .onConflictDoUpdate({ target: [records.collection, records.id], set: { data: next, updatedAt: new Date(), updatedBy: viewer.id } });
      byId.set(id.data, next);
    }

    for (const id of remove) {
      const prev = byId.get(id);
      if (!prev) continue; // already gone
      if (!viewer.isPlatformAdmin && orgRole(prev, viewer.email) !== "admin") {
        refused++;
        continue;
      }
      await tx.delete(records).where(and(eq(records.collection, "organizations"), eq(records.id, id)));
      byId.delete(id);
    }
  });

  return { refused, value: await readOrganizations(db, viewer) };
}

// ---------- Everything a page loads ----------

export async function readSynced(db: Db, viewer: Viewer | null): Promise<Record<SyncedKey, unknown>> {
  const { readMemberships } = await import("./memberships");
  return {
    [PROFILE_KEY]: viewer ? await readProfile(db, viewer) : null,
    [ORGANIZATIONS_KEY]: await readOrganizations(db, viewer),
    [MEMBERSHIPS_KEY]: viewer ? await readMemberships(db, viewer) : [],
  };
}

// Every organization's full record, by id (for access checks).
export async function organizationsById(db: Db): Promise<Map<string, Json>> {
  const rows = await db.select().from(records).where(eq(records.collection, "organizations"));
  return new Map(rows.map((r) => [r.id, r.data]));
}
