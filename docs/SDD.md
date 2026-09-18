# 有票为证 · 系统设计说明（SDD）

> **版本对齐**：小程序 `8.0.5` ｜ **日期**：2026-09-17
> **本文件管什么**：每个模块、每个接口、每张表**具体长什么样**——函数契约、字段类型、状态流转、错误码、降级口径、改动波及面。
> **不管什么**：整体分层与三条主链路见 [ARCH.md](./ARCH.md)；要做什么见 [PRD.md](./PRD.md)；怎么测见 [TEST.md](./TEST.md)；不能碰什么见 [`CODEBUDDY.md`](../youpiaoweizheng/CODEBUDDY.md)。
> **怎么用**：动手改某个文件前，先在本文件搜到它、看清契约再改；契约改了，回来改本文件。

---

## 一、分层与调用规则

```
页面 pages/*  ──→  utils/*（数据层与工具层）  ──→  wx.cloud.callFunction  ──→  cloudfunctions/*
                    └─ 例外：utils/ai.js 端上直调 wx.cloud.extend.AI，不走云函数
```

**规则**：票根数据的读写只走 `utils/store.js`，页面不自己拼云查询。

**例外（现状，写在这里免得下次当成 bug）**：6 个页面确实直接写了 `wx.cloud.*`，共三类用途，每处都有 `USE_CLOUD` 判断或 fileID 形态做前提：

| 用途 | 在哪 | 说明 |
|---|---|---|
| 上传照片 | `pages/scan`、`pages/me` | `uploadFile` → 票根图 `tickets/{时间戳}-{6 位随机}.jpg`、头像 `avatar/a{时间戳}{随机}.{ext}`，再把 fileID 交给云函数 |
| 取临时链接 | `pages/annual`、`pages/art`、`pages/card` | 只对 `cloud:` 开头的 fileID 调 `getTempFileURL`（链接 24 小时有效） |
| 直调云函数 | `pages/scan`（recognizeTicket）/ `pages/art`（artRestyle、artQuery）/ `pages/card`、`pages/sign`（wxacode）/ `pages/detail`（checkText、eventStats） | 单次动作，不经过数据层 |

碰云的 utils 共 10 个：`store`（票根，含删票时删云存储照片）、`couple` 与 `duoData`（双人）、`pay` 与 `auth`（支付、登录会话）、`ai`（端上大模型，走 `wx.cloud.extend.AI`，不调云函数）、`invite`（邀请归因）、`points`（积分）、`sign`（时光签）、`subscribe`（订阅授权回报）。

---

## 二、数据模型

### 2.1 `tickets`（票根）

客户端拿到的票根主键统一是 **`id`** —— `store.js` 把云库的 `_id` 归一成 `id`；**页面里写 `_id` 就是 bug**（v7.0 首页收藏心就是这么不亮的）。

| 字段 | 类型 | 谁写 | 说明 |
|---|---|---|---|
| `title` | string | 客户端 → 服务端兜底 | 缺失补「未命名票根」 |
| `date` | `YYYY-MM-DD` | 客户端 | **必填**，缺失服务端直接拒收 |
| `time` | string | 客户端 | 可空 |
| `type` | `show` / `movie` / `traffic` | 客户端 → 服务端校验 | 非法值回落 `show` |
| `venue` / `city` / `seat` / `source` | string | 客户端 | 以票面 OCR 转录为主，入库前与 `title`/`note` 拼成一段**过内容安全**（8.0.4 起） |
| `price` | number \| null | 客户端 | 服务端夹到 `[0, 1e7]`，非有限值落 `null` |
| `rating` | number \| null | 客户端 | 星级评分，服务端夹到 `[0,5]`；**当前端上无读写方**，白名单里预留 |
| `province` | —— | 不落库 | 识别草稿里有它，端上表单不带、服务端白名单也不放行 → 入库即丢弃（省份信息在 `city` 里） |
| `geo` | `{lat,lng}` \| null | 客户端或服务端补 | 服务端只收 `{lat,lng}` 两个字并校验范围，见 §6.2 坐标三级来源 |
| `geoSource` | `'city'` \| `'venue'` | 服务端 | 坐标来源标记；客户端自带坐标时不写 |
| `img` | fileID | 客户端 | 云存储 `tickets/` 路径；服务端只校**形态**（`^cloud://{env}.{storage}/`，正则不核对 env 是不是本环境——跨环境读由下载接口自己拦），形态不符则整字段丢弃 |
| `eventKey` | md5 串 | 服务端 | 同场聚合键 `evt_` + md5(去空白、小写后的 `venue\|date`) 前 16 位；用户同场 opt-out 时为空串（偏好本身不入库） |
| `weather` | object \| null | 服务端 | Open-Meteo 历史天气；失败即 null，不阻塞入库 |
| `aiCaption` | string | 服务端（`setCaption`） | 过内容安全后才写 |
| `artVersion` | `{fileID, createdAt}` | 服务端（`artRestyle`） | 最近一次重绘图版，用于「原票 ↔ 重绘」对照（记录失败不影响交付） |
| `note` | string | 客户端（**当前无写入方**） | 自由文本，截 500 字，**入库前必检**（与 `title` 等拼成一段送检）；scan 表单与 `store.addTicket` 都不带它，白名单与安检为将来入口保留（演示数据里有值，仅供展示样例） |
| `sortAt` | number | 服务端（`reorder`） | 组内自定义序；客户端拖拽入口已随 wall 页下线，动作**为线上旧版保留** |
| `_openid` | string | 服务端 | 归属，一律服务端写，不采信客户端 |
| `createdAt` | number | 服务端 | 毫秒时间戳 |

排序口径：有 `sortAt` 的按其降序浮前，其余按票面日期倒序（`store.js` 的 `byOrder` / `byDate`）。

