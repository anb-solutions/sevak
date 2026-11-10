import { removeZeffyConnection, readZeffyConnection, saveZeffyConnection, seal, teamRole } from "@sevak/core";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { fromOurPages, json, readJson, refuse, tooMany, viewerFor } from "@/lib/http";
import { checkKey, secretsKey, ZeffyError } from "@/lib/zeffy";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const orgIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const forbidden = () => json({ error: "forbidden" }, 403);

// GET /api/v1/organizations/{id}/zeffy: whether the organization is
// connected to Zeffy (EVT-20). The organization's team only; never the key.
export async function GET(req: Request, ctx: Ctx) {
  const viewer = await viewerFor(req);
  if (!viewer) return refuse.signedOut();
  const id = orgIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return refuse.invalid();
  const db = await getDb();
  const role = await teamRole(db, viewer, id.data);
  if (!role) return forbidden();
  const conn = await readZeffyConnection(db, id.data);
  return json({
    available: !!secretsKey(),
    connected: !!conn,
    canConnect: role === "admin",
    ...(conn ? { last4: conn.last4, connectedBy: conn.connectedBy, connectedAt: conn.connectedAt } : {}),
  });
}

// PUT /api/v1/organizations/{id}/zeffy {apiKey}: connects it, after checking
// the key works. The organization's Admins only.
export async function PUT(req: Request, ctx: Ctx) {
  if (!fromOurPages(req)) return refuse.crossSite();
  const viewer = await viewerFor(req);
  if (!viewer) return refuse.signedOut();
  const id = orgIdSchema.safeParse((await ctx.params).id);
  const body = z.object({ apiKey: z.string().trim().min(8).max(2000) }).safeParse(await readJson(req, 4_000));
  if (!id.success || !body.success) return refuse.invalid();
  const db = await getDb();
  if ((await teamRole(db, viewer, id.data)) !== "admin") return forbidden();
  const secrets = secretsKey();
  if (!secrets) return json({ error: "not_set_up" }, 503);
  if (await tooMany(`user:zeffy-connect:${viewer.id}`, 10, 60 * 60_000)) return json({ error: "rate_limited" }, 429);
  try {
    await checkKey(body.data.apiKey);
  } catch (e) {
    if (e instanceof ZeffyError) return json({ error: e.reason === "bad_key" ? "bad_key" : "unavailable" }, e.reason === "bad_key" ? 400 : 502);
    throw e;
  }
  await saveZeffyConnection(db, viewer, id.data, seal(secrets, body.data.apiKey), body.data.apiKey.slice(-4));
  const conn = await readZeffyConnection(db, id.data);
  return json({ available: true, connected: true, canConnect: true, last4: conn!.last4, connectedBy: conn!.connectedBy, connectedAt: conn!.connectedAt });
}

// DELETE /api/v1/organizations/{id}/zeffy: forgets the key. Admins only.
export async function DELETE(req: Request, ctx: Ctx) {
  if (!fromOurPages(req)) return refuse.crossSite();
  const viewer = await viewerFor(req);
  if (!viewer) return refuse.signedOut();
  const id = orgIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return refuse.invalid();
  const db = await getDb();
  if ((await teamRole(db, viewer, id.data)) !== "admin") return forbidden();
  await removeZeffyConnection(db, id.data);
  return json({ available: !!secretsKey(), connected: false, canConnect: true });
}
