import puppeteer from 'puppeteer-core';
import { readFile } from 'node:fs/promises';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cfg = JSON.parse(await readFile('data/config.json', 'utf8'));
const PASS = process.env.WISH_ADMIN_PASSPHRASE;
const BASE = 'https://imunco.github.io/sense-of-immersion';
const CH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const b = await puppeteer.launch({ executablePath: CH, headless: true, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
const p = await b.newPage();
const problems = [];
p.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
await p.setViewport({ width: 1280, height: 1000 });
await p.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 90000 });
await p.waitForFunction(() => !!window.__yixian, { timeout: 40000 }).catch(() => {});
await wait(1200);

await p.evaluate(() => { location.hash = '#/cast'; });
await wait(400);
await p.type('#name-input', '夜航', { delay: 15 });
await p.click('#to-wish');
await wait(600);
await p.type('#wish-input', '这条只有我自己和放映室能看到 —— 线上验证。', { delay: 8 });
await wait(2600);
await p.click('.vis-pick[data-vis="private"]');
await wait(300);
await p.click('#submit-wish');
await p.waitForFunction(() => location.hash === '#/reveal', { timeout: 90000 });
await wait(2200);
const id = await p.evaluate(() => window.__yixian.last.id);
console.log('线上私密提交 id=' + id);
console.log('揭幕页:', JSON.stringify(await p.evaluate(() => ({
  title: document.querySelector('#reveal-title').textContent,
  noteShown: !document.querySelector('#reveal-note').hidden,
  copyHidden: document.querySelector('#copy-link').hidden
}))));
await p.screenshot({ path: 'tests/shots/L-private-reveal.png' });

// 中转站上不能有明文
const raw = await (await fetch('https://ntfy.sh/' + cfg.topic + '/json?poll=1&since=all')).text();
let found = null;
for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  try { const ev = JSON.parse(line); if (ev.event !== 'message') continue; const w = JSON.parse(ev.message); if (w.id === id) found = w; } catch {}
}
console.log('中转站字段:', found ? Object.keys(found).join(',') : '未找到');
console.log('泄露正文:', found && ('name' in found || 'wish' in found) ? '是 ❌' : '否 ✓');

// 等采集器（线上每 5 分钟一次）
console.log('等待线上采集器…');
for (let i = 0; i < 20; i++) {
  await wait(20000);
  const vault = await (await fetch(BASE + '/data/private/vault.jsonl')).text();
  if (vault.indexOf(id) >= 0) { console.log('已进入保险库（密文），等待轮次 ' + i); break; }
  if (i === 19) console.log('⚠ 20 轮内未见入库');
}
const arch = await (await fetch(BASE + '/data/wishes.jsonl')).text();
console.log('公开归档里含有这条吗:', arch.indexOf(id) >= 0 ? '有 ❌' : '没有 ✓');

// 线上后台
await p.goto(BASE + '/admin.html', { waitUntil: 'networkidle2' });
await wait(900);
await p.type('#gate-pass', PASS, { delay: 8 });
await p.click('#gate-form button[type=submit]');
await p.waitForFunction(() => !document.querySelector('#room').hidden, { timeout: 60000 });
await p.waitForFunction(() => !/正在解密/.test(document.querySelector('#proj-status').textContent), { timeout: 60000 });
await wait(700);
await p.click('.chip[data-range="private"]');
await wait(700);
console.log('线上后台「仅自己可见」:', JSON.stringify(await p.evaluate(() => ({
  status: document.querySelector('#proj-status').textContent,
  rows: document.querySelectorAll('.ledger-table tbody tr').length,
  wish: (document.querySelector('.ledger-table tbody tr .cell-wish') || {}).textContent
}))));
await p.screenshot({ path: 'tests/shots/L-private-admin.png' });

console.log('--- problems (' + problems.length + ') ---');
console.log(problems.slice(0, 8).join('\n'));
await b.close();
