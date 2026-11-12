// Editing an event: from the Events list, from the volunteer view (team
// only), and the way in when you're not on the team.
const { chromium } = require('playwright');
const B = 'http://localhost:8765/app/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; let n = 0; const check = (c, m) => c ? n++ : errs.push(m);
  const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
  p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('dialog', d => d.accept());

  await p.goto(B + 'signup.html'); await p.evaluate(() => localStorage.clear());
  await p.evaluate(() => localStorage.setItem('sevak.profile.v1', JSON.stringify({ firstName: 'Bala', lastName: 'A', email: 'bala@example.com', roles: { volunteer: true } })));
  await p.goto(B + 'dashboard.html?demo=1');   // signed in: Admin of Riverside

  // From Manage → Events
  await p.goto(B + 'events.html');
  await p.click('#events a:has-text("Riverside Park Clean-up")');
  await p.waitForURL(/event\.html\?id=demo-ev-park/);
  check(await p.isVisible('#event-form') && await p.isEditable('#title'), 'events list opens the editor');
  await p.fill('#title', 'Riverside Park Clean-up (edited)');
  await p.click('#publish');
  await p.waitForURL(/events\.html/);
  check((await p.textContent('#saved-flash')).includes('Saved changes to “Riverside Park Clean-up (edited)”') && (await p.$$('.just-saved')).length === 1, 'saved: back on Events, saying so, the event highlighted');
  await p.goto(B + 'events.html');
  check((await p.textContent('#events')).includes('Riverside Park Clean-up (edited)'), 'edit shows in the list');

  // Every event card has an Edit button (the name is a link too, but on a
  // phone nothing shows that), drafts and sub-events included; main events too.
  await p.setViewportSize({ width: 390, height: 844 });
  const cards = await p.$$eval('#events .event-item', li => li.map(x => !!x.querySelector('a.event-edit[href^="event.html?id="]')));
  check(cards.length > 3 && cards.every(Boolean), 'Events: an Edit button on every event card (' + cards.length + ')');
  check(await p.isVisible('[data-event-id="demo-ev-dress"] a.event-edit'), 'Edit shows on a phone, on a draft sub-event too');
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'Events: fits at 390px');
  await p.screenshot({ path: SP + '/edit-buttons-events.png' });
  await p.click('.main-group[data-main-id="demo-main-arudra"] .main-actions a:has-text("Edit")');
  await p.waitForURL(/main-event\.html\?id=demo-main-arudra/);
  check(await p.isVisible('#main-form'), 'a main event\'s Edit opens it');
  const draft = await p.evaluate(() => JSON.parse(localStorage.getItem('sevak.events.v1')).find(e => e.mainEventId === 'demo-main-arudra' && e.status === 'draft'));
  check(!!draft, 'the festival has a draft sub-event: ' + (draft && draft.title));
  const draftEdit = '[data-event-id="' + draft.id + '"] a.event-edit';
  check(await p.isVisible(draftEdit) && (await p.getAttribute(draftEdit, 'aria-label')) === 'Edit ' + draft.title, 'the draft sub-event has an Edit button, named for it');
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'main event: fits at 390px');
  await p.screenshot({ path: SP + '/edit-buttons-main.png', fullPage: true });
  await p.click(draftEdit);
  await p.waitForURL(new RegExp('event\\.html\\?id=' + draft.id));
  check((await p.inputValue('#title')) === draft.title && (await p.textContent('#save-draft')) === 'Save draft', 'Edit opens the draft in the editor');
  await p.setViewportSize({ width: 1000, height: 900 });

  // From the volunteer view: an Edit link for the team
  await p.goto(B + 'signup.html?event=demo-ev-park');
  check(await p.isVisible('#team-edit-hint') && (await p.textContent('#team-edit-hint')).includes("You're an Admin here"), 'admin: edit hint on the volunteer view');
  await p.screenshot({ path: SP + '/edit-hint.png', clip: { x: 0, y: 0, width: 1000, height: 420 } });
  await p.click('#team-edit-hint a');
  await p.waitForURL(/event\.html\?id=demo-ev-park/);
  check(await p.isVisible('#event-form'), 'hint link opens the editor');

  // Not on the pantry's team: no hint, and the way in explains
  await p.goto(B + 'signup.html?event=demo-ev-restock');
  check(await p.isHidden('#team-edit-hint'), 'not on the team: no edit hint');
  await p.goto(B + 'event.html?id=demo-ev-restock');
  check((await p.textContent('#way-in-title')) === "You're not on this team" && (await p.textContent('.way-in .page-intro')).includes('Only the Admins and Coordinators of Eastside Food Pantry (demo)'), 'way in says who can edit');
  await p.screenshot({ path: SP + '/edit-way-in.png', fullPage: true });
  await p.click('.way-in-demo button');
  await p.waitForSelector('#event-form:not([hidden])');
  check(await p.isEditable('#title') && (await p.inputValue('#title')) === 'Pantry Restock Night', 'demo: add me as Admin, then edit');
  const team = await p.evaluate(() => JSON.parse(localStorage.getItem('sevak.organizations.v1')).find(o => o.id === 'demo-org-2').team);
  check(team.length === 1 && team[0].role === 'admin' && team[0].email === 'bala@example.com', 'added to the pantry team once');

  // A real (non-demo) organization: no demo button
  await p.evaluate(() => { const l = JSON.parse(localStorage.getItem('sevak.organizations.v1')); l.push({ id: 'org-x', name: 'Other Org', team: [] }); localStorage.setItem('sevak.organizations.v1', JSON.stringify(l));
    const ev = JSON.parse(localStorage.getItem('sevak.events.v1')); ev.push({ id: 'ev-x', organizationId: 'org-x', title: 'X', status: 'published', startDate: '2030-01-01', endDate: '2030-01-01', roles: [] }); localStorage.setItem('sevak.events.v1', JSON.stringify(ev)); });
  await p.goto(B + 'event.html?id=ev-x');
  check(await p.isVisible('.way-in') && !(await p.$('.way-in-demo')), 'real org: no demo shortcut');

  // Coordinator sees the hint too; someone off the team doesn't (the pantry:
  // Riverside's creator is always its Admin)
  const setPantryTeam = t => p.evaluate(t => { const l = JSON.parse(localStorage.getItem('sevak.organizations.v1')); l.find(o => o.id === 'demo-org-2').team = t; localStorage.setItem('sevak.organizations.v1', JSON.stringify(l)); }, t);
  await setPantryTeam([{ name: 'Bala A', email: 'bala@example.com', role: 'coordinator' }]);
  await p.goto(B + 'signup.html?event=demo-ev-restock');
  check((await p.textContent('#team-edit-hint')).includes("You're a Coordinator here"), 'coordinator hint');
  await setPantryTeam([]);
  await p.goto(B + 'signup.html?event=demo-ev-restock');
  check(await p.isHidden('#team-edit-hint'), 'off the team: no hint');

  // Phone fit
  await p.setViewportSize({ width: 360, height: 800 });
  await p.goto(B + 'signup.html?event=demo-ev-park');
  check(await p.isVisible('#team-edit-hint') && !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'phone: hint fits');
  console.log(n + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
