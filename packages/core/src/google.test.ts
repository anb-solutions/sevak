import { describe, expect, it, vi } from "vitest";
import { emailFromIdToken, finishGoogleSignIn, GoogleSignInError, startGoogleSignIn } from "./google";

const CLIENT = "client-123.apps.googleusercontent.com";
const NOW = new Date("2026-11-08T12:00:00Z");
const config = { clientId: CLIENT, clientSecret: "test-secret", redirectUri: "https://staging.example.org/api/v1/auth/google/callback" };

function idToken(claims: Record<string, unknown>) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "RS256" })}.${enc({
    iss: "https://accounts.google.com",
    aud: CLIENT,
    exp: NOW.getTime() / 1000 + 300,
    nonce: "n1",
    email: "asha@gmail.com",
    email_verified: true,
    ...claims,
  })}.sig`;
}

const check = (claims: Record<string, unknown>) => () => emailFromIdToken(idToken(claims), { clientId: CLIENT, nonce: "n1", now: NOW });
const reason = (claims: Record<string, unknown>) => {
  try {
    check(claims)();
    return "ok";
  } catch (e) {
    return (e as GoogleSignInError).reason;
  }
};

describe("Google sign-in", () => {
  it("sends the browser to Google with PKCE, a state and a nonce", () => {
    const { url, start } = startGoogleSignIn(config);
    const q = new URL(url).searchParams;
    expect(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);
    expect(q.get("client_id")).toBe(CLIENT);
    expect(q.get("redirect_uri")).toBe(config.redirectUri);
    expect(q.get("scope")).toBe("openid email");
    expect(q.get("state")).toBe(start.state);
    expect(q.get("nonce")).toBe(start.nonce);
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).not.toBe(start.verifier);
  });

  it("accepts a verified Gmail address and a Google Workspace account", () => {
    expect(check({ email: "Asha@Gmail.com" })()).toBe("asha@gmail.com");
    expect(check({ email: "asha@temple.org", hd: "temple.org" })()).toBe("asha@temple.org");
  });

  it("refuses tokens for another app, from elsewhere, expired, or from another sign-in", () => {
    expect(reason({ aud: "someone-else" })).toBe("invalid");
    expect(reason({ iss: "https://evil.example" })).toBe("invalid");
    expect(reason({ exp: NOW.getTime() / 1000 - 1 })).toBe("invalid");
    expect(reason({ nonce: "other" })).toBe("invalid");
    expect(() => emailFromIdToken("not-a-token", { clientId: CLIENT, nonce: "n1", now: NOW })).toThrow(GoogleSignInError);
  });

  it("refuses unverified emails, and sends other Google accounts to the email code", () => {
    expect(reason({ email_verified: false })).toBe("email_not_verified");
    expect(reason({ email: undefined })).toBe("email_not_verified");
    expect(reason({ email: "asha@yahoo.com" })).toBe("use_email_code");
    expect(reason({ email: "asha@temple.org", hd: "other.org" })).toBe("use_email_code");
  });

  it("swaps the code for the email with Google, checking the state first", async () => {
    const start = { state: "s1", nonce: "n1", verifier: "v1" };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id_token: idToken({ exp: Date.now() / 1000 + 300 }) })));
    expect(await finishGoogleSignIn(config, start, { code: "c1", state: "s1" }, fetchImpl as typeof fetch)).toBe("asha@gmail.com");
    const body = new URLSearchParams(String((fetchImpl.mock.calls[0] as unknown[])[1] && ((fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(body.get("code_verifier")).toBe("v1");
    expect(body.get("code")).toBe("c1");

    fetchImpl.mockClear();
    await expect(finishGoogleSignIn(config, start, { code: "c1", state: "forged" }, fetchImpl as typeof fetch)).rejects.toThrow(GoogleSignInError);
    expect(fetchImpl).not.toHaveBeenCalled();

    const failing = vi.fn(async () => new Response("{}", { status: 400 }));
    await expect(finishGoogleSignIn(config, start, { code: "c1", state: "s1" }, failing as typeof fetch)).rejects.toThrow(GoogleSignInError);
  });
});
