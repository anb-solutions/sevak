const { chromium } = require('playwright');
const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; let n = 0;
  const check = (c, m) => c ? n++ : errs.push(m);
  for (const [w, scheme] of [[1000, 'light'], [360, 'dark']]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 }, colorScheme: scheme });
    p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('dialog', d => d.accept());
    await p.goto('http://localhost:8765/app/profile.html');
    await p.evaluate(() => localStorage.clear()); await p.reload();
    check((await p.$$('input[name=services]:checked')).length === 0 && (await p.$$('input[name=services]')).length === 8, 'eight services, none chosen');
    await p.fill('#firstName', 'Bala'); await p.fill('#lastName', 'A'); await p.fill('#email', 'bala@example.com');
    await p.fill('#phone', '5125550100');
    await p.check('input[name=availability][value=anytime]', { force: true });
    await p.click('#tab-about');
    await p.fill('#aboutMe', 'I run a small business and love music.');
    await p.fill('#passion', 'Arts education');
    await p.fill('#certifications', 'CPR and First Aid');
    await p.fill('#howICanHelp', 'Sound systems and accounts');
    check((await p.textContent('[data-counter-for=passion]')) === '14 / 500', 'counter');
    await p.click('#tab-details');
    await p.click('.service-option:has-text("AV system help")');
    await p.click('.service-option:has-text("Accounting")');
    await p.click('.service-option:has-text("General help")');
    check((await p.$$('input[name=services]:checked')).length === 3, 'several services at once');
    await p.click('.service-option:has-text("Accounting")');
    check(!(await p.isChecked('input[name=services][value=accounting]')), 'tap again to untick');
    await p.click('#save');
    check((await p.textContent('#status')).includes('saved'), 'saved: ' + await p.textContent('#status'));
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('sevak.profile.v1')));
    check(saved.aboutMe.startsWith('I run') && saved.passion === 'Arts education' && saved.certifications === 'CPR and First Aid' && saved.howICanHelp.startsWith('Sound'), 'about saved');
    check(JSON.stringify(saved.services) === '["general","av"]', 'services saved ' + JSON.stringify(saved.services));
    await p.reload();
    check(await p.inputValue('#certifications') === 'CPR and First Aid', 'reload fills'); await p.click('#tab-details');
    check(JSON.stringify(await p.$$eval('input[name=services]:checked', x => x.map(y => y.value))) === '["general","av"]', 'reload ticks');
    check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'no overflow ' + w);

    await p.screenshot({ path: `${SP}/aboutme-${w}.png`, fullPage: true });
    await p.click('#delete-profile');
    check(await p.inputValue('#aboutMe') === '' && (await p.$$('input[name=services]:checked')).length === 0, 'delete clears');
    check((await p.textContent('[data-counter-for=aboutMe]')) === '0 / 1000', 'counter reset');
    await p.close();
  }
  console.log(n + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
