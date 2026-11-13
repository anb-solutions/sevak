// Getting started as an organization on the real server: from the welcome
// page, sign in and go straight to a new organization, with you as its
// contact, before any profile. The reviewers' shortcuts aren't shown here.
const { BASE, start, context, signIn, email } = require("./helpers");

(async () => {
  const t = await start();
  const { check } = t;
  const page = await (await context(t)).newPage();
  page.on("pageerror", (e) => t.errors.push("onboarding: " + e.message));
  await page.goto(BASE + "/");
  check(!(await page.$(".shortcuts")), "no reviewers' shortcuts on the server");
  await page.click("text=Set up your organization");
  await page.waitForURL(/signin\.html\?next=/);
  const address = email("founder");
  await signIn(page, address, { from: null });
  await page.waitForURL(/organization\.html\?new=1/);
  check(true, "signed in, then straight to a new organization");
  check((await page.inputValue("#contactEmail")) === address, "with you as its contact");
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "no overflow at 390px");
  await t.done();
})();
