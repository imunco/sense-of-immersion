/* WebAuthn 通行密钥 —— 浏览器与采集器共用的一份校验实现。
   ------------------------------------------------------------------
   为什么是它、而不是 TOTP（微软/谷歌验证器那种 6 位码）：
   放映室是纯客户端的，口令不上传。TOTP 的密钥只能存在公开仓库（谁都能算出码）
   或被口令加密后存仓库（那用口令就能解开，挡不住拿到口令的人）——两种都是表演。
   通行密钥不一样：验证只需要**公钥**（公开无所谓），签名私钥留在你的硬件里
   （Windows Hello、手机上的通行密钥）。拿到口令的人造不出签名。
   所以它钉在唯一有破坏性的动作上：远程删除。

   只依赖 WebCrypto；只认 ES256（P-256），够平台认证器用了。
   注册时需要从 attestationObject 里抠出公钥，所以带一个极小的 CBOR 解码器。 */

const te = new TextEncoder();
const td = new TextDecoder();

export function b64u(bytes) {
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64u(str) {
  let b = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  const bin = atob(b);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
export async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}
export function randomChallenge() {
  return b64u(crypto.getRandomValues(new Uint8Array(32)));
}

/* 把一段内容绑成一个挑战：签名就绑在这段内容上，改一个字就验不过 */
export async function challengeFor(parts) {
  return b64u(await sha256(te.encode('yixian-passkey:' + parts.join('|'))));
}

/* 删除指令的挑战怎么拼 —— 前后端必须一模一样。
   id 先排序，省得顺序不同就验不过；nonce 与时刻一起绑进去，重放也没用。 */
export function delChallengeParts(ids, nonce, at) {
  return [[].concat(ids || []).slice().sort().join(','), String(nonce || ''), String(at)];
}

/* ---------------------------------------------------------------- CBOR */
/* 只处理确定长度（认证器就是这么发的）：整数、字节串、文本、数组、映射、真假空 */
function cborDecode(buf, off) {
  const first = buf[off];
  const major = first >> 5;
  const info = first & 31;
  let len = info, p = off + 1;
  if (info === 24) { len = buf[p]; p += 1; }
  else if (info === 25) { len = (buf[p] << 8) | buf[p + 1]; p += 2; }
  else if (info === 26) { len = ((buf[p] << 24) >>> 0) + (buf[p + 1] << 16) + (buf[p + 2] << 8) + buf[p + 3]; p += 4; }
  else if (info === 27) throw new Error('cbor: 64 位长度不支持');
  if (major === 0) return [len, p];
  if (major === 1) return [-1 - len, p];
  if (major === 2) return [buf.slice(p, p + len), p + len];
  if (major === 3) return [td.decode(buf.slice(p, p + len)), p + len];
  if (major === 4) {
    const out = [];
    for (let i = 0; i < len; i++) { const r = cborDecode(buf, p); out.push(r[0]); p = r[1]; }
    return [out, p];
  }
  if (major === 5) {
    const out = {};
    for (let i = 0; i < len; i++) {
      const k = cborDecode(buf, p); p = k[1];
      const v = cborDecode(buf, p); p = v[1];
      out[k[0]] = v[0];
    }
    return [out, p];
  }
  if (major === 7) {
    if (info === 20) return [false, p];
    if (info === 21) return [true, p];
    if (info === 22) return [null, p];
    return [undefined, p];
  }
  throw new Error('cbor: 看不懂的 major ' + major);
}

/* authData：rpIdHash(32) | 标志(1) | 计数(4) | [aaguid(16) | 凭据长度(2) | 凭据 | COSE 公钥] */
export function parseAuthData(a) {
  if (!a || a.length < 37) throw new Error('authData 太短');
  const rpIdHash = a.slice(0, 32);
  const flags = a[32];
  const signCount = ((a[33] << 24) >>> 0) + (a[34] << 16) + (a[35] << 8) + a[36];
  const out = { rpIdHash: rpIdHash, flags: flags, signCount: signCount, credentialId: null, publicJwk: null, alg: null };
  if (!(flags & 0x40) || a.length < 55) return out;   /* 没有带公钥 */
  const credLen = (a[53] << 8) | a[54];
  if (a.length < 55 + credLen) return out;
  out.credentialId = b64u(a.slice(55, 55 + credLen));
  try {
    const cose = cborDecode(a.slice(55 + credLen), 0)[0];
    const kty = cose[1], alg = cose[3], crv = cose[-1], x = cose[-2], y = cose[-3];
    out.alg = alg;
    if (kty === 2 && crv === 1 && x && y) {
      out.publicJwk = { kty: 'EC', crv: 'P-256', x: b64u(x), y: b64u(y), ext: false };
    }
  } catch (e) { /* 公钥解不出来就当没有 */ }
  return out;
}

/** 从注册结果里取出公钥。传 attestationObject 的 base64url。 */
export function parseAttestationObject(b64) {
  const obj = cborDecode(fromB64u(b64), 0)[0];
  if (!obj || !(obj.authData instanceof Uint8Array)) throw new Error('attestationObject 里没有 authData');
  const out = parseAuthData(obj.authData);
  out.fmt = obj.fmt;
  return out;
}

/* 认证器给的是 DER 编码的签名，WebCrypto 要的是 r||s 两段各 32 字节 */
function derToRaw(der) {
  if (!der || der.length < 8 || der[0] !== 0x30) throw new Error('签名不是 DER');
  let p = 2;
  if (der[1] & 0x80) p = 2 + (der[1] & 0x7f);
  if (der[p] !== 0x02) throw new Error('DER 里没有 r');
  const rLen = der[p + 1];
  const r = der.slice(p + 2, p + 2 + rLen);
  const q = p + 2 + rLen;
  if (der[q] !== 0x02) throw new Error('DER 里没有 s');
  const sLen = der[q + 1];
  const s = der.slice(q + 2, q + 2 + sLen);
  const out = new Uint8Array(64);
  out.set(r.slice(Math.max(0, r.length - 32)), Math.max(0, 32 - r.length));
  out.set(s.slice(Math.max(0, s.length - 32)), 32 + Math.max(0, 32 - s.length));
  return out;
}
export const derToRawForTest = derToRaw;

/**
 * 校验一次断言。
 * opts: { clientDataJSON, authData, signature (都是 base64url),
 *         expectedChallenge, expectedRpId, expectedOrigin, expectedType }
 */
export async function verifyAssertion(publicJwk, opts) {
  const o = opts || {};
  if (!publicJwk || publicJwk.kty !== 'EC') return false;
  let clientData;
  try { clientData = fromB64u(o.clientDataJSON); } catch (e) { return false; }
  let cd;
  try { cd = JSON.parse(td.decode(clientData)); } catch (e) { return false; }
  if (!cd || cd.type !== (o.expectedType || 'webauthn.get')) return false;
  if (o.expectedChallenge && cd.challenge !== o.expectedChallenge) return false;
  if (o.expectedOrigin && cd.origin !== o.expectedOrigin) return false;

  let authData;
  try { authData = fromB64u(o.authData); } catch (e) { return false; }
  let parsed;
  try { parsed = parseAuthData(authData); } catch (e) { return false; }
  if (o.expectedRpId) {
    const want = b64u(await sha256(te.encode(o.expectedRpId)));
    if (want !== b64u(parsed.rpIdHash)) return false;
  }
  if (!(parsed.flags & 0x01)) return false;          /* 用户在场 */

  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData, 0);
  signed.set(await sha256(clientData), authData.length);

  let sig;
  try { sig = derToRaw(fromB64u(o.signature)); } catch (e) { return false; }
  try {
    const key = await crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, signed);
  } catch (e) { return false; }
}
