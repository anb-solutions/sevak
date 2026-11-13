// Helpers for the end-to-end tests: real browsers against the real app and
// a real PostgreSQL (see run.sh). Sign-in codes are read from the app's log,
// since tests run with EMAIL_MODE=log.
const fs = require("fs");
const { chromium } = require("playwright");

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const LOG = process.env.E2E_LOG || "";
// Unique per run, so tests never see each other's people or organizations.
const RUN = Date.now().toString(36);

// "staff" is Sevak staff: run.sh picks a new address each run (so the limit
// on sign-in emails per address never gets in the way) and lists it in the
// app's SEVAK_PLATFORM_ADMINS.
const STAFF_EMAIL = process.env.E2E_STAFF || "e2e-staff@example.com";

function email(name) {
  return name === "staff" ? STAFF_EMAIL : `${name}.${RUN}@example.com`;
}

function codeFor(address) {
  const parts = fs.readFileSync(LOG, "utf8").split("To: " + address);
  const m = parts.length > 1 && parts[parts.length - 1].match(/sign-in code is (\d{6})/);
  if (!m) throw new Error("No sign-in code in the log for " + address);
  return m[1];
}

// Subjects of the emails the app "sent" to an address (written to its log).
function mailsTo(address) {
  const log = fs.readFileSync(LOG, "utf8");
  const out = [];
  const re = new RegExp("To: " + address.replace(/[.+]/g, "\\$&") + "\\nSubject: ([^\\n]*)", "g");
  let m;
  while ((m = re.exec(log))) out.push(m[1]);
  return out;
}

// Starts a test: a browser, check() and done(), in the style of tests/*-test.js
// (prints "N ok", or FAIL lines and a non-zero exit).
async function start() {
  const browser = await chromium.launch();
  const fails = [];
  const errors = [];
  let ok = 0;
  const check = (cond, message) => (cond ? ok++ : fails.push(message));
  const done = async () => {
    await browser.close();
    for (const e of errors) fails.push("page error: " + e);
    if (fails.length) {
      for (const f of fails) console.log("FAIL " + f);
      process.exit(1);
    }
    console.log(ok + " ok");
  };
  return { browser, check, errors, done };
}

// Each test file signs in from its own address (in a range kept for
// documentation, RFC 5737), so the per-address sign-in limit (100 an hour)
// counts each file on its own, as it would different people on the real
// site, instead of the whole suite from one machine.
const ADDRESS = `203.0.113.${1 + Math.floor(Math.random() * 254)}`;

// A browser of one's own, 390px wide.
function context(t, options = {}) {
  return t.browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "X-Forwarded-For": ADDRESS }, ...options });
}

// A person in their own browser (390px wide), signed in by emailed code,
// with a profile saved.
async function person(t, name, { profile = true } = {}) {
  const ctx = await context(t);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => t.errors.push(name + ": " + e.message));
  const address = email(name);
  await signIn(page, address);
  if (profile) {
    if (!page.url().includes("profile.html")) await page.goto(BASE + "/app/profile.html");
    await page.fill("#firstName", name[0].toUpperCase() + name.slice(1));
    await page.fill("#lastName", "Test");
    await page.fill("#phone", "7135550100");
    await page.check("input[name=availability][value=anytime]", { force: true }).catch(() => {});
    // Saving leaves the form, and the next page says it's saved.
    await page.click("#save");
    await page.waitForURL((u) => !/profile\.html/.test(String(u)));
    await page.waitForSelector("#saved-flash");
  }
  page.address = address;
  return page;
}

async function signIn(page, address, { from = "/app/signin.html" } = {}) {
  if (from) await page.goto(BASE + from);
  await page.fill("#email", address);
  await page.click("#signin-submit");
  await page.waitForSelector("#code-form:not([hidden])");
  await page.waitForTimeout(200);
  await page.fill("#code", codeFor(address));
  await Promise.all([page.waitForNavigation(), page.click("#code-submit")]);
}

// What the server sends this page's person (GET /api/v1/sync).
async function synced(page) {
  const res = await page.request.get(BASE + "/api/v1/sync");
  return res.json();
}

// Sets up an organization as `admin` and returns its id and invite code.
async function organization(admin, fields = {}) {
  await admin.goto(BASE + "/app/organization.html");
  const id = await admin.evaluate((f) => window.SevakOrgs.save(Object.assign({ name: "Temple", team: [] }, f)).id, fields);
  await admin.goto(BASE + "/app/volunteers.html");
  const code = await admin.evaluate((orgId) => window.SevakMembers.inviteCode(orgId), id);
  return { id, code };
}

async function joinWithCode(page, code) {
  await page.goto(BASE + "/app/join.html?code=" + code);
  await page.click("#join-continue");
  await page.waitForSelector("#join-done:not([hidden])");
}

module.exports = { RUN, BASE, STAFF_EMAIL, mailsTo, email, codeFor, start, context, person, signIn, synced, organization, joinWithCode };
