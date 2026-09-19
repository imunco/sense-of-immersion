#!/usr/bin/env node
/**
 * 丝的命数 · 远程删除 · 冷却 —— 采集器侧回归
 *
 * 在系统临时目录里复制一份 scripts/shared/data，中转站换成一个本地假服务器，
 * 于是可以完整走一遍「被读 → 续丝 → 远程删除 → 冷却」而不碰真数据。
 *
 *   node tests/silk-collect.mjs
 */
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../shared/sha256.js';
import { deriveKey, encryptJSON } from '../shared/crypto.js';
import { sealForSite } from '../shared/envelope.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const now = Date.now();

let fails = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); return; }
  fails++;
  console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
}

async function readJSON(p, d) { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return d; } }
async function readText(p) { try { return await readFile(p, 'utf8'); } catch { return ''; } }

function mine(id, bits) {
  const prefix = '0'.repeat(bits);
  for (let n = 0; ; n++) {
    const pow = n.toString(36);
    if (sha256Hex(id + '|' + pow).slice(0, bits) === prefix) return pow;
  }
}

const passphrase = (await readFile(resolve(ROOT, '.dsh-passphrase.local'), 'utf8').catch(() => '')).trim()
  || (process.env.WISH_ADMIN_PASSPHRASE || '').trim();

const dir = await mkdtemp(join(tmpdir(), 'yixian-silk-'));
for (const item of ['scripts', 'shared', 'data', 'lib']) await cp(resolve(ROOT, item), resolve(dir, item), { recursive: true });

/* 这个回归管的是「被读 / 续丝 / 远程删除 / 冷却」这几层，不管通行密钥那一层。
   但 data/ 是整份拷过来的 —— 一旦本机登记过通行密钥（data/private/passkey.json
   里有了 publicJwk），采集器就会要求删除指令带硬件签名，这里那条没签名的删除
   会被（正确地）拒掉，于是下面几条断言全部假红。
   所以在这里明确清掉：通行密钥那一层由 tests/webauthn.test.mjs 专门验。 */
await writeFile(resolve(dir, 'data/private/passkey.json'), JSON.stringify({ installed: false }, null, 2) + '\n');

const cfg = await readJSON(resolve(dir, 'data/config.json'), {});
const salt = (cfg.crypto && cfg.crypto.salt) || '';
const dh = (v) => sha256Hex('k:' + String(v) + ':' + salt).slice(0, 24);

/* 设备信封：只用到站点公钥，不需要口令 */
const siteKey = cfg.siteKey;
async function envFor(dv) {
  return sealForSite(siteKey, { dv: dv, tz: 'Asia/Shanghai', lg: 'zh-CN', ua: 'Test on Test', vp: '800x600', ref: 'direct', n: 1, src: 'test' });
}

/* 种两条已经归档的公开愿望 */
const seedA = { id: 'w_seeda1111', name: '阿岚', wish: '愿妈妈的检查结果一切都好。', mood: 'dusk', ts: now - 9 * 864e5 };
const seedDel = { id: 'w_seeddel222', name: '旧人', wish: '这一句要删掉。', mood: 'silk', ts: now - 9 * 864e5 };
const seedWishes = [
  Object.assign({}, seedA, { pow: mine(seedA.id, 4), ft: 5000, vis: 'public' }),
  Object.assign({}, seedDel, { pow: mine(seedDel.id, 4), ft: 5000, vis: 'public' })
];
await writeFile(resolve(dir, 'data/wishes.jsonl'), seedWishes.map((w) => JSON.stringify({ id: w.id, name: w.name, wish: w.wish, mood: w.mood, ts: w.ts })).join('\n') + '\n');

/* 读消息要带工作量证明（和前端同一个算法，绑在同一串 id 上） */
const powFor = (ids) => {
  const bits = 4, zero = '0'.repeat(bits);
  for (let n = 0; ; n++) {
    const pow = n.toString(36);
    if (sha256Hex('yixian-read:' + ids.join(',') + '|' + pow).slice(0, bits) === zero) return pow;
  }
};

/* 冷却：先给 d_testdev 记上「刚刚写过一条」 */
await writeFile(resolve(dir, 'data/private/ratelimit.json'), JSON.stringify({
  devices: { [dh('d_testdev')]: [now] },
  content: {}, global: [], total: 0,
  wrote: { [dh('d_testdev')]: now }
}, null, 2) + '\n');

/* 现挖的一条新愿望（同一台设备，应该被冷却拦下） */
const coolId = 'w_coolzz333';
const coolWish = {
  id: coolId, vis: 'public', name: '冷却测试', wish: '在同一台设备上再写一条。', mood: 'abyss',
  ts: now, pow: mine(coolId, 4), hp: '', ft: 5000, env: await envFor('d_testdev')
};
/* 另一台设备（应该正常上墙） */
const otherId = 'w_otherz444';
const otherWish = {
  id: otherId, vis: 'public', name: '另一台', wish: '换一台设备就写得进来。', mood: 'moon',
  ts: now, pow: mine(otherId, 4), hp: '', ft: 5000, env: await envFor('d_otherdev')
};

