/* 确认每一份加密数据都能用当前口令解开。 */
import { readFile } from 'node:fs/promises';
import { deriveKey, decryptJSON } from '../shared/crypto.js';
import { unwrapKeyring } from '../shared/keyring.js';

const pass = process.env.WISH_ADMIN_PASSPHRASE;
if (!pass) { console.error('需要 WISH_ADMIN_PASSPHRASE'); process.exit(1); }
const cfg = JSON.parse(await readFile('data/config.json', 'utf8'));
const kek = await deriveKey(pass, cfg.crypto.salt, cfg.crypto.iterations);

try {
  await decryptJSON(kek, JSON.parse(await readFile('data/private/verifier.json', 'utf8')));
  console.log('verifier.json → 口令校验通过');
} catch { console.log('verifier.json → 口令校验失败 ❌'); process.exit(1); }

let dek;
try {
  dek = (await unwrapKeyring(kek, JSON.parse(await readFile('data/private/keys.json', 'utf8')))).dek;
  console.log('keys.json → 密钥环解开（数据密钥 + 站点私钥）');
} catch { console.log('keys.json → 密钥环打不开 ❌'); process.exit(1); }

for (const f of ['data/private/meta.jsonl', 'data/private/vault.jsonl', 'data/queue.jsonl']) {
  let text = '';
  try { text = await readFile(f, 'utf8'); } catch { console.log(f + ' → （不存在）'); continue; }
  let ok = 0, bad = 0;
  for (const line of text.split('\n').filter(Boolean)) {
    try { await decryptJSON(dek, JSON.parse(line).e); ok++; } catch { bad++; }
  }
  console.log(f + ' → 可解密 ' + ok + '，解不开 ' + bad + (bad ? ' ❌' : ''));
}
