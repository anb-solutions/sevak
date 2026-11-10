// Task leads (EVT-21): an Admin picks a lead for a task in the event
// editor, from the organization's team and members; the Events list says
// which tasks have none; the lead sees who's coming to their task on My
// sign-ups. Coordinators can't choose.
const { chromium } = require('playwright');
const B = 'http://localhost:8765/app/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; let n = 0; const check = (c, m) => c ? n++ : errs.push(m);
  const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
  p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('dialog', d => d.accept());
  const ls = k => p.evaluate(k => JSON.parse(localStorage.getItem(k)), k);
  const signInAs = (first, last, email) => p.evaluate(([first, last, email]) => {
    localStorage.setItem('sevak.profile.v1', JSON.stringify({ firstName: first, lastName: last, email, roles: { volunteer: true } }));
    localStorage.removeItem('sevak.signedOut.v1');
  }, [first, last, email]);
  const park = async () => (await ls('sevak.events.v1')).find(e => e.id === 'demo-ev-park');

  await p.goto(B + 'outbox.html'); await p.evaluate(() => localStorage.clear());
  await signInAs('Bala', 'A', 'bala@example.com');
  await p.goto(B + 'dashboard.html?demo=1');   // Bala: Admin of Riverside

  // ----- An Admin picks a lead for a task -----
  await p.goto(B + 'event.html?id=demo-ev-park');
  const litter = '.role-card:has(input[data-key="name"][value="Litter pickers"]), .role-card >> nth=0';
  const leadSel = '.role-card >> nth=0 >> select[data-key="lead"]';
  const options = await p.$$eval('.role-card select[data-key="lead"] >> nth=0', s => [...s[0].options].map(o => [o.value, o.textContent]));
  const members = (await ls('sevak.memberships.v1')).filter(m => m.orgId === 'demo-org' && m.status === 'active');
  const lead = members[0];
  check(options[0][1] === 'No task lead yet' && options.some(o => o[1] === 'Bala A (Admin)') && options.some(o => o[0] === lead.email.toLowerCase() && o[1] === lead.name + ' (' + lead.email.toLowerCase() + ')'),
    'the picker offers the team and the members: ' + options.slice(0, 3).map(o => o[1]).join(', '));
  check(!options.some(o => o[0] === 'priya.nair@example.com'), 'not people who only asked to join');
  const label = await p.$eval(leadSel, s => document.querySelector('label[for="' + s.id + '"]').textContent);
  check(/Task lead/.test(label) && (await p.getAttribute(leadSel, 'aria-describedby')).endsWith('-hint'), 'labelled, with its hint');
  await p.selectOption(leadSel, lead.email.toLowerCase());
  await p.click('#publish');   // "Save changes"
  await p.waitForURL(/events\.html/);
  const saved = await park();
  check(saved.roles[0].lead === lead.email.toLowerCase() && !saved.roles[1].lead, 'saved: ' + saved.roles.map(r => r.name + '=' + (r.lead || '-')).join(', '));
  check((await p.textContent('[data-event-id="demo-ev-park"]')).includes('1 task without a task lead'), 'Events: says which still need a lead');
  await p.goto(B + 'event.html?id=demo-ev-park');
  check((await p.inputValue(leadSel)) === lead.email.toLowerCase(), 'the editor shows the lead again');
  await p.screenshot({ path: SP + '/tasklead-editor.png' });

  // ----- The lead sees who's coming to their task -----
  // Sign-ups keep a phone as { country, number, whatsapp }; the demo's have none.
  await p.evaluate(shiftId => {
    const l = JSON.parse(localStorage.getItem('sevak.signups.v1'));
    l.find(s => s.shiftId === shiftId && s.status !== 'cancelled').phone = { country: 'US', number: '+15125550123', whatsapp: false };
    localStorage.setItem('sevak.signups.v1', JSON.stringify(l));
  }, saved.roles[0].shifts[0].id);
  const [first, ...rest] = lead.name.split(' ');
  await signInAs(first, rest.join(' '), lead.email);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(B + 'signup.html?view=mine');
  check(await p.isVisible('#leading'), 'My sign-ups: Tasks you lead');
  const task = await p.textContent('#lead-list');
  const ev = await park();
  const shift = ev.roles[0].shifts[0];
  const coming = (await ls('sevak.signups.v1')).filter(s => s.eventId === 'demo-ev-park' && s.shiftId === shift.id && s.status !== 'cancelled');
  const other = (await ls('sevak.signups.v1')).find(s => s.eventId === 'demo-ev-park' && s.shiftId === ev.roles[1].shifts[0].id);
  check(task.includes('Litter pickers · Riverside Park Clean-up') && task.includes(coming.length + ' of ' + shift.capacity + ' signed up'), 'the task, its shift and how full it is: ' + task.slice(0, 120));
  check(coming.every(s => task.includes(s.name)) && (!other || !task.includes(other.name)) && !task.includes('Check-in desk'), 'everyone coming to it by name, nobody from the other task');
  const links = await p.$$eval('#lead-list .lead-roster a', a => a.map(x => x.getAttribute('href')));
  check(links.some(h => h.startsWith('mailto:')) && links.includes('tel:+15125550123'), 'email and phone links: ' + links.filter(h => h.startsWith('tel:')).join(', '));
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'fits at 390px');
  await p.screenshot({ path: SP + '/tasklead-mine-phone.png', fullPage: true });

  // ----- Someone else doesn't see it -----
  await signInAs('Pat', 'Q', 'pat@example.com');
  await p.goto(B + 'signup.html?view=mine');
  check(await p.isHidden('#leading'), 'not a lead: no Tasks you lead');

  // ----- A Coordinator can't choose -----
  await signInAs('Bala', 'A', 'bala@example.com');
  await p.evaluate(() => {
    const l = JSON.parse(localStorage.getItem('sevak.organizations.v1'));
    const o = l.find(x => x.id === 'demo-org'); o.team = [{ name: 'Bala A', email: 'bala@example.com', role: 'coordinator' }]; o.createdBy = 'ann@example.com';
    if (o.primaryContact) o.primaryContact.email = 'ann@example.com';
    localStorage.setItem('sevak.organizations.v1', JSON.stringify(l));
  });
  await p.setViewportSize({ width: 1000, height: 900 });
  await p.goto(B + 'event.html?id=demo-ev-park');
  check(await p.isDisabled(leadSel) && (await p.textContent('.role-card >> nth=0 >> .lead-hint')).includes('Only the organization\'s Admins choose task leads.'), 'Coordinator: the lead is shown, not changeable');
  await p.fill('#title', 'Riverside Park Clean-up (edited)');
  await p.click('#publish');
  await p.waitForURL(/events\.html/);
  check((await park()).roles[0].lead === lead.email.toLowerCase(), 'a Coordinator\'s save keeps the lead');
  check(!(await p.textContent('[data-event-id="demo-ev-park"]')).includes('without a task lead'), 'and the Events note is for Admins only');

  console.log(n + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
