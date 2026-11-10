import { eventFieldsFromCampaign, teamRole, ticketingCampaigns } from "@sevak/core";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { json, refuse, tooMany, viewerFor } from "@/lib/http";
import { getCampaign, keyFor, validTimeZone, zeffyFailure } from "@/lib/zeffy";

export const dynamic = "force-dynamic";

// GET /api/v1/organizations/{id}/zeffy/events/{campaignId}?tz=…: what the
// Zeffy event says now (title, description, dates, page), so the event's
// editor can show what changed and refresh it (EVT-20). The team only.
export async function GET(req: Request, ctx: { params: Promise<{ id: string; campaignId: string }> }) {
  const viewer = await viewerFor(req);
  if (!viewer) return refuse.signedOut();
  const { id, campaignId } = await ctx.params;
  const tz = validTimeZone(new URL(req.url).searchParams.get("tz") ?? "UTC");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !z.string().regex(/^[A-Za-z0-9-]{1,64}$/).safeParse(campaignId).success || !tz) return refuse.invalid();
  const db = await getDb();
  if (!(await teamRole(db, viewer, id))) return json({ error: "forbidden" }, 403);
  if (await tooMany(`user:zeffy:${viewer.id}`, 120, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  const key = await keyFor(db, id);
  if (!key) return json({ error: "not_connected" }, 409);
  try {
    const campaign = await getCampaign(key, campaignId);
    if (!ticketingCampaigns([campaign]).length) return json({ error: "not_found", gone: true }, 404);
    return json({ fields: eventFieldsFromCampaign(campaign, tz) });
  } catch (e) {
    return zeffyFailure(e);
  }
}
