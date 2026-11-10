const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const w of [1100, 320]) {
    const p = await b.newPage({ viewport: { width: w, height: 800 } });
    await p.goto('http://localhost:8765/index.html');
    if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)) errs.push('overflow ' + w);
    await p.screenshot({ path: process.argv[2] + `/shortcuts-${w}.png`, fullPage: true });
    for (const [t, u] of [['My profile','profile.html'],['Organization','organization.html'],['Events','events.html'],['Volunteer sign-up','signup.html'],['Dashboard with demo data','dashboard.html?demo=1']]) {
      await p.goto('http://localhost:8765/index.html');
      await p.click(`.shortcuts >> text="${t}"`);
      if (!p.url().endsWith(u)) errs.push(t + ' -> ' + p.url());
    }
    await p.close();
  }
  console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