### 2.2 `couples`（双人绑定）

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | string | 4 位邀请码，字符集 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`（去掉 0O1IL 等易混字符），撞车重试最多 3 次 |
| `members` | string[] | 成员 openid；`waiting` 时只有 1 个 |
| `names` | `{openid: 称呼}` | 各自填写，截断 12 字 |
| `status` | `waiting` → `bound` | 无第三种状态 |
| `createdAt` / `boundAt` | number | 创建 / 绑定时间 |

> **现状口径**：`create` 复用同一码直到绑定成功（已 `bound` 则直接回绑定视图）；**加入时**若码的 `createdAt` 超过 7 天，服务端删掉该 waiting 文档并回「邀请码已过期，让 TA 重新生成」——过期是**惰性判定**，没有定时清理。绑定成功后自己名下还在等人的那条码会被作废（一个人只站在一份关系里）。

### 2.3 `prefs`（账本集合：一个 `type` 一类文档）

全项目引用最多的集合，新人最容易漏看。16 种文档：

| `type` | 存什么 | 关键字段 |
|---|---|---|
| `art_quota` | 重绘额度（每人一份，服务端权威；并发首调会去重，只留 `_id` 最小那份） | `ym`（当月）、`freeUsed`、`paid`、`bonus`（激励视频 / 连签 / 邀请 / 兑换送的那部分，只加不减；退款回退上限 = `paid - bonus`） |
| `pay_order` | 订单与对账记录 | `outTradeNo`、`productId`、`priceFen`、`quantity`、`status`、`deliveredAt`、`refundApplied`（退款回退额度的一次性闸门）、`lastCheckAt`（对账限频） |
| `art_job` | 重绘任务 | `ticketId`、`status`（`reserving` → `running` → `done`/`failed`）、`pool`（扣的是哪池，回收时按它退回）、`fileID`、`msg` |
| `auth_session` | 登录会话（支付签名需要 session_key） | `sessionKey`、`updatedAt`（7 天新鲜度） |
| `user_profile` | 署名资料 | `nickname`、`avatar` |
| `ad_reward` | 激励视频当日计数 | `ymd`、`count`（每日上限 3） |
| `groupOrder` | 分组排序序 | `labels` |
| `wxacode_poster` | 海报小程序码缓存 | `fileID`（全局一份，不带 `_openid`） |
| `wxacode_ref` | 带邀请短码的码缓存（按码各一份） | `code`、`fileID` |
| `wxacode_sign` | 线下立牌码缓存（全局一份，8.1.0） | `fileID` |
| `ref_code` | 我的邀请短码（每人一条，幂等） | `code`、`createdAt` |
| `ref_link` | 邀请归因（谁邀请了谁，`_openid` = 被邀请人，每人一条） | `code`、`inviter`、`status`（`pending` → `settled`；绑定时已有票根则直接 `stale` 只归因不发奖）、`hadTickets`、`settledAt` |
| `daily_sign` | 每日时光签（7.4.0 A 段） | `ymd`、`streak`、`best`、`total` —— 判定与发奖在服务端，按北京时间换天 |
| `points` | 积分账本（7.4.0 B 段） | `balance`、`lifetime`（累计获得，勋章看它）、`earn{ymd,n}`（日上限计数器）、`log[]`（最近 50 条流水）、`redeemYmd` / `redeemReq` / `redeemAt`（兑换的每日名额与幂等键） |
| `recall` | 订阅消息召回（7.4.0 C2） | `tmplId`、`streak`、`sendAt`、`status`（`pending`/`sent`/`dead`）、`tries`、`err` |
| `anniv` | 周年提醒（8.1.2，**与 `recall` 同一趟定时器发**） | `tmplId`、`ymd`（周年那天，北京时间）、`years`、`title`、`ticketId`（落页用，正则清洗过）、`sendAt`（那天 09:00）、`status`、`tries`、`err`。与 `recall` 的两处不同：**只在那一天发**（过了就 `dead` + `err:'expired:<ymd>'`，不补发）｜一人一条（给别的票排提醒即覆盖） |
| `ocr_day` | 识别配额（P2-11，由 `recognizeTicket` 写） | `_id` 固定为 `ocr_{openid}_{ymd}`（并发首调靠主键分胜负）、`ymd`、`count`（每人每天 30 次） |

### 2.4 `config`（支付凭证）

单文档 `_id: 'pay_secret'`：`{ offerId, appKey, appKeySandbox, appSecret, env }`。
`env: 0` 现网 / `1` 沙箱，**两套 AppKey 是不同的值**。集合权限必须设「仅管理端可读写」。
**不在自动建表范围**，缺失时支付与登录返回 `NO_CONFIG`，需去控制台手工创建。

### 2.5 云存储

- 票根原图路径 `tickets/{Date.now()}-{6 位随机}.jpg`；头像 `avatar/a{Date.now()}{4 位随机}.{ext}`；AI 重绘产物 `art/art-{时间戳}-{随机}.png`；海报小程序码 `wxacode/poster-{码或 all}-{时间戳}.png`；线下立牌码 `wxacode/sign-{时间戳}.png`（8.1.0）；
- **删票根会连照片一起删**（`utils/store.js` 的 `removeTicket` → `deleteCloudFile`，7.4.3 补 `img`、8.0.4 补 `artVersion.fileID`）：先 `get()` 拿两个 fileID 再删记录，最后逐个 `wx.cloud.deleteFile`。删除失败只落 `console.warn` 留孤儿图，不让收尾动作把「删票成功」变成报错（已知债，见 `docs/HEALTH.md` §5.3）。

---

## 三、客户端模块契约（`utils/`，下表 31 个模块）

按「被页面直接 require 的次数」排序，括号内为引用页数（**8.1.0 实测**，只数 `pages/`、`components/` 与 `custom-tab-bar/` 不计入；`(0)` 表示只被 util 内部 require、页面不直接用）：

| 模块 | 主要导出 | 关键口径 | 依赖 |
|---|---|---|---|
| `theme.js` (18) | `getTheme`、`setTheme`、`getThemeMeta`、`isDark`、`THEME_KEY`、`THEMES`、`DEFAULT_THEME`、`THEME_META`、`TYPE_SCALE`、`DECO_LABELS`（另出兼容轨 `current`、`set`、`apply`、`META`、`KEY`） | 六主题 paper/glass/collage/film/literary/minimal，默认 `paper`；key `app_theme`，旧 `sp_theme` 兼容保留（深色 Canvas 页仍在读） | — |
| `haptics.js` (15) | `tap()`、`confirm()`、`warn()` | 触觉只按语义留三档（轻 / 中 / 重），不再逐处写力度；接口缺失或报错一律吞掉，不打断主流程 | — |
| `icons.js` (15) | `iconSrc(name, color, opacity, width, solid)`、`ICON_PATH`（43 个键）、`_uriCache` | 线性图标转 data-uri SVG；未知键回落 `ticket`；默认描边 1.6、默认色 `#6B5B50`、viewBox 24×24；按全部入参记忆化 | svg |
| `track.js` (15) | `track(event, data, opts)`、`dump()` | 双通道：`wx.reportEvent` + 本地环形缓冲（key `sp_track_events`，500 条上限，参数截 60 字）；`opts.local === false` 只走官方通道（`page_view` 这类高频事件） | — |
| `store.js` (12) | `USE_CLOUD`、`listTickets`、`getTicket`、`addTicket`、`setCaption`、`removeTicket`、`isMockTicket`、`getSameOptOut`、`setSameOptOut`、`listFlags` | `PAGE_SIZE=20`、`LIST_MAX=500`；云失败落本地并置 `flags.netFallback`，触顶置 `flags.truncated`（`flags.cap` 是上限值 500）；成功结果 30s TTL 缓存，三个写入口一律置脏 | env、mock |
| `deco.js` (11) | `decoSrc(name, theme)`、`avatarSrc`、`previewSrc`、`postmarkParts`、`artFrame`、`flowerStamp`、`pinkedPanel` | 25 款手绘装饰；viewBox 默认 `0 0 64 44`，9 款另有专属框 | — |
| `share.js` (12) | `message(key, d, extra)`、`timeline(key, d)`、`sp()`、`withSlogan`、`SCENES`、`COVERS`、`SLOGAN` | 五场景 ticket / annual / duo / legacy / map，各带标题、落地页与 5:4 封面（内容收在中间安全区，好友卡片与朋友圈 1:1 裁切共用）；每条 path / query 经 `invite.withRef` 带短码；`sp()` 认朋友圈单页模式（scene 1154）；`duo` 的标题分三档（`d.total` → 「一起收藏了 N 张」、只有 `d.mine` → 「我已经存了 N 张」、都没有 → 通用那句），**`mine` 必须是真数**：云兜底（`flags.netFallback`）那批是演示票根，传上去就是编数字 | invite |
| `couple.js` (6) | `queryCouple`、`cachedCouple`、`createCode(name)`、`joinByCode(code, name)`、`unbind` | 走 `bind` action 的 mode=query/create/join/unbind；缓存 key `sp_couple_cache` | env |
| `skeleton.js` (6) | `start(page)`、`end(page)` | 300ms 内完成不闪骨架 | — |
| `pay.js` (5) | `PRODUCT_ID`、`PACK_PRICE_LABEL`、`humanizePayErr`、`getQuota`、`buyArtPack(onStatus)`、`getProfile`、`saveProfile`、`clearProfile`、`quotaLabel` | 商品 `ART_PACK_10`（¥6 / 10 幅）；`payConfirm` 即时到账，失败落轮询 15 次 × 1.5s（首轮 600ms）；免费额度 3 幅/月 | env、auth、track |
| `ai.js` (4) | `parseDraftByAI(lines, fallback)`、`generateCaption(t, style, anniv)`、`CAPTION_STYLES`、`generateAnnual(stat)`、`annualFallback` | 端上直调；模型链 hunyuan-v3 → cloudbase 兜底；文案硬截 40 字；结语每行上限 18 字（超长整段退兜底，不截半句）；`MAX_LINES=40` | wx.cloud.extend.AI |
| `date.js` (4) | `groupLabel`、`weekday`、`todayMD`、`todaySign`、`annivYears` | 时光签 24 句（每月两句、上/下半月轮换）；`todayMD` / `todaySign` 固定 UTC+8；anniv 要求严格 `YYYY-MM-DD`（10 字符）；`stubDate` 已于 7.4.3 删除 | — |
| `enter.js` (4) | `replay(page)` | 切 tab 回来重播入场动效：先摘 `.fade-up`、隔 20ms 再挂回（首次进场跳过） | — |
| `canvas-deco.js` (4) | `wrapText`、`roundRect`、`pinkedRect`、`watercolorBlob`、`drawStar4`、`drawHeart`、`drawTape`、`drawSprig`、`safeDpr`、`MAX_CANVAS_SIDE` | 纯函数、不依赖 wx；card 与 annual 共用；画布倍率先取整再回夹，最长边 4096 | — |
| `env.js` (4) | `USE_CLOUD`、`CLOUD_ENV` | 全工程唯一要手改的配置 | — |
| `duoData.js` (3) | `loadMerged(c)`、`eventKeyOf(t)`、`togetherKeys`、`togetherCities`、`recentRows` | 双人三页同源；场次键优先级 `eventKey` → `venue\|date` → `title\|date` | mock、env、date |
| `mock.js` (3) | `TYPE_TEXT`、`tickets`（8 张）、`timeMachine`、`badges`（16 枚）、`MOCK_IDS` | 演示数据即数据模型样例 | — |
| `ads.js` (2) | `REWARDED_ID`、`BANNER_DETAIL_ID`、`hasRewarded`、`hasBanner`、`showRewarded` | 广告位 ID 为空时 UI 整体隐藏；`showRewarded` 不 throw | — |
| `invite.js` (2) | `capture`、`boot`、`bind`、`settle`、`myCode`、`ensureCode`、`withRef`、`LS_FROM` / `LS_MINE` / `LS_WAIT` | 归因三件事：捞码（`?ref=` 与码图 scene 的 `r=`）、上报绑定、催结算；短码 6 位、与双人邀请码同一张去混淆字符表；全链路静默，失败不影响任何界面 | env、points、track |
| `points.js` (2) | `status`、`earnCard`、`shareOpened`、`artHint`、`redeem`、`makeReq`、`rulesText`、`POINTS_PER_ART` | 端上只上报两件事（生成卡片、分享被打开）；`POINTS_PER_ART=100` 只用于「说」，账在服务端；挣分规则展示只认服务端下发的 key，拿不到就返回空串（不编默认规则） | env |
| `sign.js` (2) | `status`、`checkIn`、`bannerText`、`rewardText` | 端上只读：判定与发奖都在服务端；`checkIn` 第一句是**同步发起**订阅授权；基础分数字只认服务端随状态下发的 `base`；演示模式 `status` 返回 null，整块不渲染 | env、subscribe |
| `badges.js` (1) | `computeBadges(ts, coupleInfo, shareCount, mapVisited, inviteSent, server)` | 16 枚勋章阈值见 §6.5；后三枚读服务端（`server = {streak, lifetime}`），取不到时只说门槛、不编进度 | mock |
| `geo.js` (1) | `haversine(a,b)`、`totalKmOf(sortedTickets)` | 地球半径 6371 km | — |
| `mapArt.js` (1) | `landSrc`、`stageLand`、`routeSrc`、`stampSrc`、`toStage(lng,lat)`、`layoutBubbles`、`markersOf`、`bubbleColor`、`bubbleWidth`、`ART_W` / `ART_H` / `STAGE_W` / `STAGE_H` | 水彩中国投影：经度 73.4–135.1、纬度 17.8–53.6，标准纬线 35°；`ART 640×620` / `STAGE 666×645`。`landSrc` 出的是 **SVG 字符串**（给 `<image>` 用），`stageLand` 出的是**同一份几何的舞台坐标 + 配好色的纯数据**（给 Canvas 用）：国界、色块、两座岛、纸浆色与内沿。**不能喂给 `drawImage` 的是 SVG 字符串，不是这份陆地** | — |
| `memory.js` (1) | `onThisDay(ts, now)`、`label(hit)`、`row(ts, now)`、`bjDay(now)` | 那年今天：同月同日 + 更早年份，多条取最近那一年；固定 UTC+8；没命中返回 null（不编回忆） | — |
| `legacy.js` (1) | `row(ts, flags, now)`、`YEARS=5`、`bjYear(now)` | 老票根专场入口那一行该不该显示：云兜底（`flags.netFallback`）不显示、一张票都没有不显示、已有五年前的票不显示；年份口径固定 UTC+8 | — |
| `saveimg.js` (1) | `exportCanvas(canvas)`、`save(filePath)`、`guideAuth()` | 相册授权的**公共实现**（8.1.0 起新代码一律走这里，不许再抄一份）：被拒 → 弹「去设置」并 `openSetting`；用户主动取消 → 静默；真失败 → 给人话。失败对象带 `shown` 标记，调用方据此决定要不要再弹自己的 toast（不叠两个提示） | — |
| `mapFilm.js` (1) | `canPlay(cities, flags)`、`frames(cities)`、`span(fs)`、`sheet(rows)`、`yearOf(date)`、`MIN_STOPS` / `FRAME_MS` / `MAX_ROWS` / `SHEET_W` / `MAP_W` / `MAP_H` | 一键成片的**唯一编排**：站点顺序按首次到访升序、同日以城市名为第二把钥匙（否则两次播放顺序会飘）、无日期排最后且不编年份；不足两站或云兜底（`flags.netFallback`）不给播；长图版面纯算高度（上游按 12 城封顶，12 城 750×1928，dpr 2 = 3856 不越 iOS 单边 4096；`MAX_ROWS=20` 是保险丝，真到那一步宁可图软也不崩）。`pages/discover/film.js` 是配套画笔，与 `pages/annual/poster.js` 同一写法（纯 Canvas、不碰 wx） | mapArt |
| `svg.js` (0) | `toDataUri(svg)`、`b64(str)` | 图形工厂唯一的出口；**必须 base64** —— 百分号编码在开发者工具里正常、真机上整片不显示 | — |
| `weather.js` (1) | `weatherText(w)`、`weatherHint(w)` | WMO 码表 28 项；体感分界 5 / 14 / 30 ℃；`w` 为空一律返回空串（不造假） | — |
| `subscribe.js` (经 sign / detail) | `TMPL_ID`、`available`、`askIfDue`、`afterSign` + **8.1.2 的 `ANNIV_TMPL`、`annivAvailable`、`annivAskable`、`annivSaved`、`askAnniv`、`afterAnniv`** | 一次性订阅：授权→次日一条，没有「开关」；`TMPL_ID` 空着时一次都不请求、不留假入口（**8.1.1 已回填** `LoBUuHkTvYuHw1Q2Nt-MlqKLwwXQgNLg33LA62jxYB8`）；`askIfDue` 必须在点击回调里同步发起；被拒后 30 天静默（环境类失败不进静默期）。**服务端**发消息的字段名（`recall.js` 的 `dataOf`）必须与后台模板逐字一致 —— `phrase1`（上限 5 个汉字）/ `number2`（只吃数字字符串），对不上 `send` 回 47003 而端上毫无提示。**8.1.2 起两个模板各自一份状态**（`sp_sub_state` / `sp_sub_anniv`，互不连坐）；`askAnniv()` 返回空 = 连弹窗都没拉起，调用方必须把入口一起收起 | env |
| `anniv.js` (2) | `next(dateStr, now)`、`cnDay(ymd)`、`parse`、`WINDOW_DAYS`（30） | 纯函数，**整套周年规则的唯一出处**：下一个周年日落在 1–30 天内才返回（今天正是周年**不算** —— 归详情页 4.15.0 彩蛋；今年的票不算）；跨年、`2-29` 平年落 `2-28`、脏日期一律 null（不替用户编一天）；口径固定北京时间（源码里不许出现 `getDate()` / `getMonth()`） | — |
| `auth.js` (经 pay) | `ensureSession(force)`、`isFresh`、`LS_AUTH_TIME`、`FRESH_MS` | key `sp_auth_time`；24h 新鲜度；模块内并发去重；`wx.login` 成功后必须立刻 `authLogin` 覆盖服务端，两步不拆 | env |

