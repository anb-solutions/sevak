import { publicEvent } from "@sevak/core";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/v1/events/{slug}: a published event's public details, roles and
// shifts with spots left. Never includes volunteers' names (§5).
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return Response.json({ error: "not_found" }, { status: 404 });
  const event = await publicEvent(await getDb(), slug);
  if (!event) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(event);
}
