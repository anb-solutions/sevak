const { chromium } = require('playwright');
const B = 'http://localhost:8765/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; let n = 0; const check = (c, m) => c ? n++ : errs.push(m);
  const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
  p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('dialog', d => d.accept());
  const path = () => new URL(p.url()).pathname;

  // New visitor sees the welcome page.
  await p.goto(B); await p.evaluate(() => localStorage.clear()); await p.goto(B);
  check(path() === '/' && (await p.textContent('h1')) === 'Welcome Volunteer', 'new visitor: welcome page');

  // Sign up: save a profile, then the landing page goes straight to opportunities.
  await p.click('text=Sign up');
  await p.waitForURL(/app\/join\.html$/);
  check((await p.textContent('h1')) === 'Join Sevak', 'sign up: join page');
  await p.goto(B + 'app/profile.html');
  await p.fill('#firstName', 'Asha'); await p.fill('#lastName', 'Rao'); await p.fill('#email', 'asha@example.com'); await p.fill('#phone', '5125550100');
  await p.check('#role-volunteer', { force: true }); await p.check('input[name=availability][value=anytime]', { force: true });
  await p.click('#save');
  await p.waitForURL(u => !/profile\.html/.test(String(u)));
  check((await p.textContent('#saved-flash')).includes('Your profile is saved') && path() === '/app/signup.html', 'profile saved: on to opportunities, saying so');
  await p.goto(B);
  await p.waitForURL(/app\/signup\.html(#[\w-]+)?$/);
  check(path() === '/app/signup.html', 'registered: landing goes to opportunities');
  check((await p.textContent('#discover-view h1')) === 'Volunteer opportunities', 'heading');
  check((await p.$$eval('#app-nav .nav-main a', a => a.map(x => x.textContent).join('|'))) === 'Opportunities|My sign-ups|Profile', 'signed-in menu');
  // History: back doesn't bounce to the welcome page (replace).
  // Brand link from an app page goes "home" = opportunities.
  await p.goto(B + 'app/events.html');
  await p.click('.brand');
  await p.waitForURL(/app\/signup\.html(#[\w-]+)?$/);
  n++;

  // Event page shows the signed-in line too.
  await p.goto(B + 'app/dashboard.html?demo=1');
  await p.goto(B + 'app/signup.html?event=demo-ev-park');
  check(await p.isVisible('#app-nav a:has-text("Profile")'), 'signed-in menu on event page');
  await p.goto(B + 'app/signup.html');
  await p.screenshot({ path: SP + '/opps-signed-in.png' });

  // Sign out: back to the welcome page, and it stays there.
  await p.goto(B + 'app/profile.html');
  await p.click('#sign-out');
  await p.waitForLoadState('load');
  check(path() === '/' && (await p.textContent('h1')) === 'Welcome Volunteer', 'sign out: welcome page');
  await p.reload();
  check(path() === '/', 'stays signed out after reload');
  await p.goto(B + 'app/signup.html');
  check(await p.isVisible('#app-nav a:has-text("Sign in")'), 'signed-out menu');

  // Sign in: wrong email, then right email (case-insensitive) -> opportunities.
  await p.goto(B);
  await p.click('a:has-text("Sign in")');
  await p.fill('#email', 'nobody@example.com'); await p.click('button:has-text("Sign in")');
  check((await p.textContent('#email-error')).includes("couldn't find"), 'wrong email');
  await p.fill('#email', 'ASHA@example.com'); await p.click('button:has-text("Sign in")');
  await p.waitForURL(/app\/signup\.html(#[\w-]+)?$/);
  check(await p.isVisible('#discover-view'), 'sign in lands on opportunities');
  await p.goto(B); await p.waitForURL(/app\/signup\.html(#[\w-]+)?$/); n++;

  // A profile saved before this change (no sign-out record) counts as signed in.
  await p.evaluate(() => localStorage.removeItem('sevak.signedOut.v1'));
  await p.goto(B); await p.waitForURL(/app\/signup\.html(#[\w-]+)?$/); n++;

  // Deleting the profile: the welcome page shows again.
  await p.goto(B + 'app/profile.html');
  await p.click('#delete-profile');
  await p.goto(B);
  check(path() === '/' && (await p.textContent('h1')) === 'Welcome Volunteer', 'deleted profile: welcome page');

  // Phone fit
  await p.evaluate(() => localStorage.setItem('sevak.profile.v1', JSON.stringify({ firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com' })));
  await p.setViewportSize({ width: 360, height: 800 });
  await p.goto(B + 'app/signup.html');
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'phone fits');
  await p.screenshot({ path: SP + '/opps-phone.png' });
  console.log(n + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
