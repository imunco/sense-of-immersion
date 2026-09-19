# 归档触发（Vercel）—— 已部署

**状态：已上线并验证通过。**

| | |
|---|---|
| 站点 | https://yixian-archive.vercel.app/ （许愿馆） |
| 后台 | https://yixian-archive.vercel.app/admin.html （无站内入口） |
| 健康检查 | https://yixian-archive.vercel.app/api/health |
| 触发端点 | https://yixian-archive.vercel.app/api/poke |
| 被读端点 | https://yixian-archive.vercel.app/api/read |
| Vercel 项目 | `xcdh520-githubs-projects/yixian-archive` |
| 已配环境变量 | `GITHUB_DISPATCH_TOKEN`、`GITHUB_REPO`、`GITHUB_WORKFLOW`、`ALLOWED_ORIGINS`、`WISH_READ_SECRET`、`KV_REST_API_URL`、`KV_REST_API_TOKEN`（最后两个由 Upstash 集成注入） |
| GitHub Secrets | `WISH_ADMIN_PASSPHRASE`、`WISH_READ_SECRET`（**必须与 Vercel 同一个值**） |
| 带存储的限流 | Upstash for Redis（免费版，主区东京 `hnd1`），资源名 `yixian-rate` |
| 放映室第二因素 | 通行密钥已登记（`data/private/passkey.json` 的 rpId 是线上域名） |
| GitHub Pages | **已停用** |

### 别只看这份文档，三行命令核实

```bash
curl -s https://yixian-archive.vercel.app/api/health
# → {"ok":true,…,"hasKv":true,"readSigned":true}
gh secret list --repo imunco/sense-of-immersion     # 应能看到 WISH_READ_SECRET
node tests/kv-live.mjs                              # 对着真的那台 Upstash 跑一遍限流
```

`hasKv` / `readSigned` 是后加的字段。这两个恰好是最容易「以为配好了、其实没配」的地方
——**本文档上一版就在这里写错过一次**：把当时并没配的 `WISH_READ_SECRET` 写成了已配。
所以现在让函数自己如实报出来，而不是靠文档自证。

### 站点是怎么输出的

`build-vercel.mjs` 会把仓库根目录的 `index.html`、`admin.html`、`assets/`、`data/`、`shared/`、`robots.txt`
收进 `public/`（Vercel 的静态输出目录），而 `api/` 仍然被当作函数。
所以仓库结构不用动 —— GitHub Action 照旧往根目录的 `data/` 写，构建时再同步进 `public/`。

> ⚠️ `shared/` 必须一起输出：`assets/js/store.js` 会 `import '../../shared/sha256.js'`，
> 漏了它整个页面的脚本都不会执行（页面看起来"没坏"，但所有数据都是空的）。

### 数据是怎么更新的

采集器提交 → Vercel 的 Git 集成自动重新部署（实测约 11 秒）→ 新数据上线。
不需要额外的 deploy hook。

实测：线上提交一条愿望 → 浏览器打 `/api/poke` → GitHub Actions 在几秒内被叫醒 →
愿望进归档。**全程不需要本机开机，也不依赖 GitHub 那个慢三小时的定时任务。**

> ⚠️ `GITHUB_DISPATCH_TOKEN` 是放在 Vercel 环境变量里的 GitHub 细粒度令牌。
> 如果你在 GitHub 上把它吊销或重新生成，记得同步更新：
> `npx vercel env rm GITHUB_DISPATCH_TOKEN production` 然后重新 add，再 `npx vercel --prod`。

---

## 为什么

GitHub 的 `on.schedule` 在这个仓库**实测从不触发**（`gh run list --event schedule` 一直为空，
public 仓库、默认分支 main、workflow state active，两个不同 workflow 都一样）。
所以归档现在靠：本机守夜人 + 任意 push + 手动。本机守夜人的缺点是**必须开机**。

Vercel 这一层把触发变成**事件驱动**：访客一提交，网页就去叫醒 GitHub Actions，
几十秒内完成归档。不再依赖任何定时器，也不再依赖这台电脑。

