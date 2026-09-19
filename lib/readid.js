/* 读的唯一化 —— 服务端那一半。
   ------------------------------------------------------------------
   为什么需要它：浏览器里的 localStorage 是一个随机值，清掉就是「新人」，
   所以任何只靠它的「一天一次」都只是装饰。
   不受浏览器存储控制的信号只有两个：我们自己签发的 cookie，和来源地址。
   这一层两样都用，但都不落盘：
     · cookie 里放 随机 sid . 到期时间 . 签名（HMAC-SHA256）。只认签过名的，
       客户端改不了、也造不出新的 —— 要伪造得先拿到 WISH_READ_SECRET。
     · 来源地址当场算成 HMAC(secret, 'ip:' + 地址 + ':' + 当天)。每天换盐，
       换日即失联；地址本身不写进任何文件、不进日志。它只是一道兜底，
       防止「清 cookie 就再来一次」，所以配额比 cookie 宽（默认一张网 3 条/天）。
   没有 WISH_READ_SECRET 时整层自动关闭：采集器照旧按「未签名」处理，
   站点行为回到从前（能跑，但唯一化是弱的）。 */
import { createHmac, randomBytes } from 'node:crypto';

export const SID_COOKIE = 'yixian_id';
export const SID_TTL = 400 * 24 * 3600 * 1000;   /* 浏览器 cookie 上限约 400 天 */
const MIN_SECRET = 16;

function secretOf(env) {
  const v = String((env && env.WISH_READ_SECRET) || '');
  return v.length >= MIN_SECRET ? v : '';
}
export function hasSecret(env) { return !!secretOf(env); }

function mac(key, text, len) {
  return createHmac('sha256', key).update(text).digest('hex').slice(0, len || 32);
}

export function signSid(env, sid, exp) {
  const key = secretOf(env);
  if (!key || !sid || !exp) return '';
  return mac(key, 'sid:' + sid + '.' + exp, 32);
}

export function verifySid(env, sid, exp, sig) {
  const want = signSid(env, sid, exp);
  if (!want || !sig) return false;
  return want === String(sig);
}

/* 当天的那把盐：换日即换代号，谁也追不到昨天 */
export function dayKey(now) {
  const d = new Date(now == null ? Date.now() : now);
  return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
}

export function ipPseudonym(env, ip, now) {
  const key = secretOf(env);
  if (!key || !ip) return '';
  return mac(key, 'ip:' + String(ip) + ':' + dayKey(now), 24);
}

export function newSid() { return randomBytes(12).toString('base64url'); }

/* Vercel 与常见反代都会给这些头之一 */
export function clientIp(req) {
  const h = (req && req.headers) || {};
  const list = String(h['x-forwarded-for'] || '');
  const first = list.split(',')[0].trim();
  if (first) return first;
  return String(h['x-real-ip'] || h['x-vercel-forwarded-for'] || '').split(',')[0].trim();
}

export function parseCookies(req) {
  const raw = String((req && req.headers && req.headers.cookie) || '');
  const out = {};
  raw.split(';').forEach(function (part) {
    const i = part.indexOf('=');
    if (i <= 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

export function cookieHeader(sid, exp, sig) {
  return SID_COOKIE + '=' + encodeURIComponent(sid + '.' + exp + '.' + sig) +
    '; Path=/; Max-Age=' + Math.floor(SID_TTL / 1000) +
    '; HttpOnly; SameSite=Lax; Secure';
}

/**
 * 认识来的人是谁。
 * 返回 { sid, exp, sig, fresh }。cookie 缺失、过期、签名不对 → fresh = true（发一张新的）。
 * 没配密钥时返回 fresh = true 且 sid 为空 —— 整层关闭，采集器那边走「未签名」。
 */
export function identity(req, env, now) {
  const t = now == null ? Date.now() : now;
  if (!hasSecret(env)) return { sid: '', exp: 0, sig: '', fresh: true, signed: false };
  const raw = parseCookies(req)[SID_COOKIE] || '';
  const parts = raw.split('.');
  if (parts.length === 3) {
    const sid = parts[0];
    const exp = Number(parts[1]) || 0;
    if (sid && exp > t && verifySid(env, sid, exp, parts[2])) {
      return { sid: sid, exp: exp, sig: parts[2], fresh: false, signed: true };
    }
  }
  const sid = newSid();
  const exp = t + SID_TTL;
  return { sid: sid, exp: exp, sig: signSid(env, sid, exp), fresh: true, signed: true };
}
