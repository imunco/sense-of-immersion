/* 安全回归测试：直接往中转站投喂各种攻击载荷，看采集器怎么处理。
   跑之前先 reset 游标，跑完检查归档 / meta / queue 三份文件。 */
import { readFile, writeFile } from 'node:fs/promises';
import { sha256Hex } from '../shared/sha256.js';
import { sealForSite } from '../shared/envelope.js';

const cfg = JSON.parse(await readFile('data/config.json', 'utf8'));
const topic = cfg.topic;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function mine(id, bits) {
  const prefix = '0'.repeat(bits || cfg.proofOfWork?.difficulty || 4);
  let n = 0;
  for (;;) { const pow = n.toString(36); if (sha256Hex(id + '|' + pow).slice(0, prefix.length) === prefix) return pow; n++; }
}
async function post(payload, label) {
  const r = await fetch('https://ntfy.sh/' + topic, { method: 'POST', body: JSON.stringify(payload) });
  console.log('  ↑ ' + label + ' → ' + r.status);
  await wait(700);
}

const stamp = Date.now().toString(36);
const mk = async (id, name, wish, mood, meta) => ({
  id: 'w_sec' + stamp + '_' + id, name, wish, mood, ts: Date.now(),
  pow: mine('w_sec' + stamp + '_' + id), hp: '', ft: 5000,
  env: meta ? await sealForSite(cfg.siteKey, meta) : null
});

/* 把游标推到「现在」，只收这一批 */
const cursor = JSON.parse(await readFile('data/cursor.json', 'utf8'));
await writeFile('data/cursor.json', JSON.stringify({ since: Math.floor(Date.now() / 1000) - 2, updated: new Date().toISOString() }, null, 2) + '\n');

console.log('投喂攻击载荷：');
// 1 无工作量证明
await post({ id: 'w_sec_nopow' + stamp, name: '脚本', wish: '没有证明的垃圾信息', mood: 'silk', ts: Date.now() }, '1 无 PoW');
// 2 形状不符（超长署名 + 空愿望）
await post({ id: 'w_sec_shape' + stamp, name: 'x'.repeat(200), wish: '', mood: 'silk', ts: Date.now(), pow: mine('w_sec_shape' + stamp) }, '2 形状不符');
// 3 违禁词（推广）
await post(await mk('banned', '推广号', '加微信 买茶叶 全网最低价', 'silk', { tz: 'Asia/Shanghai', dv: 'd_attacker' }), '3 违禁词');
// 4 带链接
await post(await mk('link', '链接党', '快来 https://spam.example.com 看看', 'silk', { tz: 'Asia/Shanghai', dv: 'd_attacker' }), '4 带链接');
// 5 重复字符
await post(await mk('repeat', '复读机', '啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊', 'silk', { tz: 'Asia/Shanghai', dv: 'd_attacker' }), '5 重复字符');
// 6 正常愿望
await post(await mk('ok', '安全测试', '愿这套防护是真的有用。', 'abyss', { tz: 'Asia/Shanghai', lg: 'zh-CN', ua: 'Chrome on Windows', vp: '1440x900', ref: 'direct', dv: 'd_good01', n: 1, src: 'test' }), '6 正常');
// 7 同一设备连发 8 条（上限 6/小时）
for (let i = 0; i < 8; i++) {
  await post(await mk('flood' + i, '刷屏' + i, '第 ' + i + ' 条刷屏内容，用来测试每设备限流。', 'silk', { tz: 'Asia/Shanghai', dv: 'd_flood01' }), '7.' + i + ' 洪水');
}
// 8 元数据信封被篡改
const tampered = await mk('tamper', '篡改者', '这条的信封被人动过手脚。', 'silk', null);
const good = await sealForSite(cfg.siteKey, { tz: 'Asia/Shanghai', dv: 'd_tamper' });
tampered.env = { v: 1, epk: good.epk, iv: good.iv, ct: good.ct.slice(0, -6) + 'AAAAAA' };
await post(tampered, '8 篡改信封');

console.log('\n等采集器把这一批拉走…');
