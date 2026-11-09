// Who volunteers with which organization ("sevak.memberships.v1" in the
// screens; app/members-store.js). One record per person and organization:
//
//   requested  the person asked to join; the organization's team decides
//   invited    the team invited this email; the person accepts by signing in
//   active     a volunteer with the organization
//   declined   the team didn't approve the request
//
// Who may do what (everything else is refused and left as it was):
//   - the person: ask to join (approved straight away if the organization
//     approves automatically), accept an invitation, withdraw or leave
//   - the organization's team (Admins and Coordinators) and Sevak staff:
//     approve, decline, invite by email, remove
//   - anyone with the organization's invite code: join it (joinWithCode);
//     the codes themselves are never sent outside the team
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { type Db, records } from "@sevak/db";
import type { Viewer } from "./auth";
import { idSchema, isOrgAdmin, type Json, lower, objectSchema, organizationsById, publicOrganization, readProfile, tooBig } from "./records";
import { askedToJoin, decided, invited, type Mail, welcome } from "./notify";
import { newToken } from "./tokens";

const COLLECTION = "memberships";
const MAX_BYTES = 200_000; // includes a small profile photo
const now = () => new Date().toISOString();

// Who sees and decides an organization's memberships: its Admins and
// Sevak staff (not Coordinators: volunteers' details stay with Admins).
function canManage(org: Json | undefined, viewer: Viewer) {
  return isOrgAdmin(org, viewer);
}

export async function readMemberships(db: Db, viewer: Viewer): Promise<Json[]> {
  const [rows, orgs] = await Promise.all([
    db.select().from(records).where(eq(records.collection, COLLECTION)).orderBy(records.createdAt),
    organizationsById(db),
  ]);
  return rows
    .filter((r) => lower(r.data.email) === viewer.email || canManage(orgs.get(String(r.data.orgId)), viewer))
    .map((r) => r.data);
}

// What the organization sees about a volunteer: a snapshot of their profile.
async function snapshot(db: Db, viewer: Viewer): Promise<Json> {
  const p = (await readProfile(db, viewer)) ?? {};
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
  return { name: name || viewer.email, email: viewer.email, photo: p.photo ?? "", services: p.services ?? [], aboutMe: p.aboutMe ?? "" };
}

// The person's own change: ask, accept an invitation, or (with automatic
// approval) join. Returns the record to save, or null if not allowed.
function asSelf(raw: Json, prev: Json | null, org: Json, viewer: Viewer): Json | null {
  const status = raw.status;
  const base: Json = { ...raw, email: viewer.email };
  // Decisions are the organization's: keep its record of them.
  for (const f of ["decidedAt", "decidedBy", "invitedAt", "invitedBy"]) {
    if (prev && prev[f] !== undefined) base[f] = prev[f];
    else delete base[f];
  }
  // Someone the organization declined asks again rather than joining.
  const auto = org.autoApprove === true && prev?.status !== "declined";
  if (status === "requested" || (status === "active" && auto)) {
    if (auto) return { ...base, status: "active", how: "auto-approved", decidedAt: now() };
    return { ...base, status: "requested", how: "request" };
  }
  if (status === "active" && (prev?.status === "invited" || prev?.status === "active")) {
    return { ...base, status: "active", how: prev.status === "invited" ? "invitation" : prev.how, decidedAt: prev.decidedAt ?? now() };
  }
  return null;
}

// The organization team's change: decide on a request, or invite someone.
function asTeam(raw: Json, prev: Json | null, viewer: Viewer): Json | null {
  const status = raw.status;
  if (!prev) {
    if (status !== "invited") return null;
    const email = lower(raw.email);
    if (!z.email().safeParse(email).success) return null;
    return {
      id: raw.id,
      orgId: raw.orgId,
      email,
      name: typeof raw.name === "string" ? raw.name.slice(0, 120) : "",
      status: "invited",
      invitedAt: now(),
      invitedBy: viewer.email,
      createdAt: now(),
      updatedAt: now(),
    };
  }
  if (status === prev.status) return prev; // nothing the team may change
  if ((status === "active" || status === "declined") && ["requested", "declined", "active"].includes(String(prev.status))) {
    return { ...prev, status, decidedAt: now(), decidedBy: viewer.email, updatedAt: now() };
  }
  if (status === "invited" && prev.status !== "active") {
    return { ...prev, status, invitedAt: now(), invitedBy: viewer.email, updatedAt: now() };
  }
  return null;
}

export const membershipOpsSchema = z.object({
  upsert: z.array(objectSchema).max(200).default([]),
  delete: z.array(z.string()).max(200).default([]),
});

