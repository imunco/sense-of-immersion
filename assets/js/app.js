/* 一线千愿 —— 放映流程 */
import { loadFonts } from './fonts.js';
import { THREADS, threadById } from './config.js';
import {
  loadConfig, loadArchive, loadBlocked, loadModeration, poll, publish, merge, deviceInfo, visitCount,
  newId, remember, myWishes, isMine, queuePending, flushPending, trackDelivered, loadVaultIds, loadQueueIds,
  encodeShare, decodeShare, config, screenText, moderation, mineProof, seal, pokeArchive, pending,
  loadReads, localReads, trackRead, flushReads, localMends, queueMend, flushMends, markWrite, cooldownLeft,
  shareAt, markShareAt, readGivenAt, markReadGiven
} from './store.js';
import { renderPoster, fitPoster, speakingTime, fullDate, relTime, mountPoster } from './poster.js';
import { wishCode, normalizeCode, silkState, silkOf, readCount } from './silk.js';
import { EchoCloud, analyze, ratioText } from './echoes.js';
import { drawQR } from './qr.js';
import { SilkWeb } from './web.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel));

const state = {
  name: '', wish: '', mood: 'silk',
  all: [], cursor: 0, seen: new Set(), blocked: new Set(),
  last: null, filter: 'all', visit: 1, web: null, booted: false,
  wishShownAt: 0, submitting: false, vis: 'public', mine: [],
  reads: {}, effReads: {}, localRead: new Map(), mends: {}, byCode: new Map(), cooldown: 0,
  screenTimer: 0, screenWish: null, pendingCode: '',
  echo: { data: null, version: '', view: 'cloud', cloud: null, busy: false },
  share: 'link', shareTimer: 0
};

const sleep = (ms) => new Promise(function (r) { setTimeout(r, ms); });

/* ------------------------------------------------------------ 小工具 */
let toastTimer = 0;
function toast(msg) {
  const node = $('#toast');
  node.textContent = msg;
  node.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { node.classList.remove('is-on'); }, 3200);
}

/* ------------------------------------------------------------ 丝 · 编号与命数 */
/* 冷却时长与采集器读同一份 data/moderation.json；读不到就退回六小时 */
function cooldownHours() {
  const rate = (moderation() || {}).rate || {};
  const h = Number(rate.cooldownHours);
  return h > 0 ? h : 6;
}

function formatLeft(ms) {
  const m = Math.ceil(ms / 60000);
  if (m <= 1) return '不到一分钟';
  const h = Math.floor(m / 60), mm = m % 60;
  if (h && mm) return h + ' 小时 ' + mm + ' 分钟';
  if (h) return h + ' 小时';
  return mm + ' 分钟';
}

/* 冷却期间把预览换成刚写下的那一条 —— 别留一张「愿……」的空海报 */
function paintWritten() {
  const rec = myWishes()[0];
  if (!rec || !rec.wish) return false;
  const fig = $('#poster-preview');
  if (!fig) return false;
  document.documentElement.dataset.thread = rec.mood || 'silk';
  fig.dataset.thread = rec.mood || 'silk';
  const title = $('#poster-title');
  title.textContent = rec.wish;
  title.classList.toggle('is-latin', !/[㐀-鿿぀-ヿ]/.test(rec.wish));
  $('#poster-reflect-text').textContent = rec.wish;
  $('#poster-name').textContent = rec.name;
  $('#poster-sub').textContent = '"spoken at ' + speakingTime(rec.ts) + ', ' + fullDate(rec.ts) + '"';
  $('#poster-thread-name').textContent = threadById(rec.mood).name + ' · ' + threadById(rec.mood).en;
  fig.classList.add('is-fitting');
  fitPoster(fig);
  requestAnimationFrame(function () { fig.classList.remove('is-fitting'); });
  return true;
}

/* 冷却期间，把写作区换成一句「已经写下」。控件整块退场，不摆灰按钮 */
let coolTimer = 0;
let coolPainted = false;
function applyCooldown() {
  const left = cooldownLeft(cooldownHours());
  state.cooldown = left;
  const on = left > 0;
  /* 署名那一幕就先说，别让人填完名字才撞上；许愿那一幕同理 */
  [['#cast-cool', '#cast-cool-left', '.form-shell'], ['#wish-cool', '#cool-left', '.wish-grid']].forEach(function (pair) {
    const note = $(pair[0]);
    if (note) note.hidden = !on;
    const host = $(pair[2]);
    if (host) host.classList.toggle('is-cooling', on);
    const clock = $(pair[1]);
    if (clock && on) clock.textContent = formatLeft(left);
  });
  if (on) {
    if (!coolPainted) { coolPainted = true; paintWritten(); }
    if (!coolTimer) coolTimer = setInterval(applyCooldown, 1000);
  } else {
    if (coolTimer) { clearInterval(coolTimer); coolTimer = 0; }
    if (coolPainted) { coolPainted = false; updateWishState(); }
  }
}

/* 服务端聚合的读数，加上本机还没被采集器收走的那一票 */
function rebuildReads() {
  const eff = Object.assign({}, state.reads);
  state.localRead.forEach(function (entry, id) {
    const base = typeof entry === 'number' ? 0 : (Number(entry && entry.base) || 0);
    const server = Number(state.reads[id]) || 0;
    /* 服务端还没涨过，就说明这一票还没被收走，本机先替它算上 */
    if (server <= base) eff[id] = server + 1;
  });
  state.effReads = eff;
}

function refreshSilk() {
  state.localRead = new Map(Object.entries(localReads()));
  const mended = localMends();
  Object.keys(mended).forEach(function (id) { if (!state.mends[id]) state.mends[id] = mended[id]; });
  rebuildReads();
}

