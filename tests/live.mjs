import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'tests/shots');
const BASE = process.argv[2] || 'https://imunco.github.io/sense-of-immersion';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
const page = await browser.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => problems.push('reqfail: ' + r.url().slice(0, 100) + ' :: ' + ((r.failure() || {}).errorText)));

await page.setViewport({ width: 1440, height: 900 });
console.log('→ ' + BASE + '/');
await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 90000 });
await page.evaluate(() => document.fonts.ready).catch(() => {});
await wait(3500);

const boot = await page.evaluate(() => ({
  cjk: document.documentElement.dataset.cjk,
  heroCount: document.querySelector('#hero-count').textContent,
  topic: window.__yixian ? 'state-exposed' : 'no-state',
  fontOfHero: getComputedStyle(document.querySelector('.hero__title')).fontFamily,
  heroSize: getComputedStyle(document.querySelector('.hero__title')).fontSize,
  wishes: window.__yixian ? window.__yixian.all.length : -1
}));
console.log('boot:', JSON.stringify(boot));
await page.screenshot({ path: resolve(OUT, 'L1-live-hero.png') });

// 走一遍真实流程
await page.evaluate(() => { location.hash = '#/cast'; });
await wait(500);
await page.type('#name-input', '夜航', { delay: 50 });
await page.click('#to-wish');
await wait(700);
await page.type('#wish-input', '愿看到这里的每个人，今晚都睡个好觉。', { delay: 30 });
await wait(600);
await page.screenshot({ path: resolve(OUT, 'L2-live-wish.png') });
await page.click('#submit-wish');
await wait(3000);
await page.screenshot({ path: resolve(OUT, 'L3-live-reveal.png') });

const published = await page.evaluate(() => {
  const s = window.__yixian;
  return { all: s.all.length, last: s.last && { id: s.last.id, name: s.last.name, wish: s.last.wish, dv: s.last.dv, tz: s.last.tz } };
});
console.log('published:', JSON.stringify(published));

await page.evaluate(() => { location.hash = '#/web'; });
await wait(2200);
await page.screenshot({ path: resolve(OUT, 'L4-live-web.png') });
console.log('web beads:', await page.evaluate(() => window.__yixian.web.beads.length));

// 线上后台
await page.goto(BASE + '/admin.html', { waitUntil: 'networkidle2' });
await wait(1200);
await page.type('#gate-pass', 'yixian-2026', { delay: 30 });
await page.click('#gate-form button[type=submit]');
await wait(3500);
const admin = await page.evaluate(() => ({
  roomVisible: !document.querySelector('#room').hidden,
  rows: document.querySelectorAll('.ledger-table tbody tr').length,
  sentence: document.querySelector('#ledger-sentence').textContent
}));
console.log('admin:', JSON.stringify(admin));
await page.screenshot({ path: resolve(OUT, 'L5-live-admin.png') });

console.log('--- problems (' + problems.length + ') ---');
console.log(problems.slice(0, 15).join('\n'));
await browser.close();
