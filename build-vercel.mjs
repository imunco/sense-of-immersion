/* Vercel 构建：把仓库根目录的站点文件收进 public/。
   Vercel 用 public/ 作为静态输出，同时仍然把 api/ 当作函数。
   这样仓库结构不用动（GitHub Action 照旧往 data/ 写），
   而线上由 Vercel 一处提供：页面、资源、数据、接口。 */
import { rm, mkdir, cp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(ROOT, 'public');
const ITEMS = ['index.html', 'admin.html', 'assets', 'data', 'robots.txt'];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const copied = [];
for (const item of ITEMS) {
  const src = resolve(ROOT, item);
  if (!existsSync(src)) { console.warn('跳过（不存在）: ' + item); continue; }
  await cp(src, resolve(OUT, item), { recursive: true });
  copied.push(item);
}
await writeFile(resolve(OUT, '.nojekyll'), '');
console.log('已输出到 public/: ' + copied.join(', '));
