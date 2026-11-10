const { chromium } = require('playwright');
const SP = process.argv[2]; const URL_ = 'http://localhost:8765/app/profile.html';
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const errs = []; let n = 0; const check = (c, m) => c ? n++ : errs.push(m);
  const ctx = await b.newContext({ viewport: { width: 1000, height: 900 }, permissions: ['camera'] });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('dialog', d => d.accept());
  await p.goto(URL_); await p.evaluate(() => localStorage.clear()); await p.reload();

  // Tabs
  check(await p.$$eval('#profile-tabs [role=tab]', t => t.map(x => x.textContent.trim()).join('|')) === 'My details|Get to know me|Documents', 'three tabs');
  check(await p.isVisible('#photo-field') && !(await p.isVisible('#about-me-section')), 'details tab: photo, no Get to know me');
  await p.click('#tab-about');
  check(await p.isVisible('#about-me-section') && !(await p.isVisible('#firstName')), 'about tab shows Get to know me');
  check(await p.isVisible('#affiliations-section') && !(await p.isVisible('#affiliations-note')), 'new profile volunteers: affiliations shown');
  check(await p.isVisible('#save-bar'), 'save bar on about tab');
  check(p.url().endsWith('#about'), 'hash');
  await p.click('#tab-documents');
  check(!(await p.isVisible('#save-bar')), 'no save bar on documents');
  await p.click('#tab-details');
  await p.uncheck('#role-volunteer', { force: true });
  await p.click('#tab-about');
  check(!(await p.isVisible('#affiliations-section')) && await p.isVisible('#affiliations-note'), 'not a volunteer: affiliation note');
  await p.click('#tab-details');
  await p.check('#role-volunteer', { force: true });
  await p.click('#tab-about');
  check(await p.isVisible('#affiliations-section') && !(await p.isVisible('#affiliations-note')), 'volunteer: affiliations shown');
  await p.click('#add-affiliation');
  await p.fill('#affiliation-rows input[data-key=name]', 'Troop 42');
  await p.fill('#aboutMe', 'Hello there');

  // Saving with errors from the about tab jumps to My details
  await p.click('#save');
  check(await p.$eval('#tab-details', t => t.getAttribute('aria-selected')) === 'true', 'error jumps to My details');
  check(await p.$eval('#tab-details', t => t.classList.contains('has-error')), 'error dot on My details');
  check(await p.evaluate(() => document.activeElement.id) === 'firstName', 'focus first invalid');

  // File upload
  await p.setInputFiles('.photo-file', { name: 'me.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEIYAwAPUQD/RUoE0QAAAAASUVORK5CYII=', 'base64') });
  await p.waitForSelector('.photo-img:not([hidden])');
  check((await p.textContent('.photo-status')).includes('Photo added'), 'upload status');
  check(await p.isVisible('.photo-remove') && (await p.textContent('.photo-camera')) === 'Retake photo', 'remove + retake');
  // Not an image
  await p.setInputFiles('.photo-file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  check((await p.textContent('.photo-error')).includes("isn't an image"), 'non-image error');
  // Broken image
  await p.setInputFiles('.photo-file', { name: 'bad.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('nope') });
  await p.waitForFunction(() => document.querySelector('.photo-error').textContent.includes("couldn't read"));
  n++;
  // Remove
  await p.click('.photo-remove');
  check(await p.isHidden('.photo-img') && await p.isVisible('.photo-placeholder'), 'removed');

  // Drag and drop
  await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    const g = c.getContext('2d'); g.fillStyle = '#c0392b'; g.fillRect(0, 0, 300, 200);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'dropped.png', { type: 'image/png' }));
    const zone = document.getElementById('photo-field');
    zone.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    window.__dragClass = zone.classList.contains('is-dragover');
    zone.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  check(await p.evaluate(() => window.__dragClass), 'dragover highlight');
  await p.waitForSelector('.photo-img:not([hidden])');
  check(!(await p.$eval('#photo-field', z => z.classList.contains('is-dragover'))), 'highlight cleared');
  const dims = await p.$eval('.photo-img', i => [i.naturalWidth, i.naturalHeight]);
  check(dims[0] === 400 && dims[1] === 400, 'cropped to 400x400 ' + dims);
  // Dropping a file elsewhere doesn't navigate
  const prevented = await p.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.png', { type: 'image/png' })); const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }); document.querySelector('.page-title').dispatchEvent(ev); return ev.defaultPrevented; });
  check(prevented, 'drop elsewhere prevented');

  // Camera
  await p.click('.photo-camera');
  check(await p.isVisible('.camera-dialog'), 'camera dialog open');
  await p.waitForSelector('.camera-shoot:not([disabled])', { timeout: 10000 });
  await p.screenshot({ path: SP + '/photo-camera.png' });
  await p.click('.camera-shoot');
  check(!(await p.isVisible('.camera-dialog')), 'dialog closed');
  check((await p.textContent('.photo-status')).includes('Photo taken'), 'taken status');
  check(await p.evaluate(() => !document.querySelector('.camera-video').srcObject), 'camera stopped');
  // Cancel
  await p.click('.photo-camera'); await p.waitForSelector('.camera-shoot:not([disabled])');
  await p.click('.camera-cancel');
  check(await p.evaluate(() => !document.querySelector('.camera-video').srcObject), 'cancel stops camera');
  // Escape
  await p.click('.photo-camera'); await p.waitForSelector('.camera-shoot:not([disabled])');
  await p.keyboard.press('Escape');
  check(!(await p.isVisible('.camera-dialog')) && await p.evaluate(() => !document.querySelector('.camera-video').srcObject), 'escape closes + stops');

  // Save and reload
  await p.click('#tab-details');
  await p.fill('#firstName', 'Bala'); await p.fill('#lastName', 'A'); await p.fill('#email', 'b@example.com'); await p.fill('#phone', '5125550100');
  await p.check('input[name=availability][value=anytime]', { force: true });
  await p.click('#tab-about');
  await p.click('#save');
  await p.waitForURL(u => !/profile\.html/.test(String(u)));
  check((await p.textContent('#saved-flash')).includes('Your profile is saved'), 'saved from about tab, and left the form');
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('sevak.profile.v1')));
  check(saved.photo.startsWith('data:image/jpeg') && saved.photo.length < 150000, 'photo stored, ' + saved.photo.length + ' chars');
  check(saved.affiliations[0].name === 'Troop 42' && saved.aboutMe === 'Hello there', 'about tab saved');
  await p.goto(URL_ + '#about');
  check(!(await p.$eval('.photo-img', i => i.hidden)) && (await p.getAttribute('.photo-img', 'src')).startsWith('data:image/jpeg'), 'photo after reload');
  check(await p.isVisible('#about-me-section'), 'reload keeps #about tab');
  await p.click('#tab-details');
  await p.screenshot({ path: SP + '/photo-details-desktop.png' });

  // Delete clears
  await p.click('#delete-profile');
  check(await p.isHidden('.photo-img'), 'delete clears photo');

  // Camera blocked
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })); });
  await p2.goto(URL_);
  await p2.click('.photo-camera');
  await p2.waitForSelector('.camera-file:not([hidden])');
  check((await p2.textContent('.camera-message')).includes('blocked'), 'blocked message');
  const [fc] = await Promise.all([p2.waitForEvent('filechooser'), p2.click('.camera-file')]);
  check(!!fc && !(await p2.isVisible('.camera-dialog')), 'choose file instead');
  // No live camera support: falls back to capture input
  const p3 = await ctx.newPage();
  await p3.addInitScript(() => { Object.defineProperty(navigator, 'mediaDevices', { value: undefined }); });
  await p3.goto(URL_);
  const [fc3] = await Promise.all([p3.waitForEvent('filechooser'), p3.click('.photo-camera')]);
  check(fc3 && (await fc3.element().getAttribute('capture')) === 'user', 'fallback uses capture input');

  // Phone
  const m = await (await b.newContext({ viewport: { width: 360, height: 800 }, colorScheme: 'dark', permissions: ['camera'] })).newPage();
  m.on('pageerror', e => errs.push('m ' + e.message));
  await m.goto(URL_);
  check(!(await m.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'phone fits');
  check(await m.$$eval('#profile-tabs .tab', ts => ts.every(t => t.scrollWidth <= t.clientWidth + 1)), 'phone tabs not clipped');
  await m.screenshot({ path: SP + '/photo-phone.png' });
  await m.click('.photo-camera'); await m.waitForSelector('.camera-shoot:not([disabled])');
  await m.screenshot({ path: SP + '/photo-phone-camera.png' });

  console.log(n + ' ok'); console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'ALL PASS'); await b.close();
})();
