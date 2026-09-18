#!/usr/bin/env node
/**
 * 设置 / 更换后台口令。
 *   node scripts/set-passphrase.mjs "新口令" [旧口令]
 *
 * 口令本身永远不落盘。仓库里只有：
 *   data/config.json          → PBKDF2 的盐、迭代次数、站点公钥（都是公开的）
 *   data/private/verifier.json → 用派生密钥加密的校验块
 *   data/private/keys.json     → 用派生密钥加密的站点私钥
 *
 * 给了旧口令时会复用已有的站点密钥对（这样换口令不会丢历史信封）。
 * 记得同步 GitHub Secret：gh secret set WISH_ADMIN_PASSPHRASE --body "新口令"
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveKey, encryptJSON, decryptJSON, randomSalt, DEFAULT_ITERATIONS } from '../shared/crypto.js';
import { newSiteKeyPair } from '../shared/envelope.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const J = (p) => resolve(ROOT, p);
const readText = async (p, d = '') => (existsSync(p) ? readFile(p, 'utf8') : d);

const pass = process.argv[2];
const oldPass = process.argv[3];
if (!pass || pass.length < 8) {
  console.error('口令至少 8 位。用法: node scripts/set-passphrase.mjs "新口令" ["旧口令"]');
  process.exit(1);
}

const cfg = JSON.parse(await readText(J('data/config.json'), '{}'));
cfg.crypto = {
  alg: 'PBKDF2-SHA256 / AES-256-GCM',
  salt: (cfg.crypto && cfg.crypto.salt) || randomSalt(),
  iterations: DEFAULT_ITERATIONS
};
delete cfg.adminHash;

await mkdir(J('data/private'), { recursive: true });
const keysPath = J('data/private/keys.json');

/* 尽量复用站点密钥对 */
let pair = null;
const existing = JSON.parse(await readText(keysPath, 'null'));
if (existing && oldPass) {
  try {
    const oldKey = await deriveKey(oldPass, cfg.crypto.salt, cfg.crypto.iterations);
    const privateJwk = await decryptJSON(oldKey, existing);
    pair = { privateJwk, publicJwk: { kty: privateJwk.kty, crv: privateJwk.crv, x: privateJwk.x, y: privateJwk.y } };
    console.log('已用旧口令复用原有站点密钥对。');
  } catch { console.warn('旧口令不对，将生成新的站点密钥对（历史信封将无法解开）。'); }
}
if (!pair) pair = await newSiteKeyPair();

cfg.siteKey = pair.publicJwk;
await writeFile(J('data/config.json'), JSON.stringify(cfg, null, 2) + '\n');

const key = await deriveKey(pass, cfg.crypto.salt, cfg.crypto.iterations);
await writeFile(J('data/private/verifier.json'), JSON.stringify(await encryptJSON(key, { ok: true, kind: 'yixian-admin', at: new Date().toISOString() }), null, 2) + '\n');
await writeFile(keysPath, JSON.stringify(await encryptJSON(key, pair.privateJwk), null, 2) + '\n');

console.log('口令与站点密钥已就绪：data/config.json / data/private/{verifier,keys}.json');
console.log('把同一个口令写进 GitHub Secret：');
console.log('  gh secret set WISH_ADMIN_PASSPHRASE --body "<口令>"');
