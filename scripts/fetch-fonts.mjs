#!/usr/bin/env node
/**
 * 下载并自托管拉丁展示字体。
 * 中文（Noto Serif SC）体积太大，改由 assets/js/fonts.js 在运行时按需装载。
 * 用法：node scripts/fetch-fonts.mjs
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FONT = resolve(ROOT, 'assets/fonts');
const OUT_CSS = resolve(ROOT, 'assets/css/fonts.css');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const FAMILIES = [
  { css: 'Bodoni+Moda:ital,opsz,wght@0,6..96,400..900;1,6..96,400..900', slug: 'bodoni-moda' },
  { css: 'Cinzel:wght@400..900', slug: 'cinzel' },
  { css: 'Jost:ital,wght@0,100..900;1,100..900', slug: 'jost' }
];
const KEEP = new Set(['latin', 'latin-ext']);

await mkdir(OUT_FONT, { recursive: true });
const faces = [];

for (const fam of FAMILIES) {
  const url = 'https://fonts.googleapis.com/css2?family=' + fam.css + '&display=swap';
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) { console.error('css failed', fam.css, res.status); continue; }
  const css = await res.text();

  const blocks = css.split('/*').slice(1);
  for (const block of blocks) {
    const label = block.slice(0, block.indexOf('*/')).trim();
    if (!KEEP.has(label)) continue;
    const body = block.slice(block.indexOf('*/') + 2);
    const fam2 = (body.match(/font-family:\s*'([^']+)'/) || [])[1];
    const style = (body.match(/font-style:\s*(\w+)/) || [])[1] || 'normal';
    const weight = (body.match(/font-weight:\s*([\d\s]+);/) || [])[1] || '400';
    const src = (body.match(/url\((https:[^)]+\.woff2)\)/) || [])[1];
    const range = (body.match(/unicode-range:\s*([^;]+);/) || [])[1];
    if (!src || !fam2) continue;

    const part = src.split('/').pop().split('?')[0];
    const name = fam.slug + '-' + style + '-' + label + '.woff2';
    const file = resolve(OUT_FONT, name);
    if (!existsSync(file)) {
      const bin = await fetch(src, { headers: { 'user-agent': UA } });
      if (!bin.ok) { console.error('woff2 failed', src, bin.status); continue; }
      await writeFile(file, Buffer.from(await bin.arrayBuffer()));
    }
    faces.push({ fam: fam2, style, weight: weight.trim(), name, range });
  }
}

const lines = ['/* 自托管拉丁字体 —— 由 scripts/fetch-fonts.mjs 生成，请勿手改 */', ''];
for (const f of faces) {
  lines.push('@font-face {');
  lines.push("  font-family: '" + f.fam + "';");
  lines.push('  font-style: ' + f.style + ';');
  lines.push('  font-weight: ' + f.weight + ';');
  lines.push('  font-display: swap;');
  lines.push("  src: url('../fonts/" + f.name + "') format('woff2');");
  if (f.range) lines.push('  unicode-range: ' + f.range + ';');
  lines.push('}');
  lines.push('');
}
await writeFile(OUT_CSS, lines.join('\n'));
console.log('faces:', faces.length, '-> assets/css/fonts.css');
