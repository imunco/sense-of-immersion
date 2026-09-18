# 把归档触发搬到 Vercel

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

部署完会得到一个地址，例如 `https://yixian-archive.vercel.app`。验证：

```bash
curl -s https://yixian-archive.vercel.app/api/health
# → {"ok":true,"hasToken":true,...}

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
