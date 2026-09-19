import puppeteer from 'puppeteer-core';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* 丝的命数 · 编号 · 冷却 —— 浏览器侧回归（中转站被拦下来，不碰线上） */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'tests/shots');
const BASE = 'http://127.0.0.1:4173';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(OUT, { recursive: true });

const now = Date.now();
const DAY = 864e5;
const wishes = [
  { id: 'w_fresh00001', name: '新来的人', wish: '愿今夜的风轻一点。', mood: 'silk', ts: now - 3600e3 },
  { id: 'w_dew0000002', name: '等信的人', wish: '愿那封信早一点到。', mood: 'abyss', ts: now - 2 * DAY },
  { id: 'w_solid00003', name: '被读到的人', wish: '愿所有认真写下的话都有人读到。', mood: 'moon', ts: now - 9 * DAY },
  { id: 'w_loose00004', name: '独自的人', wish: '愿窗台上的那盆绿萝活下来。', mood: 'dusk', ts: now - 20 * DAY },
  { id: 'w_looseOther5', name: '陌生人', wish: '愿有人记得我曾经来过。', mood: 'silk', ts: now - 30 * DAY },
  { id: 'w_looseMine07', name: '我自己', wish: '愿那盆绿萝再撑一个冬天。', mood: 'abyss', ts: now - 40 * DAY },
  { id: 'w_mineFresh06', name: '我自己', wish: '愿今天顺利一点。', mood: 'silk', ts: now - 3600e3 },
  { id: 'w_echo000008', name: '远行的人', wish: '愿妈妈身体健康，一切顺利。', mood: 'moon', ts: now - 4 * DAY },
  { id: 'w_echo000009', name: '熬夜的人', wish: '愿考试顺利，妈妈别再担心。', mood: 'silk', ts: now - 3 * DAY },
  { id: 'w_echo000010', name: '在外的人', wish: '愿家人身体健康。', mood: 'dusk', ts: now - 5 * DAY },
  { id: 'w_echo000011', name: '养猫的人', wish: '愿那只猫平安回家。', mood: 'abyss', ts: now - 6 * DAY },
  { id: 'w_echo000012', name: '等消息的人', wish: '愿工作顺利，早点回家。', mood: 'moon', ts: now - 8 * DAY },
  { id: 'w_twoReads000', name: '被停过两次的人', wish: '愿那把伞找得回来。', mood: 'dusk', ts: now - 12 * DAY },
  { id: 'w_twoReads002', name: '又被停过两次的人', wish: '愿那盏灯别灭。', mood: 'silk', ts: now - 13 * DAY }
];
const MINE_IDS = ['w_loose00004', 'w_looseMine07', 'w_mineFresh06'];
const reads = { reads: { w_solid00003: 4, w_twoReads000: 2, w_twoReads002: 2 }, mends: {}, updated: new Date().toISOString() };
const ndjson = wishes.map((w, i) => JSON.stringify({ id: 'm' + i, event: 'message', time: Math.floor(now / 1000) + i, message: JSON.stringify(w) })).join('\n') + '\n';

let fails = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); return; }
  fails++;
  console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1'] });
const page = await browser.newPage();
const problems = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const where = (m.location && m.location().url) || '';
  /* 中文字体按设计要从 CDN 试三个源，不通是预料之中的事 */
  if (/fonts\.(googleapis|loli|geekzu)/.test(where)) return;
  const text = m.text();
  if (text.indexOf('ERR_CONNECTION_CLOSED') >= 0 || text.indexOf('ERR_ABORTED') >= 0) return;
  problems.push('console: ' + text + ' @ ' + where);
});
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => {
  const t = r.failure() ? r.failure().errorText : '';
  /* 本地静态服务器在 reload 时会关掉 keep-alive，这不是页面缺陷 */
  if (t === 'net::ERR_ABORTED' || t === 'net::ERR_CONNECTION_CLOSED') return;
  problems.push('reqfail: ' + r.url() + ' · ' + t);
});
const shot = async (n) => { await page.screenshot({ path: resolve(OUT, n + '.png') }); };
const published = [];

