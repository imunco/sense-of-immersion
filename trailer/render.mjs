/* 逐帧渲染 —— Chromium 截图 → 管道 → ffmpeg → mp4
   node trailer/render.mjs                 渲染成片
   node trailer/render.mjs stills 1.5 20 36   只出几张静帧，用来核对画面
   node trailer/render.mjs stills 41 stills/cta    指定输出目录
*/
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FFMPEG = resolve(HERE, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
const W = 1080, H = 1920, FPS = 30;

const argv = process.argv.slice(2);
const mode = argv[0] === 'stills' ? 'stills' : (argv[0] === 'og' ? 'og' : 'video');
/* brand = 平台版：落版不给网址和二维码，只给名字。url = 官网版。 */
const ENDING = argv.includes('brand') ? 'brand' : 'url';
const nums = argv.slice(1).filter((a) => !isNaN(parseFloat(a))).map(parseFloat);
const outArg = argv.slice(1).find((a) => isNaN(parseFloat(a)) && a !== 'brand');

async function open() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 300000,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb',
      '--font-render-hinting=none', '--disable-lcd-text', '--disable-dev-shm-usage',
      '--disable-background-timer-throttling']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  return { browser, page };
}

const server = await startServer(ROOT, 0);
const { browser, page } = await open();
page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const t0 = Date.now();
await page.goto(server.url + '/trailer/scene.html' + (ENDING === 'brand' ? '?ending=brand' : ''), { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__ready === true', { timeout: 60000 });
const fontOk = await page.evaluate(() => document.fonts.check('900 100px "Noto Serif SC"', '一线千愿'));
const dur = await page.evaluate(() => window.__duration);
console.log('ready in ' + (Date.now() - t0) + 'ms · CJK font ' + (fontOk ? 'ok' : 'MISSING') + ' · duration ' + dur + 'ms · ending=' + ENDING);

if (mode === 'og') {
  /* 分享卡：微信 / 知乎 / B站 抓 og:image 用，1200×630 */
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.goto(server.url + '/trailer/og.html', { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(async () => {
    const t = document.body.textContent + '一线千愿蛛丝很细却挂得住个愿望写下一句话它会被冲印成张还没有拍出来的电影海报挂上蛛网众人合著';
    await document.fonts.load('900 100px "Noto Serif SC"', t);
    await document.fonts.load('400 100px "Noto Serif SC"', t);
    await document.fonts.load('600 100px "Bodoni Moda"', 'uncodeappsicu');
    await document.fonts.load('400 100px "Cinzel"', 'AWISHCNM');
    await document.fonts.ready;
  });
  const dest = resolve(HERE, '../assets/og-cover.jpg');
  await page.screenshot({ path: dest, type: 'jpeg', quality: 88, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log('og-cover → ' + dest);
  await browser.close(); await server.close();
} else if (mode === 'stills') {
  const dir = resolve(HERE, outArg || (ENDING === 'brand' ? 'stills/平台版' : 'stills/官网版'));
  await mkdir(dir, { recursive: true });
  const list = nums.length ? nums : [1.5, 6, 12, 19, 27, 34, 41];
  for (const s of list) {
    await page.evaluate((ms) => window.__seek(ms), Math.round(s * 1000));
    const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } });
    const f = resolve(dir, 't' + String(s).replace('.', '_') + '.png');
    await writeFile(f, buf);
    console.log('· ' + f + '  ' + (buf.length / 1024).toFixed(0) + 'KB');
  }
  await browser.close(); await server.close();
} else {
  const total = Math.round((dur / 1000) * FPS);
  const outDir = resolve(HERE, 'out', ENDING === 'brand' ? '平台版' : '官网版');
  await mkdir(outDir, { recursive: true });
  const outMp4 = resolve(outDir, outArg || (ENDING === 'brand' ? '一线千愿-预告片-竖版-平台版.mp4' : '一线千愿-预告片-竖版-官网版.mp4'));
  const audio = resolve(HERE, 'out/trailer.wav');
  const hasAudio = await stat(audio).then(() => true).catch(() => false);
  const args = ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0'];
  if (hasAudio) args.push('-i', audio);
  args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p',
    '-profile:v', 'high', '-level', '4.2', '-g', String(FPS * 2), '-movflags', '+faststart');
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  args.push(outMp4);
  const ff = spawn(FFMPEG, args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const t1 = Date.now();
  for (let i = 0; i < total; i++) {
    const ms = Math.round((i * 1000) / FPS);
    await page.evaluate((v) => window.__seek(v), ms);
    /* JPEG 只做中间帧：比 PNG 快四倍，而最终本来就是 yuv420p */
    const buf = await page.screenshot({ type: 'jpeg', quality: 96, clip: { x: 0, y: 0, width: W, height: H } });
    if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain');
    if (i % 60 === 0) {
      const el = (Date.now() - t1) / 1000;
      console.log('  ' + String(i).padStart(4) + '/' + total + '  ' + el.toFixed(1) + 's  eta ' + (((total - i) / (i + 1)) * el).toFixed(0) + 's');
    }
  }
  ff.stdin.end();
  const [code] = await once(ff, 'close');
  await browser.close(); await server.close();
  const st = await stat(outMp4);
  console.log('done code=' + code + ' → ' + outMp4 + '  ' + (st.size / 1048576).toFixed(1) + 'MB  in ' + ((Date.now() - t1) / 1000).toFixed(0) + 's');
}