### 页面 → 数据层的最小约定

- 读列表：`store.listTickets()`（已分页、已排序、已归一 `id`）
- 读单张：`store.getTicket(id)`（支持分享落地进来的 id）
- 新增：`store.addTicket(payload, fileID)`（云模式走 `saveTicket` 默认入库；演示模式写本地）
- 删除：`store.removeTicket(id)`（演示票进本地隐藏名单 `sp_deleted_ids`）
- **不要**在页面里直接 `db.collection(...)`。

---

## 四、云函数接口契约

统一约定：成功 `{ ok: true, ...payload }`，失败 `{ ok: false, msg }`；微信支付推送分支按微信协议返回 `{ ErrCode, ErrMsg }`。**所有 `_openid` 由服务端从上下文取，客户端传什么都不采信。**

### 4.1 `saveTicket` 的入口分发顺序

```
0) event.Type === 'Timer'          → 定时触发器：订阅消息召回（7.4.0 C2）。**必须排在入库之前**——
                                     掉进主流程会真去写 tickets（每天早上一张空票根，且不报错）；
                                     带 OPENID 的调用一律拒（小程序端可伪造 Type:Timer）
1) event.Event 以 xpay_ 开头        → 支付推送分支（见 4.3）
2) event.action === 'xxx'          → 36 个 action 分支
3) 其余                            → 票根入库主流程
```

