// Certificates of volunteer service ("sevak.certificates.v1";
// app/certificates.js) and the signatures that go on them
// ("sevak.signatures.v1").
//
// A volunteer asks an organization for a certificate covering a period; one
// of its Admins issues it (or declines). Issuing is checked here:
//   - only the organization's Admins issue or decline
//   - the certificate's hours must equal the approved hours on record for
//     that volunteer, organization and period, so a certificate can't claim
//     more than the organization approved
//   - its number (SVK-XXXX-XXXX) is unique, and an issued certificate can't
//     be changed
// Anyone can check a certificate by its number (verifyCertificate), which
// shows only what proves it (ATT-6).
//
// Who sees what: your own requests and certificates; the organization's
// team sees its organization's.
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { type Db, records } from "@sevak/db";
import type { Viewer } from "./auth";
import { certificateDeclined, certificateIssued, certificateRequested, type Mail } from "./notify";
import { idSchema, type Json, lower, objectSchema, organizationsById, orgRole, RecordError, tooBig } from "./records";

const COLLECTION = "certificates";
const MAX_BYTES = 400_000; // the snapshot, with the signer's drawn signature
const CODE = /^SVK-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const now = () => new Date().toISOString();

const isTeam = (org: Json | undefined, v: Viewer) => !!org && (v.isPlatformAdmin || orgRole(org, v.email) !== null);
const isAdmin = (org: Json | undefined, v: Viewer) => !!org && (v.isPlatformAdmin || orgRole(org, v.email) === "admin");

export async function readCertificates(db: Db, viewer: Viewer): Promise<Json[]> {
  const [rows, orgs] = await Promise.all([
    db.select().from(records).where(eq(records.collection, COLLECTION)).orderBy(records.createdAt),
    organizationsById(db),
  ]);
  return rows.filter((r) => lower(r.data.email) === viewer.email || isTeam(orgs.get(String(r.data.orgId)), viewer)).map((r) => r.data);
}

function shiftDate(event: Json, shiftId: unknown): string | null {
  for (const role of (event.roles as Json[] | undefined) ?? []) {
    for (const s of (role?.shifts as Json[] | undefined) ?? []) if (s && s.id === shiftId) return String(s.date ?? "");
  }
  return null;
}

// Approved hours on record for a volunteer with an organization, between
// two dates (inclusive), the way app/signups-store.js credits them: the
// minutes, how many shifts, and the events they were at.
export async function approvedRecord(db: Db, email: string, orgId: string, from: string, to: string): Promise<{ minutes: number; shifts: number; events: Json[] }> {
  const events = await db.select().from(records).where(and(eq(records.collection, "events"), eq(records.orgId, orgId)));
  const byId = new Map(events.map((e) => [e.id, e.data]));
  const signups = await db.select().from(records).where(and(eq(records.collection, "signups"), eq(records.orgId, orgId)));
  let minutes = 0;
  let shifts = 0;
  const seen = new Map<string, Json>();
  for (const { data: s } of signups) {
    const h = s.hours as Json | undefined;
    if (lower(s.email) !== lower(email) || s.status === "cancelled" || !h || h.status !== "approved") continue;
    const event = byId.get(String(s.eventId));
    const date = event && shiftDate(event, s.shiftId);
    if (!event || !date || date < from || date > to) continue;
    const m = Number(h.approvedMinutes ?? h.minutes ?? 0);
    minutes += m;
    shifts++;
    const e = seen.get(String(s.eventId)) ?? { id: String(s.eventId), title: String(event.title ?? "").slice(0, 200), minutes: 0, shifts: 0 };
    e.minutes = Number(e.minutes) + m;
    e.shifts = Number(e.shifts) + 1;
    seen.set(String(s.eventId), e);
  }
  return { minutes, shifts, events: [...seen.values()] };
}

export async function approvedMinutes(db: Db, email: string, orgId: string, from: string, to: string): Promise<number> {
  return (await approvedRecord(db, email, orgId, from, to)).minutes;
}

export const MAX_OPEN_REQUESTS = 3; // open certificate requests per person and organization

export const certificateOpsSchema = z.object({
  upsert: z.array(objectSchema).max(50).default([]),
  delete: z.array(z.string()).max(50).default([]),
});

