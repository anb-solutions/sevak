// The Help page: fits a phone, has its sections, every link in its contents
// goes somewhere on the page, and every page's footer links to it.
const { chromium } = require('playwright');
const ROOT = 'http://localhost:8765/'; const SP = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = []; const ok = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('pageerror ' + e.message));
  const check = (c, m) => c ? ok.push(m) : errs.push('FAIL ' + m);

  // Signed out, at 390px.
  await p.goto(ROOT + 'app/help.html');
  check((await p.textContent('h1')) === 'Help', 'the Help page opens');
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'phone: no overflow');
  check(!!(await p.$('#app-nav a[href="signin.html"]')) && await p.isVisible('#tab-bar a[href="signin.html"]'), 'the menu is drawn (at the bottom on phones)');
  for (const [id, title] of [['volunteers', 'For volunteers'], ['organizations', 'For organizations'], ['event-day', 'On the day of your event'],
    ['roles', 'Roles: who can do what'], ['contact', 'Contact']]) {
    check((await p.textContent('#' + id + ' h2')).trim() === title, 'section: ' + title);
  }
  const roles = await p.$$eval('#roles tbody th', ths => ths.map(t => t.textContent.trim()));
  check(JSON.stringify(roles) === JSON.stringify(['Volunteer', 'Coordinator', 'Admin', 'Task lead', 'Event admin']), 'roles table: ' + JSON.stringify(roles));
  check(await p.isVisible('#contact a[href="mailto:support@theanbgroup.com"]'), 'support address');

  // Every in-page link has a target, and every section is in the contents.
  const missing = await p.$$eval('a[href^="#"]', as => as.map(a => a.getAttribute('href')).filter(h => !document.getElementById(h.slice(1))));
  check(missing.length === 0, 'every in-page link has a target: ' + JSON.stringify(missing));
  const listed = await p.$$eval('.help-toc a', as => as.map(a => a.getAttribute('href').slice(1)));
  const unlisted = await p.$$eval('main section[id], main h3[id]', (els, l) => els.map(e => e.id).filter(id => !l.includes(id)), listed);
  check(unlisted.length === 0, 'every section is in the contents: ' + JSON.stringify(unlisted));
  await p.click('.help-toc a[href="#roles"]');
  check((await p.evaluate(() => location.hash)) === '#roles' && await p.isVisible('#roles table'), 'a contents link jumps to its section');

  // Links to other pages are to pages that exist.
  const hrefs = await p.$$eval('main a[href]:not([href^="#"]):not([href^="mailto:"])', as => [...new Set(as.map(a => a.href.split('#')[0]))]);
  for (const href of hrefs) {
    const res = await ctx.request.get(href);
    check(res.ok(), 'link works: ' + href);
  }
  await p.screenshot({ path: SP + '/help.png', fullPage: true });

  // No inline scripts or styles (the content security policy allows neither).
  const html = await (await ctx.request.get(ROOT + 'app/help.html')).text();
  check(!/<script(?![^>]*\bsrc=)|<style|\sstyle=|\son[a-z]+=/i.test(html), 'no inline scripts or styles');

  // The footer of every page links to Help, and the welcome page has it near Sign in.
  const pages = ['index.html', 'privacy.html', 'terms.html', 'app/signin.html', 'app/join.html', 'app/profile.html', 'app/signup.html',
    'app/events.html', 'app/event.html', 'app/main-event.html', 'app/volunteers.html', 'app/dashboard.html', 'app/organization.html',
    'app/certificate.html', 'app/verify.html', 'app/outbox.html', 'app/review.html'];
  for (const f of pages) {
    await p.goto(ROOT + f);
    const link = await p.$('.site-footer a[href$="help.html"]');
    check(link && (await link.textContent()) === 'Help', f + ': footer links to Help');
    if (link) {
      await link.click();
      await p.waitForURL(/app\/help\.html$/);
      check((await p.textContent('h1')) === 'Help', f + ': the footer link opens Help');
    }
  }
  await p.goto(ROOT + 'index.html');
  await p.click('.welcome-help a');
  await p.waitForURL(/app\/help\.html$/);
  check(true, 'welcome page: Help next to Sign in and Sign up');

  console.log(ok.length + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
