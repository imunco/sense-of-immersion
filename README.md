# 一线千愿 · One Thread, A Thousand Wishes

> 蛛丝很细，却挂得住一千个愿望。

一个沉浸式的许愿馆。你写下名字和愿望，它会被冲印成一张**还没有拍出来的电影海报**，
然后挂到蛛网上，成为一颗露珠。

**线上地址（全部由 Vercel 一处提供）**
- 许愿馆 → https://yixian-archive.vercel.app/
- 放映室（后台）→ https://yixian-archive.vercel.app/admin.html —— **页面上没有入口，只能手输网址**
- 归档接口 → `/api/health`（健康检查）、`/api/poke`（触发归档）

> GitHub Pages 已停用。仓库只作为源码与数据的存放地，
> 线上服务一律走 Vercel（页面、资源、数据、接口同一个域名）。

---

## 玩法

1. **署名** —— 写下名字，它会以 `A WISH BY …` 出现在海报上。
2. **许愿** —— 写一句想被听见的话，右侧的海报会实时冲印出来。
3. **选丝** —— 蜘蛛糸 / 深海 / 月白 / 暮红，换一条丝，整站的强调色跟着变。
4. **选看给谁** —— **公开**（挂上蛛网，所有人读到）或 **仅自己可见**（端到端加密，不公开）。
5. **揭幕** —— 一根丝垂下来，结出一颗露珠，海报落定。
6. **蛛网** —— 公开的愿望挂在同一张网上，鼠标扫过露珠可以读到它。

选「仅自己可见」的愿望：正文在**离开浏览器之前**就用站点公钥加密了，
中转站和公开仓库里都只有密文，蛛网上也不会出现。只有后台口令能解开。

愿望会先存进浏览器本机（刷新不丢），同时发往公共中转站；
提交的一瞬间，网页会去叫醒 GitHub Actions 把它归档进仓库，再由 Vercel 重新部署上线——
实测从提交到出现在蛛网上约 1 分钟。复制分享链接的人会直接看到那张海报。

---

## 后台：放映室

`https://yixian-archive.vercel.app/admin.html` —— **站内没有任何链接指向它，需要手输网址。**

口令不落盘：仓库里只有 PBKDF2 的盐、迭代次数，以及一段用派生密钥加密的校验块
（`data/private/verifier.json`）。解锁时浏览器本地跑 25 万次 PBKDF2，
密钥只存在内存里，刷新即失效，闲置 30 分钟自动锁定。
换口令用 `node scripts/set-passphrase.mjs "新口令" "旧口令"`，**不会丢历史数据**。

- 一句话概览：「今夜，蛛丝上多了 N 个愿望。」
- 近 30 天时间线。
- 账本：时间 / 署名 / 愿望 / 丝线 / 语言·时区 / 设备·视口 / 来源页，可排序、可搜索。
- 点任意一行打开抽屉：完整海报 + 全部字段。
- 导出 CSV（带 UTF-8 BOM，Excel 直接打开不乱码）与 JSON。
- 「未归档」标签 = 已经在中转站上、等采集器写入归档的最新愿望。

**改口令。** 口令不是明文存的，存的是 SHA-256（默认值和设置方式见交付说明）：

