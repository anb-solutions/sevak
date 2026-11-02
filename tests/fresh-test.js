// A fresh or private browser window (no saved data, or storage blocked), and
// a sweep that every visible text box on every page has a usable width.
const { chromium } = require('playwright');
const B = 'http://localhost:8765/app/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; let n = 0; const check = (c, m) => c ? n++ : errs.push(m);
  const fits = p => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  const width = (p, sel) => p.$eval(sel, e => Math.round(e.getBoundingClientRect().width));

  for (const w of [390, 1100]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(w + ' pageerror ' + e.message));
    await p.goto(B + 'join.html');
    check(await p.isVisible('#demo-offer'), w + ': empty browser: offer to load the demo');
    await p.click('label:has(#way-request)');
    check((await width(p, '#org-search')) > 200 && await fits(p), w + ': request: search box has room, page fits (' + await width(p, '#org-search') + ')');
    check(await p.isVisible('#org-pick-empty') && (await width(p, '#org-pick-empty')) > 200 && (await p.textContent('#org-pick-empty')).includes('No organizations on Sevak yet'), w + ': empty list message shows');
    await p.screenshot({ path: `${SP}/fresh-request-${w}.png`, fullPage: true });
    await p.click('label:has(#way-invite)');
    check((await width(p, '#code')) > 200 && await fits(p), w + ': invite: code box has room');
    await p.fill('#code', 'PANTRY');
    await p.click('#join-continue');
    check((await p.textContent('#code-error')).includes("don't recognise"), w + ': no orgs: code not found');
    await p.click('#load-demo');
    check(await p.isHidden('#demo-offer') && await p.isVisible('#demo-loaded') && await p.evaluate(() => document.activeElement.id) === 'demo-loaded', w + ': demo loaded, said so');
    check((await p.textContent('#code-found')).includes('Eastside Food Pantry'), w + ': code now found');
    await p.click('label:has(#way-request)');
    check((await p.$$('#org-pick li')).length === 2 && await p.isHidden('#org-pick-empty'), w + ': two organizations to pick');
    await p.goto(B + 'join.html');
    check(await p.isHidden('#demo-offer'), w + ': no offer once there are organizations');
    await ctx.close();
  }

  // Storage blocked by the browser: the page still works, no script errors
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
    const p = await ctx.newPage();
    await p.addInitScript(() => { for (const k of ['localStorage', 'sessionStorage']) Object.defineProperty(window, k, { get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } }); });
    const pe = []; p.on('pageerror', e => pe.push(e.message));
    for (const pg of ['../index.html', 'join.html', 'signup.html', 'profile.html', 'signin.html']) await p.goto(B + pg);
    await p.goto(B + 'join.html');
    await p.click('label:has(#way-request)');
    check(pe.length === 0 && (await width(p, '#org-search')) > 200, 'storage blocked: no errors ' + JSON.stringify(pe));
    await ctx.close();
  }

  // Every visible text box on every page has room (demo loaded, signed in)
  const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(B + 'outbox.html');
  await p.evaluate(() => localStorage.setItem('sevak.profile.v1', JSON.stringify({ firstName: 'Bala', lastName: 'A', email: 'bala@example.com', roles: { volunteer: true } })));
  await p.goto(B + 'dashboard.html?demo=1');
  const pages = ['join.html', 'signin.html', 'profile.html', 'organization.html', 'events.html', 'event.html?id=demo-ev-park', 'main-event.html?id=demo-main-arudra', 'volunteers.html', 'dashboard.html', 'signup.html', 'signup.html?event=demo-ev-park', 'outbox.html', 'review.html', 'verify.html?code=SVK-NONE-0000'];
  for (const w of [360, 1100]) {
    await p.setViewportSize({ width: w, height: 900 });
    for (const pg of pages) {
      await p.goto(B + pg);
      // Open each tab and choice that reveals more boxes
      await p.evaluate(() => { document.querySelectorAll('input[name=way]').forEach(r => { r.checked = r.value === 'request'; r.dispatchEvent(new Event('change', { bubbles: true })); }); });
      const tabs = await p.$$('[role=tab]');
      const narrow = [];
      for (let i = 0; i <= tabs.length; i++) {
        if (i < tabs.length) { if (await tabs[i].isVisible()) await tabs[i].click(); else continue; }
        narrow.push(...await p.$$eval('input:not([type=radio]):not([type=checkbox]):not([type=hidden]):not([type=file]), select, textarea', els => els.filter(e => e.offsetParent && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().width < 60).map(e => (e.id || e.name || e.tagName) + ':' + Math.round(e.getBoundingClientRect().width))));
      }
      check(narrow.length === 0, `${pg} @${w}: squeezed boxes ${[...new Set(narrow)].join(', ')}`);
    }
  }
  await ctx.close();
  console.log(n + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
