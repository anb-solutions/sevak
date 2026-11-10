// Hours approval and certificates: the event admin approves logged hours;
// a volunteer asks for a certificate for a period; an Admin issues it (signed,
// saved in the volunteer's and the events' Documents) or declines it.
const { chromium } = require('playwright');
const fs = require('fs');
const B = 'http://localhost:8765/app/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; let n = 0; const check = (c, m) => c ? n++ : errs.push(m);
  const ctx = await b.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('dialog', d => d.accept());
  const ls = k => p.evaluate(k => JSON.parse(localStorage.getItem(k)), k);
  const signInAs = async (first, last, email) => {
    await p.evaluate(([first, last, email]) => { localStorage.setItem('sevak.profile.v1', JSON.stringify({ firstName: first, lastName: last, email, roles: { volunteer: true } })); localStorage.removeItem('sevak.signedOut.v1'); }, [first, last, email]);
  };
  const outbox = async () => (await ls('sevak.outbox.v1')) || [];

  await p.goto(B + 'outbox.html'); await p.evaluate(() => localStorage.clear());
  await signInAs('Bala', 'A', 'bala@example.com');
  await p.goto(B + 'dashboard.html?demo=1');   // Bala: Admin of Riverside

  // ----- Admin: title and signature on My profile -----
  await p.goto(B + 'profile.html');
  check(await p.isVisible('#signature-section'), 'admin: signature section on profile');
  await p.fill('#sig-title', 'Volunteer Program Lead');
  await p.locator('#sig-pad').scrollIntoViewIfNeeded();
  const box = await p.$eval('#sig-pad', e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await p.mouse.move(box.x + 40, box.y + box.h * 0.6); await p.mouse.down();
  for (let i = 1; i <= 20; i++) await p.mouse.move(box.x + 40 + i * 18, box.y + box.h * (0.6 - 0.25 * Math.sin(i / 3)));
  await p.mouse.up();
  await p.click('#sig-save');
  const sig = (await ls('sevak.signatures.v1'))['bala@example.com'];
  check(sig && sig.title === 'Volunteer Program Lead' && /^data:image\/png/.test(sig.image) && await p.isVisible('#sig-saved-img'), 'signature saved');

  // ----- Event editor: event admin -----
  await p.goto(B + 'event.html?id=demo-ev-park');
  const opts = await p.$$eval('#eventAdmin option', o => o.map(x => x.textContent));
  check(opts[0].startsWith('Any Admin of Riverside') && opts.some(o => o.includes('Bala A (Admin)')), 'event admin choices ' + opts);

  // ----- Volunteers: hours to approve and a certificate request (demo) -----
  await p.goto(B + 'volunteers.html');
  check((await p.textContent('#hours-title')) === 'Hours to approve (2)', 'two hours to approve: ' + await p.textContent('#hours-title'));
  check((await p.textContent('#certreq-title')) === 'Certificate requests (1)', 'one certificate request');
  check((await p.textContent('#app-nav a[href="volunteers.html"] .nav-count')) === '5', 'menu counts everything waiting: ' + await p.textContent('#app-nav a[href="volunteers.html"]'));
  const first = await p.$eval('#hours-list .person', li => li.querySelector('strong').textContent);
  await p.click('#hours-list .person >> nth=0 >> button:has-text("Adjust")');
  await p.fill('#hours-list .inline-form input >> nth=0', '5');
  await p.fill('#hours-list .inline-form input >> nth=1', '0');
  await p.click('#hours-list .inline-form button[type=submit]');
  check((await p.textContent('#vol-status')).includes('Approved 5 h for ' + first) && (await p.textContent('#hours-title')) === 'Hours to approve (1)', 'adjusted and approved');
  await p.click('#hours-list .person >> nth=0 >> button:has-text("Don\'t approve")');
  await p.click('#hours-list .inline-form button[type=submit]');
  check((await p.textContent('#hours-list .inline-form .error')).includes('Say why'), 'reason needed to not approve');
  await p.fill('#hours-list .inline-form textarea', 'You checked in late; please correct the start time.');
  await p.click('#hours-list .inline-form button[type=submit]');
  check(await p.isHidden('#hours-section'), 'no more hours to approve');
  const fair = (await ls('sevak.signups.v1')).filter(s => s.shiftId === 'demo-ev-fair-shift-0-0');
  check(fair[3].hours.status === 'approved' && fair[3].hours.approvedMinutes === 300 && fair[4].hours.status === 'rejected' && fair[4].hours.reason.includes('late'), 'decisions saved');

  // Preview, then issue the demo request
  const req = (await ls('sevak.certificates.v1'))[0];
  check((await p.textContent('#certreq-list')).includes('6 h') && (await p.textContent('#certreq-list')).includes(req.name), 'request shows approved hours');
  await p.click('#certreq-list button:has-text("Preview")');
  await p.waitForURL(/certificate\.html\?id=/);
  await p.waitForSelector('.cert-page');
  check((await p.textContent('#cert-title')).startsWith('Preview: certificate for') && await p.isVisible('#cert-issue') && await p.isHidden('#cert-download'), 'preview with Issue');
  check((await p.textContent('#cert-text-body')).includes('Summer Fair') && (await p.textContent('#cert-text-body')).includes('Volunteer Program Lead'), 'text version: event and signer title');
  await p.screenshot({ path: SP + '/cert-preview.png', fullPage: true });
  await p.click('#cert-issue');
  await p.waitForSelector('#cert-download:not([hidden])');
  const issued = (await ls('sevak.certificates.v1')).find(c => c.id === req.id);
  check(issued.status === 'issued' && /^SVK-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(issued.code) && issued.signer.name === 'Bala A' && issued.signer.image, 'issued, signed by the Admin with signature');
  const docs = await ls('sevak.documents.v1');
  const volDoc = docs.find(d => d.owner === 'profile:' + req.email.toLowerCase() && d.source === 'certificate');
  const evDoc = docs.find(d => d.owner === 'event:demo-ev-fair' && d.source === 'certificate');
  check(volDoc && evDoc && volDoc.type === 'application/pdf' && volDoc.size > 10000, 'saved in the volunteer\'s and the event\'s Documents');
  check((await outbox())[0].subject === 'Your volunteer certificate from Riverside Community Arts (demo)', 'email to the volunteer');
  // Download the PDF
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#cert-download')]);
  const pdfPath = SP + '/issued-certificate.pdf';
  await dl.saveAs(pdfPath);
  const pdf = fs.readFileSync(pdfPath);
  check(pdf.slice(0, 8).toString() === '%PDF-1.4' && pdf.slice(-6).toString().includes('%%EOF') && /Riverside/.test(dl.suggestedFilename()), 'PDF downloads: ' + dl.suggestedFilename());
  await p.screenshot({ path: SP + '/cert-issued.png', fullPage: true });

  // Event's Documents tab lists it
  await p.goto(B + 'event.html?id=demo-ev-fair#documents');
  check((await p.textContent('#panel-documents')).includes('Certificate · ' + req.name), 'event Documents tab lists the certificate');

  // Check it's genuine
  await p.goto(B + 'verify.html?code=' + issued.code);
  check((await p.textContent('#verify-result')).includes('Genuine certificate') && (await p.textContent('#verify-result')).includes(req.name) && (await p.textContent('#verify-result')).includes('6 h'), 'verify page');
  await p.fill('#code', 'SVK-NOPE-0000'); await p.click('#verify-form button');
  check((await p.textContent('#verify-result')).includes('Not found'), 'verify: unknown number');

  // ----- The volunteer: sees it, in their Documents too -----
  await signInAs(req.name.split(' ')[0], req.name.split(' ')[1], req.email);
  await p.goto(B + 'signup.html?view=mine');
  check((await p.textContent('.team-notice')).includes('Your certificate from Riverside Community Arts (demo) is ready'), 'volunteer notice');
  check(await p.isVisible('#certificates') && (await p.textContent('#cert-list')).includes('Issued'), 'certificate listed as issued');
  const fairText = await p.textContent('.my-signup:has-text("Summer Fair")');
  check(fairText.includes('✓ 6 h') && fairText.includes('Approved'), 'shift shows approved hours');
  await p.goto(B + 'profile.html#documents');
  check((await p.textContent('#panel-documents')).includes('Certificate · Riverside Community Arts (demo)'), 'volunteer Documents list it');
  await p.goto(B + 'certificate.html?id=' + req.id);
  await p.waitForSelector('.cert-page');
  check(await p.isVisible('#cert-download') && (await p.textContent('#cert-intro')).includes('saved in your Documents'), 'volunteer views it');

  // ----- Someone else can't see it -----
  await signInAs('Eve', 'X', 'eve@example.com');
  await p.goto(B + 'certificate.html?id=' + req.id);
  check((await p.textContent('#cert-intro')).includes('Only the volunteer') && !(await p.$('.cert-page')), 'others cannot see it');

  // ----- A volunteer logs hours, gets them approved, asks, is declined, asks again, gets it -----
  await signInAs('Bala', 'A', 'bala@example.com');
  await p.goto(B + 'signup.html?view=mine');
  const fairCard = '.my-signup:has-text("Summer Fair")';
  await p.click(fairCard + ' button:has-text("Log hours")');
  await p.check(fairCard + ' input[value=duration]', { force: true }).catch(() => {});
  const durMode = await p.$(fairCard + ' input[value=duration]');
  if (durMode) { await p.check(fairCard + ' input[value=duration]', { force: true }); await p.fill(fairCard + ' input[id$=-hours]', '4'); await p.fill(fairCard + ' input[id$=-minutes]', '0'); }
  await p.click(fairCard + ' button:has-text("Save hours")');
  check((await p.textContent('#mine-status')).includes("waiting for the event admin's approval") && (await p.textContent(fairCard)).includes('Waiting for another Admin'), 'an Admin\'s logged hours wait for another Admin');
  check(await p.isVisible('#certificates'), 'certificates area appears once hours are logged');
  await p.click('#cert-new');
  check((await p.textContent('#cert-coverage')).includes('No approved hours') && (await p.textContent('#cert-coverage')).includes('waiting for approval'), 'coverage: nothing approved yet');
  await p.click('#cert-send');
  check((await p.textContent('#cert-status')).includes('no approved hours'), 'cannot ask without approved hours');
  await p.click('#cert-cancel');
  // Bala is an Admin: he can't approve his own hours; another Admin does (ATT-3)
  await p.goto(B + 'volunteers.html');
  check(!(await p.textContent('#hours-section')).includes('bala@example.com') && (await p.textContent('#hours-others')).includes('Your own hours (1 shift) need another Admin'), 'own hours: not in your list, waiting for another Admin');
  // Only the demo's two requests to join are waiting on Bala, not his own hours.
  check((await p.textContent('#app-nav a[href="volunteers.html"] .nav-count')) === '2', 'own hours: not counted as waiting on you: ' + await p.textContent('#app-nav a[href="volunteers.html"]'));
  await p.evaluate(() => { const l = JSON.parse(localStorage.getItem('sevak.organizations.v1')); const o = l.find(x => x.id === 'demo-org'); o.team = o.team.concat([{ name: 'Ann B', email: 'ann@example.com', role: 'admin' }]); localStorage.setItem('sevak.organizations.v1', JSON.stringify(l)); });
  await signInAs('Ann', 'B', 'ann@example.com');
  await p.goto(B + 'volunteers.html');
  check((await p.textContent('#hours-list')).includes('bala@example.com'), 'another Admin sees his hours');
  await p.click('#hours-list .person:has-text("bala@example.com") button:has-text("Approve")');
  check((await ls('sevak.signups.v1')).find(s => s.email === 'bala@example.com' && s.eventId === 'demo-ev-fair').hours.decidedBy === 'ann@example.com', 'approved by the other Admin');
  await signInAs('Bala', 'A', 'bala@example.com');
  await p.goto(B + 'signup.html?view=mine');
  check((await p.textContent(fairCard)).includes('Approved'), 'approved shows on the card');
  await p.click('#cert-new');
  await p.click('.cert-presets [data-preset=year]');
  check((await p.textContent('#cert-coverage')).includes('Covers 4 h of approved hours (1 shift)'), 'coverage: 4 h');
  await p.fill('#cert-to', '2000-01-01');
  await p.click('#cert-send');
  check((await p.textContent('#cert-to-error')).includes('on or after'), 'period must make sense');
  await p.click('.cert-presets [data-preset=all]');
  await p.fill('#cert-note', 'For my employer.');
  await p.click('#cert-send');
  check((await p.textContent('#cert-status')).includes('Request sent to Riverside') && (await p.textContent('#cert-list')).includes('Requested'), 'request sent');
  check((await outbox())[0].subject === 'Certificate request from Bala A', 'admin emailed');
  // Decline, then ask again and issue
  await p.goto(B + 'volunteers.html');
  await p.click('#certreq-list button:has-text("Decline")');
  await p.fill('#certreq-list .inline-form textarea', 'Please ask for this calendar year only.');
  await p.click('#certreq-list .inline-form button[type=submit]');
  await p.goto(B + 'signup.html?view=mine');
  check((await p.textContent('#cert-list')).includes('Not issued: Please ask for this calendar year only.'), 'declined with reason');
  await p.click('#cert-new');
  await p.click('.cert-presets [data-preset=year]');
  await p.click('#cert-send');
  const mineReq = (await ls('sevak.certificates.v1')).filter(c => c.email === 'bala@example.com' && c.status === 'requested')[0];
  await p.goto(B + 'volunteers.html');
  await p.click('#certreq-list button:has-text("Issue")');
  await p.waitForFunction(() => /Certificate issued/.test(document.getElementById('vol-status').textContent));
  check((await p.textContent('#issued-summary')) === '2 certificates issued', 'issued list');
  await p.goto(B + 'certificate.html?id=' + mineReq.id);
  await p.waitForSelector('.cert-page');
  check((await p.textContent('#cert-text-body')).includes('4 h'), 'own certificate: 4 h');

  // ----- Coordinator: approves hours as event admin, can't issue -----
  await p.evaluate(() => {
    const l = JSON.parse(localStorage.getItem('sevak.organizations.v1'));
    const o = l.find(x => x.id === 'demo-org-2'); o.team = [{ name: 'Bala A', email: 'bala@example.com', role: 'coordinator' }];
    localStorage.setItem('sevak.organizations.v1', JSON.stringify(l));
    const ev = JSON.parse(localStorage.getItem('sevak.events.v1'));
    const r = ev.find(e => e.id === 'demo-ev-restock'); r.eventAdmin = 'bala@example.com';
    localStorage.setItem('sevak.events.v1', JSON.stringify(ev));
    const s = JSON.parse(localStorage.getItem('sevak.signups.v1'));
    s.push({ id: 'p1', registrationId: 'rp1', eventId: 'demo-ev-restock', shiftId: r.roles[0].shifts[0].id, name: 'Pat Q', email: 'pat@example.com', status: 'confirmed', hours: { minutes: 120, from: '18:00', to: '20:00', method: 'times', status: 'pending' } });
    localStorage.setItem('sevak.signups.v1', JSON.stringify(s));
    localStorage.setItem('sevak.certificates.v1', JSON.stringify(JSON.parse(localStorage.getItem('sevak.certificates.v1')).concat([{ id: 'c-pat', orgId: 'demo-org-2', email: 'pat@example.com', name: 'Pat Q', from: '2026-01-01', to: '2026-12-31', status: 'requested', requestedAt: new Date().toISOString() }])));
    SevakOrgs.setCurrent('demo-org-2');
  });
  await p.goto(B + 'volunteers.html');
  check((await p.textContent('#hours-title')) === 'Hours to approve (1)' && (await p.textContent('#hours-list')).includes('Pat Q'), 'coordinator: approves as event admin');
  check(await p.isVisible('#certreq-hint') && !(await p.$('#certreq-list button:has-text("Issue")')), 'coordinator: cannot issue');

  // ----- Phone -----
  await p.setViewportSize({ width: 360, height: 800 });
  for (const pg of ['volunteers.html', 'signup.html?view=mine', 'certificate.html?id=' + mineReq.id, 'verify.html?code=' + issued.code, 'profile.html']) {
    await p.goto(B + pg);
    check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), pg + ' fits on a phone');
  }
  await p.goto(B + 'signup.html?view=mine');
  await p.screenshot({ path: SP + '/cert-mine-phone.png', fullPage: true });
  console.log(n + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
