import puppeteer from 'puppeteer-core';
const B='https://yixian-archive.vercel.app';
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const browser=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--disable-gpu']});
const page=await browser.newPage();
async function read(url){
  for(let i=0;i<4;i++){
    try{ await page.goto(url,{waitUntil:'domcontentloaded',timeout:40000}); await wait(300); return await page.evaluate(()=>document.body.innerText||'(空)'); }
    catch(e){ await wait(2500); }
  }
  return '(连不上)';
}
const pk = await read(B+'/data/private/passkey.json');
console.log('passkey.json -> ' + pk.replace(/\s+/g,' ').slice(0,180));
const h = await read(B+'/api/health');
console.log('health -> ' + h.replace(/\s+/g,' ').slice(0,240));
const idx = await read(B+'/');
console.log('首页含回响/分享 -> 回响=' + (idx.indexOf('回响')>=0) + ' 分享=' + (idx.indexOf('reveal-share')>=0));
const adm = await read(B+'/admin.html');
console.log('放映室含第二因素界面 -> ' + (adm.indexOf('gate-2fa')>=0) + ' 登记按钮=' + (adm.indexOf('enroll-passkey')>=0));
await browser.close();
