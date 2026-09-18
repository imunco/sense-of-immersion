#!/usr/bin/env node
/**
 * 采集器 / The Collector —— 同时是审查与限流的执行点。
 *
 * 它是唯一能把内容写进公开归档的角色，所以所有防护都在这里落地：
 *   1. 校验   —— 形状、长度、字符集、字体、时间戳
 *   2. 工作量证明 —— 每条愿望必须带一个挖出来的 nonce（挡脚本批量灌）
 *   3. 内容审查 —— 违禁词、链接、重复字符、纯符号 → 隔离待审，不直接上墙
 *   4. 限流   —— 每设备每小时、每内容每日、每次运行总量、归档总量上限
 *   5. 隐私   —— 采集到的「基本信息」用后台口令派生密钥加密后才落盘
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../shared/sha256.js';
import { deriveKey, encryptJSON, decryptJSON } from '../shared/crypto.js';
import { openFromSite } from '../shared/envelope.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const J = (p) => resolve(ROOT, p);
const readText = async (p, d = '') => (existsSync(p) ? readFile(p, 'utf8') : d);
const readJSON = async (p, d) => { try { return JSON.parse(await readText(p)); } catch { return d; } };
const writeJSON = async (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');

const cfg = await readJSON(J('data/config.json'), {});
const mod = await readJSON(J('data/moderation.json'), {});
const L = Object.assign({ nameMin: 1, nameMax: 24, wishMin: 2, wishMax: 160, maxLinks: 0, maxRepeatRun: 8 }, mod.limits || {});
const R = Object.assign({ perDevicePerHour: 6, anonymousPerHour: 20, perRunLimit: 120, perContentPerDay: 1, archiveCap: 20000 }, mod.rate || {});
const POW_BITS = (mod.proofOfWork && mod.proofOfWork.difficulty) || 4;
const POW_PREFIX = '0'.repeat(POW_BITS);
const BANNED = (mod.bannedWords || []).map((w) => String(w).toLowerCase()).filter(Boolean);

const TOPIC = process.env.WISH_TOPIC || cfg.topic;
const ENDPOINT = (process.env.WISH_ENDPOINT || cfg.endpoint || 'https://ntfy.sh').replace(/\/+$/, '');
const PASSPHRASE = process.env.WISH_ADMIN_PASSPHRASE || '';
const MOODS = ['silk', 'abyss', 'moon', 'dusk'];

if (!TOPIC) { console.error('缺少 topic'); process.exit(1); }

/* ---------------------------------------------------------------- 工具 */
const stripCtl = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g, '');
const norm = (s, max) => stripCtl(s).replace(/\s+/g, ' ').trim().slice(0, max);
const runOf = (s) => { let best = 1, cur = 1; for (let i = 1; i < s.length; i++) { cur = s[i] === s[i - 1] ? cur + 1 : 1; if (cur > best) best = cur; } return best; };
function sameRatio(s) {
  if (!s.length) return 0;
  const m = {}; let best = 0;
  for (const ch of s) { m[ch] = (m[ch] || 0) + 1; if (m[ch] > best) best = m[ch]; }
  return best / s.length;
}
const isJunk = (s) => !/[\p{L}\p{N}]/u.test(s);

/* ---------------------------------------------------------------- 密钥 */
let key = null;
let privateJwk = null;
if (PASSPHRASE && cfg.crypto && cfg.crypto.salt) {
  key = await deriveKey(PASSPHRASE, cfg.crypto.salt, cfg.crypto.iterations);
  try {
    privateJwk = await decryptJSON(key, JSON.parse(await readText(J('data/private/keys.json'), 'null')));
  } catch {
    console.warn('⚠ 解不开 data/private/keys.json —— 元数据将无法解密，只归档公开部分。');
  }
} else {
  console.warn('⚠ 没有 WISH_ADMIN_PASSPHRASE —— 本次不保存「基本信息」，只归档公开部分。');
  console.warn('  设置：gh secret set WISH_ADMIN_PASSPHRASE --body "<口令>"');
}

/* ---------------------------------------------------------------- 状态 */
const archivePath = J('data/wishes.jsonl');
const blocked = new Set(await readJSON(J('data/blocked.json'), []));
const existingLines = (await readText(archivePath)).split('\n').filter(Boolean);
const byId = new Map();
const seenIds = new Set();
const seenContent = new Set();
for (const line of existingLines) {
  try {
    const r = JSON.parse(line);
    byId.set(r.id, r);
    seenIds.add(r.id);
    seenContent.add(sha256Hex(String(r.name) + '\u0000' + String(r.wish)));
  } catch {}
}
const queuePath = J('data/queue.jsonl');
const queueKnown = new Set((await readText(queuePath)).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).id; } catch { return null; } }).filter(Boolean));
for (const id of queueKnown) seenIds.add(id);

const metaPath = J('data/private/meta.jsonl');
const metaKnown = new Set((await readText(metaPath)).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).id; } catch { return null; } }).filter(Boolean));

