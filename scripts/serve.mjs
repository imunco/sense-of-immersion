#!/usr/bin/env node
/**
 * 本地静态服务器 —— 只为了让 fetch('data/...') 和模块脚本在本地也能跑。
 *   node scripts/serve.mjs [port]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

/* 与 vercel.json 保持一致的安全响应头 —— 本地跑的就是线上的策略，
   这样测试能真的挡住内联脚本/样式被引进来。 */
const SECURITY = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    /* 中文字体按设计要试三个 CDN，所以样式与字体来源里必须放行它们 */
    "style-src 'self' https://fonts.googleapis.com https://fonts.loli.net https://fonts.geekzu.org",
    "font-src 'self' data: https://fonts.gstatic.com https://gstatic.loli.net https://fonts.geekzu.org",
    "img-src 'self' data:",
    "connect-src 'self' https://ntfy.sh https://*.ntfy.sh",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; '),
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()'
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = join(ROOT, normalize(pathname).replace(/^([.][.][\/\\])+/, ''));
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, Object.assign({
      'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    }, SECURITY));
    res.end(body);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log('serving ' + ROOT + ' on http://127.0.0.1:' + PORT + '/');
});
