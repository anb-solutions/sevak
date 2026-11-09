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
  await p.goto(BASE + 'event.html');
  check(await p.isVisible('#role-presets'), 'common roles offered');
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
  await p.fill('#title', 'Private recital');
  await p.fill('#startDate', '2030-05-10');
  await p.dispatchEvent('#startDate', 'change');
  await p.check('input[name="locationType"][value="later"]', { force: true });
  check(await p.isVisible('#locationNote') && !(await p.isVisible('#addressLine1')), 'shared later: a note instead of the address');
  await p.fill('#locationNote', 'We email the address to volunteers the day before.');
  for (const row of await p.$$('.shift-row')) {
    await (await row.$('[data-key="start"]')).fill('09:00');
    await (await row.$('[data-key="end"]')).fill('12:00');
    await (await row.$('[data-key="capacity"]')).fill('4');
  }
  await p.click('#publish');
  await p.waitForTimeout(300);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('sevak.events.v1')).find(e => e.title === 'Private recital'));
  check(saved && saved.status === 'published', 'published without an address: ' + (await p.textContent('#status')));
  check(saved && saved.location.type === 'later' && saved.location.note.includes('day before'), 'location saved as shared later');
  await p.screenshot({ path: SP + '/event-roles.png', fullPage: true });

  // Reopened, it's still "shared later"; lists say so.
  await p.goto(BASE + 'event.html?id=' + saved.id);
  check(await p.isChecked('input[name="locationType"][value="later"]'), 'reopens as shared later');
  await p.goto(BASE + 'events.html');
  check((await p.textContent('#events')).includes('Location shared later'), 'events list says shared later');
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'phone: no overflow');

  console.log(ok.length + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
