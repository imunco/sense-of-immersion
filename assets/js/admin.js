/* 放映室 —— 后台 */
import { loadConfig, loadArchive, loadBlocked, poll, merge, config } from './store.js';
import { THREADS, threadById } from './config.js';
import { mountPoster, fullDate, speakingTime, relTime } from './poster.js';
import { loadFonts } from './fonts.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));
const HK = 'yixian.hidden.v1';
const AK = 'yixian.room.v1';

const state = {
  rows: [], filter: 'all', q: '', sort: 'desc', showHidden: false, limit: 300, cursor: 0, liveIds: new Set(), blocked: new Set()
};

/* ---------------------------------------------------------- 口令 */
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.prototype.map.call(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function hiddenIds() {
  try { return JSON.parse(localStorage.getItem(HK) || '[]'); } catch (e) { return []; }
}
function setHidden(ids) { localStorage.setItem(HK, JSON.stringify(ids)); }

async function unlock(pass) {
  const cfg = config();
  const hash = cfg.adminHash;
  if (!hash) return true; /* 没设口令就直接进 */
  return (await sha256(pass)) === hash;
}

/* ---------------------------------------------------------- 读取 */
async function load() {
  const blocked = await loadBlocked();
  blocked.forEach((id) => state.blocked.add(id));
  const archive = await loadArchive(true);
  state.rows = archive.slice();
  try {
    const recent = await poll('all');
    const ids = new Set(state.rows.map((r) => r.id));
    recent.forEach((w) => {
      if (w.relayTime) state.cursor = Math.max(state.cursor, w.relayTime);
      if (!ids.has(w.id)) { w.__live = true; state.liveIds.add(w.id); }
    });
    state.rows = merge(state.rows, recent);
  } catch (e) { /* 离线也能看归档 */ }
  state.rows.forEach((r) => { if (!r.id) r.id = r.name + '|' + r.wish; });
}

/* ---------------------------------------------------------- 视图 */
/* 屏蔽与本地隐藏之后的全部数据 —— 统计口径用它 */
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
  const today = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  let rows = scoped();
  if (state.filter === 'tonight') rows = rows.filter((r) => (r.ts || 0) >= today);
  else if (state.filter === 'week') rows = rows.filter((r) => (r.ts || 0) >= now - 7 * 864e5);
  else if (state.filter === 'live') rows = rows.filter((r) => state.liveIds.has(r.id));
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
  const today = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const tonight = rows.filter((r) => (r.ts || 0) >= today).length;
  const devices = new Set(rows.map(deviceKey)).size;
  const lens = rows.map((r) => (r.wish || '').length);
  const avg = lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 0;
  const longest = rows.reduce((m, r) => Math.max(m, (r.wish || '').length), 0);

  const sentence = $('#ledger-sentence');
  sentence.textContent = '';
  sentence.appendChild(document.createTextNode('今夜，蛛丝上多了 '));
  const b = document.createElement('b');
  b.textContent = String(tonight);
  sentence.appendChild(b);
  sentence.appendChild(document.createTextNode(' 个愿望。'));

  const line = $('#ledger-line');
  line.textContent = '';
  const liveCount = rows.filter((r) => state.liveIds.has(r.id)).length;
  [['总计', rows.length + ' 条'], ['独立设备', devices + ' 台'], ['平均', avg + ' 字'], ['最长', longest + ' 字'],
   ['未归档', liveCount + ' 条']].forEach((pair) => {
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
    const next = d.getTime() + 864e5;
    days.push({ t: d.getTime(), label: (d.getMonth() + 1) + '/' + d.getDate(), n: 0 });
    days[days.length - 1].next = next;
  }
  scoped().forEach((r) => {
    const ts = r.ts || 0;
    for (let i = days.length - 1; i >= 0; i--) {
      if (ts >= days[i].t && ts < days[i].next) { days[i].n++; break; }
    }
  });
  const max = Math.max(1, days.reduce((m, d) => Math.max(m, d.n), 0));
  const total = days.reduce((a, d) => a + d.n, 0);
  $('#timeline-total').textContent = '共 ' + total + ' 条 · 峰值 ' + max + ' 条/日';
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
    if (state.blocked.has(r.id)) {
      const tag = document.createElement('span');
      tag.className = 'tag-live';
      tag.textContent = '已屏蔽';
      tdWish.appendChild(tag);
    } else if (state.liveIds.has(r.id)) {
      const tag = document.createElement('span');
      tag.className = 'tag-live';
      tag.textContent = '未归档';
      tdWish.appendChild(tag);
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

/* ---------------------------------------------------------- 抽屉 */
let drawerRow = null;
function openDrawer(r) {
  drawerRow = r;
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
    ['语言', r.lg || '—'],
    ['时区', r.tz || '—'],
    ['设备', r.ua || '—'],
    ['视口', r.vp || '—'],
    ['来源页', r.ref || 'direct'],
    ['来访次数', r.n ? '第 ' + r.n + ' 次' : '—'],
    ['设备标识', r.dv || '—'],
    ['入口', r.src || 'web'],
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
  const open = document.createElement('a');
  open.className = 'btn btn--quiet';
  open.textContent = '看它的海报';
  open.href = 'index.html#/web';
  actions.appendChild(open);
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

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportCsv() {
  const head = ['时间', '署名', '愿望', '丝线', '语言', '时区', '设备', '视口', '来源页', '来访次数', '编号'];
  const rows = visible().map((r) => [
    fullDate(r.ts) + ' ' + speakingTime(r.ts), r.name, r.wish, threadById(r.mood).name,
    r.lg, r.tz, r.ua, r.vp, r.ref, r.n, r.id
  ]);
  const csv = '\ufeff' + [head].concat(rows).map((row) => row.map(csvCell).join(',')).join('\r\n');
  download('wishes-' + Date.now() + '.csv', csv, 'text/csv;charset=utf-8');
}

function exportJson() {
  download('wishes-' + Date.now() + '.json', JSON.stringify(visible(), null, 2), 'application/json');
}

/* ---------------------------------------------------------- 启动 */
function renderAll() { renderLedger(); renderTimeline(); renderTable(); }

async function enter() {
  $('#gate').hidden = true;
  $('#room').hidden = false;
  await load();
  renderAll();
  $('#proj-status').textContent = '已连上蛛丝 · ' + new Date().toLocaleTimeString('zh-CN');
  $('#foot-note').textContent = '中转站 ' + (config().endpoint || '') + '/' + (config().topic || '');
  setInterval(async () => {
    try {
      const recent = await poll(state.cursor || 'all');
      if (!recent.length) return;
      let changed = false;
      const ids = new Set(state.rows.map((r) => r.id));
      recent.forEach((w) => {
        if (w.relayTime) state.cursor = Math.max(state.cursor, w.relayTime);
        if (!ids.has(w.id)) { w.__live = true; state.liveIds.add(w.id); changed = true; }
      });
      if (changed) { state.rows = merge(state.rows, recent); renderAll(); }
    } catch (e) {}
  }, 20000);
}

async function boot() {
  loadFonts();
  await loadConfig();
  if (sessionStorage.getItem(AK) === '1') { enter(); return; }
  $('#gate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = $('#gate-pass').value;
    if (await unlock(pass)) { sessionStorage.setItem(AK, '1'); enter(); }
    else { $('#gate-err').textContent = '口令不对。再想想。'; }
  });
  $('#gate-pass').focus();
}

$('#refresh') && $('#refresh').addEventListener('click', async () => { await load(); renderAll(); });
$('#export-csv') && $('#export-csv').addEventListener('click', exportCsv);
$('#export-json') && $('#export-json').addEventListener('click', exportJson);
$('#sign-out') && $('#sign-out').addEventListener('click', () => { sessionStorage.removeItem(AK); location.reload(); });
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
  renderTable();
});
$('#scrim') && $('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

boot();
