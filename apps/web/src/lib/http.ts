// Shared pieces for API routes: who is calling, the session cookie, and the
// checks every request that changes something must pass.
import { sessionViewer, type Viewer } from "@sevak/core";
import { getDb } from "@/lib/db";

// __Host- means the browser only sends it back to this exact site, over
// HTTPS, and no subdomain can set or read it.
export const SESSION_COOKIE = "__Host-sevak_session";
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function sessionCookie(token: string | null): string {
  const value = token ? encodeURIComponent(token) : "";
  const maxAge = token ? SESSION_MAX_AGE : 0;
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function platformAdmins(): string[] {
  return (process.env.SEVAK_PLATFORM_ADMINS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function viewerFor(req: Request): Promise<Viewer | null> {
  return sessionViewer(await getDb(), readCookie(req, SESSION_COOKIE), new Date(), platformAdmins());
}

// Requests that change something must come from Sevak's own pages, so
// another site can't make a signed-in browser act for it (CSRF).
export function fromOurPages(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export const refuse = {
  crossSite: () => json({ error: "cross_site" }, 403),
  signedOut: () => json({ error: "signed_out" }, 401),
  invalid: () => json({ error: "invalid" }, 400),
  tooLarge: () => json({ error: "too_large" }, 413),
};

// Reads a JSON body of at most `max` bytes, or returns undefined.
export async function readJson(req: Request, max: number): Promise<unknown> {
  const text = await req.text();
  if (text.length > max) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// The address the person's browser used. Cloud Run puts the real one first.
export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "unknown";
}

// A small, best-effort limit per server instance, on top of the per-email
// limit in the database (which is the one that counts).
const hits = new Map<string, number[]>();
export function tooMany(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) hits.clear();
  return recent.length > limit;
}

// Where links in emails point. Set APP_URL wherever the app is deployed, so
// a forged Host header can't send people elsewhere.
export function publicUrl(req: Request): string {
  const configured = process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.SEVAK_ENV === "production") throw new Error("APP_URL must be set in production.");
  return new URL(req.url).origin;
}
