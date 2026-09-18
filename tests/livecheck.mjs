import puppeteer from 'puppeteer-core';
const BASE = process.argv[2] || 'https://imunco.github.io/sense-of-immersion';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
const page = await browser.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => problems.push('reqfail: ' + r.url().slice(0, 90) + ' :: ' + ((r.failure() || {}).errorText)));

await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 90000 });
await page.evaluate(() => document.fonts.ready).catch(() => {});
await page.waitForFunction(() => !!window.__yixian, { timeout: 40000 }).catch(() => {});
await wait(800);
console.log('前台:', JSON.stringify(await page.evaluate(() => ({
  cjk: document.documentElement.dataset.cjk,
  heroCount: document.querySelector('#hero-count').textContent,
  wishes: window.__yixian.all.length,
  webEmptyShown: !document.querySelector('#web-empty').hidden
}))));
await page.evaluate(() => { location.hash = '#/web'; });
await wait(2000);
console.log('蛛网:', JSON.stringify(await page.evaluate(() => ({
  beads: window.__yixian.web.beads.length,
  emptyShown: !document.querySelector('#web-empty').hidden,
  count: document.querySelector('#web-count').textContent
}))));

await page.goto(BASE + '/admin.html', { waitUntil: 'networkidle2' });
await wait(1200);
await page.type('#gate-pass', 'yixian-2026', { delay: 25 });
await page.click('#gate-form button[type=submit]');
await page.waitForFunction(() => !document.querySelector('#room').hidden, { timeout: 60000 });
await page.waitForFunction(() => !/正在解密/.test(document.querySelector('#proj-status').textContent), { timeout: 60000 });
await wait(800);
console.log('后台:', JSON.stringify(await page.evaluate(() => ({
  roomVisible: !document.querySelector('#room').hidden,
  rows: document.querySelectorAll('.ledger-table tbody tr').length,
  sentence: document.querySelector('#ledger-sentence').textContent,
  line: document.querySelector('#ledger-line').textContent
}))));
console.log('--- problems (' + problems.length + ') ---');
console.log(problems.slice(0, 12).join('\n'));
await browser.close();
