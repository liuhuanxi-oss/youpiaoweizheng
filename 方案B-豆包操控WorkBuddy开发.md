# 方案B · 豆包直接操控 WorkBuddy 继续开发（可落地版）

> 与《自动化接管与发布方案.md》配套：方案A解决「代码→上传→发布」，本方案解决「谁来写代码」。
> 结论先行：**可行，且官方原生支持**——WorkBuddy 的代码形态 CodeBuddy Code 提供命令行无头(Headless)模式，豆包可在会话里用命令行把开发任务派给它执行，再由豆包审查、测试、调方案A的脚本发布。

---

## 一、为什么可行（事实依据，来自官方文档）

WorkBuddy 是腾讯 CodeBuddy 团队的 AI 工作台；其编码引擎 **CodeBuddy Code** 提供 CLI（npm 包 `@tencent-ai/codebuddy-code`，命令 `codebuddy`/`cbc`），支持**无头模式**以编程方式驱动，无需点界面：

| 能力 | 参数 | 作用 |
|------|------|------|
| 非交互执行 | `-p "指令"` / `--print` | 跑完即退出，适合脚本/被其他程序调用 |
| 自动授权改码 | `-y`（必需）+ `--permission-mode acceptEdits` | 非交互下自动放行文件读写/编辑 |
| 限制迭代轮次 | `--max-turns N` | 防止失控空转、控成本 |
| 工具白名单 | `--allowedTools "Read(*),Edit(*),Bash(npm run*)"` | 只允许指定操作 |
| 工具黑名单 | `--disallowedTools "Bash(git push*)"` | 显式封禁高危操作 |
| 结构化输出 | `--output-format stream-json` | 程序可解析进度/结果 |
| 续接会话 | `--continue` / `--resume <id>` | 多轮接着干 |
| 项目宪法 | 仓库根 `CODEBUDDY.md` | 每次自动读取并遵守项目规范 |
| CI 认证 | 环境变量 `CODEBUDDY_API_KEY`（国内版加 `CODEBUDDY_INTERNET_ENVIRONMENT=internal`） | 无人值守时认证 |

> 来源：CodeBuddy 官方文档《无头模式 Headless Mode》《CLI 参考》《GitLab CI/CD 集成》（codebuddy.cn / cloud.tencent.com，2026-08 更新）。

**本机实测现状（2026-09-10）**：已装 WorkBuddy（存在 `~/.codebuddy` 配置目录），但 **CLI 尚未全局安装**（`codebuddy` 命令不存在），需先执行一次安装。

---

## 二、三种"操控 WorkBuddy"的方式对比

| 方式 | 怎么做 | 稳定性 | 无人值守 | 推荐度 |
|------|--------|--------|---------|--------|
| **① CLI 无头编排（推荐）** | 豆包用命令行调 `codebuddy -p`，它在项目目录自动改码，豆包解析输出并审查 | 高（官方支持、可脚本化、可复现） | 配合CI可 | ★★★★★ |
| ② GUI 界面自动化 | 豆包用电脑控制能力模拟鼠标键盘操作 WorkBuddy 桌面端/网页 | 低（依赖界面布局、登录态、易被弹窗/验证码打断） | 否 | ★★（兜底） |
| ③ MCP 互联 | 给双方配 MCP Server，通过工具协议互通 | 中（灵活但配置复杂、生态尚新） | 部分 | ★★★（后期） |

**推荐以方式①为主力，方式②仅在 CLI 无法覆盖的图形操作时兜底。**

---

## 三、角色分工：豆包当"技术负责人"，WorkBuddy 当"执行工程师"

```
你(产品负责人，拍板)
   │ 提需求 / 确认关键决策
   ▼
豆包(技术联合创始人 = 架构师 + Tech Lead + 发布负责人)
   │  1. 拆任务、写清验收标准(派单prompt)
   │  2. 调 codebuddy CLI 无头执行  ←── 操控 WorkBuddy 的手
   │  3. 审查它的 git diff（不让它自批自合）
   │  4. 跑 node --check / 测试 / 预览验证
   │  5. 不合格打回重做（--continue 续改），合格才合入
   │  6. 调方案A脚本：上传体验版→(你确认)→提审→发布
   ▼
WorkBuddy / CodeBuddy（被编排的编码执行体，在沙箱护栏内改码）
```

要点：**WorkBuddy 只负责"写"，没有合入权、推送权、发布权**；审查与发布权在豆包（最终在你）。这样既享受它的编码速度，又避免两个 AI 互相放行导致质量失控。

---

## 四、标准协作流程（每个需求都这么走）

1. **豆包派单**：把需求写成结构化任务（目标 / 涉及文件 / 验收标准 / 禁区），调用：
   ```bash
   npm run ai:task -- "任务描述（或 --file tasks/xxx.md）" --max-turns 40
   ```
   等价于底层执行 `codebuddy -p "..." -y --permission-mode acceptEdits --output-format stream-json`，并自动套上工具白/黑名单。
