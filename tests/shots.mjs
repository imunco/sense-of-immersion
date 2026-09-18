import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'tests/shots');
const BASE = 'http://127.0.0.1:4173';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1'] });
const page = await browser.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
const shot = async (name, opts) => { await page.screenshot(Object.assign({ path: resolve(OUT, name + '.png') }, opts || {})); console.log('shot ' + name); };

await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
await page.evaluate(() => document.fonts.ready).catch(() => {});
await wait(3000);
await shot('01-hero');

await page.evaluate(() => { location.hash = '#/cast'; });
await wait(500);
await page.type('#name-input', '林深', { delay: 70 });
await wait(500);
await shot('03-cast');

await page.click('#to-wish');
await wait(900);
await page.type('#wish-input', '愿所有认真写下的话，都有人读到。', { delay: 40 });
await wait(600);
await shot('04-wish');

await page.click('#thread-picks .thread-pick[data-id="abyss"]');
await wait(500);
await shot('05-wish-abyss');

await page.click('#submit-wish');
await wait(2600);
await shot('06-reveal');

await page.evaluate(() => { location.hash = '#/web'; });
await wait(2000);
await shot('07-web');

const bead = await page.evaluate(() => {
  const s = window.__yixian;
  if (!s || !s.web || !s.web.beads.length) return null;
  const b = s.web.beads[Math.floor(s.web.beads.length / 2)];
  const p = s.web.node(b.spoke, b.ring, b.jr, b.ja);
  const r = document.querySelector('#web-canvas').getBoundingClientRect();
  return { x: r.left + p.x, y: r.top + p.y };
});
if (bead) {
  await page.mouse.move(bead.x, bead.y);
  await wait(500);
  await page.mouse.move(bead.x + 2, bead.y + 1);
  await wait(900);
  await shot('08-web-hover');
} else { console.log('!! no beads to hover'); }

// 分享链接
const token = await page.evaluate(async () => {
  const m = await import('./assets/js/store.js');
  return m.encodeShare({ name: '阿岚', wish: '愿妈妈的检查结果一切都好。', mood: 'dusk', ts: Date.now() });
});
await page.goto(BASE + '/#/w/' + token, { waitUntil: 'networkidle2' });
await wait(2200);
await shot('09-share-screening');

// 手机
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
await wait(2200);
await shot('10-mobile-hero');
await page.evaluate(() => { location.hash = '#/web'; });
await wait(1800);
await shot('11-mobile-web');
await page.evaluate(() => { location.hash = '#/cast'; });
await wait(600);
await page.type('#name-input', '林深', { delay: 20 });
await page.click('#to-wish');
await wait(600);
await page.type('#wish-input', '愿所有认真写下的话，都有人读到。', { delay: 15 });
await wait(500);
await page.click('#submit-wish');
await wait(2400);
await shot('12-mobile-reveal');

// 后台
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
await page.goto(BASE + '/admin.html', { waitUntil: 'networkidle2' });
await wait(1200);
await page.type('#gate-pass', (process.env.WISH_ADMIN_PASSPHRASE || ''), { delay: 30 });
await page.click('#gate-form button[type=submit]');
await wait(3000);
await shot('13-admin-room');
await shot('13b-admin-head', { clip: { x: 0, y: 0, width: 1440, height: 200 } });
await page.evaluate(() => { const r = document.querySelector('.ledger-table tbody tr'); if (r) r.click(); });
await wait(1600);
await shot('14-admin-drawer');

console.log('--- problems (' + problems.length + ') ---');
console.log(problems.slice(0, 20).join('\n'));
await browser.close();
