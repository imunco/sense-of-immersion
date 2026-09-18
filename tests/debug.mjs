import puppeteer from 'puppeteer-core';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox','--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle2' });
await wait(1500);
await page.evaluate(() => { location.hash = '#/cast'; });
await wait(400);
await page.type('#name-input', '林深', { delay: 20 });
await page.click('#to-wish');
await wait(500);
await page.type('#wish-input', '愿所有认真写下的话，都有人读到。', { delay: 15 });
await wait(400);
await page.click('#submit-wish');
await wait(2500);

const info = await page.evaluate(() => {
  const measure = (label, posterEl) => {
    if (!posterEl) return label + ' MISSING';
    const title = posterEl.querySelector('.poster__title');
    const frame = posterEl.querySelector('.poster__frame');
    const cs = getComputedStyle(posterEl);
    const innerW = posterEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const innerH = posterEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    let others = 0; const kids = [];
    Array.from(frame.children).forEach((k) => { if (k !== title) others += k.getBoundingClientRect().height; kids.push(k.className + ':' + Math.round(k.getBoundingClientRect().height)); });
    const gap = parseFloat(getComputedStyle(frame).rowGap) || 0;
    const avail = Math.max(40, innerH - others - gap * Math.max(0, frame.children.length - 1) - 4);
    return {
      label, cls: posterEl.className,
      clientW: posterEl.clientWidth, clientH: posterEl.clientHeight,
      innerW: Math.round(innerW), innerH: Math.round(innerH), others: Math.round(others), gap, avail: Math.round(avail),
      fit: posterEl.style.getPropertyValue('--fit'), fitComputed: getComputedStyle(title).fontSize,
      titleScrollH: title.scrollHeight, titleRectH: Math.round(title.getBoundingClientRect().height),
      titleW: Math.round(title.getBoundingClientRect().width),
      frameH: Math.round(frame.getBoundingClientRect().height),
      posterRectH: Math.round(posterEl.getBoundingClientRect().height),
      aspect: getComputedStyle(posterEl).aspectRatio,
      display: getComputedStyle(posterEl).display,
      actDisplay: getComputedStyle(posterEl.closest('.act')).display,
      text: title.textContent.slice(0, 14),
      kids
    };
  };
  return {
    reveal: measure('reveal', document.querySelector('#reveal-poster .poster')),
    preview: measure('preview', document.querySelector('#poster-preview')),
    hash: location.hash,
    actCurrent: document.querySelector('.act.is-current') && document.querySelector('.act.is-current').dataset.view
  };
});
console.log(JSON.stringify(info, null, 2));

// 手动重跑一次 fit 看是否修好
const after = await page.evaluate(async () => {
  const m = await import('./assets/js/poster.js');
  const el = document.querySelector('#reveal-poster .poster');
  const conf = m.fitPoster(el);
  return { conf, fit: el.style.getPropertyValue('--fit'), scrollH: el.querySelector('.poster__title').scrollHeight };
});
console.log('after manual refit:', JSON.stringify(after));
await browser.close();
