# 有票为证 · 架构与数据流（ARCH）

> **版本对齐**：小程序 `8.0.5` ｜ **日期**：2026-09-17
> **本文件管什么**：这套小程序由哪几块组成、数据从哪来到哪去、改东西该动哪个文件。
> **不管什么**：要做什么（见 [PRD.md](./PRD.md)）、怎么改不能碰（见 [`youpiaoweizheng/CODEBUDDY.md`](../youpiaoweizheng/CODEBUDDY.md) 项目宪法）。
> **怎么用**：接手先看本文件的第 1、2 节；要动手改某条链路，直接跳到对应小节，路径都是现成的。

---

## 一、全局：三层 + 两个后端

```
页面层  pages/            18 个页面（4 个自定义 tab 页 + 14 个功能页）
          │  ↓ 票根数据只走下面这一层；页面另有 3 类云直连（上传照片 / 取临时链接 / 单次动作），见 SDD 第一节
数据层  utils/            数据（store）、双人（couple/duoData）、AI（ai）、主题（theme）、
          │               图形（icons/deco/mapArt）、支付（pay）、授权（auth）、埋点（track）…
          │  ↓ wx.cloud.callFunction
云函数  cloudfunctions/   只有两个函数，全部能力都塞在 action 里
          │   ├─ saveTicket      万能 action 路由（入库 / 鉴权 / 支付 / 双人 / 重绘 / 运维）
          │   └─ recognizeTicket OCR 识别 + 规则解析
          ↓
云数据  4 个集合 tickets / couples / prefs / config  ＋ 云存储（票根照片、海报、重绘图）
```

**为什么只有两个云函数**：miniprogram-ci 只能更新云函数、不能创建目录，所以新能力一律**加 action**，不新建函数（宪法第四节）。

**云/演示双模式**是贯穿全工程的地基：开关在 [utils/env.js](../youpiaoweizheng/utils/env.js)（`USE_CLOUD`、`CLOUD_ENV`）。关掉时全站走本地 storage + 演示数据，界面功能照常可用——**任何新功能都必须同时支持两种模式**。

---

## 二、页面清单（18 页，`app.json` 注册）

| 分组 | 页面 | 干什么 | 主要依赖的 utils |
|---|---|---|---|
| tab ★ | `pages/home` | 票根墙：搜索 / 分类 / 卡片网格 | store, theme, track, deco, icons |
| tab ★ | `pages/album` | 时光机：按年份的纵向时间轴 | store, mock, skeleton, theme, icons, deco, date |
| tab ★ | `pages/discover` | 回忆地图：水彩中国 + 真经纬度落点（可切微信原生地图）；8.1.0 起可就地演「一键成片」并存长图 | store, theme, icons, deco, mapArt, mapFilm, saveimg, share, track, canvas-deco |
| tab ★ | `pages/me` | 我的：统计卡 + 功能入口 | store, theme, env, pay, icons, deco |
| 录入 | `pages/scan` | 拍照 / 相册 → 识别 → 确认入库 | env, store, ai, theme, icons, deco, track, mock |
| 详情 | `pages/detail` | 票面信息、AI 时光手记、天气印记 | store, mock, ai, skeleton, theme, weather, date, track, ads, icons |
| 深加工 | `pages/art` | AI 艺术重绘（原票 ↔ 重绘对照） | store, theme, track, env, pay, ads, icons, deco |
| 深加工 | `pages/card` | 纪念卡片：五种卡面，存相册 / 分享 | store, date, ai, theme, couple, env, track, pay, icons, deco, canvas-deco |
| 回忆 | `pages/annual` | 年度报告（统计 + 精选 + AI 结语 + 竖版长图） | store, theme, pay, track, deco, icons, ai, poster |
| 双人 | `pages/duo` | 双人空间：邀请码绑定、共同票根 / 场次 / 城市 | store, couple, duoData, theme, skeleton, track, deco, icons |
| 双人 | `pages/bind` | 邀请中转页（分享卡片带 code 进入） | theme, couple, track |
| 双人 | `pages/timeline` / `pages/report` | 双人时间线（按月分组、同场标记）/ 我们的时光报告（分布、里程、一起场次） | duoData, couple, date, theme, skeleton（report 另有 geo, pay） |
| 设置 | `pages/setting` / `pages/theme` / `pages/protocol` | 设置（含勋章墙）/ 主题选择 / 协议 | store, couple, env, pay, badges, theme, deco |
| 拉新 | `pages/wall` | 同场票根墙：某一场上**别人自愿公开**的票根（全项目唯一陌生人可读的出口） | store, theme, track, share |
| 拉新 | `pages/legacy` | 老票根专场：请用户翻出抽屉里的老票来拍（**静态页**，分享落点） | theme, track, share, icons, deco |

