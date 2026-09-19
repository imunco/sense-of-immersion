/* 二维码 —— 字节模式，纠错等级 M，版本 1–20。
   自己写的原因：站点一个运行期依赖都没有，也不该把一条愿望的链接
   递给别人的二维码服务去生成。够放一条分享链接（约 800 字节）。
   实现按 ISO/IEC 18004：模式指示符 → 字符计数 → 数据 → 填充 →
   分块 Reed-Solomon → 交织 → 矩阵 → 8 种掩码挑罚分最低的 → 格式/版本信息。 */

/* 纠错等级 M 的分块表：[ [块数, 每块数据码字], ... ]，按版本 1–20 */
const GROUPS_M = [null,
  [[1, 16]], [[1, 28]], [[1, 44]], [[2, 32]], [[2, 43]], [[4, 27]], [[4, 31]],
  [[2, 38], [2, 39]], [[3, 36], [2, 37]], [[4, 43], [1, 44]], [[1, 50], [4, 51]],
  [[6, 36], [2, 37]], [[8, 37], [1, 38]], [[4, 40], [5, 41]], [[5, 41], [5, 42]],
  [[7, 45], [3, 46]], [[10, 46], [1, 47]], [[9, 43], [4, 44]], [[3, 44], [11, 45]], [[3, 41], [13, 42]]
];
const EC_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
/* 校正图形的位置 */
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42],
  [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66],
  [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90]];

const MAX_VERSION = 20;

/* ---------------------------------------------------------------- GF(256) */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function () {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
function mul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

function polyMul(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] ^= mul(a[i], b[j]);
  return out;
}
function genPoly(n) {
  let p = [1];
  for (let i = 0; i < n; i++) p = polyMul(p, [1, EXP[i]]);
  return p;
}
/* 辗转相除求余，余数就是纠错码字 */
function ecc(data, ecLen) {
  const gen = genPoly(ecLen);
  const rem = new Array(ecLen).fill(0);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.shift();
    rem.push(0);
    if (factor) for (let j = 0; j < ecLen; j++) rem[j] ^= mul(gen[j + 1], factor);
  }
  return rem;
}

/* ---------------------------------------------------------------- 码流 */
function dataCodewords(v) {
  let n = 0;
  for (const [blocks, len] of GROUPS_M[v]) n += blocks * len;
  return n;
}
function countBits(v) { return v <= 9 ? 8 : 16; }

function pushBits(out, value, len) {
  for (let i = len - 1; i >= 0; i--) out.push((value >>> i) & 1);
}

function pickVersion(byteLen) {
  for (let v = 1; v <= MAX_VERSION; v++) {
    if (4 + countBits(v) + byteLen * 8 <= dataCodewords(v) * 8) return v;
  }
  return 0;
}

/* ---------------------------------------------------------------- 矩阵 */
/* BCH(15,5)：把 (data5<<10) 对 0x537 做长除法，余数必须降到 10 位。
   这里要一位一位看「当前余数」的最高位，不能只看 data5 的原始位 ——
   异或之后会带出新的高位，只看原始位就会漏掉它们。 */
function formatBits(data5) {
  let rem = data5 << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return (((data5 << 10) | rem) ^ 0x5412) & 0x7fff;
}
function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return ((version << 12) | rem) & 0x3ffff;
}

const MASKS = [
  function (r, c) { return (r + c) % 2 === 0; },
  function (r) { return r % 2 === 0; },
  function (r, c) { return c % 3 === 0; },
  function (r, c) { return (r + c) % 3 === 0; },
  function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
  function (r, c) { return ((r * c) % 2) + ((r * c) % 3) === 0; },
  function (r, c) { return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; },
  function (r, c) { return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; }
];

