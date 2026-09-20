/* 本地静态服务 —— 给渲染器和人工预览用。
   node trailer/serve.mjs [port]   然后打开 http://127.0.0.1:4173/trailer/scene.html */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4'
};

export function startServer(root, port) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let p = decodeURIComponent(url.pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = join(base, normalize(p).replace(/^([/\\])+/, ''));
      if (!file.startsWith(base)) { res.writeHead(403).end('forbidden'); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch (e) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found: ' + req.url);
    }
  });
  return new Promise((ok, bad) => {
    server.on('error', bad);
    server.listen(port || 0, '127.0.0.1', () => {
      const info = server.address();
      ok({
        port: info.port,
        url: 'http://127.0.0.1:' + info.port,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

const invoked = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (invoked) {
  const port = Number(process.argv[2] || 4173);
  const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const s = await startServer(root, port);
  console.log('serving ' + root + ' at ' + s.url + '/trailer/scene.html');
}
