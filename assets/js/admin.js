/* 放映室 —— 后台
   安全模型：
   · 口令不落盘，只用于 PBKDF2 派生密钥（25 万次迭代），再拿它解开校验块与站点私钥
   · 采集到的「基本信息」是中转站上的密文 + 仓库里的密文，只有拿到口令才能在本机解开
   · 密钥只存在内存里，刷新即失效；闲置 30 分钟自动锁定；连续错 5 次锁 60 秒
   · 所有用户内容一律用 textContent 渲染，从不拼 innerHTML
   · ⚠️ 愿望正文本身是公开的（产品设定），口令保护的是基本信息，不是愿望 */
import { loadConfig, loadArchive, loadBlocked, poll, merge, config } from './store.js';
import { deriveKey, decryptJSON } from '../../shared/crypto.js';
import { unwrapKeyring } from '../../shared/keyring.js';
import { openFromSite } from '../../shared/envelope.js';
import { THREADS, threadById } from './config.js';
import { mountPoster, fullDate, speakingTime, relTime } from './poster.js';
import { loadFonts } from './fonts.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));
const HK = 'yixian.hidden.v1';
const LK = 'yixian.lock.v2';
const IDLE_MS = 30 * 60 * 1000;

let KEY = null;       /* 口令派生密钥（KEK），只在内存 */
let DEK = null;       /* 数据密钥，解开发记录用，只在内存 */
let PRIV = null;      /* 站点私钥，拆中转站上的信封用，只在内存 */

const state = {
  rows: [], queue: [], filter: 'all', q: '', sort: 'desc', showHidden: false,
  limit: 300, cursor: 0, liveIds: new Set(), blocked: new Set(), metaOk: 0, metaFail: 0
};

let lastActive = Date.now();
['click', 'keydown', 'pointermove', 'touchstart'].forEach((t) =>
  document.addEventListener(t, () => { lastActive = Date.now(); }, { passive: true }));

/* ---------------------------------------------------------- 锁定策略 */
function lock() { try { return JSON.parse(localStorage.getItem(LK) || ''); } catch (e) { return null; } }
function lockState() { return lock() || { fails: [], until: 0 }; }
function saveLock(s) { try { localStorage.setItem(LK, JSON.stringify(s)); } catch (e) {} }

function failed() {
  const s = lockState();
  const now = Date.now();
  s.fails = (s.fails || []).filter((t) => now - t < 10 * 60 * 1000).concat([now]);
  if (s.fails.length >= 5) { s.until = now + 60000; s.fails = []; }
  saveLock(s);
  return s;
}
function lockedFor() {
  const s = lockState();
  return Math.max(0, (s.until || 0) - Date.now());
}
function clearLock() { saveLock({ fails: [], until: 0 }); }

/* ---------------------------------------------------------- 口令 */
async function fetchJSON(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(path + ' ' + r.status);
  return r.json();
}

async function unlock(pass) {
  const cfg = config();
  if (!cfg.crypto || !cfg.crypto.salt) return { ok: false, msg: '还没有设置口令：先跑 node scripts/set-passphrase.mjs "口令"' };
  let key;
  try {
    key = await deriveKey(pass, cfg.crypto.salt, cfg.crypto.iterations);
  } catch (e) { return { ok: false, msg: '浏览器不支持 WebCrypto，换 Chrome / Firefox / Safari 新版。' }; }
  let verifier;
  try { verifier = await fetchJSON('data/private/verifier.json'); }
  catch (e) { return { ok: false, msg: '读不到 data/private/verifier.json' }; }
  try {
    const v = await decryptJSON(key, verifier);
    if (!v || !v.ok) throw new Error('bad');
  } catch (e) { return { ok: false, msg: '口令不对。' }; }
  KEY = key;
  try {
    const kr = await unwrapKeyring(key, await fetchJSON('data/private/keys.json'));
    DEK = kr.dek;
    PRIV = kr.sitePrivateJwk;
  } catch (e) { DEK = null; PRIV = null; }
  return { ok: true };
}