const rlPath = J('data/private/ratelimit.json');
const rl = await readJSON(rlPath, { devices: {}, content: {}, total: 0 });
rl.devices = rl.devices || {}; rl.content = rl.content || {};
const HOUR = 3600e3, DAY = 86400e3;
const now = Date.now();
const dh = (dv) => sha256Hex('dv:' + String(dv) + ':' + (cfg.crypto && cfg.crypto.salt || 'nosalt')).slice(0, 24);
for (const k of Object.keys(rl.devices)) { rl.devices[k] = rl.devices[k].filter((t) => now - t < DAY); if (!rl.devices[k].length) delete rl.devices[k]; }
for (const k of Object.keys(rl.content)) { rl.content[k] = rl.content[k].filter((t) => now - t < DAY); if (!rl.content[k].length) delete rl.content[k]; }

/* ---------------------------------------------------------------- 拉取 */
const cursorObj = await readJSON(J('data/cursor.json'), { since: 'all' });
const since = cursorObj.since === 'all' ? 'all' : Math.max(0, Number(cursorObj.since) - 180);
const url = ENDPOINT + '/' + encodeURIComponent(TOPIC) + '/json?poll=1&since=' + since;
const res = await fetch(url, { headers: { 'user-agent': 'wish-silk-collector/2.0' } });
if (!res.ok) { console.error('拉取失败', res.status); process.exit(1); }
const body = await res.text();

/* ---------------------------------------------------------------- 逐条审 */
const accepted = [], quarantined = [], metaOut = [];
const stats = { in: 0, ok: 0, bad_shape: 0, bad_pow: 0, bot: 0, banned: 0, link: 0, junk: 0, repeat: 0, dup: 0, rate: 0, flood: 0, blocked: 0, dup_id: 0 };
let maxTime = Number(cursorObj.since) || 0;

function reject(reason) { stats[reason] = (stats[reason] || 0) + 1; }

