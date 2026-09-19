/* 数据层 —— 中转站写入、归档读取、本机兜底 */
import { FALLBACK } from './config.js';
import { sha256Hex } from '../../shared/sha256.js';
import { sealForSite } from '../../shared/envelope.js';

const K = {
  mine:   'yixian.mine.v1',
  device: 'yixian.device.v1',
  visits: 'yixian.visits.v1',
  pending:'yixian.pending.v1',
  reads:  'yixian.reads.v1',    /* 这台设备读过的露珠，以及还没发出去的批次 */
  mends:  'yixian.mends.v1',    /* 自己接上的断丝 */
  write:  'yixian.lastwrite.v1', /* 上一次写下愿望的时刻，冷却用 */
  share:  'yixian.shared.v1',    /* 上一次把愿望递出去的时刻，一天只递一次 */
  given:  'yixian.readgiven.v1'  /* 上一次把「那一次被读」给了谁，一天只给一条 */
};

/* 一个只存在这台设备上的随机编号，用来在后台区分“独立设备” */
function deviceId() {
  let id = read(K.device, null);
  if (!id) {
    const bytes = new Uint8Array(6);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(bytes) : bytes.forEach(function (_, i) { bytes[i] = Math.floor(Math.random() * 256); });
    id = 'd_' + Array.prototype.map.call(bytes, function (b) { return b.toString(36).padStart(2, '0'); }).join('');
    write(K.device, id);
  }
  return id;
}

let cfg = Object.assign({}, FALLBACK);

export function config() { return cfg; }

export async function loadConfig() {
  try {
    const r = await fetch('data/config.json', { cache: 'no-cache' });
    if (r.ok) cfg = Object.assign(cfg, await r.json());
  } catch (e) { /* 离线：用 FALLBACK */ }
  return cfg;
}

function endpoint() { return (cfg.endpoint || FALLBACK.endpoint).replace(/\/+$/, ''); }
function relay() { return endpoint() + '/' + encodeURIComponent(cfg.topic) + '/json'; }

