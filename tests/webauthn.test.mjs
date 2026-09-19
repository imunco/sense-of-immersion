#!/usr/bin/env node
/**
 * 通行密钥（WebAuthn）回归 —— 浏览器侧与采集器侧共用同一份校验。
 *
 *   node tests/webauthn.test.mjs
 *
 * 没有硬件也能测：用 WebCrypto 生成一把软件 P-256 钥匙，
 * 按认证器的格式造出 authData / attestationObject / clientDataJSON / DER 签名，
 * 再让两端的校验逻辑去认它。负例全都试一遍。
 */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseAttestationObject, verifyAssertion, challengeFor, delChallengeParts,
  b64u, fromB64u, sha256, randomChallenge
} from '../shared/webauthn.js';
import { deriveKey, encryptJSON } from '../shared/crypto.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const te = new TextEncoder();
let fails = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); return; }
  fails++;
  console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
}

/* ---------------------------------------------------------------- CBOR 编码（只给测试用） */
function head(major, len) {
  if (len < 24) return [(major << 5) | len];
  if (len < 256) return [(major << 5) | 24, len];
  if (len < 65536) return [(major << 5) | 25, (len >> 8) & 255, len & 255];
  return [(major << 5) | 26, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255];
}
const cborUint = (n) => head(0, n);
const cborNeg = (n) => head(1, -1 - n);
const cborBytes = (u8) => head(2, u8.length).concat(Array.from(u8));
/* 文本是 major 3，不是 major 2 —— 键也得先编码好再放进 map（我第一次两处都写错了） */
const cborText = (s) => { const b = te.encode(s); return head(3, b.length).concat(Array.from(b)); };
/* 注意用 concat 拼，不能 flat：cborText/cborBytes 本身就是数组，
   flat 会把它们拆成一堆孤立的数字，结构就没了（我第一次就是这么写坏的）。 */
const cborArray = (items) => items.reduce((acc, it) => acc.concat(it), head(4, items.length));
const cborMap = (pairs) => pairs.reduce((acc, kv) => acc.concat(kv[0], kv[1]), head(5, pairs.length));
function cborInt(n) { return n >= 0 ? cborUint(n) : cborNeg(n); }

/* 认证器给的是 DER；WebCrypto 给的是 r||s 各 32 字节 */
function rawToDer(raw) {
  const enc = (b) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v = Array.from(b.slice(i));
    if (v[0] & 0x80) v = [0].concat(v);
    return [0x02, v.length].concat(v);
  };
  const body = enc(raw.slice(0, 32)).concat(enc(raw.slice(32)));
  return new Uint8Array([0x30, body.length].concat(body));
}

/* ---------------------------------------------------------------- 造一把软件钥匙 */
const RP_ID = 'yixian-archive.vercel.app';
const ORIGIN = 'https://' + RP_ID;
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
const CRED_ID = crypto.getRandomValues(new Uint8Array(16));

async function buildAuthData(withKey, flags) {
  const rpIdHash = await sha256(te.encode(RP_ID));
  const parts = [Array.from(rpIdHash), [flags], [0, 0, 0, 1]];
  if (withKey) {
    /* 键和值都得真的编码：负数是 major 1，直接把 JS 数字塞进 Uint8Array 会得到错的字节 */
    const cose = cborMap([
      [cborInt(1), cborInt(2)],
      [cborInt(3), cborInt(-7)],
      [cborInt(-1), cborInt(1)],
      [cborInt(-2), cborBytes(fromB64u(jwk.x))],
      [cborInt(-3), cborBytes(fromB64u(jwk.y))]
    ]);
    parts.push(Array.from(new Uint8Array(16)));                       /* aaguid */
    parts.push([(CRED_ID.length >> 8) & 255, CRED_ID.length & 255]);
    parts.push(Array.from(CRED_ID));
    parts.push(cose);
  }
  return new Uint8Array([].concat(...parts));
}
async function sign(authData, challenge, origin, type) {
  const clientDataJSON = te.encode(JSON.stringify({ type: type || 'webauthn.get', challenge: challenge, origin: origin || ORIGIN }));
  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData, 0);
  signed.set(await sha256(clientDataJSON), authData.length);
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, signed));
  return {
    clientDataJSON: b64u(clientDataJSON),
    authData: b64u(authData),
    signature: b64u(rawToDer(raw))
  };
}