function stateOf(w) { return silkState(w, state.effReads, state.mends); }

/* 一条公开愿望被认真看了一会儿 —— 记在本机，下次访问时批量发出去。
   两条闸：
     · 自己的注视不算（要接上自己那条断丝，用海报上的「把这条丝接上」）；
     · 一台设备一天只有一次机会 —— 24 小时里只给出一条，给出去的那一条才计数。
   界面上没有提示说「看着看着就会接上」，所以没轮到的那些什么都不该变。 */
const READ_WINDOW = 864e5;
function markRead(wish) {
  if (!wish || !wish.id || wish.__private || wish.shared) return;
  if (isMine(wish.id)) return;
  if (state.localRead.has(wish.id)) return;                        /* 这条本机早算过 */
  if (Date.now() - readGivenAt() < READ_WINDOW) return;            /* 今天这一次已经给过别人了 */
  const server = Number(state.reads[wish.id]) || 0;
  if (!trackRead(wish.id, server)) return;
  markReadGiven(Date.now());
  state.localRead.set(wish.id, { t: Date.now(), base: server });
  rebuildReads();
  syncWeb();
  refreshScreeningSilk();
  /* 提示里那句话也得跟着换，不能露珠变了它还说旧的 */
  if (state.web && state.web.hover && state.web.hover.wish.id === wish.id) {
    showTip(state.web.hover.wish, state.web.hover.pos);
  }
}

async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); return; }
  catch (e) { /* 退回老办法 */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toast(okMsg); }
  catch (e2) { toast('复制不了，编号是 ' + text); }
  document.body.removeChild(ta);
}

/* 编号是 id 的确定性短码，任何地方都能算出来 */
function indexCodes() {
  state.byCode = new Map();
  state.all.forEach(function (w) { if (w.id) state.byCode.set(wishCode(w.id), w); });
}

function lookupCode(code) {
  const pub = state.byCode.get(code);
  if (pub) return { wish: pub, own: isMine(pub.id), priv: false };
  const mine = myWishes().filter(function (w) { return wishCode(w.id) === code; })[0];
  if (mine) return { wish: mine, own: true, priv: mine.vis === 'private' };
  return null;
}

const PRIVATE_CODE_NOTE = '这一条是「仅自己可见」，正文加密，别人用这个编号查不到它。';

