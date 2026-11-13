import {
  CERTIFICATES_KEY,
  recordChanges,
  snapshot,
  DAY,
  HOUR,
  hit,
  DOCUMENTS_KEY,
  EVENTS_KEY,
  MAIN_EVENTS_KEY,
  MEMBERSHIPS_KEY,
  ORGANIZATIONS_KEY,
  PROFILE_KEY,
  RecordError,
  SIGNATURES_KEY,
  SIGNUPS_KEY,
  writeCertificates,
  writeDocuments,
  writeEvents,
  writeMainEvents,
  writeMemberships,
  writeOrganizations,
  writeProfile,
  writeSignatures,
  writeSignups,
} from "@sevak/core";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { fileStore } from "@/lib/files";
import { fromOurPages, json, publicUrl, readJson, refuse, viewerFor } from "@/lib/http";
import { sendMails } from "@/lib/mail";

export const dynamic = "force-dynamic";

// The kinds of record whose changes go in the audit log, by key.
const AUDITED: Record<string, string> = {
  [ORGANIZATIONS_KEY]: "organizations",
  [MEMBERSHIPS_KEY]: "memberships",
  [EVENTS_KEY]: "events",
  [MAIN_EVENTS_KEY]: "mainEvents",
  [SIGNUPS_KEY]: "signups",
  [CERTIFICATES_KEY]: "certificates",
  [DOCUMENTS_KEY]: "documents",
};

// The ids a list change names ({upsert: [{id}], delete: [id]}).
function idsIn(body: unknown): string[] {
  const b = (body ?? {}) as { upsert?: unknown; delete?: unknown };
  const up = Array.isArray(b.upsert) ? b.upsert.map((x) => (x && typeof x === "object" ? (x as { id?: unknown }).id : undefined)) : [];
  const del = Array.isArray(b.delete) ? b.delete : [];
  return [...up, ...del].filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200).slice(0, 500);
}

// POST /api/v1/sync/{key}: saves a page's change to one kind of data.
//   sevak.profile.v1        {value: profile or null}
//   sevak.organizations.v1  {upsert: [organization], delete: [id]}
//   sevak.memberships.v1    {upsert: [membership], delete: [id]}
//   sevak.events.v1         {upsert: [event], delete: [id]}
//   sevak.mainEvents.v1     {upsert: [main event], delete: [id]}
//   sevak.signups.v1        {upsert: [sign-up], delete: [id]}
//   sevak.certificates.v1   {upsert: [certificate], delete: [id]}
//   sevak.signatures.v1     {value: {"<your email>": signature}}
//   sevak.documents.v1      {upsert: [document], delete: [id]} (files go
//                           to /api/v1/files/{id})
// Answers with the data as you may now see it, and how many changes were
// refused (403 if any), so the page can show what was actually saved.
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  if (!fromOurPages(req)) return refuse.crossSite();
  const viewer = await viewerFor(req);
  if (!viewer) return refuse.signedOut();
  const { key } = await ctx.params;
  const body = await readJson(req, 4_000_000);
  if (body === undefined) return refuse.tooLarge();
  const db = await getDb();
  // How much one person can save, so nobody can fill the database.
  const size = JSON.stringify(body).length;
  if (!viewer.isPlatformAdmin && !((await hit(db, `user:writes:${viewer.id}`, 600, HOUR)) && (await hit(db, `user:bytes:${viewer.id}`, 50_000_000, DAY, size)))) {
    return json({ error: "rate_limited" }, 429);
  }
  // Who changed what (packages/core/src/audit.ts): the records this asks to
  // change, before and after.
  const audited = AUDITED[key];
  const ids = audited ? idsIn(body) : [];
  const before = audited ? await snapshot(db, audited, ids) : new Map();
  const logged = async () => {
    if (audited) await recordChanges(db, viewer, audited, before, ids).catch((e) => console.error("Couldn't write the audit log", e));
  };
  try {
    if (key === PROFILE_KEY) {
      const { value } = z.object({ value: z.union([z.record(z.string(), z.unknown()), z.null()]) }).parse(body);
      return json({ refused: 0, value: await writeProfile(db, viewer, value) });
    }
    if (key === DOCUMENTS_KEY) {
      const { refused, value, deletedFiles } = await writeDocuments(db, viewer, body);
      await logged();
      const store = fileStore();
      if (store) await Promise.all(deletedFiles.map((id) => store.remove(id).catch((e) => console.error("Couldn't delete file", id, e))));
      return json({ refused, value }, refused ? 403 : 200);
    }
    if (key === SIGNATURES_KEY) {
      const { value } = z.object({ value: z.record(z.string(), z.unknown()).nullable() }).parse(body);
      return json({ refused: 0, value: await writeSignatures(db, viewer, value) });
    }
    if (key === ORGANIZATIONS_KEY) {
      const { emails, ...result } = await writeOrganizations(db, viewer, body);
      await logged();
      await sendMails(publicUrl(req), viewer, emails);
      return json(result, result.refused ? 403 : 200);
    }
    const writers = {
      [MEMBERSHIPS_KEY]: writeMemberships,
      [EVENTS_KEY]: writeEvents,
      [MAIN_EVENTS_KEY]: writeMainEvents,
      [SIGNUPS_KEY]: writeSignups,
      [CERTIFICATES_KEY]: writeCertificates,
    } as const;
    const writer = writers[key as keyof typeof writers];
    if (writer) {
      const { emails, ...result } = { emails: [], ...(await writer(db, viewer, body)) };
      await logged();
      await sendMails(publicUrl(req), viewer, emails);
      return json(result, result.refused ? 403 : 200);
    }
    return json({ error: "not_found" }, 404);
  } catch (e) {
    if (e instanceof RecordError && e.code === "too_large") return refuse.tooLarge();
    if (e instanceof z.ZodError || e instanceof RecordError) return refuse.invalid();
    throw e;
  }
}
