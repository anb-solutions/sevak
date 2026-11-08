import { organizationForCode } from "@sevak/core";
import { getDb } from "@/lib/db";
import { clientIp, json, tooMany } from "@/lib/http";

export const dynamic = "force-dynamic";

// GET /api/v1/organizations/by-code/{code}: which organization an invite
// code belongs to (its public details only), so the join page can say who's
// inviting you. Limited per address, so codes can't be guessed.
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  if (tooMany(`code:${clientIp(req)}`, 30, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  const { code } = await ctx.params;
  const organization = await organizationForCode(await getDb(), code.slice(0, 300));
  return organization ? json({ organization }) : json({ error: "not_found" }, 404);
}
