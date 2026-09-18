# 一线千愿 · One Thread, A Thousand Wishes

> 蛛丝很细，却挂得住一千个愿望。

一个沉浸式的许愿馆。你写下名字和愿望，它会被冲印成一张**还没有拍出来的电影海报**，
然后挂到蛛网上，成为一颗露珠。

**线上地址**
- 许愿馆 → https://imunco.github.io/sense-of-immersion/
- 放映室（后台）→ https://imunco.github.io/sense-of-immersion/admin.html

---

## 玩法

1. **署名** —— 写下名字，它会以 `A WISH BY …` 出现在海报上。
2. **许愿** —— 写一句想被听见的话，右侧的海报会实时冲印出来。
3. **选丝** —— 蜘蛛糸 / 深海 / 月白 / 暮红，换一条丝，整站的强调色跟着变。
4. **揭幕** —— 一根丝垂下来，结出一颗露珠，海报落定。
5. **蛛网** —— 所有人的愿望都挂在同一张网上。鼠标扫过露珠可以读到它。

愿望会存进浏览器本机（刷新不丢），同时发往公共中转站，由 GitHub Action 每 5 分钟归档进仓库。
复制分享链接的人会直接看到那张海报。

---

## 后台：放映室

`admin.html`。口令的 SHA-256 存在 `data/config.json` 的 `adminHash` 里（当前口令在交付说明里）。
第一次部署后请立刻换掉它。

- 一句话概览：「今夜，蛛丝上多了 N 个愿望。」
- 近 30 天时间线。
- 账本：时间 / 署名 / 愿望 / 丝线 / 语言·时区 / 设备·视口 / 来源页，可排序、可搜索。
- 点任意一行打开抽屉：完整海报 + 全部字段。
- 导出 CSV（带 UTF-8 BOM，Excel 直接打开不乱码）与 JSON。
- 「未归档」标签 = 已经在中转站上、等采集器写入归档的最新愿望。

**改口令。** 口令不是明文存的，存的是 SHA-256（默认值和设置方式见交付说明）：

```bash
```bash
node scripts/set-passphrase.mjs "我的新口令"
gh secret set WISH_ADMIN_PASSPHRASE --body "我的新口令"
```

第一条会生成新的盐与站点密钥对、写回校验块；第二条让采集器也能用新口令加密。
（想保留历史密文就带上旧口令：`node scripts/set-passphrase.mjs "新" "旧"`。）

> 注意：`data/wishes.jsonl` 里是公开的署名与愿望——**这不需要口令，也确实谁都能读**。
> 口令管的是另一件事：`data/private/meta.jsonl` 和 `data/queue.jsonl` 里那些
> 「语言 / 时区 / 设备 / 来源」之类的信息，没有口令就是一堆密文。
> 详见 [SECURITY.md](SECURITY.md)。

**删一条愿望：**

```bash
node scripts/remove-wish.mjs <愿望 id>
```

会同时从归档里删掉、并写进 `data/blocked.json`，采集器以后不会再把它收回来。

---

## 它是怎么跑的（不需要任何账号、任何密钥）

```
访客浏览器
   │  POST 愿望（JSON）
   ▼
ntfy.sh 公共中转站  ──────────────►  网页实时轮询，别人的愿望立刻出现在蛛网上
   │  GET ?poll=1&since=<游标>          （12 小时缓存）
   ▼
GitHub Action（每 5 分钟，scripts/collect.mjs）
   │  去重、校验、限长
   ▼
data/wishes.jsonl  ──提交──►  GitHub Pages
                                 │
                       前台读它渲染蛛网 · 放映室读它做后台
