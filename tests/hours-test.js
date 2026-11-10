const { chromium } = require('playwright');
const B = 'http://localhost:8765/app/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; let n = 0; const check = (c, m) => c ? n++ : errs.push(m);
  const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
  const open = async (h, m, width) => {
    const ctx = await b.newContext({ viewport: { width: width || 1000, height: 1000 } });
    const p = await ctx.newPage();
    await p.clock.install({ time: at(h, m) });
    p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('dialog', d => d.accept());
    return p;
  };
  const signIn = async p => {
    await p.goto(B + 'signup.html'); await p.evaluate(() => localStorage.clear());
    await p.evaluate(() => localStorage.setItem('sevak.profile.v1', JSON.stringify({ firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', roles: { volunteer: true } })));
    await p.goto(B + 'dashboard.html?demo=1');
  };
  const signups = p => p.evaluate(() => JSON.parse(localStorage.getItem('sevak.signups.v1')).filter(s => s.email === 'asha@example.com'));
  const garden = '.my-signup:has-text("Community Garden Workday")';
  const fair = '.my-signup:has-text("Summer Fair")';

  // ----- 6:00 AM: check-in not open yet -----
  let p = await open(6, 0);
  await signIn(p);
  await p.goto(B + 'signup.html?view=mine');
  check(JSON.stringify(await p.$$eval('.mine-heading', h => h.map(x => x.textContent))) === '["Today","Past"]', 'groups: Today, Past');
  check((await p.textContent(garden + ' .hours-row')).includes('Check-in opens at 7:00'), 'check-in opens an hour early');
  check(await p.isVisible(fair + ' .hours-ask') && (await p.textContent(fair + ' .badge')) === 'Hours to log', 'past shift asks for hours');
  check((await p.textContent('#hours-summary')).includes('None yet') && (await p.textContent('#hours-summary')).includes('1 shift waiting for hours'), 'summary before');
  await p.context().close();

  // ----- 9:00 AM: check in, check out at 11:47 -----
  p = await open(9, 0);
  await signIn(p);
  await p.goto(B + 'signup.html?view=mine');
  await p.click(garden + ' button:has-text("Check in")');
  check((await p.textContent(garden + ' .hours-row')).includes('Checked in at 9:00'), 'checked in');
  check(await p.evaluate(() => document.activeElement.id.startsWith('mine-shift-')), 'focus stays on the shift');
  await p.reload();
  check(await p.isVisible(garden + ' button:has-text("Check out")'), 'check-in remembered');
  await p.clock.fastForward('02:47:00');
  await p.click(garden + ' button:has-text("Check out")');
  check((await p.textContent('#mine-status')).includes('2 h 47 min logged'), 'checkout message');
  let s = (await signups(p)).find(x => x.eventId === 'demo-ev-garden');
  check(s.hours.minutes === 167 && s.hours.from === '09:00' && s.hours.to === '11:47' && s.hours.method === 'check-in' && s.checkInAt && s.checkOutAt, 'hours from check-in/out ' + JSON.stringify(s.hours));
  check((await p.textContent(garden + ' .hours-done')).includes('2 h 47 min') && (await p.textContent(garden + ' .hours-done')).includes('9:00'), 'shows logged hours');

  // ----- Log hours: from and to -----
  await p.click(fair + ' button:has-text("Log hours")');
  check(await p.isVisible(fair + ' .hours-form') && !(await p.isVisible(fair + ' .hours-row')), 'form opens');
  check((await p.inputValue(fair + ' input[type=time] >> nth=0')) === '10:00' && (await p.inputValue(fair + ' input[type=time] >> nth=1')) === '16:00', 'times default to the shift');
  await p.fill(fair + ' input[type=time] >> nth=1', '09:30');
  await p.click(fair + ' button:has-text("Save hours")');
  check((await p.textContent(fair + ' .hours-error')).includes('after the start'), 'end before start refused');
  await p.click(fair + ' button:has-text("Cancel")');
  check(!(await p.isVisible(fair + ' .hours-form')) && await p.isVisible(fair + ' .hours-row'), 'cancel closes the form');
  await p.click(fair + ' button:has-text("Log hours")');
  await p.fill(fair + ' input[type=time] >> nth=1', '15:30');
  await p.click(fair + ' button:has-text("Save hours")');
  s = (await signups(p)).find(x => x.eventId === 'demo-ev-fair');
  check(s.hours.minutes === 330 && s.hours.method === 'times', 'times saved');
  check((await p.textContent('#hours-summary')).includes('8 h 17 min') && (await p.textContent('#hours-summary')).includes('2 shifts logged'), 'summary total');
  check((await p.textContent(fair + ' > .badges .badge')) === 'Done', 'badge Done');
  // The demo makes you its Admin, and an Admin's hours need another Admin (ATT-3).
  check((await p.textContent(fair + ' .hours-row')).includes('Waiting for another Admin'), 'logged hours wait for another Admin');

  // ----- Edit: duration -----
  await p.click(fair + ' button[aria-label^="Edit hours"]');
  await p.check(fair + ' input[value=duration]', { force: true });
  check(await p.isVisible(fair + ' .hours-duration') && !(await p.isVisible(fair + ' .hours-times')), 'duration fields');
  check((await p.inputValue(fair + ' input[id$=-hours]')) === '5' && (await p.inputValue(fair + ' input[id$=-minutes]')) === '30', 'duration prefilled from logged hours');
  await p.fill(fair + ' input[id$=-hours]', '0'); await p.fill(fair + ' input[id$=-minutes]', '0');
  await p.click(fair + ' button:has-text("Save hours")');
  check((await p.textContent(fair + ' .hours-error')).includes('Enter how long'), 'zero refused');
  await p.fill(fair + ' input[id$=-hours]', '25');
  await p.click(fair + ' button:has-text("Save hours")');
  check((await p.textContent(fair + ' .hours-error')).includes('more than 24 hours'), 'over 24h refused');
  await p.fill(fair + ' input[id$=-hours]', '4'); await p.fill(fair + ' input[id$=-minutes]', '75');
  await p.click(fair + ' button:has-text("Save hours")');
  check((await p.textContent(fair + ' .hours-error')).includes('0 to 59'), 'minutes over 59 refused');
  await p.fill(fair + ' input[id$=-minutes]', '15');
  await p.click(fair + ' button:has-text("Save hours")');
  s = (await signups(p)).find(x => x.eventId === 'demo-ev-fair');
  check(s.hours.minutes === 255 && s.hours.method === 'duration' && !s.hours.from, 'duration saved');
  check((await p.textContent(fair + ' .hours-done')).includes('4 h 15 min') && (await p.textContent(fair + ' .hours-done')).includes('as a duration'), 'duration shown');
  await p.reload();
  check((await p.textContent('#hours-summary')).includes('7 h 2 min'), 'total after reload');
  await p.screenshot({ path: SP + '/hours-test-desk.png', fullPage: true });

  // Future and cancelled shifts: no hours controls
  await p.goto(B + 'signup.html?event=demo-ev-park');
  await p.check('input[value="demo-ev-park-shift-0-0"]'); await p.click('#continue'); await p.click('#submit');
  await p.waitForSelector('#confirm-view:not([hidden])');
  await p.goto(B + 'signup.html?view=mine');
  check(!(await p.$('.my-signup:has-text("Riverside Park Clean-up") .hours-row')), 'future shift: no hours yet');
  await p.context().close();

  // ----- 12:30: missed check-in → log hours; checked in → "Log hours instead" -----
  p = await open(12, 30, 375);
  await signIn(p);
  await p.goto(B + 'signup.html?view=mine');
  check(await p.isVisible(garden + ' .hours-ask'), 'after the shift without check-in: log hours');
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'phone fits');
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('sevak.signups.v1')); s.find(x => x.id === 'demo-you-0').checkInAt = new Date(Date.now() - 3600000).toISOString(); localStorage.setItem('sevak.signups.v1', JSON.stringify(s)); });
  await p.reload();
  await p.click(garden + ' button:has-text("Log hours instead")');
  check((await p.inputValue(garden + ' input[type=time] >> nth=0')) === '11:30', 'form starts at the check-in time');
  await p.screenshot({ path: SP + '/hours-test-phone.png', fullPage: true });
  await p.context().close();

  console.log(n + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
