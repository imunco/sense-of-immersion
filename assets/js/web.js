/* 蛛网 —— 一张真正的圆网，露珠是愿望 */
const MOODS = ['silk', 'abyss', 'moon', 'dusk'];
/* 命中半径（CSS px）。鼠标有 hover，点到就算；手指粗得多，命中的圆得给足。
   44px 是可点面积的下限，这里给到 60px —— 反正取的是最近的一颗，
   给大只会让「点在两颗中间」也选中，不会把更远的那颗抢过来。 */
const R_MOUSE = 22;
const R_TOUCH = 30;
const TAP_MOVE = 12;   /* 位移超过这么多就是拖动/滚动，不是「点」 */
const TAP_HOLD = 700;  /* 按住超过这么久是停下来看，不是「点」 */
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

/* 每颗露珠自己那缕丝 —— 命数的四态就画在这里。
   新结：丝细；凝露：多出几缕；结实：丝发亮；丝散：丝断，露珠悬在断丝上。
   颜色仍跟着愿望选的那条丝走。 */
function strand(ctx, x, y, state, rgb) {
  const c = rgb[0] + ',' + rgb[1] + ',' + rgb[2];
  const lift = Math.min(255, rgb[0] + 60) + ',' + Math.min(255, rgb[1] + 60) + ',' + Math.min(255, rgb[2] + 60);
  if (state === 'fresh') {
    ctx.strokeStyle = 'rgba(' + c + ',0.34)';
    ctx.lineWidth = 0.55;
    ctx.beginPath(); ctx.moveTo(x, y - 19); ctx.lineTo(x, y - 3); ctx.stroke();
    return;
  }
  if (state === 'solid') {
    ctx.strokeStyle = 'rgba(' + c + ',0.28)';
    ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(x, y - 30); ctx.lineTo(x, y - 3); ctx.stroke();
    ctx.strokeStyle = 'rgba(' + lift + ',0.74)';
    ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(x, y - 30); ctx.lineTo(x, y - 3); ctx.stroke();
    ctx.strokeStyle = 'rgba(' + lift + ',0.30)';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x, y - 22); ctx.quadraticCurveTo(x + 6, y - 16, x + 4, y - 8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - 16); ctx.quadraticCurveTo(x - 6, y - 11, x - 4, y - 4); ctx.stroke();
    return;
  }
  if (state === 'loose') {
    ctx.strokeStyle = 'rgba(' + c + ',0.30)';
    ctx.lineWidth = 0.65;
    ctx.beginPath(); ctx.moveTo(x, y - 26); ctx.lineTo(x, y - 11); ctx.stroke();   /* 断口留白 */
    ctx.beginPath(); ctx.moveTo(x + 0.8, y - 6); ctx.lineTo(x + 0.8, y - 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(' + c + ',0.18)';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x, y - 11); ctx.quadraticCurveTo(x + 3, y - 8, x + 1, y - 4); ctx.stroke();
    return;
  }
  /* dew */
  ctx.strokeStyle = 'rgba(' + c + ',0.42)';
  ctx.lineWidth = 0.62;
  ctx.beginPath(); ctx.moveTo(x, y - 24); ctx.lineTo(x, y - 3); ctx.stroke();
  ctx.strokeStyle = 'rgba(' + c + ',0.24)';
  ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(x, y - 18); ctx.quadraticCurveTo(x + 5, y - 13, x + 3, y - 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.quadraticCurveTo(x - 5, y - 8, x - 3, y - 3); ctx.stroke();
}

export class SilkWeb {
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.handlers = handlers || {};
    this.stateOf = this.handlers.stateOf || null;
    this.wishes = [];
    this.sprites = {};
    MOODS.forEach((m) => { this.sprites[m] = beadSprite(COLOR[m]); });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.hover = null;
    this.touchId = '';   /* 手机上「现在摊开着谁」——没有 hover，得自己记住 */
    this.down = null;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.running = false;
    this.t = 0;
    this.dwellId = '';
    this.dwellTimer = 0;
    this.bind();
    this.resize();
  }

  /* 画布坐标。手指给的 clientX/Y 要减掉画布的位置。 */
  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  bind() {
    /* 手指没有 hover：pointermove 在手机上只意味着拖动或滚动，不该拿它来选露珠。 */
    this.onMove = (e) => {
      if (e.pointerType === 'touch') return;
      const p = this.local(e);
      this.apply(this.hitAt(p.x, p.y, R_MOUSE), false);
    };
    this.onLeave = () => {
      if (this.touchId) return;   /* 手机上收起卡片靠再点一次，不靠「把手指移开」 */
      this.apply(null, false);
    };
    this.onDown = (e) => {
      const touch = e.pointerType === 'touch';
      this.down = { x: e.clientX, y: e.clientY, t: Date.now(), touch: touch, prev: this.touchId || '' };
      if (!touch) {
        /* 鼠标：指针已经在它上面了，按下就是「翻开」 */
        this.clearDwell();
        if (this.hover && this.handlers.onSelect) this.handlers.onSelect(this.hover.wish);
        return;
      }
      /* 手指按下去，先把这一颗亮出来 —— 这就是手机上的「悬停」 */
      const p = this.local(e);
      this.apply(this.hitAt(p.x, p.y, R_TOUCH), true);
    };
    this.onUp = (e) => {
      const d = this.down;
      this.down = null;
      if (!d || !d.touch) return;
      const moved = Math.abs(e.clientX - d.x) > TAP_MOVE || Math.abs(e.clientY - d.y) > TAP_MOVE;
      const held = Date.now() - d.t > TAP_HOLD;
      if (moved || held) return;               /* 拖动 / 长按：保持现状，不当成「点」 */
      const p = this.local(e);
      const found = this.hitAt(p.x, p.y, R_TOUCH);
      if (!found) { this.apply(null, true); return; }   /* 点空处：收起 */
      /* 按下去之前这一颗的卡片就开着 → 再点一下是「翻到那张海报」 */
      if (d.prev && d.prev === found.wish.id && this.handlers.onSelect) this.handlers.onSelect(found.wish);
    };
    this.onCancel = () => {
      const d = this.down;
      this.down = null;
      if (!d || !d.touch) return;
      /* 手势被系统接管（滚动 / 缩放）：回到按下去之前的样子 */
      if (d.prev) {
        const b = this.beads.filter((x) => x.wish.id === d.prev)[0];
        this.apply(b ? { bead: b, pos: b.pos || this.node(b.spoke, b.ring, b.jr, b.ja), wish: b.wish } : null, true);
      } else {
        this.apply(null, true);
      }
    };
    this.canvas.addEventListener('pointermove', this.onMove, { passive: true });
    this.canvas.addEventListener('pointerleave', this.onLeave);
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onCancel);
    this.onResize = () => { this.resize(); };
    window.addEventListener('resize', this.onResize);
  }

  /* 唯一的状态出口：改高亮、通知上层、重画，并管住「停够 1.5 秒才算读过」的计时。
     touch = true 表示这一下是手指点出来的（卡片要记住、要等第二下才翻开）。 */
  apply(found, touch) {
    const prev = this.hover;
    const changed = (!!found !== !!prev) || (found && prev && found.wish.id !== prev.wish.id);
    this.hover = found;
    if (touch) this.touchId = found ? found.wish.id : '';
    else this.touchId = '';
    this.canvas.style.cursor = found && !touch ? 'pointer' : 'default';
    if (changed) {
      if (this.handlers.onHover) this.handlers.onHover(found ? found.wish : null, found ? found.pos : null, !!touch);
      this.draw();
    }
    this.armDwell(found ? found.wish : null);
  }

  /* 在露珠上停够一会儿，才算读过它。
     一次连续停驻只报一次（手别抖）；离开再回来会重新起算 ——
     去重交给上层：本机对同一条只记一次，一天又只给出一条。
     手机上「点开来看着它」就是这里的停驻：卡片收起了，计时就作废。 */
  armDwell(wish) {
    const id = wish && wish.id ? wish.id : '';
    if (!id) { this.clearDwell(); return; }
    if (this.dwellId === id) return;
    this.clearDwell();
    this.dwellId = id;
    this.dwellTimer = setTimeout(() => {
      this.dwellTimer = 0;
      if (this.dwellId !== id) return;
      if (this.handlers.onDwell) this.handlers.onDwell(wish);
    }, 1500);
  }

  clearDwell() {
    if (this.dwellTimer) clearTimeout(this.dwellTimer);
    this.dwellTimer = 0;
    this.dwellId = '';
  }

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
      return {
        wish: wish, spoke: spoke, ring: ring, jr: jr, ja: ja,
        phase: ((hh >>> 23) % 628) / 100,
        born: wish.__born || 0,
        state: this.stateOf ? this.stateOf(wish) : 'dew'
      };
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

  setWishes(list, stateOf) {
    this.wishes = list || [];
    if (stateOf) this.stateOf = stateOf;
    this.layout();
    this.draw();
  }

  markBorn(id) {
    this.beads.forEach((b) => { if (b.wish.id === id) b.born = performance.now(); });
  }

  /* 命中测试：半径里取最近的一颗。用 b.pos（画的时候连「下坠」一起算过了），
     没有就先算一个 —— 于是点到的位置和看到的位置是同一个。 */
  hitAt(x, y, radius) {
    let best = null, bestD = radius * radius;
    this.beads.forEach((b) => {
      const p = b.pos || this.node(b.spoke, b.ring, b.jr, b.ja);
      const dx = p.x - x, dy = p.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = { bead: b, pos: { x: p.x, y: p.y }, wish: b.wish }; }
    });
    return best;
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

    /* 露珠与它那缕丝 */
    const now = performance.now();
    const BASE = { fresh: 26, dew: 34, solid: 46, loose: 30 };
    this.beads.forEach((b) => {
      const p = this.node(b.spoke, b.ring, b.jr, b.ja);
      const st = b.state || 'dew';
      const rgb = COLOR[b.wish.mood] || COLOR.silk;
      let scale = 1;
      if (b.born) {
        const age = (now - b.born) / 900;
        if (age < 1) scale = 0.2 + 0.8 * (1 - Math.pow(1 - age, 3)) * (1 + 0.45 * Math.sin(age * Math.PI));
        else b.born = 0;
      }
      const twinkle = this.reduced ? 1 : 0.86 + 0.14 * Math.sin(now / 1400 + b.phase);
      const isHover = this.hover && this.hover.wish.id === b.wish.id;
      const base = BASE[st] || BASE.dew;
      const size = (isHover ? 56 : base) * scale;
      const sprite = this.sprites[b.wish.mood] || this.sprites.silk;
      /* 丝散：露珠悬在断丝上，微微下坠 */
      const sag = st === 'loose' ? (this.reduced ? 5 : 4 + 2.2 * Math.sin(now / 1100 + b.phase)) : 0;
      strand(ctx, p.x, p.y, st, rgb);
      ctx.globalAlpha = Math.min(1, (isHover ? 1 : (st === 'loose' ? 0.7 : 0.96)) * twinkle);
      ctx.drawImage(sprite, p.x - size / 2, p.y + sag - size / 2, size, size);
      if (isHover) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(214,124,104,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(this.hub.x, this.hub.y);
        ctx.lineTo(p.x, p.y + sag);
        ctx.stroke();
      }
      b.pos = { x: p.x, y: p.y + sag };
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
    this.clearDwell();
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onCancel);
    window.removeEventListener('resize', this.onResize);
  }
}
