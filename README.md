# 一线千愿 · One Thread, A Thousand Wishes

> 蛛丝很细，却挂得住一千个愿望。

一个沉浸式的许愿馆。你写下名字和愿望，它会被冲印成一张**还没有拍出来的电影海报**，
然后挂到蛛网上，成为一颗露珠。

**线上地址（全部由 Vercel 一处提供）**
- 许愿馆 → https://uncodeapps.icu/
- 放映室（后台）→ https://uncodeapps.icu/admin.html —— **页面上没有入口，只能手输网址**
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
7. **编号** —— 揭幕页给你一个七位编号。在蛛网上输入编号，就能翻到那张海报。
   **这里只按编号找，不按词找。** 别人拿到编号也能看，但**仅限公开的愿望**——
   仅自己可见的正文是加密的，编号查不到，只有写下它的那台设备、在「我写下的」里能看见。
8. **一次一句** —— 写下一条之后要等六小时才能写第二条。冷却期间写作区会换成一个剩余时间，
   署名那一幕就先说，不用填完名字才撞上。
9. **回响** —— 把蛛丝上所有公开愿望拆成词，看全站都在说什么，可以切「云」和「列」两种看法。
10. **递出去** —— 揭幕页上把这一句递给别人：链接、二维码、编号三种形式，
    一个人一天只递一次。有人读到它，那条丝才可能结实。

选「仅自己可见」的愿望：正文在**离开浏览器之前**就用站点公钥加密了，
中转站和公开仓库里都只有密文，蛛网上也不会出现。只有后台口令能解开。

愿望会先存进浏览器本机（刷新不丢），同时发往公共中转站；
提交的一瞬间，网页会去叫醒 GitHub Actions 把它归档进仓库，再由 Vercel 重新部署上线——
实测从提交到出现在蛛网上约 1 分钟。复制分享链接的人会直接看到那张海报。

---

## 丝的命数

蛛网上每颗露珠自己那缕丝有四种样子。**完全由前端算出来**，不用服务器，也不是「进度」：

| 状态 | 条件 | 视觉 |
|---|---|---|
| **新结** | 二十四小时内 | 丝细，露珠小 |
| **凝露** | 一到七天；或七天以上被自己续过丝 | 丝上多出几缕 |
| **结实** | 七天以上，且被读到过三次以上 | 丝发亮，露珠饱满 |
| **丝散** | 七天以上，还没被读够三次 | 丝断，露珠悬在断丝上微微下坠 |

它说的是「**有没有人接住**」，不是「愿望能不能实现」。丝散有两种说法，都不提「实现不了」：

- 一次都没被读过：「这一缕还没有人接住。」
- 被停过一两次：「有人在这里停过，但还没有人接住它。」

「三次」是按**人**算的：一个身份（签名 cookie）对同一条只算一次，一天又只给出一条，
所以约等于三个人读到过。

- **被读计数**：在露珠上停超过 1.5 秒，浏览器就在本机记一次；下次访问时成批打
  `/api/read`，由它认出是谁再转发到中转站，采集器聚合成 `data/reads.json`，前台读它。
  读一张海报也算读懂它。**自己写下的不算**——想接上自己那条断丝，用海报上的「把这条丝接上」。
- **「被读」是七层筛下来的**，每层挡一种打法。数字都在 `data/moderation.json` 里：

| # | 这一层 | 挡的是 |
|---|---|---|
| 1 | 形状：ids 必须是数组 | 乱塞东西 |
| 2 | 签名：只认 `/api/read` 签过名的身份 | 伪造身份。**清 localStorage 无效**——凭的是 HttpOnly cookie，不是浏览器里的随机值 |
| 3 | 工作量证明：每条消息挖 4 位零 | 脚本化灌水（从「发个请求」变成「花 CPU」） |
| 4 | 全站 600 条/天 | 换一堆代理 IP 的分布式农场 |
| 5 | 一个身份 1 条/天 | 「一个人一天只有一次机会」 |
| 6 | 一张出口网 3 条/天 | 清掉 cookie 再来；同时给家人/公司留余量（`WISH_READ_IP_OFF=1` 可整层关掉） |
| 7 | **同一条愿望 1 次/天** | 单条愿望刷不动 |

