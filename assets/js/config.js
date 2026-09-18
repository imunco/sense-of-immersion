/* 站点配置 —— 与 data/config.json 保持同一份真相（离线时用这里的兜底） */
export const FALLBACK = {
  topic: 'wishsilk-55gy3pgt5y7pzf',
  endpoint: 'https://ntfy.sh',
  title: '一线千愿',
  subtitle: 'One Thread, A Thousand Wishes'
};

/* 四种丝线：颜色在 tokens.css 里以 [data-thread] 定义 */
export const THREADS = [
  { id: 'silk',  name: '蜘蛛糸', en: 'Spider Silk', hue: '珊瑚' },
  { id: 'abyss', name: '深海',   en: 'Deep Water',  hue: '青' },
  { id: 'moon',  name: '月白',   en: 'Moon White',  hue: '淡金' },
  { id: 'dusk',  name: '暮红',   en: 'Dusk',        hue: '深绯' }
];

export const threadById = (id) => THREADS.find(function (t) { return t.id === id; }) || THREADS[0];