```
访客浏览器
   │  提交后 / 打开页面时发现有愿望没落库 → POST /api/poke（浏览器里没有任何令牌）
   ▼
Vercel Function  /api/poke          ← GitHub 令牌只存在 Vercel 的环境变量里
   │  POST /repos/imunco/sense-of-immersion/actions/workflows/collect.yml/dispatches
   ▼
GitHub Actions  collect-wishes      ← 真正的采集、审查、加密、提交
   ▼
data/wishes.jsonl 等 → GitHub Pages（约 1 分钟后可读）

另外 Vercel Cron 每天兜底跑一次 /api/cron，防止完全没人访问时长时间不归档。
```

## 需要两样东西

### 1. 一个 GitHub 细粒度令牌（PAT）

「浏览器不能拿令牌」是硬规矩，所以令牌放在 Vercel。它权限很小，只给一个仓库的一个能力：

1. 打开 https://github.com/settings/personal-access-tokens/new
2. **Token name**：`yixian-archive-dispatch`
3. **Expiration**：90 天或自定义（到期记得换）
4. **Repository access** → Only select repositories → 只勾 **imunco/sense-of-immersion**
5. **Permissions** → Repository permissions → 找到 **Actions** → 设为 **Read and write**
   （其余全部保持 No access，尤其不要给 Contents）
6. Generate token，复制 `github_pat_...`

### 2. Vercel 这边部署

```bash
# 在仓库根目录
npx vercel login                 # 浏览器里点一下授权
npx vercel link                  # 新建项目，比如叫 yixian-archive
npx vercel env add GITHUB_DISPATCH_TOKEN production     # 粘贴上面那个 PAT
npx vercel env add GITHUB_REPO production               # imunco/sense-of-immersion
npx vercel env add GITHUB_WORKFLOW production           # collect.yml
npx vercel --prod
```

### 3. 「被读」的唯一化（**线上已配好**）

`api/read.js` 靠一个密钥签发 cookie、算来源代号。这个密钥必须**同时**放在
Vercel 和 GitHub Secrets 里，两边不一样就等于没配：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
gh secret set WISH_READ_SECRET --body "<那个密钥>"
npx vercel env add WISH_READ_SECRET production          # 粘贴同一个值
npx vercel --prod
```

没配时函数只是原样转发、不签名，采集器不认签名过的读 —— 宁可少记，不可假记。
本地自测可以只设进程变量：`WISH_READ_SECRET=... node tests/readid.test.mjs`。

> ⚠️ **顺序不能反：先 Vercel，再 GitHub。** 反过来的那段窗口里，采集器要求签名而函数签不出来，
> 读会**完全不计数**（fail closed 的代价：宁可少记，不可假记）。

**当前线上状态：两边都配好了同一个值。** 当时不是"看文档说配了"就算数，而是两路独立验证：

1. 从公开的中转站把线上函数签发的那条读消息抓下来，用**本机那份密钥**验它的 HMAC → `verify=true`
   （证明 Vercel 存的值与本机文件逐字节相同）；
2. 故意发一条"签名合法、工作量证明无效"的读，触发线上采集任务，日志里出现 `被读证明无效: 1`
   —— 这条**只有签名先验过**才可能产生（证明 GitHub 的 Secret 与 Vercel 同值）。
   两边不一致时它只会落进 `被读未签名`。

### 3b. 带存储的限流（**线上已接**：Upstash for Redis）

无状态函数自己数不了数，所以"每 IP 几次"必须有外部存储。一条命令接上：

```bash
npx vercel integration add upstash/upstash-kv --plan free      # 会弹一次条款确认（5 分钟内点完）
```

接上后项目里自动多出 `KV_REST_API_URL`、`KV_REST_API_TOKEN`（另有 `KV_URL`/`REDIS_URL`），
`lib/kv.js` 读前两个，也认 `UPSTASH_REDIS_REST_*`。
当前资源名 `yixian-rate`，免费版，主区东京 `hnd1`。

生效后：`/api/poke` 每来源地址 5 分钟 6 次；`/api/read` 一小时 40 次。
**没配就放行并在响应里标明；KV 连不上也放行** —— 限流失败不该拦住正常用户。
写进 KV 的是「来源地址的当天代号」`HMAC(密钥, 地址 + 当天)`，**不是地址本身**，换日即失联。

验证：

```bash
node tests/kv-live.mjs     # 对着真的那台跑：1/2/3 计数、超限拦住、EXPIRE 真的设上 TTL、键里没有地址
curl -s https://yixian-archive.vercel.app/api/health    # hasKv 应为 true
```

部署完会得到一个地址，例如 `https://yixian-archive.vercel.app`。验证：

