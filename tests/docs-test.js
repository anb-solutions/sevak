const { chromium } = require('playwright');
const SP = process.argv[2]; const FILES = SP + '/files/';
const BASE = 'http://localhost:8765/';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('pageerror ' + e.message));
  p.on('dialog', d => d.accept());
  const check = (c, m) => { if (!c) errs.push(m); };

  // Profile so "By" is filled.
  await p.goto(BASE + 'app/profile.html');
  await p.evaluate(() => localStorage.setItem('sevak.profile.v1', JSON.stringify({ firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com' })));

  // New org: documents blocked until saved.
  await p.goto(BASE + 'app/organization.html?new=1#documents');
  check(await p.isVisible('#panel-documents .docs-blocked'), 'org new: blocked note');
  check(!(await p.isVisible('#save-bar')), 'save bar hidden on docs tab');
  check(!(await p.isVisible('.docs-add')), 'add hidden when blocked');

  // Use demo org.
  await p.goto(BASE + 'app/dashboard.html?demo=1');
  await p.goto(BASE + 'app/organization.html#documents');
  check(await p.isVisible('text=No documents yet.'), 'empty state');
  async function upload(file, desc, name) {
    await p.click('#panel-documents .docs-add');
    await p.setInputFiles('#panel-documents .docs-file', FILES + file);
    if (name) await p.fill('#panel-documents .docs-name', name);
    if (desc) await p.fill('#panel-documents .docs-desc', desc);
    await p.click('#panel-documents .docs-save');
    await p.waitForSelector('#panel-documents .docs-form', { state: 'hidden' });
  }
  // Validation
  await p.click('#panel-documents .docs-add');
  await p.click('#panel-documents .docs-save');
  check((await p.textContent('.docs-file-error')).includes('Choose a file'), 'no file error');
  await p.setInputFiles('#panel-documents .docs-file', FILES + 'too-big.pdf');
  await p.click('#panel-documents .docs-save');
  check((await p.textContent('.docs-file-error')).includes('10 MB'), 'size error: ' + await p.textContent('.docs-file-error'));
  await p.click('#panel-documents .docs-cancel');

  await upload('Insurance_certificate_2026.pdf', 'Public liability cover');
  await upload('volunteer-handbook.txt', '');
  await upload('site-map.png', 'Parking and entrances', 'Site map');
  const rows = await p.$$eval('#panel-documents tbody tr', trs => trs.map(tr => [...tr.children].map(c => c.innerText.trim())));
  console.log(rows);
  check(rows.length === 3, 'three rows');
  check(rows.some(r => r[0].startsWith('Insurance certificate 2026') && r[1] === 'Public liability cover' && r[3] === 'Asha Rao' && r[4] === '2.0 KB' && r[0].includes('Download')), 'insurance row');
  check(rows.some(r => r[0].startsWith('Site map') && r[4] === '293 KB'), 'site map row');
  check((await p.textContent('.docs-summary')).startsWith('3 documents'), 'summary');
  const heads = await p.$$eval('#panel-documents thead th', ths => ths.map(t => t.innerText.trim()));
  console.log(heads);
  // Sort by name asc
  await p.click('.docs-sort[data-key="name"]');
  const names = await p.$$eval('.docs-name-link', l => l.map(x => x.textContent));
  check(JSON.stringify(names) === JSON.stringify(['Insurance certificate 2026', 'Site map', 'volunteer handbook']), 'sort name ' + names);
  await p.click('.docs-sort[data-key="size"]');
  const bySize = await p.$$eval('.docs-name-link', l => l.map(x => x.textContent));
  check(bySize[0] === 'Site map', 'sort size desc ' + bySize);
  // Download
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('button[aria-label="Download volunteer handbook"]')]);
  check(dl.suggestedFilename() === 'volunteer-handbook.txt', 'dl name');
  const fs = require('fs'); check(fs.readFileSync(await dl.path(), 'utf8').includes('Volunteer handbook text'), 'dl content');
  // Edit
  await p.click('button[aria-label="Edit volunteer handbook"]');
  check(await p.inputValue('.docs-name') === 'volunteer handbook', 'edit prefill');
  await p.fill('.docs-name', 'Volunteer handbook'); await p.fill('.docs-desc', 'Read before your first shift');
  await p.click('.docs-save');
  await p.waitForSelector('text=Read before your first shift');
  // Persist after reload, org save still works on other tab
  await p.reload();
  check((await p.$$('#panel-documents tbody tr')).length === 3, 'persist');
  await p.screenshot({ path: SP + '/docs-org-desktop.png', fullPage: true });
  await p.setViewportSize({ width: 375, height: 900 });
  await p.screenshot({ path: SP + '/docs-org-phone.png', fullPage: true });
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'org phone overflow');
  await p.setViewportSize({ width: 1100, height: 900 });
  await p.click('#tab-about');
  check(await p.isVisible('#save-bar'), 'save bar back');
  await p.click('#save-bar button[type=submit]');
  await p.waitForURL(/events\.html/);
  check((await p.textContent('#saved-flash')).includes('Saved the profile of'), 'org save works: on to Events, saying so');
  await p.goto(BASE + 'app/organization.html');
  // Delete one
  await p.click('#tab-documents');
  await p.click('button[aria-label="Delete Site map"]');
  await p.waitForFunction(() => document.querySelectorAll('#panel-documents tbody tr').length === 2);

  // Event documents
  await p.goto(BASE + 'app/event.html#documents');
  check(await p.isVisible('#panel-documents .docs-blocked'), 'event new blocked');
  check(!(await p.isVisible('#event-form')), 'form hidden on docs tab');
  await p.goto(BASE + 'app/event.html?id=demo-ev-park#documents');
  await upload('volunteer-handbook.txt', 'Route map', 'Trail route');
  check((await p.$$('#panel-documents tbody tr')).length === 1, 'event doc');
  await p.click('#tab-details');
  check(await p.isVisible('#event-form') && !(await p.isVisible('#panel-documents')), 'event tab switch');
  check(p.url().endsWith('?id=demo-ev-park#details'), 'event url ' + p.url());
  // Event docs separate from org docs
  await p.goto(BASE + 'app/event.html?id=demo-ev-reh1#documents');
  check(await p.isVisible('text=No documents yet.'), 'other event empty');
  await p.setViewportSize({ width: 375, height: 900 });
  await p.goto(BASE + 'app/event.html?id=demo-ev-park#documents');
  await p.screenshot({ path: SP + '/docs-event-phone.png', fullPage: true });
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'event phone overflow');
  await p.setViewportSize({ width: 1100, height: 900 });

  // New event: save draft then docs unlock
  await p.goto(BASE + 'app/event.html');
  await p.fill('#title', 'Doc test event');
  await p.click('#step-next');   // the dates are on the next step
  await p.fill('#startDate', '2026-12-01');
  await p.dispatchEvent('#startDate', 'change');
  await p.click('#save-draft');
  await p.waitForURL(/events\.html/);
  check((await p.textContent('#saved-flash')).includes('Saved “Doc test event” as a draft.'), 'saved draft: back on Events');
  await p.click('#saved-flash a:has-text("Open it again")');
  await p.waitForURL(/event\.html\?id=/);
  await p.click('#tab-documents');
  check(await p.isVisible('#panel-documents .docs-add'), 'docs unlocked after save');
  check(/\?id=.+#documents$/.test(p.url()), 'url after save ' + p.url());

  // Profile documents
  await p.goto(BASE + 'app/profile.html#documents');
  await upload('Insurance_certificate_2026.pdf', 'Background check');
  check((await p.$$('#panel-documents tbody tr')).length === 1, 'profile doc');
  await p.screenshot({ path: SP + '/docs-profile-desktop.png', fullPage: true });
  await p.click('#tab-details');
  await p.click('#delete-profile');
  await p.click('#tab-documents');
  // Documents belong to a person: with no profile there's nowhere to add them.
  await p.waitForSelector('#panel-documents >> text=Save your profile first');
  check(!(await p.evaluate(() => JSON.parse(localStorage.getItem('sevak.documents.v1')).some(d => d.owner.startsWith('profile')))), 'profile docs deleted with the profile');

  // Deleting the event removes its docs; removing demo org removes org docs; files swept.
  await p.evaluate(() => localStorage.setItem('sevak.profile.v1', JSON.stringify({ email: 'a@example.com', organizations: [{ name: 'Riverside Community Arts (demo)', role: 'admin' }] })));
  await p.goto(BASE + 'app/event.html?id=demo-ev-park#review');   // Delete is on the Review step
  await p.click('#delete-event');
  await p.waitForURL(/events\.html/);
  let owners = await p.evaluate(() => JSON.parse(localStorage.getItem('sevak.documents.v1')).map(d => d.owner));
  check(!owners.includes('event:demo-ev-park'), 'event docs removed');
  check(owners.filter(o => o === 'org:demo-org').length === 2, 'org docs kept');
  await p.goto(BASE + 'app/organization.html');
  await p.click('#delete-org');
  await p.waitForLoadState('load');
  owners = await p.evaluate(() => JSON.parse(localStorage.getItem('sevak.documents.v1')).map(d => d.owner));
  check(!owners.includes('org:demo-org'), 'org docs removed ' + owners);
  await p.goto(BASE + 'app/profile.html#documents');
  await p.waitForTimeout(500);
  const keys = await p.evaluate(() => new Promise(r => { const q = indexedDB.open('sevak-files'); q.onsuccess = () => { const g = q.result.transaction('files').objectStore('files').getAllKeys(); g.onsuccess = () => r(g.result.length); }; }));
  check(keys === 0, 'files swept: ' + keys);

  console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