await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = req.url();
  if (url.indexOf('ntfy.sh') >= 0) {
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (req.method() === 'POST') {
      published.push(req.postData() || '');
      req.respond({ status: 200, contentType: 'application/json', headers: cors, body: '{"id":"x"}' });
      return;
    }
    req.respond({ status: 200, contentType: 'application/x-ndjson', headers: cors, body: ndjson }); return;
  }
  if (url.indexOf('/api/poke') >= 0) { req.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); return; }
  if (url.indexOf('/api/read') >= 0) { req.respond({ status: 200, contentType: 'application/json', body: '{"ok":true,"signed":false}' }); return; }
  if (url.indexOf('/data/reads.json') >= 0) { req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(reads) }); return; }
  if (url.indexOf('/data/wishes.jsonl') >= 0) { req.respond({ status: 200, contentType: 'application/x-ndjson', body: '' }); return; }
  if (url.indexOf('/data/blocked.json') >= 0) { req.respond({ status: 200, contentType: 'application/json', body: '[]' }); return; }
  /* 通行密钥那层单独由 tests/passkey-e2e.mjs 验（它带 Chrome 的虚拟认证器）。
     这里如果放着仓库里那把**真的**钥匙不管，放映室会停在第二因素上，
     下面整段远程删除的断言就全进不去了 —— 所以在这一层谎报「没装」，
     让这个回归专心管它自己的事。 */
  if (url.indexOf('/data/private/passkey.json') >= 0) { req.respond({ status: 200, contentType: 'application/json', body: '{"installed":false}' }); return; }
  req.continue();
});

await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate((mine) => { localStorage.setItem('yixian.mine.v1', JSON.stringify(mine)); }, wishes.filter((w) => MINE_IDS.indexOf(w.id) >= 0));
await page.reload({ waitUntil: 'networkidle2' });
await wait(2200);

console.log('浏览器回归（中转站已拦截）');

/* ---- 四态 ---- */
const states = await page.evaluate(async () => {
  const silk = await import('./assets/js/silk.js');
  const s = window.__yixian;
  const byId = {}, codes = {};
  s.all.forEach((w) => { byId[w.id] = silk.silkState(w, s.reads, s.mends); codes[w.id] = silk.wishCode(w.id); });
  s.mine.forEach((w) => { codes[w.id] = silk.wishCode(w.id); });
  /* 纯函数验次数要求，不依赖画布 */
  const old = (id) => ({ id: id, ts: Date.now() - 10 * 864e5 });
  const synth = {
    one: silk.silkState(old('a'), { a: 1 }, {}),
    two: silk.silkState(old('b'), { b: 2 }, {}),
    three: silk.silkState(old('c'), { c: 3 }, {}),
    mended: silk.silkState(old('d'), {}, { d: Date.now() }),
    mendedFresh: silk.silkState(old('g'), {}, { g: Date.now() - 2 * 864e5 }),
    mendedExpired: silk.silkState(old('h'), {}, { h: Date.now() - 8 * 864e5 }),
    mendedLine: silk.silkOf(old('i'), {}, { i: Date.now() }).line,
    looseSeenLine: silk.silkOf(old('j'), { j: 1 }, {}).line,
    unseenLine: silk.silkOf(old('k'), {}, {}).line
  };
  return { byId, codes, synth };
});
ok('四态：二十四小时内 → 新结', states.byId['w_fresh00001'] === 'fresh', states.byId['w_fresh00001']);
ok('四态：一到七天 → 凝露', states.byId['w_dew0000002'] === 'dew', states.byId['w_dew0000002']);
ok('四态：七天以上且被读过 ≥3 → 结实', states.byId['w_solid00003'] === 'solid', states.byId['w_solid00003']);
ok('四态：七天以上无人读 → 丝散', states.byId['w_loose00004'] === 'loose', states.byId['w_loose00004']);
ok('编号是七位、可复制', /^[0-9A-HJKMNP-TV-Z]{7}$/.test(states.codes['w_solid00003']), states.codes['w_solid00003']);
const syn = states.synth;
ok('次数要求：只被停过一次还是散', syn.one === 'loose', syn.one);
ok('次数要求：停过两次还是散', syn.two === 'loose', syn.two);
ok('次数要求：读到第三次才结实', syn.three === 'solid', syn.three);
ok('刚续过丝：停在凝露', syn.mended === 'dew', syn.mended);
ok('续过两天：还在保质期里', syn.mendedFresh === 'dew', syn.mendedFresh);
ok('续过八天：又散了（只保七天）', syn.mendedExpired === 'loose', syn.mendedExpired);
ok('续过之后的凝露写另一句', /重新连上/.test(syn.mendedLine), syn.mendedLine);
ok('丝散：被停过的写另一句', /有人在这里停过/.test(syn.looseSeenLine), syn.looseSeenLine);
ok('丝散：没人停过的写原来那句', /还没有人接住/.test(syn.unseenLine), syn.unseenLine);

