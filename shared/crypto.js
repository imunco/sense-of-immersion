/* 加密 —— 用 WebCrypto，浏览器与 Node 共用同一份实现。
   用途：把后台采集到的「基本信息」在入库前加密，
   只有拿得出后台口令的人才能在本地解开。 */
const te = new TextEncoder();
const td = new TextDecoder();

export const DEFAULT_ITERATIONS = 250000;

export function toB64(bytes) {
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < a.length; i += chunk) s += String.fromCharCode.apply(null, a.subarray(i, i + chunk));
  return btoa(s);
}

export function fromB64(str) {
  const bin = atob(str);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

export function randomSalt() {
  return toB64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function deriveKey(passphrase, saltB64, iterations) {
  const base = await crypto.subtle.importKey('raw', te.encode(String(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(saltB64), iterations: iterations || DEFAULT_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/* 数据密钥（DEK）：随机生成的 AES 密钥，用它加密所有记录；
   口令只负责把 DEK 包起来。这样换口令时只需重新包一次，历史数据不会丢。 */
export async function importAesKey(b64) {
  return crypto.subtle.importKey('raw', fromB64(b64), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function newAesKey() {
  return toB64(crypto.getRandomValues(new Uint8Array(32)));
}

export async function encryptJSON(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(value)));
  return { v: 1, iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptJSON(key, blob) {
  if (!blob || !blob.iv || !blob.ct) throw new Error('bad blob');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(blob.iv) }, key, fromB64(blob.ct));
  return JSON.parse(td.decode(pt));
}
