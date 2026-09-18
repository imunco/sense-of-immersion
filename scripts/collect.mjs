#!/usr/bin/env node
/**
 * 采集器 / The Collector
 * 从 ntfy 公共中转站拉取新的愿望，去重后追加到 data/wishes.jsonl。
 * 由 .github/workflows/collect.yml 定时运行（也可本地 node scripts/collect.mjs）。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const J = (p) => resolve(ROOT, p);

const readText = async (p, fallback = '') => (existsSync(p) ? readFile(p, 'utf8') : fallback);
const readJSON = async (p, fallback = null) => {
  try { return JSON.parse(await readText(p)); } catch { return fallback; }
};

const cfg = await readJSON(J('data/config.json'), {});
const TOPIC = process.env.WISH_TOPIC || cfg.topic;
const ENDPOINT = (process.env.WISH_ENDPOINT || cfg.endpoint || 'https://ntfy.sh').replace(/\/$/, '');
if (!TOPIC) { console.error('missing topic'); process.exit(1); }

const LIMITS = { name: 24, wish: 160 };
const clean = (s, max) => String(s ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

const blocked = new Set(await readJSON(J('data/blocked.json'), []));
const archivePath = J('data/wishes.jsonl');
const cursorPath = J('data/cursor.json');

const existing = (await readText(archivePath)).split('\n').filter(Boolean);
const seen = new Set();
for (const line of existing) { try { seen.add(JSON.parse(line).id); } catch {} }

const cursor = await readJSON(cursorPath, { since: 'all' });
const since = cursor.since === 'all' ? 'all' : Math.max(0, Number(cursor.since) - 180);

const url = `${ENDPOINT}/${encodeURIComponent(TOPIC)}/json?poll=1&since=${since}`;
const res = await fetch(url, { headers: { 'user-agent': 'wish-silk-collector/1.0' } });
if (!res.ok) { console.error('poll failed', res.status); process.exit(1); }
const body = await res.text();

let added = 0, skipped = 0, maxTime = Number(cursor.since) || 0;
const fresh = [];
for (const line of body.split('\n')) {
  if (!line.trim()) continue;
  let ev; try { ev = JSON.parse(line); } catch { continue; }
  if (ev.event !== 'message' || !ev.message) continue;
  let w; try { w = JSON.parse(ev.message); } catch { continue; }
  const rec = {
    id: clean(w.id, 40) || ev.id,
    name: clean(w.name, LIMITS.name),
    wish: clean(w.wish, LIMITS.wish),
    mood: ['silk', 'abyss', 'moon', 'dusk'].includes(w.mood) ? w.mood : 'silk',
    ts: Number(w.ts) || (ev.time ? ev.time * 1000 : Date.now()),
    tz: clean(w.tz, 48),
    lg: clean(w.lg, 16),
    ua: clean(w.ua, 64),
    vp: clean(w.vp, 16),
    ref: clean(w.ref, 80),
    src: clean(w.src, 24),
    n: Number(w.n) || 1,
  };
  if (!rec.name || !rec.wish) { skipped++; continue; }
  if (seen.has(rec.id) || blocked.has(rec.id)) { skipped++; continue; }
  seen.add(rec.id);
  fresh.push(rec);
  added++;
  if (ev.time && ev.time > maxTime) maxTime = ev.time;
}
fresh.sort((a, b) => a.ts - b.ts);

if (added) {
  await mkdir(dirname(archivePath), { recursive: true });
  const head = existing.length ? existing.join('\n') + '\n' : '';
  await writeFile(archivePath, head + fresh.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await writeFile(cursorPath, JSON.stringify({ since: maxTime || Math.floor(Date.now() / 1000), updated: new Date().toISOString() }, null, 2) + '\n');
}
console.log(`collected: +${added} skipped:${skipped} total:${seen.size}`);
