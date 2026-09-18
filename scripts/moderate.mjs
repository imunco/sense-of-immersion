#!/usr/bin/env node
/**
 * 审核与放行。所有命令都可以加 --push，直接提交并推送（约一分钟后 Pages 生效）。
 *
 *   node scripts/moderate.mjs list                     列出被隔离待审的内容
 *   node scripts/moderate.mjs vault                    列出「仅自己可见」的愿望
 *   node scripts/moderate.mjs approve <id> [--push]    放行到蛛网
 *   node scripts/moderate.mjs reject  <id> [--push]    永久屏蔽
 *   node scripts/moderate.mjs publish <id> [--push]    把一条私密愿望改为公开
 *
 * 口令取自环境变量 WISH_ADMIN_PASSPHRASE。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveKey, decryptJSON } from '../shared/crypto.js';
import { unwrapKeyring } from '../shared/keyring.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const J = (p) => resolve(ROOT, p);
const readText = async (p, d = '') => (existsSync(p) ? readFile(p, 'utf8') : d);
const readJSON = async (p, d) => { try { return JSON.parse(await readText(p)); } catch { return d; } };
const writeJSON = async (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const parseLines = (t) => t.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const argv = process.argv.slice(2);
const push = argv.includes('--push');
const args = argv.filter((a) => a !== '--push');
const cmd = (args[0] || 'list').toLowerCase();
const id = args[1];

const pass = process.env.WISH_ADMIN_PASSPHRASE || '';
if (!pass) { console.error('需要口令：WISH_ADMIN_PASSPHRASE=... node scripts/moderate.mjs list'); process.exit(1); }

const cfg = await readJSON(J('data/config.json'), {});
if (!cfg.crypto) { console.error('data/config.json 里没有 crypto 配置，先跑 scripts/set-passphrase.mjs'); process.exit(1); }

const kek = await deriveKey(pass, cfg.crypto.salt, cfg.crypto.iterations);
try { await decryptJSON(kek, await readJSON(J('data/private/verifier.json'), null)); }
catch { console.error('口令不对。'); process.exit(1); }

const { dek } = await unwrapKeyring(kek, await readJSON(J('data/private/keys.json'), null));
const openLines = async (p) => {
  const out = [];
  for (const rec of parseLines(await readText(p))) {
    try { out.push(await decryptJSON(dek, rec.e)); } catch {}
  }
  return out;
};

async function commitAndPush() {
  if (!push) { console.log('（加 --push 可以直接提交并推送）'); return; }
  try {
    execFileSync('git', ['add', 'data'], { cwd: ROOT, stdio: 'inherit' });
    try { execFileSync('git', ['commit', '-m', 'moderate: 审核变更'], { cwd: ROOT, stdio: 'inherit' }); }
    catch { console.log('没有需要提交的改动。'); return; }
    execFileSync('git', ['push', 'origin', 'main'], { cwd: ROOT, stdio: 'inherit' });
    console.log('已推送，约一分钟后 Pages 重建生效。');
  } catch (e) { console.error('提交/推送失败，请手动处理：' + e.message); }
}

const qPath = J('data/queue.jsonl');
const vPath = J('data/private/vault.jsonl');
const aPath = J('data/wishes.jsonl');

async function dropLine(path, removeId) {
  const kept = parseLines(await readText(path)).filter((r) => r.id !== removeId);
  await writeFile(path, kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''));
}

if (cmd === 'list') {
  const queue = await openLines(qPath);
  if (!queue.length) { console.log('没有待审内容。'); process.exit(0); }
  console.log('待审 ' + queue.length + ' 条：\n');
  for (const p of queue) {
    console.log('  ' + p.id + '  ' + (p.vis === 'private' ? '[私密] ' : '') + p.name + '：' + p.wish);
    console.log('      理由：' + p.reason + '\n');
  }
  process.exit(0);
}

if (cmd === 'vault') {
  const vault = await openLines(vPath);
  if (!vault.length) { console.log('「仅自己可见」的愿望还没有。'); process.exit(0); }
  console.log('「仅自己可见」共 ' + vault.length + ' 条：\n');
  for (const p of vault) console.log('  ' + p.id + '  ' + p.name + '：' + p.wish);
  process.exit(0);
}

if (cmd === 'approve') {
  const hit = (await openLines(qPath)).find((p) => p.id === id);
  if (!hit) { console.error('队列里没有 ' + id); process.exit(1); }
  const rows = parseLines(await readText(aPath));
  if (!rows.some((r) => r.id === hit.id)) rows.push({ id: hit.id, name: hit.name, wish: hit.wish, mood: hit.mood, ts: hit.ts });
  rows.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  await writeFile(aPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await dropLine(qPath, id);
  console.log('已放行 ' + id + '。');
  await commitAndPush();
  process.exit(0);
}

if (cmd === 'publish') {
  const hit = (await openLines(vPath)).find((p) => p.id === id);
  if (!hit) { console.error('私密库里没有 ' + id); process.exit(1); }
  const rows = parseLines(await readText(aPath));
  if (!rows.some((r) => r.id === hit.id)) rows.push({ id: hit.id, name: hit.name, wish: hit.wish, mood: hit.mood, ts: hit.ts });
  rows.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  await writeFile(aPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await dropLine(vPath, id);
  console.log('已把 ' + id + ' 改为公开。');
  await commitAndPush();
  process.exit(0);
}

if (cmd === 'reject') {
  if (!id) { console.error('用法: reject <id>'); process.exit(1); }
  const blocked = await readJSON(J('data/blocked.json'), []);
  if (blocked.indexOf(id) < 0) blocked.push(id);
  await writeJSON(J('data/blocked.json'), blocked.sort());
  await dropLine(qPath, id);
  await dropLine(vPath, id);
  console.log('已屏蔽 ' + id + '（并移出队列与私密库）。');
  await commitAndPush();
  process.exit(0);
}

console.error('未知命令：' + cmd);
process.exit(1);