```

选这套是因为：**它不需要你去任何平台注册、拿 token 或配密钥。**
ntfy 是公开的、匿名的、带 CORS 的中转站；GitHub 仓库本身就是持久层和后台数据库。

| 文件 | 作用 |
|---|---|
| `scripts/collect.mjs` | 采集器：拉取中转站 → 去重 → 追加归档 |
| `.github/workflows/collect.yml` | 每 5 分钟跑一次采集器并提交 |
| `data/config.json` | 中转站地址、话题名、口令 hash |
| `data/wishes.jsonl` | 归档，一行一条愿望 |
| `data/cursor.json` | 采集游标（上次读到哪一秒） |
| `data/blocked.json` | 屏蔽名单 |

---

## 安全与内容审查

完整说明见 **[SECURITY.md](SECURITY.md)**。要点：

- **公开的**：署名、愿望正文、时间、丝线颜色 —— 这是产品设定（蛛网就是给人看的）。
- **加密的**：语言 / 时区 / 设备 / 视口 / 来源页 / 设备标识。
  在浏览器里用 ECIES（临时 ECDH + HKDF + AES-GCM）密封 → 中转站只见密文 →
  采集器拆开后再用口令派生的 AES-256-GCM 密钥加密落盘 → 后台用口令在本地解开。
  口令不落盘、不上传，只存在内存里；刷新失效，闲置 30 分钟自动锁定；连错 5 次锁 60 秒。
- **写入侧**：形状校验 + 工作量证明（每条要挖 4 位十六进制零）+ 蜜罐 + 填写时长 +
  违禁词/链接/重复字符审查（**隔离待审，不删除**）+ 每设备 6 条/小时 + 匿名桶 20 条/小时 +
  内容去重 + 单次 120 条上限 + 归档 2 万条上限。
- **导出**：CSV 单元格做了公式注入防护。

审核被隔离的内容：

```bash
WISH_ADMIN_PASSPHRASE=<口令> node scripts/moderate.mjs list
WISH_ADMIN_PASSPHRASE=<口令> node scripts/moderate.mjs approve <id>   # 放上蛛网
node scripts/moderate.mjs reject <id>                                # 永久屏蔽
```

规则都在 `data/moderation.json`，改完提交即生效，不用重新部署。

> 需要先设置一次 GitHub Secret，采集器才能加密元数据：
> `gh secret set WISH_ADMIN_PASSPHRASE --body "<你的口令>"`
> 没有这个 Secret，采集器仍然工作，但只会归档公开部分，不保存基础信息。

---

## 本地跑

```bash
node scripts/serve.mjs 4173     # → http://127.0.0.1:4173/
```

必须用服务器打开，不能双击 `index.html`——`fetch('data/…')` 在 `file://` 下会被浏览器挡掉。
（挡掉也能用，会自动退化成「只存本机」模式。）

```bash
node scripts/fetch-fonts.mjs    # 重新下载自托管拉丁字体
node scripts/collect.mjs        # 手动跑一次采集
node tests/shots.mjs            # 用 Chrome 走一遍全流程并截图到 tests/shots/
node tests/debug.mjs            # 打印海报自适应缩放的中间量
```

---

## 重新部署

仓库已经接好 GitHub Pages（`main` 分支根目录）。改完代码：

```bash
git add -A && git commit -m "…" && git push
```

Pages 大约一分钟重建。采集器是定时任务，也可以在 Actions 页面手动 `Run workflow`。

**换一个中转站话题**（比如别人知道了你现在的话题，想换一个）：

```bash
node -e "console.log('wishsilk-' + Array.from({length:14},()=>'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random()*32)]).join(''))"
```

把新话题同时填进 `data/config.json` 和 `assets/js/config.js` 的 `FALLBACK.topic`，
并把 `data/cursor.json` 重置成 `{"since":"all"}`。旧的愿望留在归档里不会丢。

---

## 目录

```
index.html            许愿馆
admin.html            放映室
assets/css/           tokens(设计变量) · fonts(自托管字体) · base · experience · admin
assets/js/            config · fonts · store(数据层) · poster(海报) · web(蛛网画布) · app · admin
assets/fonts/         Bodoni Moda / Cinzel / Jost 的 woff2
data/                 归档与配置
scripts/              采集 · 本地服务器 · 字体下载 · 删愿望
tests/                模块冒烟测试 + 全流程截图脚本
PRODUCT.md            给设计用的上下文：用户、语气、反参考、原则
DESIGN.md             配色、字体、动效、以及明确避开的东西
```

---

## 想换成真正的服务端？

现在这套是「无服务端」的：写入走公共中转站，读取走仓库里的归档。
如果以后要私密数据、要审核后再上墙、要更高的写入频率，把 `assets/js/store.js`
里的 `publish()` / `poll()` 换成你自己的 API 就行——前台的其余部分不需要动。
`data/wishes.jsonl` 可以直接当一个 SQLite 的导入源。
