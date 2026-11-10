import { acceptUpload, documentFor, MAX_FILE_BYTES, UploadRefused } from "@sevak/core";
import { getDb } from "@/lib/db";
import { fileStore } from "@/lib/files";
import { fromOurPages, json, refuse, viewerFor } from "@/lib/http";

export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{1,80}$/;

// PUT /api/v1/files/{documentId}: uploads the file for a document whose
// details are already saved. Checks who's asking, the size (10 MB), the
// space left (per person and per organization) and what the file really is.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!fromOurPages(req)) return refuse.crossSite();
  const viewer = await viewerFor(req);
  if (!viewer) return refuse.signedOut();
  const store = fileStore();
  if (!store) return json({ error: "documents_off" }, 503);
  const { id } = await ctx.params;
  if (!ID.test(id)) return refuse.invalid();
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FILE_BYTES) return json({ error: "too_large" }, 413);
  const bytes = new Uint8Array(await req.arrayBuffer());
  try {
    const { type, doc } = await acceptUpload(await getDb(), viewer, id, bytes);
    await store.put(id, bytes, type);
    return json({ ok: true, doc });
  } catch (e) {
    if (e instanceof UploadRefused) {
      const status = { not_found: 404, too_large: 413, empty: 400, type: 415, quota: 507 }[e.reason];
      return json({ error: e.reason }, status);
    }
    throw e;
  }
}

// GET /api/v1/files/{documentId}: the file, for people who may see its
// document. Always as a download, never shown as a web page.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await viewerFor(req);
  if (!viewer) return refuse.signedOut();
  const store = fileStore();
  if (!store) return json({ error: "documents_off" }, 503);
  const { id } = await ctx.params;
  if (!ID.test(id)) return refuse.invalid();
  const doc = await documentFor(await getDb(), viewer, id);
  const bytes = doc && doc.storedType ? await store.get(id) : null;
  if (!doc || !bytes) return json({ error: "not_found" }, 404);
  const type = String(doc.storedType);
  const name = String(doc.fileName ?? "document").replace(/[^\w .()-]+/g, "_").slice(0, 120) || "document";
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": type === "text/plain" ? "text/plain; charset=utf-8" : type.startsWith("image/") || type === "application/pdf" ? type : "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
