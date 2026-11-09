import { beforeEach, describe, expect, it } from "vitest";
import { type Db, users } from "@sevak/db";
import { createMemoryDb } from "@sevak/db/memory";
import type { Viewer } from "./auth";
import { acceptUpload, documentFor, MAX_FILE_BYTES, ORG_QUOTA_BYTES, readDocuments, sniffType, UNVERIFIED_ORG_QUOTA_BYTES, UploadRefused, writeDocuments } from "./documents";
import { writeCertificates } from "./certificates";
import { writeEvents } from "./events";
import { readOrganizations, writeOrganizations } from "./records";

let db: Db;
let asha: Viewer; // Admin
let ravi: Viewer; // Coordinator
let mei: Viewer; // volunteer
let sam: Viewer;
let staff: Viewer;

async function person(email: string, isPlatformAdmin = false): Promise<Viewer> {
  const [u] = await db.insert(users).values({ email }).returning();
  return { id: u!.id, email, isPlatformAdmin };
}

const enc = (s: string) => new TextEncoder().encode(s);
const pdf = enc("%PDF-1.4\n...");
const doc = (id: string, owner: string, extra: Record<string, unknown> = {}) => ({ id, owner, name: id, fileName: id + ".pdf", ...extra });
const reason = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof UploadRefused ? e.reason : String(e);
  }
};

beforeEach(async () => {
  db = await createMemoryDb();
  asha = await person("asha@example.com");
  ravi = await person("ravi@example.com");
  mei = await person("mei@example.com");
  sam = await person("sam@example.com");
  staff = await person("staff@example.com", true);
  await writeOrganizations(db, asha, { upsert: [{ id: "org-temple", name: "Temple", team: [{ email: "ravi@example.com", role: "coordinator" }] }] });
  await writeEvents(db, asha, { upsert: [{ id: "ev-1", organizationId: "org-temple", title: "Seva", status: "draft", roles: [] }] });
});

describe("who sees and changes documents", () => {
  it("keeps your own documents to yourself", async () => {
    expect((await writeDocuments(db, mei, { upsert: [doc("d-mine", "profile:mei@example.com")] })).refused).toBe(0);
    expect((await writeDocuments(db, sam, { upsert: [doc("d-x", "profile:mei@example.com")] })).refused).toBe(1);
    expect((await readDocuments(db, mei)).map((d) => d.id)).toEqual(["d-mine"]);
    expect(await readDocuments(db, asha)).toEqual([]);
    expect(await documentFor(db, sam, "d-mine")).toBeNull();
  });

  it("shares an organization's and its events' documents with its team only", async () => {
    expect((await writeDocuments(db, ravi, { upsert: [doc("d-org", "org:org-temple"), doc("d-ev", "event:ev-1")] })).refused).toBe(0);
    expect((await readDocuments(db, asha)).map((d) => d.id).sort()).toEqual(["d-ev", "d-org"]);
    expect(await readDocuments(db, mei)).toEqual([]);
    expect((await writeDocuments(db, mei, { upsert: [doc("d-org", "org:org-temple", { name: "Taken" })], delete: ["d-ev"] })).refused).toBe(2);
  });

  it("lets an Admin add a certificate they issued to a volunteer's documents, and nothing else", async () => {
    const cert = (id: string) => doc(id, "profile:mei@example.com", { name: "Certificate · Temple", source: "certificate", orgId: "org-temple" });
    // Only once Mei has asked the organization for one.
    expect((await writeDocuments(db, asha, { upsert: [cert("d-early")] })).refused).toBe(1);
    await writeCertificates(db, mei, { upsert: [{ id: "c-1", orgId: "org-temple", name: "Mei", from: "2030-01-01", to: "2030-01-31", status: "requested" }] });
    expect((await writeDocuments(db, asha, { upsert: [cert("d-cert")] })).refused).toBe(0);
    expect((await readDocuments(db, mei)).map((d) => d.id)).toEqual(["d-cert"]);
    expect((await writeDocuments(db, asha, { upsert: [doc("d-plain", "profile:mei@example.com")] })).refused).toBe(1);
    expect((await writeDocuments(db, ravi, { upsert: [cert("d-cert2")] })).refused).toBe(1);
  });

  it("keeps what the server stored, whatever the page sends", async () => {
    await writeDocuments(db, mei, { upsert: [doc("d-1", "profile:mei@example.com")] });
    await acceptUpload(db, mei, "d-1", pdf);
    await writeDocuments(db, mei, { upsert: [doc("d-1", "profile:mei@example.com", { storedType: "text/html", storedBytes: 1 })] });
    expect((await readDocuments(db, mei))[0]).toMatchObject({ storedType: "application/pdf", storedBytes: pdf.length });
  });
});

