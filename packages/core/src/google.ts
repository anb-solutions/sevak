// "Continue with Google" (VOL-1): standard OpenID Connect with the
// authorization code flow and PKCE. The browser goes to Google, Google sends
// it back with a one-time code, and the server swaps the code for the
// person's verified email directly with Google, so nothing the browser says
// is trusted. The person then gets the same account and session as with an
// emailed code (startSession), matched by email.
import { createHash } from "node:crypto";
import { z } from "zod";
import { newToken } from "./tokens";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// What the browser keeps (in a short-lived cookie) between leaving for
// Google and coming back: random values that tie the return to this start.
export interface GoogleStart {
  state: string;
  nonce: string;
  verifier: string;
}

export function startGoogleSignIn(config: Pick<GoogleConfig, "clientId" | "redirectUri">): { url: string; start: GoogleStart } {
  const start = { state: newToken(), nonce: newToken(), verifier: newToken() };
  const challenge = createHash("sha256").update(start.verifier).digest("base64url");
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email",
    state: start.state,
    nonce: start.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), start };
}

const claimsSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  exp: z.number(),
  nonce: z.string().optional(),
  email: z.string().optional(),
  email_verified: z.boolean().optional(),
  hd: z.string().optional(), // the Google Workspace domain, when there is one
});

export class GoogleSignInError extends Error {
  constructor(public reason: "invalid" | "email_not_verified" | "use_email_code") {
    super(reason);
  }
}

// Checks the ID token Google returned and gives back the email it proves.
// The token came straight from Google's token endpoint over HTTPS, so its
// signature doesn't need checking (OpenID Connect Core §3.1.3.7); the
// claims still do. Following Google's advice, the email counts as the
// person's identity only for Gmail addresses and Google Workspace accounts
// (which have `hd`). Other Google accounts sign in with an emailed code.
export function emailFromIdToken(idToken: string, expect: { clientId: string; nonce: string; now?: Date }): string {
  const part = idToken.split(".")[1];
  if (!part) throw new GoogleSignInError("invalid");
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw new GoogleSignInError("invalid");
  }
  const parsed = claimsSchema.safeParse(raw);
  if (!parsed.success) throw new GoogleSignInError("invalid");
  const c = parsed.data;
  const now = (expect.now ?? new Date()).getTime() / 1000;
  if (!ISSUERS.includes(c.iss) || c.aud !== expect.clientId || c.exp < now || c.nonce !== expect.nonce) {
    throw new GoogleSignInError("invalid");
  }
  if (!c.email || c.email_verified !== true) throw new GoogleSignInError("email_not_verified");
  const email = c.email.trim().toLowerCase();
  const domain = email.split("@")[1] ?? "";
  const gmail = domain === "gmail.com" || domain === "googlemail.com";
  const workspace = !!c.hd && domain === c.hd.toLowerCase();
  if (!gmail && !workspace) throw new GoogleSignInError("use_email_code");
  return email;
}

// Swaps the one-time code from Google's redirect for the person's email.
export async function finishGoogleSignIn(
  config: GoogleConfig,
  start: GoogleStart,
  returned: { code: string; state: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!returned.code || returned.state !== start.state) throw new GoogleSignInError("invalid");
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: returned.code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: start.verifier,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new GoogleSignInError("invalid");
  const body = (await res.json()) as { id_token?: unknown };
  if (typeof body.id_token !== "string") throw new GoogleSignInError("invalid");
  return emailFromIdToken(body.id_token, { clientId: config.clientId, nonce: start.nonce });
}
