/* 站点配置 —— 与 data/config.json 保持同一份真相（离线时用这里的兜底） */
export const FALLBACK = {
  topic: 'wishsilk-55gy3pgt5y7pzf',
  endpoint: 'https://ntfy.sh',
  title: '一线千愿',
  subtitle: 'One Thread, A Thousand Wishes',
  /* 归档触发器（Vercel 函数）。留空则只用 push / 守夜人 / GitHub 定时。 */
  /* 相对路径：站点和接口在同一个域名下，换自定义域名也不用改这里 */
  pokeUrl: '/api/poke',
  /* 「被读」走这里：由函数认出是谁、算出来源代号，再转发到中转站 */
  readUrl: '/api/read',
  /* 站点公钥：只能用来加密，公开无所谓 */
  siteKey: {"kty":"EC","crv":"P-256","x":"84zqpZW40I7kRX8aWZbwlKQKkISjwAcR2kOvYemaAcQ","y":"DIvQxdJ26rRBzUVR9f0CahKk8WyW7fu2ooN55Eg1Kqk"},
  proofOfWork: { difficulty: 4 }
};

/* 四种丝线：颜色在 tokens.css 里以 [data-thread] 定义 */
export const THREADS = [
  { id: 'silk',  name: '蜘蛛糸', en: 'Spider Silk', hue: '珊瑚' },
  { id: 'abyss', name: '深海',   en: 'Deep Water',  hue: '青' },
  { id: 'moon',  name: '月白',   en: 'Moon White',  hue: '淡金' },
  { id: 'dusk',  name: '暮红',   en: 'Dusk',        hue: '深绯' }
];

export const threadById = (id) => THREADS.find(function (t) { return t.id === id; }) || THREADS[0];