describe("uploads", () => {
  beforeEach(async () => {
    await writeDocuments(db, mei, { upsert: [doc("d-1", "profile:mei@example.com")] });
  });

  it("only for documents you may change", async () => {
    expect(await reason(acceptUpload(db, sam, "d-1", pdf))).toBe("not_found");
    expect(await reason(acceptUpload(db, mei, "d-nope", pdf))).toBe("not_found");
    expect(await reason(acceptUpload(db, mei, "d-1", pdf))).toBe("ok");
  });

  it("up to 10 MB, and not empty", async () => {
    expect(await reason(acceptUpload(db, mei, "d-1", new Uint8Array(0)))).toBe("empty");
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set(pdf);
    expect(await reason(acceptUpload(db, mei, "d-1", big))).toBe("too_large");
  });

  it("within the space left for an organization", async () => {
    const docs = Array.from({ length: 51 }, (_, i) => doc(`d-org-${i}`, i % 2 ? "org:org-temple" : "event:ev-1"));
    await writeDocuments(db, asha, { upsert: docs.slice(0, 40) });
    await writeDocuments(db, asha, { upsert: docs.slice(40) });
    const nearly = new Uint8Array(MAX_FILE_BYTES);
    nearly.set(pdf);
    // Until Sevak verifies the organization, it has less room.
    let stored = 0;
    while ((await reason(acceptUpload(db, asha, `d-org-${stored}`, nearly))) === "ok") stored++;
    expect(stored).toBe(UNVERIFIED_ORG_QUOTA_BYTES / MAX_FILE_BYTES);
    const [org] = await readOrganizations(db, asha);
    await writeOrganizations(db, staff, { upsert: [{ ...org, verificationStatus: "verified" }] });
    while ((await reason(acceptUpload(db, asha, `d-org-${stored}`, nearly))) === "ok") stored++;
    expect(stored).toBe(ORG_QUOTA_BYTES / MAX_FILE_BYTES);
  });
});

describe("what kinds of files", () => {
  it("accepts PDFs, pictures, Office files and plain text", () => {
    expect(sniffType(pdf)).toBe("application/pdf");
    expect(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    const docx = new Uint8Array(64);
    docx.set([0x50, 0x4b, 0x03, 0x04]);
    docx.set([19, 0], 26);
    docx.set(enc("[Content_Types].xml"), 30);
    expect(sniffType(docx)).toBe("application/vnd.openxmlformats");
    expect(sniffType(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe("application/x-ole-storage");
    expect(sniffType(enc("Name,Hours\nMei,2\n"))).toBe("text/plain");
  });

  it("refuses web pages, scripts, programs and other zips, whatever they're called", () => {
    expect(sniffType(enc("<!DOCTYPE html><script>alert(1)</script>"))).toBeNull();
    expect(sniffType(enc("  <svg onload=alert(1)>"))).toBeNull();
    expect(sniffType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]))).toBeNull(); // Windows program
    const zip = new Uint8Array(64);
    zip.set([0x50, 0x4b, 0x03, 0x04]);
    zip.set([8, 0], 26);
    zip.set(enc("evil.exe"), 30);
    expect(sniffType(zip)).toBeNull();
  });
});