第 1、3、4、7 层**不看你是谁**，所以伪装成全新的人也换不来额外收益。
第 7 层有个直接后果：**「结实」需要三次被读分散在三个不同的日子** ——
那条丝是被人一天天记住的，不是一晚上刷出来的。

**没配 `WISH_READ_SECRET` 时**，第 2、4、5、6 层自动关闭，退回按客户端自报设备号的老办法
（站点照常能跑，但唯一化弱）；第 1、3、7 层照旧，所以连最坏情况下单条愿望也刷不动。
- **续丝**：自己写下的愿望，如果成了丝散，回来时能把它接上，状态回到「凝露」，
  **但只保七天**；过了又散，除非有人真的读到它。「结实」（真正被接住）始终只能由别人给。
  想让人读它，用揭幕页上的分享（链接 / 二维码 / 编号），一个人一天只递一次。
- **冷却**：一条愿望写成功之后六小时内不能再写。改时长只改一个值：
  `data/moderation.json` 的 `rate.cooldownHours`——前端显示剩余时间、采集器按设备强制，读的是同一份。
- **保持安静**：没有徽章、没有通知、没有进度条。只有丝在变。

---

## 回响

「回响」把蛛丝上所有**公开**愿望拆成词，按出现多少排成一片。两种看法随时切换：

- **云**：字号就是比率，最常说的词落在中央，其余沿螺旋往外铺，放不下的就不放（宁可留白）。
- **列**：名次 · 词 · 出现次数 · 占比，右边一行细线代表比率。

分词用浏览器自带的 `Intl.Segmenter`（不引任何库，拿不到就退回二字切分），
常见的虚词和「愿 / 希望 / 祝」这类许愿框都去掉了。整个统计在浏览器里现算，
所以永远是此刻最新的。**仅自己可见的愿望不在里面**——它们从来不上蛛网，也就不会有回声。

---

### 开启真正的一天一次（可选）

不配也能跑，但那时唯一化只靠浏览器里的一个随机值，清掉就没了。要让它算数，生成一个密钥，
同时放进 Vercel 和 GitHub（必须同一个值）：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # 生成
gh secret set WISH_READ_SECRET --body "<那个密钥>"
npx vercel env add WISH_READ_SECRET production                                   # 粘贴同一个值
npx vercel --prod                                                                # 重新部署
```

配好之后：`/api/read` 会签发 cookie、算出来源代号，采集器只认它签过名的读。
Vercel 那边没有这个变量时，函数只是原样转发、不签名；采集器也就不认签名——
**fail closed**，宁可少记，不可假记。

> ⚠️ **顺序不能反：先 Vercel，再 GitHub。** 反过来的那段时间里，采集器要求签名而函数签不出来，
> 读会**完全不计数**（fail closed 的代价）。改完用 `/api/health` 看 `readSigned` 是不是 `true`。

### 顺手把函数也接到带存储的限流上（可选）

无状态函数自己数不了数，所以「每 IP 几次」必须有外部存储。代码按 Vercel KV / Upstash 的
REST 接口写好了（`lib/kv.js`，纯 HTTP，**不引任何 npm 包**）。一条命令就能接上：

```bash
npx vercel integration add upstash/upstash-kv --plan free     # 会弹一次条款确认
# 接上后项目里自动多出 KV_REST_API_URL / KV_REST_API_TOKEN（还有 KV_URL / REDIS_URL）
```

也可以自己接别的 Upstash（或 Vercel KV），手动加那两个变量即可；
变量名认 `KV_REST_API_*` 和 `UPSTASH_REDIS_REST_*` 两套。

配了之后：`/api/poke` 每来源地址 5 分钟 6 次，`/api/read` 一小时 40 次。
没配就放行、响应里标明；KV 连不上也放行（限流失败不挡正常用户）。
写进 KV 的是「**地址的当天代号**」，不是地址本身。

验证（真实那台，不是假服务器；没配就自动跳过）：

```bash
node tests/kv-live.mjs     # 计数 1/2/3、超限拦住、EXPIRE 真的设上 TTL、键里没有地址
curl -s https://<你的域名>/api/health   # hasKv 应该是 true
```

---

### 第二因素：通行密钥（可选，但强烈建议）

口令泄露是这套系统里最现实的风险。装一把通行密钥之后，**进放映室要它签一次，
远程删除还要它单独签一次、由采集器验签** —— 只有口令的人删不掉任何东西，
自己拼一条密封指令发到中转站也过不了（采集器日志里会写「删除缺通行密钥」）。

**为什么不是验证器里那种 6 位码（TOTP）**：放映室是纯客户端的，TOTP 密钥要么放公开仓库
（谁都能算码），要么用口令加密后放仓库（**用口令就能解开**）——两种都挡不住拿到口令的人。
通行密钥的私钥在硬件里（Windows Hello、手机上的通行密钥、USB 安全钥匙），造不出签名，
而且不需要任何服务端：公钥放仓库就行，两边各自验。

装法：进放映室 → 右上角「登记通行密钥」→ 下载 `passkey.json` →
覆盖 `data/private/passkey.json` → 提交推送。
**只能由有仓库写权限的人装**——页面故意不能自己写，否则拿到口令的人可以给自己登记一把。
换域名要重新登记（rpId 变了）；钥匙丢了就把那个文件改回 `installed: false` 提交。

> ⚠️ **登记必须在域名上做。** rpId 必须是域名，Chrome 会直接拒绝 IP 地址
> （`127.0.0.1` 报 "invalid domain"）。本机自测请用 `http://localhost:4173`，
> 正式的钥匙要在你长期使用的域名上登记。页面会先检查并给出提示。

