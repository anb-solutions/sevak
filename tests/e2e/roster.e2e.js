// The roster (ATT-1, ATT-2, ATT-4) on the real server: an Admin opens an
// event's roster, adds someone to a shift by email (who gets the
// confirmation and sees it in My sign-ups), adds a walk-in with no email,
// checks people in and out (which approves their hours), and can't overbook.
// A Coordinator who isn't the event admin, and a volunteer, see no names and
// can't add anyone; the Coordinator who is its event admin can.
const { BASE, start, context, person, synced, organization, joinWithCode, mailsTo, email, signIn } = require("./helpers");
const ORG = "Roster Org " + require("./helpers").RUN;

(async () => {
  const t = await start();
  const { check } = t;
  const asha = await person(t, "asha");
  const { id: orgId, code } = await organization(asha, { name: ORG });
  const eventId = "event-roster-" + orgId;
  const today = new Date().toISOString().slice(0, 10);
  await asha.goto(BASE + "/app/events.html");
  await asha.evaluate(([orgId, eventId, today]) => window.SevakEvents.save({
    id: eventId, organizationId: orgId, title: "Flute evening", status: "published", visibility: "public", active: true,
    startDate: today, endDate: today, timezone: "America/Chicago", location: { type: "later" },
    roles: [
      { id: "role-door", name: "Door", shifts: [{ id: "shift-door", date: today, start: "17:00", end: "20:00", capacity: 2 }] },
      { id: "role-stage", name: "Stage", shifts: [{ id: "shift-stage", date: today, start: "16:00", end: "21:00", capacity: 3 }] }
    ]
  }), [orgId, eventId, today]);

  // A volunteer signs up herself.
  const mei = await person(t, "mei");
  await joinWithCode(mei, code);
  await mei.goto(BASE + "/app/signup.html?view=mine");
  await mei.evaluate(([eventId, address]) => window.SevakSignups.addMany([{ id: "su-mei", registrationId: "reg-mei", eventId, shiftId: "shift-stage",
    name: "Mei", email: address, phone: { country: "US", number: "+17135550100" }, status: "confirmed" }]), [eventId, mei.address]);

  // Asha finds the roster from the Events list.
  await asha.goto(BASE + "/app/events.html");
  await asha.click('a[aria-label="Roster of Flute evening"]');
  await asha.waitForURL(/roster\.html\?event=/);
  await asha.waitForSelector(".roster-shift");
  const page = await asha.textContent("main");
  check(page.includes("Roster: Flute evening") && page.includes("1 of 5 spots filled") && page.includes("Today"), "the roster: title, spots filled, today's shifts");
  check(page.includes("Mei") && page.includes(mei.address) && page.includes("+17135550100"), "with each person's name, email and phone");

  // She adds Vishal to the Door shift by email.
  const vishal = email("vishal");
  await asha.click('button[aria-label="Add someone to Door, 5:00 PM–8:00 PM"]');
  await asha.fill("#add-name-shift-door", "Vishal");
  await asha.fill("#add-email-shift-door", vishal);
  await asha.click("text=Add to this shift");
  await asha.waitForSelector("text=Added Vishal to Door");
  const added = (await synced(asha)).data["sevak.signups.v1"].find((s) => s.email === vishal);
  check(added && added.shiftId === "shift-door" && added.status === "confirmed" && added.name === "Vishal", "Vishal is on the Door shift");
  check(mailsTo(vishal).some((s) => /signed up/i.test(s)), "and gets the confirmation email: " + JSON.stringify(mailsTo(vishal)));
  const v = await person(t, "vishal");
  const his = (await synced(v)).data["sevak.signups.v1"].find((s) => s.id === added.id);
  check(his && his.email === vishal && !his.anonymous, "he sees it as his own sign-up when he signs in");

  // A walk-in with no email; then the shift is full.
  await asha.click('button[aria-label="Add someone to Door, 5:00 PM–8:00 PM"]');
  await asha.fill("#add-name-shift-door", "Walk-in Ravi");
  await asha.click("text=Add to this shift");
  await asha.waitForSelector("text=Added Walk-in Ravi to Door");
  check((await asha.textContent(".roster-shift >> nth=1")).includes("Full."), "the Door shift is full, and says so");
  const over = await asha.evaluate(([eventId]) => window.SevakSignups.addMany([{ id: "su-over", registrationId: "reg-over", eventId, shiftId: "shift-door", name: "One too many", status: "confirmed" }]), [eventId]);
  check(over === false, "and no one more can be added, even directly");

  // Check-in and check-out: the hours are approved.
  await asha.click('button[aria-label="Check in Mei"]');
  await asha.waitForSelector("text=Mei is checked in.");
  check((await asha.textContent("#roster-totals")).includes("1 here now"), "1 here now");
  await asha.click('button[aria-label="Check out Mei"]');
  await asha.waitForSelector("text=Mei is checked out");
  const meis = (await synced(mei)).data["sevak.signups.v1"].find((s) => s.id === "su-mei");
  check(meis.checkInAt && meis.checkOutAt && meis.hours && meis.hours.status === "approved" && meis.hours.method === "check-in" && meis.hours.decidedBy === asha.address, "Mei's hours are recorded and approved: " + JSON.stringify(meis.hours));

  // Asha on her own shift: her hours wait for another Admin.
  await asha.evaluate(([eventId, me]) => window.SevakSignups.addMany([{ id: "su-asha", registrationId: "reg-asha", eventId, shiftId: "shift-stage", name: "Asha", email: me, status: "confirmed" }]), [eventId, asha.address]);
  await asha.goto(BASE + "/app/roster.html?event=" + eventId);
  await asha.click('button[aria-label="Check in Asha"]');
  await asha.waitForSelector("text=Asha is checked in.");
  await asha.click('button[aria-label="Check out Asha"]');
  await asha.waitForSelector("text=waiting for another Admin");
  const ashas = (await synced(asha)).data["sevak.signups.v1"].find((s) => s.id === "su-asha");
  check(ashas.hours && ashas.hours.status === "pending", "an Admin's own hours wait for another Admin");
  const forged = await asha.evaluate(() => {
    const s = window.SevakSignups.all().find((x) => x.id === "su-asha");
    return window.SevakSignups.update(s.id, { hours: Object.assign({}, s.hours, { status: "approved" }) });
  });
  check(forged === false, "and she can't approve them herself");

  // Removing someone opens the spot again.
  await asha.goto(BASE + "/app/roster.html?event=" + eventId);
  asha.once("dialog", (d) => d.accept());
  await asha.click('button[aria-label="Take Walk-in Ravi off Door, 5:00 PM–8:00 PM"]');
  await asha.waitForSelector("text=The spot is open again.");
  check(await asha.isVisible('button[aria-label="Add someone to Door, 5:00 PM–8:00 PM"]'), "the Door shift has room again");

  // A volunteer sees no names, and can't add anyone or open the roster.
  await mei.goto(BASE + "/app/roster.html?event=" + eventId);
  check((await mei.textContent("#roster-none")).includes("Only the organization's Admins"), "a volunteer can't open the roster");
  const meiSees = (await synced(mei)).data["sevak.signups.v1"].filter((s) => s.eventId === eventId && s.id !== "su-mei");
  check(meiSees.length > 0 && meiSees.every((s) => s.anonymous && !s.name && !s.email), "and sees only that spots are taken");
  const meiAdds = await mei.evaluate(([eventId]) => window.SevakSignups.addMany([{ id: "su-mei-adds", registrationId: "r", eventId, shiftId: "shift-stage", name: "Friend", email: "friend@example.com", status: "confirmed" }]), [eventId]);
  check(meiAdds === false, "nor add someone else");

  // A Coordinator who isn't the event admin: the same.
  const cora = await person(t, "cora");
  await asha.goto(BASE + "/app/organization.html");
  await asha.evaluate(([orgId, address]) => {
    const org = window.SevakOrgs.get(orgId);
    window.SevakOrgs.save(Object.assign({}, org, { team: (org.team || []).concat([{ name: "Cora", email: address, role: "coordinator" }]) }));
  }, [orgId, cora.address]);
  await cora.goto(BASE + "/app/events.html");
  check(!(await cora.isVisible('a[aria-label="Roster of Flute evening"]')), "a Coordinator who doesn't run it has no Roster button");
  await cora.goto(BASE + "/app/roster.html?event=" + eventId);
  check(await cora.isVisible("#roster-none") && !(await cora.textContent("main")).includes(mei.address), "and no roster");
  const coraAdds = await cora.evaluate(([eventId]) => window.SevakSignups.addMany([{ id: "su-cora-adds", registrationId: "r", eventId, shiftId: "shift-stage", name: "Friend", status: "confirmed" }]), [eventId]);
  check(coraAdds === false, "and can't add anyone");

  // Made its event admin, she can.
  await asha.goto(BASE + "/app/events.html");
  await asha.evaluate(([eventId, address]) => window.SevakEvents.save(Object.assign({}, window.SevakEvents.get(eventId), { eventAdmin: address })), [eventId, cora.address]);
  await cora.goto(BASE + "/app/events.html");
  await cora.click('a[aria-label="Roster of Flute evening"]');
  await cora.waitForSelector(".roster-shift");
  check((await cora.textContent("main")).includes(mei.address), "as its event admin, she sees the roster");
  await cora.click('button[aria-label="Add someone to Stage, 4:00 PM–9:00 PM"]');
  await cora.fill("#add-name-shift-stage", "Lata");
  await cora.click("text=Add to this shift");
  await cora.waitForSelector("text=Added Lata to Stage");
  check(true, "and can add someone");

  // Signed out, the roster's link asks you to sign in and then comes back to it.
  const later = await (await context(t)).newPage();
  await later.goto(BASE + "/app/roster.html?event=" + eventId);
  await later.waitForURL(/signin\.html\?next=/);
  check(later.url().includes("next=" + encodeURIComponent("roster.html?event=" + eventId)), "signed out: sign in first: " + later.url());
  await signIn(later, asha.address, { from: null });
  await later.waitForSelector(".roster-shift");
  check(later.url().endsWith("/app/roster.html?event=" + eventId), "then back to the roster");

  // At phone width, nothing overflows.
  await asha.setViewportSize({ width: 390, height: 844 });
  await asha.goto(BASE + "/app/roster.html?event=" + eventId);
  await asha.waitForSelector(".roster-shift");
  check(!(await asha.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "no overflow at 390px");
  await t.done();
})();
