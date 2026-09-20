/* IndexNow —— 站点改完主动敲一下 Bing / Yandex / Seznam / Naver 的门。
   不需要任何账号：只要根目录放着 <key>.txt，内容就是 key 本身。
   （key 是公开的，写在文件里、也写在请求里，这是它设计的用法。）

   用法：
     node scripts/indexnow.mjs                  # 提交首页
     node scripts/indexnow.mjs / /about /web    # 提交指定路径
*/
const HOST = 'uncodeapps.icu';
const KEY = '4d832bc9b5ce7f69cbfba3d6144efaa7';

const paths = process.argv.slice(2).length ? process.argv.slice(2) : ['/'];
const urlList = paths.map(function (p) {
  return 'https://' + HOST + (p.charAt(0) === '/' ? p : '/' + p);
});

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: 'https://' + HOST + '/' + KEY + '.txt',
    urlList: urlList
  })
});

/* 200 收到 / 202 已接受（key 尚未验证时会先收下） / 403 key 文件取不到 / 422 域名对不上 */
console.log(res.status + ' ' + res.statusText + ' · 提交 ' + urlList.length + ' 个地址');
const body = await res.text();
if (body) console.log(body.slice(0, 400));
if (res.status !== 200 && res.status !== 202) process.exitCode = 1;
