/* 回响 · Echoes —— 把全站公开的愿望拆成词，看它们在说什么。
   ------------------------------------------------------------------
   · 只用浏览器自带的 Intl.Segmenter 分词，不引入任何库；
     拿不到就退到「拉丁词整取、连续汉字按二字切」的老办法。
   · 只统计公开的愿望：仅自己可见的从来不上蛛网，也就不会有回声。
   · 这里只做统计，不做搜索 —— 蛛网上找单条愿望靠编号。
   ------------------------------------------------------------------ */

/* 语助词、指代、几乎每句都会出现的许愿框（愿 / 希望 / 祝）都去掉，
   留下的才是「在说什么」。 */
export const ECHO_STOP = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '就', '也', '都', '很', '会',
  '能', '要', '有', '没', '不', '这', '那', '个', '和', '与', '或', '但', '而', '却', '还',
  '再', '又', '只', '被', '把', '让', '给', '对', '为', '以', '之', '其', '地', '得', '着',
  '过', '来', '去', '上', '下', '里', '中', '外', '时', '候', '一', '二', '三', '四', '五',
  '六', '七', '八', '九', '十', '零', '两', '些', '么', '吗', '呢', '吧', '啊', '呀', '哦',
  '嗯', '请', '别', '太', '更', '最', '才', '好', '想', '祝', '愿', '愿望', '希望', '期望',
  '就是', '只是', '还是', '真是', '可以', '不能', '不要', '不会', '没有', '什么', '怎么',
  '怎样', '为什么', '哪儿', '这里', '那里', '这些', '那些', '这个', '那个', '一个', '一些',
  '一样', '一起', '一直', '一定', '一点', '一下', '已经', '曾经', '如果', '因为', '所以',
  '但是', '然后', '而且', '虽然', '不过', '自己', '我们', '你们', '他们', '她们', '大家',
  '别人', '有人', '所有', '一切', '真的', '非常', '特别', '可能', '应该', '需要', '觉得',
  '知道', '时候', '现在', '以后', '之前', '之后', '这么', '那么', '多少', '为了', '关于',
  '对于', '由于', '以及', '或者', '并且', '还有', '能够', '愿意', '的话', '似的', '只要',
  '只有', '无论', '不管', '尽管', '即使', '而是', '不是', '越来越', '一定要', '希望你',
  'the', 'and', 'for', 'you', 'that', 'this', 'with', 'are', 'was', 'will', 'can', 'not',
  'but', 'all', 'have', 'has', 'her', 'his', 'she', 'him', 'one', 'out', 'from', 'they',
  'been', 'were', 'my', 'me', 'we', 'it', 'is', 'of', 'in', 'on', 'to', 'be', 'so', 'if',
  'no', 'do', 'just', 'a', 'i'
]);

const SEG = (function () {
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) return new Intl.Segmenter('zh', { granularity: 'word' });
  } catch (e) { /* 老浏览器 */ }
  return null;
})();

export const hasSegmenter = !!SEG;

/* 把一句话拆成一个个词 */
export function segment(text) {
  const src = String(text == null ? '' : text);
  const out = [];
  if (SEG) {
    for (const part of SEG.segment(src)) if (part.isWordLike) out.push(part.segment);
    return out;
  }
  const chunks = src.match(/[A-Za-z]+|[0-9]+|[\u3400-\u9fff]+/g) || [];
  chunks.forEach(function (chunk) {
    if (/^[0-9]+$/.test(chunk)) return;
    if (!/^[\u3400-\u9fff]+$/.test(chunk)) { out.push(chunk); return; }
    if (chunk.length <= 2) { out.push(chunk); return; }
    for (let i = 0; i < chunk.length - 1; i++) out.push(chunk.slice(i, i + 2));
  });
  return out;
}