> **新能力一律加 action，不新建云函数目录**（miniprogram-ci 只能更新已有函数，创建不了）。

### 4.2 action 契约表

| action | 入参 | 出参 / 副作用 |
|---|---|---|
| `checkText` | `content`（截 2500 字） | `{ok, result:'pass'\|'risky'\|'error', msg}`；只读 |
| `setCaption` | `id`, `caption`（截 500 字） | 写 `tickets.aiCaption`；先过 `secCheck` |
| `reorder` | `orders[{id, sortAt}]`（截 200 条） | 组内重排，写 `sortAt`；**为线上旧版保留** |
| `reorderGroups` | `labels[]` | 写 `prefs.groupOrder`；同上 |
| `getGroupOrder` | — | 读 `prefs.groupOrder` |
| `wxacode` | `ref`（我的邀请短码，可空）、`kind`（`'sign'` = 线下立牌码，可空） | 生成小程序码 → 云存储 + 缓存（无 `ref` 存 `prefs.wxacode_poster` 全局一份；带 `ref` 存 `wxacode_ref` 按码一份，scene = `b=poster&r={ref}` 供落地页归因）。**`kind='sign'`**（8.1.0）走立牌码：scene = `b=sign`、缓存 `prefs.wxacode_sign` 全局一份、**落地页 `pages/scan/scan` 写死在云函数里** —— 码的 `page` 一旦由客户端决定，谁都能拿它生成一张跳到任意页面的码 |
| `backfillGeo` | — | 老票根坐标回填（场馆级优先，退城市中心），批量写 `tickets` |
| `artRestyle` | `ticketId` | 建 `art_job`（先 `reserving` 占位，CAS 抢占转 `running`）→ 出图 → `tickets.artVersion`；额度不足返回不可用；同票已有 `running` 不重复发起，僵尸 job 由下一次调用回收（见 §5.2） |
| `artQuery` | `ticketId` | `{ok, status:'none'\|'running'\|'done'\|'failed', fileID?, msg?}` |
| `authLogin` | `code`（wx.login） | code2Session → 写 `prefs.auth_session`（含 sessionKey） |
| `payCreate` | `productId` | 建 `prefs.pay_order`（`created`，`buyQuantity` 服务端写死 1）→ 返回签名数据 |
| `payQuery` | `outTradeNo` | **主动查单**：向微信 `/xpay/query_order` 复核；未支付超 15 分钟 → `expired` |
| `payConfirm` | `outTradeNo` | 客户端确认后对账发货；`delivered` 幂等、`refunded` 拒发 |
| `quotaGet` | — | `{freeLeft, paid, left, freePerMonth}` 视图 |
| `artRewardGrant` | `check`（true = 只看不动，返回 `left`） | 激励视频奖励入账：并入 `paid` 池并同步记 `bonus`（奖励不是付费资产，退款不退它），同时 +3 分（`video`）；每日上限 3（`prefs.ad_reward`，北京时间口径） |
| `profileGet` / `profileSave` / `profileClear` | `nickname`（截 24 字）/ `avatar` | 读写 `prefs.user_profile`；昵称过内容安全 |
| `bind` | `mode: query\|create\|join\|unbind`，`name`（截 12 字），`code` | 双人绑定；`create` 复用未绑定的旧码 |
| `duoStats` | `full`（bool） | 双人统计（合并票数 / 城市 / 一起场次） |
| `eventStats` | `eventKey` | 同场收藏人数（匿名聚合；opt-out 用户不入列） |
| `wallJoin`（8.1.0） | `id`, `on`（bool） | 加入 / 撤下同场票根墙：归属（`_id` + `_openid`）写进 `where`，改不到别人的票；`on=true` 时票必须有 `eventKey` 且**重新过一遍 `secGate`**（入库那次安检可能很久以前），`on=false` 不过安检（撤下必须永远能成功）。写 `tickets.wallPublic` / `wallAt` |
| `wallList`（8.1.0） | `eventKey` | 某场次的自愿公开票根。**不要求登录**（分享出去的人没登录也要看得到）。`field()` 只取四列 + **出口逐字段重建**，只回 `title / venue / date / img`；**没有 `_id`、`_openid`、座位、票价、坐标、备注**。`img` 非本环境云存储 fileID 一律回空串；单面墙 `WALL_MAX = 50` |
| `refCode` | — | 我的邀请短码（每人一条，幂等）；新码 6 位、与双人邀请码同表（去 `0O1IL`） |
| `refBind` | `code`（大写去杂截 8 位，<4 位拒） | 记 `prefs.ref_link`（被邀请人唯一，重复绑返回 `dup`）；绑定时已有票根 → `stale`，只归因不发奖 |
| `refReward` | — | 结算邀请奖励：被邀请人已有 ≥1 张票根 → 双方各 +1 幅图版与 +50 分；条件更新抢结算权，可反复催 |
| `dailySign` | `check`（true = 只看不动） | 签到 / 查状态；发分（基础 5，连签 3 天 +10、7 天 +1 幅、14 天 +50）、连签判定、`base` 分数随视图下发；规则展示只给 `sign`/`upload`/`card` 三条 |
| `pointsGet` | — | `{balance, lifetime, cost, rules}`；`cost = POINTS_PER_ART = 100` |
| `pointsEarn` | `reason` | 端上上报得分；白名单只有 `card`（生成卡片），其余行为服务端自己记账 |
| `shareOpen` | `code` | 分享被打开归因：按码找到分享人并给**他**记 `share`（+5，日上限 3）；自己点自己的不加 |
| `pointsRedeem` | `req`（幂等号，截 40 位） | 100 分兑 1 次重绘；日上限 1；扣分与占名额同一条条件更新；发额度失败连分带名额退回（`NOBAL`/`LIMIT`/`GRANT`） |
| `recallSave` | `tmplId`, `streak`（截断夹紧） | 写 `prefs.recall`（一人一条，`status='pending'`、`sendAt`=次日 09:00 北京） |
| `annivSave`（8.1.2） | `tmplId`, `ymd`, `years`, `id`, `title` | 写 `prefs.anniv`（一人一条）。**日期要过校验**：必须是真实存在的日子、且落在未来 1–60 天内（端上窗口是 30 天，这里放宽一倍容时钟偏差），越界一律拒；票 id 要过正则清洗（落页用）；票名过 `clip20`（`thing` 类型上限 20 字） |
| `goodsImgSetup` / `opsCleanup` / `opsAudit` / `opsRecall` | `opsToken`（= AppKey 校验，四个入口共用 `checkOpsToken`），`imgBase64` / `dryRun` | 运维专用：道具图上传 / 上线前清理 / 只读巡检 / 手动发一轮召回（`dryRun:true` 只列名单不发） |

