import puppeteer from 'puppeteer-core';
import { readFile } from 'node:fs/promises';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cfg = JSON.parse(await readFile('data/config.json', 'utf8'));
const PASS = process.env.WISH_ADMIN_PASSPHRASE;
const CH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const B = 'http://127.0.0.1:4173';

async function relayFind(id) {
  const t = await (await fetch('https://ntfy.sh/' + cfg.topic + '/json?poll=1&since=all')).text();
  for (const line of t.split('\n')) {
    if (!line.trim()) continue;
    try { const ev = JSON.parse(line); if (ev.event !== 'message') continue; const w = JSON.parse(ev.message); if (w.id === id) return w; } catch {}
  }
  return null;
}

const b = await puppeteer.launch({ executablePath: CH, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const p = await b.newPage();
const problems = [];
p.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
await p.setViewport({ width: 1280, height: 1000 });
await p.goto(B + '/', { waitUntil: 'networkidle2' });
await wait(2000);

await p.evaluate(() => { location.hash = '#/cast'; });
await wait(400);
await p.type('#name-input', '夜航', { delay: 15 });
await p.click('#to-wish');
await wait(600);
await p.type('#wish-input', '这条只有我自己和放映室能看到。', { delay: 10 });
await wait(2600);

console.log('1) 可见性选项:', await p.evaluate(() => Array.from(document.querySelectorAll('.vis-pick')).map((b) => b.dataset.vis).join(',')));
await p.click('.vis-pick[data-vis="private"]');
await wait(400);
console.log('2) 切到私密后提示语:', await p.evaluate(() => document.querySelector('#privacy-note').textContent.slice(0, 46) + '…'));
await p.screenshot({ path: 'tests/shots/P1-private-form.png' });

await p.click('#submit-wish');
await p.waitForFunction(() => location.hash === '#/reveal', { timeout: 60000 });
await wait(2000);
const id = await p.evaluate(() => window.__yixian.last.id);
console.log('3) 提交完成 id=' + id);
console.log('4) 揭幕页:', JSON.stringify(await p.evaluate(() => ({
  title: document.querySelector('#reveal-title').textContent,
  noteShown: !document.querySelector('#reveal-note').hidden,
  copyHidden: document.querySelector('#copy-link').hidden,
  credits: document.querySelector('#reveal-credits').textContent
}))));
await p.screenshot({ path: 'tests/shots/P2-private-reveal.png' });

const msg = await relayFind(id);
console.log('5) 中转站载荷字段:', msg ? Object.keys(msg).join(',') : '未找到');
console.log('   泄露正文了吗:', msg && ('name' in msg || 'wish' in msg) ? '是 ❌' : '否 ✓');

// 后台
await p.goto(B + '/admin.html', { waitUntil: 'networkidle2' });
await wait(800);
await p.type('#gate-pass', PASS, { delay: 10 });
await p.click('#gate-form button[type=submit]');
await p.waitForFunction(() => !document.querySelector('#room').hidden, { timeout: 60000 });
await p.waitForFunction(() => !/正在解密/.test(document.querySelector('#proj-status').textContent), { timeout: 60000 });
await wait(800);
await p.click('.chip[data-range="private"]');
await wait(600);
console.log('6) 后台「仅自己可见」:', JSON.stringify(await p.evaluate(() => ({
  status: document.querySelector('#proj-status').textContent,
  rows: document.querySelectorAll('.ledger-table tbody tr').length,
  firstTags: Array.from(document.querySelectorAll('.ledger-table tbody tr:first-child .tag-live')).map((t) => t.textContent).join('/')
}))));
await p.screenshot({ path: 'tests/shots/P3-admin-private.png' });

console.log('--- problems (' + problems.length + ') ---');
console.log(problems.slice(0, 8).join('\n'));
await b.close();
