import { MEMBERSHIPS_KEY, ORGANIZATIONS_KEY, PROFILE_KEY, RecordError, writeMemberships, writeOrganizations, writeProfile } from "@sevak/core";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { fromOurPages, json, readJson, refuse, viewerFor } from "@/lib/http";

export const dynamic = "force-dynamic";

// POST /api/v1/sync/{key}: saves a page's change to one kind of data.
//   sevak.profile.v1        {value: profile or null}
//   sevak.organizations.v1  {upsert: [organization], delete: [id]}
//   sevak.memberships.v1    {upsert: [membership], delete: [id]}
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
  try {
    if (key === PROFILE_KEY) {
      const { value } = z.object({ value: z.union([z.record(z.string(), z.unknown()), z.null()]) }).parse(body);
      return json({ refused: 0, value: await writeProfile(db, viewer, value) });
    }
    if (key === ORGANIZATIONS_KEY) {
      const result = await writeOrganizations(db, viewer, body);
      return json(result, result.refused ? 403 : 200);
    }
    if (key === MEMBERSHIPS_KEY) {
      const result = await writeMemberships(db, viewer, body);
      return json(result, result.refused ? 403 : 200);
    }
    return json({ error: "not_found" }, 404);
  } catch (e) {
    if (e instanceof RecordError && e.code === "too_large") return refuse.tooLarge();
    if (e instanceof z.ZodError || e instanceof RecordError) return refuse.invalid();
    throw e;
  }
}
