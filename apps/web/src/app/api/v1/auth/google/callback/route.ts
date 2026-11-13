import { finishGoogleSignIn, GoogleSignInError, readProfile, startSession } from "@sevak/core";
import { getDb } from "@/lib/db";
import { googleConfig, googleEnabled, pendingCookie, readPending, redirect } from "@/lib/google";
import { sessionCookie } from "@/lib/http";

export const dynamic = "force-dynamic";

// GET /api/v1/auth/google/callback?code=…&state=…: Google sends the browser
// here after the person chooses an account. Signs them in (the same account
// as their emailed code would) and opens their next page.
export async function GET(req: Request) {
  const clear = pendingCookie(null);
  const fail = (error: string) => redirect(req, `/app/signin.html?error=${error}`, [clear]);
  if (!googleEnabled()) return fail("google_off");

  const pending = readPending(req);
  const q = new URL(req.url).searchParams;
  if (q.get("error")) return fail("google_cancelled"); // e.g. they closed Google's screen
  if (!pending) return fail("google_failed");

  try {
    const email = await finishGoogleSignIn(googleConfig(req), pending, { code: q.get("code") ?? "", state: q.get("state") ?? "" });
    const db = await getDb();
    const { sessionToken, viewer } = await startSession(db, email, new Date(), "google");
    const page = pending.next || ((await readProfile(db, viewer)) ? "signup.html" : "profile.html");
    return redirect(req, `/app/${page}`, [clear, sessionCookie(sessionToken)]);
  } catch (e) {
    if (e instanceof GoogleSignInError) return fail(e.reason === "use_email_code" ? "google_use_email" : "google_failed");
    console.error("Google sign-in failed:", e);
    return fail("google_failed");
  }
}