/* ---- 蛛网 ---- */
await page.evaluate(() => { location.hash = '#/web'; });
await wait(1600);
const beadStates = await page.evaluate(() => (window.__yixian.web ? window.__yixian.web.beads.map((b) => b.state) : []));
ok('画布上的露珠各自带上了命数', new Set(beadStates).size === 4, JSON.stringify(beadStates));
await shot('S1-web-states');

/* ---- 编号查询 ---- */
await page.type('#find-input', states.codes['w_solid00003'], { delay: 15 });
await page.click('#find-form button[type=submit]');
await wait(900);
const screenCode = await page.$eval('#screening .screening__code b', (el) => el.textContent).catch(() => null);
ok('输入编号 → 翻到那张海报', screenCode === states.codes['w_solid00003'], String(screenCode));
const screenWish = await page.$eval('#screening .poster__title', (el) => el.textContent).catch(() => null);
ok('翻到的正是那一条', screenWish === '愿所有认真写下的话都有人读到。', String(screenWish));
const screenSilk = await page.$eval('#screening .screening__silk', (el) => el.textContent).catch(() => null);
ok('海报上写着丝的命数', /结实/.test(screenSilk || ''), String(screenSilk));
await shot('S2-code-poster');
await page.click('#screening-close');
await wait(400);

/* ---- 不按词搜：只认编号 ---- */
await page.type('#find-input', '绿萝', { delay: 15 });
await page.click('#find-form button[type=submit]');
await wait(700);
const notCode = await page.$eval('#find-note', (el) => el.textContent);
ok('输入一个词：给出「只认编号」的说明', /只认编号/.test(notCode), notCode);
const hintHref = await page.$eval('.find-hint a', (el) => el.getAttribute('href'));
ok('不按词搜：把人指向「回响」', hintHref === '#/echoes', String(hintHref));
await shot('S3-find');
await page.click('#find-clear');
await wait(400);

/* ---- 查不到的编号：把「私密的查不到」说清楚 ---- */
await page.type('#find-input', 'ZZZZZZZ', { delay: 10 });
await page.click('#find-form button[type=submit]');
await wait(500);
const missNote = await page.$eval('#find-note', (el) => el.textContent);
ok('查不到时不撒谎：说明仅自己可见查不到', /仅自己可见/.test(missNote), missNote);
await page.click('#find-clear');
await wait(400);

/* ---- 续丝：自己写下的断丝，回来能接上 ---- */
/* 停够 1.5 秒自己也会把它读成凝露，所以按钮要马上看 —— 从站内跳过去，不重新加载 */
await page.evaluate(() => { location.hash = '#/web'; });
await wait(700);
const mineLoose = await page.evaluate((ids) => ids.filter((id) => {
  const b = window.__yixian.web.beads.filter((x) => x.wish.id === id)[0];
  return !!b && b.state === 'loose';
}), MINE_IDS);
ok('自己名下还有两条断着的丝（后面两步各用一条）', mineLoose.length >= 2, JSON.stringify(mineLoose));
const mendTarget = mineLoose[0];
const selfTarget = mineLoose[1] || mineLoose[0];

await page.evaluate((c) => { location.hash = '#/w/' + c; }, states.codes[mendTarget]);
await page.waitForSelector('#screening .screening__mend button', { timeout: 2500 });
const mendBtn = await page.$('#screening .screening__mend button');
const looseLine = await page.$eval('#screening .screening__silk', (el) => el.textContent);
ok('自己写下的断丝：给出「把这条丝接上」', !!mendBtn);
ok('丝散写的是「还没有人接住」', /还没有人接住/.test(looseLine), looseLine);
await mendBtn.click();
await wait(800);
const afterLine = await page.$eval('#screening .screening__silk', (el) => el.textContent);
ok('接上之后至少回到凝露', /凝露/.test(afterLine), afterLine);
await shot('S5-mend-after');
await page.click('#screening-close');
await wait(300);