function session(key, value) {
  try {
    if (value === undefined) { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : null; }
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (e) { return null; }
  return value;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isTonight(w) { return (w.ts || 0) >= startOfToday(); }

/* ------------------------------------------------------------ 路由 */
const VIEWS = ['hero', 'cast', 'wish', 'reveal', 'web', 'echoes', 'about'];
let currentView = '';

function parseRoute() {
  const raw = (location.hash || '#/').replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  if (parts[0] === 'w' && parts[1]) return { view: 'web', share: parts[1] };
  const view = VIEWS.indexOf(parts[0]) >= 0 ? parts[0] : 'hero';
  return { view: view };
}

function go(hash) {
  if (location.hash === hash) { render(); return; }
  location.hash = hash;
}

function cut() {
  const curtain = $('#curtain');
  curtain.classList.add('is-on');
  setTimeout(function () { curtain.classList.remove('is-on'); }, 170);
}

function applyView(view) {
  if (view === 'wish' && currentView !== 'wish') state.wishShownAt = Date.now();
  currentView = view;
  if (view === 'wish' || view === 'cast') applyCooldown();
  $$('.act').forEach(function (sec) {
    sec.classList.toggle('is-current', sec.dataset.view === view);
  });
  document.body.dataset.act = view;
}

function render() {
  const route = parseRoute();
  if (route.view !== currentView) cut();
  applyView(route.view);
  window.scrollTo({ top: 0, behavior: 'auto' });

  if (route.view === 'web') { mountWeb(); }
  else if (state.web) { state.web.stop(); }
  if (route.view === 'echoes') { mountEchoes(); }
  else if (state.echo.cloud) { state.echo.cloud.stop(); }

  if (route.view === 'reveal') {
    if (!state.last) { go('#/cast'); return; }
    renderReveal(state.last);
  }
  if (route.share) {
    const shared = decodeShare(route.share);
    if (shared) {
      document.documentElement.dataset.thread = threadById(shared.mood).id;
      openScreening(shared);
    } else if (!openByCode(route.share)) {
      /* 数据还没到就先记着，载入后再认这个编号 */
      if (state.booted) toast('这个链接读不出来了');
      else state.pendingCode = route.share;
    }
  }
  if (route.view === 'cast' && state.cooldown <= 0) { setTimeout(function () { $('#name-input').focus(); }, 240); }
  if (route.view === 'wish' && state.cooldown <= 0) { setTimeout(function () { $('#wish-input').focus(); }, 240); }
}

/* #/w/<编号> 也能直接翻到那张海报 */
function openByCode(raw) {
  const code = normalizeCode(raw);
  if (!code) return false;
  const hit = lookupCode(code);
  if (!hit) return false;
  openScreening(hit.wish, hit.priv ? PRIVATE_CODE_NOTE : null);
  return true;
}

/* ------------------------------------------------------------ 数据 */
function filtered() {
  if (state.filter === 'mine') {
    /* 自己的愿望：公开的从网上取，私密的只从本机取 —— 别人永远看不到 */
    const byId = new Map();
    state.all.forEach(function (w) { if (isMine(w.id)) byId.set(w.id, w); });
    myWishes().forEach(function (w) { if (!byId.has(w.id)) byId.set(w.id, Object.assign({ __private: w.vis === 'private' }, w)); });
    return Array.from(byId.values()).sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
  }
  const list = state.all.filter(function (w) { return !state.blocked.has(w.id); });
  if (state.filter === 'tonight') return list.filter(isTonight);
  if (state.filter === 'week') return list.filter(function (w) { return (w.ts || 0) >= Date.now() - 7 * 864e5; });
  return list;
}

function counts() {
  const tonight = state.all.filter(isTonight).length;
  $('#hero-count').textContent = String(tonight);
  $('#live-count').textContent = String(tonight);
  $('#web-count').textContent = String(filtered().length);
}

function absorb(list, animate) {
  const fresh = [];
  list.forEach(function (w) {
    const key = w.id || (w.name + '|' + w.wish + '|' + w.ts);
    if (state.blocked.has(key)) return; /* 被屏蔽的愿望不进网 */
    if (state.seen.has(key)) return;
    state.seen.add(key);
    fresh.push(w);
  });
  if (!fresh.length) return 0;
  state.all = merge(state.all, fresh);
  indexCodes();
  if (animate && state.web) fresh.forEach(function (w) { state.web.markBorn(w.id); });
  counts();
  syncWeb();
  if (currentView === 'echoes') ensureEchoes();
  return fresh.length;
}

async function loadAll() {
  const blocked = await loadBlocked();
  blocked.forEach(function (id) { state.blocked.add(id); });
  const archive = await loadArchive();
  absorb(archive, false);
  try {
    const recent = await poll('all');
    recent.forEach(function (w) { if (w.relayTime) state.cursor = Math.max(state.cursor, w.relayTime); });
    absorb(recent, false);
  } catch (e) {}
  counts();
}

/* 只要还有没落库的愿望，就持续叫醒归档 —— 一次触发被限流丢掉也不会卡住 */
function pokeIfPending() {
  if (!pending().length) return;
  pokeArchive();
}

async function tick() {
  if (document.hidden) return;
  pokeIfPending();
  try {
    const list = await poll(state.cursor || 'all');
    if (!list.length) return;
    list.forEach(function (w) { if (w.relayTime) state.cursor = Math.max(state.cursor, w.relayTime); });
    absorb(list, true);
  } catch (e) {}
}

/* ------------------------------------------------------------ 蛛网 */
function syncWeb() {
  if (!state.web) return;
  const list = filtered().slice(-220);
  state.web.setWishes(list, stateOf);
  $('#web-empty').hidden = list.length > 0;
  renderWebList(list);
}

/* 画布对读屏软件是空的，补一份真的愿望清单 */
function renderWebList(list) {
  const host = $('#web-list');
  if (!host) return;
  host.textContent = '';
  list.slice().reverse().forEach(function (w) {
    const li = document.createElement('li');
    li.textContent = w.name + '：' + w.wish + '（' + relTime(w.ts) + '）';
    host.appendChild(li);
  });
}

function mountWeb() {
  if (!state.web) {
    state.web = new SilkWeb($('#web-canvas'), {
      onHover: showTip,
      onSelect: openScreening,
      onDwell: markRead,
      stateOf: stateOf
    });
    state.web.setWishes(filtered().slice(-220), stateOf);
  }
  state.web.resize();
  state.web.start();
  $('#web-empty').hidden = filtered().length > 0;
}

function showTip(wish, pos) {
  const tip = $('#web-tip');
  if (!wish) { tip.classList.remove('is-on'); return; }
  tip.textContent = '';
  const name = document.createElement('p');
  name.className = 'web-tip__name';
  name.textContent = 'A Wish By ' + wish.name;
  const body = document.createElement('p');
  body.className = 'web-tip__wish';
  body.textContent = wish.wish;
  const meta = document.createElement('p');
  meta.className = 'web-tip__meta';
  meta.textContent = relTime(wish.ts) + ' · ' + threadById(wish.mood).name + (wish.__private ? ' · 仅自己可见' : '');
  const silk = document.createElement('p');
  const st = silkOf(wish, state.effReads, state.mends);
  silk.className = 'web-tip__silk' + (st.id === 'loose' ? ' is-loose' : '');
  silk.textContent = st.name + ' · ' + st.line;
  tip.appendChild(name); tip.appendChild(body); tip.appendChild(meta); tip.appendChild(silk);
  tip.classList.add('is-on');
  const wrap = tip.parentElement.getBoundingClientRect();
  const x = Math.max(12, Math.min(pos.x + 18, wrap.width - tip.offsetWidth - 12));
  const y = Math.max(12, Math.min(pos.y + 14, wrap.height - tip.offsetHeight - 12));
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}


/* ------------------------------------------------------------ 回响
   把全站公开的愿望拆成词统计。仅自己可见的从来不上蛛网，也就不在这里。
   统计放在浏览器里做，所以永远是此刻最新的；愿望多了就分块算，不卡页面。 */
function echoSource() {
  return state.all.filter(function (w) {
    return w.id && !state.blocked.has(w.id) && !w.__private && String(w.wish || '').length;
  });
}

function ensureEchoes() {
  const src = echoSource();
  const version = src.length + ':' + state.blocked.size;
  if (state.echo.data && state.echo.version === version) { renderEchoes(); return; }
  if (state.echo.busy) return;
  state.echo.busy = true;
  const note = $('#echo-note');
  if (note) note.textContent = '正在把网上的话拆成词……';
  analyze(src, function (data) {
    state.echo.busy = false;
    state.echo.data = data;
    state.echo.version = version;
    renderEchoes();
  });
}

function echoTerms() {
  const data = state.echo.data;
  if (!data || !data.terms.length) return [];
  /* 只在词够多的时候才砍掉只出现一次的词；网小的时候一个词也算回声 */
  const many = data.terms.filter(function (t) { return t.count >= 2; }).length;
  const min = many >= 12 ? 2 : 1;
  return data.terms.filter(function (t) { return t.count >= min; });
}

function renderEchoList(terms) {
  const host = $('#echo-list');
  if (!host) return;
  host.textContent = '';
  const maxRatio = terms[0] ? terms[0].ratio : 1;
  terms.forEach(function (t, i) {
    const li = document.createElement('li');
    li.className = 'echo-row';
    const rank = document.createElement('span');
    rank.className = 'echo-row__rank';
    rank.textContent = String(i + 1).padStart(2, '0');
    const word = document.createElement('b');
    word.className = 'echo-row__word';
    word.textContent = t.word;
    const rule = document.createElement('i');
    rule.className = 'echo-row__rule';
    rule.style.setProperty('--r', Math.max(1.5, (t.ratio / (maxRatio || 1)) * 100).toFixed(1) + '%');
    const pct = document.createElement('span');
    pct.className = 'echo-row__pct';
    pct.textContent = ratioText(t.ratio);
    const count = document.createElement('span');
    count.className = 'echo-row__count';
    count.textContent = t.count + ' 次 · ' + t.wishes + ' 条愿望';
    li.appendChild(rank); li.appendChild(word); li.appendChild(rule); li.appendChild(pct); li.appendChild(count);
    host.appendChild(li);
  });
}

function renderEchoSr(terms) {
  const host = $('#echo-sr');
  if (!host) return;
  host.textContent = '';
  terms.forEach(function (t) {
    const li = document.createElement('li');
    li.textContent = t.word + '：' + t.count + ' 次，占 ' + ratioText(t.ratio) + '，出现在 ' + t.wishes + ' 条愿望里';
    host.appendChild(li);
  });
}

function renderEchoes() {
  const data = state.echo.data;
  const cloudWrap = $('#echo-cloud-wrap');
  const listWrap = $('#echo-list-wrap');
  const empty = $('#echo-empty');
  const note = $('#echo-note');
  if (!data) {
    if (cloudWrap) cloudWrap.hidden = false;
    if (listWrap) listWrap.hidden = true;
    if (empty) empty.hidden = true;
    if (note) note.textContent = '正在把网上的话拆成词……';
    return;
  }
  const terms = echoTerms();
  const enough = terms.length >= 4;
  if (empty) empty.hidden = enough;
  if (cloudWrap) cloudWrap.hidden = !enough || state.echo.view !== 'cloud';
  if (listWrap) listWrap.hidden = !enough || state.echo.view !== 'list';
  if (state.echo.view === 'cloud') {
    if (state.echo.cloud) {
      state.echo.cloud.setTerms(terms.slice(0, 90));
      state.echo.cloud.resize();
      state.echo.cloud.start();
    }
  } else if (state.echo.cloud) {
    state.echo.cloud.stop();
  }
  if (note) {
    note.textContent = enough
      ? '统计自 ' + data.wishes + ' 条公开愿望里的 ' + data.total + ' 个词次。仅自己可见的愿望不在里面；每条的署名与正文本来就是公开的，这里只是把它们拆开数一数。'
      : '网上的愿望还太少，回声还没有聚起来。';
  }
  renderEchoList(terms.slice(0, 80));
  renderEchoSr(terms.slice(0, 20));
}

function showEchoTip(term) {
  const tip = $('#echo-tip');
  if (!tip) return;
  if (!term) { tip.classList.remove('is-on'); return; }
  tip.textContent = term.word + ' · ' + term.count + ' 次 · 占 ' + ratioText(term.ratio) + ' · 出现在 ' + term.wishes + ' 条愿望里';
  tip.classList.add('is-on');
}

function setEchoView(view) {
  state.echo.view = view === 'list' ? 'list' : 'cloud';
  session('echoView', state.echo.view);
  $$('#echo-views .chip').forEach(function (c) { c.classList.toggle('is-on', c.dataset.echo === state.echo.view); });
  renderEchoes();
}

function mountEchoes() {
  if (!state.echo.cloud) {
    state.echo.cloud = new EchoCloud($('#echo-canvas'), { onHover: showEchoTip });
  }
  setEchoView(state.echo.view);
  ensureEchoes();
}

/* ------------------------------------------------------------ 查编号
   编号只认公开的愿望。「仅自己可见」的正文是密文，本站查不到 —— 界面上把这话说清楚，
   不做假承诺。自己写下的那条，在本机仍然翻得出来。 */
function findClose() {
  $('#find-out').hidden = true;
  $('#find-note').textContent = '';
  const input = $('#find-input');
  if (input) input.value = '';
  $('#web-wrap').hidden = false;
  if (state.web) { state.web.resize(); state.web.start(); }
}
function showFindNote(text) {
  $('#web-wrap').hidden = true;
  $('#find-out').hidden = false;
  $('#find-note').textContent = text;
}

/* 这里只认编号。按词看全站在说什么，是「回响」的事 */
function findRoute(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) { findClose(); return; }
  const code = normalizeCode(value);
  if (code) {
    const hit = lookupCode(code);
    if (!hit) {
      showFindNote('没有这个编号的公开愿望。仅自己可见的愿望是加密的，编号在这里查不到；自己写下的那条，在这台设备的「我写下的」里还在。');
      return;
    }
    findClose();
    openScreening(hit.wish, hit.priv ? PRIVATE_CODE_NOTE : null);
    return;
  }
  if (/^w_[A-Za-z0-9_]{4,40}$/.test(value)) {
    const hit = state.all.filter(function (w) { return w.id === value; })[0];
    if (hit) { findClose(); openScreening(hit); return; }
  }
  showFindNote('这里只认编号：七个字母或数字，写在每条愿望的揭幕页上。');
}

/* ------------------------------------------------------------ 全屏放映 */
/* 丝那一行会在「被读到」的瞬间改写自己 —— 不重开整张海报，免得跳 */
function refreshScreeningSilk() {
  const wish = state.screenWish;
  const node = $('#screening .screening__silk');
  if (!wish || !node) return;
  const st = silkOf(wish, state.effReads, state.mends);
  const count = readCount(wish, state.effReads);
  node.className = 'screening__silk' + (st.id === 'loose' ? ' is-loose' : '');
  node.textContent = '';
  const name = document.createElement('b');
  name.textContent = st.name;
  node.appendChild(name);
  node.appendChild(document.createTextNode(' · ' + st.line));
  if (count > 0) node.appendChild(document.createTextNode('（被读过 ' + count + ' 次）'));
  const mend = $('#screening .screening__mend');
  if (mend && st.id !== 'loose') mend.remove();
}

function openScreening(wish, note) {
  const inner = $('#screening-inner');
  inner.textContent = '';
  const fig = renderPoster(wish, { variant: 'screening' });
  fig.style.width = 'min(1100px, 90vw)';
  inner.appendChild(fig);
  requestAnimationFrame(function () { fitPoster(fig); });

  const credits = document.createElement('div');
  credits.className = 'reveal__credits';
  credits.style.borderTop = '0';
  credits.textContent = relTime(wish.ts) + ' · ' + fullDate(wish.ts) + ' ' + speakingTime(wish.ts) + ' · ' + threadById(wish.mood).name;
  inner.appendChild(credits);

  /* 丝现在是什么样子。说的是有没有人接住，不是愿望能不能实现 */
  const st = silkOf(wish, state.effReads, state.mends);
  state.screenWish = wish;
  const silk = document.createElement('p');
  silk.className = 'screening__silk';
  inner.appendChild(silk);
  refreshScreeningSilk();

  /* 编号：别人拿到它，就能在蛛网上翻到这张海报（仅限公开的） */
  if (!wish.shared && wish.id) {
    const row = document.createElement('p');
    row.className = 'screening__code';
    const label = document.createElement('span');
    label.textContent = '编号';
    const value = document.createElement('b');
    value.textContent = wishCode(wish.id);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn btn--quiet';
    copy.textContent = '复制';
    copy.addEventListener('click', function () { copyText(wishCode(wish.id), '编号 ' + wishCode(wish.id) + ' 已复制'); });
    row.appendChild(label); row.appendChild(value); row.appendChild(copy);
    inner.appendChild(row);
  }

  if (note) {
    const p = document.createElement('p');
    p.className = 'screening__note';
    p.textContent = note;
    inner.appendChild(p);
  }

  /* 自己写下的断丝，回来时能接上 */
  if (st.id === 'loose' && !wish.shared && isMine(wish.id)) {
    const box = document.createElement('div');
    box.className = 'screening__mend';
    const line = document.createElement('p');
    line.textContent = '这一缕还没有人接住。';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--quiet';
    btn.textContent = '把这条丝接上';
    btn.addEventListener('click', function () {
      if (!queueMend(wish.id)) { toast('这条丝已经接上了'); return; }
      state.mends[wish.id] = Date.now();
      flushMends();
      syncWeb();
      toast('丝接上了。它只保七天 —— 之后还得有人真的读到它。');
      openScreening(wish);
    });
    box.appendChild(line); box.appendChild(btn);
    inner.appendChild(box);
  }

  $('#screening').hidden = false;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(function () { fitPoster(fig); });

  /* 停下来读完它也算读过。触摸屏上的人不会「悬停」 */
  clearTimeout(state.screenTimer);
  state.screenTimer = setTimeout(function () { markRead(wish); }, 1500);
}

function closeScreening() {
  clearTimeout(state.screenTimer);
  state.screenTimer = 0;
  state.screenWish = null;
  $('#screening').hidden = true;
  document.body.style.overflow = '';
  if (location.hash.indexOf('#/w/') === 0) history.replaceState(null, '', '#/web');
}

/* ------------------------------------------------------------ 第二幕 */
function initThreads() {
  const row = $('#thread-picks');
  THREADS.forEach(function (t) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'thread-pick' + (t.id === state.mood ? ' is-on' : '');
    b.dataset.id = t.id;
    b.style.setProperty('--swatch', 'var(--' + t.id + ')');
    const dot = document.createElement('i');
    dot.setAttribute('aria-hidden', 'true');
    b.appendChild(dot);
    b.appendChild(document.createTextNode(t.name));
    const small = document.createElement('small');
    small.textContent = t.hue;
    b.appendChild(small);
    b.addEventListener('click', function () { pickThread(t.id); });
    row.appendChild(b);
  });
}

