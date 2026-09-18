#!/usr/bin/env node
/**
 * 归档体检：中转站上的每一条愿望，到底有没有落进仓库？
 *
 *   node scripts/audit.mjs
 *
 * 中转站只保留 12 小时。凡是「还在中转站、但既没进归档也没进保险库」的愿望，
 * 都是随时会永久消失的。这个脚本把它们列出来，超时以非零码退出，方便挂进计划任务报警。
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../shared/sha256.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const J = (p) => resolve(ROOT, p);
const readText = async (p) => (existsSync(p) ? readFile(p, 'utf8') : '');
const readJSON = async (p, d) => { try { return JSON.parse(await readText(p)); } catch { return d; } };
const rows = (text) => text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const WARN_MINUTES = Number(process.env.WISH_AUDIT_WARN_MINUTES || 60);

async function main() {
  const cfg = await readJSON(J('data/config.json'), {});
  const endpoint = (cfg.endpoint || 'https://ntfy.sh').replace(/\/+$/, '');

  const stored = new Set();
  const publicRows = rows(await readText(J('data/wishes.jsonl')));
  publicRows.forEach((r) => stored.add(r.id));
  rows(await readText(J('data/private/vault.jsonl'))).forEach((r) => stored.add(r.id));
  rows(await readText(J('data/queue.jsonl'))).forEach((r) => stored.add(r.id));
  (await readJSON(J('data/blocked.json'), [])).forEach((i) => stored.add(i));

  /* 已归档内容的指纹：用来识别「同一条愿望被重复投递、采集器按内容去重丢弃」的情况，
     那不是丢失，不该报警。 */
  const contentKeys = new Set();
  publicRows.forEach((r) => contentKeys.add(sha256Hex(String(r.name) + '\u0000' + String(r.wish))));

  let events = [];
  try {
    const res = await fetch(endpoint + '/' + encodeURIComponent(cfg.topic) + '/json?poll=1&since=all', { headers: { 'user-agent': 'wish-silk-audit/1.0' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    text.split('\n').forEach((line) => {
      if (!line.trim()) return;
      try {
        const ev = JSON.parse(line);
        if (ev.event !== 'message' || !ev.message) return;
        const w = JSON.parse(ev.message);
        if (!w || !w.id) return;
        const dup = (w.name && w.wish) ? contentKeys.has(sha256Hex(String(w.name) + '\u0000' + String(w.wish))) : false;
        events.push({ id: w.id, time: ev.time || 0, vis: w.vis || 'public', dup });
      } catch {}
    });
  } catch (e) {
    console.error('读中转站失败：' + e.message);
    process.exitCode = 2;
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const missing = events.filter((e) => !stored.has(e.id) && !e.dup);
  const dupCount = events.filter((e) => !stored.has(e.id) && e.dup).length;
  const byAge = missing.map((m) => Object.assign({}, m, { ageMin: Math.round((now - m.time) / 60) })).sort((a, b) => b.ageMin - a.ageMin);

  console.log('中转站上还能读到的消息：' + events.length + ' 条');
  console.log('仓库里已有（归档 / 保险库 / 待审 / 屏蔽）：' + stored.size + ' 条');
  if (dupCount) console.log('按内容去重丢弃（同一条被重复投递，不算丢失）：' + dupCount + ' 条');
  console.log('真正还没落进仓库：' + missing.length + ' 条');

  if (!missing.length) {
    console.log('\n✓ 中转站上的内容全部已持久化。');
    process.exitCode = 0;
    return;
  }

  console.log('\n未持久化的（按滞留时间从久到新）：');
  byAge.slice(0, 25).forEach((m) => console.log('  ' + m.id + '  [' + m.vis + ']  已滞留 ' + m.ageMin + ' 分钟'));
  if (byAge.length > 25) console.log('  …还有 ' + (byAge.length - 25) + ' 条');

  const oldest = byAge[0] ? byAge[0].ageMin : 0;
  console.log('\n最久的一条已经在中转站上等了 ' + oldest + ' 分钟；中转站在 12 小时（720 分钟）后会自动删除。');
  if (oldest >= WARN_MINUTES) {
    console.log('⚠ 超过 ' + WARN_MINUTES + ' 分钟仍未归档，立刻跑一次：node scripts/watchdog.mjs');
    process.exitCode = 1;
    return;
  }
  console.log('（暂未超过 ' + WARN_MINUTES + ' 分钟阈值，可以再等等。）');
  process.exitCode = 0;
}

await main();
