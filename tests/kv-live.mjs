/* 对着**真的**那台 Upstash 跑一遍限流 —— 不是对着假服务器。
   ------------------------------------------------------------------
   tests/kv.test.mjs 用的是一台假 Upstash，验的是我们的逻辑；这个文件验的是
   「线上那台真的按我们以为的方式回答」：INCR 计数、EXPIRE NX 真的设上了 TTL、
   超限真的返回 allowed=false、键里真的没有地址。

   没有配置就跳过（退出码 0）—— CI 里不配 KV 也不会挂。
   运行：node tests/kv-live.mjs            （读 .env.local，或直接用环境变量）
        node tests/kv-live.mjs --no-clean （跑完不删测试键） */

import fs from 'node:fs';
import { rateLimit, kvConfig } from '../lib/kv.js';

function loadEnv() {
  const env = Object.assign({}, process.env);
  try {
    const text = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i <= 0) continue;
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      /* Vercel CLI 写出来的值是带双引号的 */
      if (v.length > 1 && v[0] === '"' && v[v.length - 1] === '"') v = v.slice(1, -1);
      if (k && !env[k]) env[k] = v;
    }
  } catch (e) { /* 没有 .env.local 就用进程环境 */ }
  return env;
}

const env = loadEnv();
const cfg = kvConfig(env);
if (!cfg) {
  console.log('跳过：没有配置 KV_REST_API_URL / KV_REST_API_TOKEN（也就等于没有限流）。');
  process.exit(0);
}

const clean = !process.argv.includes('--no-clean');
const windowSec = 60;
const limit = 2;
/* 三次调用钉在同一个时刻上：窗口键里带时段（floor(t / 窗口)），
   不钉住的话正好跨过一分钟边界就会各算各的，测试会假红。 */
const now = Date.now();
const subject = 'selftest' + now.toString(16) + Math.random().toString(16).slice(2, 8);
const bucket = 'selftest';
const slot = Math.floor(now / (windowSec * 1000));
const key = 'yx:rl:' + bucket + ':' + subject + ':' + slot;
const auth = { authorization: 'Bearer ' + cfg.token, 'content-type': 'application/json' };

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  → ' + detail : ''));
  if (!ok) failed++;
}

console.log('目标：' + new URL(cfg.url).host + '  键：' + key + '  上限 ' + limit + ' 次 / ' + windowSec + 's');

const runs = [];
for (let i = 1; i <= 3; i++) runs.push(await rateLimit(env, bucket, subject, limit, windowSec, now));

console.log('三次：' + JSON.stringify(runs.map((r) => ({ counted: r.counted, allowed: r.allowed, count: r.count }))));
check('真的在记账（counted=true）', runs.every((r) => r.counted === true));
check('计数按 1 / 2 / 3 递增', runs.map((r) => r.count).join(',') === '1,2,3', runs.map((r) => r.count).join(','));
check('没超限时放行', runs[0].allowed === true && runs[1].allowed === true);
check('第 ' + (limit + 1) + ' 次拦住', runs[2].allowed === false);
check('没有降级（degraded 为空）', runs.every((r) => !r.degraded));

/* 真的设了 TTL：EXPIRE ... NX 在 Upstash 上被支持才行，不支持就会只涨不过期 */
const pipe = await fetch(cfg.url + '/pipeline', { method: 'POST', headers: auth, body: JSON.stringify([['TTL', key]]) });
const pipeJson = await pipe.json();
const ttl = Number(pipeJson && pipeJson[0] && pipeJson[0].result);
check('键上有 TTL（EXPIRE NX 生效）', Number.isFinite(ttl) && ttl > 0 && ttl <= windowSec, 'ttl=' + ttl);

/* 键里不能出现地址 */
const sum = await import('../lib/kv.js').then((m) => m.subjectKey(env, '203.0.113.7', Date.now()));
check('键里只有当天代号，没有地址', !sum.includes('203.0.113') && /^[0-9a-f]{24}$/.test(sum), sum);

if (clean) {
  await fetch(cfg.url + '/pipeline', { method: 'POST', headers: auth, body: JSON.stringify([['DEL', key]]) });
  console.log('已删掉测试键。');
}

console.log(failed ? '✗ ' + failed + ' 项没过' : '✓ 真的那台 Upstash 全过');
process.exit(failed ? 1 : 0);
