/* 一线千愿 —— 放映流程 */
import { loadFonts } from './fonts.js';
import { THREADS, threadById } from './config.js';
import {
  loadConfig, loadArchive, loadBlocked, loadModeration, poll, publish, merge, deviceInfo, visitCount,
  newId, remember, myWishes, isMine, queuePending, flushPending, trackDelivered, loadVaultIds,
  encodeShare, decodeShare, config, screenText, mineProof, seal
} from './store.js';
import { renderPoster, fitPoster, speakingTime, fullDate, relTime, mountPoster } from './poster.js';
import { SilkWeb } from './web.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel));

const state = {
  name: '', wish: '', mood: 'silk',
  all: [], cursor: 0, seen: new Set(), blocked: new Set(),
  last: null, filter: 'all', visit: 1, web: null, booted: false,
  wishShownAt: 0, submitting: false, vis: 'public', mine: []
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
const VIEWS = ['hero', 'cast', 'wish', 'reveal', 'web', 'about'];
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

  if (route.view === 'reveal') {
    if (!state.last) { go('#/cast'); return; }
    renderReveal(state.last);
  }
  if (route.share) {
    const shared = decodeShare(route.share);
    if (shared) { document.documentElement.dataset.thread = shared.mood; openScreening(shared); }
    else toast('这个链接读不出来了');
  }
  if (route.view === 'cast') { setTimeout(function () { $('#name-input').focus(); }, 240); }
  if (route.view === 'wish') { setTimeout(function () { $('#wish-input').focus(); }, 240); }
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
  if (animate && state.web) fresh.forEach(function (w) { state.web.markBorn(w.id); });
  counts();
  syncWeb();
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

async function tick() {
  if (document.hidden) return;
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
  state.web.setWishes(list);
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
      onSelect: openScreening
    });
    state.web.setWishes(filtered().slice(-220));
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
  tip.appendChild(name); tip.appendChild(body); tip.appendChild(meta);
  tip.classList.add('is-on');
  const wrap = tip.parentElement.getBoundingClientRect();
  const x = Math.max(12, Math.min(pos.x + 18, wrap.width - tip.offsetWidth - 12));
  const y = Math.max(12, Math.min(pos.y + 14, wrap.height - tip.offsetHeight - 12));
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}

/* ------------------------------------------------------------ 全屏放映 */
function openScreening(wish) {
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
  $('#screening').hidden = false;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(function () { fitPoster(fig); });
}

function closeScreening() {
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
  const copyBtn = $('#copy-link');
  if (copyBtn) copyBtn.hidden = isPrivate;
  const note = $('#reveal-note');
  if (note) note.hidden = !isPrivate;
  const line = $('#reveal-title');
  if (line) line.textContent = isPrivate ? '你的愿望，已经加密收好了。' : '你的愿望，已经挂上蛛丝。';
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
    toast(isPrivate ? '已加密收好，只有你能看到' : '愿望已挂上蛛丝');
  } catch (e) {
    queuePending(payload);
    toast('网络不太稳，先替你存在本机，稍后自动补发');
  }
}

/* ------------------------------------------------------------ 分享 */
async function copyLink() {
  const rec = state.last;
  if (!rec) return;
  if (rec.vis === 'private') { toast('这条愿望没有公开，也就没有可分享的链接'); return; }
  const url = location.origin + location.pathname + '#/w/' + encodeShare(rec);
  try {
    await navigator.clipboard.writeText(url);
    toast('链接已复制，可以发给人了');
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('链接已复制'); }
    catch (e2) { toast('复制失败，链接是：' + url); }
    document.body.removeChild(ta);
  }
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
  $('#copy-link').addEventListener('click', copyLink);
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
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeScreening(); });

  window.addEventListener('hashchange', render);
  window.addEventListener('resize', function () {
    if (currentView === 'wish') { fitPoster($('#poster-preview')); }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
}

async function boot() {
  await loadConfig();
  await loadModeration();
  state.visit = visitCount();

  state.name = session('name') || '';
  state.wish = session('wish') || '';
  state.mood = session('mood') || 'silk';
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

  try {
    await loadAll();
  } catch (e) {
    counts(); /* 数据层出问题也不能让页面停在半路 */
  }
  /* 归档确认：GitHub 的定时任务可能延迟甚至根本不跑，本机替它兜一层。
     公开愿望看 wishes.jsonl，私密愿望看 vault.jsonl（只暴露 id）。 */
  const known = new Set(state.all.map(function (w) { return w.id; }));
  loadVaultIds().then(function (ids) {
    ids.forEach(function (id) { known.add(id); });
    return flushPending(known);
  }).then(function (n) {
    if (n) toast('补发了 ' + n + ' 条还没归档的愿望');
  }).catch(function () {});
  state.booted = true;

  setInterval(tick, 15000);
  window.__yixian = state; /* 调试与自动化用 */
}

boot();

/* 暴露给后台复用 */
export { state, filtered, toast };
