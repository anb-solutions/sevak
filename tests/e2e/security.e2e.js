// Protections around the pages themselves: sign-in before the Manage and
// staff pages, nothing left behind on a shared device, no inline scripts,
// no demo data on the real app.
const { BASE, start, person, signIn, email } = require("./helpers");

(async () => {
  const t = await start();
  const { check } = t;

  // Signed out: Manage and staff pages send you to sign in, then back.
  const ctx = await t.browser.newContext({ viewport: { width: 390, height: 844 } });
  const visitor = await ctx.newPage();
  for (const pg of ["events.html", "volunteers.html", "dashboard.html", "organization.html", "review.html", "outbox.html", "roster.html"]) {
    await visitor.goto(BASE + "/app/" + pg);
    await visitor.waitForURL(/signin\.html/);
    check(visitor.url().endsWith("signin.html?next=" + pg), "signed out: " + pg + " asks you to sign in");
  }

  // A shared device: Asha's things are cleared when she signs out...
  const shared = await t.browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await shared.newPage();
  p.on("pageerror", (e) => t.errors.push(e.message));
  await signIn(p, email("asha"));
  await p.goto(BASE + "/app/profile.html");
  await p.fill("#firstName", "Asha"); await p.fill("#lastName", "Test"); await p.fill("#phone", "7135550100");
  await p.check("input[name=availability][value=anytime]", { force: true }).catch(() => {});
  await p.click("#save");
  await p.waitForSelector("#saved-flash"); // saving leaves the form
  await p.goto(BASE + "/app/profile.html");
  await p.evaluate(() => {
    localStorage.setItem("sevak.seenCertificates.v1", JSON.stringify(["c1"]));
    localStorage.setItem("sevak.outbox.v1", JSON.stringify([{ id: "m1", subject: "private" }]));
    return new Promise((done) => { const r = indexedDB.open("sevak-files", 1); r.onupgradeneeded = () => r.result.createObjectStore("files"); r.onsuccess = () => { r.result.close(); done(); }; });
  });
  await p.click("#sign-out");
  await p.waitForURL(BASE + "/");
  const left = await p.evaluate(async () => ({
    keys: Object.keys(localStorage).filter((k) => k.startsWith("sevak.") && !/bannerDismissed|opportunityFilter|joinIntent|signedOut|organizations|events|mainEvents|signups|memberships|certificates|signatures|documents/.test(k)),
    profile: localStorage.getItem("sevak.profile.v1"),
    files: (await indexedDB.databases()).some((d) => d.name === "sevak-files"),
  }));
  check(left.keys.length === 0 && !left.profile, "sign-out clears this browser: " + JSON.stringify(left.keys));
  check(!left.files, "sign-out deletes stored files");

  // ...and when her session ends without signing out (it expired), the next
  // page clears them before anyone else uses the browser.
  await signIn(p, email("asha"));
  await p.evaluate(() => localStorage.setItem("sevak.outbox.v1", JSON.stringify([{ id: "m2", subject: "Asha's" }])));
  await shared.clearCookies();
  await p.goto(BASE + "/app/signup.html");
  check((await p.evaluate(() => localStorage.getItem("sevak.outbox.v1"))) === null, "an ended session leaves nothing behind");
  await signIn(p, email("ravi"));
  check((await p.evaluate(() => localStorage.getItem("sevak.owner.v1"))) === email("ravi"), "the next person starts clean");

  // No inline scripts: an injected one doesn't run.
  const res = await p.goto(BASE + "/app/signup.html");
  const csp = res.headers()["content-security-policy"] || "";
  const scriptSrc = (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) || "");
  check(scriptSrc === "script-src 'self'", "scripts only from Sevak: " + scriptSrc);
  const h = res.headers();
  check(h["cross-origin-opener-policy"] === "same-origin" && h["cross-origin-resource-policy"] === "same-origin", "other sites can't reach into Sevak's windows or load its responses");
  check(/geolocation=\(\)/.test(h["permissions-policy"] || "") && /microphone=\(\)/.test(h["permissions-policy"] || ""), "no location or microphone: " + h["permissions-policy"]);
  check(h["x-frame-options"] === "DENY" && /frame-ancestors 'none'/.test(csp) && h["x-content-type-options"] === "nosniff", "can't be framed; no type guessing");
  await p.evaluate(() => { const s = document.createElement("script"); s.textContent = "window.__injected = true"; document.body.appendChild(s); });
  check((await p.evaluate(() => window.__injected)) !== true, "injected inline script blocked");

  // Every page works under the content security policy: no inline script
  // or style is blocked (the policy allows neither).
  const policy = (res.headers()["content-security-policy"] || "").split(";").map((d) => d.trim());
  check(policy.includes("style-src 'self'"), "styles only from Sevak's own files");
  const blocked = [];
  const admin0 = await person(t, "pages");
  admin0.on("console", (m) => { if (/Content Security Policy|Refused to (apply|execute|load)/i.test(m.text())) blocked.push(admin0.url() + ": " + m.text().slice(0, 140)); });
  const pages = ["../index.html", "../privacy.html", "../terms.html", "signup.html", "signup.html?view=mine", "profile.html", "join.html", "verify.html",
    "organization.html?new=1", "events.html", "event.html", "main-event.html", "volunteers.html", "dashboard.html", "certificate.html", "outbox.html", "roster.html", "help.html"];
  for (const pg of pages) await admin0.goto(BASE + "/app/" + pg, { waitUntil: "networkidle" });
  const out = await (await t.browser.newContext()).newPage();
  out.on("console", (m) => { if (/Content Security Policy|Refused to (apply|execute|load)/i.test(m.text())) blocked.push("signed out " + out.url() + ": " + m.text().slice(0, 140)); });
  await out.goto(BASE + "/app/signin.html", { waitUntil: "networkidle" });
  await out.goto(BASE + "/", { waitUntil: "networkidle" });
  check(blocked.length === 0, "no page has anything blocked by the policy: " + JSON.stringify(blocked.slice(0, 5)));

  // No demo data or samples on the real app.
  const admin = await person(t, "admin");
  await admin.goto(BASE + "/app/dashboard.html");
  check(!(await admin.isVisible("#load-demo")) && !(await admin.isVisible("#add-samples")), "no demo or sample buttons");
  await admin.goto(BASE + "/app/join.html");
  check(!(await admin.isVisible("#demo-offer")), "no demo offer on Join");
  await t.done();
})();
