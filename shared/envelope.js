/* 信封加密 —— 浏览器密封，只有拿得出后台口令的人能拆开。
   方案：临时 ECDH(P-256) → HKDF-SHA256 → AES-256-GCM。
   站点公钥是公开的（data/config.json 的 siteKey）；
   私钥用口令派生的密钥加密后放在 data/private/keys.json。 */
import { toB64, fromB64 } from './crypto.js';

const te = new TextEncoder();
const td = new TextDecoder();
const INFO = te.encode('yixian-meta-v1');
const ALG = { name: 'ECDH', namedCurve: 'P-256' };

async function aesFromSecret(bits) {
  const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: INFO },
    hk,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** 生成站点密钥对（只在 scripts/set-passphrase.mjs 里跑） */
export async function newSiteKeyPair() {
  const pair = await crypto.subtle.generateKey(ALG, true, ['deriveBits']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicJwk: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }, privateJwk: priv };
}

/** 浏览器侧：把任意对象密封给站点 */
export async function sealForSite(sitePublicJwk, value) {
  const eph = await crypto.subtle.generateKey(ALG, true, ['deriveBits']);
  const site = await crypto.subtle.importKey('jwk', sitePublicJwk, ALG, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: site }, eph.privateKey, 256);
  const key = await aesFromSecret(bits);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(value)));
  const epk = await crypto.subtle.exportKey('jwk', eph.publicKey);
  return { v: 1, epk: { kty: 'EC', crv: 'P-256', x: epk.x, y: epk.y }, iv: toB64(iv), ct: toB64(ct) };
}

/** 采集器 / 后台侧：用站点私钥拆开信封 */
export async function openFromSite(privateJwk, env) {
  if (!env || !env.epk || !env.iv || !env.ct) throw new Error('bad envelope');
  const priv = await crypto.subtle.importKey('jwk', privateJwk, ALG, false, ['deriveBits']);
  const epk = await crypto.subtle.importKey('jwk', env.epk, ALG, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: epk }, priv, 256);
  const key = await aesFromSecret(bits);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, key, fromB64(env.ct));
  return JSON.parse(td.decode(pt));
}