/* ---------------------------------------------------------- 解密元数据 */
async function decryptLines(path) {
  let text = '';
  if (!DEK) return { items: [], failed: 0 };
  try { text = await (await fetch(path, { cache: 'no-store' })).text(); } catch (e) { return { items: [], failed: 0 }; }
  const items = text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  const out = [];
  let failed = 0;
  const CHUNK = 150;
  for (let i = 0; i < items.length; i += CHUNK) {
    const done = await Promise.all(items.slice(i, i + CHUNK).map(async (rec) => {
      try { return Object.assign({ id: rec.id }, await decryptJSON(DEK, rec.e)); }
      catch (e) { return null; }
    }));
    done.forEach((d) => { if (d) out.push(d); else failed++; });
  }
  return { items: out, failed: failed };
}

/* ---------------------------------------------------------- 读取 */
async function load() {
  state.metaOk = 0; state.metaFail = 0;
  const blocked = await loadBlocked();
  blocked.forEach((id) => state.blocked.add(id));

  const archive = await loadArchive(true);
  const metas = new Map();
  const metaRes = await decryptLines('data/private/meta.jsonl');
  state.metaOk = metaRes.items.length;
  state.metaFail = metaRes.failed;
  metaRes.items.forEach((m) => metas.set(m.id, m));

  state.rows = archive.map((r) => Object.assign({}, r, metas.get(r.id) || {}));

  /* 「仅自己可见」的愿望：仓库里是密文，这里用数据密钥解开 */
  const vaultRes = await decryptLines('data/private/vault.jsonl');
  state.privateCount = vaultRes.items.length;
  state.privateFailed = vaultRes.failed;
  vaultRes.items.forEach((v) => {
    state.rows.push(Object.assign({}, v, v.meta || {}, { __private: true }));
  });

  /* 队列：命中审查规则、还没上墙的 */
  const queueRes = KEY ? await decryptLines('data/queue.jsonl') : { items: [], failed: 0 };
  state.queue = queueRes.items;
  state.queueFailed = queueRes.failed;
  state.queue.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  try {
    const recent = await poll('all');
    const ids = new Set(state.rows.map((r) => r.id));
    /* 只拆最近这一批信封，老的中转消息很快就会进归档 */
    for (const w of recent.slice(-60)) {
      if (w.relayTime) state.cursor = Math.max(state.cursor, w.relayTime);
      if (ids.has(w.id)) continue;
      let meta = {};
      if (w.env && PRIV) { try { meta = await openFromSite(PRIV, w.env); } catch (e) { state.metaFail++; } }
      const row = Object.assign({ id: w.id, name: w.name, wish: w.wish, mood: w.mood, ts: w.ts, __live: true }, meta);
      state.rows.push(row);
      state.liveIds.add(w.id);
    }
  } catch (e) { /* 中转站不通也能看归档 */ }

  state.rows.forEach((r) => { if (!r.id) r.id = r.name + '|' + r.wish; });
  state.rows.sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

/* ---------------------------------------------------------- 视图 */
function hiddenIds() { try { return JSON.parse(localStorage.getItem(HK) || '[]'); } catch (e) { return []; } }
function setHidden(ids) { try { localStorage.setItem(HK, JSON.stringify(ids)); } catch (e) {} }

function scoped() {
  let rows = state.rows.slice();
  if (!state.showHidden) {
    const hid = hiddenIds();
    rows = rows.filter((r) => hid.indexOf(r.id) < 0 && !state.blocked.has(r.id));
  }
  return rows;
}

function visible() {
  const now = Date.now();
  const today = (function () { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  let rows = scoped();
  if (state.filter === 'tonight') rows = rows.filter((r) => (r.ts || 0) >= today);
  else if (state.filter === 'week') rows = rows.filter((r) => (r.ts || 0) >= now - 7 * 864e5);
  else if (state.filter === 'live') rows = rows.filter((r) => state.liveIds.has(r.id));
  else if (state.filter === 'private') rows = rows.filter((r) => r.__private);
  if (state.q) {
    const q = state.q.toLowerCase();
    rows = rows.filter((r) => (r.name + ' ' + r.wish + ' ' + (r.tz || '') + ' ' + (r.ua || '')).toLowerCase().indexOf(q) >= 0);
  }
  rows.sort((a, b) => state.sort === 'desc' ? (b.ts || 0) - (a.ts || 0) : (a.ts || 0) - (b.ts || 0));
  return rows;
}

function deviceKey(r) { return r.dv || (r.ua || '') + '|' + (r.vp || '') + '|' + (r.tz || ''); }

function renderLedger() {
  const rows = scoped();
  const today = (function () { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const tonight = rows.filter((r) => (r.ts || 0) >= today).length;
  const devices = new Set(rows.map(deviceKey)).size;
  const lens = rows.map((r) => (r.wish || '').length);
  const avg = lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 0;
  const longest = rows.reduce((m, r) => Math.max(m, (r.wish || '').length), 0);
  const liveCount = rows.filter((r) => state.liveIds.has(r.id)).length;

  const sentence = $('#ledger-sentence');
  sentence.textContent = '';
  sentence.appendChild(document.createTextNode('今夜，蛛丝上多了 '));
  const b = document.createElement('b');
  b.textContent = String(tonight);
  sentence.appendChild(b);
  sentence.appendChild(document.createTextNode(' 个愿望。'));

  const line = $('#ledger-line');
  line.textContent = '';
  [['总计', rows.length + ' 条'], ['独立设备', devices + ' 台'], ['平均', avg + ' 字'], ['最长', longest + ' 字'],
   ['未归档', liveCount + ' 条'], ['待审', state.queue.length + ' 条'],
   ['仅自己可见', (state.privateCount || 0) + ' 条'],
   ['元数据', state.metaOk + ' 条' + (state.metaFail ? '（' + state.metaFail + ' 条解不开）' : '')]
  ].forEach((pair) => {
    const s = document.createElement('span');
    s.textContent = pair[0] + ' ';
    const v = document.createElement('b');
    v.textContent = pair[1];
    s.appendChild(v);
    line.appendChild(s);
  });
}

function renderTimeline() {
  const host = $('#timeline-bars');
  host.textContent = '';
  const days = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 864e5);
    const t = d.getTime();
    days.push({ t: t, next: t + 864e5, label: (d.getMonth() + 1) + '/' + d.getDate(), n: 0 });
  }
  scoped().forEach((r) => {
    const ts = r.ts || 0;
    for (let i = days.length - 1; i >= 0; i--) {
      if (ts >= days[i].t && ts < days[i].next) { days[i].n++; break; }
    }
  });
  const max = Math.max(1, days.reduce((m, d) => Math.max(m, d.n), 0));
  $('#timeline-total').textContent = '共 ' + days.reduce((a, d) => a + d.n, 0) + ' 条 · 峰值 ' + max + ' 条/日';
  $('#axis-from').textContent = days[0].label;
  days.forEach((d) => {
    const bar = document.createElement('div');
    bar.className = 'timeline__bar' + (d.n ? ' is-filled' : '');
    bar.style.height = d.n ? Math.max(4, (d.n / max) * 100) + '%' : '3px';
    bar.dataset.tip = d.label + ' · ' + d.n + ' 条';
    bar.title = d.label + ' · ' + d.n + ' 条';
    host.appendChild(bar);
  });
}

function renderQueue() {
  const panel = $('#queue-panel');
  const host = $('#queue-list');
  $('#queue-count').textContent = String(state.queue.length);
  panel.hidden = state.queue.length === 0;
  host.textContent = '';
  if (!state.queue.length) return;
  state.queue.forEach((q) => {
    const row = document.createElement('article');
    row.className = 'queue__item';
    const head = document.createElement('p');
    head.className = 'queue__meta';
    head.textContent = q.id + ' · ' + fullDate(q.ts) + ' ' + speakingTime(q.ts);
    const body = document.createElement('p');
    body.className = 'queue__wish';
    const who = document.createElement('b');
    who.textContent = q.name + '：';
    body.appendChild(who);
    body.appendChild(document.createTextNode(q.wish || ''));
    const why = document.createElement('p');
    why.className = 'queue__why';
    why.textContent = '拦截理由：' + (q.reason || '未说明');
    const acts = document.createElement('div');
    acts.className = 'queue__acts';
    [['复制放行命令', 'WISH_ADMIN_PASSPHRASE=<口令> node scripts/moderate.mjs approve ' + q.id],
     ['复制屏蔽命令', 'node scripts/moderate.mjs reject ' + q.id]
    ].forEach((pair) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn--quiet';
      btn.type = 'button';
      btn.textContent = pair[0];
      btn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(pair[1]); btn.textContent = '已复制'; } catch (e) { btn.textContent = pair[1]; }
      });
      acts.appendChild(btn);
    });
    row.appendChild(head); row.appendChild(body); row.appendChild(why); row.appendChild(acts);
    host.appendChild(row);
  });
}