/* ---------------------------------------------------------- 本机记录 */
function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch (e) { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

export function myWishes() { return read(K.mine, []); }
export function isMine(id) { return myWishes().some(function (w) { return w.id === id; }); }
export function remember(rec) {
  const list = myWishes().filter(function (w) { return w.id !== rec.id; });
  list.unshift(rec);
  write(K.mine, list.slice(0, 200));
}
export function forget(id) { write(K.mine, myWishes().filter(function (w) { return w.id !== id; })); }

/* ---------------------------------------------------------- 冷却
   一次许愿之后，要等一段时间才能写第二条。时间由 data/moderation.json 的
   rate.cooldownHours 决定（前端与采集器读同一份）。前端拦的是体验，
   采集器那一侧还会按设备再拦一次 —— 清掉 localStorage 也绕不过去。 */
export function lastWriteAt() {
  const v = read(K.write, 0);
  return Number(v) || 0;
}
export function markWrite(ts) {
  write(K.write, Number(ts) || Date.now());
}
/* ---------------------------------------------------------- 递出去
   「一个人一天只有一次机会」只在本机记着 —— 它是个仪式，不是门锁：
   编号本来就印在揭幕页上，谁也拦不住你念给别人听。 */
export function shareAt() { return Number(read(K.share, 0)) || 0; }
export function markShareAt(ts) { write(K.share, Number(ts) || Date.now()); }

export function cooldownLeft(hours) {
  const h = Number(hours);
  if (!(h > 0)) return 0;
  const last = lastWriteAt();
  if (!last) return 0;
  return Math.max(0, h * 3600e3 - (Date.now() - last));
}

/* ---------------------------------------------------------- 被读计数
   露珠被注视超过一会儿，就在本机记一次。同一台设备对同一条只记一次，
   攒着下次访问时一批发出去。去向是中转站，采集器把它聚合成 data/reads.json。 */
function readLedger() {
  const s = read(K.reads, null);
  if (!s || typeof s !== 'object') return { done: {}, queue: [] };
  s.done = s.done && typeof s.done === 'object' ? s.done : {};
  s.queue = Array.isArray(s.queue) ? s.queue : [];
  return s;
}

export function localReads() { return readLedger().done; }

/* 「一个人一天只有一次机会」：24 小时里只给出一条「被读」，
   给出去的那一条才计数。和「同一条本机只记一次」叠在一起，
   于是同一台设备对同一条愿望一辈子也只算一次。 */
export function readGivenAt() { return Number(read(K.given, 0)) || 0; }
export function markReadGiven(ts) { write(K.given, Number(ts) || Date.now()); }

const readAt = function (v) { return typeof v === 'number' ? v : (v && v.t) || 0; };

/* base = 记下这一票时服务端已经有多少次。
   采集器收下这一票之后，服务端就会多一次，从那以后本机不再补这一票，
   免得同一次被数两遍。 */
export function trackRead(id, base) {
  if (!id) return false;
  const s = readLedger();
  if (s.done[id]) return false;
  s.done[id] = { t: Date.now(), base: Number(base) || 0 };
  if (s.queue.indexOf(id) < 0) s.queue.push(id);
  const ids = Object.keys(s.done);
  if (ids.length > 4000) {
    ids.sort(function (a, b) { return readAt(s.done[a]) - readAt(s.done[b]); })
       .slice(0, ids.length - 4000)
       .forEach(function (k) { delete s.done[k]; });
  }
  write(K.reads, s);
  return true;
}

/* 一票「被读」不直接投中转站，而是打自己的函数：
   它当场认出这台设备（签名 cookie）、把出口网算成当天的代号，再带签名转发。
   函数不可用（本地静态托管、没配密钥）时不回退直投 —— 没签名的读不该计数。 */
export async function flushReads() {
  const s = readLedger();
  if (!s.queue.length) return 0;
  const url = cfg.readUrl || FALLBACK.readUrl;
  if (!url) return 0;
  const batch = s.queue.slice(0, 20);
  const env = await seal(deviceInfo());
  /* 每条读消息也要挖一个证明：脚本化灌水的成本就上去了。
     证明是绑在这一串 id 上的，函数转发时不改它们。 */
  const bits = Number((moderation() || {}).readProofOfWork) || (cfg.proofOfWork && cfg.proofOfWork.difficulty) || 4;
  const proof = await mineProof('yixian-read:' + batch.join(','), bits);
  let ok = false;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: batch, env: env, pow: proof.pow })
    });
    ok = r.ok;
  } catch (e) { ok = false; }
  if (!ok) return 0;
  const sent = new Set(batch);
  s.queue = s.queue.filter(function (id) { return !sent.has(id); });
  write(K.reads, s);
  return batch.length;
}

/* ---------------------------------------------------------- 续丝
   「自己回来能把断丝接上」，接上只保七天。
   所以这里不设「一辈子只能接一次」的闸：断的时候想接就接。 */
function mendLedger() {
  const m = read(K.mends, null);
  if (!m || typeof m !== 'object') return { done: {}, pending: [] };
  m.done = m.done && typeof m.done === 'object' ? m.done : {};
  m.pending = Array.isArray(m.pending) ? m.pending : [];
  return m;
}

export function localMends() { return mendLedger().done; }

export function queueMend(id) {
  if (!id) return false;
  const m = mendLedger();
  m.done[id] = Date.now();
  if (m.pending.indexOf(id) < 0) m.pending.push(id);
  write(K.mends, m);
  return true;
}

export async function flushMends() {
  const m = mendLedger();
  if (!m.pending.length) return 0;
  const env = await seal(deviceInfo());
  const rest = [];
  let sent = 0;
  const batch = m.pending.slice(0, 20);
  for (let i = 0; i < batch.length; i++) {
    try { await publish({ t: 'mend', id: batch[i], at: Date.now(), env: env }); sent++; }
    catch (e) { rest.push(batch[i]); }
  }
  m.pending = rest;
  write(K.mends, m);
  return sent;
}

/* ---------------------------------------------------------- 可靠投递
   中转站只保留 12 小时，而 GitHub 的定时任务只是"尽力而为"（可能延迟甚至不跑）。
   所以每条愿望在本机留一份：下次打开页面时，如果它还没出现在归档里，就再投一次。
   采集器按 id 去重，重复投递不会产生重复愿望。 */