/* ---- 自己回来看看也算接住，但得满一天 ---- */
await page.evaluate((c) => { location.hash = '#/w/' + c; }, states.codes[selfTarget]);
await wait(2400);
const ownLine = await page.$eval('#screening .screening__silk', (el) => el.textContent);
ok('自己的注视不算：那条断丝还是散', /丝散/.test(ownLine), ownLine);
const ownMendStill = await page.$('#screening .screening__mend button');
ok('按钮不会看着看着就消失', !!ownMendStill);
const afterReads = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('yixian.reads.v1') || '{"done":{}}').done));
ok('自己看没有记进被读', afterReads.indexOf(selfTarget) < 0, JSON.stringify(afterReads.slice(-4)));
await page.click('#screening-close');
await wait(300);

/* 被停过两次：还是散，但说法不一样（要抢在 1.5 秒之前关掉，否则这一看就凑够三次了） */
await page.evaluate((c) => { location.hash = '#/w/' + c; }, states.codes['w_twoReads000']);
await page.waitForSelector('#screening .screening__silk', { timeout: 3000 });
await shot('S4b-loose-seen');
const seenLine = await page.$eval('#screening .screening__silk', (el) => el.textContent);
ok('被停过两次的：写着「有人在这里停过」', /丝散/.test(seenLine) && /有人在这里停过/.test(seenLine), seenLine);
await page.click('#screening-close');
await wait(300);

/* 停在某一颗露珠上，确认真的停在它上面（露珠挨得近，命中测试会选最近的），
   然后停够 1.5 秒让它有机会被记一次。 */
const NEW_DAY = () => page.evaluate(() => { localStorage.removeItem('yixian.readgiven.v1'); });
const hoverBead = async (id, ms) => {
  await page.mouse.move(8, 8);   /* 先离开，同一颗露珠才好重新起算 */
  await wait(150);
  let hit = null;
  for (let attempt = 0; attempt < 6 && hit !== id; attempt++) {
    const pos = await page.evaluate((t) => {
      const b = window.__yixian.web.beads.filter((x) => x.wish.id === t)[0];
      if (!b) return null;
      const r = document.querySelector('#web-canvas').getBoundingClientRect();
      return { x: r.left + b.pos.x, y: r.top + b.pos.y };
    }, id);
    if (!pos) return null;
    await page.mouse.move(pos.x, pos.y);
    await page.mouse.move(pos.x + 1, pos.y + 1);
    await wait(200);
    hit = await page.evaluate(() => (window.__yixian.web.hover ? window.__yixian.web.hover.wish.id : null));
  }
  if (hit !== id) return null;
  await wait(ms);
  return hit;
};
const beadState = (id) => page.evaluate((t) => (window.__yixian.web.beads.filter((b) => b.wish.id === t)[0] || {}).state, id);
const tipText = () => page.$eval('#web-tip', (el) => el.textContent);

/* ---- 一个人一天只有一次机会 ---- */
await page.evaluate(() => { location.hash = '#/web'; });
await wait(700);
await NEW_DAY();

/* 第一次：给出去。落在一条没人读过的断丝上 */
ok('能停在无人读过的断丝上', (await hoverBead('w_looseOther5', 2200)) === 'w_looseOther5');
const firstLine = await tipText();
ok('这一次给出去了：那句变成「有人在这里停过」', /有人在这里停过/.test(firstLine), firstLine.slice(0, 26));
const given = await page.evaluate(() => JSON.parse(localStorage.getItem('yixian.readgiven.v1') || 'null'));
ok('本机记下了这一次给了谁', !!given && given > 0, JSON.stringify(given));

/* 同一天再停别的断丝：什么都不该涨 */
ok('能停在第二条断丝上', (await hoverBead('w_twoReads002', 2200)) === 'w_twoReads002');
const secondLine = await tipText();
ok('今天这一次已经给过别人：它还是丝散', /丝散/.test(secondLine) && /还没有人接住/.test(secondLine), secondLine.slice(0, 26));
ok('画布上也没变', (await beadState('w_twoReads002')) === 'loose', String(await beadState('w_twoReads002')));

/* 到了第二天：这一次轮到它，才是第三次读到 */
await NEW_DAY();
ok('第二天再停同一条', (await hoverBead('w_twoReads002', 2200)) === 'w_twoReads002');
const thirdLine = await tipText();
ok('第三次读到：丝散变成结实', /结实/.test(thirdLine), thirdLine.slice(0, 26));
ok('第三次读到：画布上那缕丝发亮了', (await beadState('w_twoReads002')) === 'solid', String(await beadState('w_twoReads002')));
await shot('S1b-read-stranger');
await page.mouse.move(20, 20);
await wait(400);

