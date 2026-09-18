#!/usr/bin/env node
/**
 * 采集器 / The Collector —— 唯一能把内容写进仓库的角色，所有防护都在这里落地。
 *
 *   校验 → 工作量证明 → 内容审查 → 限流 → 分流
 *
 * 分流三条路：
 *   public  → data/wishes.jsonl          （公开挂上蛛网）
 *   private → data/private/vault.jsonl   （端到端加密，只有后台口令能解开）
 *   命中规则 → data/queue.jsonl          （隔离待审，整条加密，不上墙）
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../shared/sha256.js';
import { deriveKey, encryptJSON } from '../shared/crypto.js';
import { unwrapKeyring } from '../shared/keyring.js';
import { openFromSite } from '../shared/envelope.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const J = (p) => resolve(ROOT, p);
const readText = async (p, d = '') => (existsSync(p) ? readFile(p, 'utf8') : d);
const readJSON = async (p, d) => { try { return JSON.parse(await readText(p)); } catch { return d; } };
const writeJSON = async (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const lines = (t) => t.split('\n').filter(Boolean);
const parseLines = (t) => lines(t).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const cfg = await readJSON(J('data/config.json'), {});
const mod = await readJSON(J('data/moderation.json'), {});
const L = Object.assign({ nameMin: 1, nameMax: 24, wishMin: 2, wishMax: 160, maxLinks: 0, maxRepeatRun: 8 }, mod.limits || {});
const R = Object.assign({ perDevicePerHour: 6, anonymousPerHour: 20, globalPerHour: 240, perRunLimit: 120, perContentPerDay: 1, archiveCap: 20000 }, mod.rate || {});
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
const dh = (v) => sha256Hex('k:' + String(v) + ':' + ((cfg.crypto && cfg.crypto.salt) || 'nosalt')).slice(0, 24);

/* ---------------------------------------------------------------- 密钥 */
let dek = null, privateJwk = null;
if (PASSPHRASE && cfg.crypto && cfg.crypto.salt) {
  try {
    const kek = await deriveKey(PASSPHRASE, cfg.crypto.salt, cfg.crypto.iterations);
    const opened = await unwrapKeyring(kek, await readJSON(J('data/private/keys.json'), null));
    dek = opened.dek;
    privateJwk = opened.sitePrivateJwk;
  } catch (e) {
    console.error('⚠ 密钥环打不开（口令不对？）—— 本次不保存元数据与私密愿望，只归档公开部分。');
  }
} else {
  console.error('⚠ 没有 WISH_ADMIN_PASSPHRASE —— 不保存元数据与私密愿望，只归档公开部分。');
  console.error('  设置：gh secret set WISH_ADMIN_PASSPHRASE --body "<口令>"');
}

/* ---------------------------------------------------------------- 状态 */
const archivePath = J('data/wishes.jsonl');
const vaultPath = J('data/private/vault.jsonl');
const queuePath = J('data/queue.jsonl');
const metaPath = J('data/private/meta.jsonl');

const blocked = new Set(await readJSON(J('data/blocked.json'), []));
const existing = parseLines(await readText(archivePath));
const byId = new Map();
const seenIds = new Set();
const seenContent = new Set();
for (const r of existing) { byId.set(r.id, r); seenIds.add(r.id); seenContent.add(sha256Hex(String(r.name) + '\u0000' + String(r.wish))); }
for (const r of parseLines(await readText(queuePath))) seenIds.add(r.id);
for (const r of parseLines(await readText(vaultPath))) seenIds.add(r.id);
const metaKnown = new Set(parseLines(await readText(metaPath)).map((r) => r.id));
const vaultKnown = new Set(parseLines(await readText(vaultPath)).map((r) => r.id));

const rlPath = J('data/private/ratelimit.json');
const rl = await readJSON(rlPath, { devices: {}, content: {}, global: [], total: 0 });
rl.devices = rl.devices || {}; rl.content = rl.content || {}; rl.global = rl.global || [];
const HOUR = 3600e3, DAY = 86400e3;
const now = Date.now();
for (const k of Object.keys(rl.devices)) { rl.devices[k] = rl.devices[k].filter((t) => now - t < DAY); if (!rl.devices[k].length) delete rl.devices[k]; }
for (const k of Object.keys(rl.content)) { rl.content[k] = rl.content[k].filter((t) => now - t < DAY); if (!rl.content[k].length) delete rl.content[k]; }
rl.global = rl.global.filter((t) => now - t < HOUR);

/* ---------------------------------------------------------------- 拉取 */
const cursorObj = await readJSON(J('data/cursor.json'), { since: 'all' });
const since = cursorObj.since === 'all' ? 'all' : Math.max(0, Number(cursorObj.since) - 180);
const res = await fetch(ENDPOINT + '/' + encodeURIComponent(TOPIC) + '/json?poll=1&since=' + since, { headers: { 'user-agent': 'wish-silk-collector/3.0' } });
if (!res.ok) { console.error('拉取失败', res.status); process.exit(1); }
const body = await res.text();

