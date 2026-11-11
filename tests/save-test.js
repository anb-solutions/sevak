// Saving leaves the form: the event, main event, organization and profile
// pages go back to where they belong, which says what was saved, highlights
// it and moves keyboard focus to the message. A save that fails stays put.
const { chromium } = require('playwright');
const B = 'http://localhost:8765/app/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; let n = 0; const check = (c, m) => c ? n++ : errs.push(m);
  const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
  p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('dialog', d => d.accept());
  const flash = () => p.textContent('#saved-flash');
  const focused = () => p.evaluate(() => document.activeElement && document.activeElement.id);

  await p.goto(B + 'outbox.html'); await p.evaluate(() => localStorage.clear());
  await p.evaluate(() => localStorage.setItem('sevak.profile.v1', JSON.stringify({ firstName: 'Bala', lastName: 'A', email: 'bala@example.com', phone: { country: 'US', number: '+15125550100' }, availability: 'anytime', roles: { volunteer: true } })));
  await p.goto(B + 'dashboard.html?demo=1');   // Bala: Admin of Riverside

  // ----- Event: Save draft, Publish, Save changes, Unpublish -----
  await p.goto(B + 'event.html');
  await p.click('#save-draft');
  check(/event\.html/.test(p.url()) && !(await p.$('#saved-flash')), 'a save that fails (no name) stays on the form');
  await p.fill('#title', 'Book swap');
  await p.click('#step-next');   // the dates are on the next step
  await p.fill('#startDate', '2030-03-01');
  await p.dispatchEvent('#startDate', 'change');
  await p.click('#save-draft');
  await p.waitForURL(/events\.html/);
  check((await flash()).includes('Saved “Book swap” as a draft.'), 'draft: back on Events, saying so');
  check(await focused() === 'saved-flash' && (await p.getAttribute('#saved-flash', 'role')) === 'status', 'focus on the message, announced');
  check((await p.$$eval('.just-saved', e => e.map(x => x.textContent))).some(t => t.includes('Book swap')), 'the saved event is highlighted');
  await p.screenshot({ path: SP + '/save-event-draft.png' });
  await p.click('#saved-flash a:has-text("Open it again")');
  await p.waitForURL(/event\.html\?id=/);
  check((await p.inputValue('#title')) === 'Book swap' && !(await p.$('#saved-flash')), 'Open it again reopens it; the message shows once');
  const evId = new URL(p.url()).searchParams.get('id');
  await p.goto(B + 'event.html?id=demo-ev-park');
  await p.click('#publish');
  await p.waitForURL(/events\.html/);
  check((await flash()).includes('Saved changes to “Riverside Park Clean-up”.'), 'published event: Save changes');
  await p.goto(B + 'event.html?id=demo-ev-park#review');
  await p.click('#save-draft');   // "Unpublish" on a published event, on the Review step
  await p.waitForURL(/events\.html/);
  check((await flash()).includes('Unpublished “Riverside Park Clean-up”. It\'s a draft again.'), 'unpublished');
  await p.click('#saved-flash button:has-text("Dismiss")');
  check(!(await p.$('#saved-flash')), 'the message can be dismissed');
  await p.reload();
  check(!(await p.$('#saved-flash')), 'and doesn\'t come back on reload');
  check(evId && (await p.evaluate(id => JSON.parse(localStorage.getItem('sevak.events.v1')).some(e => e.id === id && e.status === 'draft'), evId)), 'the draft was saved');

  // ----- Main event -----
  await p.goto(B + 'main-event.html');
  await p.click('#main-form button[type=submit]');
  check(/main-event\.html/.test(p.url()) && !(await p.$('#saved-flash')), 'main event without a title stays');
  await p.fill('#title', 'Spring Fair');
  await p.click('#main-form button[type=submit]');
  await p.waitForURL(/events\.html/);
  check((await flash()).includes('Saved the main event “Spring Fair”. Add its sub-events with + Sub-event.'), 'new main event: says what next');
  check((await p.$$eval('.main-group.just-saved h3', h => h.map(x => x.textContent))).includes('Spring Fair'), 'the main event is highlighted');

  // ----- Organization -----
  await p.goto(B + 'organization.html');
  await p.fill('#orgName', '');
  await p.click('#save-bar button[type=submit]');
  check(/organization\.html/.test(p.url()) && !(await p.$('#saved-flash')), 'organization with errors stays');
  await p.goto(B + 'organization.html');
  await p.click('#save-bar button[type=submit]');
  await p.waitForURL(/events\.html/);
  check((await flash()).includes('Saved the profile of “Riverside Community Arts (demo)”.') && (await p.textContent('#saved-flash a')) === 'Edit the organization', 'organization: on to Events');

  // ----- Profile: back to where you came from -----
  await p.goto(B + 'volunteers.html');
  await p.click('#app-nav a:has-text("Profile")');
  await p.waitForURL(/profile\.html/);
  await p.click('#save');
  await p.waitForURL(/volunteers\.html/);
  check((await flash()).includes('Your profile is saved') && (await p.textContent('#saved-flash a')) === 'Edit your profile', 'profile: back to the page you came from');
  await p.goto(B + 'profile.html');   // no page before it
  await p.click('#save');
  await p.waitForURL(/signup\.html/);
  check((await flash()).includes('Your profile is saved'), 'profile opened directly: on to opportunities');
  await p.goto(B + 'profile.html');
  await p.fill('#email', 'not-an-email');
  await p.click('#save');
  check(/profile\.html/.test(p.url()) && !(await p.$('#saved-flash')), 'profile with errors stays');

  // ----- Phone -----
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(B + 'event.html?id=demo-ev-park#review');   // a draft again, so Publish is on the Review step
  await p.click('#publish');
  await p.waitForURL(/events\.html/);
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)) && await p.isVisible('#saved-flash'), 'phone: the message fits');
  await p.screenshot({ path: SP + '/save-phone.png' });

  console.log(n + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