/* ---- 回响：全站在说什么 ---- */
await page.evaluate(() => { location.hash = '#/echoes'; });
await wait(2200);
const echoNote = await page.$eval('#echo-note', (el) => el.textContent);
ok('回响：说清统计范围与边界', /公开愿望/.test(echoNote) && /仅自己可见/.test(echoNote), echoNote);
const cloudWords = await page.evaluate(() => (window.__yixian.echo.cloud ? window.__yixian.echo.cloud.nodes.map((n) => n.term.word) : []));
ok('回响：词云把词铺开了', cloudWords.length >= 6, JSON.stringify(cloudWords.slice(0, 12)));
ok('回响：反复出现的词排到前面', cloudWords.indexOf('顺利') >= 0 && cloudWords.indexOf('顺利') <= 6, JSON.stringify(cloudWords.slice(0, 8)));
const cloudSizes = await page.evaluate(() => window.__yixian.echo.cloud.nodes.slice(0, 3).map((n) => Math.round(n.size)));
ok('回响：字号反映多少', cloudSizes.length === 3 && cloudSizes[0] >= cloudSizes[2], JSON.stringify(cloudSizes));
await shot('S13-echo-cloud');
await page.click('#echo-views .chip[data-echo="list"]');
await wait(700);
const rows = await page.$$eval('.echo-row', (els) => els.length);
ok('回响：切到「列」有一张表', rows >= 6, 'rows=' + rows);
const firstRow = await page.$eval('.echo-row', (el) => el.textContent.replace(/\s+/g, ' '));
ok('回响：列里有次数与占比', /\d+ 次/.test(firstRow) && /%/.test(firstRow), firstRow);
await shot('S14-echo-list');
await page.click('#echo-views .chip[data-echo="cloud"]');
await wait(600);

/* ---- 冷却 ---- */
await page.evaluate(() => { location.hash = '#/wish'; });
await wait(500);
let cooling = await page.$eval('.wish-grid', (el) => el.classList.contains('is-cooling'));
ok('没写过之前不冷却', cooling === false);

await page.evaluate(() => { localStorage.setItem('yixian.lastwrite.v1', JSON.stringify(Date.now())); });
await page.reload({ waitUntil: 'networkidle2' });
await wait(1500);
await page.evaluate(() => { location.hash = '#/wish'; });
await wait(700);
cooling = await page.$eval('.wish-grid', (el) => el.classList.contains('is-cooling'));
ok('冷却中：写作区整块退场', cooling === true);
const coolText = await page.$eval('#wish-cool', (el) => el.textContent.replace(/\s+/g, ' '));
ok('冷却中：提示里有剩余时间', /小时|分钟/.test(coolText), coolText);
const inputVisible = await page.$eval('#wish-input', (el) => el.offsetParent !== null);
ok('冷却中：输入框真的不可见', inputVisible === false);
const previewTitle = await page.$eval('#poster-title', (el) => el.textContent);
ok('冷却时预览的是刚写下的那一条，不是空海报', previewTitle !== '愿……' && previewTitle.length > 2, previewTitle);
const previewName = await page.$eval('#poster-name', (el) => el.textContent);
ok('冷却时预览带署名', previewName === '独自的人', previewName);
await shot('S6-cooldown');

/* 署名那一幕先说 */
await page.evaluate(() => { location.hash = '#/cast'; });
await wait(700);
const castCooling = await page.$eval('.form-shell', (el) => el.classList.contains('is-cooling'));
ok('冷却在署名那一幕就先说', castCooling === true);
const castNote = await page.$eval('#cast-cool', (el) => el.textContent.replace(/\s+/g, ' '));
ok('署名那一幕也给出剩余时间', /小时|分钟/.test(castNote), castNote);
const nameVisible = await page.$eval('#name-input', (el) => el.offsetParent !== null);
ok('署名那一幕：输入框退场，不摆一个填了也没用的框', nameVisible === false);
await shot('S6b-cast-cooldown');

