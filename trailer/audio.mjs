/* 声音 —— 直接算成 WAV，不依赖任何库。
   一间安静的屋子：底噪、低频嗡鸣、偶尔一声钟、一粒水珠落下的声音。
   node trailer/audio.mjs
*/
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'out/trailer.wav');
const SR = 44100;
const DUR = 45.6;
const N = Math.round(DUR * SR);

const L = new Float32Array(N);
const R = new Float32Array(N);

/* 可复现的噪声 */
let seed = 20260911;
function noise() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed / 0x3fffffff) - 1;
}
function add(i, v, pan) {
  if (i < 0 || i >= N) return;
  const p = pan == null ? 0 : pan;
  L[i] += v * (1 - Math.max(0, p));
  R[i] += v * (1 + Math.min(0, p));
}
const T = (s) => Math.round(s * SR);

/* 钟：几个不成整数倍的分音，衰减各不同 */
function bell(t0, base, amp, tau, pan) {
  const parts = [[1, 1, 1], [2.0, 0.46, 0.62], [2.76, 0.24, 0.44], [5.4, 0.1, 0.28], [8.9, 0.04, 0.18]];
  const s = T(t0);
  const len = Math.floor(SR * tau * 6);
  for (let k = 0; k < parts.length; k++) {
    const f = base * parts[k][0], a = amp * parts[k][1], th = tau * parts[k][2];
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const env = Math.exp(-t / th) * (1 - Math.exp(-t / 0.004));
      add(s + i, Math.sin(2 * Math.PI * f * t) * env * a, pan);
    }
  }
}

/* 拨一下丝 */
function pluck(t0, f0, f1, amp, tau, pan) {
  const s = T(t0), len = Math.floor(SR * tau * 5);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const k = Math.min(1, t / 0.09);
    const f = f0 + (f1 - f0) * k;
    ph += (2 * Math.PI * f) / SR;
    const env = Math.exp(-t / tau) * (1 - Math.exp(-t / 0.002));
    add(s + i, Math.sin(ph) * env * amp, pan);
  }
}

/* 一声气声，用来换镜 */
function whoosh(t0, dur, amp) {
  const s = T(t0), steps = Math.floor(dur * SR);
  let low = 0, band = 0;
  for (let i = 0; i < steps; i++) {
    const p = i / steps;
    const f = 320 * Math.pow(7, p);
    const w = (2 * Math.PI * f) / SR;
    const damp = 0.7;
    const input = noise() * 0.8;
    const high = input - low - damp * band;
    band += w * high; low += w * band;
    const env = Math.pow(Math.sin(Math.PI * p), 1.5);
    add(s + i, band * amp * env, (p - 0.5) * 1.2);
  }
}

/* 一滴水落定 */
function drop(t0, amp, pan) {
  const s = T(t0), len = Math.floor(SR * 0.5);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 1500 * Math.exp(-t / 0.045) + 330;
    ph += (2 * Math.PI * f) / SR;
    const env = Math.exp(-t / 0.075) * (1 - Math.exp(-t / 0.0015));
    add(s + i, Math.sin(ph) * env * amp, pan);
  }
  const s2 = T(t0 + 0.012), l2 = Math.floor(SR * 0.22);
  for (let i = 0; i < l2; i++) {
    const t = i / SR, env = Math.exp(-t / 0.03) * (1 - Math.exp(-t / 0.002));
    add(s2 + i, noise() * env * amp * 0.28, pan);
  }
}
function tick(t0, f, amp) { pluck(t0, f, f * 0.86, amp, 0.035, 0); }
function click(t0) {
  const s = T(t0), len = Math.floor(SR * 0.055);
  for (let i = 0; i < len; i++) {
    const t = i / SR, env = Math.exp(-t / 0.008);
    add(s + i, noise() * env * 0.05, 0);
  }
}

/* ── 底噪：一间屋子 ─────────────────────────────────── */
{
  let lp = 0, hp = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const w = noise();
    lp += (w - lp) * 0.045;
    hp += (lp - hp) * 0.0025;
    const breath = 0.62 + 0.38 * Math.sin(2 * Math.PI * 0.043 * t + 1.1);
    add(i, (lp - hp) * 0.055 * breath, 0);
  }
}

/* ── 嗡鸣：两个低频叠加，慢呼吸 ─────────────────────── */
{
  const voices = [[55, 0.020, -0.35, 0.061], [82.5, 0.0115, 0.35, 0.047], [110.4, 0.006, -0.2, 0.083], [164.8, 0.0035, 0.25, 0.037]];
  for (let v = 0; v < voices.length; v++) {
    const f = voices[v][0], a = voices[v][1], pan = voices[v][2], lfo = voices[v][3];
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      const env = Math.min(1, t / 7) * Math.min(1, Math.max(0, (DUR - 2.2 - t) / 5));
      const am = 1 + 0.22 * Math.sin(2 * Math.PI * lfo * t + v);
      add(i, Math.sin(2 * Math.PI * f * t) * a * env * am, pan);
    }
  }
}

