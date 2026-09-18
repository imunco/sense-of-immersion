import { dispatch } from '../lib/dispatch.js';

/* Vercel Cron 兜底：万一没人访问、也没人触发，每天至少归档一次。
   如果你用的是 Vercel Pro，可以把 vercel.json 里的 cron 改成 '*/5 * * * *'，
   那就完全不需要本机守夜人了。
   如果设置了 CRON_SECRET，Vercel 会带 Authorization: Bearer <CRON_SECRET>。 */
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization || '';
    if (auth !== 'Bearer ' + secret) { res.status(401).json({ ok: false, message: 'unauthorized' }); return; }
  }
  try {
    const result = await dispatch(true);
    res.status(result.ok ? 200 : (result.status || 500)).json(result);
  } catch (e) {
    res.status(500).json({ ok: false, message: String((e && e.message) || e) });
  }
}
