// Organization verification: an Admin asks on the Organization page, Sevak's
// staff (review.html in the prototype) reject or verify, and public events
// are listed once verified.
const { chromium } = require('playwright');
const B = 'http://localhost:8765/app/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; let n = 0; const check = (c, m) => c ? n++ : errs.push(m);
  const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
  p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('dialog', d => d.accept());
  const org = () => p.evaluate(() => JSON.parse(localStorage.getItem('sevak.organizations.v1')).find(o => o.id === 'org-hope'));
  const mail = () => p.evaluate(() => (JSON.parse(localStorage.getItem('sevak.outbox.v1')) || [])[0] || {});
  // Saving the profile goes on to Events (which says so); come back to the profile.
  const save = async () => {
    await p.click('#save-bar button[type=submit]');
    await p.waitForURL(/events\.html/);
    check((await p.textContent('#saved-flash')).includes('Saved the profile of'), 'saved: on to Events, saying so');
    await p.goto(B + 'organization.html');
  };

  await p.goto(B + 'outbox.html'); await p.evaluate(() => localStorage.clear());
  await p.evaluate(() => {
    localStorage.setItem('sevak.profile.v1', JSON.stringify({ firstName: 'Bala', lastName: 'A', email: 'bala@hopekitchen.org', roles: { volunteer: true } }));
    const d = new Date(); d.setDate(d.getDate() + 10); const iso = d.toISOString().slice(0, 10);
    localStorage.setItem('sevak.organizations.v1', JSON.stringify([{ id: 'org-hope', name: 'Hope Kitchen', createdBy: 'bala@hopekitchen.org', inviteCode: 'HOPE42', autoApprove: true,
      address: { country: 'US', line1: '1 Main Street', city: 'Austin', state: 'TX', postalCode: '78701' }, taxStatus: 'charity', registrationNumber: '',
      primaryContact: { name: 'Bala A', email: 'bala@hopekitchen.org', phone: { country: 'US', number: '+15125550100' } }, team: [], verificationStatus: 'unverified' }]));
    localStorage.setItem('sevak.currentOrganization.v1', JSON.stringify('org-hope'));
    localStorage.setItem('sevak.events.v1', JSON.stringify([{ id: 'ev-hope', organizationId: 'org-hope', title: 'Soup Night', startDate: iso, endDate: iso, status: 'published', visibility: 'public',
      location: { type: 'in-person', venue: 'Hope Hall', city: 'Austin' }, roles: [{ id: 'r', name: 'Cooks', shifts: [{ id: 'ev-hope-s', date: iso, start: '17:00', end: '19:00', capacity: 4 }] }] }]));
  });

  // Unverified: listed under "Not listed publicly yet"
  await p.goto(B + 'signup.html#all-orgs');
  check((await p.textContent('#discover-list')).match(/Not listed publicly yet[\s\S]*Soup Night/), 'unverified: event not listed publicly');

  // Header card on Events: badge and a way to get verified
  await p.goto(B + 'events.html');
  check((await p.textContent('#org-context-badges')) === 'Not verified yet' && await p.isVisible('#org-context-verify'), 'header: not verified, Get verified link');

  // Organization page: nothing to check yet
  await p.goto(B + 'organization.html');
  check(await p.isVisible('#verify-box') && (await p.textContent('#verify-badge')) === 'Not verified yet', 'verify box: not verified');
  await p.click('#verify-body button:has-text("Request verification")');
  check((await p.textContent('#verify-body')).includes('Add a registration number') && !(await p.$('#verify-body button:has-text("Send request")')), 'needs a registration number or website');
  await p.click('#verify-body button:has-text("Cancel")');

  // Add the website, save (keeps the invite code and auto-approve), then ask
  await p.click('#tab-about');
  await p.fill('#website', 'hopekitchen.org');
  await save();
  let o = await org();
  check(o.inviteCode === 'HOPE42' && o.autoApprove === true && o.website === 'https://hopekitchen.org', 'saving keeps invite code and auto-approve');
  await p.click('#verify-body button:has-text("Request verification")');
  const ev = await p.textContent('.verify-evidence');
  check(ev.includes('hopekitchen.org') && ev.includes("on your website's domain ✓") && ev.includes('None added'), 'evidence from the saved profile');
  await p.fill('#verify-note', 'We are on the state charity list.');
  await p.fill('#website', 'hopekitchen.com');   // unsaved change
  await p.click('#verify-body button:has-text("Send request")');
  check((await p.textContent('#verify-status')).includes('unsaved changes') && (await org()).verificationStatus === 'unverified', 'unsaved changes: save first');
  await p.fill('#website', 'hopekitchen.org');
  await save();
  await p.click('#verify-body button:has-text("Request verification")');
  await p.fill('#verify-note', 'We are on the state charity list.');
  await p.click('#verify-body button:has-text("Send request")');
  o = await org();
  check(o.verificationStatus === 'pending' && o.verification.evidence.website === 'https://hopekitchen.org' && o.verification.note === 'We are on the state charity list.' && o.verification.requestedBy === 'bala@hopekitchen.org', 'request saved with evidence');
  check((await p.textContent('#verify-badge')) === 'Pending review' && (await p.textContent('#verify-status')).includes('Request sent'), 'pending shown');
  check((await mail()).subject === 'We received your verification request for Hope Kitchen', 'request email');
  check(await p.evaluate(() => document.activeElement.id) === 'verify-title', 'focus to the box title');
  await p.screenshot({ path: SP + '/verify-pending.png', fullPage: true });

  // Saving the profile again keeps the request
  await save();
  check((await org()).verificationStatus === 'pending' && (await org()).verification.note, 'saving keeps the request');

  // Withdraw, then ask again
  await p.click('#verify-body button:has-text("Withdraw request")');
  check((await org()).verificationStatus === 'unverified' && !(await org()).verification, 'withdrawn');
  await p.click('#verify-body button:has-text("Request verification")');
  await p.click('#verify-body button:has-text("Send request")');

  // Event editor and header while pending
  await p.goto(B + 'events.html');
  check((await p.textContent('#org-context-badges')) === 'Verification pending' && await p.isHidden('#org-context-verify'), 'header: pending, no link');
  await p.goto(B + 'event.html?id=ev-hope#review');   // who can see it is on the Review step
  check(await p.isVisible('#unverified-note') && (await p.textContent('#unverified-note')).includes("waiting for Sevak's review"), 'event editor: pending note');

  // Sevak's review: reject needs a reason
  await p.goto(B + 'review.html');
  check((await p.textContent('#queue-title')) === 'Waiting for review (1)' && (await p.textContent('#queue-list')).includes('Hope Kitchen'), 'queue');
  check((await p.textContent('#queue-list')).includes("on the website's domain ✓") && (await p.getAttribute('#queue-list .verify-evidence a', 'href')) === 'https://hopekitchen.org', 'reviewer sees evidence');
  await p.click('button[aria-label="Reject Hope Kitchen"]');
  check((await p.getAttribute('button[aria-label="Reject Hope Kitchen"]', 'aria-expanded')) === 'true' && await p.evaluate(() => document.activeElement.id) === 'reason-org-hope', 'reject opens a reason');
  await p.click('#queue-list button:has-text("Reject request")');
  check((await p.textContent('#reason-org-hope-error')).includes('Say why') && (await org()).verificationStatus === 'pending', 'reason required');
  await p.fill('#reason-org-hope', 'Please add your registration number.');
  await p.click('#queue-list button:has-text("Reject request")');
  check((await org()).verificationStatus === 'rejected' && (await p.textContent('#decided-list')).includes('Not approved') && await p.isVisible('#queue-empty'), 'rejected');
  check((await mail()).subject === 'Your verification request for Hope Kitchen' && (await mail()).body.includes('Please add your registration number.'), 'reject email has the reason');
  await p.screenshot({ path: SP + '/verify-review.png', fullPage: true });

  // The team sees it once; the box says why; ask again
  await p.goto(B + 'organization.html');
  check((await p.textContent('.team-notice')).includes("Sevak couldn't verify Hope Kitchen: Please add your registration number."), 'rejection notice');
  check((await p.textContent('#verify-badge')) === 'Not approved' && (await p.textContent('#verify-text')).includes('Please add your registration number.'), 'box: not approved, reason');
  await p.reload();
  check(!(await p.$('.team-notice')), 'notice once');
  await p.click('#tab-status');
  await p.fill('#registrationNumber', '74-1234567');
  await save();
  await p.click('#verify-body button:has-text("Ask again")');
  check((await p.textContent('.verify-evidence')).includes('74-1234567'), 'registration number now included');
  await p.click('#verify-body button:has-text("Send request")');

  // Verify
  await p.goto(B + 'review.html');
  await p.click('button[aria-label="Verify Hope Kitchen"]');
  check((await org()).verificationStatus === 'verified' && (await p.textContent('#review-status')).includes('is verified'), 'verified');
  check((await mail()).subject === 'Hope Kitchen is verified', 'verified email');
  check(!(await p.$('.team-notice')), 'no notice on the review page');

  await p.goto(B + 'events.html');
  check((await p.textContent('.team-notice')).includes('Good news: Sevak verified Hope Kitchen'), 'verified notice');
  check((await p.textContent('#org-context-badges')) === 'Verified' && await p.isHidden('#org-context-verify'), 'header: verified');
  await p.goto(B + 'organization.html');
  check((await p.textContent('#verify-badge')) === 'Verified' && !(await p.$('#verify-body button')), 'box: verified, no actions');
  await p.goto(B + 'signup.html#all-orgs');
  const listText = await p.textContent('#discover-list');
  check(listText.includes('Soup Night') && !listText.includes('Not listed publicly yet'), 'verified: event listed publicly');
  await p.goto(B + 'event.html?id=ev-hope#review');
  check(await p.isVisible('#step-review') && await p.isHidden('#unverified-note'), 'editor: no unverified note');

  // A Coordinator can't ask
  await p.evaluate(() => { const l = JSON.parse(localStorage.getItem('sevak.organizations.v1')); l.push({ id: 'org-co', name: 'Coord Club', createdBy: 'boss@club.org', team: [{ name: 'Bala A', email: 'bala@hopekitchen.org', role: 'coordinator' }], website: 'https://club.org' }); localStorage.setItem('sevak.organizations.v1', JSON.stringify(l)); localStorage.setItem('sevak.currentOrganization.v1', JSON.stringify('org-co')); });
  await p.goto(B + 'organization.html');
  check((await p.textContent('#verify-body')).includes('Only Admins can ask') && !(await p.$('#verify-body button')), 'coordinator: cannot ask');
  await p.goto(B + 'events.html');
  check(await p.isHidden('#org-context-verify'), 'coordinator: no Get verified link');

  // New organization: no box until it's saved
  await p.goto(B + 'organization.html?new=1');
  check(await p.isHidden('#verify-box'), 'new organization: no verification box');

  // Phone
  await p.setViewportSize({ width: 360, height: 800 });
  for (const pg of ['organization.html', 'review.html']) {
    await p.goto(B + pg);
    check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), pg + ' fits on a phone');
  }
  await p.evaluate(() => localStorage.setItem('sevak.currentOrganization.v1', JSON.stringify('org-hope')));
  await p.goto(B + 'organization.html');
  await p.screenshot({ path: SP + '/verify-phone.png' });
  console.log(n + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
