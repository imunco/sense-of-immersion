import { readFile } from 'node:fs/promises';
const cfg = JSON.parse(await readFile('data/config.json','utf8'));
const B = 'https://imunco.github.io/sense-of-immersion';
const files = ['index.html','admin.html','data/wishes.jsonl','data/private/vault.jsonl','data/private/meta.jsonl','data/private/keys.json','data/private/verifier.json','data/blocked.json','data/config.json','assets/js/app.js'];
for (const f of files) {
  const r = await fetch(B + '/' + f, { cache: 'no-store' });
  const t = await r.text();
  console.log('  ' + (r.ok ? r.status : r.status) + '  ' + f.padEnd(28) + '  ' + t.length + ' 字节  ' + t.slice(0, 46).replace(/\n/g, ' '));
}
console.log('  中转站话题: https://ntfy.sh/' + cfg.topic);
for (const f of files) {}
