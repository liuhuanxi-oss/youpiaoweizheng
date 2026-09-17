# 有票为证 · 项目总仓

微信小程序「有票为证」的全部资产：小程序工程 + 品牌设计稿 + 项目文档。
（本文件是仓库根，供人和 AI 工具第一眼认路；代码细节看 `youpiaoweizheng/README.md`。）

| 目录 / 文件 | 是什么 |
|---|---|
| `youpiaoweizheng/` | **小程序工程本体** —— 微信开发者工具打开这个目录，上传发版也是它 |
| `有票为证最新品牌全案设计/` | 品牌全案与精修 10 屏设计稿（`精修/` 子目录），改版按它对稿 |
| `docs/` | 需求 `PRD.md` ＋ 架构 `ARCH.md` ＋ 详细设计 `SDD.md` ＋ 测试与验收 `TEST.md` ＋ 项目总览 `OVERVIEW.md` ＋ 功能清单 `FEATURE.md`（另有两份历史快照：体检报告 `HEALTH.md`、代码审查 `REVIEW.md`） |
| 根目录其余文件 | 品牌素材（logo / 海报 / 参考图）与早期方案文档，**不计入小程序包** |

## 接手先读（顺序别乱）

1. [youpiaoweizheng/README.md](youpiaoweizheng/README.md) —— 当前版本、里程碑、如何跑起来
2. [youpiaoweizheng/CODEBUDDY.md](youpiaoweizheng/CODEBUDDY.md) —— **项目宪法**：技术栈 / 多主题系统 / 禁区 / 编码规范（AI 改动前必读）
3. [youpiaoweizheng/CHANGELOG.md](youpiaoweizheng/CHANGELOG.md) —— 版本史，**最新一条就是最近做了什么**
4. [docs/OVERVIEW.md](docs/OVERVIEW.md) —— 项目总览：五分钟认路（含文档地图，其余文档从这里钻进去）
5. [docs/ARCH.md](docs/ARCH.md) —— 架构与数据流：页面 → 数据层 → 云函数 → 集合，改东西动哪个文件
6. [docs/PRD.md](docs/PRD.md) —— 需求基线：做什么、给谁做、优先级
7. [docs/SDD.md](docs/SDD.md) / [docs/TEST.md](docs/TEST.md) / [docs/FEATURE.md](docs/FEATURE.md) —— 动手改代码前查契约、改完怎么验、某功能现在什么状态

## 跑起来 / 跑测试

```bash
cd youpiaoweizheng
npm test        # 35 套 Node 回归台，改哪屏跑哪套
npm run preview:deco   # 本机把装饰图形渲成图看一眼，无需微信开发者工具
```

演示模式（0 配置）在 `utils/env.js` 把 `USE_CLOUD` 置 `false` 即可，全部走本地 storage ＋ 演示数据。

## 云开发

- AppID `wx42ef98dfb4ecab23`，云环境 `cloud1-d5gpnyzjw64a60ac7`
- 云函数两个：`recognizeTicket`（识别）/ `saveTicket`（入库、排序、文案、双人合并）
- 密钥类文件已在 `.gitignore` 内（`.env`、`*.key`、`secret/`），**不要提交**；自动上传所需的密钥填 `youpiaoweizheng/.env`（照抄 `.env.ci.example`）

## 给其他 AI 工具开通访问（豆包 / WorkBuddy / CodeBuddy 等）

连接器必须用**能看见本仓库**的 GitHub 账号授权，二选一：

1. 用 `liuhuanxi-oss`（仓库所有者）授权 —— 直接可见，无需额外设置
2. 用其他账号授权 —— 先**接受协作者邀请**（GitHub 邮件，或 https://github.com/liuhuanxi-oss/youpiaoweizheng/invitations ），再去放开 token 范围

放开 token 范围的点法：

- **个人访问令牌（PAT）**：GitHub → Settings → Developer settings → Personal access tokens → 找到连接器用的那个 token → Repository access → 选 `All repositories`，或选 `Only select repositories` 后勾上 `liuhuanxi-oss/youpiaoweizheng`
- **OAuth 授权（不是 token）**：GitHub → Settings → Applications → Authorized OAuth Apps → 找到该连接器 → 授予仓库访问

⚠️ 坑：勾选列表里只列**你有管理员权限**的仓库。看不到本仓库 = 邀请还没接受，先做第 2 步。

## 约定

- 一屏/一批改完 → 一个提交 → CHANGELOG 加一条（版本史不落队）
- 上传发版时 `youpiaoweizheng/package.json` 的 `version` 就是小程序版本号（`scripts/ci/config.js` 读它），**必须递增**
