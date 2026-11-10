// Personal details never go in a web address. On a slow connection someone
// can press Sign in or Save before the page's script has loaded; the form
// then does nothing (method="dialog") rather than reload the page with what
// was typed in its address, where browser history and server logs keep it.
// Browsers that don't know method="dialog" submit the old way, so the fields
// that hold personal details have no names either.
const { chromium } = require('playwright');
const B = 'http://localhost:8765/app/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; let n = 0; const check = (c, m) => c ? n++ : errs.push(m);
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', e => errs.push('pageerror ' + e.message));

  // Hold back the page's scripts, like a slow phone connection, until release().
  let gate = null, release = () => {};
  const hold = () => { gate = new Promise(r => { release = () => { gate = null; r(); }; }); };
  await p.route(/\/app\/[\w-]+\.js$/, async route => { if (gate) await gate; await route.continue(); });
  const navigated = () => p.waitForURL(/\?/, { timeout: 1500 }).then(() => true, () => false);
  const personal = ['pat.q', 'example.com', 'Pat', 'Quill', '5125550100', 'Elm'];
  const leaked = url => personal.filter(w => decodeURIComponent(url).includes(w));

  // ----- Sign in, pressed before signin.js loads -----
  hold();
  await p.goto(B + 'signin.html', { waitUntil: 'commit' });
  await p.waitForSelector('#signin-submit');
  check(await p.$$eval('#signin-form [name], #code-form [name]', e => e.length) === 0 &&
    (await p.$$eval('#signin-form, #code-form', f => f.map(x => x.getAttribute('method')))).join() === 'dialog,dialog', 'sign-in: forms never submit on their own; no field names');
  await p.fill('#email', 'pat.q@example.com');
  await p.click('#signin-submit');
  check(!(await navigated()) && p.url() === B + 'signin.html', 'sign-in pressed early: the web address stays as it was: ' + p.url());
  check((await p.inputValue('#email')) === 'pat.q@example.com', 'and the email typed is still there');
  await p.screenshot({ path: SP + '/form-privacy-signin.png' });
  // A browser without method="dialog" submits the old way: nothing personal goes.
  await p.evaluate(() => document.getElementById('signin-form').setAttribute('method', 'get'));
  await p.click('#signin-submit');
  await navigated();
  check(!leaked(p.url()).length, 'older browsers: no email in the address either: ' + p.url());
  release();
  await p.waitForLoadState('load');
  // Once the script has loaded, Sign in works as before.
  await p.fill('#email', 'nobody@example.com');
  await p.click('#signin-submit');
  check((await p.textContent('#email-error')).includes("couldn't find") && !p.url().includes('nobody'), 'loaded: signing in works as before');

  // ----- My profile, Save pressed before profile.js loads -----
  hold();
  await p.goto(B + 'profile.html', { waitUntil: 'commit' });
  await p.waitForSelector('#save');
  const fields = { firstName: 'Pat', lastName: 'Quill', email: 'pat.q@example.com', phone: '5125550100', addressLine1: '12 Elm St', city: 'Elmwood' };
  check(await p.evaluate(ids => ids.every(id => !document.getElementById(id).hasAttribute('name')), Object.keys(fields).concat(['addressLine2', 'state', 'postalCode', 'gender', 'country'])) &&
    (await p.getAttribute('#profile-form', 'method')) === 'dialog', 'profile: the form never submits on its own; personal fields have no names');
  await p.evaluate(f => Object.keys(f).forEach(id => { document.getElementById(id).value = f[id]; }), fields);
  await p.click('#save');
  check(!(await navigated()) && p.url() === B + 'profile.html', 'profile saved early: the web address stays as it was: ' + p.url());
  check((await p.inputValue('#firstName')) === 'Pat' && (await p.inputValue('#phone')) === '5125550100', 'and what was typed is still there');
  await p.evaluate(() => document.getElementById('profile-form').setAttribute('method', 'get'));
  await p.click('#save');
  await navigated();
  check(!leaked(p.url()).length, 'older browsers: no name, email, phone or address in the address either: ' + leaked(p.url()).join(', '));
  release();
  await p.waitForLoadState('load');
  // Once loaded, errors still show by each field (they're found by id).
  await p.fill('#firstName', '');
  await p.click('#save');
  check((await p.textContent('#firstName-error')).includes('required') && /profile\.html/.test(p.url()), 'loaded: a field\'s error shows next to it');

  console.log(n + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
