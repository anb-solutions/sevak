// Documents: the details of each uploaded file ("sevak.documents.v1";
// app/documents.js). The file itself is stored separately (apps/web
// src/lib/files.ts: a private Cloud Storage bucket) and only served to people
// who may see its document.
//
// A document belongs to an owner:
//   "profile:<email>"  a person's own documents: only they see and change
//                      them; an organization's Admins can add the PDF of a
//                      certificate that person asked them for (source
//                      "certificate"), once
//   "org:<id>"         an organization's: its team
//   "event:<id>"       an event's: its organization's team
//
// Limits (checked when the file is uploaded): 10 MB a file; 100 MB of files
// per person; 500 MB per organization (its own and its events' documents),
// 50 MB until Sevak verifies it.
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { type Db, records } from "@sevak/db";
import type { Viewer } from "./auth";
import { idSchema, type Json, lower, objectSchema, organizationsById, orgRole, tooBig } from "./records";

const COLLECTION = "documents";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const PERSON_QUOTA_BYTES = 100 * 1024 * 1024;
export const ORG_QUOTA_BYTES = 500 * 1024 * 1024;
export const UNVERIFIED_ORG_QUOTA_BYTES = 50 * 1024 * 1024;

// Fields only the server sets, from the file actually stored.
const STORED_FIELDS = ["storedBytes", "storedType", "storedAt"] as const;

interface Context {
  orgs: Map<string, Json>;
  eventOrg: Map<string, string>; // event id → organization id
  asked: Set<string>; // "<email> <organization id>" for certificates asked for or issued
}

async function context(db: Db): Promise<Context> {
  const [orgs, events, certs] = await Promise.all([
    organizationsById(db),
    db.select().from(records).where(eq(records.collection, "events")),
    db.select().from(records).where(eq(records.collection, "certificates")),
  ]);
  return {
    orgs,
    eventOrg: new Map(events.map((e) => [e.id, String(e.data.organizationId ?? "")])),
    asked: new Set(certs.filter((c) => c.data.status === "requested" || c.data.status === "issued").map((c) => `${lower(c.data.email)} ${String(c.data.orgId)}`)),
  };
}

// "profile:<email>" with the email lowercased and trimmed, so each person
// has one set of documents (and one quota).
export function normalOwner(owner: unknown): string {
  const s = String(owner ?? "");
  return s.startsWith("profile:") ? `profile:${lower(s.slice(8))}` : s;
}

// The organization a document belongs to (for org and event documents).
function orgOf(owner: string, ctx: Context): string | null {
  if (owner.startsWith("org:")) return owner.slice(4);
  if (owner.startsWith("event:")) return ctx.eventOrg.get(owner.slice(6)) ?? null;
  return null;
}

export function canSeeDocument(doc: Json, viewer: Viewer, ctx: Context): boolean {
  const owner = String(doc.owner ?? "");
  if (owner.startsWith("profile:")) return lower(owner.slice(8)) === viewer.email;
  const orgId = orgOf(owner, ctx);
  const org = orgId ? ctx.orgs.get(orgId) : undefined;
  return !!org && (viewer.isPlatformAdmin || orgRole(org, viewer.email) !== null);
}

// Adding a certificate's PDF to the person who asked the organization for it.
function isIssuedCertificate(doc: Json, viewer: Viewer, ctx: Context): boolean {
  const orgId = String(doc.orgId ?? "");
  const org = ctx.orgs.get(orgId);
  const owner = normalOwner(doc.owner);
  return (
    doc.source === "certificate" &&
    owner.startsWith("profile:") &&
    String(doc.name ?? "").startsWith("Certificate") &&
    !!org &&
    (viewer.isPlatformAdmin || orgRole(org, viewer.email) === "admin") &&
    ctx.asked.has(`${owner.slice(8)} ${orgId}`)
  );
}

export async function readDocuments(db: Db, viewer: Viewer): Promise<Json[]> {
  const [rows, ctx] = await Promise.all([db.select().from(records).where(eq(records.collection, COLLECTION)).orderBy(records.createdAt), context(db)]);
  return rows.filter((r) => canSeeDocument(r.data, viewer, ctx)).map((r) => r.data);
}

// One document's details, if this person may see (and so download) it.
export async function documentFor(db: Db, viewer: Viewer, id: string): Promise<Json | null> {
  const [row] = await db.select().from(records).where(and(eq(records.collection, COLLECTION), eq(records.id, id)));
  if (!row) return null;
  return canSeeDocument(row.data, viewer, await context(db)) ? row.data : null;
}

export const documentOpsSchema = z.object({
  upsert: z.array(objectSchema).max(50).default([]),
  delete: z.array(z.string()).max(200).default([]),
});

