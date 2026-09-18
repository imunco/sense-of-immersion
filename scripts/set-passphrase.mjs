#!/usr/bin/env node
/**
 * 设置 / 更换后台口令。
 *   node scripts/set-passphrase.mjs "新口令"            首次设置，或接受历史数据作废
 *   node scripts/set-passphrase.mjs "新口令" "旧口令"    换口令但保留全部历史数据
 *
 * 结构：随机 DEK（加密所有记录）+ 口令派生的 KEK（只负责包住 DEK）。
 * 所以换口令只是重新包一次，data/private 下的历史密文依然可读。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveKey, encryptJSON, decryptJSON, randomSalt, newAesKey, DEFAULT_ITERATIONS } from '../shared/crypto.js';
import { newKeyring, wrapKeyring, unwrapKeyring } from '../shared/keyring.js';

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
const existing = JSON.parse(await readText(keysPath, 'null'));

/* 尽量复用已有的 DEK 与站点密钥对 —— 换了口令也不丢历史数据 */
let kr = null;
if (existing && oldPass) {
  let oldKek = null;
  try { oldKek = await deriveKey(oldPass, cfg.crypto.salt, cfg.crypto.iterations); } catch (e) {}
  try {
    const opened = await unwrapKeyring(oldKek, existing);
    kr = opened.raw;
    console.log('✓ 已用旧口令解开密钥环，历史数据保持可读。');
  } catch (e) {
    /* 可能是 v1 格式：keys.json 里直接放着站点私钥，没有数据密钥 */
    try {
      const legacy = await decryptJSON(oldKek, existing);
      if (legacy && legacy.kty) {
        kr = {
          v: 2,
          dek: await newAesKey(),
          sitePrivateJwk: legacy,
          sitePublicJwk: { kty: legacy.kty, crv: legacy.crv, x: legacy.x, y: legacy.y }
        };
        console.log('✓ 检测到旧版密钥格式，已升级为密钥环（站点密钥对保留）。');
      }
    } catch (e2) {}
    if (!kr) {
      console.error('✗ 旧口令不对。若继续，之前加密的元数据与私密愿望将永久无法解开。');
      console.error('  确认要作废就重跑并省略旧口令，或先用旧口令在后台导出 CSV。');
      process.exit(2);
    }
  }
}
if (!kr) {
  if (existing) console.warn('⚠ 生成新的密钥环 —— data/private 下的历史密文将无法再解开。');
  kr = await newKeyring();
}

cfg.siteKey = kr.sitePublicJwk;
await writeFile(J('data/config.json'), JSON.stringify(cfg, null, 2) + '\n');

const kek = await deriveKey(pass, cfg.crypto.salt, cfg.crypto.iterations);
await writeFile(J('data/private/verifier.json'), JSON.stringify(await encryptJSON(kek, { ok: true, kind: 'yixian-admin', at: new Date().toISOString() }), null, 2) + '\n');
await writeFile(keysPath, JSON.stringify(await wrapKeyring(kek, kr), null, 2) + '\n');

console.log('✓ 口令与密钥环已就绪（data/config.json / data/private/{verifier,keys}.json）');
console.log('  把同一个口令写进 GitHub Secret：');
console.log('    gh secret set WISH_ADMIN_PASSPHRASE --body "<口令>"');