function putPending(item) {
  const list = read(K.pending, []).filter(function (x) { return x.id !== item.id; });
  list.push(item);
  write(K.pending, list.slice(-60));
}

export function queuePending(payload) {
  putPending({ id: payload.id, payload: payload, at: Date.now(), tries: 0, delivered: false });
}

export function trackDelivered(payload) {
  putPending({ id: payload.id, payload: payload, at: Date.now(), tries: 0, delivered: true });
}

export function pending() { return read(K.pending, []); }

/* 私密愿望在 vault.jsonl 里只暴露 id，客户端可以借此确认它到底归档了没有 */
export async function loadVaultIds() {
  try {
    const r = await fetch('data/private/vault.jsonl', { cache: 'no-cache' });
    if (!r.ok) return [];
    const text = await r.text();
    const out = [];
    text.split('\n').forEach(function (line) {
      if (!line.trim()) return;
      try { out.push(JSON.parse(line).id); } catch (e) {}
    });
    return out;
  } catch (e) { return []; }
}

/* 叫醒归档：浏览器里不能放 GitHub 令牌，所以只打我们自己的 Vercel 函数，
   由它带着令牌去 dispatch GitHub Actions。没有配置 pokeUrl 就静默跳过。 */
const POKE_KEY = 'yixian.poked.v1';
const POKE_COUNT = 'yixian.pokecount.v1';
const POKE_MIN_GAP = 20 * 1000;   /* 轮询重试的最小间隔 */
const POKE_MAX_PER_SESSION = 40;  /* 轮询重试的防呆上限 */

/* force=true 用于「用户刚亲手提交了一条愿望」—— 这一次永远不能被前端省掉，
   否则浏览器一关，重试循环就没了，那条愿望要等下一次别的触发。
   force=false 用于后台轮询重试，受最小间隔约束。 */
export async function pokeArchive(force) {
  const url = cfg.pokeUrl || FALLBACK.pokeUrl;
  if (!url) return false;
  try {
    const last = Number(sessionStorage.getItem(POKE_KEY) || 0);
    if (!force && Date.now() - last < POKE_MIN_GAP) return false;
    const n = Number(sessionStorage.getItem(POKE_COUNT) || 0);
    if (!force && n >= POKE_MAX_PER_SESSION) return false;
    sessionStorage.setItem(POKE_KEY, String(Date.now()));
    sessionStorage.setItem(POKE_COUNT, String(n + 1));
  } catch (e) {}
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    return r.ok;
  } catch (e) { return false; }
}

/* 被隔离待审的愿望也会出现在 queue.jsonl 里（只暴露 id），
   客户端认出它们之后就不会再无休止地重投。 */
export async function loadQueueIds() {
  try {
    const r = await fetch('data/queue.jsonl', { cache: 'no-cache' });
    if (!r.ok) return [];
    const text = await r.text();
    const out = [];
    text.split('\n').forEach(function (line) {
      if (!line.trim()) return;
      try { out.push(JSON.parse(line).id); } catch (e) {}
    });
    return out;
  } catch (e) { return []; }
}

const RESEND_AFTER = 3 * 60 * 1000;   /* 未确认归档就每 3 分钟再投一次，永不放弃 */
const MAX_PER_VISIT = 5;               /* 一次访问最多补投 5 条，别把访客的网刷爆 */

export async function flushPending(knownIds) {
  const list = read(K.pending, []);
  const keep = [];
  let sent = 0;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (knownIds && knownIds.has(item.id)) continue;   /* 已确认落进归档，不用再管 */
    if (item.delivered && Date.now() - item.at < RESEND_AFTER) { keep.push(item); continue; }
    if (sent >= MAX_PER_VISIT) { keep.push(item); continue; }
    try {
      await publish(item.payload);
      sent++;
      keep.push({ id: item.id, payload: item.payload, at: Date.now(), tries: (item.tries || 0) + 1, delivered: true });
    } catch (e) {
      keep.push(item);           /* 网络不通就留着，下次再说 */
    }
  }
  write(K.pending, keep);
  return sent;
}

/* ---------------------------------------------------------- 基础信息 */
function parseUA(ua) {
  let browser = 'Unknown';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  let os = 'Unknown';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  return browser + ' on ' + os;
}