```bash
curl -s https://yixian-archive.vercel.app/api/health
# → {"ok":true,"hasToken":true,"hasKv":true,"readSigned":true,...}

curl -s -X POST https://yixian-archive.vercel.app/api/poke
# → {"ok":true,"message":"已叫醒采集任务"}
```

## 最后一步：把地址告诉网页

把 `https://<你的项目>.vercel.app/api/poke` 同时填进两个地方，然后 push：

- `data/config.json` 的 `pokeUrl`
- `assets/js/config.js` 里 `FALLBACK.pokeUrl`

填好之后：**任何人提交愿望，网页都会立刻叫醒归档**，本机守夜人就从"主力"降级成"额外的保险"，
可以随时用 `install-watchdog.ps1 -Remove` 卸掉。

## 升级选项

- 如果你有 **Vercel Pro**，把 `vercel.json` 里的 cron 从 `"0 4 * * *"` 改成 `"*/5 * * * *"`，
  定时触发就完全可靠了，连 poke 都只是锦上添花。
- 想更严一点：`ALLOWED_ORIGINS` 环境变量控制哪些来源可以调 `/api/poke`（默认只允许你的 Pages 域名和本地）。
- 想给 cron 加保护：设置 `CRON_SECRET`，Vercel 会自动带上 `Authorization: Bearer <CRON_SECRET>`。

## 安全说明

- 浏览器里**没有任何 GitHub 凭据**，它只知道一个公开的 `/api/poke` 地址。
- 这个 PAT 只有 `Actions: write`，不能读代码、不能改内容、不能碰其他仓库。
- 即使有人疯狂打 `/api/poke`，函数内部有 45 秒的最小间隔，Actions 那边还有 concurrency 串行化，
  最坏结果是多跑几次空采集（每次约 10 秒）。
---

# 附录：更换 GitHub PAT（详细步骤）

## 什么时候需要换

- 令牌被谁看到了（比如贴进过聊天、截图、日志）
- 快到期了（GitHub 会在到期前发邮件提醒）
- 权限需要调整

整套流程约 5 分钟，**期间归档不会中断**：新令牌验证通过后才会顶掉旧的。

## 第 1 步：在 GitHub 上生成新令牌

打开 https://github.com/settings/personal-access-tokens/new

| 字段 | 填什么 |
|---|---|
| **Token name** | `yixian-archive-dispatch-2026-09`（带上日期，方便以后认） |
| **Expiration** | 90 days（推荐）；也可以自定义，但别忘了续 |
| **Description** | 选填：`一线千愿归档触发器` |
| **Repository access** | 选 **Only select repositories** → 只勾 **imunco/sense-of-immersion** |
| **Permissions → Repository permissions** | 只动一项：**Actions → Read and write**。其余全部保持 **No access** |

> ⚠️ 千万不要给 **Contents**。采集器写仓库用的是 Actions 自带的 `GITHUB_TOKEN`，
> 这个 PAT 只负责「按一下按钮触发 workflow」，给多了纯属浪费风险。
>
> `Metadata: Read-only` 是 GitHub 强制附带的，不用管。

点 **Generate token**，立刻复制 `github_pat_...`（**只显示这一次**，关掉就再也看不到）。

## 第 2 步：先验证新令牌（不要急着换）

在仓库根目录的 PowerShell 里跑（把 `github_pat_新的` 换成你复制的）：

```powershell
$new = "github_pat_新的"
$h = @{
  Authorization = "Bearer $new"
  Accept = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent' = 'rotate-check'
}

# ① 读权限：应列出 collect-wishes 和 pages-build-deployment 两个 workflow
(Invoke-RestMethod -Uri 'https://api.github.com/repos/imunco/sense-of-immersion/actions/workflows' -Headers $h).workflows | Select-Object name, state

# ② 写权限：真的触发一次采集。没有报错就是 204 成功（会多跑一次无害的空采集）
Invoke-RestMethod -Method Post -Uri 'https://api.github.com/repos/imunco/sense-of-immersion/actions/workflows/collect.yml/dispatches' -Headers $h -Body '{"ref":"main"}' -ContentType 'application/json'
Write-Output "写权限 OK"

# ③ 确认这个令牌只能碰这一个仓库（对别的仓库应该是 404）
try { Invoke-RestMethod -Uri 'https://api.github.com/repos/imunco/laucher1' -Headers $h | Out-Null; Write-Output "⚠ 警告：这个令牌能访问别的仓库，权限给多了" }
catch { Write-Output "✓ 访问其他仓库被拒（符合最小权限）" }
```