> `tests/page_refs.test.js` 会拦「注册了但没人能进」的孤立页；下线页面时记得看它身上挂的勋章标记、埋点有没有别人依赖。

**底部导航**是自定义组件 [custom-tab-bar/](../youpiaoweizheng/custom-tab-bar/)：4 个 tab + 中央凸起相机按钮（跳 `pages/scan`）。它是独立渲染树，主题令牌要在组件自己的 wxss 里重声明一遍。

---

## 三、数据层：`utils/store.js`（读写票根的唯一入口）

导出 10 项：`USE_CLOUD`、`listTickets`、`getTicket`、`addTicket`、`setCaption`、`removeTicket`、`isMockTicket`、`getSameOptOut`、`setSameOptOut`、`listFlags`。

| 关注点 | 事实 |
|---|---|
| 双模式分支 | 每个方法内部按 `USE_CLOUD` 分叉：云模式调云函数 / 直查集合，演示模式读写本地 |
| 云读失败 | 不白屏，落本地兜底并置 `flags.netFallback`（页面据此出提示） |
| 分页 | `PAGE_SIZE = 20`（小程序端单次硬上限）、`LIST_MAX = 500`；`skip + limit` 分批拉，避免「只能看到 20 张」 |
| 触顶 | 由 `count()` 的真实总数比对得出 `flags.cap`，横幅文案随之下发 |
| 排序 | date + `_id` 稳定排序 |

**本地 storage key 全表**（换字段名等于丢用户数据，慎改）：

| key | 谁在用 | 存什么 |
|---|---|---|
| `sp_local_tickets` | store | 演示模式票根 |
| `sp_caption_overrides` | store | 演示票的 AI 文案覆盖 |
| `sp_deleted_ids` | store | 演示模式的删除名单 |
| `sp_same_optout` | store | 退出同场印记聚合 |
| `app_theme` / `sp_theme` | utils/theme | 主题（新 / 旧 key 兼容） |
| `sp_couple_cache` | utils/couple | 绑定关系缓存 |
| `sp_track_events` | utils/track | 埋点环形缓冲（500 条） |
| `sp_auth_time` | utils/auth | 会话时间戳（24h 新鲜度） |
| `sp_ref_from` / `sp_ref_code` / `sp_ref_wait` | utils/invite | 邀请有礼（7.3.0）：待绑定的邀请人短码 / 我自己的短码 / 已绑定等对方传首票（结算一次即清） |
| `sp_sub_state` | utils/subscribe | 订阅消息：哪天问过、被拒的时间戳（7.4.0；拒后静默 30 天） |
| `sp_badge_seen` | pages/me | 上次已上报的勋章 id 列表——`badge_unlock` 埋点据此去重（7.4.0） |
| `sp_guide_done` | pages/home | 新用户三步引导「只看一次」的已读标记（也进 setting 的清除清单） |
| `fav_ids`、`sp_cap_style`、`sp_share_count`、`sp_first_saved`、`sp_art_quota`、`sp_art_total`、`sp_invite_sent`、`sp_poster_ab` | 各页面 | 收藏 / 卡面风格 / 分享计数 / 首次入库 / 重绘额度 / 邀请标记 / 海报 A/B |
| `sp_map_visited` | pages/discover | 「足迹地图」勋章解锁依据（v7.0 由已下线的 pages/map 移交） |

