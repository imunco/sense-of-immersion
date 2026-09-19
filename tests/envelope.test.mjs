import { readFile } from 'node:fs/promises';
import { sealForSite, openFromSite } from '../shared/envelope.js';
import { deriveKey, decryptJSON } from '../shared/crypto.js';
import { unwrapKeyring } from '../shared/keyring.js';
const cfg = JSON.parse(await readFile('data/config.json','utf8'));
const keys = JSON.parse(await readFile('data/private/keys.json','utf8'));
const key = await deriveKey((process.env.WISH_ADMIN_PASSPHRASE || ''), cfg.crypto.salt, cfg.crypto.iterations);
/* keys.json 是「用口令派生的密钥包起来的密钥环」，不是私钥本身 */
const privateJwk = (await unwrapKeyring(key, keys)).sitePrivateJwk;
const meta = { tz: 'Asia/Shanghai', lg: 'zh-CN', ua: 'Chrome on Windows', vp: '1440x900', ref: 'direct', dv: 'd_abc123', n: 3, src: 'web' };
const env = await sealForSite(cfg.siteKey, meta);
console.log('envelope bytes:', JSON.stringify(env).length);
const back = await openFromSite(privateJwk, env);
console.log('roundtrip:', JSON.stringify(back) === JSON.stringify(meta) ? 'OK' : 'MISMATCH ' + JSON.stringify(back));
// 错误口令必须打不开
const wrong = await deriveKey('wrong-password', cfg.crypto.salt, cfg.crypto.iterations);
try { await decryptJSON(wrong, keys); console.log('FAIL 错误口令竟然解开了私钥'); }
catch { console.log('OK   错误口令无法解开私钥'); }
// 篡改密文必须被发现
const tampered = { ...env, ct: env.ct.slice(0, -4) + 'AAAA' };
try { await openFromSite(privateJwk, tampered); console.log('FAIL 篡改未被发现'); }
catch { console.log('OK   AES-GCM 检出篡改'); }
