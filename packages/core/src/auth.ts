// Sign-in without passwords (VOL-2): Sevak emails a 6-digit code and a link,
// and either one opens a session. Codes, links and sessions are random and
// only their SHA-256 hashes are stored (NFR-6).
import { timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { type Db, loginTokens, sessions, users } from "@sevak/db";
import { DAY, HOUR, hit } from "./limits";
import { hashToken, newCode, newToken } from "./tokens";

export const CODE_MINUTES = 15;
export const SESSION_DAYS = 30;
export const MAX_REQUESTS_PER_HOUR = 5; // sign-in emails to one address
export const MAX_CODE_ATTEMPTS = 5; // wrong codes before a code stops working
export const MAX_CODE_TRIES_PER_DAY = 30; // codes tried for one address, all its codes together

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email());

export class AuthError extends Error {
  constructor(public code: "rate_limited" | "invalid") {
    super(code);
  }
}

export interface Viewer {
  id: string;
  email: string;
  isPlatformAdmin: boolean;
}

const minutes = (n: number) => n * 60_000;

// Starts a sign-in for `email`: returns the code and link token to email.
// Refused after MAX_REQUESTS_PER_HOUR requests for one address in an hour.
export async function requestSignIn(db: Db, rawEmail: string, now = new Date()) {
  const email = emailSchema.parse(rawEmail);
  if (!(await hit(db, `signin-email:${email}`, MAX_REQUESTS_PER_HOUR, HOUR, 1, now))) throw new AuthError("rate_limited");

  // Old requests for this address are no longer needed.
  await db.delete(loginTokens).where(and(eq(loginTokens.email, email), lt(loginTokens.createdAt, new Date(now.getTime() - minutes(24 * 60)))));

  const token = newToken();
  const code = newCode();
  await db.insert(loginTokens).values({
    email,
    tokenHash: hashToken(token),
    codeHash: hashToken(`${email}:${code}`),
    expiresAt: new Date(now.getTime() + minutes(CODE_MINUTES)),
    createdAt: now,
  });
  return { email, code, token };
}

function sameHash(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Finishes a sign-in with the emailed code (and the email it went to) or
// the link's token. Creates the person's account the first time. Returns a
// new session token for the cookie, or throws AuthError("invalid").
export async function verifySignIn(
  db: Db,
  proof: { email: string; code: string } | { token: string },
  now = new Date(),
): Promise<{ sessionToken: string; viewer: Viewer; isNew: boolean }> {
  let tokenId: string | undefined;
  let email: string | undefined;

  if ("token" in proof) {
    const [row] = await db
      .select()
      .from(loginTokens)
      .where(and(eq(loginTokens.tokenHash, hashToken(proof.token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, now)));
    if (row) [tokenId, email] = [row.id, row.email];
  } else {
    const parsed = emailSchema.safeParse(proof.email);
    if (!parsed.success || !/^\d{6}$/.test(proof.code)) throw new AuthError("invalid");
    // Only the newest code for the address works.
    const [row] = await db
      .select()
      .from(loginTokens)
      .where(and(eq(loginTokens.email, parsed.data), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, now)))
      .orderBy(desc(loginTokens.createdAt))
      .limit(1);
    if (row) {
      // Count the try before checking it, in one statement, so guesses sent
      // all at once can't get past the limit. A code stops working after
      // MAX_CODE_ATTEMPTS tries, and an address after MAX_CODE_TRIES_PER_DAY
      // (its emailed link still works).
      const counted = await db
        .update(loginTokens)
        .set({ attempts: sql`${loginTokens.attempts} + 1` })
        .where(and(eq(loginTokens.id, row.id), isNull(loginTokens.usedAt), lt(loginTokens.attempts, MAX_CODE_ATTEMPTS)))
        .returning({ id: loginTokens.id });
      const allowed = counted.length > 0 && (await hit(db, `code-try:${parsed.data}`, MAX_CODE_TRIES_PER_DAY, DAY, 1, now));
      if (allowed && sameHash(row.codeHash, hashToken(`${parsed.data}:${proof.code}`))) [tokenId, email] = [row.id, row.email];
    }
  }
  if (!tokenId || !email) throw new AuthError("invalid");

  // Use it up. Only one request can do this, so a code or link works once.
  const used = await db
    .update(loginTokens)
    .set({ usedAt: now })
    .where(and(eq(loginTokens.id, tokenId), isNull(loginTokens.usedAt)))
    .returning({ id: loginTokens.id });
  if (!used.length) throw new AuthError("invalid");

  return startSession(db, email, now);
}

// Signs in someone whose email is already proven (by an emailed code or
// link, or by Google), creating their account the first time.
export async function startSession(db: Db, rawEmail: string, now = new Date()): Promise<{ sessionToken: string; viewer: Viewer; isNew: boolean }> {
  const email = emailSchema.parse(rawEmail);
  let [user] = await db.select().from(users).where(eq(users.email, email));
  const isNew = !user;
  if (!user) {
    [user] = await db.insert(users).values({ email }).onConflictDoNothing().returning();
    user ??= (await db.select().from(users).where(eq(users.email, email)))[0];
  }
  if (!user) throw new AuthError("invalid");

  const sessionToken = newToken();
  await db.insert(sessions).values({
    idHash: hashToken(sessionToken),
    userId: user.id,
    expiresAt: new Date(now.getTime() + minutes(SESSION_DAYS * 24 * 60)),
    createdAt: now,
  });
  return { sessionToken, viewer: { id: user.id, email: user.email, isPlatformAdmin: user.isPlatformAdmin }, isNew };
}

// The person a session cookie belongs to, or null if it's unknown or expired.
// `platformAdmins` adds Sevak staff by email (SEVAK_PLATFORM_ADMINS).
export async function sessionViewer(db: Db, sessionToken: string | undefined, now = new Date(), platformAdmins: string[] = []): Promise<Viewer | null> {
  if (!sessionToken || sessionToken.length > 100) return null;
  const [row] = await db
    .select({ id: users.id, email: users.email, isPlatformAdmin: users.isPlatformAdmin })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.idHash, hashToken(sessionToken)), gt(sessions.expiresAt, now)));
  if (!row) return null;
  return { ...row, isPlatformAdmin: row.isPlatformAdmin || platformAdmins.includes(row.email) };
}

export async function signOut(db: Db, sessionToken: string | undefined) {
  if (!sessionToken) return;
  await db.delete(sessions).where(eq(sessions.idHash, hashToken(sessionToken)));
}
