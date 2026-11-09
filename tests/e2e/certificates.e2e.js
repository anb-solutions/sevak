// Certificates and documents on the server: a volunteer asks, an Admin
// issues (only with the approved hours on record), the PDF lands in the
// volunteer's documents, anyone can check it by number; uploads are checked
// and files are private.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { BASE, start, person, synced, organization, joinWithCode } = require("./helpers");
const ORG = "Temple Volunteers " + require("./helpers").RUN;

(async () => {
  const t = await start();
  const { check } = t;
  const asha = await person(t, "asha");
  const { id: orgId, code } = await organization(asha, { name: ORG });
  const eventId = "event-cert-" + orgId;
  await asha.goto(BASE + "/app/events.html");
  await asha.evaluate(([orgId, eventId]) => window.SevakEvents.save({
    id: eventId, organizationId: orgId, title: "Seva day", status: "published", visibility: "public", active: true,
    startDate: "2030-01-10", endDate: "2030-01-10", timezone: "America/Chicago",
    roles: [{ id: "role-1", name: "Setup", shifts: [{ id: "shift-1", date: "2030-01-10", start: "09:00", end: "12:00", capacity: 5 }] }]
  }), [orgId, eventId]);

  // Mei volunteers, logs 2 hours, and Asha approves them.
  const mei = await person(t, "mei");
  await joinWithCode(mei, code);
  await mei.goto(BASE + "/app/signup.html?event=" + eventId);
  await mei.check('input[value="shift-1"]');
  await mei.click("#continue");
  await mei.click("#submit");
  await mei.waitForURL(/registration=/);
  const signup = (await synced(mei)).data["sevak.signups.v1"].find((s) => s.eventId === eventId);
  await mei.evaluate((id) => window.SevakSignups.update(id, { hours: { minutes: 120, method: "duration" } }), signup.id);
  await asha.goto(BASE + "/app/volunteers.html");
  await asha.evaluate((id) => window.SevakSignups.decideHours(id, { status: "approved", by: "asha" }), signup.id);

  // Mei asks for a certificate.
  await mei.goto(BASE + "/app/signup.html?view=mine");
  const certId = await mei.evaluate((orgId) => window.SevakCerts.request(orgId, "2030-01-01", "2030-01-31", "For school").id, orgId);
  const certs = async (p) => (await synced(p)).data["sevak.certificates.v1"].filter((c) => c.orgId === orgId);
  check((await certs(asha)).some((c) => c.id === certId && c.status === "requested"), "the organization sees the request");

  // Mei can't issue her own; Asha can't inflate the hours.
  await mei.evaluate((id) => {
    const list = JSON.parse(localStorage.getItem("sevak.certificates.v1"));
    const c = list.find((x) => x.id === id);
    Object.assign(c, { status: "issued", code: "SVK-AAAA-BBBB", data: { code: "SVK-AAAA-BBBB", minutes: 120 } });
    try { localStorage.setItem("sevak.certificates.v1", JSON.stringify(list)); } catch (e) { /* refused */ }
  }, certId);
  check((await certs(mei))[0].status === "requested", "a volunteer can't issue their own certificate");
  await asha.goto(BASE + "/app/volunteers.html");
  await asha.evaluate((id) => {
    const list = JSON.parse(localStorage.getItem("sevak.certificates.v1"));
    const c = list.find((x) => x.id === id);
    Object.assign(c, { status: "issued", code: "SVK-CCCC-DDDD", data: { code: "SVK-CCCC-DDDD", minutes: 6000 } });
    try { localStorage.setItem("sevak.certificates.v1", JSON.stringify(list)); } catch (e) { /* refused */ }
  }, certId);
  check((await certs(asha))[0].status === "requested", "a certificate can't claim more than the approved hours");

  // Asha issues it properly.
  await asha.goto(BASE + "/app/volunteers.html");
  const issued = await asha.evaluate((id) => window.SevakCerts.issue(id).then((c) => ({ code: c.code, docIds: c.docIds })), certId);
  const cert = (await certs(mei))[0];
  check(cert.status === "issued" && cert.code === issued.code && cert.data.minutes === 120, "issued with the approved hours");

  // The PDF is in Mei's documents and downloads for her, not for others.
  const docs = (await synced(mei)).data["sevak.documents.v1"];
  const pdfDoc = docs.find((d) => d.source === "certificate");
  check(pdfDoc && pdfDoc.storedType === "application/pdf", "certificate PDF saved in her documents");
  const download = await mei.request.get(BASE + "/api/v1/files/" + pdfDoc.id);
  check(download.status() === 200 && (await download.body()).subarray(0, 5).toString() === "%PDF-", "she can download it");
  const sam = await person(t, "sam");
  check((await sam.request.get(BASE + "/api/v1/files/" + pdfDoc.id)).status() === 404, "nobody else can");

  // Anyone can check it by number; a wrong number isn't found.
  const visitor = await (await t.browser.newContext()).newPage();
  await visitor.goto(BASE + "/app/verify.html?code=" + issued.code);
  await visitor.waitForSelector("#verify-result:not([hidden])");
  const shown = await visitor.textContent("#verify-result");
  check(shown.includes("Genuine") && shown.includes("Mei Test") && shown.includes(ORG) && !shown.includes(mei.address), "verified by number, no email shown");
  await visitor.goto(BASE + "/app/verify.html?code=SVK-ZZZZ-ZZZZ");
  await visitor.waitForSelector("#verify-result:not([hidden])");
  check((await visitor.textContent("#verify-result")).includes("Not found"), "a wrong number isn't found");

  // Uploading on her profile: a PDF works; a web page called .pdf doesn't.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sevak-e2e-"));
  const good = path.join(dir, "first-aid.pdf");
  const bad = path.join(dir, "sneaky.pdf");
  fs.writeFileSync(good, "%PDF-1.4\nFirst aid certificate\n");
  fs.writeFileSync(bad, "<html><script>alert(1)</script></html>");
  await mei.goto(BASE + "/app/profile.html");
  await mei.click("#tab-documents");
  const upload = async (file, name) => {
    await mei.click("#panel-documents .docs-add");
    await mei.setInputFiles("#panel-documents .docs-file", file);
    await mei.fill("#panel-documents .docs-name", name);
    await mei.click("#panel-documents .docs-save");
    await mei.waitForFunction(() => document.querySelector("#panel-documents .docs-status").textContent);
    return mei.textContent("#panel-documents .docs-status");
  };
  check((await upload(good, "First aid")).includes("uploaded"), "a PDF uploads");
  await mei.click("#panel-documents .docs-cancel").catch(() => {});
  const refused = await upload(bad, "Sneaky");
  check(refused.includes("isn't accepted"), "a disguised web page is refused: " + refused);
  const names = (await synced(mei)).data["sevak.documents.v1"].map((d) => d.name);
  check(names.includes("First aid") && !names.includes("Sneaky"), "only the accepted file is kept");
  await t.done();
})();