---

## 后台：放映室

`https://uncodeapps.icu/admin.html` —— **站内没有任何链接指向它，需要手输网址。**

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

**在放映室里远程删除。** 点开任意一条愿望，用「删除这条（远程）」按两下确认即可。
它做的事和上面的命令一样，只是不用你打开终端：浏览器用口令在本地派生的密钥把
「要删哪些 id」封成一段密文投到中转站，只有拿得到口令的采集器拆得开、才执行。
**口令本身不会离开浏览器。** 约一分钟后对所有人生效；那一瞬间起，前台也不再显示它。

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
| `data/reads.json` | 被读次数与续丝（前台算「丝的四态」用） |
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
  每设备 6 条/小时 + 写一条后 6 小时冷却 + 匿名桶 20 条/小时 +
  **全站 240 条/小时（服务端强制，不依赖任何客户端字段）** +
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
node tests/pentest.mjs          # 前端渗透：输入框与所有渲染路径（先起 serve.mjs）
node tests/pentest-server.mjs   # 服务端渗透：/api/read 与采集器
node tests/readid.test.mjs      # 读的唯一化：签名、防伪造、fail closed
node tests/passkey-e2e.mjs      # 通行密钥全链路（Chrome 虚拟认证器真跑一遍）
node tests/webauthn.test.mjs    # 断言校验的正反例 + 采集器拒收无签名删除
node tests/kv.test.mjs          # 带存储的限流（假 Upstash，任何机器都能跑）
node tests/kv-live.mjs          # 对着**真的**那台 Upstash 跑一遍（没配就自动跳过）
node tests/silk-collect.mjs     # 被读 / 续丝 / 远程删除 / 冷却（采集器侧）
node tests/envelope.test.mjs    # 元数据信封往返（要本机口令文件）
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
api/                  poke(叫醒归档) · read(被读的唯一化) · health · cron
lib/                  dispatch(叫醒 GitHub) · readid(签名 cookie / 来源代号) · kv(带存储的限流)
shared/               sha256 · crypto · envelope · keyring · webauthn(通行密钥校验)
assets/js/            config · fonts · store(数据层) · silk(编号与命数) · echoes(回响分词) · qr(二维码) · passkey(登记与删除签名) · poster(海报) · web(蛛网画布) · app · admin
assets/fonts/         Bodoni Moda / Cinzel / Jost 的 woff2
data/                 归档与配置
scripts/              采集 · 本地服务器 · 字体下载 · 删愿望
tests/                模块冒烟 · 全流程截图 · 二维码 / 唯一化 / 渗透测试
PRODUCT.md            给设计用的上下文：用户、语气、反参考、原则
DESIGN.md             配色、字体、动效、以及明确避开的东西
```

---

## 想换成真正的服务端？

现在这套是「无服务端」的：写入走公共中转站，读取走仓库里的归档。
如果以后要私密数据、要审核后再上墙、要更高的写入频率，把 `assets/js/store.js`
里的 `publish()` / `poll()` 换成你自己的 API 就行——前台的其余部分不需要动。
`data/wishes.jsonl` 可以直接当一个 SQLite 的导入源。
