const { chromium } = require('playwright');
const BASE = 'http://localhost:8765/app/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; const ok = [];
  const ctx = await b.newContext({ viewport: { width: 1000, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('pageerror ' + e.message));
  p.on('dialog', d => d.accept());
  const check = (c, m) => c ? ok.push(m) : errs.push(m);
  const vis = s => p.isVisible(s);
  const setProfile = prof => p.evaluate(x => localStorage.setItem('sevak.profile.v1', JSON.stringify(x)), prof);

  await p.goto(BASE + 'dashboard.html?demo=1');
  await p.waitForSelector('#kpi-upcoming, .kpi-value');
  const kpiBefore = await p.$$eval('.kpi-value', k => k.map(x => x.textContent));
  await setProfile({ firstName: 'Cora', lastName: 'Lee', email: 'cora@example.com', roles: { volunteer: false, host: true }, organizations: [{ name: 'Riverside Community Arts (demo)', role: 'coordinator' }] });

  // Coordinator: no delete, can make inactive.
  await p.goto(BASE + 'event.html?id=demo-ev-park');
  check(!(await vis('#delete-event')), 'coordinator: no Delete button');
  check(await vis('#delete-hint'), 'coordinator: admin-only hint');
  check(await vis('#deactivate'), 'coordinator: Make inactive shown');
  await p.click('#deactivate');
  check(await vis('#inactive-note'), 'inactive notice shown');
  check(!(await vis('#deactivate')), 'Make inactive hidden once inactive');
  check(!(await vis('#volunteer-link-row')), 'sign-up link hidden when inactive');
  check((await p.textContent('#status')).includes('inactive'), 'status says inactive');
  await p.screenshot({ path: SP + '/inactive-editor.png', fullPage: false });
  // Saving edits keeps it inactive
  await p.fill('#title', 'Riverside Park Clean-up (old)');
  await p.click('#publish');
  await p.waitForURL(/events\.html/);   // saving goes back to Events
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('sevak.events.v1')).find(e => e.id === 'demo-ev-park').active === false), 'publish keeps inactive');
  await p.goto(BASE + 'event.html?id=demo-ev-park');
  check(await vis('#inactive-note'), 'inactive after reload');

  // Events list hides it.
  await p.goto(BASE + 'events.html');
  check(!(await p.textContent('#events')).includes('Clean-up (old)'), 'events list hides inactive');
  check(await vis('#show-inactive-wrap') && (await p.textContent('#inactive-count')) === '1', 'show inactive (1)');
  await p.check('#show-inactive');
  check((await p.textContent('#events')).includes('Clean-up (old)'), 'shown when ticked');
  check(await p.isVisible('.event-item.is-inactive .badge-inactive'), 'inactive badge');
  await p.screenshot({ path: SP + '/inactive-list.png', fullPage: true });

  // Dashboard excludes.
  await p.goto(BASE + 'dashboard.html');
  const kpiAfter = await p.$$eval('.kpi-value', k => k.map(x => x.textContent));
  console.log(kpiBefore, kpiAfter);
  check(Number(kpiAfter[0]) === Number(kpiBefore[0]) - 1, 'dashboard upcoming drops by one');
  check(!(await p.textContent('main')).includes('Clean-up'), 'dashboard hides event');

  // Volunteer side.
  await p.goto(BASE + 'signup.html');
  check(!(await p.textContent('main')).includes('Clean-up'), 'discover hides inactive');
  await p.goto(BASE + 'signup.html?event=demo-ev-park');
  check((await p.textContent('#notice')).includes('no longer available') && !(await vis('#event-view')), 'sign-up page blocked');
  const reg = await p.evaluate(() => JSON.parse(localStorage.getItem('sevak.signups.v1')).find(s => s.eventId === 'demo-ev-park').registrationId);
  await p.goto(BASE + 'signup.html?registration=' + reg);
  check((await p.textContent('#notice')).includes('no longer active') && await vis('#confirm-view'), 'manage page notes inactive');

  // Main event: inactive sub hidden, coordinator can't delete.
  await p.goto(BASE + 'event.html?id=demo-ev-reh2');
  await p.click('#deactivate');
  await p.goto(BASE + 'main-event.html?id=demo-main-arudra');
  check(!(await p.textContent('#sub-list')).includes('Rehearsal 2'), 'main event hides inactive sub');
  check((await p.textContent('#subs-summary')).includes('1 inactive'), 'main summary counts inactive');
  check(!(await vis('#delete-main')) && await vis('#delete-hint'), 'coordinator: no main delete');
  await p.check('#show-inactive');
  check((await p.textContent('#sub-list')).includes('Rehearsal 2'), 'main shows inactive when ticked');

  // Reactivate.
  await p.goto(BASE + 'event.html?id=demo-ev-reh2');
  await p.click('#reactivate');
  check(await vis('#deactivate') && !(await vis('#inactive-note')), 'reactivated');
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('sevak.events.v1')).find(e => e.id === 'demo-ev-reh2').status === 'published'), 'keeps published status');

  // Admin via profile.
  await setProfile({ firstName: 'Ada', email: 'ada@example.com', roles: { volunteer: false, host: true }, organizations: [{ name: 'riverside community arts (demo)', role: 'admin' }] });
  await p.goto(BASE + 'event.html?id=demo-ev-park');
  check(await vis('#delete-event') && !(await vis('#delete-hint')), 'admin (profile): Delete shown');
  await p.click('#delete-event');
  await p.waitForURL(/events\.html/);
  check(await p.evaluate(() => !JSON.parse(localStorage.getItem('sevak.events.v1')).some(e => e.id === 'demo-ev-park')), 'admin deleted event');
  await p.goto(BASE + 'main-event.html?id=demo-main-food');
  check(await vis('#delete-main'), 'admin: main delete shown');

  // Admin via team list email; coordinator via team list.
  await setProfile({ firstName: 'Tess', email: 'Tess@Example.com' });
  await p.evaluate(() => { const l = JSON.parse(localStorage.getItem('sevak.organizations.v1')); l.find(o => o.id === 'demo-org').team = [{ name: 'Tess', email: 'tess@example.com', role: 'admin' }]; localStorage.setItem('sevak.organizations.v1', JSON.stringify(l)); });
  await p.goto(BASE + 'event.html?id=demo-ev-reh1');
  check(await vis('#delete-event'), 'admin via Team tab');
  await setProfile({ email: 'nobody@example.com' });
  await p.reload();
  check(!(await vis('#delete-event')) && await vis('.way-in'), 'unlisted person: not on this team');

  // Creator is admin.
  await setProfile({ firstName: 'Neo', email: 'neo@example.com', roles: { volunteer: true, host: false } });
  await p.goto(BASE + 'organization.html?new=1');
  const created = await p.evaluate(() => { const O = window.SevakOrgs; const o = O.save({ name: 'Neo Org' }); O.setCurrent(o.id); return o; });
  check(created.createdBy === 'neo@example.com', 'createdBy recorded');
  const resaved = await p.evaluate(id => window.SevakOrgs.save({ id, name: 'Neo Org 2' }), created.id);
  check(resaved.createdBy === 'neo@example.com', 'createdBy kept on later save');
  check(await p.evaluate(id => window.SevakOrgs.isAdmin(window.SevakOrgs.get(id)), created.id), 'creator is admin');

  // Phone fit.
  await p.setViewportSize({ width: 360, height: 800 });
  await p.goto(BASE + 'event.html?id=demo-ev-reh1');
  await p.evaluate(() => { const l = JSON.parse(localStorage.getItem('sevak.organizations.v1')); l.find(o => o.id === 'demo-org').team = [{ name: 'Neo', email: 'neo@example.com', role: 'coordinator' }]; localStorage.setItem('sevak.organizations.v1', JSON.stringify(l)); });
  await p.reload();
  await p.click('#deactivate');
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'phone: no overflow');
  await p.screenshot({ path: SP + '/inactive-phone.png', fullPage: true });

  console.log(ok.length + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
