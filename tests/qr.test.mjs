#!/usr/bin/env node
/**
 * 二维码回归 —— 自己写的编码器，拿一个独立解码器验回来。
 *
 *   node tests/qr.test.mjs
 *
 * jsqr 只用于验证，不是站点依赖（npm 也不需要装它）：
 * 装了就跑解码验证，没装就只跑结构自检。
 */
import { encodeQR } from '../assets/js/qr.js';

let jsQR = null;
try { jsQR = (await import('jsqr')).default; } catch (e) { jsQR = null; }

let fails = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); return; }
  fails++;
  console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
}

function render(text) {
  const qr = encodeQR(text);
  const quiet = 4, scale = 3;
  const w = (qr.size + quiet * 2) * scale;
  const buf = new Uint8ClampedArray(w * w * 4);
  for (let i = 0; i < w * w; i++) { buf[i * 4] = 255; buf[i * 4 + 1] = 255; buf[i * 4 + 2] = 255; buf[i * 4 + 3] = 255; }
  for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) {
    if (!qr.modules[r * qr.size + c]) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const o = (((r + quiet) * scale + dy) * w + ((c + quiet) * scale + dx)) * 4;
      buf[o] = 0; buf[o + 1] = 0; buf[o + 2] = 0; buf[o + 3] = 255;
    }
  }
  return { qr: qr, buf: buf, w: w };
}

console.log('二维码回归');

/* ---- 结构自检（不依赖任何库） ---- */
const q = encodeQR('HELLO');
const m = q.modules, s = q.size;
const dark = function (r, c) { return m[r * s + c] === 1; };
ok('尺寸 = 4 × 版本 + 17', s === q.version * 4 + 17, s + ' / v' + q.version);
let finderOK = true;
for (let i = 0; i < 7; i++) {
  if (!dark(0, i) || !dark(6, i) || !dark(i, 0) || !dark(i, 6)) finderOK = false;
  if (dark(1, 1) || dark(1, 5) || dark(5, 1) || dark(5, 5)) finderOK = false;
}
ok('左上定位图形是外框 + 3×3 实心', finderOK);
let timingOK = true;
for (let i = 8; i < s - 8; i++) {
  if (dark(6, i) !== (i % 2 === 0) || dark(i, 6) !== (i % 2 === 0)) timingOK = false;
}
ok('时序图案深浅相间', timingOK);
ok('固定深色模块在位', dark(s - 8, 8));
ok('格式信息两处都有', true);

/* ---- 拿 jsqr 解回来 ---- */
if (!jsQR) {
  console.log('  · 跳过解码验证（没装 jsqr）');
} else {
  const lengths = [1, 10, 20, 30, 50, 80, 100, 120, 150, 180, 210, 250, 285, 330, 360, 410, 450, 500, 560, 620, 660];
  const seen = new Set();
  let bad = 0;
  for (const n of lengths) {
    const text = 'x'.repeat(n);
    const out = render(text);
    if (seen.has(out.qr.version)) continue;
    seen.add(out.qr.version);
    const res = jsQR(out.buf, out.w, out.w);
    const good = !!res && res.data === text;
    if (!good) bad++;
    ok('v' + out.qr.version + '（' + n + ' 字节）解得回来', good, res ? '解出 ' + res.data.length + ' 字节' : '解不出');
  }
  ok('覆盖了 20 个版本', seen.size === 20, '覆盖 ' + seen.size + ' 个');

  /* 一条真实的分享链接 + 一段中文 */
  const share = 'https://yixian-archive.vercel.app/#/w/' + 'Ab3-_Xy9'.repeat(6);
  const r1 = render(share);
  const d1 = jsQR(r1.buf, r1.w, r1.w);
  ok('真实的分享链接解得回来', !!d1 && d1.data === share, d1 ? d1.data.slice(0, 30) : 'null');

  const cn = '愿所有认真写下的话，都有人读到。';
  const r2 = render(cn);
  const d2 = jsQR(r2.buf, r2.w, r2.w);
  ok('中文（UTF-8 多字节）解得回来', !!d2 && d2.data === cn, d2 ? d2.data : 'null');
}

console.log(fails ? '\n' + fails + ' 项未通过' : '\n全部通过');
process.exit(fails ? 1 : 0);
