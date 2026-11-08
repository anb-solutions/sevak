// "Continue with Google": settings, and the short-lived cookie that ties
// Google's return to the start of the sign-in (see @sevak/core google.ts).
// Off unless GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
import type { GoogleConfig, GoogleStart } from "@sevak/core";
import { publicUrl, readCookie } from "@/lib/http";

const COOKIE = "__Host-sevak_google";
const MINUTES = 10;

export function googleEnabled(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID?.trim() && !!process.env.GOOGLE_CLIENT_SECRET?.trim();
}

export function googleConfig(req: Request): GoogleConfig {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID!.trim(),
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
    redirectUri: `${publicUrl(req)}/api/v1/auth/google/callback`,
  };
}

export interface PendingGoogle extends GoogleStart {
  next: string;
}

export function pendingCookie(value: PendingGoogle | null): string {
  if (!value) return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${COOKIE}=${encoded}; Path=/; Max-Age=${MINUTES * 60}; HttpOnly; Secure; SameSite=Lax`;
}

export function readPending(req: Request): PendingGoogle | null {
  const raw = readCookie(req, COOKIE);
  if (!raw || raw.length > 2_000) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as PendingGoogle;
    return typeof v.state === "string" && typeof v.nonce === "string" && typeof v.verifier === "string" ? { ...v, next: safeNext(v.next) } : null;
  } catch {
    return null;
  }
}

// A page of this app to go to afterwards, such as "event.html", or "".
export function safeNext(next: unknown): string {
  return typeof next === "string" && /^[a-z-]+\.html$/.test(next) ? next : "";
}

// Sends the browser to one of the app's pages, setting cookies on the way.
export function redirect(req: Request, path: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: `${publicUrl(req)}${path}`, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 303, headers });
}