/* ---- 真的写一条：揭幕页的编号 + 草稿清空 ---- */
await page.evaluate(() => { localStorage.removeItem('yixian.lastwrite.v1'); });
await page.reload({ waitUntil: 'networkidle2' });
await wait(1500);
await page.evaluate(() => { location.hash = '#/cast'; });
await wait(500);
await page.type('#name-input', '林深', { delay: 20 });
await page.click('#to-wish');
await wait(700);
await page.type('#wish-input', '愿有人替我读这一句。', { delay: 15 });
await page.click('#submit-wish');
await wait(3400);
const revealCode = await page.$eval('#reveal-code-value', (el) => el.textContent);
ok('揭幕页给出七位编号', /^[0-9A-HJKMNP-TV-Z]{7}$/.test(revealCode), revealCode);
const hint = await page.$eval('#reveal-code-hint', (el) => el.textContent);
ok('揭幕页说明编号怎么用', /输入/.test(hint), hint);
const draft = await page.$eval('#wish-input', (el) => el.value);
ok('提交之后草稿被清掉（不会被误发第二次）', draft === '', JSON.stringify(draft));
const draftStored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('yixian.wish') || '""'));
ok('提交之后会话里的草稿也清了', draftStored === '', JSON.stringify(draftStored));
await shot('S7-reveal-code');

/* ---- 递出去：链接 / 二维码 / 编号，一天一次 ---- */
const shareLink = await page.$eval('#share-link-value', (el) => el.textContent);
ok('默认给你链接，并且就是这个站的地址', shareLink.indexOf('#/w/') > 0 && shareLink.indexOf('http') === 0, shareLink.slice(0, 60));
const shareCode = await page.$eval('#share-code-value', (el) => el.textContent);
ok('编号页签里是同一个编号', shareCode === revealCode, shareCode + ' / ' + revealCode);
await shot('S8-share-link');

/* 切到二维码：画布上真的画了东西 */
await page.click('#share-tabs .chip[data-share="qr"]');
await wait(700);
const qrInk = await page.evaluate(() => {
  const c = document.querySelector('#share-qr');
  if (!c || !c.width) return 0;
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let dark = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
  return dark;
});
ok('二维码真的画出来了', qrInk > 200, 'dark px=' + qrInk);
await shot('S9-share-qr');
const notLockedYet = await page.$eval('#share-rest', (el) => el.hidden);
ok('只是看一眼二维码，不算递出去', notLockedYet === true);
const qrVisible = await page.$eval('#share-pane-qr', (el) => !el.hidden);
ok('二维码看得见，不会亮一下就被收回', qrVisible === true);

/* 复制走才算递出去了：这一天的机会用完 */
await page.click('#share-tabs .chip[data-share="link"]');
await wait(400);
await page.click('#share-copy-link');
await wait(600);
const restShown = await page.$eval('#share-rest', (el) => !el.hidden);
ok('复制出去之后当场锁上', restShown === true);
const restText = await page.$eval('#share-rest', (el) => el.textContent.replace(/\s+/g, ' '));
ok('锁上时告诉你还有多久', /还有/.test(restText) && /小时/.test(restText), restText);
const panesHidden = await page.$$eval('.share__pane', (els) => els.every((e) => e.hidden));
ok('锁上之后三种形式都收起来', panesHidden === true);
const noteText = await page.$eval('#share-note', (el) => el.textContent);
ok('说清这道闸只记在本机', /本机|不是门锁|一次/.test(noteText), noteText);
await shot('S10-share-locked');

/* 离开再回来，今天还是锁着 */
await page.evaluate(() => { location.hash = '#/web'; });
await wait(500);
await page.evaluate(() => { location.hash = '#/reveal'; });
await wait(700);
const stillLocked = await page.$eval('#share-rest', (el) => !el.hidden);
ok('离开再回来，今天还是锁着', stillLocked === true);

/* 仅自己可见的愿望递不出去 */
await page.evaluate(() => { window.__yixian.last.vis = 'private'; location.hash = '#/web'; });
await wait(500);
await page.evaluate(() => { location.hash = '#/reveal'; });
await wait(700);
const privShareHidden = await page.$eval('#reveal-share', (el) => el.hidden);
const privNoteShown = await page.$eval('#reveal-note', (el) => !el.hidden);
ok('仅自己可见：分享面板整个收起来', privShareHidden === true && privNoteShown === true, 'hidden=' + privShareHidden);
const privHint = await page.$eval('#reveal-code-hint', (el) => el.textContent);
ok('仅自己可见：编号提示说明别人查不到', /查不到/.test(privHint), privHint);
await page.evaluate(() => { window.__yixian.last.vis = 'public'; });