/* ---------------------------------------------------------------- 审查 */
const stats = { in: 0, ok: 0, priv: 0, bad_shape: 0, bad_pow: 0, bad_seal: 0, bot: 0, dup: 0, rate: 0, flood: 0, blocked: 0, dup_id: 0, meta_lost: 0 };
const accepted = [], quarantined = [], metaOut = [], vaultOut = [];
let maxTime = Number(cursorObj.since) || 0;
const bump = (k) => { stats[k] = (stats[k] || 0) + 1; };

/* 只做形状/凭证校验；内容相关的一律等取到真内容之后再审 */
function vetShape(w) {
  if (!w || typeof w !== 'object') return { drop: 'bad_shape' };
  const id = String(w.id || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
  if (!/^w_[a-z0-9_]{4,40}$/i.test(id)) return { drop: 'bad_shape' };
  const pow = String(w.pow == null ? '' : w.pow).slice(0, 24);
  if (!/^[A-Za-z0-9]{1,24}$/.test(pow)) return { drop: 'bad_pow' };
  if (sha256Hex(id + '|' + pow).slice(0, POW_BITS) !== POW_PREFIX) return { drop: 'bad_pow' };
  if (w.hp) return { drop: 'bot' };
  const ft = Number(w.ft);
  if (Number.isFinite(ft) && ft < 2000) return { drop: 'bot' };
  const vis = w.vis === 'private' ? 'private' : 'public';
  if (vis === 'private' && (!w.prv || typeof w.prv !== 'object')) return { drop: 'bad_seal' };
  return { ok: true, id, vis, ref: w };
}

/* 内容审查：公开与私密一视同仁 */
function reviewContent(name, wish) {
  const text = name + ' ' + wish;
  const lower = text.toLowerCase();
  const hits = BANNED.filter((b) => lower.indexOf(b) >= 0);
  if (hits.length) return '违禁词：' + hits.slice(0, 3).join('、');
  const links = (text.match(/(?:https?:\/\/|www\.|t\.me\/|\b\d{1,3}(?:\.\d{1,3}){3}\b)/gi) || []).length;
  if (links > L.maxLinks) return '包含 ' + links + ' 个链接';
  if (isJunk(wish)) return '没有任何文字内容';
  if (runOf(text) > L.maxRepeatRun) return '重复字符过多';
  if (sameRatio(text) > 0.75 && text.length > 8) return '单一字符占比过高';
  return null;
}

for (const line of body.split('\n')) {
  if (!line.trim()) continue;
  let ev; try { ev = JSON.parse(line); } catch { continue; }
  if (ev.event !== 'message' || !ev.message) continue;
  if (ev.time && ev.time > maxTime) maxTime = ev.time;
  stats.in++;

  let raw; try { raw = JSON.parse(ev.message); } catch { bump('bad_shape'); continue; }
  const shape = vetShape(raw);
  if (shape.drop) { bump(shape.drop); continue; }
  const id = shape.id;
  if (blocked.has(id)) { stats.blocked++; continue; }
  if (seenIds.has(id)) { stats.dup_id++; continue; }
  if (accepted.length + vaultOut.length + 1 > R.perRunLimit) { stats.flood++; continue; }

  /* 取真内容 */
  let name, wish, mood, ts;
  if (shape.vis === 'private') {
    if (!privateJwk) { bump('bad_seal'); continue; }
    try {
      const p = await openFromSite(privateJwk, raw.prv);
      name = norm(p.name, L.nameMax + 1);
      wish = norm(p.wish, L.wishMax + 1);
      mood = MOODS.includes(p.mood) ? p.mood : 'silk';
      ts = Number(p.ts);
    } catch { bump('bad_seal'); continue; }
  } else {
    name = norm(raw.name, L.nameMax + 1);
    wish = norm(raw.wish, L.wishMax + 1);
    mood = MOODS.includes(raw.mood) ? raw.mood : 'silk';
    ts = Number(raw.ts);
  }
  if (!name || name.length < L.nameMin || name.length > L.nameMax) { bump('bad_shape'); continue; }
  if (!wish || wish.length < L.wishMin || wish.length > L.wishMax) { bump('bad_shape'); continue; }
  if (!Number.isFinite(ts) || ts < now - 30 * DAY || ts > now + DAY) ts = now;

  let why = reviewContent(name, wish);

  /* 内容去重 */
  const contentHash = sha256Hex(name + '\u0000' + wish);
  if (seenContent.has(contentHash)) { stats.dup++; continue; }
  if ((rl.content[contentHash] || []).filter((t) => now - t < DAY).length >= R.perContentPerDay) { stats.dup++; continue; }

  /* 拆元数据信封 */
  let meta = null;
  if (dek && privateJwk && raw.env) {
    try {
      const m = await openFromSite(privateJwk, raw.env);
      meta = {
        id, ts,
        tz: norm(m.tz, 48), lg: norm(m.lg, 16), ua: norm(m.ua, 64),
        vp: norm(m.vp, 16), ref: norm(m.ref, 80), dv: norm(m.dv, 24),
        n: Number(m.n) > 0 && Number(m.n) < 1e6 ? Math.floor(Number(m.n)) : 1,
        src: norm(m.src, 24)
      };
    } catch { stats.meta_lost++; }
  }

  /* 限流：设备号是客户端自报的，可以伪造 —— 所以还有一道全站配额兜底 */
  const hasDevice = !!(meta && meta.dv);
  const deviceKey = hasDevice ? dh(meta.dv) : 'anon';
  const cap = hasDevice ? R.perDevicePerHour : R.anonymousPerHour;
  const dTimes = (rl.devices[deviceKey] || []).filter((t) => now - t < HOUR);
  if (dTimes.length >= cap) {
    why = why || (hasDevice ? ('同一设备一小时内已提交 ' + dTimes.length + ' 条') : ('匿名提交过多（一小时内 ' + dTimes.length + ' 条）'));
  }
  if (!why && rl.global.length >= R.globalPerHour) {
    why = '全站一小时内已达 ' + rl.global.length + ' 条上限';
  }

  seenIds.add(id);
  seenContent.add(contentHash);
  rl.content[contentHash] = (rl.content[contentHash] || []).concat([now]);
  rl.devices[deviceKey] = (rl.devices[deviceKey] || []).concat([now]);
  rl.global.push(now);
  stats.ok++;
  if (shape.vis === 'private') stats.priv++;

  const record = { id, name, wish, mood, ts, vis: shape.vis, reason: why || null, meta };

  if (why) quarantined.push(record);
  else if (shape.vis === 'private') vaultOut.push(record);
  else {
    accepted.push({ id, name, wish, mood, ts });
    if (meta && !metaKnown.has(id)) metaOut.push(meta);
  }
}

/* ---------------------------------------------------------------- 落盘 */
const acceptedIds = new Set(accepted.map((r) => r.id));
const merged = accepted.concat([...byId.values()].filter((r) => !acceptedIds.has(r.id)));
merged.sort((a, b) => (a.ts || 0) - (b.ts || 0));
const overCap = Math.max(0, merged.length - R.archiveCap);
const finalList = overCap ? merged.slice(overCap) : merged;
if (accepted.length || overCap) {
  await mkdir(dirname(archivePath), { recursive: true });
  await writeFile(archivePath, finalList.map((r) => JSON.stringify(r)).join('\n') + (finalList.length ? '\n' : ''));
}

async function appendEncrypted(path, records, mapper) {
  if (!dek || !records.length) return 0;
  await mkdir(dirname(path), { recursive: true });
  const head = await readText(path);
  const out = [];
  for (const rec of records) out.push(JSON.stringify(mapper(rec, await encryptJSON(dek, rec))));
  await writeFile(path, head + out.join('\n') + '\n');
  return out.length;
}

const metaSaved = await appendEncrypted(metaPath, metaOut, (m, e) => ({ id: m.id, e }));
const vaultSaved = await appendEncrypted(vaultPath, vaultOut.filter((r) => !vaultKnown.has(r.id)), (r, e) => ({ id: r.id, e }));
const queueSaved = await appendEncrypted(queuePath, quarantined, (r, e) => ({ id: r.id, e }));

rl.total = (rl.total || 0) + accepted.length + vaultOut.length;
const dkeys = Object.keys(rl.devices);
if (dkeys.length > 5000) for (const k of dkeys.slice(0, dkeys.length - 5000)) delete rl.devices[k];
await writeJSON(rlPath, rl);
if (accepted.length || quarantined.length || vaultOut.length) {
  await writeJSON(J('data/cursor.json'), { since: maxTime || Math.floor(Date.now() / 1000), updated: new Date().toISOString() });
}

console.log(JSON.stringify({
  拉取: stats.in,
  公开上墙: accepted.length,
  私密入库: vaultSaved,
  隔离待审: queueSaved,
  丢弃: {
    形状不符: stats.bad_shape, 凭证无效: stats.bad_pow, 密封损坏: stats.bad_seal,
    疑似机器人: stats.bot, 重复内容: stats.dup, 重复id: stats.dup_id,
    已屏蔽: stats.blocked, 超量截断: stats.flood
  },
  归档: finalList.length,
  元数据: metaSaved,
  元数据解不开: stats.meta_lost,
  全站本小时: rl.global.length
}, null, 0));
