// Limits that hold across every server instance: counted in the database
// (rate_limits), in fixed windows, with one atomic statement per hit so
// requests sent at the same moment can't all slip under the limit.
//
// Keys say what's counted and for whom, e.g. "code-try:mei@example.com",
// "write:<user id>", "ip:signin:203.0.113.7".
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { type Db, rateLimits, records } from "@sevak/db";
import type { Viewer } from "./auth";
import type { Mail } from "./notify";

export const HOUR = 60 * 60_000;
export const DAY = 24 * HOUR;

// Counts `n` more for `key` in the current window and says whether that's
// still within `limit`. Over the limit, the hit is still counted.
export async function hit(db: Db, key: string, limit: number, windowMs: number, n = 1, now = new Date()): Promise<boolean> {
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await db
    .insert(rateLimits)
    .values({ key: key.slice(0, 300), windowStart, count: n })
    .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + ${n}` } })
    .returning({ count: rateLimits.count });
  // Now and then, forget windows that ended long ago.
  if (Math.random() < 0.01) await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - 2 * DAY)));
  return (row?.count ?? 0) <= limit;
}

// Several limits at once (all counted); true only if every one holds.
export async function hitAll(db: Db, checks: [key: string, limit: number, windowMs: number][], now = new Date()): Promise<boolean> {
  let ok = true;
  for (const [key, limit, windowMs] of checks) if (!(await hit(db, key, limit, windowMs, 1, now))) ok = false;
  return ok;
}

// ---------- Emails ----------

// How many emails a change may cause, so nobody can use Sevak to flood
// someone's inbox or send their own text to many people. An organization
// Sevak hasn't verified can only send a few a day.
export const MAIL_LIMITS = {
  perPersonHour: 100, // emails one person's changes cause (not Sevak staff)
  perPersonDay: 300,
  perRecipientDay: 20, // emails to one address (sign-in emails aside)
  perOrgDay: 1000, // on behalf of one verified organization
  perUnverifiedOrgDay: 30,
};

// The emails from `mails` that are within the limits (all are counted).
export async function allowedMails(db: Db, viewer: Viewer | null, mails: Mail[], now = new Date()): Promise<Mail[]> {
  if (!mails.length) return [];
  const orgIds = [...new Set(mails.map((m) => m.orgId).filter((id): id is string => !!id))];
  const verified = new Set<string>();
  if (orgIds.length) {
    const rows = await db.select().from(records).where(and(eq(records.collection, "organizations"), inArray(records.id, orgIds)));
    for (const r of rows) if (r.data.verificationStatus === "verified") verified.add(r.id);
  }
  const out: Mail[] = [];
  for (const m of mails) {
    const checks: [string, number, number][] = [[`mail-to:${m.to.trim().toLowerCase()}`, MAIL_LIMITS.perRecipientDay, DAY]];
    if (viewer && !viewer.isPlatformAdmin) {
      checks.push([`mail-from:${viewer.id}`, MAIL_LIMITS.perPersonHour, HOUR], [`mail-from-day:${viewer.id}`, MAIL_LIMITS.perPersonDay, DAY]);
    }
    if (m.orgId) checks.push([`mail-org:${m.orgId}`, verified.has(m.orgId) ? MAIL_LIMITS.perOrgDay : MAIL_LIMITS.perUnverifiedOrgDay, DAY]);
    if (await hitAll(db, checks, now)) out.push(m);
    else console.warn(`Email not sent (over a limit): ${m.subject.slice(0, 80)}`);
  }
  return out;
}
