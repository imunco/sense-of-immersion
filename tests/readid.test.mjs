#!/usr/bin/env node
/**
 * 读的唯一化回归 —— 服务端那一层。
 *
 *   node tests/readid.test.mjs
 *
 * 验四件事：签出去的 cookie 伪造不了、来源代号每天换盐、未签名的读一律不计数、
 * /api/read 转发出去的那条消息形状正确（id 洗过、签名带上了）。
 * 全程不打网络：fetch 被换成假的。
 */
import {
  identity, signSid, verifySid, ipPseudonym, dayKey, cookieHeader, parseCookies,
  clientIp, hasSecret, newSid, SID_COOKIE
} from '../lib/readid.js';

const SECRET = 'test-secret-0123456789abcdef';
process.env.WISH_READ_SECRET = SECRET;
process.env.WISH_TOPIC = 'test-topic';
process.env.WISH_ENDPOINT = 'http://relay.invalid';

let fails = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); return; }
  fails++;
  console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
}

console.log('读的唯一化回归');

/* ---- 签名 ---- */
const sid = newSid();
const exp = Date.now() + 864e5;
const sig = signSid(process.env, sid, exp);
ok('签出来的长度固定', /^[0-9a-f]{32}$/.test(sig), sig);
ok('自己签的自己验得过', verifySid(process.env, sid, exp, sig));
ok('改一个字符就验不过', !verifySid(process.env, sid, exp, sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0')));
ok('换个到期时间就验不过', !verifySid(process.env, sid, exp + 1, sig));
ok('没配密钥时签不出来', signSid({}, sid, exp) === '' && hasSecret({}) === false);
ok('密钥太短等于没配', hasSecret({ WISH_READ_SECRET: 'short' }) === false);

/* ---- 来源代号：当天稳定、换日失联、不同地址不同 ---- */
const day1 = new Date('2026-01-01T10:00:00Z').getTime();
const day2 = new Date('2026-01-02T10:00:00Z').getTime();
const a1 = ipPseudonym(process.env, '203.0.113.7', day1);
const a2 = ipPseudonym(process.env, '203.0.113.7', day1 + 3600e3);
const b1 = ipPseudonym(process.env, '203.0.113.7', day2);
const c1 = ipPseudonym(process.env, '203.0.113.8', day1);
ok('同一天同一个地址：代号一样', a1 === a2 && a1.length === 24, a1);
ok('换一天就换代号', a1 !== b1);
ok('换个地址就换代号', a1 !== c1);
ok('代号里看不出地址', a1.indexOf('203') < 0 && a1.indexOf('113') < 0, a1);
ok('没配密钥就没有代号', ipPseudonym({}, '203.0.113.7', day1) === '');
ok('日期键按 UTC 换', dayKey(day1) === '2026-1-1' && dayKey(day2) === '2026-1-2', dayKey(day1));

/* ---- 认识来的人 ---- */
const fresh = identity({ headers: {} }, process.env, day1);
ok('第一次来：发一张新的', fresh.fresh === true && !!fresh.sid && !!fresh.sig);
const jar = SID_COOKIE + '=' + encodeURIComponent(fresh.sid + '.' + fresh.exp + '.' + fresh.sig);
const again = identity({ headers: { cookie: jar } }, process.env, day1);
ok('带着这张 cookie 回来：认得出来，且不用再发', again.fresh === false && again.sid === fresh.sid);
const forged = identity({ headers: { cookie: SID_COOKIE + '=' + encodeURIComponent(fresh.sid + '.' + fresh.exp + '.deadbeef') } }, process.env, day1);
ok('伪造签名的 cookie：不认，另发一张', forged.fresh === true && forged.sid !== fresh.sid);
const expired = identity({ headers: { cookie: SID_COOKIE + '=' + encodeURIComponent(fresh.sid + '.' + (day1 - 1000) + '.' + signSid(process.env, fresh.sid, day1 - 1000)) } }, process.env, day1);
ok('过期的 cookie：不认', expired.fresh === true);
ok('cookie 属性齐全（HttpOnly / Secure / SameSite）', /HttpOnly/.test(cookieHeader(sid, exp, sig)) && /Secure/.test(cookieHeader(sid, exp, sig)) && /SameSite=Lax/.test(cookieHeader(sid, exp, sig)));
ok('没配密钥时：直接放行但不签名', identity({ headers: {} }, {}, day1).signed === false);

/* ---- 来源地址怎么读 ---- */
ok('读 x-forwarded-for 的第一段', clientIp({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } }) === '203.0.113.7');
ok('退回 x-real-ip', clientIp({ headers: { 'x-real-ip': '198.51.100.9' } }) === '198.51.100.9');
ok('都没有就是空', clientIp({ headers: {} }) === '');
ok('cookie 解析能处理多个', Object.keys(parseCookies({ headers: { cookie: 'a=1; b=2' } })).length === 2);

/* ---- /api/read 转发出去的那条消息 ---- */
const sent = [];
globalThis.fetch = async function (url, opts) {
  sent.push({ url: url, body: JSON.parse(opts.body) });
  return { ok: true, status: 200 };
};
const handler = (await import('../api/read.js')).default;

function fakeRes() {
  const out = { code: 0, body: null, headers: {} };
  return {
    out: out,
    setHeader: function (k, v) { out.headers[String(k).toLowerCase()] = v; },
    status: function (c) { out.code = c; return this; },
    json: function (b) { out.body = b; return this; },
    end: function () { return this; }
  };
}
const HOST = 'yixian-archive.vercel.app';
function call(body, cookie, ip) {
  const res = fakeRes();
  return handler({
    method: 'POST',
    headers: {
      origin: 'https://' + HOST, host: HOST,
      'content-type': 'application/json',
      cookie: cookie || '',
      'x-forwarded-for': ip || '203.0.113.7'
    },
    body: body
  }, res).then(function () { return res.out; });
}

let out = await call({ ids: ['w_aaa11111', 'w_bbb22222', 'not-an-id'], env: { v: 1 } });
ok('正常一次：200 且说明已签名', out.code === 200 && out.body && out.body.signed === true, JSON.stringify(out.body));
ok('新访客拿到 Set-Cookie，且是 HttpOnly', !!out.headers['set-cookie'] && /HttpOnly/.test(out.headers['set-cookie']));
const forwarded = sent[sent.length - 1];
ok('转发到中转站的那条是 read', forwarded.body.t === 'read', JSON.stringify(forwarded.body).slice(0, 80));
/* 函数原样转发：工作量证明是按这一串 id 算的，函数改一个字节就验不过。
   形状审查在采集器那一层（tests/silk-collect.mjs 里有专门的断言）。 */
ok('原样转发，不改顺序也不筛内容', forwarded.body.ids.length === 3 && forwarded.body.ids.indexOf('not-an-id') >= 0, JSON.stringify(forwarded.body.ids));
ok('信封原样带过去', !!forwarded.body.env);
ok('带上了能验的签名', verifySid(process.env, forwarded.body.idt.sid, forwarded.body.idt.exp, forwarded.body.idt.sig));
ok('带上了当天的来源代号', /^[0-9a-f]{24}$/.test(forwarded.body.iph), forwarded.body.iph);
ok('地址本身不在消息里', JSON.stringify(forwarded.body).indexOf('203.0.113.7') < 0);

const cookie = out.headers['set-cookie'].split(';')[0];
out = await call({ ids: ['w_ccc33333'] }, cookie);
ok('带着 cookie 回来：同一个 sid', sent[sent.length - 1].body.idt.sid === forwarded.body.idt.sid);
ok('认得出来就不再发新 cookie', !out.headers['set-cookie']);

out = await call({ ids: ['w_ddd44444'] }, SID_COOKIE + '=' + encodeURIComponent('forged.forged.forged'));
ok('伪造 cookie：另发一张，且转发的是真 sid', !!out.headers['set-cookie'] && sent[sent.length - 1].body.idt.sid !== 'forged');

out = await call({ ids: [] });
ok('什么都没给：400', out.code === 400, JSON.stringify(out.body));

/* 没配密钥：不签名，但也不拦（站点照常能跑） */
delete process.env.WISH_READ_SECRET;
out = await call({ ids: ['w_eee55555'] });
ok('没配密钥：仍然转发，但不带签名', out.code === 200 && out.body.signed === false && !sent[sent.length - 1].body.idt);
ok('没配密钥：也不发 cookie', !out.headers['set-cookie']);

console.log(fails ? '\n' + fails + ' 项未通过' : '\n全部通过');
process.exit(fails ? 1 : 0);
