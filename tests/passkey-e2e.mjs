#!/usr/bin/env node
/**
 * 放映室通行密钥的全链路回归 —— 用 Chrome 的虚拟认证器。
 *
 *   node tests/passkey-e2e.mjs
 *
 * 虚拟认证器实现的是与 Windows Hello / 手机通行密钥同一套协议，
 * 所以这条链路（注册 → 取公钥 → 进门验证 → 删除签名）是真的被跑通了，
 * 而不是只验我自己的那套数学。真机那一下（指纹/人脸）仍然要人点。
 *
 * 注意：这里登记出来的公钥绑定的是 127.0.0.1，所以跑完必须把
 * data/private/passkey.json 还原成占位 —— 绝不能把一个 localhost 的钥匙提交上去。
 */
import puppeteer from 'puppeteer-core';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PASSKEY = resolve(ROOT, 'data/private/passkey.json');
/* 必须用 localhost，不能用 127.0.0.1：Chrome 不接受 IP 当 rpId（"invalid domain"）。
   这也是给使用者的第一条提示：登记要在域名上做。 */
const BASE = 'http://localhost:4173';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); return; }
  fails++;
  console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
}

const passphrase = (await readFile(resolve(ROOT, '.dsh-passphrase.local'), 'utf8').catch(() => '')).trim();
if (!passphrase) { console.log('跳过：没有 .dsh-passphrase.local'); process.exit(0); }

const backup = await readFile(PASSKEY, 'utf8').catch(() => '{"installed":false}\n');
let browser = null;

