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
const argv = process.argv.slice(2);
const push = argv.includes('--push');
const ids = argv.filter((a) => a !== '--push').filter(Boolean);
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
if (push) {
  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync('git', ['add', 'data'], { stdio: 'inherit' });
    try { execFileSync('git', ['commit', '-m', 'remove: 删除愿望 ' + ids.join(' ')], { stdio: 'inherit' }); } catch {}
    execFileSync('git', ['push', 'origin', 'main'], { stdio: 'inherit' });
    console.log('已推送，约一分钟后对所有人生效。');
  } catch (e) { console.error('推送失败，请手动处理：' + e.message); }
} else {
  console.log('（加 --push 可以直接提交并推送）');
}
