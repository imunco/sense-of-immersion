/* 带存储的限流 —— 给 /api/poke 与 /api/read 用。
   ------------------------------------------------------------------
   为什么必须有存储：函数是无状态的，同一个实例里的计数器换一个实例就没了，
   所以"每 IP 每分钟几次"在没有外部存储时是句空话。
   这里对接的是 Vercel KV / Upstash Redis 的 REST 接口（纯 HTTP，不引任何 npm 包）：
     · KV_REST_API_URL + KV_REST_API_TOKEN（Vercel KV 注入的变量名）
     · 或者 UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
   没配就放行，并在响应里标明 —— 宁可让你知道没开，也不假装开着。

   隐私：写进 KV 的是「来源地址的当天代号」，不是地址本身
   （HMAC(密钥, 地址 + 当天)，和读的那一层同一套）。没配密钥时退化成一个固定哈希，
   只有拿得到 KV 的人才有可能反推，而 KV 是你自己的。 */
import { createHmac } from 'node:crypto';

export function kvConfig(env) {
  const e = env || {};
  const url = String(e.KV_REST_API_URL || e.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
  const token = String(e.KV_REST_API_TOKEN || e.UPSTASH_REDIS_REST_TOKEN || '');
  return url && token ? { url: url, token: token } : null;
}
export function hasKv(env) { return !!kvConfig(env); }

export function dayKey(now) {
  const d = new Date(now == null ? Date.now() : now);
  return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
}

/* 来源地址 → 24 位代号。换日即换盐，KV 里追不到昨天。 */
export function subjectKey(env, ip, now) {
  const secret = String((env && env.WISH_READ_SECRET) || 'yixian-rate-fixed');
  const salt = (env && env.WISH_READ_SECRET) ? dayKey(now) : 'fixed';
  return createHmac('sha256', secret).update('rl:' + String(ip || '') + ':' + salt).digest('hex').slice(0, 24);
}

/**
 * 记一次并判断是否超限。
 * 返回 { counted, allowed, count, limit, windowSec, degraded }
 * · 没配 KV → counted=false, allowed=true, degraded='no-kv'
 * · KV 出错 → counted=false, allowed=true, degraded='kv-error'（限流失败不挡正常用户）
 */
export async function rateLimit(env, bucket, subject, limit, windowSec, now) {
  const cfg = kvConfig(env);
  const t = now == null ? Date.now() : now;
  if (!cfg) return { counted: false, allowed: true, count: 0, limit: limit, windowSec: windowSec, degraded: 'no-kv' };
  const slot = Math.floor(t / (windowSec * 1000));
  const key = 'yx:rl:' + bucket + ':' + subject + ':' + slot;
  try {
    const r = await fetch(cfg.url + '/pipeline', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + cfg.token, 'content-type': 'application/json' },
      body: JSON.stringify([['INCR', key], ['EXPIRE', key, windowSec, 'NX']])
    });
    if (!r.ok) throw new Error('kv ' + r.status);
    const data = await r.json();
    const first = Array.isArray(data) ? data[0] : null;
    const count = Number(first && first.result);
    if (!Number.isFinite(count)) throw new Error('kv shape');
    return { counted: true, allowed: count <= limit, count: count, limit: limit, windowSec: windowSec, degraded: null };
  } catch (e) {
    return { counted: false, allowed: true, count: 0, limit: limit, windowSec: windowSec, degraded: 'kv-error' };
  }
}