function pickVis(v) {
  state.vis = v === 'private' ? 'private' : 'public';
  session('vis', state.vis);
  $$('#vis-picks .vis-pick').forEach(function (b) {
    b.classList.toggle('is-on', b.dataset.vis === state.vis);
  });
  const note = $('#privacy-note');
  if (note) {
    note.textContent = '';
    if (state.vis === 'private') {
      note.appendChild(document.createTextNode('这条愿望会先用站点公钥在'));
      const b1 = document.createElement('b'); b1.textContent = '你的浏览器里加密';
      note.appendChild(b1);
      note.appendChild(document.createTextNode('，中转站和仓库里都只有密文，蛛网上也不会出现。只有持有放映室口令的人能解开它。仍会记录时间与语言、时区这类基础信息，同样加密。'));
    } else {
      const b1 = document.createElement('b'); b1.textContent = '蛛网是公开的';
      note.appendChild(b1);
      note.appendChild(document.createTextNode('：你的署名和这条愿望，所有人都能在蛛网上读到。'));
      const br = document.createElement('br'); note.appendChild(br);
      note.appendChild(document.createTextNode('除此之外还会记录写下的时间，以及语言、时区、设备、来源这类基础信息——这些在离开你的浏览器之前就已经加密，中转站和仓库里都只有密文，只有持有后台口令的人才解得开。不收集 IP，不做定位。'));
    }
  }
  if (state.last) state.last.vis = state.vis;
}

