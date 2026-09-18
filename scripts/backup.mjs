#!/usr/bin/env node
/**
 * 离线备份：把仓库里所有加密数据解密，导出成可读文件。
 *
 *   WISH_ADMIN_PASSPHRASE=<口令> node scripts/backup.mjs
 *
 * 产出在 backups/<时间戳>/ 下：
 *   wishes-public.json / .csv    公开愿望
 *   wishes-private.json / .csv   私密愿望（已解密，含基础信息）
 *   queue.json                   被隔离的内容（已解密）
 *   raw/                         仓库里的原始密文副本（不需要口令也能拷）
 *   manifest.json                统计
 * ⚠ backups/ 已在 .gitignore 里 —— 里面有明文，永远不要提交。
 */
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveKey, decryptJSON } from '../shared/crypto.js';
import { unwrapKeyring } from '../shared/keyring.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const J = (p) => resolve(ROOT, p);
const readText = async (p) => (existsSync(p) ? readFile(p, 'utf8') : '');
const readJSON = async (p, d) => { try { return JSON.parse(await readText(p)); } catch { return d; } };

const pass = process.env.WISH_ADMIN_PASSPHRASE;
const cfg = await readJSON(J('data/config.json'), {});
if (!cfg.crypto) { console.error('data/config.json 缺少 crypto 配置。'); process.exit(1); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = J('backups/' + stamp);
await mkdir(OUT, { recursive: true });

/* 原始密文，先原样拷一份（不需要口令） */
await cp(J('data'), resolve(OUT, 'raw'), { recursive: true });

function csv(rows, cols) {
  const cell = (v) => {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '\ufeff' + [cols.map((c) => c[0])].concat(rows.map((r) => cols.map((c) => cell(c[1](r))))).map((r) => r.join(',')).join('\r\n');
}

const pub = (await readText(J('data/wishes.jsonl'))).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const manifest = { at: new Date().toISOString(), public: pub.length, private: 0, queue: 0, decrypted: false };

await writeFile(resolve(OUT, 'wishes-public.json'), JSON.stringify(pub, null, 2));
await writeFile(resolve(OUT, 'wishes-public.csv'), csv(pub, [['时间', (r) => new Date(r.ts).toISOString()], ['署名', (r) => r.name], ['愿望', (r) => r.wish], ['丝线', (r) => r.mood], ['编号', (r) => r.id]]));

if (!pass) {
  console.warn('⚠ 没有 WISH_ADMIN_PASSPHRASE —— 只导出了公开部分，密文已原样拷贝到 raw/。');
} else {
  const kek = await deriveKey(pass, cfg.crypto.salt, cfg.crypto.iterations);
  await decryptJSON(kek, await readJSON(J('data/private/verifier.json'), null)).catch(() => { throw new Error('口令不对。'); });
  const { dek } = await unwrapKeyring(kek, await readJSON(J('data/private/keys.json'), null));

  const openAll = async (path) => {
    const out = [];
    for (const line of (await readText(path)).split('\n').filter(Boolean)) {
      try { out.push(await decryptJSON(dek, JSON.parse(line).e)); } catch {}
    }
    return out;
  };
  const priv = (await openAll(J('data/private/vault.jsonl'))).map((r) => Object.assign({}, r.meta || {}, r));
  const queue = (await openAll(J('data/queue.jsonl'))).map((r) => Object.assign({}, r.meta || {}, r));
  const meta = await openAll(J('data/private/meta.jsonl'));
  const metaById = new Map(meta.map((m) => [m.id, m]));
  const pubFull = pub.map((r) => Object.assign({}, metaById.get(r.id) || {}, r));

  await writeFile(resolve(OUT, 'wishes-public.json'), JSON.stringify(pubFull, null, 2));
  await writeFile(resolve(OUT, 'wishes-public.csv'), csv(pubFull, [['时间', (r) => new Date(r.ts).toISOString()], ['署名', (r) => r.name], ['愿望', (r) => r.wish], ['丝线', (r) => r.mood], ['语言', (r) => r.lg], ['时区', (r) => r.tz], ['设备', (r) => r.ua], ['视口', (r) => r.vp], ['来源', (r) => r.ref], ['设备号', (r) => r.dv], ['编号', (r) => r.id]]));
  await writeFile(resolve(OUT, 'wishes-private.json'), JSON.stringify(priv, null, 2));
  await writeFile(resolve(OUT, 'wishes-private.csv'), csv(priv, [['时间', (r) => new Date(r.ts).toISOString()], ['署名', (r) => r.name], ['愿望', (r) => r.wish], ['丝线', (r) => r.mood], ['语言', (r) => r.lg], ['时区', (r) => r.tz], ['设备', (r) => r.ua], ['编号', (r) => r.id]]));
  await writeFile(resolve(OUT, 'queue.json'), JSON.stringify(queue, null, 2));
  manifest.decrypted = true;
  manifest.private = priv.length;
  manifest.queue = queue.length;
  manifest.meta = meta.length;
}

await writeFile(resolve(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('备份完成 → ' + OUT);
console.log(JSON.stringify(manifest));
