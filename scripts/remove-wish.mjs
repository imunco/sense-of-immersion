#!/usr/bin/env node
/**
 * 永久删除某条愿望。
 *   node scripts/remove-wish.mjs <id> [<id> ...]
 * 会同时从 data/wishes.jsonl 里删掉，并把 id 写进 data/blocked.json，
 * 这样采集器以后也不会再把它收回来。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ids = process.argv.slice(2).filter(Boolean);
if (!ids.length) { console.error('用法: node scripts/remove-wish.mjs <id> [...]'); process.exit(1); }

const arch = resolve(ROOT, 'data/wishes.jsonl');
const blockedPath = resolve(ROOT, 'data/blocked.json');

const lines = existsSync(arch) ? (await readFile(arch, 'utf8')).split('\n').filter(Boolean) : [];
const kept = lines.filter((line) => {
  try { return ids.indexOf(JSON.parse(line).id) < 0; } catch { return true; }
});
await writeFile(arch, kept.length ? kept.join('\n') + '\n' : '');

const blocked = existsSync(blockedPath) ? JSON.parse(await readFile(blockedPath, 'utf8')) : [];
const merged = Array.from(new Set(blocked.concat(ids)));
await writeFile(blockedPath, JSON.stringify(merged, null, 2) + '\n');

console.log('删除 ' + (lines.length - kept.length) + ' 条，剩余 ' + kept.length + ' 条；已加入屏蔽名单。');