function clean(raw) {
  let w = String(raw == null ? '' : raw).trim();
  if (!w) return '';
  w = w.replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '');
  if (!w) return '';
  if (/^[0-9]+$/.test(w)) return '';
  if (/^[A-Za-z]$/.test(w)) return '';
  if (w.length > 12) return '';
  if (!/[\p{L}\p{N}]/u.test(w)) return '';
  if (ECHO_STOP.has(w)) return '';
  if (/[A-Za-z]/.test(w)) { w = w.toLowerCase(); if (ECHO_STOP.has(w)) return ''; }
  return w;
}

/* 分块统计：愿望多的时候让出主线程，页面不会僵住 */
export function analyze(wishes, onDone, chunkSize) {
  const counts = new Map();
  const inWishes = new Map();
  let terms = 0, used = 0, i = 0;
  const CHUNK = chunkSize || 300;
  const step = function () {
    const end = Math.min(wishes.length, i + CHUNK);
    for (; i < end; i++) {
      const text = String(wishes[i] && wishes[i].wish || '');
      if (!text) continue;
      used++;
      const seen = new Set();
      segment(text).forEach(function (raw) {
        const tok = clean(raw);
        if (!tok) return;
        terms++;
        counts.set(tok, (counts.get(tok) || 0) + 1);
        if (!seen.has(tok)) { seen.add(tok); inWishes.set(tok, (inWishes.get(tok) || 0) + 1); }
      });
    }
    if (i < wishes.length) { setTimeout(step, 0); return; }
    const list = [];
    counts.forEach(function (count, word) {
      list.push({ word: word, count: count, wishes: inWishes.get(word) || 0, ratio: terms ? count / terms : 0 });
    });
    list.sort(function (a, b) { return b.count - a.count || (a.word < b.word ? -1 : 1); });
    onDone({ terms: list, total: terms, wishes: used });
  };
  step();
}

/* ---------------------------------------------------------------- 词云 */
const THREAD_RGB = {
  silk: [233, 150, 122],
  abyss: [104, 176, 186],
  moon: [214, 176, 108],
  dusk: [176, 66, 62]
};
const INK_RGB = [82, 104, 108];      /* 排在后面的词，一点点褪进墨色 */
const CJK_STACK = '"Noto Serif SC","Source Han Serif SC","Songti SC","STSong","SimSun",serif';
const GOLDEN = 2.399963229728653;

