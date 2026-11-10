// Sign-ups: one volunteer on one shift ("sevak.signups.v1" in the screens;
// app/signups-store.js). Hours a volunteer logs live on their sign-up and
// wait for the event's team to approve them.
//
// Who sees what:
//   - your own sign-ups, in full
//   - the event's team (and Sevak staff): its sign-ups in full (the roster)
//   - a task's lead (EVT-21): its roster (name, email, phone, shift, status)
//     for the shifts of that task, not hours or anything else
//   - everyone else: only that a spot is taken (id, event, shift, status),
//     so pages can show "3 of 5 spots left" without names (§5)
//
// Who changes what:
//   - you sign up yourself for a published, active event of an organization
//     you volunteer with (or are on the team of); the shift must have room,
//     and you can hold one confirmed spot per shift
//   - you cancel, check in and out, and log hours (always "pending")
//   - the event's team changes anything on its events' sign-ups (hours
//     decisions, adding people) but still can't overbook
//   - nobody decides on their own hours: an Admin's hours need a different
//     Admin (or Sevak staff), anyone else's the event's team (ATT-3)
//
// Capacity is checked inside a transaction that first locks the event's
// record, so two people can't take the last spot at the same time (SGN-5).
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { type Db, records } from "@sevak/db";
import type { Viewer } from "./auth";
import { readEventsAndMain } from "./events";
import { type Mail, shiftLabel, signedUp } from "./notify";
import { emailIs, idSchema, inOrgs, type Json, lower, objectSchema, organizationsById, orgRole, type ReadContext, readContext, runsEvent, taskLeadOf, tooBig } from "./records";

const COLLECTION = "signups";
const MAX_BYTES = 50_000;
const now = () => new Date().toISOString();

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const isTaken = (s: Json) => s.status !== "cancelled";

// Your own sign-ups; the full roster of events you run; and, for events you
// can see, which spots are taken (no names).
export async function readSignups(db: Db, viewer: Viewer | null, ctx?: ReadContext, visible?: { events: Json[] }): Promise<Json[]> {
  ctx ??= await readContext(db, viewer);
  visible ??= await readEventsAndMain(db, viewer, ctx);
  const { orgs } = ctx;
  // Everyone who runs an event sees it (and all its organization's events).
  const eventsById = new Map(visible.events.map((e) => [String(e.id), e]));
  const eventOrgs = visible.events.map((e) => String(e.organizationId ?? ""));
  const rows = await db
    .select()
    .from(records)
    .where(and(eq(records.collection, COLLECTION), viewer ? or(emailIs(viewer.email), inOrgs(eventOrgs)) : inOrgs(eventOrgs)))
    .orderBy(records.createdAt);
  const visibleEvents = new Set(visible.events.map((e) => String(e.id)));
  const out: Json[] = [];
  for (const { data: s } of rows) {
    const eventId = String(s.eventId ?? "");
    const event = eventsById.get(eventId);
    if ((viewer && lower(s.email) === viewer.email) || runsEvent(orgs.get(String(event?.organizationId ?? "")), event, viewer)) {
      out.push(s);
    } else if (viewer && event && isTaken(s) && taskLeadOf(event, s.shiftId) === viewer.email) {
      // The event as this person sees it keeps a task's lead only for the
      // lead, while they belong to the organization (events.ts).
      out.push({ id: s.id, eventId, shiftId: s.shiftId, status: s.status, name: s.name, email: s.email, phone: s.phone, roster: true });
    } else if (visibleEvents.has(eventId) && isTaken(s)) {
      out.push({ id: s.id, eventId, shiftId: s.shiftId, status: s.status, anonymous: true });
    }
  }
  return out;
}

// A decision on logged hours (approved, possibly adjusted, or not approved),
// as a comparable key; null while they're waiting.
function hoursDecision(hours: unknown): string | null {
  const h = hours as Json | undefined;
  if (!h || (h.status !== "approved" && h.status !== "rejected")) return null;
  return JSON.stringify([h.status, h.minutes ?? null, h.approvedMinutes ?? null, h.reason ?? null, h.from ?? null, h.to ?? null]);
}

