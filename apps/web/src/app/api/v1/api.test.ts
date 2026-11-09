// The API routes end to end, on the in-memory database: sign-in, the
// session cookie, and who may save what.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as requestCode } from "./auth/request/route";
import { POST as signOutRoute } from "./auth/signout/route";
import { POST as verify } from "./auth/verify/route";
import { POST as save } from "./sync/[key]/route";
import { POST as joinRoute } from "./memberships/join/route";
import { GET as byCode } from "./organizations/by-code/[code]/route";
import { GET as getFile, PUT as putFile } from "./files/[id]/route";
import { GET as load } from "./sync/route";

const BASE = "http://localhost:3000";
const logged: string[] = [];

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void logged.push(args.join(" ")));
});
afterAll(() => vi.restoreAllMocks());

function req(path: string, opts: { method?: string; body?: unknown; cookie?: string; site?: string } = {}) {
  const headers: Record<string, string> = { "sec-fetch-site": opts.site ?? "same-origin", "content-type": "application/json" };
  if (opts.cookie) headers.cookie = opts.cookie;
  return new Request(BASE + path, { method: opts.method ?? "POST", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

const params = (key: string) => ({ params: Promise.resolve({ key }) });

async function signIn(email: string): Promise<string> {
  expect((await requestCode(req("/api/v1/auth/request", { body: { email } }))).status).toBe(200);
  const mail = logged.filter((l) => l.includes(`To: ${email}`)).pop()!;
  const code = mail.match(/sign-in code is (\d{6})/)![1]!;
  const res = await verify(req("/api/v1/auth/verify", { body: { email, code } }));
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie")!;
  expect(cookie).toMatch(/^__Host-sevak_session=.+; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/);
  return cookie.split(";")[0]!;
}

const ORGS = "sevak.organizations.v1";
const PROFILE = "sevak.profile.v1";
const temple = { id: "org-temple", name: "Temple Volunteers", inviteCode: "SEVA42", team: [] };

describe("API", () => {
  let asha: string;
  let mei: string;

  it("signs in with the emailed code, and the email's link points at this site", async () => {
    asha = await signIn("asha@example.com");
    mei = await signIn("mei@example.com");
    expect(logged.join("\n")).toContain(`${BASE}/app/signin.html#token=`);
    const me = await (await load(req("/api/v1/sync", { method: "GET", cookie: asha }))).json();
    expect(me.user).toEqual({ email: "asha@example.com", isPlatformAdmin: false });
  });

  it("refuses a wrong code", async () => {
    await requestCode(req("/api/v1/auth/request", { body: { email: "ravi@example.com" } }));
    const res = await verify(req("/api/v1/auth/verify", { body: { email: "ravi@example.com", code: "12345x" } }));
    expect(res.status).toBe(400);
  });

  it("refuses requests from other sites", async () => {
    expect((await requestCode(req("/api/v1/auth/request", { body: { email: "a@example.com" }, site: "cross-site" }))).status).toBe(403);
    expect((await save(req(`/api/v1/sync/${ORGS}`, { body: { upsert: [temple] }, cookie: asha, site: "cross-site" }), params(ORGS))).status).toBe(403);
  });

  it("refuses saving when signed out", async () => {
    expect((await save(req(`/api/v1/sync/${ORGS}`, { body: { upsert: [temple] } }), params(ORGS))).status).toBe(401);
    expect((await save(req(`/api/v1/sync/${PROFILE}`, { body: { value: { firstName: "X" } } }), params(PROFILE))).status).toBe(401);
  });

  it("saves your profile for you only", async () => {
    const res = await save(req(`/api/v1/sync/${PROFILE}`, { body: { value: { firstName: "Asha", email: "x@example.com" } }, cookie: asha }), params(PROFILE));
    expect((await res.json()).value).toEqual({ firstName: "Asha", email: "asha@example.com" });
    const other = await (await load(req("/api/v1/sync", { method: "GET", cookie: mei }))).json();
    expect(other.data[PROFILE]).toBeNull();
  });

  it("lets you set up an organization, and refuses changes from people not on its team", async () => {
    const created = await save(req(`/api/v1/sync/${ORGS}`, { body: { upsert: [temple] }, cookie: asha }), params(ORGS));
    expect(created.status).toBe(200);

    const seen = await (await load(req("/api/v1/sync", { method: "GET", cookie: mei }))).json();
    expect(JSON.stringify(seen.data[ORGS])).not.toContain("SEVA42");

    const takeover = await save(req(`/api/v1/sync/${ORGS}`, { body: { upsert: [{ ...temple, name: "Mine now" }], delete: [] }, cookie: mei }), params(ORGS));
    expect(takeover.status).toBe(403);
    expect((await takeover.json()).value[0].name).toBe("Temple Volunteers");
    const removal = await save(req(`/api/v1/sync/${ORGS}`, { body: { delete: ["org-temple"] }, cookie: mei }), params(ORGS));
    expect(removal.status).toBe(403);
  });

  it("lets people join with an invite code, and keeps the code itself private", async () => {
    await save(req(`/api/v1/sync/${ORGS}`, { body: { upsert: [{ id: "org-pantry", name: "Pantry", inviteCode: "PANTRY", team: [] }] }, cookie: asha }), params(ORGS));
    const found = await byCode(req("/api/v1/organizations/by-code/pantry", { method: "GET" }), { params: Promise.resolve({ code: "pantry" }) });
    expect(found.status).toBe(200);
    const text = JSON.stringify(await found.json());
    expect(text).toContain("Pantry");
    expect(text).not.toContain("PANTRY");
    expect((await byCode(req("/api/v1/organizations/by-code/NOPE", { method: "GET" }), { params: Promise.resolve({ code: "NOPE" }) })).status).toBe(404);

    expect((await joinRoute(req("/api/v1/memberships/join", { body: { code: "PANTRY" } }))).status).toBe(401);
    expect((await joinRoute(req("/api/v1/memberships/join", { body: { code: "PANTRY" }, cookie: mei, site: "cross-site" }))).status).toBe(403);
    const joined = await joinRoute(req("/api/v1/memberships/join", { body: { code: "PANTRY" }, cookie: mei }));
    expect(joined.status).toBe(200);
    expect((await joined.json()).value).toMatchObject([{ orgId: "org-pantry", status: "active" }]);
  });

  it("refuses membership changes from people outside the organization", async () => {
    const MEM = "sevak.memberships.v1";
    const asked = await save(req(`/api/v1/sync/${MEM}`, { body: { upsert: [{ id: "mem-q", orgId: "org-temple", email: "mei@example.com", status: "requested" }] }, cookie: mei }), params(MEM));
    expect(asked.status).toBe(200);
    const selfApprove = await save(req(`/api/v1/sync/${MEM}`, { body: { upsert: [{ id: "mem-q", orgId: "org-temple", email: "mei@example.com", status: "active" }] }, cookie: mei }), params(MEM));
    expect(selfApprove.status).toBe(403);
    expect((await selfApprove.json()).value.find((m: { id: string }) => m.id === "mem-q").status).toBe("requested");
  });

  it("refuses event changes from people not on the organization's team", async () => {
    const EV = "sevak.events.v1";
    const ev = { id: "ev-1", organizationId: "org-temple", title: "Seva day", status: "published", visibility: "public" };
    expect((await save(req(`/api/v1/sync/${EV}`, { body: { upsert: [ev] }, cookie: asha }), params(EV))).status).toBe(200);
    const takeover = await save(req(`/api/v1/sync/${EV}`, { body: { upsert: [{ ...ev, title: "Mine" }], delete: [] }, cookie: mei }), params(EV));
    expect(takeover.status).toBe(403);
    expect((await save(req(`/api/v1/sync/${EV}`, { body: { delete: ["ev-1"] }, cookie: mei }), params(EV))).status).toBe(403);
    expect((await save(req(`/api/v1/sync/${EV}`, { body: { upsert: [ev] } }), params(EV))).status).toBe(401);
  });

  it("uploads files only for your own documents, of accepted kinds, and serves them as downloads", async () => {
    const DOCS = "sevak.documents.v1";
    const fileReq = (id: string, body: BodyInit | null, opts: { cookie?: string; site?: string; method?: string } = {}) => {
      const headers: Record<string, string> = { "sec-fetch-site": opts.site ?? "same-origin" };
      if (opts.cookie) headers.cookie = opts.cookie;
      return new Request(`${BASE}/api/v1/files/${id}`, { method: opts.method ?? "PUT", headers, body });
    };
    const fileParams = (id: string) => ({ params: Promise.resolve({ id }) });
    await save(req(`/api/v1/sync/${DOCS}`, { body: { upsert: [{ id: "doc-mei", owner: "profile:mei@example.com", name: "ID", fileName: "id.pdf" }] }, cookie: mei }), params(DOCS));

    const pdf = new TextEncoder().encode("%PDF-1.4 test");
    expect((await putFile(fileReq("doc-mei", pdf), fileParams("doc-mei"))).status).toBe(401);
    expect((await putFile(fileReq("doc-mei", pdf, { cookie: mei, site: "cross-site" }), fileParams("doc-mei"))).status).toBe(403);
    expect((await putFile(fileReq("doc-mei", pdf, { cookie: asha }), fileParams("doc-mei"))).status).toBe(404);
    expect((await putFile(fileReq("doc-mei", new TextEncoder().encode("<html><script>x</script>"), { cookie: mei }), fileParams("doc-mei"))).status).toBe(415);
    expect((await putFile(fileReq("doc-mei", pdf, { cookie: mei }), fileParams("doc-mei"))).status).toBe(200);

    const got = await getFile(fileReq("doc-mei", null, { cookie: mei, method: "GET" }), fileParams("doc-mei"));
    expect(got.status).toBe(200);
    expect(got.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(got.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new TextDecoder().decode(await got.arrayBuffer())).toBe("%PDF-1.4 test");
    expect((await getFile(fileReq("doc-mei", null, { cookie: asha, method: "GET" }), fileParams("doc-mei"))).status).toBe(404);
  });

  it("refuses data it doesn't know and bodies that aren't JSON", async () => {
    expect((await save(req("/api/v1/sync/sevak.other.v1", { body: { value: 1 }, cookie: asha }), params("sevak.other.v1"))).status).toBe(404);
    expect((await save(req(`/api/v1/sync/${PROFILE}`, { body: {}, cookie: asha }), params(PROFILE))).status).toBe(400);
    expect((await save(req(`/api/v1/sync/${ORGS}`, { body: { upsert: "nope" }, cookie: asha }), params(ORGS))).status).toBe(400);
  });

  it("signs out", async () => {
    const res = await signOutRoute(req("/api/v1/auth/signout", { body: {}, cookie: asha }));
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    const after = await (await load(req("/api/v1/sync", { method: "GET", cookie: asha }))).json();
    expect(after.user).toBeNull();
  });
});