/* ── 事件表 ─────────────────────────────────────────── */
pluck(0.25, 620, 430, 0.05, 0.10, -0.3);
bell(0.90, 523.25, 0.048, 1.9, 0.15);
pluck(2.30, 760, 520, 0.042, 0.09, 0.3);
bell(3.40, 659.25, 0.036, 1.7, -0.2);
whoosh(4.05, 0.75, 0.05);

drop(5.62, 0.075, -0.15);
bell(7.00, 587.33, 0.032, 1.8, 0.25);
bell(8.60, 783.99, 0.028, 1.6, -0.25);
whoosh(9.65, 0.7, 0.045);

tick(12.05, 940, 0.028);
tick(12.60, 1040, 0.024);
tick(13.00, 1180, 0.022);
pluck(13.45, 520, 380, 0.045, 0.14, 0);
click(14.62);
whoosh(15.45, 0.7, 0.05);

tick(17.05, 1080, 0.026);
click(23.62);

bell(21.40, 587.33, 0.05, 1.9, -0.2);
bell(22.60, 659.25, 0.05, 1.9, 0.2);
bell(23.80, 783.99, 0.05, 1.9, -0.2);
bell(25.00, 880.00, 0.05, 1.9, 0.2);
bell(26.20, 783.99, 0.05, 2.2, 0);

whoosh(24.25, 0.85, 0.075);
bell(24.45, 440.00, 0.055, 2.6, 0);
whoosh(26.15, 0.8, 0.06);
drop(27.42, 0.085, 0.1);
bell(27.55, 880.00, 0.04, 2.4, -0.1);
tick(30.10, 720, 0.022);

whoosh(32.05, 0.9, 0.06);
for (let i = 0; i < 7; i++) tick(34.15 + i * 0.42, 880 + i * 40, 0.018);
bell(35.40, 523.25, 0.03, 2.0, 0);
whoosh(37.30, 1.3, 0.055);
bell(38.15, 698.46, 0.038, 2.4, 0.2);

whoosh(39.25, 0.8, 0.055);
bell(41.10, 523.25, 0.05, 2.6, -0.15);

/* 终曲：一个和弦慢慢亮起来 */
{
  const ch = [[220, 0.031], [329.63, 0.024], [440, 0.019], [659.25, 0.011]];
  const s = T(42.6), len = Math.floor(SR * 3.0);
  for (let v = 0; v < ch.length; v++) {
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const env = Math.min(1, t / 1.1) * Math.exp(-Math.max(0, t - 1.2) / 2.4);
      add(s + i, Math.sin(2 * Math.PI * ch[v][0] * t) * ch[v][1] * env, (v - 1.5) * 0.35);
    }
  }
}

/* ── 收尾：淡出、归一、软限幅 ───────────────────────── */
{
  let peak = 0;
  for (let i = 0; i < N; i++) { peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
  const g = 0.62 / (peak || 1);
  const fadeStart = T(DUR - 1.15);
  for (let i = 0; i < N; i++) {
    let e = g;
    if (i < SR * 0.6) e *= i / (SR * 0.6);
    if (i > fadeStart) e *= Math.max(0, 1 - (i - fadeStart) / (N - fadeStart));
    L[i] = Math.tanh(L[i] * e * 1.05) * 0.97;
    R[i] = Math.tanh(R[i] * e * 1.05) * 0.97;
  }
}

/* ── 写 WAV ─────────────────────────────────────────── */
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
let o = 44;
for (let i = 0; i < N; i++) {
  const l = Math.max(-1, Math.min(1, L[i])), r = Math.max(-1, Math.min(1, R[i]));
  buf.writeInt16LE(Math.round(l * 32767), o); buf.writeInt16LE(Math.round(r * 32767), o + 2); o += 4;
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, buf);

let sum = 0, pk = 0;
for (let i = 0; i < N; i++) { sum += L[i] * L[i] + R[i] * R[i]; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
console.log('wrote ' + OUT);
console.log('  ' + DUR.toFixed(1) + 's · peak ' + (20 * Math.log10(pk)).toFixed(1) + ' dBFS · rms ' + (10 * Math.log10(sum / (N * 2))).toFixed(1) + ' dBFS · ' + (buf.length / 1048576).toFixed(1) + 'MB');
