// Manage side with the demo: dashboard numbers, events, main events, the
// organization switcher and the Volunteers page across two organizations.
const { chromium } = require('playwright');
const B = 'http://localhost:8765/app/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; let n = 0; const check = (c, m) => c ? n++ : errs.push(m);
  const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
  p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('dialog', d => d.accept());
  const num = async id => Number((await p.textContent('#' + id)).replace(/[^\d.]/g, ''));

  await p.goto(B + 'signup.html'); await p.evaluate(() => localStorage.clear());
  // Signed in as Bala, then load the demo: Bala becomes its Admin.
  await p.evaluate(() => { localStorage.setItem('sevak.profile.v1', JSON.stringify({ firstName: 'Bala', lastName: 'A', email: 'bala@example.com', roles: { volunteer: true } })); });
  await p.goto(B + 'dashboard.html?demo=1');
  check(await p.isVisible('#dashboard') && (await p.textContent('#org-context')).includes('Riverside Community Arts (demo)'), 'demo dashboard for Riverside');
  const ev = await num('kpi-events'), req = await num('kpi-required'), enr = await num('kpi-enrolled'), open = await num('kpi-open');
  check(ev > 0 && req > 0 && enr > 0 && enr <= req, `kpis ${ev} ${req} ${enr} ${open}`);
  check(open === req - enr || open <= req, 'open spots add up');
  check(!/NaN|undefined/.test(await p.textContent('#dashboard')), 'no NaN on the dashboard');
  check((await p.$$('#bars > *')).length > 0, 'chart has bars');
  await p.click('#view-table');
  check((await p.$$('#table-body tr')).length > 0, 'table view rows');
  await p.screenshot({ path: SP + '/manage-dashboard.png', fullPage: true });

  // The pantry demo has no team for you (join it with PANTRY instead).
  check(JSON.stringify(await p.$$eval('#org-switch option', o => o.map(x => x.value))) === '["demo-org"]', 'switcher: only the org you help run');
  // Put Bala on the pantry's team as Coordinator: the switcher offers both.
  await p.evaluate(() => { const l = JSON.parse(localStorage.getItem('sevak.organizations.v1')); l.find(o => o.id === 'demo-org-2').team = [{ name: 'Bala A', email: 'bala@example.com', role: 'coordinator' }]; localStorage.setItem('sevak.organizations.v1', JSON.stringify(l)); });
  await p.reload();
  const opts = await p.$$eval('#org-switch option', o => o.map(x => x.textContent));
  check(opts.length === 2 && opts.some(o => o.includes('Riverside')) && opts.some(o => o.includes('Eastside Food Pantry')), 'switcher: two orgs ' + opts);

  // Events: Riverside's events, grouped under the main event.
  await p.goto(B + 'events.html');
  const rivTitles = await p.$$eval('#events h3, #events .event-title', h => h.map(x => x.textContent));
  check(rivTitles.some(t => t.includes('Riverside Park Clean-up')) && !rivTitles.some(t => t.includes('Pantry Restock')), 'Riverside events only');
  check(await p.isVisible('#main-groups') && (await p.textContent('#main-groups')).includes('Arudra'), 'main event group');
  // Switch to the pantry
  await p.selectOption('#org-switch', 'demo-org-2');
  await p.waitForLoadState('load');
  await p.waitForFunction(() => document.getElementById('org-context').textContent.includes('Eastside'));
  const panTitles = await p.$$eval('#events h3, #events .event-title', h => h.map(x => x.textContent));
  check(panTitles.some(t => t.includes('Pantry Restock Night')) && !panTitles.some(t => t.includes('Riverside Park')), 'switching shows the pantry events ' + panTitles.length);
  // Dashboard follows the switch
  await p.goto(B + 'dashboard.html');
  check((await p.textContent('#org-context')).includes('Eastside Food Pantry'), 'dashboard follows the current org');
  check((await num('kpi-events')) >= 2, 'pantry kpis');

  // Event and main event pages open for an Admin
  await p.goto(B + 'event.html?id=demo-ev-park');
  check(await p.isVisible('#event-form') && (await p.inputValue('#title')) === 'Riverside Park Clean-up', 'event page opens');
  check((await p.textContent('#org-line')).includes('Riverside'), 'event page sets its org (named above the title)');
  await p.goto(B + 'main-event.html?id=demo-main-arudra');
  check(await p.isVisible('#main-form') && (await p.inputValue('#title')).includes('Arudra'), 'main event opens');
  check((await p.$$('#sub-list > *')).length >= 2, 'main event lists its events');

  // Volunteers: the pantry's requests and invite code
  await p.evaluate(() => SevakOrgs.setCurrent('demo-org-2'));
  await p.goto(B + 'volunteers.html');
  check((await p.inputValue('#invite-link')).endsWith('join.html?code=PANTRY') && (await p.textContent('#invite-code')) === 'PANTRY', 'pantry invite code');
  check(await p.isDisabled('#auto-approve') && (await p.textContent('#auto-hint')) === 'Only Admins can change this.', 'coordinator: auto-approve is Admin only');
  await p.fill('#invite-emails', 'sam@example.com, not-an-email');
  await p.click('#send-invites');
  check((await p.textContent('#invite-emails-error')).includes('not-an-email'), 'bad invite email');
  await p.fill('#invite-emails', 'sam@example.com');
  await p.click('#send-invites');
  check((await p.textContent('#invited-list')).includes('sam@example.com') && (await p.textContent('#vol-status')).includes('Invitation sent'), 'coordinator invites');
  await p.selectOption('#org-switch', 'demo-org');
  await p.waitForFunction(() => document.getElementById('org-context').textContent.includes('Riverside'));
  check((await p.textContent('#invite-code')) === 'RIVER7', 'switch: Riverside invite code');
  const reqs = (await p.$$('#request-list .person')).length;
  check(reqs === 2 && (await p.textContent('#requests-title')) === 'Requests to join (2)', 'two demo requests');
  // 2 requests to join, 2 hours to approve, 1 certificate request (demo)
  check((await p.textContent('#app-nav a[href="volunteers.html"] .nav-count')) === '5', 'menu count of everything waiting: ' + await p.textContent('#app-nav'));
  await p.click('button[aria-label="Approve Priya Nair"]');
  check((await p.textContent('#vol-status')).includes('Priya Nair is now a volunteer') && (await p.$$('#request-list .person')).length === 1, 'approve');
  check(await p.evaluate(() => document.activeElement.id) === 'requests-title', 'focus after approve');
  const mail = await p.evaluate(() => JSON.parse(localStorage.getItem('sevak.outbox.v1'))[0]);
  check(mail.subject.includes('approved your request') && /priya/i.test(mail.to), 'approval email in outbox');
  await p.click('button[aria-label="Decline Tom Becker"]');
  check(await p.isVisible('#declined-box') && (await p.textContent('#declined-summary')) === '1 declined request', 'decline');
  check((await p.textContent('#requests-title')) === 'Requests to join', 'no requests left');
  // Admin: approve automatically
  check(await p.isEnabled('#auto-approve'), 'admin: can change auto-approve');
  await p.check('#auto-approve');
  check((await p.evaluate(() => JSON.parse(localStorage.getItem('sevak.organizations.v1')).find(o => o.id === 'demo-org').autoApprove)) === true, 'auto-approve saved');
  await p.screenshot({ path: SP + '/manage-volunteers.png', fullPage: true });

  // Phone: the Manage pages fit, the links sit at the top, More in the bar
  for (const w of [320, 390]) {
    await p.setViewportSize({ width: w, height: 800 });
    for (const pg of ['dashboard.html', 'events.html', 'volunteers.html', 'organization.html', 'event.html?id=demo-ev-park']) {
      await p.goto(B + pg);
      check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `${pg} fits at ${w}`);
    }
  }
  await p.screenshot({ path: SP + '/manage-phone.png' });
  console.log(n + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
