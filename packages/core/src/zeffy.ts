// Importing events from Zeffy (zeffy.com), the free ticketing and
// fundraising platform many nonprofits use (EVT-20). An organization's Admin
// connects Sevak with the organization's Zeffy API key; its team can then
// pick a Zeffy event to start a Sevak event from, and refresh it later.
//
// Zeffy's API (https://api.zeffy.com/api/docs) calls events "campaigns" of
// type "ticketing", with a title, description, public page, start and end,
// and dates ("occurrences"). It has no place or time zone, so the team adds
// those, and the roles and shifts, in Sevak.
//
// The key can also change the organization's Zeffy data, so it's stored
// encrypted (seal/unseal), used only by the server, and never sent to a page.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { type Db, records } from "@sevak/db";
import type { Viewer } from "./auth";
import { type Json, orgRole } from "./records";

export type Campaign = Json;

// ---------- The key, kept encrypted ----------

// AES-256-GCM with the app's secrets key (SEVAK_SECRETS_KEY, 32 bytes).
export function seal(secretsKey: Buffer, text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretsKey, iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function unseal(secretsKey: Buffer, sealed: string): string | null {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || body === undefined) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", secretsKey, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ---------- The connection, per organization ----------

const COLLECTION = "integrations";
const idFor = (orgId: string) => `zeffy-${orgId}`.slice(0, 120);

async function organization(db: Db, orgId: string): Promise<Json | null> {
  const [row] = await db.select().from(records).where(and(eq(records.collection, "organizations"), eq(records.id, orgId)));
  return row?.data ?? null;
}

// The viewer's role in the organization ("admin", "coordinator"), Sevak
// staff counting as Admins; null if they're not on its team.
export async function teamRole(db: Db, viewer: Viewer, orgId: string): Promise<"admin" | "coordinator" | null> {
  const org = await organization(db, orgId);
  if (!org) return null;
  if (viewer.isPlatformAdmin) return "admin";
  return orgRole(org, viewer.email);
}

export interface ZeffyConnection {
  sealed: string;
  last4: string;
  connectedBy: string;
  connectedAt: string;
}

export async function readZeffyConnection(db: Db, orgId: string): Promise<ZeffyConnection | null> {
  const [row] = await db.select().from(records).where(and(eq(records.collection, COLLECTION), eq(records.id, idFor(orgId))));
  return row ? (row.data as unknown as ZeffyConnection) : null;
}

export async function saveZeffyConnection(db: Db, viewer: Viewer, orgId: string, sealed: string, last4: string) {
  const data = { sealed, last4, connectedBy: viewer.email, connectedAt: new Date().toISOString() };
  await db
    .insert(records)
    .values({ collection: COLLECTION, id: idFor(orgId), orgId, data, updatedBy: viewer.id })
    .onConflictDoUpdate({ target: [records.collection, records.id], set: { data, updatedAt: new Date(), updatedBy: viewer.id } });
}

export async function removeZeffyConnection(db: Db, orgId: string) {
  await db.delete(records).where(and(eq(records.collection, COLLECTION), eq(records.id, idFor(orgId))));
}

// ---------- From a Zeffy campaign to a Sevak event ----------

// Zeffy descriptions are formatted text (HTML); Sevak's are plain.
export function htmlToText(html: unknown, max = 2000): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  const text = String(html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 31 && n < 0x110000 ? String.fromCodePoint(n) : "";
      }
      return named[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// A Unix time (seconds, or milliseconds) as a date in a time zone.
function dayIn(time: unknown, timeZone: string): string | null {
  const n = Number(time);
  if (!Number.isFinite(n) || n <= 0) return null;
  const date = new Date(n < 1e12 ? n * 1000 : n);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return null;
  }
}

function timeIn(time: unknown, timeZone: string): string | null {
  const n = Number(time);
  if (!Number.isFinite(n) || n <= 0) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(n < 1e12 ? n * 1000 : n));
  } catch {
    return null;
  }
}

const isLive = (c: Campaign) => !c.deleted_at && c.is_archived !== true;

// The event's dates in Zeffy, each with its start and end.
function occurrencesOf(c: Campaign): { start: unknown; end: unknown }[] {
  const list = (Array.isArray(c.occurrences) ? (c.occurrences as Json[]) : [])
    .filter((o) => o && o.is_archived !== true)
    .map((o) => ({ start: o.start ?? o.start_date, end: o.end ?? o.end_date }));
  if (list.length) return list.sort((a, b) => Number(a.start) - Number(b.start));
  return c.start_date ? [{ start: c.start_date, end: c.end_date ?? c.start_date }] : [];
}

// What Sevak takes from a Zeffy event, with dates in `timeZone`.
export function eventFieldsFromCampaign(c: Campaign, timeZone: string): Json {
  const dates = occurrencesOf(c);
  const first = dates[0];
  const last = dates[dates.length - 1];
  const startDate = first ? dayIn(first.start, timeZone) : null;
  const endDate = last ? (dayIn(last.end, timeZone) ?? dayIn(last.start, timeZone)) : null;
  return {
    title: String(c.title ?? "").trim().slice(0, 120),
    description: htmlToText(c.description),
    ...(startDate ? { startDate, endDate: endDate && endDate >= startDate ? endDate : startDate } : {}),
    zeffyUrl: typeof c.url === "string" && /^https:\/\//.test(c.url) ? c.url.slice(0, 500) : "",
    dates: dates.map((o) => ({ date: dayIn(o.start, timeZone), start: timeIn(o.start, timeZone), end: timeIn(o.end, timeZone) })).filter((d) => d.date),
  };
}

// What the team sees when choosing a Zeffy event to start from.
export function campaignSummary(c: Campaign, timeZone: string): Json {
  const f = eventFieldsFromCampaign(c, timeZone);
  return {
    id: String(c.id ?? ""),
    title: f.title,
    startDate: f.startDate ?? null,
    endDate: f.endDate ?? null,
    dates: (f.dates as Json[]).length,
    url: f.zeffyUrl,
    status: String(c.status ?? ""),
  };
}

// Zeffy events (not donation forms) that are still running.
export function ticketingCampaigns(list: Campaign[]): Campaign[] {
  return list.filter((c) => c && c.type === "ticketing" && isLive(c));
}

// A new draft event in Sevak from a Zeffy event.
export function eventFromCampaign(c: Campaign, opts: { id: string; org: Json; timeZone: string; by: string }): Json {
  const f = eventFieldsFromCampaign(c, opts.timeZone);
  const now = new Date().toISOString();
  return {
    id: opts.id,
    organizationId: String(opts.org.id),
    organizationName: String(opts.org.name ?? ""),
    title: f.title || "Event from Zeffy",
    description: f.description,
    startDate: f.startDate ?? "",
    endDate: f.endDate ?? f.startDate ?? "",
    timezone: opts.timeZone,
    location: { type: "in-person", venue: "", country: "", line1: "", city: "", state: "", postalCode: "" },
    roles: [],
    visibility: "public",
    eventAdmin: opts.by,
    status: "draft",
    active: true,
    source: { kind: "zeffy", id: String(c.id), url: f.zeffyUrl, importedAt: now, syncedAt: now },
    createdAt: now,
    updatedAt: now,
  };
}
