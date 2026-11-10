// Shared pieces for API routes: who is calling, the session cookie, and the
// checks every request that changes something must pass.
import { hit, sessionViewer, type Viewer } from "@sevak/core";
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

// The address the person's browser used. Anyone can send their own
// X-Forwarded-For; Google's front end adds the real address at the end, so
// read from the right, skipping private addresses (Google's own hops). Behind
// a Google load balancer, which adds its own address after the person's, set
// SEVAK_PROXY_HOPS=2.
export function clientIp(req: Request): string {
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter((s) => s && !isPrivate(s));
  const fromRight = Math.max(1, Number(process.env.SEVAK_PROXY_HOPS) || 1);
  return (hops[hops.length - fromRight] ?? hops[0] ?? "unknown").slice(0, 64);
}

function isPrivate(ip: string): boolean {
  return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i.test(ip);
}

// Per-address limits, counted in the database so they hold across server
// instances (packages/core/src/limits.ts).
export async function tooMany(key: string, limit: number, windowMs: number): Promise<boolean> {
  return !(await hit(await getDb(), key, limit, windowMs));
}

// Where links in emails point. Set APP_URL wherever the app is deployed, so
// a forged Host header can't send people elsewhere.
export function publicUrl(req: Request): string {
  const configured = process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.SEVAK_ENV === "production") throw new Error("APP_URL must be set in production.");
  return new URL(req.url).origin;
}
