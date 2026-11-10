// Add to calendar (SGN-9): wherever it's offered, both an .ics file and
// Google Calendar. One shift: one Google link; several: one link per shift.
const { chromium } = require('playwright');
const fs = require('fs');
const B = 'http://localhost:8765/app/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; let n = 0; const check = (c, m) => c ? n++ : errs.push(m);
  const ctx = await b.newContext({ viewport: { width: 1000, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('dialog', d => d.accept());
  const ics = async () => {
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#add-calendar')]);
    const path = SP + '/' + dl.suggestedFilename();
    await dl.saveAs(path);
    return { name: dl.suggestedFilename(), text: fs.readFileSync(path, 'utf8') };
  };
  const google = href => { const u = new URL(href); return { host: u.host, path: u.pathname, q: Object.fromEntries(u.searchParams) }; };

  await p.goto(B + 'outbox.html'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + 'dashboard.html?demo=1');
  await p.evaluate(() => {
    localStorage.setItem('sevak.profile.v1', JSON.stringify({ firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', roles: { volunteer: true } }));
    localStorage.setItem('sevak.memberships.v1', JSON.stringify([{ id: 'mem-asha', orgId: 'demo-org', email: 'asha@example.com', name: 'Asha Rao', status: 'active', how: 'request' }]));
  });
  const ev = await p.evaluate(() => JSON.parse(localStorage.getItem('sevak.events.v1')).find(e => e.id === 'demo-ev-park'));
  const shift = ev.roles[0].shifts[0];

  // ----- One shift -----
  await p.goto(B + 'signup.html?event=demo-ev-park');
  await p.check('input[value="demo-ev-park-shift-0-0"]');
  await p.click('#continue');
  await p.click('#submit');
  await p.waitForSelector('#confirm-view:not([hidden])');
  check(await p.isVisible('#calendar-add') && await p.isVisible('#add-calendar') && await p.isVisible('#add-google'), 'one shift: .ics and Google Calendar both offered');
  check(await p.isHidden('#google-shifts'), 'one shift: a single Google button');
  const g = google(await p.getAttribute('#add-google', 'href'));
  check(g.host === 'calendar.google.com' && g.path === '/calendar/render' && g.q.action === 'TEMPLATE', 'Google link: add-event template');
  check(g.q.text === 'Riverside Park Clean-up – Litter pickers', 'Google link: title ' + g.q.text);
  const d = shift.date.replace(/-/g, '');
  check(g.q.dates === `${d}T${shift.start.replace(':', '')}00/${d}T${shift.end.replace(':', '')}00`, 'Google link: shift times ' + g.q.dates);
  check(!!ev.timezone && g.q.ctz === ev.timezone, 'Google link: event time zone ' + g.q.ctz);
  check(g.q.location.includes('Riverside Park') && g.q.details.includes('Manage or cancel your sign-up: http://localhost:8765/app/signup.html?registration='), 'Google link: place and manage link');
  check((await p.getAttribute('#add-google', 'target')) === '_blank' && (await p.getAttribute('#add-google', 'rel')).includes('noopener') && (await p.textContent('#add-google')).includes('opens in a new tab'), 'Google link: new tab, said so');
  const one = await ics();
  check(one.name === 'riverside-park-clean-up.ics' && one.text.startsWith('BEGIN:VCALENDAR') && (one.text.match(/BEGIN:VEVENT/g) || []).length === 1, '.ics: one event');
  check(one.text.includes(`DTSTART;TZID=${ev.timezone}:${d}T${shift.start.replace(':', '')}00`) && one.text.includes('SUMMARY:Riverside Park Clean-up – Litter pickers'), '.ics: time zone and title');
  check(/\r\nURL:http:\/\/localhost:8765\/app\/signup\.html\?registration=/.test(one.text) && one.text.includes('DESCRIPTION:Volunteer shift with Riverside Community Arts (demo).\\nManage or cancel your sign-up:'), '.ics: manage link');
  check((await p.textContent('#ics-hint')).includes('your shift'), 'hint: your shift');

  // ----- Several shifts: one .ics with all, a Google link for each -----
  await p.goto(B + 'signup.html?event=demo-ev-fest');
  await p.check('#shift-groups .day-group:not([hidden]) > .shift-lines input >> nth=0');
  await p.click('#day-picker .day-chip >> nth=1');
  await p.check('#shift-groups .day-group:not([hidden]) > .shift-lines input >> nth=0');
  await p.click('#continue');
  await p.click('#submit');
  await p.waitForSelector('#confirm-view:not([hidden])');
  check(await p.isHidden('#add-google') && await p.isVisible('#google-shifts') && (await p.$$('#google-links a')).length === 2, 'two shifts: a Google link for each');
  const links = await p.$$eval('#google-links a', a => a.map(x => ({ href: x.href, label: x.getAttribute('aria-label'), target: x.target })));
  check(links.every(l => l.target === '_blank' && /^Add .+ to Google Calendar \(opens in a new tab\)$/.test(l.label)), 'per-shift links: labelled, new tab');
  const dates = links.map(l => google(l.href).q.dates.slice(0, 8));
  check(dates[0] !== dates[1], 'per-shift links: different days ' + dates);
  check((await p.textContent('#ics-hint')).includes('both shifts') && (await p.getAttribute('#add-calendar', 'aria-label')) === 'Download an .ics file with both shifts', 'hint: both shifts');
  const two = await ics();
  check((two.text.match(/BEGIN:VEVENT/g) || []).length === 2, '.ics: both shifts');
  await p.screenshot({ path: SP + '/calendar-desktop.png', fullPage: true });

  // Cancel one on the manage page: the other is still offered; cancel both: none
  await p.click('#manage-link');
  await p.waitForSelector('#confirm-view:not([hidden])');
  await p.click('.my-shift button:has-text("Cancel") >> nth=0');
  check(await p.isVisible('#add-google') && await p.isHidden('#google-shifts'), 'after cancelling one: back to a single Google button');
  check(((await ics()).text.match(/BEGIN:VEVENT/g) || []).length === 1, '.ics: only the shift still on');
  await p.click('.my-shift button:has-text("Cancel") >> nth=0');
  check(await p.isHidden('#calendar-add'), 'all cancelled: no calendar options');

  // ----- Phone -----
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(B + 'signup.html?event=demo-ev-reh1');
  await p.check('input[value="demo-ev-reh1-shift-0-0"]');
  await p.click('#continue');
  await p.click('#submit');
  await p.waitForSelector('#confirm-view:not([hidden])');
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)) && await p.isVisible('#add-google'), 'phone: fits');
  await p.locator('#calendar-add').scrollIntoViewIfNeeded();
  await p.screenshot({ path: SP + '/calendar-phone.png' });

  console.log(n + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
