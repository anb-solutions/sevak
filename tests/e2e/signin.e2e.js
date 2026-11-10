// Sign-in by emailed code, a profile on the server, a second device, signing out.
const { BASE, start, person, signIn, synced, email } = require("./helpers");

(async () => {
  const t = await start();
  const { check } = t;

  // Signed out, My profile sends you to sign in.
  const ctx = await t.browser.newContext({ viewport: { width: 390, height: 844 } });
  const visitor = await ctx.newPage();
  await visitor.goto(BASE + "/app/profile.html");
  check(visitor.url().includes("signin.html?next=profile.html"), "signed out: profile asks you to sign in");

  // Pressed before its script loads (a slow phone), Sign in does nothing,
  // rather than put the email in the web address, where server logs keep it.
  const slow = await ctx.newPage();
  let letGo;
  const held = new Promise((r) => { letGo = r; });
  await slow.route(/\/app\/signin\.js$/, async (route) => { await held; await route.continue().catch(() => {}); });
  await slow.goto(BASE + "/app/signin.html", { waitUntil: "commit" });
  await slow.waitForSelector("#signin-submit");
  await slow.fill("#email", email("early"));
  await slow.click("#signin-submit");
  await slow.waitForTimeout(1000);
  check(slow.url() === BASE + "/app/signin.html" && (await slow.inputValue("#email")) === email("early"), "Sign in pressed early: no email in the web address: " + slow.url());
  letGo();
  await slow.close();

  // Signed in before saving a profile: signed in all the same, with Sign out.
  const fresh = await person(t, "rina", { profile: false });
  await fresh.goto(BASE + "/app/profile.html");
  const nav = await fresh.evaluate(() => [...document.querySelectorAll("header a")].map((a) => a.textContent.trim()));
  check(!nav.includes("Sign in"), "no Sign in link once signed in, even without a profile: " + JSON.stringify(nav));
  check(await fresh.isVisible("#sign-out"), "Sign out is there");
  check((await fresh.textContent("#account-email")) === fresh.address, "says who's signed in");

  // A new person: code, then their profile, email locked.
  const asha = await person(t, "asha");
  await asha.goto(BASE + "/app/profile.html"); // saving left the form
  check((await asha.getAttribute("#email", "readonly")) !== null, "profile email is the signed-in one, read-only");
  const me = await synced(asha);
  check(me.user && me.user.email === asha.address, "server knows who you are");
  check(me.data["sevak.profile.v1"].firstName === "Asha", "profile saved on the server");

  // The same person on another device sees their profile.
  const other = await (await t.browser.newContext()).newPage();
  await signIn(other, asha.address);
  check(other.url().includes("signup.html"), "with a profile, sign-in goes to opportunities");
  await other.goto(BASE + "/app/profile.html");
  check((await other.inputValue("#firstName")) === "Asha", "second device: profile is there");

  // A wrong code is refused.
  const wrong = await (await t.browser.newContext()).newPage();
  await wrong.goto(BASE + "/app/signin.html");
  await wrong.fill("#email", email("nobody"));
  await wrong.click("#signin-submit");
  await wrong.waitForSelector("#code-form:not([hidden])");
  await wrong.fill("#code", "000000");
  await wrong.click("#code-submit");
  await wrong.waitForFunction(() => document.getElementById("code-error").textContent);
  check((await wrong.textContent("#code-error")).includes("didn't work"), "wrong code refused");

  // Signing out ends that session only.
  await asha.goto(BASE + "/app/profile.html");
  await asha.click("#sign-out");
  await asha.waitForTimeout(500);
  check((await synced(asha)).user === null, "signed out on the server");
  check((await synced(other)).user !== null, "other device still signed in");
  await t.done();
})();
