// Task leads (EVT-21) on the real server: an Admin picks a member as a
// task's lead in the event editor; the lead sees that task's roster (and
// not the other task's) on My sign-ups; other volunteers and a Coordinator
// who doesn't run the event see neither the lead nor the names; only an
// Admin can choose, and only a member or someone on the team.
const { BASE, start, person, synced, organization, joinWithCode } = require("./helpers");
const ORG = "Task Leads Org " + require("./helpers").RUN;

(async () => {
  const t = await start();
  const { check } = t;
  const asha = await person(t, "asha");
  const { id: orgId, code } = await organization(asha, { name: ORG });
  const eventId = "event-leads-" + orgId;
  await asha.goto(BASE + "/app/events.html");
  await asha.evaluate(([orgId, eventId]) => window.SevakEvents.save({
    id: eventId, organizationId: orgId, title: "Seva day", status: "published", visibility: "public", active: true,
    startDate: "2030-01-10", endDate: "2030-01-10", timezone: "America/Chicago", location: { type: "later" },
    roles: [
      { id: "role-setup", name: "Setup", shifts: [{ id: "shift-setup", date: "2030-01-10", start: "09:00", end: "12:00", capacity: 5 }] },
      { id: "role-kitchen", name: "Kitchen", shifts: [{ id: "shift-kitchen", date: "2030-01-10", start: "12:00", end: "15:00", capacity: 5 }] }
    ]
  }), [orgId, eventId]);

  // Mei will lead Setup; Ravi signs up for Setup, Pia for Kitchen.
  const mei = await person(t, "mei");
  const ravi = await person(t, "ravi");
  const pia = await person(t, "pia");
  for (const p of [mei, ravi, pia]) await joinWithCode(p, code);
  const signUp = async (p, id, shiftId) => {
    await p.goto(BASE + "/app/signup.html?view=mine");
    await p.evaluate(([id, eventId, shiftId, address]) => window.SevakSignups.addMany([{ id, registrationId: "reg-" + id, eventId, shiftId,
      name: address.split(".")[0], email: address, phone: { country: "US", number: "+17135550100" }, status: "confirmed" }]), [id, eventId, shiftId, p.address]);
  };
  await signUp(ravi, "su-ravi-" + orgId, "shift-setup");
  await signUp(pia, "su-pia-" + orgId, "shift-kitchen");

  // Asha picks Mei as Setup's lead in the event editor.
  await asha.goto(BASE + "/app/event.html?id=" + eventId + "#roles"); // the Roles step
  const leadSel = ".role-card >> nth=0 >> select[data-key=\"lead\"]";
  const offered = await asha.$$eval(".role-card select[data-key=\"lead\"]", (s) => [...s[0].options].map((o) => o.value));
  check(offered.includes(mei.address) && offered.includes(ravi.address), "the editor offers the organization's members");
  await asha.selectOption(leadSel, mei.address);
  await asha.click("#publish");
  await asha.waitForURL(/events\.html/);
  const roles = async (p) => ((await synced(p)).data["sevak.events.v1"].find((e) => e.id === eventId) || {}).roles || [];
  check((await roles(asha)).map((r) => r.lead || "").join() === mei.address + ",", "saved: Mei leads Setup, Kitchen has no lead");

  // Mei sees Setup's roster, and that she leads it; not Kitchen's.
  const signups = async (p) => (await synced(p)).data["sevak.signups.v1"];
  const seen = await signups(mei);
  const ravis = seen.find((s) => s.id === "su-ravi-" + orgId);
  const pias = seen.find((s) => s.id === "su-pia-" + orgId);
  check(ravis && ravis.name && ravis.email === ravi.address && ravis.roster === true && ravis.hours === undefined, "the lead gets her task's roster: name and contact, nothing more");
  check(pias && pias.anonymous && !pias.name && !pias.email, "not the other task's");
  check((await roles(mei)).map((r) => r.lead || "").join() === mei.address + ",", "she sees that she leads Setup, and no other lead");
  await mei.goto(BASE + "/app/signup.html?view=mine");
  const shown = await mei.textContent("#leading");
  check(shown.includes("Setup · Seva day") && shown.includes(ravis.name) && shown.includes(ravi.address) && !shown.includes(pia.address), "My sign-ups: Tasks you lead, with Ravi");

  // Others see neither the lead nor the names.
  check((await roles(ravi)).every((r) => !r.lead) && (await signups(ravi)).find((s) => s.id === "su-pia-" + orgId).anonymous, "another volunteer: no lead, no names");
  const cora = await person(t, "cora");
  await asha.goto(BASE + "/app/organization.html");
  await asha.evaluate(([orgId, address]) => {
    const org = window.SevakOrgs.get(orgId);
    window.SevakOrgs.save(Object.assign({}, org, { team: (org.team || []).concat([{ name: "Cora", email: address, role: "coordinator" }]) }));
  }, [orgId, cora.address]);
  check((await roles(cora)).every((r) => !r.lead) && (await signups(cora)).find((s) => s.id === "su-ravi-" + orgId).anonymous, "a Coordinator who doesn't run the event: no lead, no names");

  // Only an Admin chooses, and only a member or someone on the team.
  await cora.goto(BASE + "/app/event.html?id=" + eventId + "#roles");
  check(await cora.isDisabled(leadSel), "a Coordinator can't choose in the editor");
  await cora.evaluate(([eventId, address]) => {
    const list = JSON.parse(localStorage.getItem("sevak.events.v1"));
    const e = list.find((x) => x.id === eventId);
    e.title = "Seva day (Cora)";
    e.roles[0].lead = address; e.roles[1].lead = address;
    try { localStorage.setItem("sevak.events.v1", JSON.stringify(list)); } catch (err) { /* refused */ }
  }, [eventId, cora.address]);
  const after = (await synced(asha)).data["sevak.events.v1"].find((e) => e.id === eventId);
  check(after.title === "Seva day (Cora)" && after.roles.map((r) => r.lead || "").join() === mei.address + ",", "a Coordinator's save keeps each lead as it was");
  await asha.goto(BASE + "/app/events.html");
  await asha.evaluate(([eventId]) => {
    const list = JSON.parse(localStorage.getItem("sevak.events.v1"));
    list.find((x) => x.id === eventId).roles[1].lead = "stranger@example.com";
    try { localStorage.setItem("sevak.events.v1", JSON.stringify(list)); } catch (err) { /* refused */ }
  }, [eventId]);
  check((await roles(asha))[1].lead === undefined, "someone who isn't a member can't be a lead");
  await t.done();
})();
