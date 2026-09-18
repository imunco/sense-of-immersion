import puppeteer from 'puppeteer-core';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = process.argv[2] || 'https://imunco.github.io/sense-of-immersion';
const PASS = process.env.WISH_ADMIN_PASSPHRASE;
const b = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox','--disable-gpu','--hide-scrollbars'] });
const p = await b.newPage();
const problems = [];
p.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
p.on('requestfailed', (r) => problems.push('reqfail: ' + r.url().slice(0, 80)));

await p.setViewport({ width: 1440, height: 900 });
await p.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 90000 });
await p.waitForFunction(() => !!window.__yixian, { timeout: 40000 }).catch(() => {});
await wait(1200);
console.log('前台:', JSON.stringify(await p.evaluate(() => ({
  booted: !!window.__yixian,
  heroCount: document.querySelector('#hero-count').textContent,
  visOptions: Array.from(document.querySelectorAll('.vis-pick')).map((b) => b.dataset.vis).join(','),
  wishes: window.__yixian ? window.__yixian.all.length : -1
}))));
await p.evaluate(() => { location.hash = '#/web'; });
await wait(1800);
console.log('蛛网:', JSON.stringify(await p.evaluate(() => ({
  beads: window.__yixian.web.beads.length, empty: !document.querySelector('#web-empty').hidden
}))));
await p.goto(BASE + '/admin.html', { waitUntil: 'networkidle2' });
await wait(900);
await p.type('#gate-pass', PASS, { delay: 8 });
await p.click('#gate-form button[type=submit]');
await p.waitForFunction(() => !document.querySelector('#room').hidden, { timeout: 60000 });
await p.waitForFunction(() => !/正在解密/.test(document.querySelector('#proj-status').textContent), { timeout: 60000 });
await wait(700);
console.log('后台:', JSON.stringify(await p.evaluate(() => ({
  status: document.querySelector('#proj-status').textContent,
  rows: document.querySelectorAll('.ledger-table tbody tr').length,
  line: document.querySelector('#ledger-line').textContent,
  hasPrivateChip: !!document.querySelector('.chip[data-range="private"]')
}))));
console.log('--- problems (' + problems.length + ') ---');
console.log(problems.slice(0, 8).join('\n'));
await b.close();