function pickThread(id) {
  state.mood = id;
  document.documentElement.dataset.thread = id;
  $$('#thread-picks .thread-pick').forEach(function (b) {
    b.classList.toggle('is-on', b.dataset.id === id);
  });
  $('#poster-preview').dataset.thread = id;
  $('#poster-thread-name').textContent = threadById(id).name + ' · ' + threadById(id).en;
  session('mood', id);
}

function paintPoster() {
  const name = state.name.trim() || '佚名';
  const wish = state.wish.trim() || '愿……';
  const title = $('#poster-title');
  title.textContent = wish;
  title.classList.toggle('is-latin', !/[\u3400-\u9fff\u3040-\u30ff]/.test(wish));
  $('#poster-reflect-text').textContent = wish;
  $('#poster-name').textContent = name;
  $('#poster-sub').textContent = '"spoken at ' + speakingTime(state.last && state.last.ts) + ', ' + fullDate(state.last && state.last.ts) + '"';
  document.documentElement.dataset.thread = state.mood;
  $('#poster-preview').dataset.thread = state.mood;
  $('#poster-thread-name').textContent = threadById(state.mood).name + ' · ' + threadById(state.mood).en;
  $('#wish-author').textContent = name;
  const fig = $('#poster-preview');
  fig.classList.add('is-fitting');
  fitPoster(fig);
  requestAnimationFrame(function () { fig.classList.remove('is-fitting'); });
}

