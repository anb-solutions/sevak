import { signOut } from "@sevak/core";
import { getDb } from "@/lib/db";
import { fromOurPages, json, readCookie, refuse, SESSION_COOKIE, sessionCookie } from "@/lib/http";

export const dynamic = "force-dynamic";

// POST /api/v1/auth/signout: ends this session.
export async function POST(req: Request) {
  if (!fromOurPages(req)) return refuse.crossSite();
  await signOut(await getDb(), readCookie(req, SESSION_COOKIE));
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(null) });
}
