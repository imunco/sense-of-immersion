import puppeteer from 'puppeteer-core';
import { readFile } from 'node:fs/promises';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cfg = JSON.parse(await readFile('data/config.json', 'utf8'));
const BASE = 'http://127.0.0.1:4173';
const CH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function relayFind(id) {
  const t = await (await fetch('https://ntfy.sh/' + cfg.topic + '/json?poll=1&since=all')).text();
  for (const line of t.split('\n')) {
    if (!line.trim()) continue;
    try { const ev = JSON.parse(line); if (ev.event !== 'message') continue; const w = JSON.parse(ev.message); if (w.id === id) return { w, raw: line }; } catch {}
  }
  return null;
}

const b = await puppeteer.launch({ executablePath: CH, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const p = await b.newPage();
const problems = [];
p.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
await p.setViewport({ width: 1280, height: 900 });
await p.goto(BASE + '/', { waitUntil: 'networkidle2' });
await wait(2000);

console.log('1) 蜜罐字段存在:', await p.evaluate(() => !!document.querySelector('#hp')));

// —— 客户端违禁词拦截
await p.evaluate(() => { location.hash = '#/cast'; });
await wait(400);
await p.type('#name-input', '推广号', { delay: 20 });
await p.click('#to-wish');
await wait(500);
await p.type('#wish-input', '加微信 买茶叶 全网最低价', { delay: 15 });
await wait(300);
await p.click('#submit-wish');
await wait(1200);
console.log('2) 违禁词被本地拦下:', JSON.stringify(await p.evaluate(() => ({
  err: document.querySelector('#wish-error').textContent,
  stillOnWish: document.querySelector('.act--wish').classList.contains('is-current')
}))));

// —— 蜜罐被填 → 静默丢弃
await p.evaluate(() => { document.querySelector('#hp').value = 'bot'; });
await p.click('#submit-wish');
await wait(1200);
console.log('3) 蜜罐填了之后:', JSON.stringify(await p.evaluate(() => ({
  err: document.querySelector('#wish-error').textContent,
  stillOnWish: document.querySelector('.act--wish').classList.contains('is-current')
}))));
await p.evaluate(() => { document.querySelector('#hp').value = ''; });

// —— 正常提交，量一下工作量证明的耗时
await p.evaluate(() => { document.querySelector('#wish-input').value = ''; document.querySelector('#name-input').value = ''; });
await p.evaluate(() => { location.hash = '#/cast'; });
await wait(400);
await p.focus('#name-input');
await p.type('#name-input', '夜航', { delay: 10 });
await p.click('#to-wish');
await wait(600);
await p.focus('#wish-input');
await p.type('#wish-input', '愿浏览器与服务器之间这段路，一直是干净的。', { delay: 10 });
await wait(2600); // 过掉「填得太快」的判定
const t0 = Date.now();
await p.click('#submit-wish');
await p.waitForFunction(() => location.hash === '#/reveal', { timeout: 60000 });
const pubMs = Date.now() - t0;
await wait(2500);
const lastId = await p.evaluate(() => window.__yixian.last.id);
console.log('4) 提交完成，客户端总耗时 ' + pubMs + 'ms，id=' + lastId);

const found = await relayFind(lastId);
console.log('5) 中转站上的载荷字段:', found ? Object.keys(found.w).join(',') : '（没找到）');
if (found) {
  console.log('   含明文时区/设备吗:', ('tz' in found.w) || ('ua' in found.w) ? '是 ❌' : '否 ✓');
  console.log('   有工作量证明:', found.w.pow ? '✓ ' + found.w.pow : '✗');
  console.log('   信封大小:', JSON.stringify(found.w.env || {}).length + ' 字节（密文）');
}

// —— 后台：PBKDF2 解密
await p.goto(BASE + '/admin.html', { waitUntil: 'networkidle2' });
await wait(800);
const t1 = Date.now();
await p.type('#gate-pass', (process.env.WISH_ADMIN_PASSPHRASE || ''), { delay: 15 });
await p.click('#gate-form button[type=submit]');
await p.waitForFunction(() => !document.querySelector('#room').hidden, { timeout: 60000 });
const unlockMs = Date.now() - t1;
await p.waitForFunction(() => !/正在解密/.test(document.querySelector('#proj-status').textContent), { timeout: 60000 });
await wait(600);
const admin = await p.evaluate(() => ({
  unlockMs: 0,
  status: document.querySelector('#proj-status').textContent,
  rows: document.querySelectorAll('.ledger-table tbody tr').length,
  queue: document.querySelector('#queue-count').textContent,
  queueVisible: !document.querySelector('#queue-panel').hidden,
  firstTz: (document.querySelector('.ledger-table tbody tr td:nth-child(5)') || {}).textContent
}));
console.log('6) 后台解锁耗时 ' + unlockMs + 'ms，', JSON.stringify(admin));

// —— 错误口令必须被拒
await p.evaluate(() => { sessionStorage.clear(); });
await p.goto(BASE + '/admin.html', { waitUntil: 'networkidle2' });
await wait(600);
await p.type('#gate-pass', 'wrong-password-123', { delay: 10 });
await p.click('#gate-form button[type=submit]');
await wait(3000);
console.log('7) 错误口令:', JSON.stringify(await p.evaluate(() => ({
  err: document.querySelector('#gate-err').textContent,
  roomHidden: document.querySelector('#room').hidden
}))));

console.log('--- problems (' + problems.length + ') ---');
console.log(problems.slice(0, 10).join('\n'));
await b.close();
