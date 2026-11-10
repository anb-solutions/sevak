// Events on the server: the team sees everything; volunteers published
// ones (public or private); everyone else public ones of verified
// organizations. Only the team changes events.
const { BASE, start, person, synced, organization, joinWithCode } = require("./helpers");
const ORG = "Temple Volunteers " + require("./helpers").RUN;

(async () => {
  const t = await start();
  const { check } = t;
  const asha = await person(t, "asha");
  const { id: orgId, code } = await organization(asha, { name: ORG, website: "https://temple.example.org", team: [] });
  await asha.goto(BASE + "/app/events.html");
  await asha.evaluate((orgId) => {
    const base = { organizationId: orgId, status: "published", visibility: "public", active: true, startDate: "2030-01-10", endDate: "2030-01-10", roles: [] };
    window.SevakEvents.save(Object.assign({}, base, { id: "event-public-" + orgId, title: "Public seva" }));
    window.SevakEvents.save(Object.assign({}, base, { id: "event-private-" + orgId, title: "Members only", visibility: "private" }));
    window.SevakEvents.save(Object.assign({}, base, { id: "event-draft-" + orgId, title: "Draft", status: "draft" }));
  }, orgId);
  const titles = async (p) => (await synced(p)).data["sevak.events.v1"].filter((e) => e.organizationId === orgId).map((e) => e.title).sort();

  check(JSON.stringify(await titles(asha)) === '["Draft","Members only","Public seva"]', "the team sees every event");
  await asha.goto(BASE + "/app/events.html");
  check((await asha.$$(".event-item")).length === 3, "Events page lists them");

  const mei = await person(t, "mei");
  await joinWithCode(mei, code);
  check(JSON.stringify(await titles(mei)) === '["Members only","Public seva"]', "volunteers see published events, public and private");

  const sam = await person(t, "sam");
  check((await titles(sam)).length === 0, "others see nothing while the organization is unverified");

  // Sam and Mei can't change events.
  for (const p of [sam, mei]) {
    await p.evaluate((orgId) => {
      try { window.SevakEvents.save({ id: "event-public-" + orgId, organizationId: orgId, title: "Taken" }); } catch (e) { /* refused */ }
    }, orgId);
  }
  const after = await titles(asha);
  check(after.includes("Public seva") && !after.includes("Taken"), "only the team changes events");

  // Asked for, then verified by staff: the public event is public.
  await asha.goto(BASE + "/app/organization.html");
  await asha.evaluate((orgId) => window.SevakVerify.request(orgId, "Please verify us"), orgId);
  const staff = await person(t, "staff");
  await staff.goto(BASE + "/app/review.html");
  await staff.evaluate((orgId) => window.SevakVerify.approve(orgId), orgId);
  check(JSON.stringify(await titles(sam)) === '["Public seva"]', "verified: everyone sees its public event");
  await t.done();
})();
