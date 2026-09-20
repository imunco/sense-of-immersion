import puppeteer from 'puppeteer-core';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const server = await startServer(ROOT, 0);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, protocolTimeout: 300000,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
await p.goto(server.url + '/trailer/scene.html', { waitUntil: 'load' });
await p.waitForFunction('window.__ready === true');
for (const kind of ['png', 'jpeg']) {
  const t0 = Date.now(); let bytes = 0;
  for (let i = 0; i < 12; i++) {
    await p.evaluate((v) => window.__seek(v), 17000 + i * 33);
    const buf = kind === 'png' ? await p.screenshot({ type: 'png' }) : await p.screenshot({ type: 'jpeg', quality: 96 });
    bytes += buf.length;
  }
  const dt = (Date.now() - t0) / 12;
  console.log(kind + ': ' + dt.toFixed(0) + ' ms/frame · ' + (bytes / 12 / 1024).toFixed(0) + ' KB/frame · full 1368 frames ≈ ' + ((dt * 1368) / 60000).toFixed(1) + ' min');
}
await b.close(); await server.close();
