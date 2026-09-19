import { cors, dispatch } from '../lib/dispatch.js';
import { rateLimit, subjectKey, hasKv } from '../lib/kv.js';
import { clientIp } from '../lib/readid.js';

/* 访客触发：网页发现「有愿望还没归档」时打这里，服务端再去叫 GitHub Actions。
   浏览器永远拿不到 GitHub 令牌。 */
export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = cors(res, origin, req.headers.host);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (req.method !== 'POST' && req.method !== 'GET') { res.status(405).json({ ok: false, message: '只接受 POST / GET' }); return; }
  if (origin && !allowed) { res.status(403).json({ ok: false, message: '来源不在白名单里' }); return; }

  /* 按来源地址限流：默认 5 分钟 6 次。没有 KV 时这一层是空的（响应里会说明）。 */
  const gate = await rateLimit(process.env, 'poke', subjectKey(process.env, clientIp(req)), 6, 300);
  if (!gate.allowed) {
    res.setHeader('Retry-After', String(gate.windowSec));
    res.status(429).json({ ok: false, message: '太频繁了，等一会儿再试', limited: true, kv: true });
    return;
  }

  try {
    const result = await dispatch(false);
    res.status(result.ok ? 200 : (result.status || 500)).json(Object.assign({}, result, {
      rateLimited: hasKv(process.env) ? !!gate.counted : false
    }));
  } catch (e) {
    res.status(500).json({ ok: false, message: String((e && e.message) || e) });
  }
}