function vet(w) {
  if (!w || typeof w !== 'object') return { drop: 'bad_shape' };
  const id = String(w.id || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
  if (!/^w_[a-z0-9_]{4,40}$/i.test(id)) return { drop: 'bad_shape' };
  const name = norm(w.name, L.nameMax + 1);
  const wish = norm(w.wish, L.wishMax + 1);
  if (!name || name.length < L.nameMin || name.length > L.nameMax) return { drop: 'bad_shape' };
  if (!wish || wish.length < L.wishMin || wish.length > L.wishMax) return { drop: 'bad_shape' };

  /* 工作量证明 */
  const pow = String(w.pow == null ? '' : w.pow).slice(0, 24);
  if (!/^[A-Za-z0-9]{1,24}$/.test(pow)) return { drop: 'bad_pow' };
  if (sha256Hex(id + '|' + pow).slice(0, POW_BITS) !== POW_PREFIX) return { drop: 'bad_pow' };

  /* 蜜罐与填写时长 */
  if (w.hp) return { drop: 'bot' };
  const ft = Number(w.ft);
  if (Number.isFinite(ft) && ft < 2000) return { drop: 'bot' };

  const mood = MOODS.includes(w.mood) ? w.mood : 'silk';
  let ts = Number(w.ts);
  if (!Number.isFinite(ts) || ts < now - 30 * DAY || ts > now + DAY) ts = now;

  const text = name + ' ' + wish;
  const lower = text.toLowerCase();
  let why = null;

  const hits = BANNED.filter((b) => lower.includes(b));
  if (hits.length) why = '违禁词：' + hits.slice(0, 3).join('、');

  const links = (text.match(/(?:https?:\/\/|www\.|t\.me\/|\b\d{1,3}(?:\.\d{1,3}){3}\b)/gi) || []).length;
  if (!why && links > L.maxLinks) why = '包含 ' + links + ' 个链接';

  if (!why && isJunk(wish)) why = '没有任何文字内容';
  if (!why && runOf(text) > L.maxRepeatRun) why = '重复字符过多';
  if (!why && sameRatio(text) > 0.75 && text.length > 8) why = '单一字符占比过高';

  const contentHash = sha256Hex(name + '\u0000' + wish);
  if (seenContent.has(contentHash)) return { drop: 'dup' };
  const cTimes = rl.content[contentHash] || [];
  if (cTimes.filter((t) => now - t < DAY).length >= R.perContentPerDay) return { drop: 'dup' };

  /* 每设备限流要等信封拆开、拿到稳定的设备标识之后再做（见主循环） */
  return {
    ok: true,
    id, name, wish, mood, ts,
    contentHash,
    quarantine: why || null,
    env: w.env || null
  };
}

for (const line of body.split('\n')) {
  if (!line.trim()) continue;
  let ev; try { ev = JSON.parse(line); } catch { continue; }
  if (ev.event !== 'message' || !ev.message) continue;
  if (ev.time && ev.time > maxTime) maxTime = ev.time;
  stats.in++;

  let raw; try { raw = JSON.parse(ev.message); } catch { reject('bad_shape'); continue; }
  const v = vet(raw);
  if (v.drop) { reject(v.drop); continue; }
  if (blocked.has(v.id)) { stats.blocked++; continue; }
  if (seenIds.has(v.id)) { stats.dup_id++; continue; }

  if (accepted.length + 1 > R.perRunLimit) { stats.flood++; continue; }

  seenIds.add(v.id);
  seenContent.add(v.contentHash);
  rl.content[v.contentHash] = (rl.content[v.contentHash] || []).concat([now]);
  stats.ok++;

  /* 拆信封 —— 元数据只在被授权的采集器里短暂以明文存在 */
  let meta = null;
  let envelopeBroken = false;
  if (key && privateJwk && v.env) {
    try {
      const m = await openFromSite(privateJwk, v.env);
      meta = {
        id: v.id, ts: v.ts,
        tz: norm(m.tz, 48), lg: norm(m.lg, 16), ua: norm(m.ua, 64),
        vp: norm(m.vp, 16), ref: norm(m.ref, 80), dv: norm(m.dv, 24),
        n: Number(m.n) > 0 && Number(m.n) < 1e6 ? Math.floor(Number(m.n)) : 1,
        src: norm(m.src, 24)
      };
    } catch { stats.meta_lost = (stats.meta_lost || 0) + 1; envelopeBroken = true; }
  }
  /* 信封坏了说明有人在改包；没有信封的走一个更紧的匿名桶，防止绕过设备限流 */
  if (envelopeBroken) v.quarantine = v.quarantine || '元数据信封损坏';

  /* 每设备限流：按拆封后拿到的稳定设备号（信封里的临时公钥每条都不同，不能用） */
  const hasDevice = !!(meta && meta.dv);
  const deviceKey = hasDevice ? dh(meta.dv) : 'anon';
  const cap = hasDevice ? R.perDevicePerHour : R.anonymousPerHour;
  const dTimes = (rl.devices[deviceKey] || []).filter((t) => now - t < HOUR);
  if (dTimes.length >= cap) {
    v.quarantine = v.quarantine || (hasDevice
      ? ('同一设备一小时内已提交 ' + dTimes.length + ' 条')
      : ('匿名提交过多（一小时内 ' + dTimes.length + ' 条）'));
  }
  rl.devices[deviceKey] = (rl.devices[deviceKey] || []).concat([now]);

  if (v.quarantine) {
    quarantined.push({ id: v.id, name: v.name, wish: v.wish, mood: v.mood, ts: v.ts, reason: v.quarantine, meta: meta });
  } else {
    accepted.push({ id: v.id, name: v.name, wish: v.wish, mood: v.mood, ts: v.ts });
    if (meta && !metaKnown.has(v.id)) metaOut.push(meta);
  }
}

/* ---------------------------------------------------------------- 归档 */
const acceptedIds = new Set(accepted.map((r) => r.id));
const merged = accepted.concat([...byId.values()].filter((r) => !acceptedIds.has(r.id)));
merged.sort((a, b) => (a.ts || 0) - (b.ts || 0));
const overCap = Math.max(0, merged.length - R.archiveCap);
const finalList = overCap ? merged.slice(overCap) : merged;

const changed = accepted.length > 0 || overCap > 0;
if (changed) {
  await mkdir(dirname(archivePath), { recursive: true });
  await writeFile(archivePath, finalList.map((r) => JSON.stringify(r)).join('\n') + (finalList.length ? '\n' : ''));
}

if (key && metaOut.length) {
  const head = (await readText(metaPath));
  const lines = [];
  for (const m of metaOut) lines.push(JSON.stringify({ id: m.id, e: await encryptJSON(key, m) }));
  await writeFile(metaPath, head + lines.join('\n') + '\n');
}

if (key && quarantined.length) {
  const qPath = queuePath;
  const head = await readText(qPath);
  const lines = [];
  for (const q of quarantined) lines.push(JSON.stringify({ id: q.id, e: await encryptJSON(key, q) }));
  await writeFile(qPath, head + lines.join('\n') + '\n');
}

rl.total = (rl.total || 0) + accepted.length;
const keys = Object.keys(rl.devices);
if (keys.length > 5000) for (const k of keys.slice(0, keys.length - 5000)) delete rl.devices[k];
await writeJSON(rlPath, rl);

if (accepted.length || quarantined.length) {
  await writeJSON(J('data/cursor.json'), { since: maxTime || Math.floor(Date.now() / 1000), updated: new Date().toISOString() });
}

console.log(JSON.stringify({
  fetched: stats.in,
  accepted: accepted.length,
  quarantined: quarantined.length,
  rejected: {
    形状不符: stats.bad_shape, 工作量证明无效: stats.bad_pow, 疑似机器人: stats.bot,
    重复内容: stats.dup, 重复id: stats.dup_id, 已屏蔽: stats.blocked, 洪水丢弃: stats.flood
  },
  archive: finalList.length,
  metaSaved: metaOut.length,
  metaUnreadable: stats.meta_lost || 0,
  trimmed: overCap
}));
