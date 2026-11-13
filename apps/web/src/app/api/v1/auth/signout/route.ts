import { signOut } from "@sevak/core";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { fromOurPages, json, readCookie, refuse, SESSION_COOKIE, sessionCookie } from "@/lib/http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ everywhere: z.boolean().optional() }).passthrough();

// POST /api/v1/auth/signout: ends this session, or with {everywhere: true}
// every session of the person signed in.
export async function POST(req: Request) {
  if (!fromOurPages(req)) return refuse.crossSite();
  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  await signOut(await getDb(), readCookie(req, SESSION_COOKIE), { everywhere: body.success && body.data.everywhere === true });
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(null) });
}
