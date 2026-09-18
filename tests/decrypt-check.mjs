import { readFile } from 'node:fs/promises';
import { deriveKey, decryptJSON } from '../shared/crypto.js';
const cfg = JSON.parse(await readFile('data/config.json','utf8'));
const key = await deriveKey('yixian-2026', cfg.crypto.salt, cfg.crypto.iterations);
for (const f of ['data/private/meta.jsonl','data/queue.jsonl','data/private/keys.json','data/private/verifier.json']) {
  const text = await readFile(f,'utf8');
  let ok = 0, bad = 0;
  if (f.endsWith('.json')) { try { await decryptJSON(key, JSON.parse(text)); ok++; } catch { bad++; } }
  else for (const line of text.split('\n').filter(Boolean)) { try { await decryptJSON(key, JSON.parse(line).e); ok++; } catch { bad++; } }
  console.log(f + ' → 可解密 ' + ok + '，解不开 ' + bad);
}