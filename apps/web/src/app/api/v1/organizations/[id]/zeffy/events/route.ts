import {
  campaignSummary,
  EVENTS_KEY,
  eventFromCampaign,
  newToken,
  readEventsAndMain,
  readOrganizations,
  teamRole,
  ticketingCampaigns,
  writeEvents,
} from "@sevak/core";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { fromOurPages, json, readJson, refuse, tooMany, viewerFor } from "@/lib/http";
import { getCampaign, keyFor, listCampaigns, validTimeZone, zeffyFailure } from "@/lib/zeffy";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const orgIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);

// GET /api/v1/organizations/{id}/zeffy/events?tz=America/Chicago: the
// organization's Zeffy events to start from (EVT-20), with the Sevak event
// each was imported as. The organization's team only.
export async function GET(req: Request, ctx: Ctx) {
  const viewer = await viewerFor(req);
  if (!viewer) return refuse.signedOut();
  const id = orgIdSchema.safeParse((await ctx.params).id);
  const tz = validTimeZone(new URL(req.url).searchParams.get("tz") ?? "UTC");
  if (!id.success || !tz) return refuse.invalid();
  const db = await getDb();
  if (!(await teamRole(db, viewer, id.data))) return json({ error: "forbidden" }, 403);
  if (await tooMany(`user:zeffy:${viewer.id}`, 120, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  const key = await keyFor(db, id.data);
  if (!key) return json({ error: "not_connected" }, 409);
  try {
    const campaigns = ticketingCampaigns(await listCampaigns(key));
    const imported = new Map<string, string>();
    for (const e of (await readEventsAndMain(db, viewer)).events) {
      const s = e.source as { kind?: string; id?: string } | undefined;
      if (e.organizationId === id.data && s?.kind === "zeffy" && s.id) imported.set(s.id, String(e.id));
    }
    return json({ events: campaigns.map((c) => ({ ...campaignSummary(c, tz), importedAs: imported.get(String(c.id)) ?? null })) });
  } catch (e) {
    return zeffyFailure(e);
  }
}

// POST /api/v1/organizations/{id}/zeffy/events {campaignId, timezone}:
// starts a draft Sevak event from a Zeffy event, or answers with the one
// already started from it. The organization's team only.
export async function POST(req: Request, ctx: Ctx) {
  if (!fromOurPages(req)) return refuse.crossSite();
  const viewer = await viewerFor(req);
  if (!viewer) return refuse.signedOut();
  const id = orgIdSchema.safeParse((await ctx.params).id);
  const body = z.object({ campaignId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/), timezone: z.string() }).safeParse(await readJson(req, 4_000));
  const tz = body.success ? validTimeZone(body.data.timezone) : null;
  if (!id.success || !body.success || !tz) return refuse.invalid();
  const db = await getDb();
  if (!(await teamRole(db, viewer, id.data))) return json({ error: "forbidden" }, 403);
  if (await tooMany(`user:zeffy:${viewer.id}`, 120, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  const key = await keyFor(db, id.data);
  if (!key) return json({ error: "not_connected" }, 409);

  const before = (await readEventsAndMain(db, viewer)).events;
  const already = before.find((e) => e.organizationId === id.data && (e.source as { id?: string } | undefined)?.id === body.data.campaignId);
  if (already) return json({ eventId: already.id, created: false, [EVENTS_KEY]: before });

  let campaign;
  try {
    campaign = await getCampaign(key, body.data.campaignId);
  } catch (e) {
    return zeffyFailure(e);
  }
  if (!ticketingCampaigns([campaign]).length) return json({ error: "not_found" }, 404);
  const org = (await readOrganizations(db, viewer)).find((o) => o.id === id.data);
  if (!org) return json({ error: "forbidden" }, 403);
  const event = eventFromCampaign(campaign, { id: `event-${newToken().slice(0, 12).replace(/[^A-Za-z0-9]/g, "x")}`, org, timeZone: tz, by: viewer.email });
  const result = await writeEvents(db, viewer, { upsert: [event] });
  if (result.refused) return json({ error: result.reason ?? "refused" }, 403);
  return json({ eventId: event.id, created: true, [EVENTS_KEY]: result.value });
}
