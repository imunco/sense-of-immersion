import { cors } from '../lib/dispatch.js';

/* 健康检查：网页可以先用它确认归档服务在线。 */
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
    now: new Date().toISOString()
  });
}