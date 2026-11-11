// The event editor: common roles in one tap, a location that's shared later,
// and every Admin (primary contact and creator too) as a possible event admin.
const { chromium } = require('playwright');
const BASE = 'http://localhost:8765/app/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; const ok = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('pageerror ' + e.message));
  const check = (c, m) => c ? ok.push(m) : errs.push('FAIL ' + m);

  // An organization whose primary contact isn't on the Team tab.
  await p.goto(BASE + 'events.html');
  await p.evaluate(() => {
    localStorage.setItem('sevak.profile.v1', JSON.stringify({ firstName: 'Rupa', lastName: 'K', email: 'contact@example.org' }));
    localStorage.setItem('sevak.organizations.v1', JSON.stringify([{ id: 'org-arts', name: 'Arts Center', createdBy: 'founder@example.org',
      primaryContact: { name: 'Rupa K', email: 'contact@example.org' }, team: [{ name: 'Cam', email: 'cam@example.org', role: 'coordinator' }] }]));
    localStorage.setItem('sevak.currentOrganization.v1', JSON.stringify('org-arts'));
  });

  // New event: the common roles; the first fills the empty Role 1.
  await p.goto(BASE + 'event.html#roles');   // the Roles step
  check(await p.isVisible('#role-presets'), 'common roles offered');
  await p.click('#role-presets summary');   // folded away until asked for
  await p.click('button[aria-label="Add the role Greeters"]');
  check((await p.$$('.role-card')).length === 1, 'fills the empty first role instead of adding one');
  check((await p.inputValue('.role-card [data-key="name"]')) === 'Greeters', 'role name filled in');
  check((await p.inputValue('.role-card [data-key="description"]')).includes('Welcome guests'), 'description filled in');
  check(!(await p.isVisible('button[aria-label="Add the role Greeters"]')), 'a role already added is no longer offered');
  await p.click('button[aria-label="Add the role Parking"]');
  check((await p.$$('.role-card')).length === 2, 'the next common role is added as a new role');
  check((await p.$$('.role-card:nth-child(2) .shift-row')).length === 1, 'with a shift to fill in');
  check((await p.inputValue('.role-card:nth-child(2) [data-key="bring"]')).includes('water'), 'with what to bring');

  // Every Admin can be the event admin, none "no longer on the team".
  const admins = await p.$$eval('#eventAdmin option', os => os.map(o => o.textContent));
  check(admins.some(t => t.includes('Rupa K') && t.includes('(Admin)')), 'primary contact listed as Admin: ' + JSON.stringify(admins));
  check(admins.some(t => t.includes('founder@example.org') && t.includes('(Admin)')), 'creator listed as Admin');
  check(admins.some(t => t.includes('Cam') && t.includes('(Coordinator)')), 'Team tab listed');
  check(!admins.some(t => t.includes('no longer on the team')), 'nobody marked as no longer on the team');

  // Location shared later: no address needed to publish.
  await p.click('#stepper button[data-step="0"]');
  await p.fill('#title', 'Private recital');
  await p.click('#step-next');
  await p.fill('#startDate', '2030-05-10');
  await p.dispatchEvent('#startDate', 'change');
  await p.check('input[name="locationType"][value="later"]', { force: true });
  check(await p.isVisible('#locationNote') && !(await p.isVisible('#addressLine1')), 'shared later: a note instead of the address');
  await p.fill('#locationNote', 'We email the address to volunteers the day before.');
  await p.click('#step-next');
  for (const row of await p.$$('.shift-row')) {
    await (await row.$('[data-key="start"]')).fill('09:00');
    await (await row.$('[data-key="end"]')).fill('12:00');
    await (await row.$('[data-key="capacity"]')).fill('4');
  }
  await p.click('#step-next');   // Review, where a draft is published
  await p.click('#publish');
  await p.waitForURL(/events\.html/);   // saving goes back to Events
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('sevak.events.v1')).find(e => e.title === 'Private recital'));
  check(saved && saved.status === 'published' && (await p.textContent('#saved-flash')).includes('Published “Private recital”'), 'published without an address');
  check(saved && saved.location.type === 'later' && saved.location.note.includes('day before'), 'location saved as shared later');
  await p.screenshot({ path: SP + '/event-roles.png', fullPage: true });

  // Reopened, it's still "shared later"; lists say so.
  await p.goto(BASE + 'event.html?id=' + saved.id);
  check(await p.isChecked('input[name="locationType"][value="later"]'), 'reopens as shared later');
  await p.goto(BASE + 'events.html');
  check((await p.textContent('#events')).includes('Location shared later'), 'events list says shared later');
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'phone: no overflow');

  // An event imported from Zeffy links volunteers back to its Zeffy page.
  await p.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('sevak.events.v1'));
    const ev = list.find(e => e.title === 'Private recital');
    ev.source = { kind: 'zeffy', id: 'c-1', url: 'https://www.zeffy.com/en-US/ticketing/private-recital' };
    list.push(Object.assign({}, ev, { id: 'ev-bad', title: 'Bad link', source: { kind: 'zeffy', url: 'javascript:alert(1)' } }));
    localStorage.setItem('sevak.events.v1', JSON.stringify(list));
  });
  await p.goto(BASE + 'signup.html?event=' + saved.id);
  await p.waitForSelector('#event-link:not([hidden])');
  check((await p.getAttribute('#event-link-a', 'href')) === 'https://www.zeffy.com/en-US/ticketing/private-recital', 'volunteers see the link to the Zeffy page');
  check((await p.textContent('#event-link-a')).includes('Zeffy'), 'says it is on Zeffy');
  check((await p.getAttribute('#event-link-a', 'rel')).includes('noopener'), 'opens safely in a new tab');
  await p.screenshot({ path: SP + '/event-zeffy-link.png' });
  await p.goto(BASE + 'signup.html?event=ev-bad');
  await p.waitForSelector('#event-title');
  check(await p.isHidden('#event-link'), 'a link that isn\'t https is not shown');

  console.log(ok.length + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