```bash
```bash
node scripts/set-passphrase.mjs "我的新口令" "当前口令"
gh secret set WISH_ADMIN_PASSPHRASE --body "我的新口令"
```

带上当前口令，脚本会解开密钥环、用新口令重新包一次——
**历史元数据和「仅自己可见」的愿望都照旧可读，不会丢。**
（不给旧口令就会生成全新的密钥环，那就等于把历史数据作废，脚本会先警告。）

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

- **由用户决定**：每条愿望提交时选「公开」或「仅自己可见」。
  公开的署名与正文就是公开的（这是产品设定）；私密的正文在浏览器里就被加密。
- **一律加密的**：语言 / 时区 / 设备 / 视口 / 来源页 / 设备标识。
  在浏览器里用 ECIES（临时 ECDH + HKDF + AES-GCM）密封 → 中转站只见密文 →
  采集器拆开审查后再用**数据密钥（DEK）**加密落盘 → 后台用口令解开的 KEK 取回 DEK 再解开。
  口令不落盘、不上传，只存在内存里；刷新失效，闲置 30 分钟自动锁定；连错 5 次锁 60 秒。
- **写入侧**：形状校验 + 工作量证明（每条要挖 4 位十六进制零，实测约 0.45 秒 CPU）+
  蜜罐 + 填写时长 + 违禁词/链接/重复字符审查（**隔离待审，不删除**）+
  每设备 6 条/小时 + 匿名桶 20 条/小时 + **全站 240 条/小时（服务端强制，不依赖任何客户端字段）** +
  内容去重 + 单次 120 条上限 + 归档 2 万条上限。
- **导出**：CSV 单元格做了公式注入防护。
- **换口令不丢数据**：数据密钥与口令分开，换口令只是重新包一次密钥环。

审核被隔离的内容：

```bash
WISH_ADMIN_PASSPHRASE=<口令> node scripts/moderate.mjs list            # 被隔离的内容
WISH_ADMIN_PASSPHRASE=<口令> node scripts/moderate.mjs vault           # 「仅自己可见」的愿望
WISH_ADMIN_PASSPHRASE=<口令> node scripts/moderate.mjs approve <id> --push   # 放行到蛛网
WISH_ADMIN_PASSPHRASE=<口令> node scripts/moderate.mjs publish <id> --push   # 把私密的改为公开
node scripts/moderate.mjs reject <id> --push                                # 永久屏蔽
node scripts/remove-wish.mjs <id> --push                                    # 删除并屏蔽
```

`--push` 会顺手提交并推送，约一分钟后 Pages 重建生效。

规则都在 `data/moderation.json`，改完提交即生效，不用重新部署。

> 需要先设置一次 GitHub Secret，采集器才能加密元数据：
> `gh secret set WISH_ADMIN_PASSPHRASE --body "<你的口令>"`
> 没有这个 Secret，采集器仍然工作，但只会归档公开部分，不保存基础信息。

---

## 归档与持久化

**实测结论：GitHub 的 `on.schedule` 极不可靠。** 建好之后 3 小时才第一次触发，
之后也不按 5 分钟来。所以归档的主触发搬到了 Vercel（见 [VERCEL.md](VERCEL.md)）：

```
访客提交 → 网页 POST /api/poke（浏览器里没有任何令牌）
        → Vercel 函数带着令牌 dispatch GitHub Actions
        → 采集 / 审查 / 加密 / 提交 → Pages 生效
```

实测从提交到入库约 1 分钟，且完全不依赖这台电脑开机。

现在有四条路，按可靠性排序：

| 路径 | 怎么触发 | 状态 |
|---|---|---|
| **Vercel 事件触发** | 访客一提交，网页就打 `/api/poke`，服务端去 dispatch Actions | ✅ **主力**（秒级） |
| 本地守夜人 | Windows 计划任务每 15 分钟跑一次 `scripts/watchdog.mjs` | ✅ 第二道 |
| 任意 push | 一 push 就顺手归档一次 | ✅ |
| 手动 | `gh workflow run collect-wishes` | ✅ |
| GitHub 定时 | `cron: '*/5 * * * *'` | ⚠️ 会跑，但 3 小时才启动一次，不可依赖 |

再加两条兜底，让归档滞后也不会丢东西：

- **前台和后台都直接读中转站**，所以归档慢不影响网站正常使用——蛛网和放映室都能看到最新愿望。
- **访客浏览器里留一份**：下次打开页面时，如果这条愿望还没出现在 `wishes.jsonl` 或
  `vault.jsonl` 里（保险库只暴露 id，所以私密愿望也能验证），就再投一次。
  采集器按 id 去重，重复投递不会产生重复愿望。只要还有人回来，12 小时的中转缓存就不会把愿望弄丢。

### 守夜人

```bash
# 看状态
Get-ScheduledTask -TaskName yixian-archive-watchdog
Get-Content .dsh-watchdog.log -Tail 20

# 立刻归档一次
node scripts/watchdog.mjs

# 不需要了就卸载
powershell -ExecutionPolicy Bypass -File scripts/install-watchdog.ps1 -Remove
```

它从 `.dsh-passphrase.local` 读口令（该文件在 `.gitignore` 里，不要提交），
每一步都带重试；工作区里有已跟踪源码被改动时会自动跳过，不打断开发。

### 体检与备份

```bash
node scripts/audit.mjs                                 # 中转站上的东西都落库了吗
WISH_ADMIN_PASSPHRASE=<口令> node scripts/backup.mjs    # 解密导出到 backups/<时间戳>/
```

`audit.mjs` 列出「还在中转站、但既没进归档也没进保险库」的愿望（按内容去重的会单独说明，
不算丢失），超过阈值（默认 60 分钟）以非零码退出，可以直接挂进计划任务报警。
`backup.mjs` 会把公开愿望、私密愿望（解密）、待审内容导出成 JSON + CSV，并把原始密文原样拷一份。
`backups/` 里有明文，已在 `.gitignore` 里。

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