console.log('通行密钥回归');

/* ---- 注册：从 attestationObject 里抠公钥 ---- */
const attestation = new Uint8Array(cborMap([
  [cborText('fmt'), cborText('none')],
  [cborText('attStmt'), cborMap([])],
  [cborText('authData'), cborBytes(await buildAuthData(true, 0x45))]
]));
const parsed = parseAttestationObject(b64u(attestation));
ok('从注册结果里取出了公钥', !!parsed.publicJwk && parsed.publicJwk.kty === 'EC', JSON.stringify(parsed.publicJwk));
ok('取出的公钥与生成的一致', parsed.publicJwk.x === jwk.x && parsed.publicJwk.y === jwk.y);
ok('取出了凭据 id', parsed.credentialId === b64u(CRED_ID), String(parsed.credentialId));
ok('认得出算法是 ES256', parsed.alg === -7, String(parsed.alg));

const record = { v: 1, rpId: RP_ID, origin: ORIGIN, credentialId: parsed.credentialId, publicJwk: parsed.publicJwk, alg: -7 };

/* ---- 断言：正例 ---- */
const challenge = await challengeFor(delChallengeParts(['w_b', 'w_a'], 'nonce-1', 123));
const authData = await buildAuthData(false, 0x05);
const good = await sign(authData, challenge);
const base = {
  clientDataJSON: good.clientDataJSON, authData: good.authData, signature: good.signature,
  expectedChallenge: challenge, expectedRpId: RP_ID, expectedOrigin: ORIGIN
};
ok('正例：验得过', await verifyAssertion(record.publicJwk, base));

/* ---- 断言：负例 ---- */
ok('挑战不对：验不过', !(await verifyAssertion(record.publicJwk, Object.assign({}, base, { expectedChallenge: 'other' }))));
ok('来源不对：验不过', !(await verifyAssertion(record.publicJwk, Object.assign({}, base, { expectedOrigin: 'https://evil.example' }))));
ok('rpId 不对：验不过', !(await verifyAssertion(record.publicJwk, Object.assign({}, base, { expectedRpId: 'evil.example' }))));
ok('类型不对：验不过', !(await verifyAssertion(record.publicJwk, Object.assign({}, base, { expectedType: 'webauthn.create' }))));
const tampered = fromB64u(good.signature);
tampered[10] ^= 1;
ok('签名被改一个字节：验不过', !(await verifyAssertion(record.publicJwk, Object.assign({}, base, { signature: b64u(tampered) }))));
const noUp = await sign(await buildAuthData(false, 0x04), challenge);
ok('没有「用户在场」标志：验不过', !(await verifyAssertion(record.publicJwk, Object.assign({}, base, { authData: noUp.authData }))));
const otherPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const otherJwk = await crypto.subtle.exportKey('jwk', otherPair.publicKey);
ok('换一把钥匙签的：验不过', !(await verifyAssertion(Object.assign({}, record.publicJwk, { x: otherJwk.x, y: otherJwk.y }), base)));
ok('签名不是 DER 时：验不过（不抛异常）', !(await verifyAssertion(record.publicJwk, Object.assign({}, base, { signature: b64u(new Uint8Array(64)) }))));
ok('clientDataJSON 不是 JSON：验不过', !(await verifyAssertion(record.publicJwk, Object.assign({}, base, { clientDataJSON: b64u(te.encode('not json')) }))));

/* ---- 挑战的拼法：与顺序无关，与内容有关 ---- */
ok('挑战与 id 顺序无关', (await challengeFor(delChallengeParts(['w_a', 'w_b'], 'n', 1))) === (await challengeFor(delChallengeParts(['w_b', 'w_a'], 'n', 1))));
ok('换个 nonce 换挑战', (await challengeFor(delChallengeParts(['w_a'], 'n1', 1))) !== (await challengeFor(delChallengeParts(['w_a'], 'n2', 1))));
ok('换个时刻换挑战', (await challengeFor(delChallengeParts(['w_a'], 'n', 1))) !== (await challengeFor(delChallengeParts(['w_a'], 'n', 2))));
ok('随机挑战每次都不同', randomChallenge() !== randomChallenge());