export function deviceInfo() {
  let tz = '', lg = navigator.language || '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  let ref = 'direct';
  try { if (document.referrer) ref = new URL(document.referrer).host || 'direct'; } catch (e) {}
  return {
    tz: tz,
    lg: lg,
    ua: parseUA(navigator.userAgent || ''),
    vp: window.innerWidth + 'x' + window.innerHeight,
    ref: ref,
    dv: deviceId()
  };
}

export function visitCount() {
  const n = (read(K.visits, 0) || 0) + 1;
  write(K.visits, n);
  return n;
}

export function newId() {
  const t = Date.now().toString(36);
  let r = '';
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  for (let i = 0; i < 6; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return 'w_' + t + '_' + r;
}

/* ---------------------------------------------------------- 归档 */
let archiveCache = null;

export async function loadArchive(force) {
  if (archiveCache && !force) return archiveCache;
  try {
    const r = await fetch('data/wishes.jsonl', { cache: 'no-cache' });
    if (!r.ok) throw new Error('archive ' + r.status);
    const text = await r.text();
    const out = [];
    text.split('\n').forEach(function (line) {
      if (!line.trim()) return;
      try { out.push(JSON.parse(line)); } catch (e) {}
    });
    archiveCache = out;
    return out;
  } catch (e) {
    archiveCache = archiveCache || [];
    return archiveCache;
  }
}

/* ---------------------------------------------------------- 屏蔽名单 */
let blockedCache = null;

export async function loadBlocked() {
  if (blockedCache) return blockedCache;
  try {
    const r = await fetch('data/blocked.json', { cache: 'no-cache' });
    blockedCache = r.ok ? await r.json() : [];
    if (!Array.isArray(blockedCache)) blockedCache = [];
  } catch (e) { blockedCache = blockedCache || []; }
  return blockedCache;
}


/* ---------------------------------------------------------- 丝的命数
   采集器把大家报上来的「被读」聚合成 data/reads.json。它只是 id 与次数，
   没有新的隐私：id 本来就公开在 wishes.jsonl 里。 */
let readsCache = null;

export async function loadReads() {
  if (readsCache) return readsCache;
  readsCache = { reads: {}, mends: {}, updated: null };
  try {
    const r = await fetch('data/reads.json', { cache: 'no-cache' });
    if (r.ok) {
      const d = await r.json();
      readsCache = {
        reads: (d && d.reads) || {},
        mends: (d && d.mends) || {},
        updated: (d && d.updated) || null
      };
    }
  } catch (e) { /* 还没有 reads.json 也不影响看网 */ }
  return readsCache;
}

export function readsSnapshot() { return readsCache || { reads: {}, mends: {}, updated: null }; }

/* ---------------------------------------------------------- 审查规则 */
let moderationCache = null;

export async function loadModeration() {
  if (moderationCache) return moderationCache;
  moderationCache = { limits: { nameMax: 24, wishMax: 160, wishMin: 2, maxLinks: 0, maxRepeatRun: 8 }, bannedWords: [] };
  try {
    const r = await fetch('data/moderation.json', { cache: 'no-cache' });
    if (r.ok) {
      const m = await r.json();
      moderationCache = Object.assign(moderationCache, m);
      moderationCache.limits = Object.assign({ nameMax: 24, wishMax: 160, wishMin: 2, maxLinks: 0, maxRepeatRun: 8 }, m.limits || {});
      moderationCache.bannedWords = (m.bannedWords || []).map(function (w) { return String(w); });
    }
  } catch (e) {}
  return moderationCache;
}

export function moderation() { return moderationCache || { limits: { maxLinks: 0, maxRepeatRun: 8 }, bannedWords: [] }; }

/* 和采集器同样的规则，先在本地拦一道，省得用户白等 */
export function screenText(name, wish) {
  const mod = moderation();
  const L = mod.limits;
  const text = (name + ' ' + wish).trim();
  const lower = text.toLowerCase();
  const hits = mod.bannedWords.filter(function (b) { return lower.indexOf(String(b).toLowerCase()) >= 0; });
  if (hits.length) return '这句话里有像推广或违规的词（' + hits.slice(0, 2).join('、') + '），换一种说法吧。';
  const links = (text.match(/(?:https?:\/\/|www\.|t\.me\/|\b\d{1,3}(?:\.\d{1,3}){3}\b)/gi) || []).length;
  if (links > (L.maxLinks || 0)) return '愿望里不要放链接。';
  let run = 1, best = 1;
  for (let i = 1; i < text.length; i++) { run = text[i] === text[i - 1] ? run + 1 : 1; if (run > best) best = run; }
  if (best > (L.maxRepeatRun || 8)) return '重复的字太多了，写点真心话吧。';
  if (!/[\p{L}\p{N}]/u.test(wish)) return '愿望里得有文字才行。';
  return null;
}

/* ---------------------------------------------------------- 工作量证明 */
/* 提交前先挖一个 nonce，让脚本批量灌的成本变高。采集器会验这个证明。 */
export async function mineProof(id, difficulty, onProgress) {
  const bits = difficulty || (cfg.proofOfWork && cfg.proofOfWork.difficulty) || 4;
  const prefix = new Array(bits + 1).join('0');
  let n = 0;
  for (;;) {
    const pow = n.toString(36);
    if (sha256Hex(id + '|' + pow).slice(0, bits) === prefix) return { pow: pow, hashes: n + 1 };
    n++;
    if ((n & 8191) === 0) {
      if (onProgress) onProgress(n);
      await new Promise(function (r) { setTimeout(r, 0); });
    }
  }
}

/* ---------------------------------------------------------- 密封给站点
   任何内容用站点公钥封上之后，只有拿得出后台口令的人能拆开。
   元数据走这条路；选择「仅自己可见」的愿望，正文也走这条路。 */
export async function seal(value) {
  const pub = cfg.siteKey || FALLBACK.siteKey;
  if (!pub) return null;
  try { return await sealForSite(pub, value); } catch (e) { return null; }
}
export const sealMeta = seal;

/* ---------------------------------------------------------- 中转站 */
export async function publish(payload) {
  const r = await fetch(endpoint() + '/' + encodeURIComponent(cfg.topic), {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'content-type': 'text/plain;charset=utf-8' }
  });
  if (!r.ok) throw new Error('relay ' + r.status);
  return r.json();
}