② 报 `403 Resource not accessible by personal access token` 的话，
说明 **Actions** 权限没设成 **Read and write**，回第 1 步改。

## 第 3 步：把新令牌写进 Vercel

### 方式 A：网页（最省事，推荐）

1. 打开 https://vercel.com/xcdh520-githubs-projects/yixian-archive/settings/environment-variables
2. 找到 **GITHUB_DISPATCH_TOKEN** → 点右侧 `...` → **Edit**
3. 把 Value 换成新令牌 → **Save**
4. 回到 https://vercel.com/xcdh520-githubs-projects/yixian-archive/deployments
   → 最新那条右边 `...` → **Redeploy**（**必须重新部署，否则还在用旧值**）

### 方式 B：命令行

Vercel CLI 没有「修改」环境变量，只能删掉再加：

```bash
cd R:\desktop\sense_of_immersion

npx vercel login          # 没登录过才需要
npx vercel link           # 选已存在的项目 yixian-archive

# 三个 target 都要删（当初是按 production/preview/development 一起设的）
npx vercel env rm GITHUB_DISPATCH_TOKEN production
npx vercel env rm GITHUB_DISPATCH_TOKEN preview
npx vercel env rm GITHUB_DISPATCH_TOKEN development

# 重新添加，会提示粘贴值，粘贴新令牌后回车；三个 target 都做一遍
npx vercel env add GITHUB_DISPATCH_TOKEN production
npx vercel env add GITHUB_DISPATCH_TOKEN preview
npx vercel env add GITHUB_DISPATCH_TOKEN development

# 重新部署，让新变量生效
npx vercel --prod
```

## 第 4 步：验证换成功了

```bash
# 健康检查：hasToken 必须是 true
curl -s https://yixian-archive.vercel.app/api/health

# 等 45 秒（触发端点有 45 秒最小间隔，刚跑过会被跳过）
sleep 45

# 手动触发一次：应返回 {"ok":true,"message":"已叫醒采集任务"}
curl -s -X POST https://yixian-archive.vercel.app/api/poke

# 看有没有真的起一个 workflow_dispatch 运行
gh run list --repo imunco/sense-of-immersion --workflow collect-wishes --limit 3
```

最直观的验证：**打开许愿馆随便许一个愿，一分钟内它应该自己出现在蛛网上。**
如果一分钟没出现，说明令牌还是旧的/权限不对，回第 2 步。

## 第 5 步：吊销旧令牌

新令牌确认能用之后，回 https://github.com/settings/personal-access-tokens
找到旧的那条 → **Delete**。

删掉之后 Vercel 上的服务不受影响（它用的是新令牌）。

## 附：Vercel Token 怎么换

如果你也想换 Vercel 令牌（不是必须，它只在我部署时用过）：

1. https://vercel.com/account/tokens → **Create Token**，Scope 选你的账号，过期时间随意
2. 生成后复制，**替换你本地任何用到它的地方**
3. 回同一页面，把旧的 **Delete**

**换 Vercel 令牌不影响已部署的服务**，因为线上跑的是部署好的函数，不需要 CLI 令牌。

## 常见问题

**Q：换完之后网页提交愿望，归档慢了怎么办？**
先看 `curl -s https://yixian-archive.vercel.app/api/health` 里 `hasToken` 是不是 true。
是 true 还慢，就是 Vercel 那条 45 秒限流在起作用，等下一分钟就好。

**Q：旧的 PAT 删了，已经归档的数据会丢吗？**
不会。PAT 只负责「触发」，不碰数据。数据是 Actions 用自己内置的 `GITHUB_TOKEN` 提交的。

**Q：PAT 到期了会怎样？**
Vercel 的 poke 会返回 401，归档会退回到 GitHub 定时（很慢）和 push 触发。
所以到期前记得换——GitHub 会提前发邮件。
