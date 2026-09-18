#!/usr/bin/env node
/**
 * 本地守夜人 —— 不依赖 GitHub 定时任务的兜底归档。
 *
 *   node scripts/watchdog.mjs
 *
 * 做三件事：跑一次采集 → 有变化就提交 → 推送。
 * 口令从 WISH_ADMIN_PASSPHRASE 环境变量或 .dsh-passphrase.local 读。
 * 由 Windows 计划任务每 15 分钟调用一次（scripts/install-watchdog.ps1）。
 */
import { readFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = resolve(ROOT, '.dsh-watchdog.log');
const stamp = () => new Date().toISOString();
const log = async (msg) => { console.log(msg); try { await appendFile(LOG, stamp() + '  ' + msg + '\n'); } catch (e) {} };

let pass = process.env.WISH_ADMIN_PASSPHRASE || '';
if (!pass && existsSync(resolve(ROOT, '.dsh-passphrase.local'))) {
  pass = (await readFile(resolve(ROOT, '.dsh-passphrase.local'), 'utf8')).trim();
}
if (!pass) { await log('没有找到口令，跳过本轮。'); process.exit(0); }

const run = (cmd, args) => execFileSync(cmd, args, {
  cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: Object.assign({}, process.env, { WISH_ADMIN_PASSPHRASE: pass })
});

/* 工作区如果有非 data 的改动，说明有人在改代码 —— 不要自动提交，跳过这一轮 */
const dirty = (() => { try { return run('git', ['status', '--porcelain']).trim(); } catch (e) { return ''; } })();
const unrelated = dirty.split('\n').filter(Boolean).filter((l) => l.indexOf(' data/') < 0);
if (unrelated.length) {
  await log('工作区有 ' + unrelated.length + ' 处非 data 的改动，本轮跳过（避免把开发中的改动自动提交）。');
  process.exit(0);
}

/* 先跟远端同步：GitHub Action 也可能同时提交过数据 */
try {
  run('git', ['pull', '--rebase', '--autostash', 'origin', 'main']);
} catch (e) {
  try { run('git', ['rebase', '--abort']); } catch (e2) {}
  await log('与远端同步失败（可能有冲突），本轮跳过，等下一轮。');
  process.exit(0);
}

let summary;
try {
  summary = run('node', ['scripts/collect.mjs']).trim().replace(/\s+/g, ' ');
} catch (e) {
  await log('采集失败：' + String(e.stderr || e.message || e).slice(0, 300));
  process.exit(1);
}

let changed = '';
try { changed = run('git', ['status', '--porcelain', 'data']).trim(); } catch (e) {}

if (!changed) { await log('无新内容。' + summary.slice(0, 120)); process.exit(0); }

try {
  run('git', ['add', 'data']);
  run('git', ['commit', '-m', 'archive: 守夜人归档 ' + stamp()]);
  run('git', ['push', 'origin', 'main']);
  await log('已归档并推送。' + summary.slice(0, 160));
} catch (e) {
  await log('提交或推送失败：' + String(e.stderr || e.message || e).slice(0, 300));
  process.exit(1);
}