/* 拉取中转站上最近的愿望。since 为 unix 秒，'all' 表示缓存内的全部。 */
export async function poll(since) {
  const url = relay() + '?poll=1&since=' + encodeURIComponent(since == null ? 'all' : since);
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('poll ' + r.status);
  const text = await r.text();
  const out = [];
  text.split('\n').forEach(function (line) {
    if (!line.trim()) return;
    try {
      const ev = JSON.parse(line);
      if (ev.event !== 'message' || !ev.message) return;
      const w = JSON.parse(ev.message);
      if (!w || !w.name || !w.wish) return;
      out.push(Object.assign({}, w, { relayTime: ev.time || 0, relayId: ev.id || '' }));
    } catch (e) {}
  });
  return out;
}

/* 按 id 合并两组愿望 */
export function merge(a, b) {
  const seen = new Set();
  const out = [];
  a.concat(b).forEach(function (w) {
    const key = w.id || (w.name + '|' + w.wish + '|' + w.ts);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(w);
  });
  out.sort(function (x, y) { return (x.ts || 0) - (y.ts || 0); });
  return out;
}

/* ---------------------------------------------------------- 分享链接 */
export function encodeShare(rec) {
  const slim = { n: rec.name, w: rec.wish, m: rec.mood, t: rec.ts };
  const json = JSON.stringify(slim);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach(function (b) { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeShare(token) {
  try {
    /* 一条愿望最长也就一千来个字符，再长就是有人拿它当内存炸弹 */
    if (!token || token.length > 4096) return null;
    let b = token.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const bin = atob(b);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const o = JSON.parse(new TextDecoder().decode(bytes));
    if (!o || !o.n || !o.w) return null;
    return { id: 'share_' + token.slice(0, 10), name: o.n, wish: o.w, mood: o.m || 'silk', ts: o.t || Date.now(), shared: true };
  } catch (e) { return null; }
}
