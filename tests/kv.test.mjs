#!/usr/bin/env node
/**
 * 带存储的限流回归 —— 对接 Vercel KV / Upstash 的 REST 接口形状。
 *
 *   node tests/kv.test.mjs
 *
 * 用一个假的 Upstash 顶替：真的 INCR / EXPIRE 语义、真的 pipeline 响应形状。
 * 验的是：没配就放行、配了真的挡、地址不进存储、KV 挂了不挡正常用户。
 */
import { createServer } from 'node:http';
import { rateLimit, subjectKey, kvConfig, hasKv, dayKey } from '../lib/kv.js';

let fails = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); return; }
  fails++;
  console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
}

/* ---- 假 Upstash ---- */
const store = new Map();
const seen = [];
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  seen.push({ url: req.url, auth: req.headers.authorization || '', body: body });
  if (req.url !== '/pipeline') { res.writeHead(404).end('no'); return; }
  let cmds = [];
  try { cmds = JSON.parse(body); } catch (e) {}
  const out = cmds.map((c) => {
    const op = String(c[0] || '').toUpperCase();
    const key = String(c[1] || '');
    if (op === 'INCR') { const n = (store.get(key) || 0) + 1; store.set(key, n); return { result: n }; }
    if (op === 'EXPIRE') return { result: 1 };
    return { error: 'unknown' };
  });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(out));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const KV = 'http://127.0.0.1:' + server.address().port;

console.log('带存储的限流回归');

/* ---- 没配：放行，并且说明原因 ---- */
const bare = await rateLimit({}, 'poke', 'sub', 2, 300);
ok('没配 KV：放行', bare.allowed === true && bare.counted === false);
ok('没配 KV：能看出是"没开"而不是"通过"', bare.degraded === 'no-kv', JSON.stringify(bare));
ok('没配 KV：hasKv 为假', hasKv({}) === false && kvConfig({}) === null);
ok('两种变量名都认', !!kvConfig({ KV_REST_API_URL: 'u', KV_REST_API_TOKEN: 't' }) &&
  !!kvConfig({ UPSTASH_REDIS_REST_URL: 'u', UPSTASH_REDIS_REST_TOKEN: 't' }));

/* ---- 配了：真的挡 ---- */
const env = { KV_REST_API_URL: KV, KV_REST_API_TOKEN: 'tok', WISH_READ_SECRET: 'kv-test-secret-0123456789ab' };
const r1 = await rateLimit(env, 'poke', 'subject-a', 2, 300);
const r2 = await rateLimit(env, 'poke', 'subject-a', 2, 300);
const r3 = await rateLimit(env, 'poke', 'subject-a', 2, 300);
ok('第 1 次：放行', r1.allowed === true && r1.count === 1, JSON.stringify(r1));
ok('第 2 次：放行', r2.allowed === true && r2.count === 2, JSON.stringify(r2));
ok('第 3 次：挡住', r3.allowed === false && r3.count === 3, JSON.stringify(r3));
ok('挡的时候还是 counted（能看出是真的在数）', r3.counted === true && r3.degraded === null);

const r4 = await rateLimit(env, 'poke', 'subject-b', 2, 300);
ok('换一个主体：重新计数', r4.allowed === true && r4.count === 1);

const r5 = await rateLimit(env, 'read', 'subject-a', 2, 300);
ok('换一个桶：各算各的', r5.allowed === true && r5.count === 1);

/* ---- 写进去的是什么 ---- */
const key = [...store.keys()][0];
ok('键里带上了桶名与时间槽', /^yx:rl:poke:/.test(key), key);
const ipKey = subjectKey(env, '203.0.113.9', Date.now());
ok('代号里没有地址（键里用的也是代号）', !/[.:]/.test(ipKey) && key.indexOf('203.0') < 0, ipKey);
ok('带了过期时间（不会越攒越多）', seen.some((s) => s.body.indexOf('EXPIRE') >= 0));
ok('带了令牌', seen.every((s) => s.auth === 'Bearer tok'));

/* ---- 地址 → 代号 ---- */
const day1 = new Date('2026-01-01T10:00:00Z').getTime();
const day2 = new Date('2026-01-02T10:00:00Z').getTime();
const k1 = subjectKey(env, '203.0.113.7', day1);
ok('同一天同一个地址：代号一样', k1 === subjectKey(env, '203.0.113.7', day1 + 3600e3) && k1.length === 24, k1);
ok('换一天换代号', k1 !== subjectKey(env, '203.0.113.7', day2));
ok('换地址换代号', k1 !== subjectKey(env, '203.0.113.8', day1));
ok('代号里看不出地址', k1.indexOf('203') < 0 && k1.indexOf('113') < 0, k1);
ok('日期键按 UTC', dayKey(day1) === '2026-1-1');

/* ---- KV 挂了：不能挡住正常用户 ---- */
const down = await rateLimit({ KV_REST_API_URL: 'http://127.0.0.1:1', KV_REST_API_TOKEN: 't' }, 'poke', 's', 2, 300);
ok('KV 连不上：放行（限流失败不拦人）', down.allowed === true && down.degraded === 'kv-error', JSON.stringify(down));
const bad = await rateLimit({ KV_REST_API_URL: 'http://127.0.0.1:1', KV_REST_API_TOKEN: 't' }, 'poke', 's', 0, 300);
ok('额度是 0 也一样放行（同样因为连不上）', bad.allowed === true);

/* ---- 接到端点上：/api/poke 真的会 429 ---- */
store.clear();
const poke = (await import('../api/poke.js')).default;
function fakeRes() {
  const out = { code: 0, body: null, headers: {} };
  return {
    out: out,
    setHeader: function (k, v) { out.headers[String(k).toLowerCase()] = v; },
    status: function (c) { out.code = c; return this; },
    json: function (b) { out.body = b; return this; },
    end: function () { return this; }
  };
}
async function callPoke(ip) {
  const res = fakeRes();
  await poke({
    method: 'POST',
    headers: { origin: 'https://yixian-archive.vercel.app', host: 'yixian-archive.vercel.app', 'x-forwarded-for': ip },
    body: {}
  }, res);
  return res.out;
}
process.env.KV_REST_API_URL = KV;
process.env.KV_REST_API_TOKEN = 'tok';
process.env.WISH_READ_SECRET = 'kv-test-secret-0123456789ab';
const codes = [];
for (let i = 0; i < 7; i++) codes.push((await callPoke('203.0.113.9')).code);
ok('/api/poke：前 6 次不是 429', codes.slice(0, 6).every((c) => c !== 429), JSON.stringify(codes));
ok('/api/poke：第 7 次 429', codes[6] === 429, JSON.stringify(codes));
const other = await callPoke('203.0.113.10');
ok('/api/poke：换个地址又是新的一轮', other.code !== 429, String(other.code));

await new Promise((r) => server.close(r));
console.log(fails ? '\n' + fails + ' 项未通过' : '\n全部通过');
process.exitCode = fails ? 1 : 0;