---

## 四、云函数：两个入口，一堆 action

### 4.1 `saveTicket`（万能路由，[index.js](../youpiaoweizheng/cloudfunctions/saveTicket/index.js)）

| action | 作用 | 落库/落存储 |
|---|---|---|
| （无 action） | **票根入库主流程**：补 openid / 坐标 / 同场键 / 天气，过内容安全 | tickets |
| `checkText` | 文案内容安全检测（msgSecCheck） | 只读 |
| `setCaption` | 保存 AI 时光手记 | tickets |
| `backfillGeo` | 老票根坐标回填（场馆级优先，退城市中心） | tickets |
| `artRestyle` / `artQuery` | 启动 AI 重绘 / 轮询进度 | prefs(job)、云存储、tickets.artVersion |
| `bind` / `duoStats` / `eventStats` | 双人绑定（create/join/query/unbind）/ 双人统计 / 同场计数 | couples（写）、只读 |
| `wallJoin` / `wallList`（8.1.0） | 同场票根墙：本人把票放进/撤下（只能改自己的票，上墙先过安检）；按场次键拉公开票根（**全项目唯一陌生人可读的出口**，只回票名/场馆/日期/图，见 [SDD.md](./SDD.md) §4.2 与 §8） | tickets（写 wallPublic / wallAt）、只读 |
| `refCode` / `refBind` / `refReward` | 邀请有礼（7.3.0）：取我的短码 / 绑定邀请人 / 对方上传首票后结算发奖 | prefs |
| `dailySign` | 每日时光签：签到与查状态（判定与发奖全在服务端，端上只读） | prefs |
| `pointsGet` / `pointsEarn` / `shareOpen` / `pointsRedeem` | 积分：查余额（含对外挣分规则）/ 端上行为上报（白名单只有「生成卡片」）/ 分享被打开的归因 / 兑换 AI 重绘（100 分、一天 1 次、幂等） | prefs |
| `recallSave` | 订阅消息召回：授权成功后挂一条次日提醒（**真正发送在定时触发器里**，见下） | prefs |
| `authLogin` | code2Session 换会话 | prefs |
| `payCreate` / `payQuery` / `payConfirm` / `quotaGet` / `artRewardGrant` | 下单 / 查单对账 / 支付后发货 / 额度视图 / 激励视频奖励入账 | prefs（订单、额度） |
| `profileGet` / `profileSave` / `profileClear` | 署名资料（昵称走内容安全） | prefs |
| `wxacode` | 生成海报小程序码并缓存 | 云存储 + prefs |
| `goodsImgSetup` / `opsCleanup` / `opsAudit` / `opsRecall` | 运维：道具图上传 / 上线前清理 / 只读巡检 / 手动发一轮召回（需 opsToken，前端不调用） | 云存储、tickets、couples、prefs |
| `reorder` / `reorderGroups` / `getGroupOrder` | 排序（客户端已不再调用，**为线上旧版保留**） | tickets / prefs |

**定时触发器**是第三条入口：`saveTicket` 挂了一个每小时整点的 `recallTick`（7.4.0 订阅消息召回）。`miniprogram-ci` 的 `uploadFunction` 只传代码、不管触发器 —— 触发器没建**不报错也不留痕，只是永远不发**，所以 `scripts/ci/deploy-fns.js` 部署完会读各云函数 `config.json` 的 `triggers` 并调 `createTimeTrigger` 确保建成。

**微信支付回调**是另一条入口（非 action）：`xpay_*` 事件。安全约束——带 `OPENID` 的调用一律拒绝（微信服务端推送不带用户上下文），发货前必须回查微信侧真实订单。改动这条链路等于动钱，见宪法第四节。

