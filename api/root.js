/* 服务首页。用函数应答而不是静态文件 —— 静态输出目录在 Vercel 上不够可靠，
   而 /api/* 一直是好的。vercel.json 里把 / 重写到这里。 */
const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>一线千愿 · 归档服务</title>
<meta name="robots" content="noindex">
<style>
  body { margin:0; min-height:100vh; display:grid; place-content:center; gap:1.1rem;
    padding:2rem; text-align:center; font-family:"Noto Serif SC","Songti SC",serif;
    background:linear-gradient(180deg,#f8f6f1,#e8f2f1); color:#2c4a52; }
  h1 { font-size:clamp(1.5rem,5vw,2.4rem); letter-spacing:.18em; margin:0; font-weight:700; }
  p { margin:0; line-height:2; letter-spacing:.06em; color:#4d6b73; }
  code { font-family:ui-monospace,Consolas,monospace; background:#ffffff9c; padding:.15em .5em; border-radius:3px; }
  a { color:#c8735a; }
</style>
</head>
<body>
  <h1>一线千愿 · 归档服务</h1>
  <p>这里只跑一件事：被网页叫醒时，去触发 GitHub Actions 把愿望归档。</p>
  <p><a href="https://imunco.github.io/sense-of-immersion/">← 回到许愿馆</a></p>
  <p><code>GET /api/health</code> · <code>POST /api/poke</code></p>
</body>
</html>`;

export default function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=3600');
  res.end(HTML);
}
