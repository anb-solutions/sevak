import { AuthError, requestSignIn } from "@sevak/core";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { clientIp, fromOurPages, json, publicUrl, readJson, refuse, tooMany } from "@/lib/http";
import { send, signInEmail } from "@/lib/mail";

export const dynamic = "force-dynamic";

const body = z.object({ email: z.string().max(254) });

// POST /api/v1/auth/request {email}: emails a sign-in code and link. Answers
// the same whether or not the address has an account, so it can't be used
// to find out who uses Sevak.
export async function POST(req: Request) {
  if (!fromOurPages(req)) return refuse.crossSite();
  const parsed = body.safeParse(await readJson(req, 2_000));
  if (!parsed.success) return refuse.invalid();
  // Per address, generous: a whole temple on one Wi-Fi signs in on event
  // day. The real limit is per email, in the database (5 an hour).
  if (tooMany(`signin:${clientIp(req)}`, 100, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  try {
    const { email, code, token } = await requestSignIn(await getDb(), parsed.data.email);
    // The token is after #, so it never reaches a server (or a link scanner's log).
    await send(signInEmail(email, code, `${publicUrl(req)}/app/signin.html#token=${token}`));
    return json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: "rate_limited" }, 429);
    if (e instanceof z.ZodError) return refuse.invalid();
    console.error("Sign-in email failed:", e);
    return json({ error: "email_failed" }, 502);
  }
}
