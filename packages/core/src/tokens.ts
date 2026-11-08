// Random tokens for links and sessions. Only their SHA-256 hash is stored,
// so a database leak doesn't reveal working links (NFR-6).
import { createHash, randomBytes, randomInt } from "node:crypto";

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
