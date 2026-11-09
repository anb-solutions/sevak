// Where uploaded files are kept. Only the API routes use this, after
// checking the person may see or change the document (@sevak/core
// documents.ts); files are never public.
//
//   SEVAK_FILES_BUCKET  a private Cloud Storage bucket (Google Cloud). The app
//                       signs in as its own service account through the
//                       metadata server: no keys.
//   SEVAK_FILES_DIR     a folder (end-to-end tests)
//   neither             memory, for local development only; production
//                       refuses, and documents say they're not set up
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface FileStore {
  put(id: string, bytes: Uint8Array, type: string): Promise<void>;
  get(id: string): Promise<Uint8Array | null>;
  remove(id: string): Promise<void>;
}

const safeId = (id: string) => {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error("bad file id");
  return id;
};

// ---------- Cloud Storage ----------

let token: { value: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const res = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
    headers: { "Metadata-Flavor": "Google" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`metadata server answered ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return token.value;
}

function bucketStore(bucket: string): FileStore {
  const object = (id: string) => encodeURIComponent(`documents/${safeId(id)}`);
  const api = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`;
  const auth = async () => ({ Authorization: `Bearer ${await accessToken()}` });
  return {
    async put(id, bytes, type) {
      const res = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${object(id)}`, {
        method: "POST",
        headers: { ...(await auth()), "Content-Type": type },
        body: Buffer.from(bytes),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`storage upload answered ${res.status}`);
    },
    async get(id) {
      const res = await fetch(`${api}/${object(id)}?alt=media`, { headers: await auth(), signal: AbortSignal.timeout(30_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`storage download answered ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async remove(id) {
      const res = await fetch(`${api}/${object(id)}`, { method: "DELETE", headers: await auth(), signal: AbortSignal.timeout(10_000) });
      if (!res.ok && res.status !== 404) throw new Error(`storage delete answered ${res.status}`);
    },
  };
}

// ---------- A folder, or memory ----------

function dirStore(dir: string): FileStore {
  const path = (id: string) => join(dir, safeId(id));
  return {
    async put(id, bytes) {
      await mkdir(dir, { recursive: true });
      await writeFile(path(id), bytes);
    },
    async get(id) {
      try {
        return new Uint8Array(await readFile(path(id)));
      } catch {
        return null;
      }
    },
    async remove(id) {
      await rm(path(id), { force: true });
    },
  };
}

function memoryStore(): FileStore {
  const files = new Map<string, Uint8Array>();
  return {
    async put(id, bytes) {
      files.set(safeId(id), bytes);
    },
    async get(id) {
      return files.get(safeId(id)) ?? null;
    },
    async remove(id) {
      files.delete(safeId(id));
    },
  };
}

const globalForFiles = globalThis as unknown as { sevakFiles?: FileStore | null };

// The store, or null when documents aren't set up (production without a bucket).
export function fileStore(): FileStore | null {
  if (globalForFiles.sevakFiles !== undefined) return globalForFiles.sevakFiles;
  const bucket = process.env.SEVAK_FILES_BUCKET?.trim();
  const dir = process.env.SEVAK_FILES_DIR?.trim();
  globalForFiles.sevakFiles = bucket
    ? bucketStore(bucket)
    : dir
      ? dirStore(dir)
      : process.env.NODE_ENV === "production"
        ? null
        : memoryStore();
  return globalForFiles.sevakFiles;
}
