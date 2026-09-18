/* 海报 —— 一张还没拍出来的电影的画面 */
import { threadById } from './config.js';

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/;

export function hasCJK(text) { return CJK.test(text || ''); }

export function pad2(n) { return (n < 10 ? '0' : '') + n; }

/* 写下它的时刻 */
export function speakingTime(ts) {
  const d = new Date(ts || Date.now());
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

export function fullDate(ts) {
  const d = new Date(ts || Date.now());
  return d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate());
}

export function relTime(ts) {
  const diff = Date.now() - (ts || 0);
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  if (d === 1) return '昨天 ' + speakingTime(ts);
  if (d < 30) return d + ' 天前';
  return fullDate(ts);
}

export function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/* 冲印一张海报 */
export function renderPoster(rec, opts) {
  opts = opts || {};
  const thread = threadById(rec.mood);

  const fig = el('figure', 'poster' + (opts.variant ? ' poster--' + opts.variant : ''));
  fig.setAttribute('data-thread', thread.id);

  const reflect = el('div', 'poster__reflect');
  reflect.setAttribute('aria-hidden', 'true');
  reflect.appendChild(el('span', null, rec.wish));
  fig.appendChild(reflect);

  const frame = el('div', 'poster__frame');
  const eyebrow = el('p', 'poster__eyebrow', 'A Wish By ');
  eyebrow.appendChild(el('b', null, rec.name));
  frame.appendChild(eyebrow);

  const title = el('blockquote', 'poster__title' + (hasCJK(rec.wish) ? '' : ' is-latin'), rec.wish);
  frame.appendChild(title);

  frame.appendChild(el('div', 'poster__rule'));
  frame.appendChild(el('p', 'poster__sub', '"spoken at ' + speakingTime(rec.ts) + ', ' + fullDate(rec.ts) + '"'));

  const meta = el('p', 'poster__meta');
  meta.appendChild(el('span', null, '一线千愿'));
  const stars = el('span', 'stars', '★★★★★');
  stars.setAttribute('aria-hidden', 'true');
  meta.appendChild(stars);
  meta.appendChild(el('span', null, thread.name + ' · ' + thread.en));
  frame.appendChild(meta);

  fig.appendChild(frame);
  return fig;
}

/* 让字自动缩到框里 —— 二分/步进都行，步进更稳 */
export function fitPoster(posterEl, opts) {
  const title = posterEl.querySelector('.poster__title');
  const frame = posterEl.querySelector('.poster__frame');
  if (!title || !frame) return;

  const cs = window.getComputedStyle(posterEl);
  const innerW = posterEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const innerH = posterEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (innerW <= 0 || innerH <= 0) return;

  let others = 0;
  Array.prototype.forEach.call(frame.children, function (kid) {
    if (kid !== title) others += kid.getBoundingClientRect().height;
  });
  const gap = parseFloat(window.getComputedStyle(frame).rowGap) || 0;
  const avail = Math.max(40, innerH - others - gap * Math.max(0, frame.children.length - 1) - 4);

  /* 关键：测量期间必须关掉 font-size 过渡，
     否则 scrollHeight 读到的永远是过渡中的旧值，循环永远收敛不了。 */
  posterEl.classList.add('is-fitting');

  let size = Math.min(avail * 1.55, innerW * 0.55);
  const min = 11;
  posterEl.style.setProperty('--fit', size.toFixed(1) + 'px');
  let guard = 0;
  while (size > min && guard++ < 46) {
    if (title.scrollHeight <= avail) break;
    size *= 0.93;
    posterEl.style.setProperty('--fit', size.toFixed(1) + 'px');
  }
  void posterEl.offsetHeight;

  const done = function () { posterEl.classList.remove('is-fitting'); };
  if (opts && opts.keepFitting) return size;
  requestAnimationFrame(done);
  setTimeout(done, 400);
  return size;
}

export function mountPoster(host, rec, opts) {
  host.textContent = '';
  const fig = renderPoster(rec, opts);
  host.appendChild(fig);
  requestAnimationFrame(function () { fitPoster(fig); });
  return fig;
}
