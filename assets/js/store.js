/* 数据层 —— 中转站写入、归档读取、本机兜底 */
import { FALLBACK } from './config.js';
import { sha256Hex } from '../../shared/sha256.js';
import { sealForSite } from '../../shared/envelope.js';

const K = {
  mine:   'yixian.mine.v1',
  device: 'yixian.device.v1',
  visits: 'yixian.visits.v1',
  pending:'yixian.pending.v1'
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

export function queuePending(rec) { write(K.pending, read(K.pending, []).concat([rec]).slice(-40)); }
export function pending() { return read(K.pending, []); }
export function clearPending() { write(K.pending, []); }

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

/* ---------------------------------------------------------- 密封元数据 */
export async function sealMeta(meta) {
  const pub = cfg.siteKey || FALLBACK.siteKey;
  if (!pub) return null;
  try { return await sealForSite(pub, meta); } catch (e) { return null; }
}

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

export async function flushPending() {
  const list = pending();
  if (!list.length) return 0;
  const kept = [];
  for (let i = 0; i < list.length; i++) {
    try { await publish(list[i]); } catch (e) { kept.push(list[i]); }
  }
  write(K.pending, kept);
  return list.length - kept.length;
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
