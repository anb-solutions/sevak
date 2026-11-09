const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const errs = [];
  const pages = ['index.html','terms.html','privacy.html','app/signin.html','app/profile.html','app/organization.html','app/events.html','app/event.html','app/main-event.html','app/dashboard.html','app/signup.html'];
  for (const w of [320, 375, 1100]) for (const f of pages) {
    const p = await b.newPage({ viewport: { width: w, height: 700 } });
    p.on('pageerror', e => errs.push(f + ' ' + e.message));
    await p.goto('http://localhost:8765/' + f);
    const t = await p.textContent('.brand');
    if (!/Sevak\s*Volunteer Management System\s*A Service of The ANB Group/.test(t)) errs.push(f + ' text ' + t);
    if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)) errs.push(`overflow ${f} @${w}`);
    const navRows = await p.evaluate(() => { const groups = [...document.querySelectorAll('.app-nav .nav-group')]; return Math.max(1, ...groups.map(g => new Set([...g.children].filter(c => getComputedStyle(c).display !== 'none').map(a => { const r = a.getBoundingClientRect(); return Math.round((r.top + r.height / 2) / 6); })).size)); });
    if (w >= 375 && navRows > 1) errs.push(`nav wraps ${f} @${w}`);
    if ((f === 'index.html' || f === 'app/dashboard.html') && w !== 1100) await p.screenshot({ path: process.argv[2] + `/sub-${f.replace('/','_')}-${w}.png`, clip: { x: 0, y: 0, width: w, height: 160 } });
    await p.close();
  }
  console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