// Applies a screen's changes to document details. Returns the ids whose
// files should be deleted from storage.
export async function writeDocuments(db: Db, viewer: Viewer, ops: unknown): Promise<{ refused: number; value: Json[]; deletedFiles: string[] }> {
  const { upsert, delete: remove } = documentOpsSchema.parse(ops);
  const ctx = await context(db);
  let refused = 0;
  const deletedFiles: string[] = [];

  await db.transaction(async (tx) => {
    const ids = [...upsert.map((d) => String(d.id ?? "")), ...remove];
    const existing = ids.length
      ? await tx.select().from(records).where(and(eq(records.collection, COLLECTION), inArray(records.id, ids))).for("update")
      : [];
    const byId = new Map(existing.map((r) => [r.id, r.data]));

    for (const raw of upsert) {
      const id = idSchema.safeParse(raw.id);
      const prev = id.success ? (byId.get(id.data) ?? null) : null;
      const owner = normalOwner(raw.owner);
      raw.owner = owner;
      const allowed =
        id.success &&
        !tooBig(raw, 20_000) &&
        /^(profile|org|event):/.test(owner) &&
        (canSeeDocument(raw, viewer, ctx) || (!prev && isIssuedCertificate(raw, viewer, ctx))) &&
        (!prev || canSeeDocument(prev, viewer, ctx));
      if (!allowed) {
        refused++;
        continue;
      }
      const next: Json = { ...raw };
      for (const f of STORED_FIELDS) {
        if (prev && prev[f] !== undefined) next[f] = prev[f];
        else delete next[f];
      }
      const orgId = orgOf(owner, ctx);
      await tx
        .insert(records)
        .values({ collection: COLLECTION, id: id.data, orgId, data: next, updatedBy: viewer.id })
        .onConflictDoUpdate({ target: [records.collection, records.id], set: { data: next, orgId, updatedAt: new Date(), updatedBy: viewer.id } });
      byId.set(id.data, next);
    }

    for (const id of remove) {
      const prev = byId.get(id);
      if (!prev) continue;
      if (!canSeeDocument(prev, viewer, ctx)) {
        refused++;
        continue;
      }
      await tx.delete(records).where(and(eq(records.collection, COLLECTION), eq(records.id, id)));
      byId.delete(id);
      deletedFiles.push(id);
    }
  });

  return { refused, value: await readDocuments(db, viewer), deletedFiles };
}

// ---------- Uploads ----------

export class UploadRefused extends Error {
  constructor(public reason: "not_found" | "too_large" | "empty" | "type" | "quota") {
    super(reason);
  }
}

// What a file really is, from its first bytes (not its name or what the
// browser says). Only these kinds are accepted.
export function sniffType(bytes: Uint8Array): string | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  const ascii = (from: number, text: string) => [...text].every((c, i) => bytes[from + i] === c.charCodeAt(0));
  if (ascii(0, "%PDF-")) return "application/pdf";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(4, "ftypheic") || ascii(4, "ftypheix") || ascii(4, "ftypmif1")) return "image/heic";
  // Word, Excel and PowerPoint (.docx, .xlsx, .pptx are zip files; older
  // .doc and .xls are OLE files).
  if (starts(0x50, 0x4b, 0x03, 0x04)) {
    // Only Office files: the zip's first entry is one of theirs.
    const nameLength = (bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8);
    const name = new TextDecoder().decode(bytes.subarray(30, 30 + Math.min(nameLength, 100)));
    return /^(\[Content_Types\]\.xml|_rels\/|docProps\/|word\/|xl\/|ppt\/)/.test(name) ? "application/vnd.openxmlformats" : null;
  }
  if (starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return "application/x-ole-storage";
  // Plain text (including .csv): valid UTF-8 with no control bytes, and not
  // a web page or script.
  const sample = bytes.subarray(0, 4096);
  if (sample.some((b) => b === 0 || (b < 9 && b !== 0) || (b > 13 && b < 32 && b !== 27))) return null;
  try {
    // stream: a character cut off at the end of the sample isn't an error.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(sample, { stream: true }).trimStart().toLowerCase();
    if (/^(<!doctype|<html|<svg|<\?xml|<script)/.test(text)) return null;
    return "text/plain";
  } catch {
    return null;
  }
}

// Checks an upload for a document and records what was stored. Throws
// UploadRefused if this person may not upload it, or it breaks a limit.
export async function acceptUpload(db: Db, viewer: Viewer, id: string, bytes: Uint8Array): Promise<{ type: string; doc: Json }> {
  const ctx = await context(db);
  const rows = await db.select().from(records).where(eq(records.collection, COLLECTION));
  const row = rows.find((r) => r.id === id);
  // An Admin adding a certificate to someone's documents can upload it once.
  const asIssuer = !!row && !canSeeDocument(row.data, viewer, ctx) && isIssuedCertificate(row.data, viewer, ctx) && row.data.storedAt === undefined;
  if (!row || !(canSeeDocument(row.data, viewer, ctx) || asIssuer)) throw new UploadRefused("not_found");
  if (bytes.length === 0) throw new UploadRefused("empty");
  if (bytes.length > MAX_FILE_BYTES) throw new UploadRefused("too_large");
  const type = sniffType(bytes);
  if (!type) throw new UploadRefused("type");

  // Room left for this person, or this organization.
  const owner = normalOwner(row.data.owner);
  const orgId = orgOf(owner, ctx);
  const sameGroup = (d: Json) => (orgId ? orgOf(normalOwner(d.owner), ctx) === orgId : normalOwner(d.owner) === owner);
  const used = rows.filter((r) => r.id !== id && sameGroup(r.data)).reduce((n, r) => n + Number(r.data.storedBytes ?? 0), 0);
  const orgQuota = orgId && ctx.orgs.get(orgId)?.verificationStatus === "verified" ? ORG_QUOTA_BYTES : UNVERIFIED_ORG_QUOTA_BYTES;
  if (used + bytes.length > (orgId ? orgQuota : PERSON_QUOTA_BYTES)) throw new UploadRefused("quota");

  const doc = { ...row.data, storedBytes: bytes.length, storedType: type, storedAt: new Date().toISOString() };
  await db.update(records).set({ data: doc, updatedAt: new Date(), updatedBy: viewer.id }).where(and(eq(records.collection, COLLECTION), eq(records.id, id)));
  return { type, doc };
}
