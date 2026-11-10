// Organizations on the server: the team sees everything, others the public
// part; only the team changes it; only Sevak staff verify.
const { start, person, synced, organization, BASE } = require("./helpers");
const ORG = "Temple Volunteers " + require("./helpers").RUN;

(async () => {
  const t = await start();
  const { check } = t;
  const asha = await person(t, "asha");
  const { id } = await organization(asha, { name: ORG, website: "https://temple.example.org", address: { city: "Houston", line1: "1 Main St", country: "US" }, primaryContact: { name: "Asha", email: asha.address } });
  const mine = (await synced(asha)).data["sevak.organizations.v1"].find((o) => o.id === id);
  check(mine && mine.createdBy === asha.address && mine.inviteCode, "saved with its creator and invite code");

  const mei = await person(t, "mei");
  const seen = (await synced(mei)).data["sevak.organizations.v1"].find((o) => o.id === id);
  check(seen && seen.public === true && seen.address.city === "Houston", "others see the public part");
  check(!JSON.stringify(seen).includes(asha.address) && !JSON.stringify(seen).includes("1 Main St") && !seen.inviteCode, "no contacts, street or invite code");

  // Mei can't change it, even by editing storage.
  await mei.goto(BASE + "/app/signup.html");
  await mei.evaluate((orgId) => {
    const list = JSON.parse(localStorage.getItem("sevak.organizations.v1"));
    const o = list.find((x) => x.id === orgId);
    o.name = "Taken"; delete o.public;
    try { localStorage.setItem("sevak.organizations.v1", JSON.stringify(list)); } catch (e) { /* refused */ }
  }, id);
  await mei.waitForTimeout(300);
  check((await mei.textContent("#sevak-sync-notice")).includes("team"), "refusal explained");
  check((await synced(asha)).data["sevak.organizations.v1"].find((o) => o.id === id).name === ORG, "name unchanged");

  // Asking for verification, and only staff deciding.
  await asha.goto(BASE + "/app/organization.html");
  await asha.evaluate((orgId) => window.SevakVerify.request(orgId, "Please verify us"), id);
  await asha.evaluate((orgId) => {
    const list = JSON.parse(localStorage.getItem("sevak.organizations.v1"));
    list.find((x) => x.id === orgId).verificationStatus = "verified";
    try { localStorage.setItem("sevak.organizations.v1", JSON.stringify(list)); } catch (e) { /* refused */ }
  }, id);
  check((await synced(asha)).data["sevak.organizations.v1"].find((o) => o.id === id).verificationStatus === "pending", "can't verify your own organization");
  await asha.goto(BASE + "/app/review.html");
  check((await asha.textContent("main")).includes("Only Sevak's staff"), "Review page is for staff only");

  const staff = await person(t, "staff");
  await staff.goto(BASE + "/app/review.html");
  check(await staff.isVisible(`text=${ORG}`), "staff see the request");
  await staff.evaluate((orgId) => window.SevakVerify.approve(orgId), id);
  check((await synced(mei)).data["sevak.organizations.v1"].find((o) => o.id === id).verificationStatus === "verified", "staff verify it");
  await t.done();
})();