### 4.3 支付推送分支（微信服务端 → 云函数）

事件：`xpay_goods_deliver_notify`（发货）、`xpay_refund_notify`（退款）、`xpay_subscribe_ios_refund_query_notify`（iOS 退款查询）。

**三道闸（P0-3 资金敞口修复后固化）**：

1. **入口门禁**：推送事件若带 `getWXContext().OPENID`，一律拒绝——微信服务端推送不带用户上下文，带就是客户端伪造；
2. **发货前复核**：必须 `pay.queryOrderOnWx` 回查微信侧真实订单，查单不可用 / 未支付 / 金额不符一律不发货，并落审计记录；
3. **数量恒为 1**：`Quantity` 不采信，服务端 `MAX_ORDER_QTY = 1`。

幂等：已 `delivered` 重复推送返回 `ok(dup)`；用户 openid 取 `event.OpenId`（取错字段会把额度发错人）。

### 4.4 `pay.js`（服务端支付模块）内部契约

| 函数 | 作用 |
|---|---|
| `loadPayConfig(db)` | 读 `config.pay_secret`；不完整返回 null |
| `pickAppKey(cfg, env)` | `env=1` 优先 `appKeySandbox` |
| `getStableToken` / `queryOrderOnWx` / `code2Session` | HTTPS 直连微信（各自 5s 超时护栏） |
| `loadQuota` / `consumeQuota` / `refundQuota(db, openid, pool)` / `quotaView` | 额度四件套，见 §5.3；**返还优先按扣费时记下的 `pool` 精确退**（`free` 退带 `gte(1)` 条件防下探负数），老 job 没有 `pool` 字段才走反推兜底——不需要数据迁移 |
| `humanizePayErr(errno, errMsg)` | 错误码 → 人话（-15001 ~ -15017，前端 `utils/pay.js` 同源） |

### 4.5 `recognizeTicket`

- 入参 `{ fileID }`；返回 `{ ok, draft, lines }` 或 `{ ok:false, msg }`；
- 三道门（按顺序）：**fileID 格式白名单**（必须匹配 `^cloud://{env}.{storage}/`；只校形态、不核对 env，跨环境读由下载接口拦；云函数是管理员权限，这一步防的是伪造 fileID 探测）→ **调用者闸门**（`getWXContext().OPENID` 为空一律拒，控制台 / HTTP 直调不认）→ **每人每天 30 次**（`OCR_DAILY_LIMIT`，写 `prefs.ocr_day`，`_id = ocr_{openid}_{ymd}`；正常用户一天用不到 5 次，30 是留给「反复拍不清楚」的余量）；
- 链路：下载 → OCR 双通道（百度 → 微信 `openapi.ocr.printedText` 兜底）→ `parser.js` 规则解析成草稿；
- 后续：端上 `ai.parseDraftByAI(lines, draft)` 再解析一遍，失败回落规则草稿；
- 百度通道密钥留空则整体跳过该通道，链路不断。

---

## 五、状态机

### 5.1 支付订单（`prefs.pay_order.status`）

```
created ──发货成功──→ delivered（终态）
   │   ├─ 微信侧已退款/用户退款 ──→ refunded（终态）
   │   ├─ 未支付超 15 分钟 ─────→ expired（终态，不动额度）
   │   ├─ 回调金额与订单不符 ────→ price_mismatch（终态，不发货）
   │   ├─ 道具附着信息不符 ──────→ attach_mismatch（终态，不发货）
   │   ├─ 道具不在 PRODUCTS 里 ──→ unknown_product（终态，不发货）
   │   ├─ 微信查单不可用 ────────→ verify_unavailable（终态，不发货）
   │   ├─ 微信查单请求失败 ──────→ verify_failed（终态，不发货）
   │   ├─ 查单确认未支付 ────────→ verify_unpaid（终态，不发货）
   │   └─ 收到退款但查无此单 ────→ refund_unknown_order（审计留痕）
```

`unknown_product` / `verify_*` 由 `auditPayOrder` 落：已有订单就地改状态，没有则新建一条；
**已 `delivered` / `refunded` 的单绝不覆盖**——审计不能把发货结果改回去。代码里还认一个
`refund_pending`（回退额度分支的历史兼容状态，按已发货处理），当前没有任何写入方。

只有 `delivered` 的订单才回退额度，且回退带两道闸：`refundApplied` 标记抢占（并发推送只退一次）、
上限 = `paid - bonus`（奖励次数不是付费资产，不跟着退）。`created` / 各种 mismatch 单从未发过货。

### 5.2 重绘任务（`prefs.art_job.status`）

```
（无）──artRestyle──→ reserving ──CAS 抢占──→ running ──成功──→ done（带 fileID，写 tickets.artVersion）
                                                ├──失败──→ failed（带 msg，按 pool 返还额度）
                                                └──running 且 3 分钟没动静──→ failed（僵尸回收，返还额度）
```

- 同一 `ticketId` 已有 `running` 任务时**不重复发起**，返回 `{queued:true, jobId}` 让前端转轮询；客户端 `artQuery` 还可能拿到 `none`（没有任务）；
- **原子抢占**：先 `add` 一条 `reserving` 占位再 CAS 转 `running`——旧实现「查 running → 扣额度 → 建 job」的 TOCTOU 会让并发双击各扣一次额度、各起一个生图任务（真实成本），抢不到的一方删掉占位、返回已有 job，额度不够时也要把占位删掉（不留幽灵 running）；
- **僵尸回收（P1-11）**：生图在云函数里同步跑，执行被杀时 `done` / `failed` / 退额度一步都不会发生，job 永远停在 `running`——这张票就再也不接受新的重绘。判据是 `running` 且 `updatedAt` 早于 3 分钟（真在跑的活超不过云函数 60s 上限）；回收走条件更新抢占，**只退一次**，且扣费时记下 `pool` 按池精确退；恢复由下一次调用触发（`artRestyle` / `artQuery` 都会先收僵尸），不是定时器；
- **迟到的成功不算数**：回写 `done` 带 `status:'running'` 条件——job 已被判僵尸并退过次数，迟到的图不能再覆盖成 `done`（否则用户既拿到图又拿回次数）。

### 5.3 额度池（`prefs.art_quota`）