export async function writeCertificates(db: Db, viewer: Viewer, ops: unknown): Promise<{ refused: number; reason?: string; value: Json[]; emails: Mail[] }> {
  const { upsert, delete: remove } = certificateOpsSchema.parse(ops);
  const orgs = await organizationsById(db);
  let refused = 0;
  const emails: Mail[] = [];
  let reason: string | undefined;
  const refuse = (why: string) => {
    refused++;
    reason ??= why;
  };

  await db.transaction(async (tx) => {
    const ids = [...upsert.map((c) => String(c.id ?? "")), ...remove];
    const existing = ids.length
      ? await tx.select().from(records).where(and(eq(records.collection, COLLECTION), inArray(records.id, ids))).for("update")
      : [];
    const byId = new Map(existing.map((r) => [r.id, r.data]));
    let openAsks: string[] | undefined; // organizations you have open requests with

    for (const raw of upsert) {
      const id = idSchema.safeParse(raw.id);
      const prev = id.success ? (byId.get(id.data) ?? null) : null;
      const orgId = String(prev?.orgId ?? raw.orgId ?? "");
      const org = orgs.get(orgId);
      if (!id.success || !org || tooBig(raw, MAX_BYTES) || (prev && raw.orgId !== prev.orgId)) {
        refuse("invalid");
        continue;
      }
      let next: Json | null = null;

      if (!prev) {
        // A volunteer asks for their own certificate.
        if (raw.status === "requested" && DAY.test(String(raw.from)) && DAY.test(String(raw.to)) && String(raw.from) <= String(raw.to)) {
          // A few open requests per organization at a time.
          openAsks ??= (await tx.select({ data: records.data }).from(records).where(eq(records.collection, COLLECTION))).filter(
            (r) => lower(r.data.email) === viewer.email && r.data.status === "requested",
          ).map((r) => String(r.data.orgId));
          if (openAsks.filter((o) => o === orgId).length >= MAX_OPEN_REQUESTS) {
            refuse("already_asked");
            continue;
          }
          openAsks.push(orgId);
          next = {
            id: id.data,
            orgId,
            email: viewer.email,
            name: typeof raw.name === "string" ? raw.name.slice(0, 120) : viewer.email,
            from: raw.from,
            to: raw.to,
            note: typeof raw.note === "string" ? raw.note.slice(0, 300) : "",
            status: "requested",
            requestedAt: now(),
          };
        }
      } else if (prev.status === "requested" && isAdmin(org, viewer)) {
        if (raw.status === "declined") {
          next = { ...prev, status: "declined", decidedAt: now(), decidedBy: viewer.email, reason: typeof raw.reason === "string" ? raw.reason.slice(0, 300) : "" };
        } else if (raw.status === "issued") {
          const data = raw.data as Json | undefined;
          const code = String(raw.code ?? "");
          if (!data || !CODE.test(code) || data.code !== code) {
            refuse("invalid");
            continue;
          }
          const all = await tx.select().from(records).where(eq(records.collection, COLLECTION));
          if (all.some((r) => r.id !== id.data && r.data.code === code)) {
            refuse("invalid");
            continue;
          }
          // The certificate says what the organization approved, no more,
          // and who issued it comes from Sevak's records, not the page.
          const onRecord = await approvedRecord(tx as unknown as Db, String(prev.email), orgId, String(prev.from), String(prev.to));
          if (Number(data.minutes) !== onRecord.minutes || onRecord.minutes <= 0) {
            refuse("hours_mismatch");
            continue;
          }
          const place = (data.org as Json | undefined)?.place;
          const facts: Json = {
            org: { name: String(org.name ?? ""), ...(typeof place === "string" ? { place: place.slice(0, 200) } : {}), verified: org.verificationStatus === "verified" },
            volunteer: String(prev.name || prev.email),
            minutes: onRecord.minutes,
            shifts: onRecord.shifts,
            events: onRecord.events,
          };
          next = {
            ...prev,
            status: "issued",
            code,
            issuedAt: now(),
            decidedAt: now(),
            decidedBy: viewer.email,
            signer: raw.signer,
            data: { ...data, ...facts, from: prev.from, to: prev.to, issuedAt: now() },
            docIds: Array.isArray(raw.docIds) ? raw.docIds.slice(0, 50) : [],
          };
        }
      } else if (prev.status === "issued" && isAdmin(org, viewer) && JSON.stringify({ ...raw, docIds: undefined }) === JSON.stringify({ ...prev, docIds: undefined })) {
        // Only where its PDF was saved can change after issuing.
        next = { ...prev, docIds: Array.isArray(raw.docIds) ? raw.docIds.slice(0, 50) : prev.docIds };
      } else if (JSON.stringify(raw) === JSON.stringify(prev)) {
        continue; // unchanged
      }

      if (!next) {
        refuse("not_yours");
        continue;
      }
      await tx
        .insert(records)
        .values({ collection: COLLECTION, id: id.data, orgId, data: next, updatedBy: viewer.id })
        .onConflictDoUpdate({ target: [records.collection, records.id], set: { data: next, updatedAt: new Date(), updatedBy: viewer.id } });
      byId.set(id.data, next);

      if (next.status !== prev?.status) {
        if (next.status === "requested") emails.push(...certificateRequested(org, String(next.name || next.email)));
        else if (next.status === "issued") emails.push(certificateIssued(org, String(next.email), id.data));
        else if (next.status === "declined") emails.push(certificateDeclined(org, String(next.email), String(next.reason ?? "")));
      }
    }

    for (const id of remove) {
      const prev = byId.get(id);
      if (!prev) continue;
      // You can withdraw your own request while it's waiting.
      if (!(prev.status === "requested" && lower(prev.email) === viewer.email)) {
        refuse("not_yours");
        continue;
      }
      await tx.delete(records).where(and(eq(records.collection, COLLECTION), eq(records.id, id)));
      byId.delete(id);
    }
  });

  return { refused, reason, value: await readCertificates(db, viewer), emails };
}

