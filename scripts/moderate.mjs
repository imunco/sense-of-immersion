#!/usr/bin/env node
/**
 * 审核被隔离的愿望。
 *   node scripts/moderate.mjs list                    列出待审
 *   node scripts/moderate.mjs approve <id>            放上蛛网
 *   node scripts/moderate.mjs reject  <id>            永久屏蔽
 * 口令取自环境变量 WISH_ADMIN_PASSPHRASE，或第二个参数之后传入。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveKey, decryptJSON } from '../shared/crypto.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const J = (p) => resolve(ROOT, p);
const readText = async (p, d = '') => (existsSync(p) ? readFile(p, 'utf8') : d);
const readJSON = async (p, d) => { try { return JSON.parse(await readText(p)); } catch { return d; } };
const writeJSON = async (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const lines = (t) => t.split('\n').filter(Boolean);

const cmd = (process.argv[2] || 'list').toLowerCase();
const id = process.argv[3];
let pass = process.env.WISH_ADMIN_PASSPHRASE || '';
if (!pass) { for (const a of process.argv.slice(2)) { if (a.startsWith('--pass=')) pass = a.slice(7); } }
if (!pass) { console.error('需要口令：WISH_ADMIN_PASSPHRASE=... node scripts/moderate.mjs list'); process.exit(1); }

const cfg = await readJSON(J('data/config.json'), {});
if (!cfg.crypto) { console.error('data/config.json 里没有 crypto 配置，先跑 scripts/set-passphrase.mjs'); process.exit(1); }
const key = await deriveKey(pass, cfg.crypto.salt, cfg.crypto.iterations);

try { await decryptJSON(key, await readJSON(J('data/private/verifier.json'), null)); }
catch { console.error('口令不对。'); process.exit(1); }

const qPath = J('data/queue.jsonl');
const queue = lines(await readText(qPath)).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

if (cmd === 'list') {
  if (!queue.length) { console.log('没有待审内容。'); process.exit(0); }
  console.log('待审 ' + queue.length + ' 条：\n');
  for (const q of queue) {
    let p; try { p = await decryptJSON(key, q.e); } catch { p = { name: '?', wish: '(解密失败)', reason: '?' }; }
    console.log('  ' + q.id + '  ' + p.ts + '日  ' + p.name + '：' + p.wish);
    console.log('      理由：' + p.reason + '\n');
  }
  process.exit(0);
}

if (cmd === 'approve') {
  if (!id) { console.error('用法: approve <id>'); process.exit(1); }
  const hit = queue.find((q) => q.id === id);
  if (!hit) { console.error('队列里没有 ' + id); process.exit(1); }
  const p = await decryptJSON(key, hit.e);
  const arch = J('data/wishes.jsonl');
  const rows = lines(await readText(arch)).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (!rows.some((r) => r.id === p.id)) rows.push({ id: p.id, name: p.name, wish: p.wish, mood: p.mood, ts: p.ts });
  rows.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  await writeFile(arch, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  if (p.meta) await writeFile(J('data/private/meta.jsonl'), (await readText(J('data/private/meta.jsonl'))) + JSON.stringify({ id: p.id, e: hit.e }) + '\n');
  await writeFile(qPath, queue.filter((q) => q.id !== id).map((q) => JSON.stringify(q)).join('\n') + (queue.length > 1 ? '\n' : ''));
  console.log('已放行 ' + id + '，提交后就会出现在蛛网上。');
  process.exit(0);
}

if (cmd === 'reject') {
  if (!id) { console.error('用法: reject <id>'); process.exit(1); }
  const blocked = await readJSON(J('data/blocked.json'), []);
  if (blocked.indexOf(id) < 0) blocked.push(id);
  await writeJSON(J('data/blocked.json'), blocked.sort());
  await writeFile(qPath, queue.filter((q) => q.id !== id).map((q) => JSON.stringify(q)).join('\n') + (queue.length > 1 ? '\n' : ''));
  console.log('已屏蔽 ' + id + '。');
  process.exit(0);
}

console.error('未知命令：' + cmd);
process.exit(1);
