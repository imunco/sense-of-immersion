/* 丝 · 编号与命数
   ------------------------------------------------------------------
   编号：由愿望 id 确定性算出的七位短码。同一条愿望在任何设备上算出来都一样，
        所以揭幕页能立刻给出它，而站上的「输入编号」也能把它翻回那张海报。
   命数：四态（新结 / 凝露 / 结实 / 丝散）由「时间 + 被读次数」在前端算出来，
        不上报、不存储。它说的是「有没有人接住」，不是「愿望能不能实现」。
   ------------------------------------------------------------------ */
import { sha256Hex } from '../../shared/sha256.js';

/* Crockford 式字母表：砍掉 I L O U，读错的编号也找得回来 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LEN = 7;
const DAY = 864e5;

/* ---------------------------------------------------------------- 编号 */

/** 由愿望 id 算出七位编号。纯函数，浏览器与采集器一致。 */
export function wishCode(id) {
  const hex = sha256Hex('yixian-code:' + String(id == null ? '' : id));
  let acc = 0, bits = 0, out = '';
  for (let i = 0; i < hex.length && out.length < CODE_LEN; i += 2) {
    acc = (acc << 8) | parseInt(hex.substr(i, 2), 16);
    bits += 8;
    while (bits >= 5 && out.length < CODE_LEN) {
      out += ALPHABET[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  return out;
}

/** 手上拿到的编号归一化：大小写、空格、I/L/O 常见误写都能认出来。
    认不出来就返回 null（那就当关键词搜）。 */
export function normalizeCode(raw) {
  if (raw == null) return null;
  const s = String(raw).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (s.length !== CODE_LEN) return null;
  for (let i = 0; i < s.length; i++) if (ALPHABET.indexOf(s[i]) < 0) return null;
  return s;
}

/* ---------------------------------------------------------------- 命数 */

/* 要被真正接住，得有这么多次「被读」。本机对同一条只记一次，
   所以它约等于「至少这么多台不同的设备读到过」。 */
export const CAUGHT_AT = 3;

/* 自己回来把断丝接上，只保这么多天。过了又散，除非有人真的读到它。 */
export const MEND_GRACE = 7;

/* 丝散与「接上之后」各有一种说法： */
const LOOSE_UNSEEN = '这一缕还没有人接住。';
const LOOSE_SEEN = '有人在这里停过，但还没有人接住它。';
const DEW_MENDED = '丝重新连上了，但还没有人接住它。';

export const SILK = {
  fresh: {
    id: 'fresh', name: '新结', en: 'New Knot',
    line: '这一缕刚结上：丝还细，露珠还小。'
  },
  dew: {
    id: 'dew', name: '凝露', en: 'Dew',
    line: '丝上凝出了几缕露，有人在这里停过。'
  },
  solid: {
    id: 'solid', name: '结实', en: 'Set',
    line: '丝发亮，露珠饱满。有人把它读进去了。'
  },
  loose: {
    id: 'loose', name: '丝散', en: 'Loose',
    /* ⑤ 文案底线：只说「没有人接住」，绝不说「实现不了」 */
    line: LOOSE_UNSEEN
  }
};

export function readCount(rec, reads) {
  const id = rec && rec.id;
  if (!id || !reads) return 0;
  const n = reads[id];
  return Number.isFinite(n) ? n : 0;
}

/** 四态。定义写死在这里，前端与说明文案共用同一份。
    七天之后被读的次数不够 CAUGHT_AT，丝就还是会散 ——
    被停过一两次不算被接住，这一点靠第二句话讲明白；
    自己续过丝的，至少停在凝露。 */
export function silkPhase(rec, reads, mends, now) {
  const t = now == null ? Date.now() : now;
  const ts = (rec && rec.ts) || t;
  const age = Math.max(0, t - ts);
  const n = readCount(rec, reads);
  const mendedAt = Number(mends && rec && mends[rec.id]) || 0;
  const inGrace = mendedAt > 0 && (t - mendedAt) < MEND_GRACE * DAY;
  let state;
  if (age < DAY) state = 'fresh';                    /* 二十四小时内 */
  else if (age < 7 * DAY) state = 'dew';             /* 一到七天 */
  else if (n >= CAUGHT_AT) state = 'solid';          /* 被读够了 */
  else if (inGrace) state = 'dew';                   /* 自己接上的，还在保质期里 */
  else state = 'loose';                              /* 七天以上，还没被读够 */
  return { state: state, n: n, age: age, mendedAt: mendedAt, inGrace: inGrace };
}

export function silkState(rec, reads, mends, now) {
  return silkPhase(rec, reads, mends, now).state;
}

function withLine(base, line) {
  return { id: base.id, name: base.name, en: base.en, line: line };
}

export function silkOf(rec, reads, mends, now) {
  const p = silkPhase(rec, reads, mends, now);
  const base = SILK[p.state];
  if (p.state === 'loose' && p.n > 0) return withLine(base, LOOSE_SEEN);
  if (p.state === 'dew' && p.age >= 7 * DAY && p.inGrace && p.n < CAUGHT_AT) return withLine(base, DEW_MENDED);
  return base;
}

export const SILK_ORDER = ['fresh', 'dew', 'solid', 'loose'];
