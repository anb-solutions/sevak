// Fixes from the first pilot walk-through: an unverified organization's
// public event says it's for members only (badge, editor, Copy link); a new
// event can't start in the past; a new shift follows on from the last; a
// shift that's over says Ended; and a link to an event you can't see says
// why, instead of "removed".
const { chromium } = require('playwright');
const B = 'http://localhost:8765/app/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; let n = 0; const check = (c, m) => c ? n++ : errs.push('FAIL ' + m);
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('dialog', d => d.accept());
  const pad = x => String(x).padStart(2, '0');
  const dayOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = dayOf(new Date());
  const yesterday = dayOf(new Date(Date.now() - 86400000));
  const nextMonth = dayOf(new Date(Date.now() + 30 * 86400000));

  await p.goto(B + 'events.html');
  await p.evaluate(([today, yesterday, nextMonth]) => {
    localStorage.clear();
    localStorage.setItem('sevak.profile.v1', JSON.stringify({ firstName: 'Asha', lastName: 'K', email: 'asha@example.org' }));
    localStorage.setItem('sevak.organizations.v1', JSON.stringify([{ id: 'org-1', name: 'Arts Center', createdBy: 'asha@example.org', team: [] }]));
    localStorage.setItem('sevak.currentOrganization.v1', JSON.stringify('org-1'));
    localStorage.setItem('sevak.events.v1', JSON.stringify([
      { id: 'ev-open', organizationId: 'org-1', title: 'Concert', status: 'published', visibility: 'public', active: true, startDate: nextMonth, endDate: nextMonth, timezone: 'UTC', location: { type: 'later' },
        roles: [{ id: 'r1', name: 'Door', shifts: [{ id: 's1', date: nextMonth, start: '17:00', end: '20:00', capacity: 3 }] }] },
      { id: 'ev-today', organizationId: 'org-1', title: 'Morning seva', status: 'published', visibility: 'public', active: true, startDate: yesterday, endDate: today, timezone: 'UTC', location: { type: 'later' },
        roles: [{ id: 'r2', name: 'Kitchen', shifts: [{ id: 's-old', date: yesterday, start: '09:00', end: '10:00', capacity: 3 }, { id: 's-new', date: today, start: '23:58', end: '23:59', capacity: 3 }] }] }]));
  }, [today, yesterday, nextMonth]);

  // Unverified: the public event is for members only, and says so.
  await p.goto(B + 'events.html');
  const card = await p.textContent('li[data-event-id="ev-open"]');
  check(card.includes('Members only') && !card.includes('Public'), 'badge: members only until verified: ' + card);
  await p.goto(B + 'event.html?id=ev-open');
  check(await p.isVisible('#copy-volunteer-link'), 'a Copy link button for a published event');
  check((await p.textContent('#volunteer-link-hint')).includes('Only people who have joined your organization'), 'says who can open the link');
  await p.click('#copy-volunteer-link');
  await p.waitForFunction(() => document.getElementById('volunteer-link-hint').textContent.startsWith('Copied.'));
  check((await p.evaluate(() => navigator.clipboard.readText())).endsWith('/app/signup.html?event=ev-open'), 'copies the sign-up link');
  // Verified, it's public.
  await p.evaluate(() => { const o = JSON.parse(localStorage.getItem('sevak.organizations.v1')); o[0].verificationStatus = 'verified'; localStorage.setItem('sevak.organizations.v1', JSON.stringify(o)); });
  await p.goto(B + 'events.html');
  check((await p.textContent('li[data-event-id="ev-open"]')).includes('Public'), 'verified: Public');
  await p.goto(B + 'event.html?id=ev-open');
  check((await p.textContent('#volunteer-link-hint')).includes('Share this link with volunteers.'), 'verified and public: share it');

  // A new event can't start in the past.
  await p.goto(B + 'event.html');
  await p.fill('#title', 'Too late');
  await p.click('#step-next');
  await p.fill('#startDate', yesterday);
  await p.dispatchEvent('#startDate', 'change');
  await p.click('#step-next');
  check((await p.textContent('#step-when')).includes('This date has passed'), 'a start date in the past is refused');

  // + Add a shift follows on from the last one.
  await p.fill('#startDate', nextMonth);
  await p.dispatchEvent('#startDate', 'change');
  await p.check('input[name="locationType"][value="later"]', { force: true });
  await p.click('#step-next');
  const row = await p.$('.role-card .shift-row');
  await (await row.$('[data-key="start"]')).fill('09:00');
  await (await row.$('[data-key="end"]')).fill('11:30');
  await p.click('.role-card .add-shift');
  const second = await p.$$eval('.role-card .shift-row', rows => rows.map(r => r.querySelector('[data-key="start"]').value + '-' + r.querySelector('[data-key="end"]').value));
  check(second[1] === '11:30-14:00', 'the next shift starts when the last ends, as long: ' + JSON.stringify(second));
  await p.screenshot({ path: SP + '/pilot-shifts.png', fullPage: true });

  // A shift that's over says Ended and can't be picked; today's still open.
  await p.goto(B + 'signup.html?event=ev-today');
  await p.waitForSelector('#shift-groups');
  const old = await p.$('input[value="s-old"]');
  check(old && await old.isDisabled(), 'yesterday\'s shift can\'t be picked');
  check((await p.textContent('#shift-groups')).includes('Ended'), 'and says Ended');

  // A link to an event you can't see: why, and what to do.
  await p.goto(B + 'signup.html?event=ev-missing');
  const signedIn = await p.textContent('#notice');
  check(signedIn.includes("only for members of an organization you haven't joined") && signedIn.includes('Join an organization'), 'signed in: maybe members only; join first: ' + signedIn);
  await p.evaluate(() => localStorage.setItem('sevak.signedOut.v1', 'true'));
  await p.goto(B + 'signup.html?event=ev-missing');
  check((await p.textContent('#notice')).includes('may be only for members') &&
    (await p.getAttribute('#notice a', 'href')) === 'signin.html?next=' + encodeURIComponent('signup.html?event=ev-missing'), 'signed out: sign in, and come back');
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'phone: no overflow');

  console.log(n + ' ok'); console.log(errs.length ? errs.join('\n') : 'ALL PASS'); await b.close();
})();