// What anyone may see of an issued certificate, by its number: only what
// proves it.
export async function verifyCertificate(db: Db, code: unknown): Promise<Json | null> {
  const want = String(code ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!CODE.test(want)) return null;
  const rows = await db.select().from(records).where(eq(records.collection, COLLECTION));
  const rec = rows.map((r) => r.data).find((c) => c.status === "issued" && c.code === want);
  if (!rec) return null;
  const d = (rec.data ?? {}) as Json;
  const issuedBy = (d.org ?? {}) as Json;
  // Whether Sevak has verified the organization: as it is now, or as it was
  // when the certificate was issued if the organization is gone.
  const [org] = await db.select().from(records).where(and(eq(records.collection, "organizations"), eq(records.id, String(rec.orgId))));
  const verified = org ? org.data.verificationStatus === "verified" : issuedBy.verified === true;
  return {
    code: rec.code,
    issuedAt: rec.issuedAt,
    status: "issued",
    data: {
      volunteer: d.volunteer,
      org: { name: issuedBy.name, verified },
      from: d.from,
      to: d.to,
      minutes: d.minutes,
      shifts: d.shifts,
      events: ((d.events as Json[] | undefined) ?? []).map((e) => ({ title: e.title })),
    },
  };
}

// ---------- Signatures ----------
// Each person's own: the signature they drew and the title they sign with.

export async function readSignatures(db: Db, viewer: Viewer): Promise<Json> {
  const [row] = await db.select().from(records).where(and(eq(records.collection, "signatures"), eq(records.id, viewer.id)));
  return row ? { [viewer.email]: row.data } : {};
}

export async function writeSignatures(db: Db, viewer: Viewer, value: unknown): Promise<Json> {
  const all = objectSchema.nullable().parse(value) ?? {};
  const mine = all[viewer.email];
  if (mine === undefined || mine === null) {
    await db.delete(records).where(and(eq(records.collection, "signatures"), eq(records.id, viewer.id)));
  } else {
    const sig = objectSchema.parse(mine);
    if (tooBig(sig, 300_000)) throw new RecordError("too_large");
    const data = { image: typeof sig.image === "string" ? sig.image : "", title: typeof sig.title === "string" ? sig.title.slice(0, 120) : "", updatedAt: now() };
    await db
      .insert(records)
      .values({ collection: "signatures", id: viewer.id, data, updatedBy: viewer.id })
      .onConflictDoUpdate({ target: [records.collection, records.id], set: { data, updatedAt: new Date(), updatedBy: viewer.id } });
  }
  return readSignatures(db, viewer);
}