function updateWishState() {
  const v = $('#wish-input').value;
  state.wish = v;
  session('wish', v);
  const n = v.length;
  const counter = $('#wish-count');
  counter.textContent = n + ' / 160';
  counter.classList.toggle('is-over', n > 150);
  $('#submit-wish').disabled = state.name.trim().length === 0 || v.trim().length < 2;
  paintPoster();
}

function updateNameState() {
  const v = $('#name-input').value;
  state.name = v;
  session('name', v);
  $('#cast-preview').textContent = v.trim() || '—';
  $('#to-wish').disabled = v.trim().length === 0;
  $('#wish-author').textContent = v.trim() || '—';
  paintPoster();
}

/* ------------------------------------------------------------ 第三幕 */
function renderReveal(rec) {
  mountPoster($('#reveal-poster'), rec, { variant: 'hero' });
  const isPrivate = rec.vis === 'private';
  const credits = $('#reveal-credits');
  credits.textContent = '';
  const rows = [
    ['Cast', rec.name],
    ['Thread', threadById(rec.mood).name],
    ['Spoken At', speakingTime(rec.ts)],
    ['Date', fullDate(rec.ts)],
    ['Visibility', isPrivate ? '仅自己可见' : '公开']
  ];
  const note = $('#reveal-note');
  if (note) note.hidden = !isPrivate;
  const sharePanel = $('#reveal-share');
  if (sharePanel) sharePanel.hidden = isPrivate;
  if (!isPrivate) renderShare(rec);
  const line = $('#reveal-title');
  if (line) line.textContent = isPrivate ? '你的愿望，已经加密收好了。' : '你的愿望，已经挂上蛛丝。';
  const codeValue = $('#reveal-code-value');
  if (codeValue) codeValue.textContent = wishCode(rec.id);
  const codeHint = $('#reveal-code-hint');
  if (codeHint) codeHint.textContent = isPrivate
    ? '仅自己可见的愿望是加密的，别人拿这个编号查不到它。它只留在这台设备的「我写下的」里。'
    : '把这个编号留给想让他看见的人。他在蛛网上输入它，就能翻到这一张海报。';
  rows.forEach(function (r) {
    const span = document.createElement('span');
    span.textContent = r[0] + ' ';
    const b = document.createElement('b');
    b.textContent = r[1];
    span.appendChild(b);
    credits.appendChild(span);
  });
  const stage = $('.reveal__stage');
  const clone = stage.innerHTML;
  stage.innerHTML = clone;
}

