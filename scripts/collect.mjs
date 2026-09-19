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
import { deriveKey, encryptJSON, decryptJSON } from '../shared/crypto.js';
import { unwrapKeyring } from '../shared/keyring.js';
import { openFromSite } from '../shared/envelope.js';
import { hasSecret, verifySid } from '../lib/readid.js';
import { verifyAssertion, challengeFor, delChallengeParts } from '../shared/webauthn.js';

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
const R = Object.assign({
  perDevicePerHour: 6, anonymousPerHour: 20, globalPerHour: 240, perRunLimit: 120,
  perContentPerDay: 1, archiveCap: 20000,
  cooldownHours: 6,              /* 一台设备写下一条之后的冷却时长，前端读同一份 */
  readsPerDevicePerDay: 1,       /* 没配 WISH_READ_SECRET 时的老办法：单设备一天一条 */
  readsAnonPerDay: 60,
  readsPerSidPerDay: 1,          /* 签过名的一个身份一天一条 */
  readsPerIpPerDay: 3,           /* 同一张出口网一天最多几条，挡「清 cookie 再来」 */
  readsPerWishPerDay: 1,         /* 同一条愿望一天只算一次 —— 单条愿望刷不动 */
  readsGlobalPerDay: 600,        /* 全站当天上限 —— 分布式农场也翻不了天 */
  readProofOfWork: 4,            /* 每条读消息都得挖出这么多位零 */
  readsPerMessage: 400,
  readsPerRun: 4000,
  mendsPerRun: 200
}, mod.rate || {});
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
let dek = null, privateJwk = null, kek = null;
if (PASSPHRASE && cfg.crypto && cfg.crypto.salt) {
  try {
    kek = await deriveKey(PASSPHRASE, cfg.crypto.salt, cfg.crypto.iterations);
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
rl.wrote = rl.wrote || {};        /* 每台设备上一次真正写下的时刻，冷却用 */
rl.reads = rl.reads || {};        /* 被读的配额：按签名身份 / 设备号 */
rl.readIps = rl.readIps || {};    /* 出口网代号的当天额度（代号每天换盐，追不到昨天） */
rl.readGlobal = rl.readGlobal || [];   /* 全站最近的被读时刻 */
rl.wishReads = rl.wishReads || {};     /* 每条愿望上一次被计数的时刻 */
/* 只留一天内的，别让这张表越滚越大 */
for (const k of Object.keys(rl.wishReads)) if (now - rl.wishReads[k] > DAY) delete rl.wishReads[k];
rl.delNonces = (rl.delNonces || []).filter((x) => now - (x.t || 0) < 7 * DAY).slice(-500);
const delNonces = new Set(rl.delNonces.map((x) => x.n));

/* 丝的命数：被读计数与续丝。只有 id 与次数，没有新的隐私 */
/* 装了通行密钥就只认硬件签过的删除指令（公钥是公开的，私钥在硬件里） */
const passkeyPath = J('data/private/passkey.json');
const passkey = await readJSON(passkeyPath, null);

const readsPath = J('data/reads.json');
const readsDoc = await readJSON(readsPath, { reads: {}, mends: {} });
readsDoc.reads = readsDoc.reads || {};
readsDoc.mends = readsDoc.mends || {};
const deletedIds = new Set();     /* 这一轮要删掉的愿望 */
let readsChanged = false;
const ID_RE = /^w_[A-Za-z0-9_]{4,40}$/;

/* ---------------------------------------------------------------- 拉取 */
const cursorObj = await readJSON(J('data/cursor.json'), { since: 'all' });
const since = cursorObj.since === 'all' ? 'all' : Math.max(0, Number(cursorObj.since) - 180);
const res = await fetch(ENDPOINT + '/' + encodeURIComponent(TOPIC) + '/json?poll=1&since=' + since, { headers: { 'user-agent': 'wish-silk-collector/3.0' } });
if (!res.ok) { console.error('拉取失败', res.status); process.exit(1); }
const body = await res.text();

/* ---------------------------------------------------------------- 审查 */
const stats = { in: 0, ok: 0, priv: 0, bad_shape: 0, bad_pow: 0, bad_seal: 0, bot: 0, dup: 0, rate: 0, flood: 0, blocked: 0, dup_id: 0, meta_lost: 0, del: 0, del_bad: 0, del_stale: 0, del_nopass: 0, read: 0, read_rate: 0, read_unverified: 0, read_badpow: 0, read_global: 0, read_wishpace: 0, mend: 0 };
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

/* ---------------------------------------------------------------- 控制消息
   中转站上除了愿望，还有三种不需要 pow 的小消息：
     read  被读计数（攒在本机，下次访问时成批发出来）
     mend  续丝（自己回来把断丝接上）
     del   远程删除（口令在浏览器里派生的密钥密封，只有采集器拆得开）
   它们都不进归档，只改 data/reads.json 与屏蔽名单。 */
/* 一台设备一天只收一条（rate.readsPerDevicePerDay = 1）：
   这一条是「一个人一天只有一次机会」的服务端那一半。 */
/* 「被读」的多层审查 —— 一层一层往下筛，任何一层不过就不计数。
   每一层挡的是一种打法：

     1 形状      ids 必须是数组
     2 签名      配了密钥就只认 /api/read 签过名的身份
                 —— 伪造不了，清 localStorage 也换不掉
     3 工作量证明 每条消息都得挖出 readProofOfWork 位零
                 —— 脚本化灌水从「发个请求」变成「花 CPU」
     4 全站额度  readsGlobalPerDay
                 —— 换一堆代理 IP 的分布式农场也翻不了天
     5 一个身份  readsPerSidPerDay（没配密钥时退回设备号）
                 —— 一个人一天一条，就是「一个人一天只有一次机会」
     6 出口网    readsPerIpPerDay
                 —— 挡「那我清 cookie 呢」，同时给家人/公司留出余量
     7 单条愿望  readsPerWishPerDay = 1
                 —— 这一条最狠：同一条愿望一天只算一次，
                    所以单条愿望无论怎么刷都只能涨一格，「结实」只能靠时间攒
   七层里 3、4、7 不依赖任何身份，所以就算伪装成全新的人也没有额外收益。 */
async function handleRead(raw) {
  /* 1 形状 */
  if (!Array.isArray(raw.ids) || !raw.ids.length) return;
  const rawIds = raw.ids.map((x) => String(x || ''));

  /* 2 签名 */
  const signed = hasSecret(process.env);
  let subject = '', quota = 0, iph = '';
  if (signed) {
    const idt = raw.idt || {};
    const sid = String(idt.sid || '').slice(0, 64);
    const exp = Number(idt.exp) || 0;
    /* 我们签发的 sid 只可能是 base64url；字符集不对就当作伪造 */
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(sid) || !verifySid(process.env, sid, exp, idt.sig)) { stats.read_unverified++; return; }
    if (exp < now - DAY) { stats.read_unverified++; return; }
    subject = 'sid:' + sid;
    quota = Math.max(1, Number(R.readsPerSidPerDay) || 1);
    /* 来源代号只可能是 24 位十六进制；别的字符串一律当没有 ——
       它是对象的键，放进 __proto__ / constructor 这类值会出事 */
    iph = /^[0-9a-f]{24}$/.test(String(raw.iph || '')) ? String(raw.iph) : '';
  } else {
    let dv = '';
    if (privateJwk && raw.env) { try { dv = norm((await openFromSite(privateJwk, raw.env)).dv, 24); } catch {} }
    subject = 'dev:' + (dv ? dh(dv) : 'anon');
    quota = dv ? R.readsPerDevicePerDay : R.readsAnonPerDay;
  }

  /* 3 工作量证明（绑在这一串 id 上，函数转发时不改它们） */
  const bits = Number(R.readProofOfWork) || 0;
  if (bits > 0) {
    const pow = String(raw.pow == null ? '' : raw.pow).slice(0, 24);
    const zero = '0'.repeat(bits);
    if (!/^[A-Za-z0-9]{1,24}$/.test(pow) ||
        sha256Hex('yixian-read:' + rawIds.join(',') + '|' + pow).slice(0, bits) !== zero) {
      stats.read_badpow++;
      return;
    }
  }

  /* 4 全站当天额度 */
  rl.readGlobal = rl.readGlobal.filter((t) => now - t < DAY);
  const globalCap = Number(R.readsGlobalPerDay) || 0;
  if (globalCap > 0 && rl.readGlobal.length >= globalCap) { stats.read_global++; return; }

  /* 5 一个身份一天一条 */
  const day = rl.reads[subject] || { n: 0, t: now };
  if (now - (day.t || 0) > DAY) { day.n = 0; day.t = now; }

  /* 6 出口网 */
  let ipHits = null;
  if (iph) {
    ipHits = (rl.readIps[iph] || []).filter((t) => now - t < DAY);
    const ipCap = Number(R.readsPerIpPerDay) || 0;
    if (ipCap > 0 && ipHits.length >= ipCap) { stats.read_rate++; rl.readIps[iph] = ipHits; return; }
  }

  const budget = Math.min(quota - day.n, R.readsPerMessage, R.readsPerRun - stats.read);
  if (budget <= 0) { stats.read_rate++; rl.reads[subject] = day; return; }

  /* 7 单条愿望一天只算一次 */
  const wishCap = Math.max(1, Number(R.readsPerWishPerDay) || 1);
  const seen = new Set();
  let counted = 0;
  for (const id of rawIds) {
    if (counted >= budget) break;
    if (!ID_RE.test(id) || seen.has(id) || blocked.has(id)) continue;
    seen.add(id);
    const last = Number(rl.wishReads[id]) || 0;
    if (wishCap > 0 && last && now - last < DAY) { stats.read_wishpace++; continue; }
    readsDoc.reads[id] = Math.min(99999, (Number(readsDoc.reads[id]) || 0) + 1);
    rl.wishReads[id] = now;
    counted++;
  }

  if (counted) {
    day.n += counted;
    rl.reads[subject] = day;
    if (iph) rl.readIps[iph] = (ipHits || []).concat([now]);
    rl.readGlobal = rl.readGlobal.concat([now]);
    stats.read += counted;
    readsChanged = true;
  }
}

/* 续丝只保七天，所以同一条可以再接（每接一次，时间戳往后走）。
   用客户端报的时刻，但夹在 [过去, 现在] 之间 —— 旧消息重放不会续命。 */
async function handleMend(raw) {
  const id = String(raw.id || '');
  if (!ID_RE.test(id) || blocked.has(id)) return;
  if (!seenIds.has(id)) return;          /* 只给已经挂上蛛丝的愿望续丝 */
  if (stats.mend >= R.mendsPerRun) return;
  const at = Math.min(now, Number(raw.at) || now);
  if (at <= (Number(readsDoc.mends[id]) || 0)) return;
  readsDoc.mends[id] = at;
  stats.mend++;
  readsChanged = true;
}

async function handleDelete(raw) {
  if (!kek || !raw.seal) { stats.del_bad++; return; }
  let order = null;
  try { order = await decryptJSON(kek, raw.seal); } catch { stats.del_bad++; return; }
  if (!order || !Array.isArray(order.ids) || !order.ids.length) { stats.del_bad++; return; }
  const at = Number(order.at) || 0;
  if (at && now - at > 7 * DAY) { stats.del_stale++; return; }

  /* 装了通行密钥：口令再对也不算数，得有硬件在这次的指令上签过名。
     挑战绑的是「要删哪些 id + nonce + 时刻」，改一个字就验不过，重放也无效。 */
  if (passkey && passkey.publicJwk) {
    const a = order.assert || {};
    let challenge = '';
    try { challenge = await challengeFor(delChallengeParts(order.ids, order.nonce, at)); } catch (e) { challenge = ''; }
    const okPass = challenge
      ? await verifyAssertion(passkey.publicJwk, {
        clientDataJSON: a.clientDataJSON,
        authData: a.authData,
        signature: a.signature,
        expectedChallenge: challenge,
        expectedRpId: passkey.rpId,
        expectedOrigin: passkey.origin
      })
      : false;
    if (!okPass) { stats.del_nopass++; return; }
  }
  const nonce = String(order.nonce || '').slice(0, 64);
  if (nonce) {
    if (delNonces.has(nonce)) return;    /* 重放：删两次等于删一次 */
    delNonces.add(nonce);
    rl.delNonces.push({ n: nonce, t: now });
  }
  const list = order.ids.slice(0, 200);
  for (const item of list) {
    const id = String(item || '');
    if (!ID_RE.test(id)) continue;
    blocked.add(id);
    deletedIds.add(id);
    stats.del++;
  }
}

/* 从一份 jsonl 里把某些 id 整行拿掉 */
async function dropFromJsonl(path, ids) {
  const text = await readText(path);
  if (!text) return;
  const kept = lines(text).filter((line) => {
    try { return !ids.has(JSON.parse(line).id); } catch { return true; }
  });
  await writeFile(path, kept.length ? kept.join('\n') + '\n' : '');
}

for (const line of body.split('\n')) {
  if (!line.trim()) continue;
  let ev; try { ev = JSON.parse(line); } catch { continue; }
  if (ev.event !== 'message' || !ev.message) continue;
  if (ev.time && ev.time > maxTime) maxTime = ev.time;
  stats.in++;

  let raw; try { raw = JSON.parse(ev.message); } catch { bump('bad_shape'); continue; }

  /* 控制消息：被读 / 续丝 / 远程删除 */
  if (raw && typeof raw === 'object' && raw.t) {
    if (raw.t === 'read') await handleRead(raw);
    else if (raw.t === 'mend') await handleMend(raw);
    else if (raw.t === 'del') await handleDelete(raw);
    else bump('bad_shape');
    continue;
  }

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

  /* 冷却：写下一条之后，同一台设备要等 cooldownHours 才能再写 */
  const cdMs = (Number(R.cooldownHours) || 0) * HOUR;
  if (!why && cdMs > 0) {
    const lastAt = Number(rl.wrote[deviceKey]) || 0;
    if (lastAt && now - lastAt < cdMs) {
      why = '同一台设备在冷却期内（' + R.cooldownHours + ' 小时）又写了一条';
    }
  }

  seenIds.add(id);
  seenContent.add(contentHash);
  rl.content[contentHash] = (rl.content[contentHash] || []).concat([now]);
  rl.devices[deviceKey] = (rl.devices[deviceKey] || []).concat([now]);
  rl.global.push(now);
  stats.ok++;
  if (shape.vis === 'private') stats.priv++;

  const record = { id, name, wish, mood, ts, vis: shape.vis, reason: why || null, meta };

  if (!why) rl.wrote[deviceKey] = now;   /* 冷却从真正写下这一刻起算 */
  if (why) quarantined.push(record);
  else if (shape.vis === 'private') vaultOut.push(record);
  else {
    accepted.push({ id, name, wish, mood, ts });
    if (meta && !metaKnown.has(id)) metaOut.push(meta);
  }
}

/* ---------------------------------------------------------------- 落盘 */
/* 远程删除：口令持有者在放映室里发出的指令，在这一步落地 */
if (deletedIds.size) {
  for (const id of deletedIds) {
    byId.delete(id);
    delete readsDoc.reads[id];
    delete readsDoc.mends[id];
  }
  readsChanged = true;
  await dropFromJsonl(vaultPath, deletedIds);
  await dropFromJsonl(queuePath, deletedIds);
  await dropFromJsonl(metaPath, deletedIds);
}

const acceptedIds = new Set(accepted.map((r) => r.id));
const merged = accepted.concat([...byId.values()].filter((r) => !acceptedIds.has(r.id)));
merged.sort((a, b) => (a.ts || 0) - (b.ts || 0));
const overCap = Math.max(0, merged.length - R.archiveCap);
const finalList = overCap ? merged.slice(overCap) : merged;
/* 有远程删除时也必须重写归档，哪怕这一轮没有新愿望 */
if (accepted.length || overCap || deletedIds.size) {
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

/* ---------------------------------------------------------------- 自动清理屏蔽名单
   名单里只应该留两种 id：
     · 已经归档、但被屏蔽的（不留在名单里就会重新被前台读出来）
     · 还躺在上游中转站缓存里的（撤掉就会重现）
   中转站 12 小时后会自动清掉老消息，届时这些 id 自然落出名单，不需要人工维护。 */
let pruned = 0;
if (blocked.size) {
  let relayIds = null;
  try {
    const all = await fetch(ENDPOINT + '/' + encodeURIComponent(TOPIC) + '/json?poll=1&since=all', { headers: { 'user-agent': 'wish-silk-collector/3.0' } });
    if (all.ok) {
      relayIds = new Set();
      (await all.text()).split('\n').filter(Boolean).forEach((line) => {
        try {
          const ev = JSON.parse(line);
          if (ev.event !== 'message') return;
          const w = JSON.parse(ev.message);
          if (w && w.id) relayIds.add(w.id);
        } catch {}
      });
    }
  } catch (e) { relayIds = null; }
  let list = Array.from(blocked);
  if (relayIds) {
    const archiveIds = new Set(finalList.map((r) => r.id));
    list = list.filter((id) => archiveIds.has(id) || relayIds.has(id));
    pruned = blocked.size - list.length;
  }
  /* 有新的远程删除时，即使中转站读不到也要把名单写下去，不能丢 */
  if (pruned || deletedIds.size) await writeJSON(J('data/blocked.json'), list.sort());
}

rl.total = (rl.total || 0) + accepted.length + vaultOut.length;
const dkeys = Object.keys(rl.devices);
if (dkeys.length > 5000) for (const k of dkeys.slice(0, dkeys.length - 5000)) delete rl.devices[k];
const wkeys = Object.keys(rl.wrote);
if (wkeys.length > 5000) for (const k of wkeys.slice(0, wkeys.length - 5000)) delete rl.wrote[k];
await writeJSON(rlPath, rl);
if (readsChanged) {
  readsDoc.updated = new Date().toISOString();
  await writeJSON(readsPath, readsDoc);
}
if (accepted.length || quarantined.length || vaultOut.length || deletedIds.size || readsChanged) {
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
    已屏蔽: stats.blocked, 超量截断: stats.flood,
    删除指令无效: stats.del_bad, 删除指令过期: stats.del_stale, 被读超量: stats.read_rate,
    删除缺通行密钥: stats.del_nopass,
    被读未签名: stats.read_unverified, 被读证明无效: stats.read_badpow,
    被读全站超额: stats.read_global, 被读同愿同日: stats.read_wishpace
  },
  删除: stats.del,
  被读: stats.read,
  续丝: stats.mend,
  归档: finalList.length,
  屏蔽名单: blocked.size - pruned + ' 条' + (pruned ? '（自动清掉 ' + pruned + ' 条过期的）' : ''),
  元数据: metaSaved,
  元数据解不开: stats.meta_lost,
  全站本小时: rl.global.length
}, null, 0));