try {
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  /* 中转站塞一条愿望，好把「删除也要硬件签名」那一步真的跑起来 */
  const nowTs = Date.now();
  const ndjson = JSON.stringify({
    id: 'e2e', event: 'message', time: Math.floor(nowTs / 1000),
    message: JSON.stringify({ id: 'w_e2edel0001', name: '端到端', wish: '这条会被签名删掉。', mood: 'silk', ts: nowTs - 9 * 864e5 })
  }) + '\n';
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.indexOf('ntfy.sh') >= 0) {
      const cors = { 'Access-Control-Allow-Origin': '*' };
      /* POST 也必须拦下：否则删除指令会真的发到线上中转站去 */
      if (req.method() === 'POST') {
        req.respond({ status: 200, contentType: 'application/json', headers: cors, body: '{}' });
        return;
      }
      req.respond({ status: 200, contentType: 'application/x-ndjson', headers: cors, body: ndjson });
      return;
    }
    if (url.indexOf('/api/poke') >= 0) {
      req.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      return;
    }
    req.continue();
  });

  /* Chrome 的虚拟认证器：内部平台认证器，支持用户验证，自动模拟「人在场」 */
  const cdp = await page.target().createCDPSession();
  await cdp.send('WebAuthn.enable');
  const added = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal',
      hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
      automaticPresenceSimulation: true
    }
  });
  ok('虚拟认证器就绪', !!added.authenticatorId, JSON.stringify(added));

  console.log('');

  /* ---------- 1. 登记 ---------- */
  await page.goto(BASE + '/admin.html', { waitUntil: 'networkidle2' });
  await wait(900);
  /* 能力探测必须在真的页面上做（about:blank 上 API 不存在） */
  const caps = await page.evaluate(async () => {
    if (typeof window.PublicKeyCredential === 'undefined') return 'no-api';
    const uvpa = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return { secure: window.isSecureContext, uvpa: uvpa };
  });
  ok('页面上：安全上下文 + 平台认证器可用', caps.secure === true && caps.uvpa === true, JSON.stringify(caps));

  const rec = await page.evaluate(async () => {
    const pk = await import('./assets/js/passkey.js');
    return await pk.enroll('测试钥匙（虚拟）');
  });
  ok('登记拿回了公钥记录', !!rec && !!rec.publicJwk && rec.publicJwk.kty === 'EC', JSON.stringify(rec).slice(0, 120));
  ok('记录里带凭据 id', /^[A-Za-z0-9_-]{10,}$/.test(rec.credentialId), String(rec.credentialId));
  ok('rpId 绑的是当前域名', rec.rpId === 'localhost', String(rec.rpId));
  ok('origin 绑的是当前来源', rec.origin === 'http://localhost:4173', String(rec.origin));
  ok('算法是 ES256', rec.alg === -7, String(rec.alg));

  /* ---------- 2. 装上去：进门必须多一步 ---------- */
  await writeFile(PASSKEY, JSON.stringify(rec, null, 2) + '\n');
  await page.goto(BASE + '/admin.html', { waitUntil: 'networkidle2' });
  await wait(1000);
  await page.type('#gate-pass', passphrase, { delay: 5 });
  await page.click('#gate-form button[type=submit]');
  await wait(2500);
  const gateState = await page.evaluate(() => ({
    room: !document.querySelector('#room').hidden,
    step2: !document.querySelector('#gate-2fa').hidden,
    form: document.querySelector('#gate-form').hidden
  }));
  ok('口令对了但门还没开：要求第二因素', gateState.room === false && gateState.step2 === true, JSON.stringify(gateState));

  await page.click('#gate-2fa-go');
  await wait(2500);
  const opened = await page.evaluate(() => !document.querySelector('#room').hidden);
  ok('用钥匙确认之后：进得去', opened === true);

  /* 断言真的被发给认证器签过（签次会增加） */
  const creds1 = await cdp.send('WebAuthn.getCredentials', { authenticatorId: added.authenticatorId });
  const afterLogin = (creds1.credentials[0] || {}).signCount;
  ok('认证器确实签过一次（登录）', afterLogin >= 1, 'signCount=' + afterLogin);

  /* ---------- 3. 远程删除也要签名 ---------- */
  await wait(1200);
  const rows = await page.$$('.ledger-table tbody tr');
  if (!rows.length) {
    console.log('  · 没有可删的愿望，跳过删除签名这一步（中转站是空的）');
  } else {
    await rows[0].click();
    await wait(800);
    const del = await page.$('#drawer .btn--danger');
    ok('拿到远程删除按钮', !!del);
    if (del) {
      await del.click();      /* 第一下：确认 */
      await wait(300);
      await del.click();      /* 第二下：真删 —— 这里应该弹一次硬件验证 */
      await wait(2500);
      const creds2 = await cdp.send('WebAuthn.getCredentials', { authenticatorId: added.authenticatorId });
      const afterDel = (creds2.credentials[0] || {}).signCount;
      ok('删除时又签了一次（硬件签的）', afterDel > afterLogin, 'signCount ' + afterLogin + ' → ' + afterDel);
      const notice = await page.evaluate(() => (document.querySelector('#proj-notice') || {}).textContent || '');
      ok('给了回执', /约一分钟|已送出|删除请求/.test(notice), notice.slice(0, 40));
    }
  }

  /* ---------- 4. 口令对、但用户取消签名：门不该开 ---------- */
  await page.evaluate(() => { sessionStorage.setItem('reset', '1'); });
  await page.goto(BASE + '/admin.html', { waitUntil: 'networkidle2' });
  await wait(900);
  await page.type('#gate-pass', passphrase, { delay: 5 });
  await page.click('#gate-form button[type=submit]');
  await wait(2200);
  /* 把认证器设成不自动签名，模拟用户点「取消」 */
  await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId: added.authenticatorId, enabled: false });
  await page.click('#gate-2fa-go');
  await wait(1500);
  const stillShut = await page.evaluate(() => !document.querySelector('#room').hidden);
  await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId: added.authenticatorId, enabled: true });
  ok('用户不签（取消/超时）：门不开', stillShut === false);
} finally {
  await writeFile(PASSKEY, backup);
  if (browser) await browser.close();
}

const restored = JSON.parse(await readFile(PASSKEY, 'utf8'));
ok('跑完把 passkey.json 还原成占位了（没有把 localhost 的钥匙留在仓库里）', restored.installed === false && !restored.publicJwk);

console.log(fails ? '\n' + fails + ' 项未通过' : '\n全部通过');
process.exitCode = fails ? 1 : 0;