/* ---- 关于里的四态说明 ---- */
await page.evaluate(() => { location.hash = '#/about'; });
await wait(900);
const aboutText = await page.$eval('.about', (el) => el.textContent.replace(/\s+/g, ' '));
ok('关于里解释了四态', /新结/.test(aboutText) && /凝露/.test(aboutText) && /结实/.test(aboutText) && /丝散/.test(aboutText));
ok('关于里守着文案底线', /还没有人接住/.test(aboutText));
ok('关于里说明了编号的边界', /仅自己可见/.test(aboutText));
await shot('S12-about');

/* ---- 手机 ---- */
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.goto(BASE + '/#/web', { waitUntil: 'networkidle2' });
await wait(1800);
await shot('S8-mobile-web');
await page.type('#find-input', states.codes['w_fresh00001'], { delay: 15 });
await page.click('#find-form button[type=submit]');
await wait(900);
const mCode = await page.$eval('#screening .screening__code b', (el) => el.textContent).catch(() => null);
ok('手机上编号查询也通', mCode === states.codes['w_fresh00001'], String(mCode));
await shot('S9-mobile-poster');
await page.click('#screening-close');
await page.goto(BASE + '/#/echoes', { waitUntil: 'networkidle2' });
await wait(2000);
const mWords = await page.evaluate(() => (window.__yixian.echo.cloud ? window.__yixian.echo.cloud.nodes.length : 0));
ok('手机上回响也能铺开', mWords >= 6, 'words=' + mWords);
await shot('S15-mobile-echo');

/* ---- 放映室：远程删除 ---- */
const pass = (await readFile(resolve(ROOT, '.dsh-passphrase.local'), 'utf8').catch(() => '')).trim();
if (pass) {
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(BASE + '/admin.html', { waitUntil: 'networkidle2' });
  await wait(800);
  await page.type('#gate-pass', pass, { delay: 10 });
  await page.click('#gate-form button[type=submit]');
  await wait(3000);
  const roomOpen = await page.$eval('#room', (el) => !el.hidden);
  ok('放映室：用口令进得去', roomOpen);
  const rows = await page.$$('.ledger-table tbody tr');
  ok('放映室：看得到愿望', rows.length > 0, 'rows=' + rows.length);
  if (rows.length) {
    await rows[0].click();
    await wait(900);
    const codes = await page.$$eval('#drawer dt', (els) => els.map((e) => e.textContent));
    ok('抽屉里有短编号', codes.indexOf('短编号') >= 0, codes.join(','));
    ok('抽屉里有丝的命数', codes.indexOf('丝的命数') >= 0);
    const del = await page.$('#drawer .btn--danger');
    ok('抽屉里有远程删除按钮', !!del);
    await shot('S10-admin-drawer');
    if (del) {
      await del.click();
      await wait(300);
      const armed = await page.$eval('#drawer .btn--danger', (el) => el.textContent);
      ok('远程删除：要按两下确认', /再点一次/.test(armed), armed);
      const before = published.length;
      await del.click();
      await wait(1200);
      const sent = published.slice(before).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
      const delMsg = sent.filter((m) => m.t === 'del')[0];
      ok('远程删除：发出了密封的删除指令', !!delMsg && !!delMsg.seal && delMsg.seal.ct, JSON.stringify(sent).slice(0, 120));
      const notice = await page.$eval('#proj-notice', (el) => el.textContent);
      ok('远程删除：给出了回执', /约一分钟/.test(notice), notice);
      const gone = await page.$$('.ledger-table tbody tr');
      ok('远程删除：本机立刻不再显示', gone.length < rows.length, 'before=' + rows.length + ' after=' + gone.length);
      await shot('S11-admin-deleted');
    }
  }
} else {
  console.log('  · 跳过放映室断言（没有 .dsh-passphrase.local）');
}

console.log('--- console 报错 (' + problems.length + ') ---');
problems.slice(0, 12).forEach((p) => console.log(p));
if (problems.length) fails++;
console.log(fails ? '\n' + fails + ' 项未通过' : '\n全部通过');
await browser.close();
process.exit(fails ? 1 : 0);