function accent() { return THREAD_RGB[document.documentElement.dataset.thread] || THREAD_RGB.silk; }
function fontFor(size) { return '700 ' + size.toFixed(1) + 'px ' + CJK_STACK; }
function rgba(rgb, a) { return 'rgba(' + Math.round(rgb[0]) + ',' + Math.round(rgb[1]) + ',' + Math.round(rgb[2]) + ',' + a.toFixed(3) + ')'; }
function mixRgb(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

export class EchoCloud {
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.handlers = handlers || {};
    this.terms = [];
    this.nodes = [];
    this.hover = null;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.running = false;
    this.t = 0;
    this.bind();
    this.resize();
  }

  bind() {
    this.onMove = (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.hit();
    };
    this.onLeave = () => { this.pointer = null; this.hover = null; this.emit(); this.draw(); };
    this.canvas.addEventListener('pointermove', this.onMove, { passive: true });
    this.canvas.addEventListener('pointerleave', this.onLeave);
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
  }

  emit() { if (this.handlers.onHover) this.handlers.onHover(this.hover ? this.hover.node.term : null); }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(320, Math.round(rect.width));
    this.h = Math.max(300, Math.round(rect.height));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.layout();
    this.draw();
  }

  setTerms(terms) {
    this.terms = (terms || []).slice();
    this.hover = null;
    this.layout();
    this.draw();
  }

  /* 最常说的词落在中央，其余沿黄金角螺旋往外铺；放不下的就不放，宁可留白 */
  layout() {
    this.nodes = [];
    const terms = this.terms;
    if (!terms.length) return;
    const ctx = this.ctx;
    const w = this.w, h = this.h;
    const max = terms[0].count || 1;
    const min = terms[terms.length - 1].count || 1;
    const reach = Math.max(1, max - min);
    const big = Math.max(30, Math.min(w, h) * 0.13);
    const small = Math.max(12, Math.min(w, h) * 0.028);
    const cx = w * 0.5, cy = h * 0.5;
    const rx = w * 0.455, ry = h * 0.435;
    const boxes = [];
    const total = terms.length;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    terms.forEach((term, i) => {
      const weight = (term.count - min) / reach;
      const size = small + (big - small) * Math.pow(weight, 0.5);
      ctx.font = fontFor(size);
      const tw = ctx.measureText(term.word).width;
      const th = size * 1.2;
      /* 向日葵铺法：名次决定它落在第几圈，从中心一直铺到边缘；撞上了就再往外挪一点 */
      let spot = null;
      for (let k = 0; k < 160 && !spot; k++) {
        const frac = Math.min(1, (i + 0.45 + k * 0.7) / total);
        const a = (i + k) * GOLDEN;
        const spread = Math.sqrt(frac);
        const x = cx + Math.cos(a) * spread * rx;
        const y = cy + Math.sin(a) * spread * ry;
        if (x - tw / 2 < 6 || x + tw / 2 > w - 6 || y - th / 2 < 6 || y + th / 2 > h - 6) continue;
        let free = true;
        for (let j = 0; j < boxes.length; j++) {
          const b = boxes[j];
          if (Math.abs(x - b.x) * 2 < tw + b.w + 10 && Math.abs(y - b.y) * 2 < th + b.h + 7) { free = false; break; }
        }
        if (free) spot = { x: x, y: y };
      }
      if (!spot) return;   /* 这一片挤不下它了 */
      boxes.push({ x: spot.x, y: spot.y, w: tw, h: th });
      this.nodes.push({
        term: term, x: spot.x, y: spot.y, w: tw, h: th, size: size, rank: i,
        phase: ((i * 37) % 100) / 100 * Math.PI * 2,
        tail: total > 1 ? i / (total - 1) : 0
      });
    });
  }

  hit() {
    if (!this.pointer) { if (this.hover) { this.hover = null; this.emit(); this.draw(); } return; }
    let best = null;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const y = n.renderY == null ? n.y : n.renderY;
      if (Math.abs(this.pointer.x - n.x) <= n.w / 2 + 4 && Math.abs(this.pointer.y - y) <= n.h / 2 + 3) {
        if (!best || n.size > best.node.size) best = { node: n };
      }
    }
    const changed = (!!best !== !!this.hover) || (best && this.hover && best.node !== this.hover.node);
    this.hover = best;
    this.canvas.style.cursor = best ? 'pointer' : 'default';
    if (changed) { this.emit(); this.draw(); }
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const accentRgb = accent();
    const drift = this.reduced ? 0 : 1.6;
    const tt = this.t / 2600;
    this.nodes.forEach(function (n) {
      const y = n.y + (drift ? Math.sin(tt + n.phase) * drift : 0);
      n.renderY = y;
      const isHover = this.hover && this.hover.node === n;
      /* 颜色只作深浅：说得越少越淡，意义全在字号上 */
      const col = isHover ? accentRgb : mixRgb(accentRgb, INK_RGB, n.tail * 0.6);
      ctx.font = fontFor(n.size);
      ctx.fillStyle = rgba(col, isHover ? 1 : 0.94 - 0.36 * n.tail);
      ctx.fillText(n.term.word, n.x, y);
      if (isHover) {
        ctx.strokeStyle = rgba(accentRgb, 0.55);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(n.x - n.w / 2, y + n.size * 0.72);
        ctx.lineTo(n.x + n.w / 2, y + n.size * 0.72);
        ctx.stroke();
      }
    }, this);
  }

  start() {
    if (this.running || this.reduced) { this.draw(); return; }
    this.running = true;
    const loop = (t) => {
      if (!this.running) return;
      this.t = t;
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.stop();
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    window.removeEventListener('resize', this.onResize);
  }
}

/* 占比怎么念 */
export function ratioText(ratio) {
  if (!ratio) return '0%';
  const pct = ratio * 100;
  if (pct < 0.05) return '<0.1%';
  return pct.toFixed(1) + '%';
}