### 4.2 `recognizeTicket`（OCR）

`index.js`（入口 + 双通道 OCR：百度 / 微信兜底）→ `parser.js`（规则解析成草稿）→ `cities.js`（城市字典）。

---

## 五、三条主链路

### 5.1 识别入库（核心闭环）

```
scan 拍照/选图 → 压缩 → wx.cloud.uploadFile（云存储 tickets/）
  → callFunction('recognizeTicket')：fileID 白名单校验 → 下载 → OCR → parser.parse → {draft, lines}
  → utils/ai.js parseDraftByAI(lines, draft)   端上大模型再解析一遍（失败退规则草稿）
  → 表单回填（mode='done'）→ 用户确认 → store.addTicket()
  → saveTicket 默认入库：补 openid / 坐标 / eventKey / 天气 → 内容安全 → tickets.add
```

**识别失败不白拍**：云函数返回 `{ok:false,msg}`，前端弹「没认出来」并进入**空表单手动补填**。

**坐标怎么来的**（地图上的落点源头）：

1. 先用城市静态字典配**城市中心**坐标（`geoSource:'city'`，查不到就保持 null，不猜）；
2. 若带场馆名，再调**腾讯地图 LBS**（`apis.map.qq.com` 场馆检索，Key 在 [geocode.js](../youpiaoweizheng/cloudfunctions/saveTicket/geocode.js)）做**场馆级精化**（`geoSource:'venue'`）；
3. 天气（Open-Meteo）用这个坐标，随票根一起存档。

> 回忆地图页默认画的是**自绘水彩中国**（`utils/mapArt.js` 做经纬度→舞台投影）；页内可切到**微信原生 `<map>`**（7.1.0 起），两种看法吃的是同一份经纬度（`mapArt.markersOf` 与 `toStage` 同源），点图钉与点气泡共用同一个城市面板。腾讯地图接口在这条链路里负责「场馆名 → 精确经纬度」。

### 5.2 AI 文案与重绘

- **文本**：`utils/ai.js` 端上直调 `wx.cloud.extend.AI`（`hunyuan-v3` 主、`cloudbase` 兜底），免密钥、不走云函数；
- **约束**：文案**入库前必须过 `checkText`**（违规码 87014）、对外展示必须带「文案由 AI 生成」角标（宪法第四节）；
- **图像**：重绘走 `artRestyle` action + 额度体系（`utils/pay.js`、激励视频 `utils/ads.js`）。

### 5.3 支付与额度

`utils/pay.js` 封装「下单 → 拉起微信支付 → 主动查单 → 轮询额度」；服务端 `pay.js` + `prefs` 里的订单与额度视图负责**对账与掉单自愈**。金额、订单、发货相关的改动属禁区，需人工确认。

---

## 六、视觉系统（四条硬规矩）

| 规矩 | 原因 |
|---|---|
| **图标只能走 `utils/icons.js`** | 微信 WXML 不渲染内联 `<svg>`（子元素全丢，图标整组消失）；唯一可行方式是拼 data-uri SVG 塞进 `<image src>` |
| **图形一律交 `utils/svg.js` 出 base64 data-uri** | 百分号编码（`data:image/svg+xml,` + `encodeURIComponent`）**开发者工具能看、真机整片不显示** —— 7.4.1 事故。`svg.js` 自己实现 base64 编码（真机不支持 `btoa`） |
| **图形里不写中文** | `<image>` 里的 SVG 是独立文档，中文在 iOS/Android 字形回落不一致；邮戳、弧形城市名一律「图形走 SVG + 文字用真文本叠上去」 |
| **颜色必须在 JS 里拼成实色** | SVG 不认 CSS 变量与 `currentColor`，`var()` 一律失效 |

