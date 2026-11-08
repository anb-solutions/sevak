// "Continue with Google" end to end, with Google's token endpoint faked.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as load } from "../../sync/route";
import { GET as callback } from "./callback/route";
import { GET as start } from "./start/route";

const BASE = "http://localhost:3000";
const CLIENT = "client-123.apps.googleusercontent.com";
const realFetch = globalThis.fetch;
let tokenClaims: Record<string, unknown> = {};

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = CLIENT;
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    if (String(url) !== "https://oauth2.googleapis.com/token") return realFetch(url, init);
    const body = new URLSearchParams(String(init?.body));
    if (body.get("code") !== "good-code") return new Response("{}", { status: 400 });
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const claims = { iss: "https://accounts.google.com", aud: CLIENT, exp: Date.now() / 1000 + 300, email_verified: true, ...tokenClaims };
    return new Response(JSON.stringify({ id_token: `${enc({})}.${enc(claims)}.sig` }));
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

async function begin(next = "") {
  const res = await start(new Request(`${BASE}/api/v1/auth/google/start${next ? `?next=${next}` : ""}`));
  expect(res.status).toBe(303);
  const google = new URL(res.headers.get("location")!);
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  return { google, cookie, state: google.searchParams.get("state")!, nonce: google.searchParams.get("nonce")! };
}

function back(cookie: string, query: string) {
  return callback(new Request(`${BASE}/api/v1/auth/google/callback?${query}`, { headers: { cookie } }));
}

describe("Continue with Google", () => {
  it("is offered on the sign-in page when it's set up", async () => {
    const data = await (await load(new Request(`${BASE}/api/v1/sync`))).json();
    expect(data.signIn).toEqual({ google: true });
  });

  it("sends the browser to Google and remembers the start in a secure cookie", async () => {
    const { google, cookie } = await begin("event.html");
    expect(google.origin).toBe("https://accounts.google.com");
    expect(google.searchParams.get("redirect_uri")).toBe(`${BASE}/api/v1/auth/google/callback`);
    expect(cookie).toMatch(/^__Host-sevak_google=/);
  });

  it("signs in a Gmail account and opens the profile the first time", async () => {
    const { cookie, state, nonce } = await begin();
    tokenClaims = { email: "asha@gmail.com", nonce };
    const res = await back(cookie, `code=good-code&state=${state}`);
    expect(res.headers.get("location")).toBe(`${BASE}/app/profile.html`);
    const cookies = res.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith("__Host-sevak_session="))!;
    expect(session).toContain("HttpOnly; Secure; SameSite=Lax");
    const me = await (await load(new Request(`${BASE}/api/v1/sync`, { headers: { cookie: session.split(";")[0]! } }))).json();
    expect(me.user.email).toBe("asha@gmail.com");
    expect(cookies.some((c) => c.startsWith("__Host-sevak_google=;"))).toBe(true);
  });

  it("goes back to the page you came from", async () => {
    const { cookie, state, nonce } = await begin("event.html");
    tokenClaims = { email: "asha@gmail.com", nonce };
    expect((await back(cookie, `code=good-code&state=${state}`)).headers.get("location")).toBe(`${BASE}/app/event.html`);
  });

  it("refuses a return that doesn't match the start (forged state, no cookie, bad code)", async () => {
    const { cookie, state, nonce } = await begin();
    tokenClaims = { email: "asha@gmail.com", nonce };
    for (const res of [await back(cookie, "code=good-code&state=forged"), await back("", `code=good-code&state=${state}`), await back(cookie, `code=bad&state=${state}`)]) {
      expect(res.headers.get("location")).toBe(`${BASE}/app/signin.html?error=google_failed`);
      expect(res.headers.getSetCookie().some((c) => c.startsWith("__Host-sevak_session="))).toBe(false);
    }
  });

  it("refuses an ID token from another sign-in (nonce)", async () => {
    const { cookie, state } = await begin();
    tokenClaims = { email: "asha@gmail.com", nonce: "someone-elses" };
    expect((await back(cookie, `code=good-code&state=${state}`)).headers.get("location")).toContain("error=google_failed");
  });

  it("sends Google accounts on other email providers to the email code", async () => {
    const { cookie, state, nonce } = await begin();
    tokenClaims = { email: "asha@yahoo.com", nonce };
    expect((await back(cookie, `code=good-code&state=${state}`)).headers.get("location")).toContain("error=google_use_email");
  });

  it("handles the person cancelling on Google's screen", async () => {
    const { cookie } = await begin();
    expect((await back(cookie, "error=access_denied")).headers.get("location")).toContain("error=google_cancelled");
  });
});
