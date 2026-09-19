import puppeteer from 'puppeteer-core';
/* 默认打线上（Vercel）。GitHub Pages 已停用，别再默认打到那儿去。
   也可以传一个参数指到别的实例：node tests/livecheck.mjs http://127.0.0.1:4173 */
const BASE = process.argv[2] || 'https://yixian-archive.vercel.app';
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
/* 说明：线上前台**没有**调用 loadFonts()（只有放映室会调），所以这里
   document.documentElement.dataset.cjk 是空的、中文走系统宋体栈 —— 这是现状，
   不是这次回归要管的事，先如实打出来。 */
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

/* 放映室：线上已经装了通行密钥，所以口令之后**应该**停在第二因素上。
   这里不替用户按指纹（自动化点不了 Windows Hello），只确认那道门真的在挡。 */
await page.goto(BASE + '/admin.html', { waitUntil: 'networkidle2' });
await wait(1200);
await page.type('#gate-pass', (process.env.WISH_ADMIN_PASSPHRASE || ''), { delay: 25 });
await page.click('#gate-form button[type=submit]');
await wait(5000);
const gate = await page.evaluate(() => ({
  room: !document.querySelector('#room').hidden,
  second: !document.querySelector('#gate-2fa').hidden,
  err: (document.querySelector('#gate-err') || {}).textContent || ''
}));
if (!process.env.WISH_ADMIN_PASSPHRASE) {
  console.log('后台: · 没有给口令，跳过（设 WISH_ADMIN_PASSPHRASE 再跑）');
} else if (gate.second && !gate.room) {
  console.log('后台: ✓ 口令对了但停在第二因素 —— 线上装了通行密钥，这是应该的样子');
} else if (gate.room) {
  console.log('后台: · 没有第二因素就进了放映室（线上还没装通行密钥？）');
  const room = await page.evaluate(() => ({
    rows: document.querySelectorAll('.ledger-table tbody tr').length,
    sentence: document.querySelector('#ledger-sentence').textContent,
    line: document.querySelector('#ledger-line').textContent
  }));
  console.log('  ' + JSON.stringify(room));
} else {
  console.log('后台: ✗ 口令之后既没进房间、也没走到第二因素：' + gate.err);
  problems.push('gate: ' + gate.err);
}
console.log('--- problems (' + problems.length + ') ---');
console.log(problems.slice(0, 12).join('\n'));
await browser.close();
if (problems.length) process.exitCode = 1;