| 规则 | 口径 |
|---|---|
| 每月免费 | `FREE_PER_MONTH = 3`（与前端 `art.js` 一致） |
| 跨月 | `ym` 变化 → `freeUsed` 归零，**付费次数不清零** |
| 消费 | 免费优先、付费兜底；两池皆空 → `allowed:false`（`code:'NO_QUOTA'`）；成功时返回 `pool` 记下扣的是哪个池 |
| 返还 | **按 `pool` 精确退**：扣免费退免费（带 `freeUsed >= 1` 条件防下探负数），扣付费退付费；老 job 没有 `pool` 字段才走反推兜底（`freeUsed < 3` → 上次必扣免费，否则必扣付费）——用池推断会出现「用户免费额度凭空缩水」，所以新账一律记账不退推 |
| 激励视频 | 每条视频补 1 幅（进 `paid` 池，同步记 `bonus`），每天上限 3 次 |
| 邀请有礼 / 连签 7 天 | 同样进 `paid` 池 + 记 `bonus`（`grantBonusArt`）——奖励次数与付费次数共用消费顺序，但不算付费资产 |

### 5.4 双人绑定（`couples.status`）

```
create → waiting ──join──→ bound ──unbind──→ （文档删除，回到无绑定）
```

- `create` 时若已有 `waiting` 文档：**复用原码**；已 `bound` 则直接返回绑定视图。码是 **4 位**；`create` / `join` 的称呼（全站唯一会展示给第三方的自由文本，会进分享卡标题）**必须先过内容安全再写库**，且要排在抢占绑定之前——先绑上再拒名字，两个人就已经站在同一份关系里了；
- **过期是惰性的**：`join` 命中 `waiting` 文档时若 `createdAt` 已超 **7 天**，就地删除该文档并回「邀请码已过期，让 TA 重新生成」（没有定时清扫，过期只在被使用时判一次）；
- **绑定用 CAS 抢占**（`_id` + `status:'waiting'` 条件更新）：两个人同时输同一个码，只有一支能改到；后到的一支再查一次是不是自己已经坐进去了（同一人连点两下当幂等成功），否则回「这个邀请码刚被别人用了」。旧实现裸 `update` 是后写覆盖先写：两边都收到「绑定成功」，文档里却只留下后一个人；
- **加入成功即作废自己名下等着的码**（一个人只站在一份关系里；`findMyCouple` 只取一条，留着旧码会让「我和谁绑着」变成随机的）；作废失败不拦加入；
- **自扫自码**（8.0.4）：waiting 文档里只有自己一个人时不再回「绑定成功」，改回「这是你自己的邀请码，发给 TA 再输给对方吧」——此前页面说「已绑定」、双人空间说「未绑定」，同一件事两个说法。

---

## 六、关键算法与不变量

### 6.1 同场聚合键 `eventKey`

```
s        = (venue 去掉全部空白 + '|' + date).toLowerCase()   // 服务端 makeEventKey
eventKey = 'evt_' + md5(s).slice(0, 16)                      // 32 位 hex 只取前 16 位
用户开了同场 opt-out → 存空串，聚合自然排除，偏好本身不入库
```

去空白 + 转小写是为了让「上海大剧院」和「上海大剧院 」（多打一个空格）落到同一场；演示模式的
`store.js` 用同名同序的 djb2 哈希生成 `evt_demoXXXXXXXX`（格式对齐，值无需一致——数据不出本机）。

双人页的场次键另有兜底链：`eventKey` → `venue|date` → `title|date`（`utils/duoData.js` 的 `eventKeyOf`），**两个页面不许自己拼键**。

### 6.2 坐标三级来源（地图落点的源头）

```
① 客户端已有 geo              → 直接用（不覆盖）
② 城市静态字典命中 city       → 城市中心坐标，geoSource='city'（查不到保持 null，不猜）
③ 带场馆名 + 腾讯 LBS 可用    → 场馆级 POI 精化，geoSource='venue'（失败保持城市中心）
```

① 是白名单里留的入口：当前**端上没有任何地方上报 geo**（scan 表单不带它、`addTicket` 也不补），
所以线上票根的坐标实际都由 ② / ③ 生成；mock 演示数据自带 geo，只影响演示模式。

腾讯位置服务调用在 `cloudfunctions/saveTicket/geocode.js`（`apis.map.qq.com` 场馆检索）；Key 目前**明写在文件常量**里（已知项，经确认不轮换）。

### 6.3 水彩中国投影（`utils/mapArt.js`）

- 等距圆柱投影：经度 73.4–135.1、纬度 17.8–53.6，标准纬线 35°（`KX`、`S`、`MAP_TOP`）；
- 产物尺寸：插画 `ART_W×ART_H = 640×620`，舞台 `STAGE_W×STAGE_H = 666×645`；
- **国界 101 个控制点**（`BORDER`，8.0.5 实测；99d0e68 的提交说明写 96，代码为准）+ 海南 / 台湾两条独立轮廓环（8 点 / 9 点）。点少到 48 时，Catmull-Rom 过点平滑会把蒙古的凹陷、渤海与辽东 / 山东半岛、雷州半岛与西双版纳的尖角**修圆成丘陵**——这三处正是「一眼认出中国」的地方。两块岛**必须画在大陆裁剪域之外**：它们的坐标本就在大陆轮廓外，放进 `<g clip-path="url(#cn)">` 会被静默裁掉（v7.0–7.4.0 的海南就是这么消失的）。改这一处请开 `node scripts/dev/preview-map.js` 看一眼；
- **边缘沉积**：国界描粗、裁剪在陆地**内侧**，只让内缘一圈变深（真实水彩的边界比中心深）。浅色主题（`minimal` 的 #F5F5F5 落在 #FFFFFF 卡片上）靠它才看得见，底色不透明度 0.9；
- **同一份几何的第二个出口 `stageLand()`**（8.1.0 加）：`landSrc()` 出的是 SVG 字符串（给 `<image>`），`stageLand()` 出的是**舞台坐标 + 配好色的纯数据**（`border` / `regions` / `isles` / `pulp` / `rim` / `RIM` / `BLEED`），给 Canvas 用（一键成片的长图）。**不能喂 `drawImage` 的是 SVG 字符串，不是这份陆地** —— 长图由此与页面上那张共用同一份国界，改投影两边一起变；
- `toStage(lng, lat)` 对脏值返回 `null`，**绝不返回 NaN**（NaN 进 data-uri 会整图崩）；
- 气泡避让（`layoutBubbles`）：只推气泡（push / below 两条出路），**绝不挪落点**；避让算法用数值加法，禁止 `toFixed` 参与坐标计算（返回字符串会拼出 `"391"+16="39116"`——v7.0 修过的真实 bug）；
- 避让的落位判据是**重叠面积**而不是「压没压住」：满图 12 城时东部沿海物理上就塞不下（105°E 以东 5 座城，横排只够 2 颗），是非题只能回答「哪个位置都不行」→ 随便选一个 → 整块糊住。量面积才能挑出「糊得最轻」的位置（最惨一处从整颗气泡的 53% 降到 24%）。**气泡宽度由 JS 下发到行内 style**：气泡绝对定位、父级 0 尺寸，收缩宽度会被 `min-width` 钉死，避让会量到一个不存在的盒子（四字名折行，实测与算法差 8×26rpx）；
- 真地图图钉（`markersOf`）吃的是同一份 `cities`（含重心坐标），**图钉 id = cities 下标**，点图钉据此找回城市，与点气泡共用同一个面板入口。

### 6.4 里程（`utils/geo.js`）

`haversine` 大圆距离（R=6371 km），按时间排序后相邻两点累加；仅双人报告页使用。

### 6.5 勋章判定阈值（`utils/badges.js`，16 枚）

演出 10 场 / 电影 100 部 / 城市 10 座 / 交通 10 次 / 同乐队 3 场 / 观演 5 城 / 分享 10 张（**只认真分享**，保存到相册不算）/ **进过地图且点亮 3 城**（`sp_map_visited`，v7.0 起由 `pages/discover` 打标）/ 跨年（12-31 或 01-01）/ 深夜场（23:00–05:59）等。