- **主题**：六套（`paper` 默认 / `glass` / `collage` / `film` 暗色 / `literary` / `minimal`）。令牌在 `app.wxss` 的 `.theme-*` 段，JS 侧元数据与 `apply/getTheme/setTheme` 在 [utils/theme.js](../youpiaoweizheng/utils/theme.js)；页面根节点挂 `theme-{{theme}}`，`onShow` 调 `themeUtil.apply(this)`；tab 栏组件单独重声明令牌。
- **共用画笔与装饰**：`utils/deco.js`（花枝 / 波浪 / 邮戳 / 齿边 / 和纸胶带）、`utils/canvas-deco.js`（Canvas 画笔，card / annual / 地图成片共用）、`utils/mapArt.js`（水彩中国）、`pages/discover/film.js` 与 `pages/annual/poster.js`（**长图画笔的样板**：纯 Canvas 2D、不碰 wx、不 require wx.*，可在 Node 里真跑）。**新页面先翻这几个文件，不要各写一份。**
- **存相册**：一律走 `utils/saveimg.js`（`exportCanvas` + `save` + 授权引导）。card / art / annual 里还各留着一份 8.1.0 之前的等价实现（**记名技术债**，下次动那几页时收口），但**新代码不许再抄第五份**。

---

## 七、工程与验证

| 类别 | 在哪 | 说明 |
|---|---|---|
| 回归测试 | `tests/*.test.js`（38 套 / 923 条） | `npm test`；可带过滤词只跑一套（`npm test detail`）。改哪屏跑哪套 |
| 单屏预览 | `scripts/dev/preview-*.js` | 本机把卡面 / 年报 / 装饰图形渲成图或 HTML 先看一眼 |
| 云函数部署 | `scripts/ci/deploy-fns.js` | `npm run deploy:fn`（CloudBase CLI 非交互） |
| 上传提审 | `scripts/ci/` | `npm run upload` / `audit` / `audit:status` / `release`；`pipeline:dev` 串起「体积粗检 → 部署 → 上传」 |
| 版本号 | `.env` 的 `UPLOAD_VERSION`（`package.json` 的 `version` 只是兜底） | `scripts/ci/config.js` 读的是 `process.env.UPLOAD_VERSION \|\| 包版本` —— **只改 `package.json` 会在上传时被同名版本拒收**，两处一起升 |
| 上传忽略 | `scripts/ci/config.js` 的 `uploadIgnores` | node_modules / .git / scripts / .env / **/*.md 等不进包 |
| 密钥 | `.env`（照抄 `.env.ci.example`） | AppSecret、上传私钥、腾讯云密钥**不入仓库**；根 `.gitignore` 已挡 `.env`、`*.key`、`secret/` |

---

## 八、改动须知（改之前先看这份）

1. **新能力加 action，不新建云函数目录**（CI 只能更新已有函数）。
2. **数据只从 `utils/store.js` 进出**，页面里不直接 `wx.cloud`。
3. **双模式都要能跑**：云模式 + 演示模式（`USE_CLOUD=false`）。
4. **不写假数据 / 假按钮**：演示内容必须标注「演示」（宪法第四节）。
5. **改完要跑**：`node --check` 过语法 → `npm test` 全绿 → 同步 `CHANGELOG.md` 一条 + 版本号递增（`.env` 的 `UPLOAD_VERSION` 与 `package.json` 的 `version` **两处一起**）→ **`docs/` 各页头的「版本对齐」跟着换**（这一条以前漏了，五份文档的页头因此停在 7.1.0 很久）。
6. **禁区**（AppID / 云环境 / 支付订单逻辑 / 云数据库删改 / 密钥入库 / 关隐私检查）——详见 [CODEBUDDY.md](../youpiaoweizheng/CODEBUDDY.md) 第四节，动之前必须人工确认。

---

*本文档由代码现状盘点的结果整理，作为工程基线维护；与代码不符时以代码为准并回改本文件。*
