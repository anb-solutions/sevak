// The prototype's pages on the server say what's true there: a team member
// added by an Admin can run its events before saving a profile; the banner
// is about the beta; nothing points at the prototype outbox, because emails
// are sent for real; and the sign-up confirmation says the email is on its way.
const { BASE, start, person, organization, joinWithCode, email } = require("./helpers");
const ORG = "Food Bank " + require("./helpers").RUN;

(async () => {
  const t = await start();
  const { check } = t;
  // What a person reads on the page (hidden parts left out).
  const words = (p) => p.evaluate(() => document.querySelector("main").innerText);
  const prototypeTalk = (text) => /outbox|in the live app|stays? in this browser|Prototype\./i.test(text);

  const asha = await person(t, "asha");
  const { id: orgId, code } = await organization(asha, { name: ORG });

  // ----- A Coordinator, added on the Team tab, signs in for the first time -----
  await asha.goto(BASE + "/app/organization.html");
  await asha.evaluate(([orgId, address]) => {
    const org = window.SevakOrgs.get(orgId);
    window.SevakOrgs.save(Object.assign({}, org, { team: (org.team || []).concat([{ name: "Carlos", email: address, role: "coordinator" }]) }));
  }, [orgId, email("carlos")]);
  const carlos = await person(t, "carlos", { profile: false });
  await carlos.goto(BASE + "/app/events.html");
  check(!(await carlos.isVisible(".way-in")) && (await carlos.textContent("main")).includes(ORG), "a new Coordinator sees the organization's Events before saving a profile");
  await carlos.goto(BASE + "/app/organization.html");
  check((await carlos.textContent("main")).includes("You're a Coordinator here"), "and its profile, as a Coordinator");

  // ----- The banner: one line about the beta, on every kind of page -----
  for (const page of ["events.html", "volunteers.html", "signup.html", "verify.html", "join.html"]) {
    await asha.goto(BASE + "/app/" + page);
    const banner = await asha.textContent("main .banner");
    check(banner.includes("Sevak beta.") && banner.includes("emails are sent for real") && !prototypeTalk(banner) && !/test site/.test(banner), page + ": the beta banner, not the prototype's: " + banner);
  }

  // ----- Volunteers: no outbox link; approving says nothing about an outbox -----
  const sam = await person(t, "sam");
  await sam.goto(BASE + "/app/join.html");
  check(!/6-letter/.test(await sam.textContent("main")), "the Join page doesn't promise a 6-letter code");
  await sam.fill("#org-search", ORG);
  await sam.click('.org-pick-item:has-text("' + ORG + '")');
  await sam.click("#join-continue");
  await sam.waitForSelector("#join-done:not([hidden])");
  await asha.goto(BASE + "/app/volunteers.html");
  check(await asha.isHidden("#outbox-link"), "Volunteers: no link to the prototype outbox");
  await asha.locator("button:visible", { hasText: /^Approve$/ }).first().click();
  await asha.waitForTimeout(300);
  check(!prototypeTalk(await words(asha)), "approving a request: nothing about an outbox");
  await asha.fill("#invite-emails", email("ana"));
  await asha.click("#send-invites");
  await asha.waitForTimeout(300);
  check(/Invitation sent to/.test(await words(asha)) && !prototypeTalk(await words(asha)), "sending invitations: nothing about an outbox");

  // ----- Signing up: the confirmation email is on its way -----
  const eventId = "event-words-" + orgId;
  await asha.goto(BASE + "/app/events.html");
  await asha.evaluate(([orgId, eventId]) => window.SevakEvents.save({
    id: eventId, organizationId: orgId, title: "Food sort", status: "published", visibility: "public", active: true,
    startDate: "2030-01-10", endDate: "2030-01-10", timezone: "America/Chicago", location: { type: "in-person", venue: "Hall", city: "Houston" },
    roles: [{ id: "role-1", name: "Sorting", shifts: [{ id: "shift-1", date: "2030-01-10", start: "09:00", end: "12:00", capacity: 5 }] }]
  }), [orgId, eventId]);
  const mei = await person(t, "mei");
  await joinWithCode(mei, code);
  await mei.goto(BASE + "/app/signup.html?event=" + eventId);
  await mei.check('input[value="shift-1"]');
  await mei.click("#continue");
  await mei.click("#submit");
  await mei.waitForURL(/registration=/);
  const intro = await mei.textContent("#confirm-intro");
  check(intro.includes("A confirmation email is on its way to " + mei.address) && !/live app/.test(intro), "signed up: " + intro);
  check((await mei.textContent("#manage-hint")).includes("links to My sign-ups") && !prototypeTalk(await words(mei)), "the confirmation page doesn't talk about the prototype");

  // ----- Sevak staff: the review page's banner -----
  const staff = await person(t, "staff");
  await staff.goto(BASE + "/app/review.html");
  const staffBanner = await staff.textContent("main .banner");
  check(staffBanner.includes("Sevak staff only") && !prototypeTalk(staffBanner), "review page: " + staffBanner);
  await t.done();
})();