// Whether `viewer` (who runs the event) may decide on the hours of the
// volunteer with this email: never their own, and an Admin's only if the
// viewer is also an Admin (or Sevak staff).
export function mayDecideHours(org: Json, viewer: Viewer, volunteerEmail: string): boolean {
  const who = lower(volunteerEmail);
  if (who && who === viewer.email) return false;
  if (viewer.isPlatformAdmin) return true;
  if (who && orgRole(org, who) === "admin") return orgRole(org, viewer.email) === "admin";
  return true;
}

function shiftOf(event: Json, shiftId: unknown): Json | null {
  for (const role of (event.roles as Json[] | undefined) ?? []) {
    for (const shift of (role?.shifts as Json[] | undefined) ?? []) {
      if (shift && shift.id === shiftId) return shift;
    }
  }
  return null;
}

async function activeMember(tx: Tx, orgId: string, email: string) {
  const rows = await tx.select().from(records).where(and(eq(records.collection, "memberships"), eq(records.orgId, orgId)));
  return rows.some((r) => lower(r.data.email) === email && r.data.status === "active");
}

export const signupOpsSchema = z.object({
  upsert: z.array(objectSchema).max(50).default([]),
  delete: z.array(z.string()).max(200).default([]),
});

const SELF_FIELDS = ["status", "name", "phone", "checkInAt", "checkOutAt", "hours", "updatedAt", "cancelledAt"] as const;

