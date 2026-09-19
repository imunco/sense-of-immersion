/* 放映室的通行密钥 —— 登记、进门验证、给删除指令签名。
   ------------------------------------------------------------------
   为什么不是 TOTP（验证器里那种 6 位码）：放映室是纯客户端的，口令不上传。
   TOTP 密钥只能存公开仓库（谁都能算码）或被口令加密后存仓库（用口令就能解开），
   两种都挡不住拿到口令的人。通行密钥的私钥在硬件里，拿到口令也造不出签名。

   公钥记录放 data/private/passkey.json —— 里面只有公钥，公开也无所谓；
   但只能由有仓库写权限的人放进去（页面上登记 → 下载 → 自己提交），
   所以拿到口令的人没法给自己登记一把钥匙。 */
import {
  parseAttestationObject, verifyAssertion, randomChallenge, challengeFor,
  delChallengeParts, b64u, fromB64u
} from '../../shared/webauthn.js';

export { randomChallenge, challengeFor, delChallengeParts };

export function supported() {
  return !!(window.PublicKeyCredential && navigator.credentials && window.crypto && crypto.subtle);
}

/* 通行密钥的 rpId 必须是域名 —— IP 地址（127.0.0.1 这种）Chrome 会直接拒掉。
   本机自测请用 http://localhost:4173，正式登记请在你要长期使用的域名上做。 */
export function enrollableHost() {
  const h = location.hostname;
  if (!h || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.indexOf(':') >= 0) return null;
  return h;
}

/** 登记：让系统弹一次 Windows Hello / 手机通行密钥，拿回公钥记录 */
export async function enroll(label) {
  if (!enrollableHost()) {
    throw new Error('通行密钥不能在 IP 地址上登记 —— 请用域名打开放映室（本机用 http://localhost:4173）。');
  }
  const challenge = randomChallenge();
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: fromB64u(challenge),
      rp: { id: enrollableHost(), name: '一线千愿 · 放映室' },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: label || '放映室',
        displayName: label || '放映室'
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
      timeout: 90000,
      attestation: 'none'
    }
  });
  const parsed = parseAttestationObject(b64u(new Uint8Array(cred.response.attestationObject)));
  if (!parsed.publicJwk) throw new Error('这把钥匙给的不是 P-256 公钥 —— 换 Windows Hello 或手机上的通行密钥再试');
  return {
    v: 1,
    rpId: enrollableHost(),
    origin: location.origin,
    credentialId: parsed.credentialId,
    publicJwk: parsed.publicJwk,
    alg: parsed.alg,
    label: label || '',
    addedAt: new Date().toISOString()
  };
}

async function assertion(record, challenge) {
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: fromB64u(challenge),
      rpId: record.rpId,
      allowCredentials: [{ type: 'public-key', id: fromB64u(record.credentialId) }],
      userVerification: 'required',
      timeout: 90000
    }
  });
  const r = cred.response;
  return {
    clientDataJSON: b64u(new Uint8Array(r.clientDataJSON)),
    authData: b64u(new Uint8Array(r.authenticatorData)),
    signature: b64u(new Uint8Array(r.signature))
  };
}

/** 在某个挑战上取一次签名，并且先在本地验一遍 —— 验不过就别发出去 */
export async function prove(record, challenge) {
  const a = await assertion(record, challenge);
  const ok = await verifyAssertion(record.publicJwk, {
    clientDataJSON: a.clientDataJSON,
    authData: a.authData,
    signature: a.signature,
    expectedChallenge: challenge,
    expectedRpId: record.rpId,
    expectedOrigin: record.origin
  });
  if (!ok) throw new Error('这把钥匙没有通过校验');
  return a;
}

/** 登记完把公钥记录下载下来，让管理员放进 data/private/passkey.json */
export async function enrollAndDownload(label) {
  const rec = await enroll(label);
  const blob = new Blob([JSON.stringify(rec, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'passkey.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return rec;
}

/** 读已放进仓库的公钥记录（只有公钥，公开也无所谓） */
export async function loadPlaced() {
  try {
    const r = await fetch('data/private/passkey.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const rec = await r.json();
    return rec && rec.publicJwk && rec.credentialId && rec.rpId ? rec : null;
  } catch (e) { return null; }
}
