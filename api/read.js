import { cors } from '../lib/dispatch.js';
import { FALLBACK } from '../assets/js/config.js';
import { identity, cookieHeader, ipPseudonym, clientIp, hasSecret } from '../lib/readid.js';
import { rateLimit, subjectKey } from '../lib/kv.js';

/* 「被读」的唯一化入口。
   浏览器不再直接往中转站发这条消息，而是打这里：
   我们当场认出他是谁（签名 cookie）、把这个出口地址算成当天的代号，
   再把带签名的消息转发到中转站。采集器只认签名。

   为什么不落盘：地址只用来算一个每天换盐的哈希，算完就丢；
   函数里没有任何持久化，也没有日志。 */
const ENDPOINT = (process.env.WISH_ENDPOINT || FALLBACK.endpoint || 'https://ntfy.sh').replace(/\/+$/, '');
const TOPIC = process.env.WISH_TOPIC || FALLBACK.topic;
const MAX_IDS = 20;
const ID_RE = /^w_[A-Za-z0-9_]{4,40}$/;
/* 不想让函数看来源地址，把它设成 1：那一层整个跳过，
   唯一化就只剩签名 cookie（清 cookie 仍可重来，但清 localStorage 无效）。 */
const IP_OFF = String(process.env.WISH_READ_IP_OFF || '') === '1';

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = cors(res, origin, req.headers.host);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, message: '只接受 POST' }); return; }
  if (origin && !allowed) { res.status(403).json({ ok: false, message: '来源不在白名单里' }); return; }
  if (!TOPIC) { res.status(501).json({ ok: false, message: '没有配置 topic' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') { res.status(400).json({ ok: false, message: '看不懂这段' }); return; }
  /* 原样转发：不改顺序、不筛内容 —— 客户端的工作量证明是按这个数组算的，
     换一个字节就验不过。形状由采集器去审。 */
  const ids = (Array.isArray(body.ids) ? body.ids : []).filter(function (x) {
    return typeof x === 'string';
  }).slice(0, MAX_IDS);
  if (!ids.length) { res.status(400).json({ ok: false, message: '没有要记的东西' }); return; }
  /* 一批里连一个像 id 的都没有：早点退回去，别让垃圾占用下游。
     注意只在这里拒整批，绝不筛单个 —— 工作量证明是按原样这一串算的。 */
  if (!ids.some(function (x) { return ID_RE.test(x); })) {
    res.status(400).json({ ok: false, message: '没有一条是愿望编号' });
    return;
  }

  /* 先按来源地址挡一道：默认一小时 40 次。
     它挡的是「拿脚本猛打这个函数」，真正的唯一化在采集器那七层。 */
  const env = process.env;
  const gate = await rateLimit(env, 'read', subjectKey(env, clientIp(req)), 40, 3600);
  if (!gate.allowed) {
    res.setHeader('Retry-After', String(gate.windowSec));
    res.status(429).json({ ok: false, message: '太频繁了', limited: true });
    return;
  }

  const signed = hasSecret(env);
  const who = identity(req, env, Date.now());
  if (who.fresh && who.signed) res.setHeader('Set-Cookie', cookieHeader(who.sid, who.exp, who.sig));

  const payload = { t: 'read', ids: ids };
  if (typeof body.pow === 'string' && body.pow) payload.pow = body.pow.slice(0, 24);
  if (body.env && typeof body.env === 'object') payload.env = body.env;
  if (signed) {
    payload.idt = { sid: who.sid, exp: who.exp, sig: who.sig };
    if (!IP_OFF) {
      const iph = ipPseudonym(env, clientIp(req));
      if (iph) payload.iph = iph;
    }
  }

  try {
    const r = await fetch(ENDPOINT + '/' + encodeURIComponent(TOPIC), {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'text/plain;charset=utf-8', 'user-agent': 'yixian-read/1.0' }
    });
    if (!r.ok) { res.status(502).json({ ok: false, signed: signed, message: '中转站 ' + r.status }); return; }
  } catch (e) {
    res.status(502).json({ ok: false, signed: signed, message: String((e && e.message) || e) });
    return;
  }
  res.status(200).json({ ok: true, signed: signed, ids: ids.length });
}
