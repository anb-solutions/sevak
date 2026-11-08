import { readSynced } from "@sevak/core";
import { getDb } from "@/lib/db";
import { googleEnabled } from "@/lib/google";
import { json, viewerFor } from "@/lib/http";

export const dynamic = "force-dynamic";

// GET /api/v1/sync: who you are, and the saved data each page starts from
// (see packages/core/src/records.ts and app/sync.js).
export async function GET(req: Request) {
  const viewer = await viewerFor(req);
  const data = await readSynced(await getDb(), viewer);
  return json({
    user: viewer ? { email: viewer.email, isPlatformAdmin: viewer.isPlatformAdmin } : null,
    signIn: { google: googleEnabled() },
    data,
  });
}