async function submit() {
  if (state.submitting) return;
  const name = state.name.trim().slice(0, 24);
  const wish = state.wish.trim().slice(0, 160);
  const isPrivate = state.vis === 'private';
  const err = $('#wish-error');
  const btn = $('#submit-wish');

  const left = cooldownLeft(cooldownHours());
  if (left > 0) { applyCooldown(); toast('丝还没有落定，再过 ' + formatLeft(left) + '。'); return; }

  if (!name) { err.textContent = '还没有署名。'; go('#/cast'); return; }
  if (wish.length < 2) { err.textContent = '愿望太短了，再写一句吧。'; return; }

  /* 蜜罐：真人看不见这个输入框，填了就是机器人 */
  const hp = $('#hp');
  if (hp && hp.value) { err.textContent = '提交被拦下了。'; return; }

  const reason = screenText(name, wish);
  if (reason) { err.textContent = reason; return; }
  err.textContent = '';

  /* 太快填完的当机器人 —— 真人不会被卡，等一下就好 */
  const elapsed = Date.now() - (state.wishShownAt || Date.now());
  if (elapsed < 2400) await sleep(2400 - elapsed);

  state.submitting = true;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = '正在系上这条丝…';

  const ts = Date.now();
  const rec = { id: newId(), name: name, wish: wish, mood: state.mood, ts: ts, vis: isPrivate ? 'private' : 'public' };

  /* 基础信息在离开浏览器之前就密封好，中转站上只有密文 */
  const env = await seal(Object.assign(deviceInfo(), { src: 'web', n: state.visit }));

  /* 「仅自己可见」时，正文也用同一套信封加密；中转站与仓库里都没有明文 */
  let prv = null;
  if (isPrivate) {
    prv = await seal({ name: name, wish: wish, mood: state.mood, ts: ts });
    if (!prv) {
      err.textContent = '这条没法加密，先别提交。刷新一下页面再试。';
      btn.textContent = label; btn.disabled = false; state.submitting = false;
      return;
    }
  }

  const proof = await mineProof(rec.id, null, function (n) {
    btn.textContent = '正在系上这条丝… ' + Math.round(n / 1000) + 'k';
  });

  const payload = isPrivate
    ? { id: rec.id, vis: 'private', prv: prv, pow: proof.pow, hp: '', ft: Date.now() - (state.wishShownAt || Date.now()), env: env }
    : { id: rec.id, vis: 'public', name: name, wish: wish, mood: state.mood, ts: ts, pow: proof.pow, hp: '', ft: Date.now() - (state.wishShownAt || Date.now()), env: env };

  btn.textContent = label;
  state.submitting = false;
  btn.disabled = wish.length < 2;

  state.last = rec;
  remember(rec);
  state.mine = myWishes();
  /* 草稿已经冲印成海报了，别把它留在框里等着被再发一次 */
  state.wish = '';
  session('wish', '');
  const wishBox = $('#wish-input');
  if (wishBox) { wishBox.value = ''; wishBox.style.height = 'auto'; }
  updateWishState();
  markWrite(ts);        /* 从这里开始算冷却 */
  applyCooldown();
  if (!isPrivate) {
    state.seen.add(rec.id);
    state.all = merge(state.all, [rec]);
  }
  counts();
  if (state.web) state.web.markBorn(rec.id);
  syncWeb();

  go('#/reveal');
  setTimeout(function () { window.scrollTo({ top: 0, behavior: 'auto' }); }, 0);

  try {
    await publish(payload);
    trackDelivered(payload);
    pokeArchive(true);   /* 用户亲手提交的这一次，永远要叫 */
    toast(isPrivate ? '已加密收好，只有你能看到' : '愿望已挂上蛛丝');
  } catch (e) {
    queuePending(payload);
    toast('网络不太稳，先替你存在本机，稍后自动补发');
  }
}

/* ------------------------------------------------------------ 递出去
   三种形式（链接 / 二维码 / 编号），一天只递一次。
   这道闸只在本机：编号本来就印在揭幕页上，它是个仪式，不是门锁。 */
const SHARE_HOURS = 24;

function shareUrl(rec) {
  return location.origin + location.pathname + '#/w/' + encodeShare(rec);
}
/* 二维码里放短的那个：编号链接。手机扫开一样是这张海报，
   而且小得多、好扫得多 —— 长链接（一百多个字那种）二维码会挤成一团。 */
function qrTarget(rec) {
  return location.origin + location.pathname + '#/w/' + wishCode(rec.id);
}
function shareLeft() {
  const last = shareAt();
  if (!last) return 0;
  return Math.max(0, SHARE_HOURS * 3600e3 - (Date.now() - last));
}
/* 「递出去」= 复制走链接或编号。二维码只是亮在这儿给人扫，
   没有一个「被扫了」的事件可以数，所以不拿它当消耗。 */
function consumeShare() { markShareAt(Date.now()); }

function renderShare(rec) {
  const panel = $('#reveal-share');
  if (!panel) return;
  rec = rec || state.last;
  if (!rec) return;
  const left = shareLeft();
  const locked = left > 0;
  const tabs = $('#share-tabs');
  const rest = $('#share-rest');
  if (tabs) tabs.hidden = locked;
  if (rest) rest.hidden = !locked;
  $$('.share__pane').forEach(function (pane) {
    pane.hidden = locked || pane.id !== 'share-pane-' + state.share;
  });
  if (locked) {
    const el = $('#share-left');
    if (el) el.textContent = formatLeft(left);
    ensureShareClock();
    return;
  }
  $$('#share-tabs .chip').forEach(function (c) { c.classList.toggle('is-on', c.dataset.share === state.share); });
  const link = $('#share-link-value');
  if (link) {
    const url = shareUrl(rec);
    /* 长链接在屏幕上只给一眼，复制走的是完整的那条 */
    link.textContent = url.length > 64 ? url.slice(0, 61) + '…' : url;
    link.title = url;
  }
  const code = $('#share-code-value');
  if (code) code.textContent = wishCode(rec.id);
  if (state.share === 'qr') {
    const canvas = $('#share-qr');
    if (canvas) {
      try {
        drawQR(canvas, qrTarget(rec), { size: 168, dark: '#20313a', light: '#ffffff' });
      } catch (e) {
        const hint = panel.querySelector('#share-pane-qr .share__hint');
        if (hint) hint.textContent = '这一段太长，二维码放不下。用链接吧。';
      }
    }
  }
}

function setShareTab(tab) {
  state.share = tab === 'qr' || tab === 'code' ? tab : 'link';
  renderShare();
}

function ensureShareClock() {
  if (state.shareTimer) return;
  state.shareTimer = setInterval(function () {
    if (currentView !== 'reveal') { clearInterval(state.shareTimer); state.shareTimer = 0; return; }
    const el = $('#share-left');
    if (el) el.textContent = formatLeft(shareLeft());
    if (shareLeft() <= 0) { clearInterval(state.shareTimer); state.shareTimer = 0; renderShare(); }
  }, 1000);
}

async function copyShareLink() {
  const rec = state.last;
  if (!rec || rec.vis === 'private') return;
  const url = shareUrl(rec);
  const first = shareLeft() <= 0;
  await copyText(url, first ? '链接已复制，可以发给人了。今天这一次用完了。' : '链接已复制，可以发给人了');
  if (first) consumeShare();
  renderShare();
}

