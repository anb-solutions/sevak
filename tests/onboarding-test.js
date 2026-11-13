// Getting started as an organization: the welcome page offers it, the
// profile asks only what it must (availability is optional, the error is
// red, Delete my profile isn't next to Save), and a new organization's
// primary contact starts as you.
const { chromium } = require('playwright');
const B = 'http://localhost:8765/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; let n = 0; const check = (c, m) => c ? n++ : errs.push('FAIL ' + m);
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('dialog', d => d.accept());

  await p.goto(B + 'index.html'); await p.evaluate(() => localStorage.clear()); await p.goto(B + 'index.html');
  check(await p.isVisible('text=Running an organization?'), 'the welcome page speaks to organizations');
  check((await p.getAttribute('.welcome-org a', 'href')) === 'app/signin.html?next=organization.html%3Fnew%3D1', 'and goes to sign in, then a new organization');
  await p.screenshot({ path: SP + '/onboarding-home.png', fullPage: true });

  // The profile: no availability needed; the error is red; Delete is apart.
  await p.goto(B + 'app/profile.html');
  check(!(await p.$('input[name="availability"][required]')), 'availability is optional');
  await p.click('#save');
  const color = await p.$eval('#status', e => getComputedStyle(e).color);
  const danger = await p.evaluate(() => { const s = document.createElement('span'); s.className = 'error'; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; });
  check((await p.textContent('#status')).includes('Please check') && color === danger, 'a failed save says so in the error colour');
  check(!(await p.$('#save-bar #delete-profile')), 'Delete my profile is not in the save bar');
  await p.fill('#firstName', 'Asha'); await p.fill('#lastName', 'Kumar'); await p.fill('#email', 'asha@example.org'); await p.fill('#phone', '7135550100');
  await p.click('#save');
  await p.waitForURL(u => !/profile\.html/.test(String(u)));
  check(true, 'saved without availability');

  // A new organization: you're its primary contact to start with.
  await p.goto(B + 'app/organization.html?new=1');
  check((await p.inputValue('#contactName')) === 'Asha Kumar' && (await p.inputValue('#contactEmail')) === 'asha@example.org', 'the contact starts as you');
  check((await p.textContent('#save-org')) === 'Save organization', 'the button says what it saves');
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'phone: no overflow');

  console.log(n + ' ok'); console.log(errs.length ? errs.join('\n') : 'ALL PASS'); await b.close();
})();
