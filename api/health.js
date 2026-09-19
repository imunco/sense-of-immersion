import { cors } from '../lib/dispatch.js';
import { hasKv } from '../lib/kv.js';
import { hasSecret } from '../lib/readid.js';

/* 健康检查：网页可以先用它确认归档服务在线。
   顺便如实报出两件容易被「以为配好了」的事情：
     · hasKv        —— 带存储的限流到底有没有接上（没接就等于没限流）
     · readSigned   —— 「被读」的唯一化密钥有没有两边都配上
   readSigned 不算泄密：/api/read 的响应里本来就带 signed 字段。 */
export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = cors(res, origin, req.headers.host);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (origin && !allowed) { res.status(403).json({ ok: false }); return; }
  res.status(200).json({
    ok: true,
    service: 'yixian-archive',
    hasToken: !!process.env.GITHUB_DISPATCH_TOKEN,
    repo: process.env.GITHUB_REPO || 'imunco/sense-of-immersion',
    workflow: process.env.GITHUB_WORKFLOW || 'collect.yml',
    hasKv: hasKv(process.env),
    readSigned: hasSecret(process.env),
    now: new Date().toISOString()
  });
}