async function copyShareCode() {
  const rec = state.last;
  if (!rec) return;
  const code = wishCode(rec.id);
  const first = shareLeft() <= 0;
  await copyText(code, first ? '编号 ' + code + ' 已复制。今天这一次用完了。' : '编号 ' + code + ' 已复制');
  if (first) consumeShare();
  renderShare();
}

/* ------------------------------------------------------------ 启动 */
function bind() {
  $('#name-input').addEventListener('input', updateNameState);
  $('#name-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); if (!$('#to-wish').disabled) go('#/wish'); }
  });
  $('#to-wish').addEventListener('click', function () { go('#/wish'); });

  const wishInput = $('#wish-input');
  wishInput.addEventListener('input', function () {
    wishInput.style.height = 'auto';
    wishInput.style.height = Math.min(wishInput.scrollHeight, window.innerHeight * 0.4) + 'px';
    updateWishState();
  });
  wishInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!$('#submit-wish').disabled) submit(); }
  });
  $('#submit-wish').addEventListener('click', submit);
  const shareTabs = $('#share-tabs');
  if (shareTabs) shareTabs.addEventListener('click', function (e) {
    const btn = e.target.closest('.chip');
    if (btn) setShareTab(btn.dataset.share);
  });
  const shareLink = $('#share-copy-link');
  if (shareLink) shareLink.addEventListener('click', copyShareLink);
  const shareCode = $('#share-copy-code');
  if (shareCode) shareCode.addEventListener('click', copyShareCode);
  $('#vis-picks').addEventListener('click', function (e) {
    const btn = e.target.closest('.vis-pick');
    if (btn) pickVis(btn.dataset.vis);
  });

  $('#web-filters').addEventListener('click', function (e) {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    $$('#web-filters .chip').forEach(function (c) { c.classList.toggle('is-on', c === btn); });
    counts();
    syncWeb();
  });

  $('#screening-close').addEventListener('click', closeScreening);
  $('#screening').addEventListener('click', function (e) { if (e.target === $('#screening')) closeScreening(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('#find-out').hidden) { findClose(); return; }
    closeScreening();
  });

  const findForm = $('#find-form');
  if (findForm) findForm.addEventListener('submit', function (e) { e.preventDefault(); findRoute($('#find-input').value); });
  const findClear = $('#find-clear');
  if (findClear) findClear.addEventListener('click', findClose);
  const echoViews = $('#echo-views');
  if (echoViews) echoViews.addEventListener('click', function (e) {
    const btn = e.target.closest('.chip');
    if (btn) setEchoView(btn.dataset.echo);
  });
  const navFind = $('#nav-find');
  if (navFind) navFind.addEventListener('click', function () {
    const input = $('#find-input');
    if (input) setTimeout(function () { input.focus(); }, 320);
  });


  window.addEventListener('hashchange', render);
  window.addEventListener('resize', function () {
    if (currentView === 'wish') { fitPoster($('#poster-preview')); }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { pokeIfPending(); tick(); } });
}

async function boot() {
  await loadConfig();
  await loadModeration();
  const reads = await loadReads();
  state.reads = Object.assign({}, reads.reads);
  state.mends = Object.assign({}, reads.mends);
  refreshSilk();
  state.visit = visitCount();

  state.name = session('name') || '';
  state.wish = session('wish') || '';
  state.mood = session('mood') || 'silk';
  state.echo.view = session('echoView') || 'cloud';
  $('#name-input').value = state.name;
  $('#wish-input').value = state.wish;
  if (state.wish) { $('#wish-input').style.height = 'auto'; $('#wish-input').style.height = Math.min($('#wish-input').scrollHeight, window.innerHeight * 0.4) + 'px'; }

  initThreads();
  pickThread(state.mood);
  pickVis(session('vis') || 'public');
  state.mine = myWishes();
  updateNameState();
  updateWishState();
  paintPoster();
  bind();

  render();

  /* 中文宋体（Noto Serif SC）：体积太大，运行时按 Google → loli → geekzu 依次试，
     三个都不通就退到系统宋体栈（assets/js/fonts.js；--font-cjk 的第一位就是它）。
     这里**不 await**：字体晚到不该把页面卡在路上，换字那一下是这套设计接受的成本。
     之前这行是漏掉的 —— 公开站只 import 了没调用，所以前台中文一直走的是系统宋体。 */
  loadFonts().catch(function () {});

  try {
    await loadAll();
  } catch (e) {
    counts(); /* 数据层出问题也不能让页面停在半路 */
  }
  /* 归档确认：GitHub 的定时任务可能延迟甚至根本不跑，本机替它兜一层。
     公开愿望看 wishes.jsonl，私密愿望看 vault.jsonl（只暴露 id）。 */
  const known = new Set(state.all.map(function (w) { return w.id; }));
  Promise.all([loadVaultIds(), loadQueueIds()]).then(function (lists) {
    lists.forEach(function (ids) { ids.forEach(function (id) { known.add(id); }); });
    state.known = known;
    return flushPending(known);
  }).then(function (n) {
    if (n) toast('补发了 ' + n + ' 条还没归档的愿望');
    pokeIfPending();
  }).catch(function () {});
  state.booted = true;
  if (state.pendingCode) { openByCode(state.pendingCode); state.pendingCode = ''; }
  flushReads().catch(function () {});
  flushMends().catch(function () {});

  setInterval(tick, 15000);
  setInterval(function () { flushReads().catch(function () {}); flushMends().catch(function () {}); }, 5 * 60 * 1000);
  window.__yixian = state; /* 调试与自动化用 */
}

boot();

/* 暴露给后台复用 */
export { state, filtered, toast };
