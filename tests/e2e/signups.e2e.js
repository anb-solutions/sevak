// Sign-ups on the server: signing up through the page, a full shift, no
// names for others, hours waiting for approval, the team approving them.
const { BASE, start, person, synced, organization, joinWithCode, mailsTo } = require("./helpers");
const ORG = "Temple Volunteers " + require("./helpers").RUN;

(async () => {
  const t = await start();
  const { check } = t;
  const asha = await person(t, "asha");
  const { id: orgId, code } = await organization(asha, { name: ORG });
  const eventId = "event-seva-" + orgId;
  await asha.goto(BASE + "/app/events.html");
  await asha.evaluate(([orgId, eventId]) => window.SevakEvents.save({
    id: eventId, organizationId: orgId, title: "Seva day", status: "published", visibility: "public", active: true,
    startDate: "2030-01-10", endDate: "2030-01-10", timezone: "America/Chicago", location: { type: "in-person", venue: "Hall", city: "Houston" },
    roles: [{ id: "role-1", name: "Setup", shifts: [{ id: "shift-1", date: "2030-01-10", start: "09:00", end: "12:00", capacity: 1 }] }]
  }), [orgId, eventId]);
  const signups = async (p) => (await synced(p)).data["sevak.signups.v1"].filter((s) => s.eventId === eventId);

  const mei = await person(t, "mei");
  await joinWithCode(mei, code);
  const ravi = await person(t, "ravi");
  await joinWithCode(ravi, code);

  // Mei signs up through the sign-up page.
  await mei.goto(BASE + "/app/signup.html?event=" + eventId);
  await mei.check('input[value="shift-1"]');
  await mei.click("#continue");
  check((await mei.getAttribute("#email", "readonly")) !== null, "sign-up email is your own");
  await mei.click("#submit");
  await mei.waitForURL(/registration=/);
  const meis = await signups(mei);
  check(meis.length === 1 && meis[0].email === mei.address, "signed up on the server");
  check(mailsTo(mei.address).includes("You're signed up: Seva day"), "confirmation emailed");

  // Ravi: the shift is full, and forcing it is refused.
  await ravi.goto(BASE + "/app/signup.html?event=" + eventId);
  check(await ravi.isDisabled('input[value="shift-1"]'), "full shift can't be picked");
  const saved = await ravi.evaluate((eventId) => window.SevakSignups.addMany([{ id: "signup-forced-" + eventId, registrationId: "reg-forced", eventId, shiftId: "shift-1", name: "Ravi", email: "x", status: "confirmed" }]), eventId);
  await ravi.waitForTimeout(300);
  check(saved === false && (await ravi.textContent("#sevak-sync-notice")).includes("filled up"), "overbooking refused, with the reason");
  const othersView = await signups(ravi);
  check(othersView.length === 1 && othersView[0].anonymous === true && !JSON.stringify(othersView).includes(mei.address), "others see a taken spot, no name");

  // Hours: logged as pending whatever the page says; the team approves.
  const mine = meis[0];
  await mei.evaluate((sid) => window.SevakSignups.update(sid, { checkInAt: new Date().toISOString(), hours: { minutes: 150, method: "duration", status: "approved" } }), mine.id);
  check((await signups(mei))[0].hours.status === "pending", "logged hours wait for approval");
  await asha.goto(BASE + "/app/volunteers.html");
  await asha.evaluate((sid) => window.SevakSignups.decideHours(sid, { status: "approved", by: "asha" }), mine.id);
  check((await signups(mei))[0].hours.status === "approved", "the team approves hours");
  check((await signups(asha))[0].name === "Mei Test", "an Admin sees the roster with names");

  // A Coordinator sees names only for events they run.
  const cora = await person(t, "cora");
  await asha.goto(BASE + "/app/organization.html");
  await asha.evaluate(([orgId, email]) => {
    const org = window.SevakOrgs.get(orgId);
    window.SevakOrgs.save(Object.assign({}, org, { team: (org.team || []).concat([{ name: "Cora", email, role: "coordinator" }]) }));
  }, [orgId, cora.address]);
  const coraSees = await signups(cora);
  check(coraSees.length === 1 && coraSees[0].anonymous === true && !JSON.stringify(coraSees).includes(mei.address), "a Coordinator not running the event sees no names");
  check((await synced(cora)).data["sevak.memberships.v1"].length === 0, "or the organization's volunteers");
  await asha.goto(BASE + "/app/events.html");
  await asha.evaluate(([eventId, email]) => window.SevakEvents.save(Object.assign({}, window.SevakEvents.get(eventId), { eventAdmin: email })), [eventId, cora.address]);
  check((await signups(cora))[0].name === "Mei Test", "the event's Coordinator sees its roster");
  await t.done();
})();
