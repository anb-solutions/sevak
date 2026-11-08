const { chromium } = require('playwright');
const B = 'http://localhost:8765/'; const A = B + 'app/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; let n = 0; const check = (c, m) => c ? n++ : errs.push(m);
  const p = await b.newPage({ viewport: { width: 1000, height: 1000 } });
  p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('dialog', d => d.accept());
  const as = (prof) => p.evaluate(x => { localStorage.setItem('sevak.profile.v1', JSON.stringify(x)); localStorage.removeItem('sevak.signedOut.v1'); }, prof);
  const VERA = { firstName: 'Vera', lastName: 'Vol', email: 'vera@example.com', roles: { volunteer: true } };
  const ADA = { firstName: 'Ada', lastName: 'Admin', email: 'ada@example.com', roles: { volunteer: false } };
  const mems = () => p.evaluate(() => JSON.parse(localStorage.getItem('sevak.memberships.v1') || '[]'));
  const mails = () => p.evaluate(() => JSON.parse(localStorage.getItem('sevak.outbox.v1') || '[]'));

  await p.goto(A + 'signup.html'); await p.evaluate(() => localStorage.clear());
  await p.goto(A + 'dashboard.html?demo=1');   // signed out: nobody added

  // ----- Signed out -----
  await p.goto(B);
  check((await p.getAttribute('a:has-text("Sign up")', 'href')) === 'app/join.html', 'Sign up goes to Join');
  await p.goto(A + 'signup.html');
  check(await p.isVisible('#browse-hint') && !(await p.isVisible('#org-tabs')), 'signed out: browse, no tabs');
  check((await p.$$eval('#app-nav .nav-main a', a => a.map(x => x.textContent).join('|'))) === 'Opportunities|Join|Sign in', 'signed-out menu has Join');
  await p.goto(A + 'signup.html?event=demo-ev-park');
  check((await p.textContent('#member-hint')).includes('join Sevak'), 'event hint: join');
  await p.check('input[value="demo-ev-park-shift-0-0"]'); await p.click('#continue');
  check((await p.textContent('#join-gate')).includes('Join Sevak to sign up') && !(await p.isVisible('#submit')), 'signed out: gate, no Confirm');
  check(!(await p.isVisible('#signup-form .action-bar')), 'no empty bar');
  check((await p.getAttribute('#join-gate a.btn-primary', 'href')) === 'join.html?org=demo-org&return=signup.html%3Fevent%3Ddemo-ev-park', 'join link carries org and return');

  // ----- Join with an invitation code -----
  await p.goto(A + 'join.html');
  await p.click('#join-continue');
  check((await p.textContent('#org-error')).includes('Choose the organization'), 'must pick an organization');
  await p.click('#switch-way');
  await p.fill('#code', 'nope99'); await p.click('#join-continue');
  check((await p.textContent('#code-error')).includes("don't recognise"), 'bad code');
  await p.fill('#code', 'https://example.org/app/join.html?code=pantry');
  check((await p.textContent('#code-found')).includes('Eastside Food Pantry'), 'code from a pasted link, any case');
  await p.click('#join-continue'); await p.waitForURL(/profile\.html\?join=1/);
  check((await p.textContent('#join-notice')).includes("You're joining Eastside Food Pantry"), 'profile notice: joining');
  await p.fill('#firstName', 'Vera'); await p.fill('#lastName', 'Vol'); await p.fill('#email', 'vera@example.com'); await p.fill('#phone', '5125550101');
  await p.check('input[name=availability][value=anytime]', { force: true });
  await p.click('#save');
  check((await p.textContent('#join-notice')).includes("You're now a volunteer with Eastside Food Pantry"), 'joined by invitation');
  check((await p.textContent('#volunteer-list')).includes('Eastside Food Pantry') && (await p.textContent('#volunteer-list')).includes('Volunteer'), 'profile lists it');
  check((await mails()).some(m => m.to === 'vera@example.com' && m.subject.startsWith('Welcome to Eastside')), 'welcome email in outbox');

  // ----- Opportunities: two tabs -----
  await p.goto(A + 'signup.html');
  check(await p.$eval('#tab-my-orgs', t => t.getAttribute('aria-selected')) === 'true' && p.url().endsWith('#my-orgs'), 'opens on My organizations');
  const myTitles = await p.$$eval('#discover-list h3', h => h.map(x => x.textContent));
  check(JSON.stringify(myTitles.sort()) === '["Holiday Meal Packing","Pantry Restock Night"]', 'my orgs: only Pantry events ' + myTitles);
  check((await p.textContent('#member-strip')).includes('Eastside Food Pantry'), 'strip names my org');
  await p.click('#tab-all-orgs');
  check((await p.$$('#discover-list .opp-row')).length === 12 && p.url().endsWith('#all-orgs'), 'all orgs: every event');
  check((await p.textContent('.opp-row:has-text("Riverside Park Clean-up") .opp-join')) === 'Join to sign up', 'non-member tag');
  check(!(await p.$('.opp-row:has-text("Pantry Restock Night") .opp-join')), 'member: no tag');
  await p.focus('#tab-all-orgs'); await p.keyboard.press('ArrowLeft');
  check(await p.evaluate(() => document.activeElement.id) === 'tab-my-orgs', 'arrow keys');

  // Member signs up normally
  await p.goto(A + 'signup.html?event=demo-ev-restock');
  check(await p.isHidden('#member-hint'), 'member: no hint');
  await p.check('input[value="demo-ev-restock-shift-0-0"]'); await p.click('#continue');
  check(await p.isVisible('#submit') && await p.isHidden('#join-gate'), 'member: confirm');
  await p.click('#submit'); await p.waitForSelector('#confirm-view:not([hidden])');
  check((await mails()).some(m => m.subject === "You're signed up: Pantry Restock Night" && m.link.startsWith('signup.html?registration=')), 'confirmation email in outbox');

  // Non-member asks to join from the event
  await p.goto(A + 'signup.html?event=demo-ev-park');
  check((await p.textContent('#member-hint')).includes('not a volunteer'), 'hint: not a volunteer');
  await p.check('input[value="demo-ev-park-shift-0-0"]'); await p.click('#continue');
  await p.fill('#join-note', 'Love the park');
  await p.click('#join-gate button:has-text("Request to join")');
  check((await p.textContent('#join-gate')).includes('Waiting for approval') && !(await p.isVisible('#submit')), 'request sent → waiting');
  const vr = (await mems()).find(m => m.email === 'vera@example.com' && m.orgId === 'demo-org');
  check(vr.status === 'requested' && vr.note === 'Love the park' && vr.name === 'Vera Vol', 'request saved');
  await p.goto(A + 'signup.html#all-orgs');
  check((await p.textContent('.opp-row:has-text("Riverside Park Clean-up") .opp-join')) === 'Request sent', 'tag: request sent');

  // ----- Admin approves -----
  await p.evaluate(() => { const l = JSON.parse(localStorage.getItem('sevak.organizations.v1')); l.find(o => o.id === 'demo-org').team = [{ name: 'Ada Admin', email: 'ada@example.com', role: 'admin' }, { name: 'Cole Coord', email: 'cole@example.com', role: 'coordinator' }]; localStorage.setItem('sevak.organizations.v1', JSON.stringify(l)); });
  await as(ADA);
  await p.goto(A + 'volunteers.html');
  check((await p.$$eval('#app-nav .nav-manage a', a => a.map(x => x.firstChild.textContent).join('|'))) === 'Events|Volunteers|Dashboard|Organization', 'manage menu has Volunteers');
  // 3 requests to join, plus the demo's 2 hours to approve and 1 certificate request
  check((await p.textContent('#app-nav a[href="volunteers.html"] .nav-count')) === '6', 'count of everything waiting');
  check((await p.$$eval('#request-list .person strong', s => s.map(x => x.textContent))).join('|') === 'Priya Nair|Tom Becker|Vera Vol', 'requests listed');
  check((await p.textContent('#request-list .person:has-text("Vera Vol")')).includes('Love the park'), 'note shown');
  await p.click('#request-list button[aria-label="Approve Vera Vol"]');
  check((await p.textContent('#vol-status')).includes('Vera Vol is now a volunteer') && (await p.textContent('#app-nav a[href="volunteers.html"] .nav-count')) === '5', 'approved; count 5');
  await p.click('#request-list button[aria-label="Decline Tom Becker"]');
  check(await p.isVisible('#declined-box') && (await p.textContent('#declined-summary')) === '1 declined request', 'declined list');
  check((await p.$$('#member-list .person')).length === 8 && await p.isVisible('#show-all-members'), 'long list starts short');
  await p.click('#show-all-members');
  check((await p.$$('#member-list .person')).length === 26 && !(await p.isVisible('#show-all-members')), 'show all');
  // Invite by email
  await p.fill('#invite-emails', 'newbie@example.com, oops');
  await p.click('#send-invites');
  check((await p.textContent('#invite-emails-error')).includes('oops'), 'bad email caught');
  await p.fill('#invite-emails', 'newbie@example.com; vera@example.com');
  await p.click('#send-invites');
  check((await p.textContent('#vol-status')).includes('Invitation sent to newbie@example.com') && (await p.textContent('#vol-status')).includes('Already a volunteer or invited: vera@example.com'), 'invite sent, member skipped');
  check((await p.textContent('#invited-list')).includes('newbie@example.com'), 'invited list');
  let out = await mails();
  check(out.some(m => m.to === 'vera@example.com' && m.subject.includes('approved your request')), 'approval email');
  check(out.some(m => m.to === 'tom.becker@example.com' && m.subject.startsWith('Your request to join')), 'decline email');
  const inv = out.find(m => m.to === 'newbie@example.com');
  check(inv && inv.link.endsWith('join.html?code=RIVER7'), 'invite email has the join link ' + (inv && inv.link));
  // Outbox page
  await p.goto(A + 'outbox.html');
  check((await p.$$('.mail')).length >= 5 && (await p.textContent('.mail >> nth=0')).includes('newbie@example.com'), 'outbox lists emails, newest first');
  await p.screenshot({ path: SP + '/jt-outbox.png', fullPage: true });
  // Reset the link: old code stops working
  await p.goto(A + 'volunteers.html');
  const oldCode = await p.textContent('#invite-code');
  await p.click('#reset-link');
  const newCode = await p.textContent('#invite-code');
  check(newCode !== oldCode && (await p.inputValue('#invite-link')).endsWith('code=' + newCode), 'new link');
  await p.goto(A + 'join.html?code=' + oldCode);
  check(!(await p.isVisible('#code-found')), 'old code no longer works');
  await p.goto(A + 'volunteers.html');
  // Coordinator can't change auto-approve
  await as({ firstName: 'Cole', email: 'cole@example.com' });
  await p.goto(A + 'volunteers.html');
  check(await p.isDisabled('#auto-approve') && (await p.textContent('#auto-hint')).includes('Only Admins'), 'coordinator: auto-approve locked');
  check(await p.isVisible('#request-list button:has-text("Approve")'), 'coordinator can approve');
  // Admin turns on auto-approve
  await as(ADA); await p.goto(A + 'volunteers.html');
  await p.check('#auto-approve');
  check((await p.evaluate(() => JSON.parse(localStorage.getItem('sevak.organizations.v1')).find(o => o.id === 'demo-org').autoApprove)) === true, 'auto-approve saved');
  await p.screenshot({ path: SP + '/jt-volunteers.png', fullPage: true });

  // ----- Vera: approved notice, then signs up -----
  await as(VERA);
  await p.goto(A + 'signup.html');
  check((await p.textContent('.team-notice')).includes("you're approved to volunteer with Riverside"), 'approved notice');
  await p.reload();
  check(!(await p.$('.team-notice')), 'notice shown once');
  await p.goto(A + 'signup.html?event=demo-ev-park');
  await p.check('input[value="demo-ev-park-shift-0-0"]'); await p.click('#continue');
  check(await p.isVisible('#submit'), 'approved: can confirm');

  // ----- Newbie: email invitation accepted on sign-in -----
  await as({ firstName: 'Nia', lastName: 'New', email: 'newbie@example.com' });
  await p.goto(A + 'signup.html');
  check((await p.textContent('.team-notice')).includes("You're now a volunteer with"), 'invite accepted on sign-in');
  check((await mems()).find(m => m.email === 'newbie@example.com').status === 'active', 'invite → active');

  // ----- Auto-approve: request is accepted at once -----
  await as({ firstName: 'Otto', email: 'otto@example.com' });
  await p.goto(A + 'signup.html?event=demo-ev-park');
  await p.check('input[value="demo-ev-park-shift-0-0"]'); await p.click('#continue');
  await p.click('#join-gate button:has-text("Request to join")');
  check((await p.textContent('#status')).includes("You're in!") && await p.isVisible('#submit'), 'auto-approved: confirm straight away');

  // ----- An invite link says who's inviting -----
  await p.goto(A + 'join.html?code=PANTRY');
  check((await p.textContent('#join-title')) === 'Join Eastside Food Pantry (demo)' && (await p.textContent('#join-continue')) === 'Join Eastside Food Pantry (demo)', 'invite link: Join <organization>');
  check(await p.isVisible('#code') && !(await p.isVisible('#org-search')), 'invite link: no search');

  // ----- Join page when signed in; withdraw and leave on Profile -----
  await p.goto(A + 'join.html');
  check((await p.textContent('#join-title')) === 'Join an organization', 'signed in: join another');
  check(await p.isDisabled('.org-pick-item:has-text("Riverside") input'), 'already a member: disabled');
  await p.fill('#org-search', 'pantry');
  check((await p.$$('.org-pick-item')).length === 1, 'search');
  await p.click('.org-pick-item:has-text("Eastside")');
  await p.click('#join-continue');
  check((await p.textContent('#join-done')).includes('Request sent to Eastside Food Pantry'), 'request from Join page');
  await p.goto(A + 'profile.html');
  await p.click('button[aria-label="Withdraw Eastside Food Pantry (demo)"]');
  check(!(await p.textContent('#volunteer-list')).includes('Eastside'), 'withdrawn');
  await p.click('button[aria-label="Leave Riverside Community Arts (demo)"]');
  check((await p.textContent('#volunteer-status')).includes("You've left Riverside"), 'left');

  // ----- Setting up an organization goes through the profile first -----
  await p.evaluate(() => { localStorage.removeItem('sevak.profile.v1'); });
  await p.goto(A + 'join.html');
  await p.click('#create-org'); await p.waitForURL(/profile\.html\?join=1/);
  check((await p.textContent('#join-notice')).includes('set up your organization'), 'create notice');
  await p.fill('#firstName', 'Owen'); await p.fill('#lastName', 'Org'); await p.fill('#email', 'owen@example.com'); await p.fill('#phone', '5125550109');
  await p.uncheck('#role-volunteer', { force: true });
  await p.click('#save'); await p.waitForURL(/organization\.html\?new=1/);
  n++;

  // ----- Phone -----
  await as(ADA);
  await p.setViewportSize({ width: 375, height: 800 });
  for (const pg of ['volunteers.html', 'join.html', 'outbox.html', 'signup.html']) {
    await p.goto(A + pg);
    check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'phone fits ' + pg);
  }
  await p.goto(A + 'volunteers.html');
  await p.screenshot({ path: SP + '/jt-vol-phone.png' });

  console.log(n + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
