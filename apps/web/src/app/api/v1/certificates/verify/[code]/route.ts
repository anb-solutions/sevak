import { verifyCertificate } from "@sevak/core";
import { getDb } from "@/lib/db";
import { clientIp, json, tooMany } from "@/lib/http";

export const dynamic = "force-dynamic";

// GET /api/v1/certificates/verify/{code}: checks a certificate by its number
// (SVK-XXXX-XXXX). Shows only what proves it: the volunteer's name, the
// organization, the period, the approved hours, the events and when it was
// issued (ATT-6). Limited per address, so numbers can't be guessed.
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  if (await tooMany(`ip:verify-cert:${clientIp(req)}`, 60, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  const { code } = await ctx.params;
  const certificate = await verifyCertificate(await getDb(), code.slice(0, 40));
  return certificate ? json({ certificate }) : json({ error: "not_found" }, 404);
}