export async function writeMemberships(db: Db, viewer: Viewer, ops: unknown): Promise<{ refused: number; reason?: string; value: Json[]; emails: Mail[] }> {
  const { upsert, delete: remove } = membershipOpsSchema.parse(ops);
  const orgs = await organizationsById(db);
  let refused = 0;
  let reason: string | undefined;
  const emails: Mail[] = [];

  await db.transaction(async (tx) => {
    const ids = [...upsert.map((m) => String(m.id ?? "")), ...remove];
    const existing = ids.length
      ? await tx.select().from(records).where(and(eq(records.collection, COLLECTION), inArray(records.id, ids))).for("update")
      : [];
    const byId = new Map(existing.map((r) => [r.id, r.data]));
    const emailsIn = new Map<string, Set<string>>(); // who already has a record, by organization

    for (const raw of upsert) {
      const id = idSchema.safeParse(raw.id);
      const prev = id.success ? (byId.get(id.data) ?? null) : null;
      const orgId = String(prev?.orgId ?? raw.orgId ?? "");
      const org = orgs.get(orgId);
      if (!id.success || !org || tooBig(raw, MAX_BYTES) || (prev && raw.orgId !== prev.orgId)) {
        refused++;
        continue;
      }
      const self = lower(raw.email) === viewer.email && (!prev || lower(prev.email) === viewer.email);
      // One record per person and organization: a second one is refused.
      const email = lower(self ? viewer.email : raw.email);
      if (!prev) {
        if (!emailsIn.has(orgId)) {
          const rows = await tx.select({ data: records.data }).from(records).where(and(eq(records.collection, COLLECTION), eq(records.orgId, orgId)));
          emailsIn.set(orgId, new Set(rows.map((r) => lower(r.data.email))));
        }
        if (emailsIn.get(orgId)!.has(email)) {
          refused++;
          reason ??= "already_asked";
          continue;
        }
      }
      let next = self ? asSelf(raw, prev, org, viewer) : null;
      if (!next && canManage(org, viewer)) next = asTeam(raw, prev, viewer);
      if (!next) {
        refused++;
        continue;
      }
      if (next === prev) continue;
      await tx
        .insert(records)
        .values({ collection: COLLECTION, id: id.data, orgId, data: next, updatedBy: viewer.id })
        .onConflictDoUpdate({ target: [records.collection, records.id], set: { data: next, orgId, updatedAt: new Date(), updatedBy: viewer.id } });
      byId.set(id.data, next);
      emailsIn.get(orgId)?.add(lower(next.email));

      // Who to tell.
      const to = String(next.email);
      if (next.status !== prev?.status) {
        if (next.status === "invited") emails.push(invited(org, to));
        else if (next.status === "requested") emails.push(...askedToJoin(org, String(next.name || to)));
        else if (next.status === "declined") emails.push(decided(org, to, false));
        else if (next.status === "active") emails.push(to === viewer.email ? welcome(org, to) : decided(org, to, true));
      }
    }

    for (const id of remove) {
      const prev = byId.get(id);
      if (!prev) continue;
      if (lower(prev.email) !== viewer.email && !canManage(orgs.get(String(prev.orgId)), viewer)) {
        refused++;
        continue;
      }
      await tx.delete(records).where(and(eq(records.collection, COLLECTION), eq(records.id, id)));
      byId.delete(id);
    }
  });

  return { refused, reason, value: await readMemberships(db, viewer), emails };
}

// ---------- Invite codes ----------

export function normalizeCode(code: unknown): string {
  return String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
}

async function orgWithCode(db: Db, code: unknown): Promise<Json | null> {
  const want = normalizeCode(code);
  if (want.length < 4) return null;
  for (const org of (await organizationsById(db)).values()) {
    if (typeof org.inviteCode === "string" && org.inviteCode === want) return org;
  }
  return null;
}

// The public part of the organization an invite code belongs to, so the
// join page can say who's inviting you. Null if no organization has it.
export async function organizationForCode(db: Db, code: unknown): Promise<Json | null> {
  const org = await orgWithCode(db, code);
  return org ? publicOrganization(org) : null;
}

// Joins the organization whose invite code this is, as an active volunteer.
export async function joinWithCode(db: Db, viewer: Viewer, code: unknown, note: unknown): Promise<{ organization: Json; value: Json[]; emails: Mail[] } | null> {
  const org = await orgWithCode(db, code);
  if (!org) return null;
  const orgId = String(org.id);
  const [current] = (await db.select().from(records).where(eq(records.collection, COLLECTION))).filter(
    (r) => r.orgId === orgId && lower(r.data.email) === viewer.email,
  );
  const prev = current?.data ?? null;
  const record: Json = {
    ...(prev ?? { id: `mem-${newToken().slice(0, 12)}`, orgId, createdAt: now() }),
    ...(await snapshot(db, viewer)),
    status: "active",
    how: "invitation",
    note: typeof note === "string" ? note.trim().slice(0, 300) : (prev?.note ?? ""),
    requestedAt: prev?.requestedAt ?? now(),
    decidedAt: prev?.status === "active" ? prev.decidedAt : now(),
    updatedAt: now(),
  };
  await db
    .insert(records)
    .values({ collection: COLLECTION, id: String(record.id), orgId, data: record, updatedBy: viewer.id })
    .onConflictDoUpdate({ target: [records.collection, records.id], set: { data: record, updatedAt: new Date(), updatedBy: viewer.id } });
  const emails = prev?.status === "active" ? [] : [welcome(org, viewer.email)];
  return { organization: publicOrganization(org), value: await readMemberships(db, viewer), emails };
}
