import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, loginTokens, users } from "@sevak/db";
import { createMemoryDb } from "@sevak/db/memory";
import { AuthError, MAX_CODE_ATTEMPTS, MAX_CODE_TRIES_PER_DAY, MAX_REQUESTS_PER_HOUR, requestSignIn, sessionViewer, signOut, verifySignIn } from "./auth";

let db: Db;
const NOW = new Date("2026-11-08T12:00:00Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

beforeEach(async () => {
  db = await createMemoryDb();
});

describe("sign-in with an emailed code", () => {
  it("signs in with the code, creating the account the first time", async () => {
    const { code } = await requestSignIn(db, "  Asha@Example.com ", NOW);
    const result = await verifySignIn(db, { email: "asha@example.com", code }, later(1));
    expect(result.isNew).toBe(true);
    expect(result.viewer.email).toBe("asha@example.com");
    expect(await sessionViewer(db, result.sessionToken, later(2))).toMatchObject({ email: "asha@example.com" });

    const again = await requestSignIn(db, "asha@example.com", later(3));
    const second = await verifySignIn(db, { email: "asha@example.com", code: again.code }, later(4));
    expect(second.isNew).toBe(false);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("works once only", async () => {
    const { code } = await requestSignIn(db, "asha@example.com", NOW);
    await verifySignIn(db, { email: "asha@example.com", code }, later(1));
    await expect(verifySignIn(db, { email: "asha@example.com", code }, later(2))).rejects.toThrow(AuthError);
  });

  it("refuses a wrong code, another address's code, and an expired code", async () => {
    const { code } = await requestSignIn(db, "asha@example.com", NOW);
    const wrong = code === "000000" ? "111111" : "000000";
    await expect(verifySignIn(db, { email: "asha@example.com", code: wrong }, later(1))).rejects.toThrow(AuthError);
    await expect(verifySignIn(db, { email: "ravi@example.com", code }, later(1))).rejects.toThrow(AuthError);
    await expect(verifySignIn(db, { email: "asha@example.com", code }, later(16))).rejects.toThrow(AuthError);
  });

  it("stops accepting a code after too many wrong tries", async () => {
    const { code } = await requestSignIn(db, "asha@example.com", NOW);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      await expect(verifySignIn(db, { email: "asha@example.com", code: wrong }, later(1))).rejects.toThrow(AuthError);
    }
    await expect(verifySignIn(db, { email: "asha@example.com", code }, later(1))).rejects.toThrow(AuthError);
  });

  it("counts guesses sent all at once", async () => {
    const { code } = await requestSignIn(db, "asha@example.com", NOW);
    const wrong = Array.from({ length: 40 }, (_, i) => String(i).padStart(6, "0")).filter((c) => c !== code);
    const tries = [...wrong.slice(0, 30), code, ...wrong.slice(30)].map((c) => verifySignIn(db, { email: "asha@example.com", code: c }, later(1)));
    const results = await Promise.allSettled(tries);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(0);
    const [row] = await db.select().from(loginTokens).where(eq(loginTokens.email, "asha@example.com"));
    expect(row!.attempts).toBe(MAX_CODE_ATTEMPTS);
  });

  it("limits code tries for one address across all its codes, but the link still works", async () => {
    const codes = MAX_CODE_TRIES_PER_DAY / MAX_CODE_ATTEMPTS;
    for (let i = 0; i < codes; i++) {
      const { code } = await requestSignIn(db, "asha@example.com", later(i * 60));
      const wrong = code === "000000" ? "111111" : "000000";
      for (let j = 0; j < MAX_CODE_ATTEMPTS; j++) await verifySignIn(db, { email: "asha@example.com", code: wrong }, later(i * 60 + 1)).catch(() => {});
    }
    const last = await requestSignIn(db, "asha@example.com", later(codes * 60));
    await expect(verifySignIn(db, { email: "asha@example.com", code: last.code }, later(codes * 60 + 1))).rejects.toThrow(AuthError);
    await expect(verifySignIn(db, { token: last.token }, later(codes * 60 + 1))).resolves.toBeTruthy();
  });

  it("limits how many codes one address can be sent", async () => {
    for (let i = 0; i < MAX_REQUESTS_PER_HOUR; i++) await requestSignIn(db, "asha@example.com", later(i));
    await expect(requestSignIn(db, "asha@example.com", later(10))).rejects.toThrow("rate_limited");
    await expect(requestSignIn(db, "asha@example.com", later(70))).resolves.toBeTruthy();
  });

  it("stores only hashes", async () => {
    const { code, token } = await requestSignIn(db, "asha@example.com", NOW);
    const [row] = await db.select().from(loginTokens).where(eq(loginTokens.email, "asha@example.com"));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row!.codeHash).not.toContain(code);
  });

  it("refuses an address that isn't one", async () => {
    await expect(requestSignIn(db, "not an email", NOW)).rejects.toThrow();
  });
});

describe("sign-in with the emailed link", () => {
  it("signs in once with the link's token", async () => {
    const { token } = await requestSignIn(db, "asha@example.com", NOW);
    const result = await verifySignIn(db, { token }, later(1));
    expect(result.viewer.email).toBe("asha@example.com");
    await expect(verifySignIn(db, { token }, later(2))).rejects.toThrow(AuthError);
  });

  it("refuses a made-up or expired link", async () => {
    const { token } = await requestSignIn(db, "asha@example.com", NOW);
    await expect(verifySignIn(db, { token: "made-up" }, later(1))).rejects.toThrow(AuthError);
    await expect(verifySignIn(db, { token }, later(20))).rejects.toThrow(AuthError);
  });
});

describe("sessions", () => {
  it("end on sign-out, after 30 days, and for unknown tokens", async () => {
    const { code } = await requestSignIn(db, "asha@example.com", NOW);
    const { sessionToken } = await verifySignIn(db, { email: "asha@example.com", code }, NOW);
    expect(await sessionViewer(db, sessionToken, later(29 * 24 * 60))).not.toBeNull();
    expect(await sessionViewer(db, sessionToken, later(31 * 24 * 60))).toBeNull();
    expect(await sessionViewer(db, "nope", NOW)).toBeNull();
    expect(await sessionViewer(db, undefined, NOW)).toBeNull();
    await signOut(db, sessionToken);
    expect(await sessionViewer(db, sessionToken, NOW)).toBeNull();
  });

  it("marks Sevak staff listed in SEVAK_PLATFORM_ADMINS", async () => {
    const { code } = await requestSignIn(db, "staff@example.com", NOW);
    const { sessionToken } = await verifySignIn(db, { email: "staff@example.com", code }, NOW);
    expect((await sessionViewer(db, sessionToken, NOW))!.isPlatformAdmin).toBe(false);
    expect((await sessionViewer(db, sessionToken, NOW, ["staff@example.com"]))!.isPlatformAdmin).toBe(true);
  });
});