后三枚（连签 3 天 / 连签 7 天 / 累计积分 500）判定读**服务端**（`dailySign` + `pointsGet`）：
签到与积分本就由云函数结算，端上算等于「改一下手机时间就能点亮」。两个口径容易写反：
① 取不到服务端数据时**只说门槛、不编进度数字**（假的进度比没有进度更伤人）；
② 积分看**累计获得**（`lifetime`）而不是余额——攒够 500 换掉 5 次重绘后余额归零，按余额判定
勋章会当场熄灭，已经得到的东西不该因为消费而失去。

### 6.5.1 订阅消息（`utils/subscribe.js` + `saveTicket/recall.js`）

一次性订阅：**一次授权只能发一条**，所以没有「每日提醒」开关可做。真实闭环是
「签到时授权 → 次日 09:00 发一条 → 用户回来再授权」。三处细节错了就是静默失效：

- `askIfDue()` 必须在**点击回调里同步发起**（`utils/sign.js` 的 `checkIn` 第一句）——
  放到 `await` 之后会被判为非用户点击而 fail，且用户看不到任何报错；
- 端上被拒后 30 天内不再问，同一天只问一次；
- 云端只在北京时间 07:00–22:00 发送（定时器半夜跑起来也不能吵人），窗口外**留着**不是丢弃；
  43101（无授权额度）/ 47003（模板字段对不上）是终局错误，直接结案不重试。

**8.1.2 起同一条链路发两类**，**不新增定时器**（`recallTick` 那趟每小时顺手分拣 `type`）：

| | 签到召回 `type='recall'` | 周年提醒 `type='anniv'` |
|---|---|---|
| 从哪儿授权 | 详情页之外：`utils/sign.js` 签到那一下 | **只放票根详情页**（那一行贴着具体一张票） |
| 什么时候出现 | 不分时机，签到成功就同步发一次授权 | 只有那张票的下一个周年日落在 **30 天内**才出现（更早用户不知道自己在同意什么，当天又已经排不上了） |
| 什么时候发 | 次日 09:00；发送窗口 07:00–22:00 | **就是那天 09:00**；**晚了一天就作废**（`status='dead'`、`err='expired:<ymd>'`）—— 补发出去的那句「今天满 N 周年」是假话 |
| 点什么进来 | `pages/home/home` | `pages/detail/detail?id=<票 id>`（票没了 → 4.18.0 空态） |
| 一人几条 | 一条 | 一条（给别的票排提醒就是覆盖 —— 端上的「已排上」与云端必须一对一） |
| 模板字段 | `phrase1` / `number2` | `thing1`（票名，≤20 字）/ `time2`（`2026年08月12日 09:00`）/ `thing3`（备注，≤20 字）/ `thing4`（`你`） |

两类共用一条「不能撒谎」的规矩：**端上只有真的回报成功才显示「已排上」**（用户拒绝 / 弹窗失败 /
云端 `ok:false` 三种情况都不记），弹窗拉不起来（模板没配、今天已问过）时那一行整块收起，不留假入口。

### 6.6 骨架屏时序（`utils/skeleton.js`）

300ms 内完成不发骨架，避免「闪一下」；页面 `onLoad` 起、数据到位或超时止。

---

## 七、错误处理与降级矩阵

| 场景 | 兜底 | 用户看到 |
|---|---|---|
| 云读列表失败 | 落本地兜底 + `flags.netFallback` | 页面横幅提示，不白屏 |
| 票根超 `LIST_MAX` | `flags.truncated`（由真实 `count()` 比对得出；`flags.cap` 是上限值 500，不是标记） | 「只显示了最近 N 张」 |
| 单张票不存在（分享落地 / 过期 id） | 页面空态 | 「不在册子」而非白屏 |
| OCR 识别失败 | 云函数 `{ok:false,msg}` → 进**空表单**手动补填 | 「没认出来」+ 可编辑表单 |
| 无百度密钥 | 跳过该通道，走微信 OCR | 无感 |
| AI 文案 / 结语失败 | 规则兜底文案（`ai.js` fallback） | 仍有内容，不空卡 |
| 天气取不到 | `weather = null` | 天气印记整块不显示（不造假） |
| 内容安全平台故障 | **先重试一次，两次都异常才拒绝**（旧口径「服务异常即通过」等于给违规文本留旁路：挑腾讯侧抖动的时刻提交就能把未审内容写进去，而它会跟着卡片/海报导出） | 「安全检查暂时不可用，请稍后再试」 |
| 内容安全判违规 | 拒绝入库 | 「票面文字未通过安全检查」 |
| 支付查单不可用 | 不发货 + 审计记录 `verify_unavailable` | 稍后重试 |
| 重绘失败 | 写 `failed` + 按 `pool` 返还额度 | 「重新画一幅」 |
| 重绘卡死（云函数执行被杀） | 下次调用回收僵尸 job（`running` 超 3 分钟）+ 返还额度 | 「上次没跑完，次数已退回，再点一次」 |
| 积分兑换发额度失败 | 扣掉的 100 分与当日名额一起退回 | 「兑换失败，分数已退回，请再点一次」 |
| 重绘图临时链接过期 | 引导重画 | 「图版过期了（24 小时有效）」 |
| 卡片取票失败 | 空态 + 出路（去扫描 / 返回） | 不复用第一张票冒充 |
| 图片加载失败 | 占位图 / 跳过该张 | 不出现破图 |
| 广告位未配置 | 相关 UI 整体隐藏 | 不出现空按钮 |
| 订阅模板 ID 未配置 | 授权弹窗与召回整条链不启动（云端也无记录）；8.1.2 起**两个模板各管各的**，一个没配不影响另一个 | 无感，签到照常 |
| 订阅授权被拒 / 弹窗失败 | 不挂提醒；被拒后 30 天不再问（环境失败不进静默期）。**端上不记「已排上」** —— 记了就变成「我明明设了提醒却什么都没来」 | 无感（签到奖励照发）；详情页那一行收起 |
| 召回消息发送失败 | 网络类留到下一整点重试（≤3 次）；43101/47003 结案留痕 | 无感（最多少一条提醒，不发第二个错） |
| 周年提醒过期（定时器停过） | 不在那天就**不发**：`status='dead'`、`err='expired:<ymd>'` 留痕，不重试不补发 | 无感（迟到的「今天满 N 周年」比不收到更糟） |

---

## 八、安全与合规设计