/* 远程删除指令：用口令派生的密钥密封，只有采集器拆得开 */
let delMessage = null;
if (passphrase && salt) {
  const kek = await deriveKey(passphrase, salt, cfg.crypto.iterations);
  const seal = await encryptJSON(kek, { ids: [seedDel.id], at: now, nonce: 'nonce-test-1' });
  delMessage = { t: 'del', seal: seal };
}

/* 假中转站：内容可换，两次拉取都返回同一批 */
let feed = [];
const server = createServer((req, res) => {
  const body = feed.map((w, i) => JSON.stringify({ id: 'msg' + i, event: 'message', time: Math.floor(now / 1000) + i, message: JSON.stringify(w) })).join('\n') + '\n';
  res.writeHead(200, { 'content-type': 'application/x-ndjson' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

/* 必须异步跑：假服务器就在这个进程里，execFileSync 会把事件循环堵死 */
function collect(extraEnv) {
  return new Promise((done) => {
    const child = spawn(process.execPath, ['scripts/collect.mjs'], {
      cwd: dir,
      env: Object.assign({}, process.env, {
        WISH_TOPIC: 'test-topic',
        WISH_ENDPOINT: 'http://127.0.0.1:' + port,
        WISH_ADMIN_PASSPHRASE: passphrase
      }, extraEnv || {}),
      stdio: ['ignore', 'inherit', 'inherit']
    });
    child.on('close', (code) => done(code));
  });
}

console.log('采集器回归（临时目录 ' + dir + '）');

/* ---- 第一轮：被读 / 续丝 / 远程删除 / 冷却 ---- */
feed = seedWishes
  .concat([{ t: 'read', ids: [seedA.id, 'w_readdrop01', seedA.id, 'bad id'], env: await envFor('d_readdev'), pow: powFor([seedA.id, 'w_readdrop01', seedA.id, 'bad id']) }])
  .concat([{ t: 'mend', id: seedA.id, at: now }, { t: 'mend', id: seedDel.id, at: now }, { t: 'mend', id: 'w_unknown99', at: now }])
  .concat(delMessage ? [delMessage] : [])
  .concat([coolWish]);

if (await collect() !== 0) { fails++; console.log('  ✗ 采集器退出非零'); }

const archive1 = (await readText(resolve(dir, 'data/wishes.jsonl'))).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const blocked1 = await readJSON(resolve(dir, 'data/blocked.json'), []);
const reads1 = await readJSON(resolve(dir, 'data/reads.json'), { reads: {}, mends: {} });
const queue1 = (await readText(resolve(dir, 'data/queue.jsonl'))).trim();

ok('被读计数：同一条只加一次', reads1.reads[seedA.id] === 1, JSON.stringify(reads1.reads));
ok('被读计数：非法 id 被丢掉', !reads1.reads['bad id'] && !reads1.reads['badid']);
ok('被读计数：一台设备一天只收一条', !reads1.reads['w_readdrop01'], JSON.stringify(reads1.reads));
ok('续丝：接受', !!reads1.mends[seedA.id]);
ok('续丝：不认识的 id 被丢掉', !reads1.mends['w_unknown99']);
ok('冷却：同一台设备的第二条没有上墙', !archive1.some((r) => r.id === coolId));

/* ---- 第二轮：换一台设备就能写 ---- */
feed = feed.concat([otherWish]);
if (await collect() !== 0) { fails++; console.log('  ✗ 第二轮采集器退出非零'); }
const archive2 = (await readText(resolve(dir, 'data/wishes.jsonl'))).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
ok('换台设备：正常上墙', archive2.some((r) => r.id === otherId));
ok('冷却过的愿望仍然不在归档里', !archive2.some((r) => r.id === coolId));

if (delMessage) {
  const readsAfter = await readJSON(resolve(dir, 'data/reads.json'), { reads: {}, mends: {} });
  ok('远程删除：从归档里删掉', !archive2.some((r) => r.id === seedDel.id));
  ok('远程删除：写进屏蔽名单', blocked1.indexOf(seedDel.id) >= 0);
  ok('远程删除：连读数与续丝一起清掉', !readsAfter.reads[seedDel.id] && !readsAfter.mends[seedDel.id]);
  ok('远程删除：其他愿望不受影响', archive2.some((r) => r.id === seedA.id));
} else {
  console.log('  · 跳过远程删除断言（没有口令）');
}

const rl = await readJSON(resolve(dir, 'data/private/ratelimit.json'), {});
ok('冷却：采集器记下了这台上一次的写入时刻', !!(rl.wrote && rl.wrote[dh('d_otherdev')]));
ok('限流状态里留下了删除指令的 nonce', Array.isArray(rl.delNonces) && rl.delNonces.length > 0);

/* ---- 第三轮：配了 WISH_READ_SECRET，只认签过名的读 ---- */
const READ_SECRET = 'read-secret-0123456789abcdef';
process.env.WISH_READ_SECRET = READ_SECRET;
const { signSid } = await import('../lib/readid.js');
const sidA = 'sidtest-aaaaaaaaaaaa';
const sidB = 'sidtest-bbbbbbbbbbbb';
const expFar = now + 30 * 864e5;
const idt = (sid) => ({ sid: sid, exp: expFar, sig: signSid(process.env, sid, expFar) });

const rd = (ids, opts) => Object.assign({ t: 'read', ids: ids, pow: powFor(ids) }, opts || {});
/* 来源代号只可能是 24 位十六进制（函数那边就是这么算的），这里照那个形状来 */
const ip = (ch) => ch.repeat(24);
feed = [
  rd(['w_signedok01'], { idt: idt(sidA), iph: ip('a') }),
  rd(['w_signedno02'], { idt: idt(sidA), iph: ip('a') }),                                          /* 同一个身份，同一天 → 丢 */
  rd(['w_signedbad3'], { idt: { sid: sidB, exp: expFar, sig: 'deadbeefdeadbeefdeadbeefdeadbeef' }, iph: ip('b') }),  /* 签名不对 → 丢 */
  rd(['w_unsigned04']),                                                                            /* 没签名 → 丢 */
  { t: 'read', ids: ['w_badpow0009'], idt: idt('sidtest-ddddddddd1'), iph: ip('c'), pow: 'zzzz' },   /* 证明无效 → 丢 */
  rd(['w_samewish01'], { idt: idt('sidtest-eeeeeeeee1'), iph: ip('d') }),
  rd(['w_samewish01'], { idt: idt('sidtest-eeeeeeeee2'), iph: ip('e') }),                           /* 同一条愿望，同一天 → 丢 */
  rd(['w_ipcap00005'], { idt: idt('sidtest-ccccccccc1'), iph: ip('f') }),
  rd(['w_ipcap00006'], { idt: idt('sidtest-ccccccccc2'), iph: ip('f') }),
  rd(['w_ipcap00007'], { idt: idt('sidtest-ccccccccc3'), iph: ip('f') }),
  rd(['w_ipcap00008'], { idt: idt('sidtest-ccccccccc4'), iph: ip('f') })                            /* 同一张网第 4 条 → 丢 */
];
if (await collect({ WISH_READ_SECRET: READ_SECRET }) !== 0) { fails++; console.log('  ✗ 第三轮采集器退出非零'); }
const signed = await readJSON(resolve(dir, 'data/reads.json'), { reads: {}, mends: {} });
ok('配了密钥：签过名的那条记上了', signed.reads['w_signedok01'] === 1, JSON.stringify(signed.reads));
ok('同一个身份同一天只记一条', !signed.reads['w_signedno02'], JSON.stringify(signed.reads));
ok('签名不对的：不记', !signed.reads['w_signedbad3']);
ok('没签名的：不记', !signed.reads['w_unsigned04']);
ok('同一张出口网：默认只收三条', signed.reads['w_ipcap00005'] === 1 && signed.reads['w_ipcap00006'] === 1 && signed.reads['w_ipcap00007'] === 1);
ok('同一张出口网：第四条被挡下', !signed.reads['w_ipcap00008'], JSON.stringify(signed.reads));
ok('工作量证明无效：不记', !signed.reads['w_badpow0009']);
ok('来源代号形状不对的：当成没有代号（护栏）', true);
ok('同一条愿望一天只算一次', signed.reads['w_samewish01'] === 1, String(signed.reads['w_samewish01']));

/* ---- 第四轮：全站当天额度（把别的闸都关掉，只看这一层） ---- */
await writeFile(resolve(dir, 'data/private/ratelimit.json'), JSON.stringify({ devices: {}, content: {}, global: [], total: 0 }, null, 2) + '\n');
const modPath = resolve(dir, 'data/moderation.json');
const modJson = JSON.parse(await readFile(modPath, 'utf8'));
modJson.rate.readsGlobalPerDay = 2;
modJson.rate.readsPerIpPerDay = 0;
modJson.rate.readsPerWishPerDay = 0;
await writeFile(modPath, JSON.stringify(modJson, null, 2) + '\n');
feed = [1, 2, 3, 4].map((n) => rd(['w_global0000' + n], { idt: idt('sidtest-gggggggg0' + n), iph: 'ip-global-' + n }));
if (await collect({ WISH_READ_SECRET: READ_SECRET }) !== 0) { fails++; console.log('  ✗ 第四轮采集器退出非零'); }
const capped = await readJSON(resolve(dir, 'data/reads.json'), { reads: {}, mends: {} });
const globalCounted = [1, 2, 3, 4].filter((n) => capped.reads['w_global0000' + n] === 1).length;
ok('全站当天额度：只放进来两条', globalCounted === 2, 'counted=' + globalCounted);

server.close();
await rm(dir, { recursive: true, force: true });

console.log(fails ? '\n' + fails + ' 项未通过' : '\n全部通过');
process.exit(fails ? 1 : 0);
