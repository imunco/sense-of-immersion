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
/* shared/ 是浏览器要 import 的模块（store.js → ../../shared/sha256.js），必须一起输出 */
const ITEMS = ['index.html', 'admin.html', 'assets', 'data', 'shared', 'robots.txt', 'sitemap.xml'];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const copied = [];
for (const item of ITEMS) {
  const src = resolve(ROOT, item);
  if (!existsSync(src)) { console.warn('跳过（不存在）: ' + item); continue; }
  await cp(src, resolve(OUT, item), { recursive: true });
  copied.push(item);
}
/* data/private/ 整体是**公开可取**的 —— 放映室在浏览器里解密，所以那里只能是
   公钥（passkey.json）和密文（keys/meta/vault/verifier）。
   但 ratelimit.json 是采集器自己的**服务端状态**：设备哈希、来源代号、哪天哪条被读过、
   删除指令的 nonce —— 浏览器一行都不读它。之前它跟着 data/ 一起被发到线上，
   等于把「地址的当天代号」和阅读时刻公开了，这超出了我们对外承诺的范围，所以从产物里删掉。
   （本地 scripts/serve.mjs 是直接读仓库的，不受影响。） */
const serverOnly = resolve(OUT, 'data/private/ratelimit.json');
if (existsSync(serverOnly)) { await rm(serverOnly, { force: true }); console.log('已从产物里移除: data/private/ratelimit.json'); }

await writeFile(resolve(OUT, '.nojekyll'), '');
console.log('已输出到 public/: ' + copied.join(', '));
