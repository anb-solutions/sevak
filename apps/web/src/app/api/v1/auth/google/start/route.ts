import { startGoogleSignIn } from "@sevak/core";
import { googleConfig, googleEnabled, pendingCookie, redirect, safeNext } from "@/lib/google";

export const dynamic = "force-dynamic";

// GET /api/v1/auth/google/start?next=page.html: sends the browser to Google
// to choose an account. Google sends it back to .../google/callback.
export async function GET(req: Request) {
  if (!googleEnabled()) return redirect(req, "/app/signin.html?error=google_off");
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  const { url, start } = startGoogleSignIn(googleConfig(req));
  const headers = new Headers({ Location: url, "Cache-Control": "no-store" });
  headers.append("Set-Cookie", pendingCookie({ ...start, next }));
  return new Response(null, { status: 303, headers });
}
