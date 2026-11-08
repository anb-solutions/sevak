// Events and main events, as the screens save them ("sevak.events.v1" and
// "sevak.mainEvents.v1"; app/events-store.js). Each belongs to an
// organization (organizationId).
//
// Who sees what:
//   - the organization's team (and Sevak staff): all its events, including
//     drafts, private and inactive ones
//   - its volunteers (active memberships): its published, active events,
//     public or private
//   - everyone else, signed in or not: published, active, public events of
//     verified organizations (EVT-16: an unverified organization's public
//     events stay private until it's verified)
//   A main event is shown to people who can see at least one of its events.
//
// Who changes what: the organization's team (Admins and Coordinators) adds
// and edits events and main events; only Admins delete them (EVT-19).
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { type Db, records } from "@sevak/db";
import type { Viewer } from "./auth";
import { idSchema, type Json, lower, objectSchema, organizationsById, orgRole, tooBig } from "./records";

const MAX_BYTES = 1_500_000; // room for a cover picture

type Collection = "events" | "mainEvents";

async function activeMemberOf(db: Db, viewer: Viewer | null): Promise<Set<string>> {
  if (!viewer) return new Set();
  const rows = await db.select().from(records).where(eq(records.collection, "memberships"));
  return new Set(rows.filter((r) => lower(r.data.email) === viewer.email && r.data.status === "active").map((r) => String(r.data.orgId)));
}

function isTeam(org: Json | undefined, viewer: Viewer | null) {
  return !!org && !!viewer && (viewer.isPlatformAdmin || orgRole(org, viewer.email) !== null);
}

function isAdmin(org: Json | undefined, viewer: Viewer) {
  return !!org && (viewer.isPlatformAdmin || orgRole(org, viewer.email) === "admin");
}

function isLive(event: Json) {
  return event.status === "published" && event.active !== false;
}

// Both lists, as this person may see them.
export async function readEventsAndMain(db: Db, viewer: Viewer | null): Promise<{ events: Json[]; mainEvents: Json[] }> {
  const [rows, orgs, member] = await Promise.all([
    db.select().from(records).where(inArray(records.collection, ["events", "mainEvents"])).orderBy(records.createdAt),
    organizationsById(db),
    activeMemberOf(db, viewer),
  ]);
  const events = rows.filter((r) => r.collection === "events").map((r) => r.data);
  const mains = rows.filter((r) => r.collection === "mainEvents").map((r) => r.data);

  const canSee = (e: Json) => {
    const orgId = String(e.organizationId ?? "");
    const org = orgs.get(orgId);
    if (isTeam(org, viewer)) return true;
    if (!isLive(e)) return false;
    if (member.has(orgId)) return true;
    return e.visibility !== "private" && org?.verificationStatus === "verified";
  };
  const visible = events.filter(canSee);
  const mainIds = new Set(visible.map((e) => String(e.mainEventId ?? "")));
  const visibleMains = mains.filter((m) => isTeam(orgs.get(String(m.organizationId ?? "")), viewer) || mainIds.has(String(m.id)));
  return { events: visible, mainEvents: visibleMains };
}

export const orgOwnedOpsSchema = z.object({
  upsert: z.array(objectSchema).max(100).default([]),
  delete: z.array(z.string()).max(100).default([]),
});

// Applies a screen's changes to events or main events. Each change is
// checked on its own; what isn't allowed is left as it was.
async function writeOrgOwned(db: Db, viewer: Viewer, collection: Collection, ops: unknown): Promise<number> {
  const { upsert, delete: remove } = orgOwnedOpsSchema.parse(ops);
  const orgs = await organizationsById(db);
  let refused = 0;
  await db.transaction(async (tx) => {
    const ids = [...upsert.map((x) => String(x.id ?? "")), ...remove];
    const existing = ids.length
      ? await tx.select().from(records).where(and(eq(records.collection, collection), inArray(records.id, ids))).for("update")
      : [];
    const byId = new Map(existing.map((r) => [r.id, r.data]));

    for (const raw of upsert) {
      const id = idSchema.safeParse(raw.id);
      const prev = id.success ? (byId.get(id.data) ?? null) : null;
      const orgId = String(raw.organizationId ?? "");
      // You must be on the team of the organization it belongs to, and of
      // the one it belonged to (so events can't be moved to take them over).
      const allowed =
        id.success &&
        !tooBig(raw, MAX_BYTES) &&
        isTeam(orgs.get(orgId), viewer) &&
        (!prev || isTeam(orgs.get(String(prev.organizationId ?? "")), viewer));
      if (!allowed) {
        refused++;
        continue;
      }
      await tx
        .insert(records)
        .values({ collection, id: id.data, orgId, data: raw, updatedBy: viewer.id })
        .onConflictDoUpdate({ target: [records.collection, records.id], set: { data: raw, orgId, updatedAt: new Date(), updatedBy: viewer.id } });
      byId.set(id.data, raw);
    }

    for (const id of remove) {
      const prev = byId.get(id);
      if (!prev) continue;
      if (!isAdmin(orgs.get(String(prev.organizationId ?? "")), viewer)) {
        refused++;
        continue;
      }
      await tx.delete(records).where(and(eq(records.collection, collection), eq(records.id, id)));
      byId.delete(id);
    }
  });
  return refused;
}

export async function writeEvents(db: Db, viewer: Viewer, ops: unknown) {
  const refused = await writeOrgOwned(db, viewer, "events", ops);
  return { refused, value: (await readEventsAndMain(db, viewer)).events };
}

export async function writeMainEvents(db: Db, viewer: Viewer, ops: unknown) {
  const refused = await writeOrgOwned(db, viewer, "mainEvents", ops);
  return { refused, value: (await readEventsAndMain(db, viewer)).mainEvents };
}
