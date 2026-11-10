const { chromium } = require('playwright');
const SP = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const [w, scheme] of [[1100, 'light'], [375, 'light'], [320, 'dark']]) {
    const p = await b.newPage({ viewport: { width: w, height: 800 }, colorScheme: scheme });
    p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:8765/index.html');
    const t = await p.textContent('body');
    for (const bad of ['Coming soon', "What's coming", 'Try the prototype', 'Food Drive']) if (t.includes(bad)) errs.push('found ' + bad);
    if (!t.includes('Welcome Volunteer') || !t.includes('A Service of The ANB Group') || !t.includes('© 2026 The ANB Group')) errs.push('missing text');
    const ov = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (ov) errs.push('overflow at ' + w);
    await p.screenshot({ path: `${SP}/landing-${w}-${scheme}.png`, fullPage: true });
    await p.close();
  }
  const p = await b.newPage({ viewport: { width: 375, height: 800 } });
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html');
  await p.click('text=Sign up'); if (!p.url().endsWith('app/join.html')) errs.push('signup link ' + p.url());
  await p.goto('http://localhost:8765/index.html');
  await p.click('a:has-text("Sign in")'); if (!p.url().endsWith('app/signin.html')) errs.push('signin link');
  // Wait for the page's script: on a busy machine a click can come first,
  // and the form then reloads the page instead of showing the message.
  await p.waitForLoadState('load');
  await p.click('button:has-text("Sign in")');
  if (!(await p.textContent('#email-error')).includes('required')) errs.push('empty msg: ' + await p.textContent('#email-error'));
  await p.fill('#email', 'nobody@example.com'); await p.click('button:has-text("Sign in")');
  if (!(await p.textContent('#email-error')).includes("couldn't find")) errs.push('notfound');
  await p.screenshot({ path: `${SP}/signin-375.png`, fullPage: true });
  await p.evaluate(() => localStorage.setItem('sevak.profile.v1', JSON.stringify({ email: 'Asha@Example.com' })));
  await p.fill('#email', 'asha@example.com'); await p.click('button:has-text("Sign in")');
  await p.waitForURL(/signup\.html/);
  console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS');
  await b.close();
})();
