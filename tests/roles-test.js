const { chromium } = require('playwright');
const B = 'http://localhost:8765/app/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; let n = 0; const check = (c, m) => c ? n++ : errs.push(m);
  const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
  p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('dialog', d => d.accept());
  // The header as you see it: links and labels, with the closed "⋯" menu as ⋯.
  const navText = () => p.$$eval('#app-nav > *', g => g.flatMap(x => x.classList.contains('nav-more') ? ['⋯'] : [...x.querySelectorAll('a, .nav-label')].map(a => a.firstChild.textContent)).join('|'));
  const ls = (k, v) => p.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [k, v]);
  const get = k => p.evaluate(k => JSON.parse(localStorage.getItem(k)), k);

  await p.goto(B + 'signup.html'); await p.evaluate(() => localStorage.clear());

  // ----- Signed out -----
  await p.goto(B + 'signup.html');
  check((await navText()) === 'Opportunities|Join|Sign in', 'signed out menu: ' + await navText());
  await p.goto(B + 'dashboard.html?demo=1');   // loaded while signed out: nobody added
  check((await get('sevak.organizations.v1'))[0].team.length === 0, 'demo while signed out adds nobody');
  await p.goto(B + 'events.html');
  check((await navText()) === 'Opportunities|Join|Sign in|Manage|Events|Volunteers|Dashboard|Organization', 'signed out on a manage page: preview menu ' + await navText());
  check((await p.textContent('.banner')).includes('previewing') && await p.isVisible('#events'), 'preview note, page shows');

  // ----- Sign up as a volunteer -----
  await p.goto(B + 'profile.html');
  check(await p.isChecked('#role-volunteer'), 'new profile: I volunteer ticked');
  check(!(await p.isVisible('#role-host')), 'no host checkbox');
  check((await p.textContent('#setup-org-row')).includes('Save your profile first'), 'set up needs a saved profile');
  await p.fill('#firstName', 'Vera'); await p.fill('#lastName', 'Vol'); await p.fill('#email', 'vera@example.com'); await p.fill('#phone', '5125550101');
  await p.check('input[name=availability][value=anytime]', { force: true });
  await p.click('#save');
  await p.waitForURL(u => !/profile\.html/.test(String(u)));
  check((await p.textContent('#saved-flash')).includes('Your profile is saved'), 'saved, and left the form');
  check((await navText()) === 'Opportunities|My sign-ups|Profile', 'volunteer menu: ' + await navText());
  await p.goto(B + 'profile.html');
  check(await p.isVisible('#team-empty') && await p.isVisible('#setup-org') && (await p.textContent('#join-email')) === 'vera@example.com', 'no teams + doors');

  // Manage pages show the way in
  for (const pg of ['events.html', 'dashboard.html', 'organization.html', 'event.html?id=demo-ev-park', 'main-event.html?id=demo-main-arudra']) {
    await p.goto(B + pg);
    const title = await p.textContent('#way-in-title').catch(() => '');
    const expect = pg.includes('?id=') ? "You're not on this team" : 'Manage an organization';
    check(title === expect, pg + ' way in: ' + title);
    const contentVisible = await p.evaluate(() => [...document.querySelector('main').children].filter(c => !c.hidden && !c.classList.contains('banner') && !c.classList.contains('way-in') && !c.classList.contains('team-notice')).length);
    check(contentVisible === 0, pg + ' content hidden');
  }
  await p.goto(B + 'events.html');
  check((await p.textContent('.way-in')).includes('vera@example.com'), 'way in names your email');
  await p.screenshot({ path: SP + '/way-in.png', fullPage: true });

  // ----- Set up your organization -----
  await p.click('.way-in a:has-text("Set up your organization")');
  await p.waitForURL(/organization\.html\?new=1/);
  check(await p.isVisible('#org-form'), 'new org form opens');
  await p.evaluate(() => { const o = SevakOrgs.save({ name: 'Vera Food Bank' }); SevakOrgs.setCurrent(o.id); SevakNav.render(); });
  check((await navText()).includes('Manage|Events|Volunteers|Dashboard|Organization'), 'Manage appears after creating');
  await p.goto(B + 'signup.html');
  check((await navText()) === 'Opportunities|My sign-ups|Profile|⋯', 'elsewhere Manage is under ⋯: ' + await navText());
  await p.click('#nav-more-btn');
  check(await p.isVisible('#nav-more-menu a:has-text("Volunteers")'), '⋯ opens the Manage links');
  await p.keyboard.press('Escape');
  check(await p.isHidden('#nav-more-menu') && await p.evaluate(() => document.activeElement.id) === 'nav-more-btn', 'Escape closes ⋯');
  await p.goto(B + 'events.html');
  check(await p.isVisible('#events') && (await p.textContent('#org-context')).includes('Vera Food Bank'), 'events for own org');
  check(!(await p.isVisible('.team-notice')), 'no "added" notice for your own org');
  check(JSON.stringify(await p.$$eval('#org-switch option', o => o.map(x => x.textContent))) === '["Vera Food Bank"]', 'switcher: only your orgs');

  // ----- Added to the demo team as Coordinator by its Admin -----
  await p.evaluate(() => { const l = JSON.parse(localStorage.getItem('sevak.organizations.v1')); l.find(o => o.id === 'demo-org').team = [{ name: 'Vera Vol', email: 'VERA@example.com', role: 'coordinator' }]; localStorage.setItem('sevak.organizations.v1', JSON.stringify(l)); });
  await p.goto(B + 'signup.html');
  check(await p.isVisible('.team-notice') && (await p.textContent('.team-notice')).includes('Riverside Community Arts (demo) as a Coordinator'), 'added notice');
  await p.reload();
  check(!(await p.isVisible('.team-notice')), 'notice shown once');
  // Organization page is view-only for Coordinators
  await p.evaluate(() => SevakOrgs.setCurrent('demo-org'));
  await p.goto(B + 'organization.html');
  check(await p.isVisible('#readonly-note') && await p.isDisabled('#orgName') && !(await p.isVisible('#save-bar')), 'coordinator: view-only');
  await p.click('#tab-team');
  check(await p.isDisabled('#add-member'), 'coordinator cannot add team members');
  check(!(await p.isVisible('#save-bar')), 'still no save bar on team tab');
  await p.click('#tab-documents');
  check(await p.isEnabled('#panel-documents .docs-add'), 'coordinator can add documents');
  await p.screenshot({ path: SP + '/coordinator-org.png' });
  // Event of the demo: coordinator can open, not delete
  await p.goto(B + 'event.html?id=demo-ev-park#review');   // where Delete would be
  check(await p.isVisible('#event-form') && await p.isVisible('#manage-event') && !(await p.isVisible('#delete-event')), 'coordinator opens event, no delete');

  // ----- My profile: team list, Leave -----
  await p.goto(B + 'profile.html');
  const items = await p.$$eval('.team-item', li => li.map(x => x.textContent));
  check(items.length === 2 && items[0].includes('Riverside Community Arts (demo)') && items[0].includes('Coordinator') && items[1].includes('Vera Food Bank') && items[1].includes('Admin'), 'team list ' + items);
  await p.click('button[aria-label="Leave the team of Vera Food Bank"]');
  check((await p.textContent('#team-status')).includes('only Admin'), 'only admin cannot leave');
  await p.click('button[aria-label="Leave the team of Riverside Community Arts (demo)"]');
  check((await p.textContent('#team-status')).includes("You've left") && (await p.$$('.team-item')).length === 1, 'left demo team');
  await p.goto(B + 'event.html?id=demo-ev-park');
  check((await p.textContent('#way-in-title')) === "You're not on this team", 'after leaving: not on this team');
  check((await p.textContent('.way-in-back')).includes("Go to your organizations' events"), 'link to your own orgs');
  // Manage link sets the org
  await p.goto(B + 'profile.html');
  await p.click('a[aria-label="Manage Vera Food Bank"]');
  await p.waitForURL(/events\.html/);
  check((await p.textContent('#org-context')).includes('Vera Food Bank'), 'manage link');

  // ----- Demo loaded while signed in makes you its Admin -----
  await p.goto(B + 'dashboard.html?demo=1');
  check(await p.isVisible('#dashboard'), 'demo dashboard opens');
  const demo = (await get('sevak.organizations.v1')).find(o => o.id === 'demo-org');
  check(demo.team.some(m => m.email === 'vera@example.com' && m.role === 'admin'), 'demo adds you as admin');

  // ----- Old self-declared roles move onto the Team tab -----
  await p.evaluate(() => { const l = JSON.parse(localStorage.getItem('sevak.organizations.v1')); l.find(o => o.id === 'demo-org').team = []; localStorage.setItem('sevak.organizations.v1', JSON.stringify(l));
    const pr = JSON.parse(localStorage.getItem('sevak.profile.v1')); pr.organizations = [{ name: 'riverside community arts (demo)', role: 'admin' }, { name: 'Nowhere Club', role: 'admin' }]; localStorage.setItem('sevak.profile.v1', JSON.stringify(pr)); });
  await p.goto(B + 'events.html');
  const migrated = (await get('sevak.organizations.v1')).find(o => o.id === 'demo-org').team;
  check(migrated.length === 1 && migrated[0].email === 'vera@example.com' && migrated[0].role === 'admin', 'migrated to team');
  check(!(await get('sevak.profile.v1')).organizations, 'profile list removed');

  // ----- Sign out: back to the public menu -----
  await p.goto(B + 'profile.html'); await p.click('#sign-out'); await p.waitForLoadState('load');
  await p.goto(B + 'signup.html');
  check((await navText()) === 'Opportunities|Join|Sign in', 'signed out again');

  // ----- Phone -----
  await p.goto(B + 'signin.html'); await p.fill('#email', 'vera@example.com'); await p.click('button:has-text("Sign in")'); await p.waitForURL(/signup\.html/);
  await p.setViewportSize({ width: 360, height: 800 });
  await p.goto(B + 'events.html');
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'phone fits');
  const rows = await p.$$eval('#app-nav .nav-group', g => g.map(x => Math.round(x.getBoundingClientRect().top)));
  check(rows.length === 2 && rows[1] > rows[0], 'phone: Manage on its own row');
  await p.screenshot({ path: SP + '/nav-phone.png', clip: { x: 0, y: 0, width: 360, height: 220 } });
  await p.setViewportSize({ width: 1000, height: 900 });
  await p.screenshot({ path: SP + '/nav-desktop.png', clip: { x: 0, y: 0, width: 1000, height: 160 } });

  console.log(n + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
