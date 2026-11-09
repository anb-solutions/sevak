// Joining: an invite link, asking to join, approval; memberships are private.
const { BASE, start, person, signIn, synced, organization, email, mailsTo } = require("./helpers");
const ORG = "Temple Volunteers " + require("./helpers").RUN;

(async () => {
  const t = await start();
  const { check } = t;
  const asha = await person(t, "asha");
  const { id, code } = await organization(asha, { name: ORG, address: { city: "Houston" } });
  const memberships = async (p) => (await synced(p)).data["sevak.memberships.v1"];

  // Mei follows the invite link while signed out.
  const mei = await (await t.browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  mei.on("pageerror", (e) => t.errors.push("mei: " + e.message));
  await mei.goto(BASE + "/app/join.html?code=" + code);
  check((await mei.textContent("#join-title")) === "Join " + ORG, "invite link: Join <organization>");
  check((await mei.textContent("#join-continue")) === "Join " + ORG, "one button to join");
  await mei.click("#join-continue");
  await mei.waitForURL(/signin\.html/);
  await signIn(mei, email("mei"), { from: null });
  await mei.fill("#firstName", "Mei"); await mei.fill("#lastName", "Test"); await mei.fill("#phone", "7135550100");
  await mei.check("input[name=availability][value=anytime]", { force: true }).catch(() => {});
  await mei.click("#save");
  await mei.waitForFunction(() => /volunteer with/.test(document.getElementById("join-notice").textContent));
  check((await memberships(asha)).some((m) => m.email === email("mei") && m.status === "active"), "joined by invite code");
  check(mailsTo(email("mei")).includes("Welcome to " + ORG), "welcome email sent");

  // A wrong code isn't recognised.
  await mei.goto(BASE + "/app/join.html");
  await mei.click("#switch-way");
  await mei.fill("#code", "ZZZZZZ");
  await mei.click("#join-continue");
  check((await mei.textContent("#code-error")).includes("don't recognise"), "wrong code not recognised");

  // Sam finds the organization and asks to join; Asha approves.
  const sam = await person(t, "sam");
  await sam.goto(BASE + "/app/join.html");
  check(await sam.isVisible("#org-search") && !(await sam.isVisible("#code")), "Join page leads with Find your organization");
  await sam.fill("#org-search", ORG);
  await sam.click('.org-pick-item:has-text("' + ORG + '")');
  await sam.click("#join-continue");
  await sam.waitForSelector("#join-done:not([hidden])");
  check((await sam.textContent("#join-done")).includes("Request sent"), "request sent");
  const request = (await memberships(asha)).find((m) => m.email === email("sam"));
  check(request && request.status === "requested", "team sees the request");
  check(mailsTo(asha.address).some((s) => s.includes("asked to volunteer with " + ORG)), "Admin emailed about the request");

  // Sam can't approve himself.
  await sam.evaluate((mid) => {
    const list = JSON.parse(localStorage.getItem("sevak.memberships.v1"));
    list.find((m) => m.id === mid).status = "active";
    try { localStorage.setItem("sevak.memberships.v1", JSON.stringify(list)); } catch (e) { /* refused */ }
  }, request.id);
  check((await memberships(sam))[0].status === "requested", "can't approve yourself");

  await asha.goto(BASE + "/app/volunteers.html");
  await asha.evaluate((mid) => window.SevakMembers.approve(mid), request.id);
  check((await memberships(sam))[0].status === "active", "approved by the team");
  check(mailsTo(email("sam")).includes(ORG + " approved your request"), "approval emailed");
  check((await memberships(mei)).every((m) => m.email === email("mei")), "volunteers see only their own memberships");
  check((await memberships(asha)).length === 2, "the team sees both");
  await t.done();
})();
