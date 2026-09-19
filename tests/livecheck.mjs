import puppeteer from 'puppeteer-core';
/* 默认打线上（Vercel）。GitHub Pages 已停用，别再默认打到那儿去。
   也可以传一个参数指到别的实例：node tests/livecheck.mjs http://127.0.0.1:4173 */
const BASE = process.argv[2] || 'https://uncodeapps.icu';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
const page = await browser.newPage();
const problems = [];
/* 中文字体按设计要试三个第三方 CDN，不通就退到系统宋体栈 —— 在中国大陆
   fonts.googleapis.com 基本是不通的，那是**预期**，不是页面缺陷。
   注意：CSP 挡下字体时候的控制台报错，location 是 assets/js/fonts.js，
   不是字体主机，所以不会被这个过滤器放过（那道错必须能报出来）。 */
const networkDown = (t) => t.indexOf('ERR_CONNECTION_CLOSED') >= 0 || t.indexOf('ERR_ABORTED') >= 0 || t.indexOf('ERR_NAME_NOT_RESOLVED') >= 0 || t.indexOf('ERR_CONNECTION_RESET') >= 0;
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  const where = (m.location && m.location().url) || '';
  if (/fonts\.(googleapis|loli|geekzu)|gstatic\./.test(where)) return;
  if (networkDown(text)) return;
  problems.push('console: ' + text + ' @ ' + where);
});
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => {
  const t = (r.failure() || {}).errorText || '';
  if (networkDown(t)) return;
  problems.push('reqfail: ' + r.url().slice(0, 90) + ' :: ' + t);
});

/* 站点在外面，但**本机出网**会偶发 ERR_CONNECTION_CLOSED（代理/沙箱抖动），跟站点无关。
   一次不通就重试，三次都不通才算问题 —— 否则这个冒烟会假红，久了就没人信它了。 */
const goto = async (url) => {
  for (let i = 1; i <= 3; i++) {
    try { return await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 }); }
    catch (e) {
      const msg = String((e && e.message) || e);
      if (!networkDown(msg)) throw e;
      if (i === 3) { problems.push('goto: ' + url + ' :: ' + msg.split(' at ')[0]); return null; }
      console.log('  · 第 ' + i + ' 次打开 ' + url + ' 没通，重试');
      await wait(2500);
    }
  }
};

await page.setViewport({ width: 1440, height: 900 });
await goto(BASE + '/');
await page.evaluate(() => document.fonts.ready).catch(() => {});
await page.waitForFunction(() => !!window.__yixian, { timeout: 40000 }).catch(() => {});
/* loadFonts() 是异步的：注入 CSS → 等它回来 → 试用字体，最快也要一两秒才写 dataset.cjk；
   三个 CDN 都不通时最坏二十几秒才写 'fallback'。所以先等它落定，再判断「是不是压根没调用」。 */
await page.waitForFunction(() => !!document.documentElement.dataset.cjk, { timeout: 30000 }).catch(() => {});
console.log('前台:', JSON.stringify(await page.evaluate(() => ({
  cjk: document.documentElement.dataset.cjk,
  heroCount: document.querySelector('#hero-count').textContent,
  wishes: window.__yixian.all.length,
  webEmptyShown: !document.querySelector('#web-empty').hidden
}))));
/* 中文那套 webfont 接线断了要能发现（之前 app.js 只 import 没调用，前台一直用的是系统宋体）。
   但**不**要求它必须 'loaded' —— 三个 CDN 都在墙外，连不上是设计接受的降级（'fallback'）。
   真正要抓的是「压根没调用」这一种：那时 dataset.cjk 是空的。 */
const cjk = await page.evaluate(() => document.documentElement.dataset.cjk || '');
if (!cjk) {
  console.log('  ✗ 前台没有调用 loadFonts()：dataset.cjk 是空的，中文只会走系统宋体栈');
  problems.push('cjk: 前台未调用 loadFonts()');
} else if (cjk === 'fallback') {
  console.log('  · 中文 webfont 没装上（三个 CDN 都不通），已退到系统宋体栈 —— 设计接受');
}
await page.evaluate(() => { location.hash = '#/web'; });
await wait(2000);
console.log('蛛网:', JSON.stringify(await page.evaluate(() => ({
  beads: window.__yixian.web.beads.length,
  emptyShown: !document.querySelector('#web-empty').hidden,
  count: document.querySelector('#web-count').textContent
}))));

/* 放映室：线上已经装了通行密钥，所以口令之后**应该**停在第二因素上。
   这里不替用户按指纹（自动化点不了 Windows Hello），只确认那道门真的在挡。 */
await goto(BASE + '/admin.html');
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
