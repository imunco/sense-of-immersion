/* 蛛网 —— 一张真正的圆网，露珠是愿望 */
const MOODS = ['silk', 'abyss', 'moon', 'dusk'];
const COLOR = {
  silk:  [233, 150, 122],
  abyss: [104, 176, 186],
  moon:  [214, 176, 108],
  dusk:  [176, 66, 62]
};

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function beadSprite(rgb) {
  const size = 72;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const half = size / 2;
  const glow = g.createRadialGradient(half, half, 0, half, half, half);
  glow.addColorStop(0, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.85)');
  glow.addColorStop(0.30, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.34)');
  glow.addColorStop(1, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  const core = g.createRadialGradient(half - 4, half - 5, 1, half, half, half * 0.44);
  core.addColorStop(0, 'rgba(255,255,255,0.98)');
  core.addColorStop(0.45, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.92)');
  core.addColorStop(1, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.30)');
  g.fillStyle = core;
  g.beginPath();
  g.arc(half, half, half * 0.46, 0, Math.PI * 2);
  g.fill();
  return c;
}

export class SilkWeb {
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.handlers = handlers || {};
    this.wishes = [];
    this.sprites = {};
    MOODS.forEach((m) => { this.sprites[m] = beadSprite(COLOR[m]); });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.hover = null;
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
    this.onLeave = () => { this.pointer = null; this.hover = null; this.setHover(null); this.draw(); };
    this.onDown = () => {
      if (this.hover) {
        const w = this.hover.wish;
        if (this.handlers.onSelect) this.handlers.onSelect(w);
      }
    };
    this.canvas.addEventListener('pointermove', this.onMove, { passive: true });
    this.canvas.addEventListener('pointerleave', this.onLeave);
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.onResize = () => { this.resize(); };
    window.addEventListener('resize', this.onResize);
  }

  setHover(w) { if (this.handlers.onHover) this.handlers.onHover(w, this.hover ? this.hover.pos : null); }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect.width));
    const h = Math.max(360, Math.round(rect.height));
    this.w = w; this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.layout();
    this.draw();
  }

  layout() {
    const n = this.wishes.length;
    this.hub = { x: this.w * 0.5, y: this.h * 0.46 };
    this.spokes = Math.max(9, Math.min(19, Math.round(Math.sqrt(Math.max(n, 6)) * 1.5) + 6));
    this.rings = Math.max(6, Math.min(13, Math.round(Math.sqrt(Math.max(n, 6)) * 1.1) + 3));
    this.rMin = Math.min(this.w, this.h) * 0.10;
    this.rMax = Math.min(this.w * 0.46, this.h * 0.44);
    this.beads = this.wishes.map((wish, i) => {
      const hh = hash(String(wish.id || i));
      const spoke = hh % this.spokes;
      const ring = 1 + ((hh >>> 5) % (this.rings - 1));
      const jr = 1 + ((((hh >>> 11) % 100) / 100) - 0.5) * 0.05;
      const ja = ((((hh >>> 17) % 100) / 100) - 0.5) * 0.05;
      return { wish: wish, spoke: spoke, ring: ring, jr: jr, ja: ja, phase: ((hh >>> 23) % 628) / 100, born: wish.__born || 0 };
    });
  }

  radius(ring) {
    return this.rMin + (this.rMax - this.rMin) * Math.pow(ring / this.rings, 1.04);
  }

  angle(spoke, jitter) {
    const base = (spoke / this.spokes) * Math.PI * 2 - Math.PI / 2;
    const organic = 1 + 0.020 * Math.sin(spoke * 2.7 + 0.6);
    return base + (jitter || 0) * 0.16 + (organic - 1) * 0.6;
  }

  node(spoke, ring, jr, ja) {
    const a = this.angle(spoke, ja);
    const r = this.radius(ring) * (1 + 0.022 * Math.sin(spoke * 2.7 + ring * 1.9)) * (jr || 1);
    return { x: this.hub.x + Math.cos(a) * r, y: this.hub.y + Math.sin(a) * r };
  }

  setWishes(list) {
    this.wishes = list || [];
    this.layout();
    this.draw();
  }

  markBorn(id) {
    this.beads.forEach((b) => { if (b.wish.id === id) b.born = performance.now(); });
  }

  hit() {
    if (!this.pointer) return;
    let best = null, bestD = 22 * 22;
    this.beads.forEach((b) => {
      const p = this.node(b.spoke, b.ring, b.jr, b.ja);
      const dx = p.x - this.pointer.x, dy = p.y - this.pointer.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = { bead: b, pos: p, wish: b.wish }; }
    });
    const changed = (!!best !== !!this.hover) || (best && this.hover && best.wish.id !== this.hover.wish.id);
    this.hover = best;
    this.canvas.style.cursor = best ? 'pointer' : 'default';
    if (changed) { this.setHover(best ? best.wish : null); this.draw(); }
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.w, this.h);
    const sway = this.reduced ? 0 : Math.sin(this.t / 2600) * 0.0022;

    ctx.save();
    ctx.translate(this.hub.x, this.hub.y);
    ctx.rotate(sway);
    ctx.translate(-this.hub.x, -this.hub.y);

    /* 从天上垂下的那一根主丝 */
    const drop = ctx.createLinearGradient(0, 0, 0, this.hub.y);
    drop.addColorStop(0, 'rgba(214,124,104,0)');
    drop.addColorStop(1, 'rgba(214,124,104,0.42)');
    ctx.strokeStyle = drop;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.hub.x, 0);
    ctx.lineTo(this.hub.x, this.hub.y);
    ctx.stroke();

    /* 放射状的丝 */
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(120,132,132,0.30)';
    for (let s = 0; s < this.spokes; s++) {
      const a = this.angle(s);
      const p0 = { x: this.hub.x + Math.cos(a) * this.rMin * 0.7, y: this.hub.y + Math.sin(a) * this.rMin * 0.7 };
      const p1 = { x: this.hub.x + Math.cos(a) * this.rMax, y: this.hub.y + Math.sin(a) * this.rMax };
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(
        this.hub.x + Math.cos(a + 0.045) * this.rMax * 0.56,
        this.hub.y + Math.sin(a + 0.045) * this.rMax * 0.56,
        p1.x, p1.y
      );
      ctx.stroke();
    }

    /* 螺旋丝 */
    for (let k = 1; k <= this.rings; k++) {
      const alpha = 0.16 + 0.14 * (1 - k / this.rings);
      ctx.strokeStyle = 'rgba(120,132,132,' + alpha.toFixed(3) + ')';
      ctx.lineWidth = k === this.rings ? 1 : 0.75;
      ctx.beginPath();
      for (let s = 0; s <= this.spokes; s++) {
        const p = this.node(s % this.spokes, k, 1, 0);
        if (s === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    /* 中心的光 */
    const core = ctx.createRadialGradient(this.hub.x, this.hub.y, 0, this.hub.x, this.hub.y, this.rMin * 1.25);
    core.addColorStop(0, 'rgba(255,252,248,0.72)');
    core.addColorStop(0.42, 'rgba(233,150,122,0.16)');
    core.addColorStop(1, 'rgba(233,150,122,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(this.hub.x, this.hub.y, this.rMin * 1.25, 0, Math.PI * 2);
    ctx.fill();

    /* 露珠 */
    const now = performance.now();
    this.beads.forEach((b) => {
      const p = this.node(b.spoke, b.ring, b.jr, b.ja);
      let scale = 1;
      if (b.born) {
        const age = (now - b.born) / 900;
        if (age < 1) scale = 0.2 + 0.8 * (1 - Math.pow(1 - age, 3)) * (1 + 0.45 * Math.sin(age * Math.PI));
        else b.born = 0;
      }
      const twinkle = this.reduced ? 1 : 0.86 + 0.14 * Math.sin(now / 1400 + b.phase);
      const isHover = this.hover && this.hover.wish.id === b.wish.id;
      const size = (isHover ? 56 : 36) * scale;
      const sprite = this.sprites[b.wish.mood] || this.sprites.silk;
      ctx.globalAlpha = Math.min(1, (isHover ? 1 : 0.96) * twinkle);
      ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2, size, size);
      if (isHover) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(214,124,104,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(this.hub.x, this.hub.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      b.pos = p;
    });
    ctx.globalAlpha = 1;
    ctx.restore();
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
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('resize', this.onResize);
  }
}
