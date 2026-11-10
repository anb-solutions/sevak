// Events from Zeffy (EVT-20), against a stand-in for Zeffy (fake-zeffy.js):
// an Admin connects with the organization's key, starts an event from a
// Zeffy event, and refreshes it after it changes on Zeffy. The key never
// comes back to a page, and people outside the team can't use it.
const { BASE, start, person, synced, organization, joinWithCode } = require("./helpers");
const ORG = "Temple Volunteers " + require("./helpers").RUN;
const ZEFFY = process.env.E2E_ZEFFY || "http://127.0.0.1:3199";
const FESTIVAL = "1f0c3a52-0000-4000-8000-000000000001";
// A request from the page itself, as Sevak's pages make them.
const call = (page, method, url, body) => page.evaluate(([m, u, b]) => fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined })
  .then((r) => r.json().then((data) => ({ status: r.status, data }))), [method, url, body]);

(async () => {
  const t = await start();
  const { check } = t;
  const asha = await person(t, "asha");
  const { id: orgId, code } = await organization(asha, { name: ORG });
  const zeffy = BASE + "/api/v1/organizations/" + orgId + "/zeffy";

  // A volunteer can't see or set the connection.
  const mei = await person(t, "mei");
  await joinWithCode(mei, code);
  check((await mei.request.get(zeffy)).status() === 403, "a volunteer can't see the Zeffy connection");
  check((await call(mei, "PUT", zeffy, { apiKey: "zeffy-test-key" })).status === 403, "or connect it");
  check((await call(mei, "POST", zeffy + "/events", { campaignId: FESTIVAL, timezone: "UTC" })).status === 403, "or import from it");

  // Asha connects: a wrong key is refused, the right one works.
  await asha.goto(BASE + "/app/events.html");
  await asha.click("#zeffy-open");
  await asha.waitForSelector("#zeffy-key");
  await asha.fill("#zeffy-key", "not-the-key");
  await asha.click("text=Connect Zeffy");
  await asha.waitForFunction(() => /didn't accept/.test(document.getElementById("zeffy-panel").textContent));
  check(true, "a wrong key is refused");
  await asha.fill("#zeffy-key", "zeffy-test-key");
  await asha.click("text=Connect Zeffy");
  await asha.waitForSelector("text=Spring Seva Festival");
  const panel = await asha.textContent("#zeffy-panel");
  check(panel.includes("key ending -key") && !panel.includes("General donations"), "connected; lists events, not donation forms");
  const status = await (await asha.request.get(zeffy)).text();
  const everything = JSON.stringify(await synced(asha));
  check(!status.includes("zeffy-test-key") && !everything.includes("zeffy-test-key"), "the key never comes back to a page");

  // She starts an event from it: a draft with Zeffy's details.
  await asha.click('button[aria-label="Start a Sevak event from Spring Seva Festival"]');
  await asha.waitForURL(/event\.html\?id=.+&from=zeffy/);
  const form = await asha.evaluate(() => ({
    title: document.getElementById("title").value,
    description: document.getElementById("description").value,
    start: document.getElementById("startDate").value,
    end: document.getElementById("endDate").value,
    note: document.getElementById("zeffy-source").textContent,
  }));
  check(form.title === "Spring Seva Festival" && form.start === "2030-03-14" && form.end === "2030-03-15", "title and dates from Zeffy: " + JSON.stringify(form));
  check(form.description.includes("music & dance") && !form.description.includes("<"), "description as plain text");
  check(form.note.includes("Started from a Zeffy event") && form.note.includes("View it on Zeffy"), "says where it came from");
  const saved = (await synced(asha)).data["sevak.events.v1"].find((e) => e.source && e.source.id === FESTIVAL);
  check(saved && saved.status === "draft" && saved.organizationId === orgId, "saved as a draft of the organization");
  check(!(await synced(mei)).data["sevak.events.v1"].some((e) => e.id === saved.id), "volunteers don't see the draft");

  // Saving keeps where it came from; starting again opens the same event.
  await asha.click('#stepper button[data-step="1"]'); // the venue is on When & where
  await asha.fill("#venue", "Temple hall").catch(() => {});
  await asha.click("#save-draft");
  await asha.waitForURL(/events\.html/); // saving goes back to Events
  check((await synced(asha)).data["sevak.events.v1"].find((e) => e.id === saved.id).source?.id === FESTIVAL, "saving keeps the Zeffy link");
  const again = await call(asha, "POST", zeffy + "/events", { campaignId: FESTIVAL, timezone: "America/Chicago" });
  check(again.data.eventId === saved.id && again.data.created === false, "starting from it again opens the same event");

  // It changes on Zeffy; Refresh shows it and fills it in.
  await asha.request.post(ZEFFY + "/__campaign", { data: { id: FESTIVAL, title: "Spring Seva Festival 2030" } });
  await asha.goto(BASE + "/app/event.html?id=" + saved.id);
  await asha.click("text=Refresh from Zeffy");
  await asha.waitForSelector("text=Changed on Zeffy:");
  check((await asha.textContent("#zeffy-source")).includes("Title: Spring Seva Festival 2030"), "shows what changed");
  await asha.click("text=Use these");
  check((await asha.inputValue("#title")) === "Spring Seva Festival 2030", "fills in the change");
  await asha.click("#save-draft");
  await asha.waitForURL(/events\.html/);
  check((await asha.textContent("#saved-flash")).includes("Saved “Spring Seva Festival 2030” as a draft."), "back on Events, saying what was saved");
  await asha.goto(BASE + "/app/event.html?id=" + saved.id);
  check((await synced(asha)).data["sevak.events.v1"].find((e) => e.id === saved.id).title === "Spring Seva Festival 2030", "saved");
  await asha.click("text=Refresh from Zeffy");
  await asha.waitForSelector("text=Up to date with Zeffy.");
  check(true, "then it's up to date");

  // Disconnecting forgets the key.
  check((await call(asha, "DELETE", zeffy)).status === 200, "an Admin can disconnect");
  check((await asha.request.get(zeffy + "/events")).status() === 409, "and then nothing more is read from Zeffy");
  await t.done();
})();
