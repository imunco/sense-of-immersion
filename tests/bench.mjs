import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox','--disable-gpu'] });
const p = await b.newPage();
await p.goto('http://127.0.0.1:4173/tests/modules.html', { waitUntil: 'networkidle2' });
const out = await p.evaluate(async () => {
  const m = await import('../assets/js/../js/store.js').catch(() => null);
  const sha = await import('/shared/sha256.js');
  const t0 = performance.now();
  let n = 0;
  while (performance.now() - t0 < 1000) { sha.sha256Hex('w_abc123xyz|' + n.toString(36)); n++; }
  const rate = n;
  const results = {};
  for (const bits of [3, 4]) {
    const prefix = '0'.repeat(bits);
    const t = performance.now();
    let k = 0;
    for (;;) { const pow = k.toString(36); if (sha.sha256Hex('w_benchmarkid|' + pow).slice(0, bits) === prefix) break; k++; }
    results[bits] = { hashes: k + 1, ms: Math.round(performance.now() - t) };
  }
  return { rate, results };
});
console.log('浏览器 SHA-256 速率 ≈ ' + out.rate + ' hash/s');
console.log('难度 3（期望 4096）：', JSON.stringify(out.results[3]));
console.log('难度 4（期望 65536）：', JSON.stringify(out.results[4]));
await b.close();
