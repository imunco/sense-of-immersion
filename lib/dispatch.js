/* 共用：让 Vercel 上的函数去叫醒 GitHub Actions。
   为什么需要这一层：GitHub 的 on.schedule 在这个仓库实测从不触发，
   而浏览器里不能放 GitHub 令牌 —— 所以令牌只保存在 Vercel 的环境变量里。 */

const API = 'https://api.github.com';
let lastAt = 0;

export function cors(res, origin, host) {
  const allowed = (process.env.ALLOWED_ORIGINS || 'https://yixian-archive.vercel.app,https://imunco.github.io,http://127.0.0.1:4173,http://localhost:4173')
    .split(',').map((s) => s.trim()).filter(Boolean);
  /* 同源请求永远放行 —— 站点和接口现在在同一个域名下 */
  const sameOrigin = !!(host && origin && (origin === 'https://' + host || origin === 'http://' + host));
  const ok = sameOrigin || allowed.indexOf(origin) >= 0 || allowed.indexOf('*') >= 0;
  res.setHeader('Access-Control-Allow-Origin', ok ? origin : allowed[0] || '');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Vary', 'Origin');
  return ok;
}

export async function dispatch(force) {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO || 'imunco/sense-of-immersion';
  const workflow = process.env.GITHUB_WORKFLOW || 'collect.yml';
  const ref = process.env.GITHUB_REF || 'main';

  if (!token) return { ok: false, status: 501, message: '没有配置 GITHUB_DISPATCH_TOKEN' };

  /* 同一实例内 8 秒只叫一次 —— 连续提交也能各自触发；真正防滥用靠 Actions 的 concurrency 串行化 */
  const now = Date.now();
  if (!force && now - lastAt < 8000) {
    return { ok: true, status: 200, message: '刚刚已经叫过了，跳过', skipped: true };
  }

  const r = await fetch(API + '/repos/' + repo + '/actions/workflows/' + workflow + '/dispatches', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      'user-agent': 'yixian-archive-poke'
    },
    body: JSON.stringify({ ref: ref })
  });

  lastAt = now;
  if (r.status === 204) return { ok: true, status: 200, message: '已叫醒采集任务' };
  const text = await r.text();
  return { ok: false, status: r.status, message: text.slice(0, 300) };
}
