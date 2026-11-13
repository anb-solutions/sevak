// The audit log: who changed what, and when (audit_log in the schema). Every
// record changed through the API is written down with the person who did
// it, whether it was created, changed or deleted, the names of the fields
// that changed, and a few decisions that matter later (statuses, hours, a
// team's roles, whose sign-up or membership it is). Values people typed
// (names, notes, addresses, phone numbers) aren't copied here.
//
// It's for Sevak staff, to answer "who did this?": a dispute over hours, a
// volunteer removed by mistake, an account someone else used. Nothing reads
// it on a page. docs/RUNBOOK.md shows how to query it.
import { and, eq, inArray } from "drizzle-orm";
import { auditLog, type Db, records } from "@sevak/db";
import type { Viewer } from "./auth";
import type { Json } from "./records";

export type Snapshot = Map<string, { data: Json; orgId: string | null }>;

// The records about to be changed, as they are now.
export async function snapshot(db: Db, collection: string, ids: string[]): Promise<Snapshot> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id))].slice(0, 500);
  if (!unique.length) return new Map();
  const rows = await db.select().from(records).where(and(eq(records.collection, collection), inArray(records.id, unique)));
  return new Map(rows.map((r) => [r.id, { data: r.data, orgId: r.orgId }]));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// The decisions worth keeping for each kind of record, as they are after
// the change: statuses, not personal details.
function facts(collection: string, d: Json): Json {
  const out: Json = {};
  const take = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  };
  take("status", d.status);
  if (collection === "organizations") {
    take("verificationStatus", d.verificationStatus);
    if (Array.isArray(d.team)) out.team = (d.team as Json[]).map((m) => `${String(m?.email ?? "").toLowerCase()}:${String(m?.role ?? "coordinator")}`);
  }
  if (collection === "events") {
    take("active", d.active);
    take("eventAdmin", d.eventAdmin);
  }
  if (collection === "signups") {
    const h = d.hours as Json | undefined;
    if (h) out.hours = { status: h.status, minutes: h.minutes, approvedMinutes: h.approvedMinutes, decidedBy: h.decidedBy };
    take("checkedIn", d.checkInAt ? true : undefined);
    take("email", d.email);
    take("shiftId", d.shiftId);
  }
  if (collection === "memberships" || collection === "certificates") {
    take("email", d.email);
    take("decidedBy", d.decidedBy);
  }
  if (collection === "certificates") take("code", d.code);
  return out;
}

// Writes down what changed between `before` and the records as they are now.
export async function recordChanges(db: Db, viewer: Viewer, collection: string, before: Snapshot, ids: string[]): Promise<number> {
  const after = await snapshot(db, collection, ids);
  const rows: (typeof auditLog.$inferInsert)[] = [];
  for (const id of new Set(ids)) {
    const was = before.get(id);
    const now = after.get(id);
    if (!was && !now) continue;
    if (was && now && same(was.data, now.data)) continue;
    const action = !was ? "created" : !now ? "deleted" : "changed";
    const fields = was && now ? [...new Set([...Object.keys(was.data), ...Object.keys(now.data)])].filter((k) => !same(was.data[k], now.data[k]) && k !== "updatedAt").sort() : [];
    rows.push({
      actorId: viewer.id,
      actorEmail: viewer.email,
      action,
      collection,
      recordId: id,
      orgId: (now ?? was)!.orgId,
      detail: { ...(fields.length ? { fields } : {}), ...facts(collection, (now ?? was)!.data) },
    });
  }
  if (rows.length) await db.insert(auditLog).values(rows);
  return rows.length;
}

// What the log says about one record, newest first (for staff, and tests).
export async function historyOf(db: Db, collection: string, recordId: string) {
  const rows = await db.select().from(auditLog).where(and(eq(auditLog.collection, collection), eq(auditLog.recordId, recordId)));
  return rows.sort((a, b) => b.at.getTime() - a.at.getTime());
}
