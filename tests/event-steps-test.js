// The event editor in steps (EVT-22): + Sub-event opens a "New sub-event"
// that says sub-event throughout, starts at the organization's address and
// its sibling's time zone, goes one step at a time (Next checks the step),
// reviews what's set, and on publishing goes back to its main event. A
// standalone event says "event"; a published one saves from any step.
const { chromium } = require('playwright');
const B = 'http://localhost:8765/app/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; let n = 0; const check = (c, m) => c ? n++ : errs.push(m);
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('dialog', d => d.accept());
  const ls = k => p.evaluate(k => JSON.parse(localStorage.getItem(k)), k);
  const shown = () => p.$$eval('.wizard-step', s => s.filter(x => !x.hidden).map(x => x.id));
  const current = () => p.$eval('#stepper [aria-current="step"]', b => b.dataset.step);
  const fits = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

  await p.goto(B + 'outbox.html'); await p.evaluate(() => localStorage.clear());
  await p.evaluate(() => localStorage.setItem('sevak.profile.v1', JSON.stringify({ firstName: 'Bala', lastName: 'A', email: 'bala@example.com', roles: { volunteer: true } })));
  await p.goto(B + 'dashboard.html?demo=1');   // Bala: Admin of Riverside
  // The festival's other sub-events are in Chicago time.
  await p.evaluate(() => {
    const l = JSON.parse(localStorage.getItem('sevak.events.v1'));
    l.filter(e => e.mainEventId === 'demo-main-arudra').forEach(e => { e.timezone = 'America/Chicago'; });
    localStorage.setItem('sevak.events.v1', JSON.stringify(l));
  });
  const org = (await ls('sevak.organizations.v1')).find(o => o.id === 'demo-org');

  // ----- The main event page: its sub-events first -----
  await p.goto(B + 'main-event.html?id=demo-main-arudra');
  check(await p.$eval('#sub-list', l => l.closest('section').compareDocumentPosition(document.getElementById('main-details')) & Node.DOCUMENT_POSITION_FOLLOWING) &&
    await p.isHidden('#main-intro') && !(await p.$('.org-context:not([hidden])')) && (await p.textContent('#org-line')) === org.name, 'main event: sub-events first, the organization as one line');
  await p.click('#add-sub');
  await p.waitForURL(/event\.html\?main=demo-main-arudra/);

  // ----- Step 1: details, as a sub-event -----
  check((await p.textContent('#page-title')) === 'New sub-event' && (await p.textContent('#details-title')) === 'Sub-event details' &&
    (await p.textContent('label[for="title"]')) === 'Sub-event name', 'says sub-event, as chosen');
  check((await p.textContent('#back-link')).includes('Arudra Dance Festival') && await p.isHidden('#event-tabs'), 'back to the festival; no tabs until it\'s saved');
  check(JSON.stringify(await shown()) === '["step-details"]' && (await current()) === '0', 'one step at a time');
  check(await p.isVisible('#main-line') && (await p.textContent('#main-line-name')) === 'Arudra Dance Festival' && await p.isHidden('#main-picker'), 'its main event as one line');
  check(await p.isHidden('#step-back') && await p.isVisible('#save-draft') && await p.isVisible('#step-next') && await p.isHidden('#publish'), 'first step: Save draft and Next');
  await p.screenshot({ path: SP + '/steps-1-details.png' });
  await p.click('#step-next');
  check((await current()) === '0' && (await p.textContent('#title-error')).includes('required') && (await p.textContent('#status')).includes('Fix'), 'Next checks the step first');
  await p.fill('#title', 'Rehearsal 3');
  await p.press('#title', 'Enter');   // Enter goes on, it doesn't publish
  check((await current()) === '1', 'Enter: on to the next step');

  // ----- Step 2: when and where -----
  check((await p.textContent('#tz-name')) === 'America/Chicago' && await p.isHidden('#tz-picker'), 'the time zone of its other sub-events, as one line');
  check(await p.isVisible('#venue') && await p.isVisible('#address-summary') && await p.isHidden('#address-fields') &&
    (await p.textContent('#address-text')).startsWith(org.address.line1) && await p.isVisible('#address-source'), "the venue, at the organization's address");
  check(await fits(), 'step 2 fits at 390px');
  await p.screenshot({ path: SP + '/steps-2-when.png', fullPage: true });
  await p.click('#step-next');
  check((await current()) === '1' && (await p.textContent('#startDate-error')).includes('required'), 'dates needed to go on');
  await p.fill('#startDate', '2030-03-01');
  await p.dispatchEvent('#startDate', 'change');
  await p.fill('#venue', 'Studio B');
  await p.click('#step-next');

  // ----- Step 3: roles -----
  check((await current()) === '2' && (await p.$$('.role-card')).length === 1 && !(await p.$eval('#role-presets', d => d.open)), 'roles: one to fill in, common roles folded away');
  await p.click('#step-next');
  check((await current()) === '2', 'a role needs a name to go on');
  await p.fill('.role-card [data-key="name"]', 'Stage crew');
  await p.click('#step-back');
  check((await current()) === '1' && (await p.inputValue('#venue')) === 'Studio B', 'Back keeps what was typed');
  await p.click('#stepper button[data-step="3"]');

  // ----- Step 4: review -----
  const review = await p.textContent('#review-list');
  check(review.includes('Rehearsal 3 · part of Arudra Dance Festival') && review.includes('2030') && review.includes('Studio B, ' + org.address.line1) && review.includes('1 task · 1 shift · 5 volunteer spots'), 'review: ' + review);
  check(await p.isVisible('#publish') && (await p.textContent('#publish')) === 'Publish' && await p.isHidden('#step-next') && await p.isHidden('#manage-event'), 'last step: Publish; nothing to manage yet');
  check(await fits(), 'review fits at 390px');
  await p.screenshot({ path: SP + '/steps-4-review.png', fullPage: true });
  await p.click('#review-list button[aria-label="Edit where"]');
  check((await current()) === '1', 'Edit goes back to that step');
  await p.click('#stepper button[data-step="3"]');
  await p.click('#publish');
  await p.waitForURL(/main-event\.html\?id=demo-main-arudra/);
  check((await p.textContent('#saved-flash')).includes('Published “Rehearsal 3”') && (await p.$$eval('#sub-list .just-saved', e => e.map(x => x.textContent))).some(t => t.includes('Rehearsal 3')), 'published: back on the festival, highlighted');
  const saved = (await ls('sevak.events.v1')).find(e => e.title === 'Rehearsal 3');
  check(saved.mainEventId === 'demo-main-arudra' && saved.status === 'published' && saved.timezone === 'America/Chicago' &&
    saved.location.venue === 'Studio B' && saved.location.line1 === org.address.line1 && saved.location.city === org.address.city, 'saved with its venue and the organization\'s address');

  // ----- A standalone event: "event"; Publish finds what's missing -----
  await p.goto(B + 'event.html');
  check((await p.textContent('#page-title')) === 'New event' && (await p.textContent('label[for="title"]')) === 'Event name' && await p.isVisible('#main-picker'), 'standalone: says event, can join a main event');
  await p.selectOption('#mainEventId', 'demo-main-arudra');
  check((await p.textContent('#page-title')) === 'New sub-event', 'choosing a main event makes it a sub-event');
  await p.selectOption('#mainEventId', '');
  await p.fill('#title', 'Book swap');
  await p.click('#stepper button[data-step="3"]');
  await p.click('#publish');
  check((await current()) === '1' && await p.evaluate(() => document.activeElement.id) === 'startDate', 'Publish goes to the first step that needs something');

  // ----- A published event: save from any step; Unpublish and manage on Review -----
  await p.goto(B + 'event.html?id=demo-ev-park');
  check(await p.isVisible('#event-tabs') && await p.isVisible('#publish') && (await p.textContent('#publish')) === 'Save changes' &&
    await p.isHidden('#save-draft') && (await p.getAttribute('#step-next', 'class')).includes('btn-secondary'), 'published: Save changes on every step');
  await p.click('#stepper button[data-step="3"]');
  check(await p.isVisible('#save-draft') && (await p.textContent('#save-draft')) === 'Unpublish' && await p.isVisible('#manage-event') && await p.isVisible('#delete-event'), 'Review: Unpublish, Make inactive, Delete');
  await p.click('#stepper button[data-step="1"]');
  await p.click('#tz-change');
  check(await p.isVisible('#timezone') && await p.evaluate(() => document.activeElement.id) === 'timezone', 'Change opens the time zone');
  await p.click('#address-change');
  check(await p.isVisible('#addressLine1') && await p.isHidden('#address-summary'), 'Change opens the address');

  console.log(n + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