export async function writeSignups(db: Db, viewer: Viewer, ops: unknown): Promise<{ refused: number; reason?: string; value: Json[]; emails: Mail[] }> {
  const { upsert, delete: remove } = signupOpsSchema.parse(ops);
  const orgs = await organizationsById(db);
  let refused = 0;
  // New confirmed spots, by event and person, for one confirmation email each.
  const confirmed = new Map<string, { event: Json; email: string; labels: string[] }>();
  let reason: string | undefined;
  const refuse = (why: string) => {
    refused++;
    reason ??= why;
  };

  await db.transaction(async (tx) => {
    const ids = [...upsert.map((s) => String(s.id ?? "")), ...remove];
    const existing = ids.length
      ? await tx.select().from(records).where(and(eq(records.collection, COLLECTION), inArray(records.id, ids))).for("update")
      : [];
    const byId = new Map(existing.map((r) => [r.id, r.data]));

    // Lock each event involved, so capacity checks can't race.
    const eventIds = [...new Set([...upsert.map((s) => String(s.eventId ?? "")), ...existing.map((r) => String(r.data.eventId ?? ""))])];
    const eventRows = eventIds.length
      ? await tx.select().from(records).where(and(eq(records.collection, "events"), inArray(records.id, eventIds))).for("update")
      : [];
    const events = new Map(eventRows.map((r) => [r.id, r.data]));

    const takenOnShift = async (eventId: string, shiftId: string, exceptId: string) => {
      const rows = await tx
        .select()
        .from(records)
        .where(and(eq(records.collection, COLLECTION), sql`${records.data}->>'eventId' = ${eventId}`, sql`${records.data}->>'shiftId' = ${shiftId}`));
      return rows.filter((r) => r.id !== exceptId && isTaken(r.data)).map((r) => r.data);
    };

    for (const raw of upsert) {
      const id = idSchema.safeParse(raw.id);
      const prev = id.success ? (byId.get(id.data) ?? null) : null;
      const eventId = String(prev?.eventId ?? raw.eventId ?? "");
      const event = events.get(eventId);
      const org = orgs.get(String(event?.organizationId ?? ""));
      if (!id.success || !event || !org || tooBig(raw, MAX_BYTES) || raw.anonymous === true || (prev && (raw.eventId !== prev.eventId || raw.shiftId !== prev.shiftId))) {
        refuse("invalid");
        continue;
      }
      // Those who run the event (its Admins, or the Coordinator who is its
      // event admin) manage its sign-ups.
      const team = runsEvent(org, event, viewer);
      // A sign-up is yours if it has your email; one with none is nobody's.
      const self = prev ? !!lower(prev.email) && lower(prev.email) === viewer.email : lower(raw.email) === viewer.email || !team;
      let next: Json;

      if (team) {
        // Hours for one sign-up are at most a day.
        const h = raw.hours as Json | undefined;
        if (h && [h.minutes, h.approvedMinutes].some((m) => m !== undefined && m !== null && !(typeof m === "number" && m >= 0 && m <= 24 * 60))) {
          refuse("invalid");
          continue;
        }
        // Approving, adjusting or not approving hours (or moving a decided
        // sign-up to someone else) must be allowed for whoever it's for.
        const decision = hoursDecision(raw.hours);
        const changed = decision !== hoursDecision(prev?.hours) || lower(raw.email) !== lower(prev?.email);
        const people = [...new Set([prev?.email, raw.email].map(lower).filter(Boolean))];
        if (decision !== null && changed && !people.every((who) => mayDecideHours(org, viewer, who))) {
          refuse("own_hours");
          continue;
        }
        next = { ...raw };
      } else if (self) {
        if (!prev) {
          const live = event.status === "published" && event.active !== false;
          if (!live || !(await activeMember(tx, String(org.id), viewer.email))) {
            refuse("not_member");
            continue;
          }
          next = { ...raw, email: viewer.email, status: "confirmed", hours: undefined, checkInAt: undefined, checkOutAt: undefined };
        } else {
          // Only your own details, cancelling, checking in and out, and
          // logging hours, which always wait for approval.
          next = { ...prev };
          for (const f of SELF_FIELDS) next[f] = raw[f];
          if (raw.status !== prev.status && raw.status !== "cancelled") {
            refuse("invalid");
            continue;
          }
          const hours = raw.hours as Json | undefined;
          const sameHours = JSON.stringify(hours ?? null) === JSON.stringify(prev.hours ?? null);
          if (!sameHours) {
            if (hours && typeof hours.minutes === "number" && hours.minutes > 0 && hours.minutes <= 24 * 60) {
              next.hours = { minutes: hours.minutes, from: hours.from, to: hours.to, method: hours.method, loggedAt: hours.loggedAt ?? now(), status: "pending" };
            } else {
              next.hours = prev.hours;
            }
          }
        }
      } else {
        refuse("not_yours");
        continue;
      }

      // Room on the shift, and one confirmed spot per person.
      if (isTaken(next) && (!prev || !isTaken(prev))) {
        const shift = shiftOf(event, next.shiftId);
        if (!shift) {
          refuse("invalid");
          continue;
        }
        const taken = await takenOnShift(eventId, String(next.shiftId), id.data);
        if (taken.length >= Number(shift.capacity ?? 0)) {
          refuse("full");
          continue;
        }
        if (next.email && taken.some((s) => lower(s.email) === lower(next.email))) {
          refuse("already");
          continue;
        }
      }

      await tx
        .insert(records)
        .values({ collection: COLLECTION, id: id.data, orgId: String(org.id), data: next, updatedBy: viewer.id })
        .onConflictDoUpdate({ target: [records.collection, records.id], set: { data: next, updatedAt: new Date(), updatedBy: viewer.id } });
      byId.set(id.data, next);

      if (!prev && isTaken(next) && typeof next.email === "string" && next.email.includes("@") && !next.sample) {
        const k = `${eventId}|${lower(next.email)}`;
        const entry = confirmed.get(k) ?? { event, email: lower(next.email), labels: [] };
        entry.labels.push(shiftLabel(event, next.shiftId));
        confirmed.set(k, entry);
      }
    }

    for (const id of remove) {
      const prev = byId.get(id);
      if (!prev) continue;
      const event = events.get(String(prev.eventId ?? ""));
      if (!runsEvent(orgs.get(String(event?.organizationId ?? "")), event, viewer)) {
        refuse("not_yours");
        continue;
      }
      await tx.delete(records).where(and(eq(records.collection, COLLECTION), eq(records.id, id)));
      byId.delete(id);
    }
  });

  const emails = [...confirmed.values()].map((c) => signedUp(c.event, c.email, c.labels));
  return { refused, reason, value: await readSignups(db, viewer), emails };
}
