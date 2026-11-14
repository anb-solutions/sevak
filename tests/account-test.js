// Who's signed in: a circle at the header's top right, on every page with
// the menu. Initials (or the profile photo), named for screen readers, and
// it opens My profile. Nothing when signed out. Level with the Sevak name at
// the top right at every width, whatever wraps.
const { chromium } = require('playwright');
const B = 'http://localhost:8765/app/'; const SP = process.argv[2];
const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
(async () => {
  const b = await chromium.launch(); const errs = []; let n = 0; const check = (c, m) => c ? n++ : errs.push(m);
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', e => errs.push('pageerror ' + e.message));
  const box = s => p.$eval(s, e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right }; });
  const fits = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  const setProfile = (v) => p.evaluate(v => { localStorage.setItem('sevak.profile.v1', JSON.stringify(v)); localStorage.removeItem('sevak.signedOut.v1'); }, v);

  // ----- Signed out: no circle -----
  await p.goto(B + 'outbox.html'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + 'signup.html');
  check(!(await p.$('#account-chip')), 'signed out: no circle');

  // ----- Signed in: initials, named, beside the name on a phone -----
  await setProfile({ firstName: 'Bala', lastName: 'Anand', email: 'bala@example.com', phone: '+17135550100', roles: { volunteer: true } });
  await p.goto(B + 'signup.html');
  check((await p.textContent('#account-chip')) === 'BA', 'initials: ' + await p.textContent('#account-chip'));
  check((await p.getAttribute('#account-chip', 'aria-label')) === 'Signed in as Bala Anand. My profile' && (await p.getAttribute('#account-chip', 'title')).includes('bala@example.com'), 'named for screen readers, email on hover');
  const brand = await box('.brand'), chip = await box('#account-chip');
  check(Math.abs((chip.y + chip.h / 2) - (brand.y + brand.h / 2)) < 12 && chip.right <= 390 - 12 && chip.x > brand.x + brand.w, 'phone: on the same row as the name, at the right');
  check(chip.w >= 36 && chip.h >= 36, 'big enough to tap');
  check(await fits(), 'fits at 390px');
  await p.screenshot({ path: SP + '/account-phone.png' });

  // ----- A Manage page on a phone: still beside the name, the links below -----
  await p.goto(B + 'dashboard.html?demo=1');   // adds Bala to Riverside's team
  await p.goto(B + 'events.html');
  const chip2 = await box('#account-chip'), nav = await box('#app-nav'), brand2 = await box('.brand');
  check(Math.abs((chip2.y + chip2.h / 2) - (brand2.y + brand2.h / 2)) < 12 && nav.y > chip2.y + chip2.h - 4, 'Manage page: the circle by the name, the Manage links underneath');
  check(await fits(), 'Manage page fits at 390px');
  check(await p.$eval('.nav-manage', m => m.scrollWidth <= m.clientWidth), 'the Manage links keep their full width (nothing cut off)');
  await p.screenshot({ path: SP + '/account-manage.png' });

  // ----- It opens My profile, by keyboard too -----
  await p.focus('#account-chip');
  await Promise.all([p.waitForURL(/profile\.html/), p.keyboard.press('Enter')]);
  check((await p.getAttribute('#account-chip', 'aria-current')) === 'page', 'on My profile it is the current page');

  // ----- A photo instead of initials -----
  await setProfile({ firstName: 'Bala', lastName: 'Anand', email: 'bala@example.com', phone: '+17135550100', photo: DOT, roles: { volunteer: true } });
  await p.goto(B + 'signup.html?view=mine');
  check((await p.getAttribute('#account-chip img', 'src')) === DOT && (await p.getAttribute('#account-chip img', 'alt')) === '' && !(await p.$('#account-chip .account-initials')), 'the profile photo, with the name on the link');

  // ----- Only an email: its first letter -----
  await setProfile({ email: 'zoe@example.com', roles: { volunteer: true } });
  await p.goto(B + 'signup.html');
  check((await p.textContent('#account-chip')) === 'Z' && (await p.getAttribute('#account-chip', 'aria-label')).includes('zoe@example.com'), 'no name yet: the email\'s first letter');

  // ----- Signed out again: gone -----
  await p.evaluate(() => localStorage.setItem('sevak.signedOut.v1', 'true'));
  await p.goto(B + 'signup.html');
  check(!(await p.$('#account-chip')), 'after signing out: no circle');

  // ----- Wider screens: pinned to the top right; only the menu wraps -----
  // (700px, or a wider font, is too narrow for the name, the menu and the
  // circle on one row: the circle must not drop onto a row of its own.)
  await setProfile({ firstName: 'Bala', lastName: 'Anand', email: 'bala@example.com', phone: '+17135550100', roles: { volunteer: true } });
  for (const [w, font] of [[1280, ''], [700, ''], [1280, 'DejaVu Sans']]) {
    await p.setViewportSize({ width: w, height: 800 });
    await p.goto(B + 'signup.html');
    if (font) await p.addStyleTag({ content: '* { font-family: "' + font + '", sans-serif !important; }' });
    const c = await box('#account-chip'), menu = await box('#app-nav'), row = await box('.header-row'), name = await box('.brand');
    const label = w + 'px' + (font ? ' in ' + font : '');
    check(Math.abs(c.right - row.right) < 2 && Math.abs((c.y + c.h / 2) - (name.y + name.h / 2)) < 12, label + ': at the top right, level with the name');
    check(menu.right <= c.x + 1 || menu.y >= c.y + c.h - 1, label + ': the menu doesn\'t run under it');
    if (w === 1280 && !font) await p.screenshot({ path: SP + '/account-wide.png' });
  }

  console.log(n + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
