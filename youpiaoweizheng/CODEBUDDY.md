# CODEBUDDY.md —— 有票为证 项目宪法（AI 编码必须遵守）

> 本文件供 CodeBuddy / WorkBuddy / 豆包等所有 AI 编码工具读取。每次改动前先读本文件，严格遵守；与口头指令冲突时，以本文件约束为底线并主动提示。

## 一、项目定位
- 产品名：**有票为证**（锁定，禁止改名；历史名拾忆博物馆/回忆检票口/拾光票根均已废弃）
- 形态：微信原生小程序（不引入 uni-app/Taro/React/Vue 等框架）+ 微信云开发
- AppID：wx42ef98dfb4ecab23；云环境：cloud1-d5gpnyzjw64a60ac7

## 二、技术栈与目录（不得擅自变更）
- 页面在 `pages/`，组件在 `components/`，自定义底栏 `custom-tab-bar/`，工具 `utils/`，云函数 `cloudfunctions/`（现有 recognizeTicket、saveTicket）
- 样式用 rpx；全局色值走 CSS 变量（多主题系统，见下），**禁止在页面里写死主题色**
- 不新增重型 npm 依赖；确需引入先说明理由并等待确认

## 三、多主题系统（核心约束）
- 共 8 套主题：bento(默认)/chinese/doodle/memphis/dark/glass/magazine/toy
- 机制：`app.wxss` 预置 `.theme-xxx` 类的 CSS 变量；页面根节点挂 `theme-{{themeName}}`；`onShow` 用 `utils/theme.js` 同步；Storage key=`app_theme`
- 任何新页面/新组件必须只用变量（如 `var(--card-bg)`、`var(--text-main)`、`var(--brand)`），保证 8 套主题一键切换不破图
- tabBar 必须用 custom-tab-bar，禁止退回原生静态 tabBar

## 四、禁区（未经人工确认不得改动）
- 不得修改 AppID、云环境ID、支付/订单/会员相关逻辑
- 不得删除、清空云数据库集合或数据；不得改云函数权限为放开所有用户
- 不得改动 `youpiaoweizheng/youpiaoweizheng/` 嵌套历史目录（待人工确认后删除，AI 不要碰）
- 不得执行 `git push`、`git reset --hard`、`rm -rf`、格式化全盘类高危命令
- 不得把 AppSecret、上传密钥、腾讯云密钥写进任何前端代码或提交进仓库
- 不得关闭隐私检查 `__usePrivacyCheck__`、不得绕过登录/付费校验

## 五、编码规范
- 遵循 Conventional Commits：`feat/fix/style/refactor/chore/docs(模块): 中文描述`
- 一次只做一个逻辑变更；新增逻辑必须处理空态、加载态、失败态（网络错误/权限拒绝/云函数异常）
- 列表用 key、图片加 binderror 兜底、异步加 loading 与防重复点击
- 改完先自检：JS 用 `node --check` 过语法；不破坏现有 5 个核心页面（wall/duo/me/scan/detail）
- 主包体积不超过 2MB，大图片走云存储或分包

## 六、交付要求
- 不允许只给建议不动手；在项目内直接完成可运行改动
- 完成后输出：改了哪些文件、为什么、如何自测、有无风险/待确认项
- 不自动 commit/push；改动留在工作区，由编排方（豆包）review diff 后决定合入
