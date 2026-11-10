import { AuthError, readProfile, verifySignIn } from "@sevak/core";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { clientIp, fromOurPages, json, readJson, refuse, sessionCookie, tooMany } from "@/lib/http";

export const dynamic = "force-dynamic";

const body = z.union([
  z.object({ email: z.string().max(254), code: z.string().max(10) }),
  z.object({ token: z.string().min(10).max(100) }),
]);

// POST /api/v1/auth/verify {email, code} or {token}: signs in and sets the
// session cookie. Says whether the person still needs to fill in a profile.
export async function POST(req: Request) {
  if (!fromOurPages(req)) return refuse.crossSite();
  const parsed = body.safeParse(await readJson(req, 2_000));
  if (!parsed.success) return refuse.invalid();
  if (await tooMany(`ip:verify:${clientIp(req)}`, 150, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  try {
    const db = await getDb();
    const { sessionToken, viewer } = await verifySignIn(db, parsed.data);
    const hasProfile = !!(await readProfile(db, viewer));
    return json({ ok: true, email: viewer.email, hasProfile }, 200, { "Set-Cookie": sessionCookie(sessionToken) });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: "invalid" }, 400);
    throw e;
  }
}