| 面 | 设计 |
|---|---|
| 归属 | `_openid` 一律服务端写入；查询按 `_openid` 过滤，跨用户不可见 |
| 内容安全 | 用户可写文本**入库前必检**（`security.msgSecCheck`，违规码 87014）：票面 `title` / `note` / `venue` / `city` / `seat` / `source` 六个字段拼成一段、一次调用过闸（8.0.4 起——协议里写的是「票面字段过安检」，旧实现只检了 title + note，场馆 / 城市 / 座位 / 购票平台同样手输、同样会进详情页、分享卡与卡片图）、AI 文案（`setCaption`）、昵称（`profileSave`）、双人称呼（`bind` 的 create / join，全站唯一展示给第三方的自由文本，还会进分享卡标题）；平台故障**重试一次后拒绝**（见 §7）；AI 生成内容界面必须带「AI 生成」标识 |
| 支付防伪 | 三道闸见 §4.3；发货前必须向微信侧回查真实订单 |
| 额度 | 服务端权威记账，客户端只读视图；客户端上报的数量、价格一律不采信 |
| 密钥 | 小程序 AppSecret、支付 appKey/appSecret、上传私钥均在 `.env` / `config` 集合，**不入仓库**；`config` 集合权限「仅管理端可读写」 |
| 隐私 | 不申请定位权限（城市来自票面识别）；`__usePrivacyCheck__` 开启；摄像头 / 相册按需触发 + 官方隐私弹窗 |
| 运维接口 | `opsCleanup` / `opsAudit` / `goodsImgSetup` / `opsRecall` 需 `opsToken`（与服务端 AppKey 比对，四个入口共用 `checkOpsToken`） |
| 订阅消息 | **只在用户主动点击时请求一次授权**（签到那一下 / 详情页那行「提醒我」），不在启动/进页面时弹（合规红线）；模板 ID 未配置时一次都不请求；发送只在服务端（端上不能指定发给谁） |
| 同场票根墙（8.1.0） | **全项目唯一一个陌生人可读的出口**，所以隐私面按「只许少、不许加」管：① 默认关闭——上墙是**一张票一次**的主动选择（沿用「同场印记」那个默认参与的开关，等于偷偷扩大用户没同意过的范围）；② `wallPublic` **不在入库白名单**里，端上塞不进墙，唯一入口是 `wallJoin` 且必过安检；③ 出口 `field()` 取四列 + 逐字段重建，只出 `title / venue / date / img`，**`_id` 也给不得**（card 页支持按 id 取票，漏 id 等于白送一条读别人完整票根的旁路）；④ 撤下不过安检（内容后来被判违规的用户不能被永久钉在墙上）。契约见 §4.2，守卫见 `tests/same_wall.test.js` |

---

## 九、双模式（云 / 演示）

`utils/env.js` 的 `USE_CLOUD` 是全工程地基，**任何新功能必须两种模式都能跑**：

| 层 | 云模式 | 演示模式（`USE_CLOUD=false`） |
|---|---|---|
| 票根 | 云函数 + `tickets` 集合 | `sp_local_tickets` 本地 storage，封面与文案走 `utils/mock.js` 演示数据 |
| 文案改写 | `setCaption` 云函数 | `sp_caption_overrides` 本地覆盖表 |
| 删除 | 云库删除 | 记入 `sp_deleted_ids` 隐藏名单 |
| 双人 | `bind` action + `couples` | `couple.js` 的演示绑定：本地写一份「演示搭档」进 `sp_couple_cache`（`partnerOpenid='demo_partner'`），不产生云文档；票根归属由 `duoData.js` 按排序 `i % 2` 交替分配 |
| 支付 / 重绘 | 云函数 + `prefs` | 额度视图本地模拟，不产生真实订单 |
| 签到 / 积分 | `dailySign` / `pointsGet` + `prefs` | `status()` 一律返回 null（首页横幅与「我的」积分块**整块不渲染**），`checkIn()` 回「演示模式不支持签到」——不留点了没反应的假入口 |
| 邀请归因 / 订阅消息 | `refCode` / `refBind` / `refReward` / `shareOpen` / `recallSave` / `annivSave` | `invite.js` 全链路静默空转（不影响任何界面）；演示模式没有签到可签，订阅授权一次都不发起详情页那一行也不出现（`setupAnniv` 第一句就拦演示票根 —— 样例日期不是用户真去过的那天） |

演示内容**必须标注「演示」**（项目宪法的诚实原则）；演示票通过 `store.isMockTicket(id)` 判定。

---

## 十、改动影响面速查

| 你要改 | 必须同步看 |
|---|---|
| 票根字段 | §2.1 表 + `saveTicket` 入库段 + `store.js` 归一逻辑 + 页面读字段处（`_id` / `id` 别写反） |
| 新增云能力 | 加 action（不新建函数目录）+ `scripts/ci/deploy-fns.js` 部署 + §4.2 表 |
| 订阅消息 | 端上模板 ID（`utils/subscribe.js` 的 `TMPL_ID` 与 `ANNIV_TMPL`）+ 云端字段名（`recall.js` 的 `dataOf` / `annivData`，**必须与 MP 后台模板逐字一致**，否则 47003）+ `config.json` 的 `subscribeMessage.send` 权限与 timer 触发器 + §6.5.1 |
| 额度 / 价格 / 订单 | `pay.js` 四件套 + §5.1 状态机 + §4.3 三道闸（**动钱，先人工确认**） |
| 积分规则 / 上限 | `POINTS_RULES` + `SIGN_MILESTONES` + `POINTS_PER_ART` + `CLIENT_EARN_REASONS` + **`PUBLIC_RULE_KEYS`**（只公开 sign / upload / card；share 与 invite 照发不误但不对外展示）+ 端上 `points.js` 的 `RULE_LABEL`（两处同时改，否则界面上摆的是假规则） |
| 邀请码 / 短码 | 端上 `invite.js`（三个 `sp_ref_*` key 与分享 path 的 `?ref=`）+ `saveTicket` 的 R6 段四道防刷闸 + `couples` 的 4 位码与 7 天惰性过期 + `wxacode` 要收 `ref`（漏传则归因永远算不到邀请人头上）+ 分享卡的 `shareOpen` 归因（码属于分享人） |
| 双人邀请 / 绑定落地 | `pages/bind`（三态：confirm / done / error，done 再分「有票 / 没票」两支）+ `couple.joinByCode`（**称呼选填**，空则云端默认 TA）+ `pages/duo` 的 `_mineCount` → `share.js` 的 duo 三档文案 + `tests/duo_invite.test.js`。两条口径别写反：**「先不填」仍然往下走**（不是中止）；**云兜底的演示票根不算用户的**（既不能据此推「去收第一张」，也不能算进 `mine` 报出去） |
| 坐标 / 地图 | §6.2 三级来源 + `mapArt.js`（水彩与真地图同源，两处都要动）+ `tests/discover_map.test.js` |
| 场馆立牌 | `signBoard.js`（版面与文案，纯函数）+ `pages/sign/board.js`（立牌画笔）+ `tests/sign_board.test.js` + `saveTicket` 的 `wxacode` 要收 `kind='sign'`。码的落地页**写死在云函数里**（`pages/scan/scan`），端上指定不了 —— 有别于分享码落首页；`pages/scan` 的入档返回必须有 `fail` 兜底（页面栈里只有它一页时 `navigateBack` 静默失败）。改动后**必须先出图看一眼**（`node scripts/dev/preview-sign.js [标题]`，码位是灰方块占位）—— 标题被裁边、码压住号召语、页脚冲出纸边这三类错**都不报错也不掉测试** |
| 一键成片 | `mapFilm.js`（编排与版面，纯函数）+ `pages/discover/film.js`（长图画笔）+ `tests/map_film.test.js`。**水彩 SVG 不能喂 `drawImage`**（iOS 画不出来），陆地走 `mapArt.stageLand()` 出纯数据、长图拿 Canvas 路径重画（**与页面上那张同一份国界**，改一边两边都变）；dpr 走 `canvas-deco.safeDpr`。改动后**必须先出图肉眼看一眼**（`scripts/dev/preview-film.js`）—— 图上少画一块、地名压线、地图偏小这三类错**都不报错也不掉测试** |
| 主题令牌 | `app.wxss` 的 `.theme-*` 段 + `theme.js` 元数据 + `custom-tab-bar` **自己的 wxss**（组件是独立渲染树） |
| 图形 / 图标 | `icons.js` / `deco.js`：只能 data-uri SVG，颜色在 JS 拼实色，**图形里不写中文** |
| 页面新增 / 下线 | `app.json` 注册 + 入口可达（`tests/page_refs.test.js` 会拦孤立页）+ 挂在它身上的勋章标记 / 埋点由谁接手 |
| 本地 storage 字段名 | §2.1 与 ARCH 的 key 全表：**改名等于丢用户数据** |

---

*本文档由代码现状盘点整理，作为详细设计基线维护；与代码不符时以代码为准并回改本文件。*