function renderTable() {
  const rows = visible();
  const host = $('#table-host');
  host.textContent = '';
  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'ledger-empty';
    p.textContent = '这里没有符合条件的愿望。';
    host.appendChild(p);
    return;
  }
  const table = document.createElement('table');
  table.className = 'ledger-table';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  const cols = [['时间', 'time'], ['署名', 'name'], ['愿望', 'wish'], ['丝线', null], ['语言 / 时区', null], ['设备', null], ['来源', null]];
  cols.forEach((c) => {
    const th = document.createElement('th');
    if (c[1]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = c[0] + (c[1] === 'time' ? (state.sort === 'desc' ? ' ↓' : ' ↑') : '');
      btn.addEventListener('click', () => { state.sort = state.sort === 'desc' ? 'asc' : 'desc'; renderTable(); renderLedger(); });
      th.appendChild(btn);
    } else th.textContent = c[0];
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const hid = hiddenIds();
  const slice = rows.slice(0, state.limit);
  slice.forEach((r) => {
    const tr = document.createElement('tr');
    if (hid.indexOf(r.id) >= 0) tr.classList.add('is-hidden');
    const t = threadById(r.mood);

    const tdTime = document.createElement('td');
    tdTime.className = 'cell-time';
    tdTime.textContent = fullDate(r.ts) + ' ' + speakingTime(r.ts);
    tr.appendChild(tdTime);

    const tdName = document.createElement('td');
    tdName.className = 'cell-name';
    tdName.textContent = r.name;
    tr.appendChild(tdName);

    const tdWish = document.createElement('td');
    tdWish.className = 'cell-wish';
    tdWish.textContent = r.wish;
    if (r.__private) {
      const t = tag('仅自己可见');
      t.classList.add('tag-priv');
      tdWish.insertBefore(t, tdWish.firstChild);
    }
    if (state.blocked.has(r.id)) {
      tdWish.appendChild(tag('已屏蔽'));
    } else if (state.liveIds.has(r.id)) {
      tdWish.appendChild(tag('未归档'));
    }
    tr.appendChild(tdWish);

    const tdThread = document.createElement('td');
    tdThread.className = 'cell-thread';
    const sw = document.createElement('i');
    sw.className = 'swatch';
    sw.style.setProperty('--swatch', 'var(--' + t.id + ')');
    tdThread.appendChild(sw);
    tdThread.appendChild(document.createTextNode(t.name));
    tr.appendChild(tdThread);

    const tdTz = document.createElement('td');
    tdTz.className = 'cell-dim';
    tdTz.textContent = (r.lg || '—') + ' · ' + (r.tz || '—');
    tr.appendChild(tdTz);

    const tdDev = document.createElement('td');
    tdDev.className = 'cell-dim';
    tdDev.textContent = (r.ua || '—') + (r.vp ? ' · ' + r.vp : '');
    tr.appendChild(tdDev);

    const tdRef = document.createElement('td');
    tdRef.className = 'cell-dim';
    tdRef.textContent = r.ref || 'direct';
    tr.appendChild(tdRef);

    tr.addEventListener('click', () => openDrawer(r));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  host.appendChild(table);

  if (rows.length > slice.length) {
    const more = document.createElement('button');
    more.className = 'btn btn--quiet';
    more.type = 'button';
    more.textContent = '再展开 300 条（还有 ' + (rows.length - slice.length) + ' 条）';
    more.style.marginTop = '1.4rem';
    more.addEventListener('click', () => { state.limit += 300; renderTable(); });
    host.appendChild(more);
  }
}

function tag(text) {
  const s = document.createElement('span');
  s.className = 'tag-live';
  s.textContent = text;
  return s;
}

/* ---------------------------------------------------------- 抽屉 */
function openDrawer(r) {
  const host = $('#drawer');
  host.textContent = '';

  const close = document.createElement('button');
  close.className = 'btn btn--quiet drawer__close';
  close.type = 'button';
  close.textContent = '关闭 ✕';
  close.addEventListener('click', closeDrawer);
  host.appendChild(close);

  const posterHost = document.createElement('div');
  posterHost.className = 'drawer__poster';
  host.appendChild(posterHost);
  mountPoster(posterHost, r, {});

  const wish = document.createElement('p');
  wish.className = 'drawer__wish';
  wish.textContent = r.wish;
  host.appendChild(wish);

  const dl = document.createElement('dl');
  const rows = [
    ['署名', r.name],
    ['编号', r.id],
    ['写下于', fullDate(r.ts) + ' ' + speakingTime(r.ts) + '（' + relTime(r.ts) + '）'],
    ['丝线', threadById(r.mood).name + ' · ' + threadById(r.mood).en],
    ['语言', r.lg || '（未解密）'],
    ['时区', r.tz || '（未解密）'],
    ['设备', r.ua || '（未解密）'],
    ['视口', r.vp || '（未解密）'],
    ['来源页', r.ref || '（未解密）'],
    ['来访次数', r.n ? '第 ' + r.n + ' 次' : '（未解密）'],
    ['设备标识', r.dv || '（未解密）'],
    ['入口', r.src || 'web'],
    ['可见性', r.__private ? '仅自己可见（端到端加密）' : '公开'],
    ['归档', state.blocked.has(r.id) ? '已屏蔽（不进蛛网）' : (state.liveIds.has(r.id) ? '尚未归档（等采集器写入）' : '已归档')]
  ];
  rows.forEach((pair) => {
    const dt = document.createElement('dt');
    dt.textContent = pair[0];
    const dd = document.createElement('dd');
    dd.textContent = pair[1];
    dl.appendChild(dt); dl.appendChild(dd);
  });
  host.appendChild(dl);

  const actions = document.createElement('div');
  actions.className = 'proj-head__tools';
  const hide = document.createElement('button');
  hide.className = 'btn btn--quiet';
  hide.type = 'button';
  hide.textContent = hiddenIds().indexOf(r.id) >= 0 ? '取消隐藏' : '在本机隐藏';
  hide.addEventListener('click', () => {
    const list = hiddenIds();
    const i = list.indexOf(r.id);
    if (i >= 0) list.splice(i, 1); else list.push(r.id);
    setHidden(list);
    hide.textContent = hiddenIds().indexOf(r.id) >= 0 ? '取消隐藏' : '在本机隐藏';
    renderTable();
  });
  const cmd = document.createElement('button');
  cmd.className = 'btn btn--quiet';
  cmd.type = 'button';
  cmd.textContent = '复制删除命令';
  cmd.addEventListener('click', async () => {
    const line = 'node scripts/remove-wish.mjs ' + r.id;
    try { await navigator.clipboard.writeText(line); } catch (e) {}
    cmd.textContent = '已复制：' + line;
  });
  actions.appendChild(hide);
  actions.appendChild(cmd);
  host.appendChild(actions);

  host.hidden = false;
  $('#scrim').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  $('#drawer').hidden = true;
  $('#scrim').hidden = true;
  document.body.style.overflow = '';
}

/* ---------------------------------------------------------- 导出 */
function download(name, text, type) {
  const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* 防 CSV 公式注入：Excel 会把 = + - @ 开头的单元格当公式执行 */
function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const COLUMNS = [
  ['时间', (r) => fullDate(r.ts) + ' ' + speakingTime(r.ts)],
  ['署名', (r) => r.name],
  ['愿望', (r) => r.wish],
  ['丝线', (r) => threadById(r.mood).name],
  ['语言', (r) => r.lg], ['时区', (r) => r.tz], ['设备', (r) => r.ua],
  ['视口', (r) => r.vp], ['来源页', (r) => r.ref], ['来访次数', (r) => r.n],
  ['设备标识', (r) => r.dv], ['编号', (r) => r.id]
];

function exportCsv() {
  const rows = visible();
  const head = COLUMNS.map((c) => c[0]);
  const body = rows.map((r) => COLUMNS.map((c) => csvCell(c[1](r))));
  download('wishes-' + Date.now() + '.csv', '\ufeff' + [head].concat(body).map((row) => row.join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}

function exportJson() {
  download('wishes-' + Date.now() + '.json', JSON.stringify(visible(), null, 2), 'application/json');
}

/* ---------------------------------------------------------- 启动 */
function renderAll() { renderLedger(); renderTimeline(); renderTable(); renderQueue(); }

async function enter() {
  $('#gate').hidden = true;
  $('#room').hidden = false;
  $('#proj-status').textContent = '正在解密元数据…';
  try {
    await load();
  } catch (e) {
    $('#proj-status').textContent = '读取失败：' + e.message;
  }
  renderAll();
  $('#proj-status').textContent = '已连上蛛丝 · ' + new Date().toLocaleTimeString('zh-CN') +
    ' · 元数据 ' + state.metaOk + ' 条' + (state.metaFail ? '（' + state.metaFail + ' 条解不开）' : '') +
    ' · 待审 ' + state.queue.length + ' 条';

  setInterval(async () => {
    if (!KEY) return;
    try {
      const recent = await poll(state.cursor || 'all');
      if (!recent.length) return;
      let changed = false;
      const ids = new Set(state.rows.map((r) => r.id));
      for (const w of recent) {
        if (w.relayTime) state.cursor = Math.max(state.cursor, w.relayTime);
        if (ids.has(w.id)) continue;
        let meta = {};
        if (w.env && PRIV) { try { meta = await openFromSite(PRIV, w.env); } catch (e) {} }
        state.rows.push(Object.assign({ id: w.id, name: w.name, wish: w.wish, mood: w.mood, ts: w.ts, __live: true }, meta));
        state.liveIds.add(w.id);
        changed = true;
      }
      if (changed) renderAll();
    } catch (e) {}
  }, 20000);
}

function lockNow(reason) {
  KEY = null; PRIV = null;
  if (reason) { try { sessionStorage.setItem('yixian.lockmsg', reason); } catch (e) {} }
  location.reload();
}

async function boot() {
  loadFonts();
  await loadConfig();

  setInterval(() => {
    if (KEY && Date.now() - lastActive > IDLE_MS) lockNow('闲置超过 30 分钟，已自动锁定。');
  }, 20000);

  const form = $('#gate-form');
  const passEl = $('#gate-pass');
  const errEl = $('#gate-err');
  const btn = form.querySelector('button[type=submit]');

  const tickLock = () => {
    const left = lockedFor();
    if (left > 0) {
      btn.disabled = true;
      passEl.disabled = true;
      errEl.textContent = '尝试次数过多，请等 ' + Math.ceil(left / 1000) + ' 秒。';
      setTimeout(tickLock, 1000);
    } else {
      btn.disabled = false;
      passEl.disabled = false;
    }
  };
  tickLock();
  passEl.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (lockedFor() > 0) return;
    btn.disabled = true;
    btn.textContent = '正在校验…';
    const res = await unlock(passEl.value);
    passEl.value = '';
    if (res.ok) { clearLock(); enter(); return; }
    const s = failed();
    errEl.textContent = res.msg + ((s.until || 0) > Date.now() ? ' 连续错太多次，锁 60 秒。' : '');
    btn.disabled = false;
    btn.textContent = '进入放映室';
    tickLock();
  });
}

$('#refresh') && $('#refresh').addEventListener('click', async () => { await load(); renderAll(); });
$('#export-csv') && $('#export-csv').addEventListener('click', exportCsv);
$('#export-json') && $('#export-json').addEventListener('click', exportJson);
$('#sign-out') && $('#sign-out').addEventListener('click', () => lockNow(null));
$('#q') && $('#q').addEventListener('input', (e) => { state.q = e.target.value.trim(); state.limit = 300; renderTable(); });
$('#range-chips') && $('#range-chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  state.filter = b.dataset.range;
  $$('#range-chips .chip').forEach((c) => c.classList.toggle('is-on', c === b));
  renderTable();
});
$('#toggle-hidden') && $('#toggle-hidden').addEventListener('click', (e) => {
  state.showHidden = !state.showHidden;
  e.target.classList.toggle('is-on', state.showHidden);
  e.target.textContent = state.showHidden ? '隐藏已隐藏' : '显示已隐藏';
  renderAll();
});
$('#scrim') && $('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

boot();
