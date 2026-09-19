/* 信封往返 —— 锁在站点公钥上的元数据，只有口令派生的私钥才打得开。
   口令优先取环境变量，其次取本机那份 gitignored 的口令文件
   （和 silk-collect / webauthn 两个回归同一套做法，单独跑也不会假红）。
   没口令就跳过，退出码 0。 */
import { readFile } from 'node:fs/promises';
import { sealForSite, openFromSite } from '../shared/envelope.js';
import { deriveKey, decryptJSON } from '../shared/crypto.js';
import { unwrapKeyring } from '../shared/keyring.js';

let fails = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); return; }
  fails++;
  console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
}

const passphrase = (process.env.WISH_ADMIN_PASSPHRASE || '').trim()
  || (await readFile('.dsh-passphrase.local', 'utf8').catch(() => '')).trim();
if (!passphrase) {
  console.log('跳过：没有口令（WISH_ADMIN_PASSPHRASE 或 .dsh-passphrase.local）。');
  process.exit(0);
}

const cfg = JSON.parse(await readFile('data/config.json', 'utf8'));
const keys = JSON.parse(await readFile('data/private/keys.json', 'utf8'));
const key = await deriveKey(passphrase, cfg.crypto.salt, cfg.crypto.iterations);
/* keys.json 是「用口令派生的密钥包起来的密钥环」，不是私钥本身 */
const privateJwk = (await unwrapKeyring(key, keys)).sitePrivateJwk;
const meta = { tz: 'Asia/Shanghai', lg: 'zh-CN', ua: 'Chrome on Windows', vp: '1440x900', ref: 'direct', dv: 'd_abc123', n: 3, src: 'web' };
const env = await sealForSite(cfg.siteKey, meta);
console.log('信封长度:', JSON.stringify(env).length);
const back = await openFromSite(privateJwk, env);
ok('往返一致', JSON.stringify(back) === JSON.stringify(meta), JSON.stringify(back));
// 错误口令必须打不开
const wrong = await deriveKey('wrong-password', cfg.crypto.salt, cfg.crypto.iterations);
let opened = false;
try { await decryptJSON(wrong, keys); opened = true; } catch (e) { /* 期望就是打不开 */ }
ok('错误口令解不开密钥环', !opened);
// 篡改密文必须被发现
const tampered = Object.assign({}, env, { ct: env.ct.slice(0, -4) + 'AAAA' });
let detected = false;
try { await openFromSite(privateJwk, tampered); } catch (e) { detected = true; }
ok('AES-GCM 检出篡改', detected);

console.log(fails ? '\n' + fails + ' 项未通过' : '\n全部通过');
process.exit(fails ? 1 : 0);
