import { joinWithCode } from "@sevak/core";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { clientIp, fromOurPages, json, publicUrl, readJson, refuse, tooMany, viewerFor } from "@/lib/http";
import { sendMails } from "@/lib/mail";

export const dynamic = "force-dynamic";

const body = z.object({ code: z.string().max(300), note: z.string().max(1_000).optional() });

// POST /api/v1/memberships/join {code, note}: joins the organization whose
// invite code this is, as a volunteer. Answers with the organization's
// public details and your memberships.
export async function POST(req: Request) {
  if (!fromOurPages(req)) return refuse.crossSite();
  const viewer = await viewerFor(req);
  if (!viewer) return refuse.signedOut();
  const parsed = body.safeParse(await readJson(req, 4_000));
  if (!parsed.success) return refuse.invalid();
  if ((await tooMany(`ip:code:${clientIp(req)}`, 30, 60 * 60_000)) || (await tooMany(`user:code:${viewer.id}`, 20, 24 * 60 * 60_000))) {
    return json({ error: "rate_limited" }, 429);
  }
  const result = await joinWithCode(await getDb(), viewer, parsed.data.code, parsed.data.note);
  if (!result) return json({ error: "not_found" }, 404);
  const { emails, ...rest } = result;
  await sendMails(publicUrl(req), viewer, emails);
  return json(rest);
}