function penalty(get, size) {
  let score = 0;
  /* 规则一：同色连续 5 个以上 */
  for (let i = 0; i < size; i++) {
    for (const dir of [0, 1]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        const prev = dir ? get(j - 1, i) : get(i, j - 1);
        const cur = dir ? get(j, i) : get(i, j);
        if (cur === prev) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }
  /* 规则二：2x2 同色 */
  for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
    const v = get(r, c);
    if (v === get(r, c + 1) && v === get(r + 1, c) && v === get(r + 1, c + 1)) score += 3;
  }
  /* 规则三：1011101 这种像定位图形的花样 */
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const hit = function (vals, pat) {
    for (let i = 0; i + pat.length <= vals.length; i++) {
      let ok = true;
      for (let j = 0; j < pat.length; j++) if (vals[i + j] !== pat[j]) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  };
  for (let i = 0; i < size; i++) {
    const row = [], col = [];
    for (let j = 0; j < size; j++) { row.push(get(i, j)); col.push(get(j, i)); }
    if (hit(row, A) || hit(row, B)) score += 40;
    if (hit(col, A) || hit(col, B)) score += 40;
  }
  /* 规则四：黑白比例偏离一半 */
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += get(r, c) ? 1 : 0;
  const percent = dark * 100 / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/**
 * 把一段文本编成二维码。
 * 返回 { version, size, modules }，modules 是 size*size 的 0/1（1 = 深色）。
 */
export function encodeQR(text, opts) {
  const forced = opts && Number.isInteger(opts.mask) ? opts.mask : null;
  const bytes = new TextEncoder().encode(String(text == null ? '' : text));
  const version = pickVersion(bytes.length);
  if (!version) throw new Error('这一段太长，二维码放不下');

  const stream = [];
  pushBits(stream, 0b0100, 4);
  pushBits(stream, bytes.length, countBits(version));
  for (let i = 0; i < bytes.length; i++) pushBits(stream, bytes[i], 8);

  const capacity = dataCodewords(version) * 8;
  pushBits(stream, 0, Math.min(4, capacity - stream.length));
  while (stream.length % 8) stream.push(0);

  const dataCw = [];
  for (let i = 0; i < stream.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | stream[i + j];
    dataCw.push(v);
  }
  let padByte = 0xec;
  while (dataCw.length < dataCodewords(version)) { dataCw.push(padByte); padByte = padByte === 0xec ? 0x11 : 0xec; }

  /* 分块 + 纠错 + 交织 */
  const ecLen = EC_M[version];
  const blocks = [];
  let at = 0;
  for (const [count, len] of GROUPS_M[version]) {
    for (let i = 0; i < count; i++) {
      const d = dataCw.slice(at, at + len);
      at += len;
      blocks.push({ d: d, e: ecc(d, ecLen) });
    }
  }
  const longest = blocks.reduce(function (m, b) { return Math.max(m, b.d.length); }, 0);
  const codewords = [];
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.d.length) codewords.push(b.d[i]);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) codewords.push(b.e[i]);

  const bits = [];
  for (const cw of codewords) pushBits(bits, cw, 8);

  /* 矩阵 */
  const size = version * 4 + 17;
  const mods = new Uint8Array(size * size);
  const fixed = new Uint8Array(size * size);
  const setF = function (r, c, v) {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    mods[r * size + c] = v ? 1 : 0;
    fixed[r * size + c] = 1;
  };
  const finder = function (r0, c0) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const ring = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                   (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                   (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      setF(r0 + r, c0 + c, ring ? 1 : 0);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { setF(6, i, i % 2 === 0 ? 1 : 0); setF(i, 6, i % 2 === 0 ? 1 : 0); }
  const al = ALIGN[version];
  for (const r of al) for (const c of al) {
    if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      setF(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0);
    }
  }
  setF(size - 8, 8, 1);   /* 固定深色模块 */
  const reserve = function (r, c) { if (!fixed[r * size + c]) { mods[r * size + c] = 0; fixed[r * size + c] = 1; } };
  for (let i = 0; i <= 8; i++) { if (i !== 6) { reserve(8, i); reserve(i, 8); } }
  for (let i = 0; i < 8; i++) { reserve(8, size - 1 - i); reserve(size - 1 - i, 8); }
  if (version >= 7) {
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { setF(size - 11 + j, i, 0); setF(i, size - 11 + j, 0); }
  }

  /* 数据按 Z 字形填进去 */
  let bi = 0, upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < size; k++) {
      const row = upward ? size - 1 - k : k;
      for (let d = 0; d < 2; d++) {
        const cc = col - d;
        if (fixed[row * size + cc]) continue;
        mods[row * size + cc] = bi < bits.length ? bits[bi] : 0;
        bi++;
      }
    }
    upward = !upward;
  }

  /* 八种掩码，挑罚分最低的一种 */
  const get = function (r, c) { return mods[r * size + c]; };
  let bestMask = 0, bestScore = Infinity;
  for (let m = 0; forced == null && m < 8; m++) {
    const fn = MASKS[m];
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (!fixed[r * size + c] && fn(r, c)) mods[r * size + c] ^= 1;
    }
    const score = penalty(get, size);
    if (score < bestScore) { bestScore = score; bestMask = m; }
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (!fixed[r * size + c] && fn(r, c)) mods[r * size + c] ^= 1;
    }
  }
  const useMask = forced == null ? bestMask : (forced & 7);
  const mask = MASKS[useMask];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (!fixed[r * size + c] && mask(r, c)) mods[r * size + c] ^= 1;
  }

  /* 格式信息：纠错等级 M 的两位是 00，数据 5 位 = 掩码号 */
  const fmt = formatBits(useMask);
  /* 第一份：围着左上定位图形，沿第 8 行与第 8 列各铺一段 */
  for (let i = 0; i <= 5; i++) mods[i * size + 8] = (fmt >>> i) & 1;
  mods[7 * size + 8] = (fmt >>> 6) & 1;
  mods[8 * size + 8] = (fmt >>> 7) & 1;
  mods[8 * size + 7] = (fmt >>> 8) & 1;
  for (let i = 9; i < 15; i++) mods[8 * size + (14 - i)] = (fmt >>> i) & 1;
  /* 第二份：右上横着一段，左下竖着一段 */
  for (let i = 0; i < 8; i++) mods[8 * size + (size - 1 - i)] = (fmt >>> i) & 1;
  for (let i = 8; i < 15; i++) mods[(size - 15 + i) * size + 8] = (fmt >>> i) & 1;
  /* 固定深色模块：必须写在格式信息之后，否则会被它盖掉 */
  mods[(size - 8) * size + 8] = 1;

  /* 版本信息（7 及以上）：右上 3×6、左下 6×3 各一份 */
  if (version >= 7) {
    const vb = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = (vb >>> i) & 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      mods[b * size + a] = bit;
      mods[a * size + b] = bit;
    }
  }

  return { version: version, size: size, modules: mods, mask: useMask };
}

/** 画到 canvas 上。opts: { scale, quiet, dark, light, margin } */
export function drawQR(canvas, text, opts) {
  const o = opts || {};
  const qr = encodeQR(text);
  const quiet = o.quiet == null ? 2 : o.quiet;
  const total = qr.size + quiet * 2;
  const css = o.size || 220;
  const scale = Math.max(2, Math.floor(css / total));
  const px = total * scale;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = px * dpr;
  canvas.height = px * dpr;
  canvas.style.width = px + 'px';
  canvas.style.height = px + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = o.light || '#ffffff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = o.dark || '#20313a';
  for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) {
    if (qr.modules[r * qr.size + c]) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
  }
  return qr;
}
