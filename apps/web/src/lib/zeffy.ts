// Talking to Zeffy's API (https://api.zeffy.com/api/docs) with an
// organization's key, and keeping that key encrypted (@sevak/core zeffy.ts).
import { createHash } from "node:crypto";
import { type Campaign, readZeffyConnection, unseal } from "@sevak/core";
import type { Db } from "@sevak/db";
import { json } from "@/lib/http";

// Tests point this at a stand-in for Zeffy.
const base = () => (process.env.ZEFFY_API_BASE ?? "https://api.zeffy.com/api/v1").replace(/\/+$/, "");

// The key that encrypts stored keys: SEVAK_SECRETS_KEY (32 random bytes,
// base64), from Secret Manager (infra/gcp/setup.sh). Local development and
// tests use a fixed one; staging and production must have their own, or
// Zeffy can't be connected there.
export function secretsKey(): Buffer | null {
  const configured = process.env.SEVAK_SECRETS_KEY?.trim();
  if (configured) {
    const key = Buffer.from(configured, "base64");
    return key.length === 32 ? key : null;
  }
  const env = process.env.SEVAK_ENV;
  if (env === "staging" || env === "production") return null;
  return createHash("sha256").update("sevak local development only").digest();
}

export class ZeffyError extends Error {
  constructor(public reason: "bad_key" | "unavailable" | "not_found") {
    super(reason);
  }
}

async function call(apiKey: string, path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(base() + path, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ZeffyError("unavailable");
  }
  if (res.status === 401 || res.status === 403) throw new ZeffyError("bad_key");
  if (res.status === 404) throw new ZeffyError("not_found");
  if (!res.ok) throw new ZeffyError("unavailable");
  const text = await res.text();
  if (text.length > 5_000_000) throw new ZeffyError("unavailable");
  try {
    return JSON.parse(text);
  } catch {
    throw new ZeffyError("unavailable");
  }
}

// Checks a key works (reading one campaign).
export async function checkKey(apiKey: string): Promise<void> {
  await call(apiKey, "/campaigns?limit=1");
}

// The organization's campaigns, newest first (up to 300).
export async function listCampaigns(apiKey: string): Promise<Campaign[]> {
  const all: Campaign[] = [];
  let after = "";
  for (let page = 0; page < 3; page++) {
    const list = (await call(apiKey, `/campaigns?limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ""}`)) as Campaign;
    const data = Array.isArray(list?.data) ? (list.data as Campaign[]) : [];
    all.push(...data);
    if (!list?.has_more || !data.length) break;
    after = String(list.next_cursor ?? data[data.length - 1]!.id ?? "");
    if (!after) break;
  }
  return all;
}

export async function getCampaign(apiKey: string, id: string): Promise<Campaign> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) throw new ZeffyError("not_found");
  return (await call(apiKey, `/campaigns/${id}`)) as Campaign;
}

// The organization's Zeffy key, or null if it isn't connected.
export async function keyFor(db: Db, orgId: string): Promise<string | null> {
  const conn = await readZeffyConnection(db, orgId);
  const secrets = secretsKey();
  if (!conn || !secrets) return null;
  return unseal(secrets, conn.sealed);
}

// A time zone name the server knows, or null.
export function validTimeZone(tz: unknown): string | null {
  if (typeof tz !== "string" || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

// The answer for a failed call to Zeffy.
export function zeffyFailure(e: unknown) {
  if (!(e instanceof ZeffyError)) throw e;
  if (e.reason === "bad_key") return json({ error: "bad_key" }, 400);
  if (e.reason === "not_found") return json({ error: "not_found" }, 404);
  return json({ error: "unavailable" }, 502);
}

