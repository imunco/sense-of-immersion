/* 验证「仅自己可见」：公开的进归档，私密的进保险库，违规的进隔离。 */
import { readFile, writeFile } from 'node:fs/promises';
import { sha256Hex } from '../shared/sha256.js';
import { sealForSite } from '../shared/envelope.js';

const cfg = JSON.parse(await readFile('data/config.json', 'utf8'));
const mod = JSON.parse(await readFile('data/moderation.json', 'utf8'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36);

function mine(id) {
  const bits = (mod.proofOfWork && mod.proofOfWork.difficulty) || 4;
  const prefix = '0'.repeat(bits);
  let n = 0;
  for (;;) { const pow = n.toString(36); if (sha256Hex(id + '|' + pow).slice(0, bits) === prefix) return pow; n++; }
}
async function post(payload, label) {
  const r = await fetch('https://ntfy.sh/' + cfg.topic, { method: 'POST', body: JSON.stringify(payload) });
  console.log('  ↑ ' + label + ' → ' + r.status);
  await wait(700);
}
async function pub(id, name, wish, mood, dv) {
  return { id, vis: 'public', name, wish, mood, ts: Date.now(), pow: mine(id), hp: '', ft: 5000,
           env: await sealForSite(cfg.siteKey, { tz: 'Asia/Shanghai', lg: 'zh-CN', ua: 'Chrome on Windows', vp: '1440x900', ref: 'direct', dv, n: 1, src: 'test' }) };
}
async function priv(id, name, wish, mood, dv) {
  const body = await sealForSite(cfg.siteKey, { name, wish, mood, ts: Date.now() });
  return { id, vis: 'private', prv: body, pow: mine(id), hp: '', ft: 5000,
           env: await sealForSite(cfg.siteKey, { tz: 'Asia/Shanghai', lg: 'zh-CN', ua: 'Chrome on Windows', vp: '1440x900', ref: 'direct', dv, n: 1, src: 'test' }) };
}

await writeFile('data/cursor.json', JSON.stringify({ since: Math.floor(Date.now() / 1000) - 2, updated: new Date().toISOString() }, null, 2) + '\n');

console.log('投递：');
await post(await pub('w_pvt' + stamp + '_open', '公开的人', '这条是要挂上蛛网给大家看的。', 'silk', 'd_open1'), '公开');
await post(await priv('w_pvt' + stamp + '_secret', '私密的人', '这条只有我自己和放映室能看到。', 'abyss', 'd_priv1'), '私密');
await post(await priv('w_pvt' + stamp + '_bad', '违规的人', '加微信 私聊我 有内部渠道', 'silk', 'd_priv2'), '私密但违规');
await post(await priv('w_pvt' + stamp + '_tamper', '破坏者', '信封被动过手脚的私密愿望。', 'silk', 'd_priv3').then(async (p) => {
  const good = await sealForSite(cfg.siteKey, { name: '破坏者', wish: '这条本该是私密的。', mood: 'silk', ts: Date.now() });
  p.prv = { v: 1, epk: good.epk, iv: good.iv, ct: good.ct.slice(0, -6) + 'AAAAAA' };
  return p;
}), '私密但信封损坏');
console.log('\n等采集器拉走…');
