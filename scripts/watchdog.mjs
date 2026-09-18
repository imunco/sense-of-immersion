#!/usr/bin/env node
/**
 * 本地守夜人 —— 不依赖 GitHub 定时任务的兜底归档。
 *
 *   node scripts/watchdog.mjs
 *
 * 做三件事：跟远端同步 → 跑一次采集 → 有变化就提交并推送。
 * 口令从 WISH_ADMIN_PASSPHRASE 环境变量或 .dsh-passphrase.local 读。
 * 由 Windows 计划任务每 15 分钟调用（scripts/install-watchdog.ps1）。
 *
 * 网络抖动很常见（这个环境里 git push 时不时被 reset），所以每一步都带重试，
 * 而且一次 pull 失败不会让整轮白跑 —— 先归档，推送留到下一轮也行。
 */
import { readFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = resolve(ROOT, '.dsh-watchdog.log');
const stamp = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = async (msg) => { console.log(msg); try { await appendFile(LOG, stamp() + '  ' + msg + '\n'); } catch (e) {} };

let pass = process.env.WISH_ADMIN_PASSPHRASE || '';
if (!pass && existsSync(resolve(ROOT, '.dsh-passphrase.local'))) {
  pass = (await readFile(resolve(ROOT, '.dsh-passphrase.local'), 'utf8')).trim();
}
if (!pass) { await log('没有找到口令，跳过本轮。'); process.exit(0); }

const sh = (cmd, args) => execFileSync(cmd, args, {
  cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: Object.assign({}, process.env, { WISH_ADMIN_PASSPHRASE: pass })
});
const err = (e) => String((e && (e.stderr || e.message)) || e).replace(/\s+/g, ' ').slice(0, 240);

/* 只有「已跟踪的源码文件被改动」才算正在开发中 */
const dirty = (() => { try { return sh('git', ['status', '--porcelain']).trim(); } catch (e) { return ''; } })();
const wip = dirty.split('\n').filter(Boolean).filter((l) => l.indexOf('??') !== 0 && l.indexOf(' data/') < 0);
if (wip.length) { await log('有 ' + wip.length + ' 个已跟踪文件处于改动中，本轮跳过（避免打断开发）。'); process.exit(0); }

async function pull() {
  for (let i = 1; i <= 3; i++) {
    try { sh('git', ['pull', '--rebase', '--autostash', 'origin', 'main']); return true; }
    catch (e) {
      try { sh('git', ['rebase', '--abort']); } catch (e2) {}
      if (i === 3) { await log('同步失败（第 3 次）：' + err(e) + ' —— 仍然继续归档本地数据。'); return false; }
      await sleep(1500 * i);
    }
  }
  return false;
}

async function push() {
  for (let i = 1; i <= 4; i++) {
    try { sh('git', ['push', 'origin', 'main']); return true; }
    catch (e) {
      if (i === 4) { await log('推送失败（第 4 次）：' + err(e) + ' —— 已提交在本地，下一轮再推。'); return false; }
      await sleep(2000 * i);
      try { sh('git', ['pull', '--rebase', '--autostash', 'origin', 'main']); } catch (e2) {}
    }
  }
  return false;
}

await pull();

let summary;
try { summary = sh('node', ['scripts/collect.mjs']).trim().replace(/\s+/g, ' '); }
catch (e) { await log('采集失败：' + err(e)); process.exit(1); }

let changed = '';
try { changed = sh('git', ['status', '--porcelain', 'data']).trim(); } catch (e) {}

if (!changed) { await log('无新内容。' + summary.slice(0, 130)); process.exit(0); }

try {
  sh('git', ['add', 'data']);
  sh('git', ['commit', '-m', 'archive: 守夜人归档 ' + stamp()]);
} catch (e) { await log('提交失败：' + err(e)); process.exit(1); }

if (await push()) await log('已归档并推送。' + summary.slice(0, 170));