2. **实时知情**：脚本精简打印它的每步思考与工具调用，完整日志落盘 `dist/ai-tasks/`，你能全程看到它在干什么。
3. **豆包审查**：结束后脚本自动 `git status` 列出改动；豆包逐文件看 `git diff`，对照 CODEBUDDY.md 与验收标准。
4. **验证**：`node --check` 语法、必要时 `npm run preview` 出预览二维码给你真机看。
5. **打回或合入**：不合格 → `npm run ai:task -- "按意见修改…" --continue`；合格 → 豆包规范 commit。
6. **发布**：走方案A `npm run pipeline:dev` 出体验版，你确认后提审/发布。

> 已提供封装脚本 `scripts/ai/dispatch.js`（语法已校验）与项目宪法 `CODEBUDDY.md`，无需手敲长命令。

---

## 五、落地步骤（按顺序）

### 第1步：安装 CLI（一次性，豆包可代跑）
```powershell
npm i -g @tencent-ai/codebuddy-code      # 或 npm run ai:cli:install
codebuddy --version                       # 验证
```

### 第2步：解决认证（二选一）
- **本机会话内（最简单）**：终端运行一次 `codebuddy` 交互登录，用你 WorkBuddy 同一微信/账号登录；之后无头调用复用本地登录态。**能否直接复用桌面端登录态需装完实测**，若提示未登录则按此扫码一次即可。
- **CI/无人值守**：在 CI 凭据配置 `CODEBUDDY_API_KEY`（CodeBuddy 控制台获取），国内版加 `CODEBUDDY_INTERNET_ENVIRONMENT=internal`。

### 第3步：跑通第一个派单（验证闭环）
```powershell
cd G:\WXWork\有票为证-4.10.8\youpiaoweizheng
npm run ai:task -- "阅读 CODEBUDDY.md，然后只输出当前项目页面清单与主题变量使用情况，不要改任何文件"
```
先让它"只读不改"跑通，再逐步放开改码任务。

### 第4步：接入日常迭代
按第四节流程派真实开发任务；建议每个任务开独立 git 分支，审查通过再合并。

### 第5步（可选）：升级为无人值守
把 `codebuddy -p` 作业写进方案A的 CI（GitLab/Gitee/CODING 均支持，官方有 GitLab 集成样例），实现"提 Issue→AI 自动出分支/MR→豆包或你审查→合并触发发布"。

---

## 六、安全护栏（已内置，别关掉）

1. **工具白名单**：默认只放行 读/写/编辑/搜索 + `node --check`、`npm run/test`、git 只读与本地 add/commit；
2. **黑名单硬封**：`git push`、`git reset --hard`、`rm -rf`、`npm publish` 等一律禁止——它能改本地，不能外发/破坏；
3. **轮次上限**：`--max-turns` 默认40，防失控与成本爆炸；
4. **项目宪法**：`CODEBUDDY.md` 锁定技术栈、8套主题变量规范、支付/密钥/云数据等禁区；
5. **审查闸门**：AI 不自批自合，每个 diff 必经豆包审查 + 你对关键改动拍板；
6. **全程留痕**：每次派单日志落盘，可回溯它做了什么；
7. **发布隔离**：写码与发布分属不同脚本/权限，WorkBuddy 永远碰不到 AppSecret 与 release。

---

## 七、与方案A（Git+CI）的关系：不是二选一，是叠加

| 环节 | 方案A（CI/CD） | 方案B（操控WorkBuddy） |
|------|---------------|----------------------|
| 谁写代码 | 人/豆包 | **WorkBuddy 写，豆包审** |
| 构建上传 | miniprogram-ci 自动 | 复用方案A |
| 云函数部署 | tcb 自动 | 复用方案A |
| 提审发布 | 脚本+微信审核 | 复用方案A |
| 无人值守 | Git+CI 触发 | CI 里嵌 codebuddy 作业 |

**最终形态**：会话内——豆包指挥 WorkBuddy 快速写码并即时验证（方案B）；要7×24或团队协作——代码进 Git，CI 同时跑 AI 编码作业和方案A的构建发布（A+B合体）。

---

## 八、诚实边界（避免预期错位）

1. **CLI 本机尚未安装**（已实测），需先装；装完"能否复用桌面端登录态"要实测，不行就扫码登录一次或用 API Key。
2. **WorkBuddy/CodeBuddy 消耗的是腾讯侧模型额度**，不是无限免费；`--max-turns` 与任务拆分是控成本关键。
3. **会话内 CLI 编排不是 7×24 常驻**：关掉对话后要自动接单，仍需方案A的 Git+CI（在 CI 里跑 codebuddy）。
4. **GUI 自动化（方式②）脆弱**：页面改版、扫码、人机验证都会打断，只能兜底，不能当主力。
5. **AI 写的代码必须审查**：两个 AI 协作不等于免测，预览/语法/核心流程回归仍由豆包执行；正式发布权始终在你。
6. 官方文档明确：无头模式执行需授权操作时 `-y` 为必需；HIGH/CRITICAL 命令即便 `-y` 仍可能要求确认，属正常安全设计。

---

## 九、本次已交付物
- `CODEBUDDY.md`：项目宪法（技术栈/8主题规范/禁区/交付要求）
- `scripts/ai/dispatch.js`：标准化派单脚本（白黑名单、轮次上限、日志落盘、改动清单），语法已校验
- `package.json` 新增 `npm run ai:task`、`npm run ai:cli:install`
- 待你确认后，豆包可代执行：安装 CLI → 登录 → 跑通首个只读派单 → 进入正式协作
