/* 字体装载：拉丁展示字体本地自托管；中文宋体先走 Google，
   不通就换镜像——中国大陆访问 Google Fonts 常常是不通的。 */
const CJK = 'Noto Serif SC';
const SOURCES = [
  'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700;900&display=swap',
  'https://fonts.loli.net/css2?family=Noto+Serif+SC:wght@400;700;900&display=swap',
  'https://fonts.geekzu.org/css2?family=Noto+Serif+SC:wght@400;700;900&display=swap'
];

function inject(source) {
  return new Promise(function (resolve) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = source;
    let settled = false;
    const done = function (ok) { if (!settled) { settled = true; resolve(ok); } };
    link.onload = function () { done(true); };
    link.onerror = function () { done(false); };
    setTimeout(function () { done(false); }, 6000);
    document.head.appendChild(link);
  });
}

async function usable() {
  if (!document.fonts || !document.fonts.load) return false;
  try {
    const faces = await document.fonts.load('900 40px "' + CJK + '"', '愿丝线');
    return faces && faces.length > 0;
  } catch (e) { return false; }
}

export async function loadFonts() {
  for (let i = 0; i < SOURCES.length; i++) {
    const ok = await inject(SOURCES[i]);
    if (!ok) continue;
    if (await usable()) { document.documentElement.dataset.cjk = 'loaded'; return SOURCES[i]; }
  }
  document.documentElement.dataset.cjk = 'fallback';
  return null;
}
