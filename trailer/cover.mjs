/* 把 1080×1920 的静帧裁成社媒尺寸，分成两套输出：
   平台版（无网址、无二维码）和官网版（带网址和二维码）。
   先跑静帧：
     node render.mjs stills 3 13.8 21.9 27.6 30.6 35.4 45
     node render.mjs stills brand 3 13.8 21.9 27.6 30.6 35.4 45
   再跑：node cover.mjs
*/
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FF = resolve(HERE, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
const OUT = resolve(HERE, 'out');
mkdirSync(OUT, { recursive: true });

/* [输出, 源静帧, 3:4 裁切的起始 y, 说明] */
const PLATES = [
  ['封面-3x4.jpg', 't35_4.png', 240, '封面：蛛网'],
  ['配图-1.jpg', 't3.png', 320, '标题卡'],
  ['配图-2.jpg', 't21_9.png', 230, '海报与四条丝线'],
  ['配图-3.jpg', 't13_8.png', 230, '署名'],
  ['配图-4.jpg', 't30_6.png', 300, '编号'],
  ['配图-5.jpg', 't35_4.png', 240, '蛛网'],
  ['配图-6.jpg', 't27_6.png', 300, '露珠落定']
];

const SETS = [
  { name: '平台版', src: resolve(HERE, 'stills/平台版'), wide: false },
  { name: '官网版', src: resolve(HERE, 'stills/官网版'), wide: true }
];

for (const set of SETS) {
  const to = resolve(OUT, set.name);
  mkdirSync(to, { recursive: true });
  const jobs = set.wide
    ? PLATES.concat([['封面-9x16.jpg', 't45.png', null, '竖版封面：落版与二维码']])
    : PLATES;
  let done = 0;
  for (const [out, src, y, note] of jobs) {
    const from = resolve(set.src, src);
    if (!existsSync(from)) { console.log('跳过 ' + set.name + '/' + out + '：找不到 ' + src); continue; }
    const args = y == null
      ? ['-y', '-i', from, '-q:v', '2', resolve(to, out)]
      : ['-y', '-i', from, '-vf', 'crop=1080:1440:0:' + y, '-q:v', '2', resolve(to, out)];
    execFileSync(FF, args, { stdio: 'ignore' });
    done++;
  }
  /* 文案跟着素材一起放，发帖时不用再翻别处（真正的源文件在 trailer/文案/，这里只是副本） */
  const doc = resolve(HERE, '文案', set.name + '.md');
  if (existsSync(doc)) copyFileSync(doc, resolve(to, '文案.md'));
  console.log('out/' + set.name + '/  ' + done + ' 张 + 文案.md');
}