/* ---------------------------------------------------------------- 采集器侧：没签名不发删除 */
const passphrase = (await readFile(resolve(ROOT, '.dsh-passphrase.local'), 'utf8').catch(() => '')).trim();
if (!passphrase) {
  console.log('  · 跳过采集器那一半（没有 .dsh-passphrase.local）');
} else {
  const dir = await mkdtemp(join(tmpdir(), 'yixian-pk-'));
  for (const item of ['scripts', 'shared', 'data', 'lib']) {
    await cp(resolve(ROOT, item), resolve(dir, item), { recursive: true });
  }
  await writeFile(resolve(dir, 'data/private/passkey.json'), JSON.stringify(record, null, 2) + '\n');
  const now = Date.now();
  const seed = ['w_keepme0001', 'w_nosign0002', 'w_badsign003'].map((id) => ({
    id: id, name: '测试', wish: '这条要用来试删除。', mood: 'silk', ts: now - 9 * 864e5
  }));
  await writeFile(resolve(dir, 'data/wishes.jsonl'), seed.map((w) => JSON.stringify(w)).join('\n') + '\n');

  const cfg = JSON.parse(await readFile(resolve(dir, 'data/config.json'), 'utf8'));
  const kek = await deriveKey(passphrase, cfg.crypto.salt, cfg.crypto.iterations);
  async function sealDel(ids, nonce, withAssert, breakIt) {
    const at = now;
    let assert = null;
    if (withAssert) {
      const ch = await challengeFor(delChallengeParts(ids, nonce, at));
      const s = await sign(await buildAuthData(false, 0x05), ch);
      if (breakIt) s.signature = b64u(new Uint8Array(70));
      assert = s;
    }
    const order = { ids: ids, at: at, nonce: nonce };
    if (assert) order.assert = assert;
    return { t: 'del', seal: await encryptJSON(kek, order) };
  }
  /* 把这三条也放进中转站：被删的那条还在缓存里，所以屏蔽名单会留住它
     （采集器只在「归档里或中转站上还有」时才保留屏蔽记录） */
  const feed = seed.concat([
    await sealDel(['w_keepme0001'], 'nonce-ok-1', true, false),      /* 签名正确 → 应被删 */
    await sealDel(['w_nosign0002'], 'nonce-no-2', false, false),      /* 没有签名 → 应保留 */
    await sealDel(['w_badsign003'], 'nonce-bad-3', true, true)        /* 签名无效 → 应保留 */
  ]);
  const lines = feed.map((m, i) => JSON.stringify({ id: 'k' + i, event: 'message', time: Math.floor(now / 1000), message: JSON.stringify(m) })).join('\n') + '\n';
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.end(lines);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const code = await new Promise((done) => {
    const child = spawn(process.execPath, ['scripts/collect.mjs'], {
      cwd: dir,
      env: Object.assign({}, process.env, {
        WISH_TOPIC: 'pk', WISH_ENDPOINT: 'http://127.0.0.1:' + port,
        WISH_ADMIN_PASSPHRASE: passphrase
      }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (c) => { if (err.trim()) console.log('    stderr: ' + err.trim().split('\n').slice(-1)[0]); done(c); });
  });
  await new Promise((r) => server.close(r));
  ok('采集器正常退出', code === 0, 'exit=' + code);
  const left = (await readFile(resolve(dir, 'data/wishes.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).id);
  const blocked = JSON.parse(await readFile(resolve(dir, 'data/blocked.json'), 'utf8'));
  ok('签名正确的删除：执行了', left.indexOf('w_keepme0001') < 0 && blocked.indexOf('w_keepme0001') >= 0, JSON.stringify(left));
  ok('没有签名的删除：没有执行', left.indexOf('w_nosign0002') >= 0, JSON.stringify(left));
  ok('签名无效的删除：没有执行', left.indexOf('w_badsign003') >= 0, JSON.stringify(left));
  await rm(dir, { recursive: true, force: true });
}

console.log(fails ? '\n' + fails + ' 项未通过' : '\n全部通过');
process.exitCode = fails ? 1 : 0;
