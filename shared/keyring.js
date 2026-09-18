/* 密钥环：把「数据密钥」和「站点私钥」打包，用口令派生密钥包起来。
   data/private/keys.json 里只有密文；换口令时重新包一次即可，
   历史元数据与私密愿望都还在。 */
import { encryptJSON, decryptJSON, importAesKey, newAesKey } from './crypto.js';
import { newSiteKeyPair } from './envelope.js';

export async function newKeyring() {
  const pair = await newSiteKeyPair();
  return { v: 2, dek: await newAesKey(), sitePrivateJwk: pair.privateJwk, sitePublicJwk: pair.publicJwk };
}

export async function wrapKeyring(kek, keyringValue) {
  return encryptJSON(kek, keyringValue);
}

export async function unwrapKeyring(kek, blob) {
  const kr = await decryptJSON(kek, blob);
  if (!kr || !kr.dek) throw new Error('keyring 结构不对');
  return { raw: kr, dek: await importAesKey(kr.dek), sitePrivateJwk: kr.sitePrivateJwk };
}
