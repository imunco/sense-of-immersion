import { sha256Hex } from '../shared/sha256.js';
import { createHash, randomBytes } from 'node:crypto';
const cases = ['', 'abc', '愿所有认真写下的话，都有人读到。', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'x'.repeat(200000)];
let bad = 0;
for (const c of cases) {
  const mine = sha256Hex(c);
  const real = createHash('sha256').update(c, 'utf8').digest('hex');
  const ok = mine === real;
  if (!ok) bad++;
  console.log((ok ? 'OK  ' : 'FAIL') + ' len=' + c.length + ' ' + mine.slice(0, 24));
}
// 随机二进制
for (let i = 0; i < 200; i++) {
  const b = new Uint8Array(randomBytes(Math.floor(Math.random() * 300)));
  const a = sha256Hex(b);
  const c = createHash('sha256').update(b).digest('hex');
  if (a !== c) { bad++; console.log('FAIL random', b.length); break; }
}
console.log(bad === 0 ? 'SHA-256 全部通过 (含 200 组随机二进制)' : 'FAILURES: ' + bad);
// 性能
const t0 = Date.now();
let n = 0;
while (Date.now() - t0 < 1000) { sha256Hex('w_abc123|1234567'); n++; }
console.log('hash/s ≈', n);
