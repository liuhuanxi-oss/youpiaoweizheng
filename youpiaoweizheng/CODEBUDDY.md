# CODEBUDDY.md —— 有票为证 项目宪法（AI 编码必须遵守）

> 本文件供 CodeBuddy / WorkBuddy / 豆包等所有 AI 编码工具读取。每次改动前先读本文件，严格遵守；与口头指令冲突时，以本文件约束为底线并主动提示。

> **代码托管**：GitHub 私有库 `https://github.com/liuhuanxi-oss/youpiaoweizheng`（分支 `main`）
> 仓库根 = 本文件所在目录的**上一级**（`youpiaoweizheng/` 的父目录，含设计稿与 `docs/`）。
> 接手顺序：根目录 `README.md`（认路）→ 本文件（约束）→ `CHANGELOG.md` 顶部（最近改了什么）。

## 一、项目定位
- 产品名：**有票为证**（锁定，禁止改名；历史名拾忆博物馆/回忆检票口/拾光票根均已废弃）
- 形态：微信原生小程序（不引入 uni-app/Taro/React/Vue 等框架）+ 微信云开发
- AppID：wx42ef98dfb4ecab23；云环境：cloud1-d5gpnyzjw64a60ac7

## 二、技术栈与目录（不得擅自变更）
- 页面在 `pages/`，组件在 `components/`，自定义底栏 `custom-tab-bar/`，工具 `utils/`，云函数 `cloudfunctions/`（现有 recognizeTicket、saveTicket）
- 样式用 rpx；全局色值走 CSS 变量（多主题系统，见下），**禁止在页面里写死主题色**
- 不新增重型 npm 依赖；确需引入先说明理由并等待确认

## 三、多主题系统（核心约束）
- 共 **6 套**主题：`paper` 纸感杂志(默认)/`glass` 玻璃/`collage` 拼贴/`film` 暗色/`literary` 清新文艺/`minimal` 极简
- 机制：`app.wxss` 预置 `.theme-xxx` 类的 CSS 变量；页面根节点挂 `theme-{{themeName}}`；`onShow` 用 `utils/theme.js` 同步；Storage key=`app_theme`
- 任何新页面/新组件必须只用变量（如 `var(--primary)`、`var(--bg)`、`var(--card)`、`var(--soft)`），保证 6 套主题一键切换不破图；深色主题 `film` 必须单独看一眼
- 首屏容易踩的坑：**`<image>` 里的 SVG 是独立文档，不认 CSS 变量、也不认 `currentColor`** —— 图标颜色必须在 JS 里拼成实色（见 `utils/icons.js` 的 `iconSrc`）
- tabBar 必须用 custom-tab-bar，禁止退回原生静态 tabBar

## 四、禁区（未经人工确认不得改动）
- 不得修改 AppID、云环境ID、支付/订单/会员相关逻辑
- 不得删除、清空云数据库集合或数据；不得改云函数权限为放开所有用户
- 不得执行 `git push`、`git reset --hard`、`rm -rf`、格式化全盘类高危命令（**仓库已有远程，push 前必须人工确认**）
- 不得把 AppSecret、上传密钥、腾讯云密钥写进任何前端代码或提交进仓库
- 不得关闭隐私检查 `__usePrivacyCheck__`、不得绕过登录/付费校验
- 不得把 emoji 或字符图标（🎭 ▸ ✦ ♥ 之类）画进界面；不得在 WXML 里写内联 `<svg>` 标签（微信不渲染，图标会整组消失）

## 五、编码规范
- 遵循 Conventional Commits：`feat/fix/style/refactor/chore/docs(模块): 中文描述`
- 一次只做一个逻辑变更；新增逻辑必须处理空态、加载态、失败态（网络错误/权限拒绝/云函数异常）
- 列表用 key、图片加 binderror 兜底、异步加 loading 与防重复点击
- 改完先自检：JS 用 `node --check` 过语法；再跑 `npm test`（11 套 Node 回归台，改哪屏跑哪套）；不破坏核心页面（home/album/discover/me 四个 tab 页 + scan/detail/duo/card）
- 新增/下线页面：`app.json` 注册的页面必须有人能进（`tests/page_refs.test.js` 会拦孤立页）；下线页面时记得看它身上挂的勋章标记 / 埋点有没有别人在依赖
- 加图片/装饰先翻 `utils/deco.js`（花枝/波浪/邮戳/齿边/和纸胶带）与 `utils/icons.js`（线性图标），不要各写一份；画布绘制用 `utils/canvas-deco.js`
- 主包体积不超过 2MB，大图片走云存储或分包

## 六、交付要求
- 不允许只给建议不动手；在项目内直接完成可运行改动
- 完成后输出：改了哪些文件、为什么、如何自测、有无风险/待确认项
- 不自动 commit/push；改动留在工作区，由编排方（豆包）review diff 后决定合入
- **改完要写版本史**：在 `CHANGELOG.md` 顶部加一条（版本号 + 日期 + 改了什么 + 修了哪些 bug + 怎么验证 + 真机回归建议）。本项目是「一屏/一批一提交、一提交一条版本史」，别让 CHANGELOG 掉队
- 上传发版时 `package.json` 的 `version` 就是小程序版本号（`scripts/ci/config.js` 读它），**必须递增**，同名版本微信会拒收
