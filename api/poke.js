import { cors, dispatch } from '../lib/dispatch.js';

/* 访客触发：网页发现「有愿望还没归档」时打这里，服务端再去叫 GitHub Actions。
   浏览器永远拿不到 GitHub 令牌。 */
export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = cors(res, origin);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (req.method !== 'POST' && req.method !== 'GET') { res.status(405).json({ ok: false, message: '只接受 POST / GET' }); return; }
  if (origin && !allowed) { res.status(403).json({ ok: false, message: '来源不在白名单里' }); return; }

  try {
    const result = await dispatch(false);
    res.status(result.ok ? 200 : (result.status || 500)).json(result);
  } catch (e) {
    res.status(500).json({ ok: false, message: String((e && e.message) || e) });
  }
}
