# 有票为证 · 系统设计说明（SDD）

> **版本对齐**：小程序 `7.1.0` ｜ **日期**：2026-09-12
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
| 上传照片 | `pages/scan`、`pages/me` | `uploadFile` → `tickets/{时间戳}-{6 位随机}.jpg`，再把 fileID 交给云函数 |
| 取临时链接 | `pages/annual`、`pages/art`、`pages/card` | 只对 `cloud:` 开头的 fileID 调 `getTempFileURL`（链接 24 小时有效） |
| 直调云函数 | `pages/scan`（recognizeTicket）/ `pages/art`（artRestyle、artQuery）/ `pages/card`（wxacode）/ `pages/detail`（checkText、eventStats） | 单次动作，不经过数据层 |

碰云的 utils 共 6 个：`store`（票根）、`couple` 与 `duoData`（双人）、`pay` 与 `auth`（支付、登录会话）、`ai`（端上大模型）。

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
| `venue` / `city` / `seat` / `source` | string | 客户端 | 以票面 OCR 转录为主，不做强制内容检测 |
| `price` | number \| null | 客户端 | 服务端 `Number()` 兜底 |
| `province` | string | 客户端 | 城市字典配对结果 |
| `geo` | `{lat,lng}` \| null | 客户端或服务端补 | 见 §6.2 坐标三级来源 |
| `geoSource` | `'city'` \| `'venue'` | 服务端 | 坐标来源标记；客户端自带坐标时不写 |
| `img` | fileID | 客户端 | 云存储 `tickets/` 前缀 |
| `eventKey` | md5 串 | 服务端 | 同场聚合键；用户同场 opt-out 时为空串 |
| `weather` | object \| null | 服务端 | Open-Meteo 历史天气；失败即 null，不阻塞入库 |
| `aiCaption` | string | 服务端（`setCaption`） | 过内容安全后才写 |
| `artVersion` | `{fileID, createdAt}` | 服务端（`artRestyle`） | 最近一次重绘图版，用于「原票 ↔ 重绘」对照（记录失败不影响交付） |
| `note` | string | 客户端 | 自由文本，**入库前必检**（与 `title` 一起送检） |
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

> **现状口径更正**：邀请码**不过期**，重复 `create` 复用同一码直到绑定成功。README 数据模型里曾写「7 天过期」，代码里没有这个逻辑（7 天那条是登录会话的新鲜度），已按代码更正。

### 2.3 `prefs`（账本集合：一个 `type` 一类文档）

全项目引用最多的集合，新人最容易漏看。8 种文档：

| `type` | 存什么 | 关键字段 |
|---|---|---|
| `art_quota` | 重绘额度（每人一份，服务端权威） | `ym`（当月）、`freeUsed`、`paid` |
| `pay_order` | 订单与对账记录 | `outTradeNo`、`productId`、`priceFen`、`status`、`deliveredAt` |
| `art_job` | 重绘任务 | `ticketId`、`status`、`fileID`、`msg` |
| `auth_session` | 登录会话（支付签名需要 session_key） | `sessionKey`、`updatedAt`（7 天新鲜度） |
| `user_profile` | 署名资料 | `nickname`、`avatar` |
| `ad_reward` | 激励视频当日计数 | `ymd`、`count`（每日上限 3） |
| `groupOrder` | 分组排序序 | `labels` |
| `wxacode_poster` | 海报小程序码缓存 | `fileID`（全局一份，不带 `_openid`） |

### 2.4 `config`（支付凭证）

单文档 `_id: 'pay_secret'`：`{ offerId, appKey, appKeySandbox, appSecret, env }`。
`env: 0` 现网 / `1` 沙箱，**两套 AppKey 是不同的值**。集合权限必须设「仅管理端可读写」。
**不在自动建表范围**，缺失时支付与登录返回 `NO_CONFIG`，需去控制台手工创建。

### 2.5 云存储

- 票根原图路径 `tickets/{Date.now()}-{6 位随机}.jpg`；另有 AI 重绘产物、海报小程序码缓存；
- **现状：全项目没有 `deleteFile` 调用** —— 删票根只删数据库记录，照片永久留在云存储。既是持续成本，也是「用户删除权未删净」的合规点（已知债，见 `docs/HEALTH.md` §5.3）。

---

## 三、客户端模块契约（`utils/`，20 个）

按「被页面直接 require 的次数」排序，括号内为引用页数：

| 模块 | 主要导出 | 关键口径 | 依赖 |
|---|---|---|---|
| `icons.js` (19) | `iconSrc(name, color, opacity, width, solid)`、`ICON_PATH`（约 43 个键） | 线性图标转 data-uri SVG；未知键回落 `ticket`；默认描边 1.6、默认色 `#6B5B50`、viewBox 24×24 | — |
| `deco.js` (19) | `decoSrc(name, theme)`、`avatarSrc`、`postmarkParts`、`artFrame`、`flowerStamp`、`pinkedPanel` | 25 款手绘装饰；viewBox 默认 `0 0 64 44` | — |
| `theme.js` (16) | `getTheme`、`setTheme`、`getThemeMeta`、`isDark`、`apply(page)`、`current`、`set` | 六主题 paper/glass/collage/film/literary/minimal，默认 `paper`；key `app_theme`，兼容旧 `sp_theme` | — |
| `store.js` (11) | `USE_CLOUD`、`listTickets`、`getTicket`、`addTicket`、`setCaption`、`removeTicket`、`isMockTicket`、`getSameOptOut`、`listFlags` | `PAGE_SIZE=20`、`LIST_MAX=500`；云失败落本地并置 `flags.netFallback`；触顶置 `flags.cap` | env、mock |
| `track.js` (8) | `track(event, data)`、`dump()` | 双通道：`wx.reportEvent` + 本地环形缓冲（key `sp_track_events`，500 条上限，参数截 60 字） | — |
| `pay.js` (8) | `PRODUCT_ID`、`PACK_PRICE_LABEL`、`humanizePayErr`、`getQuota`、`buyArtPack(onStatus)`、`getProfile`、`saveProfile`、`clearProfile`、`quotaLabel` | 商品 `ART_PACK_10`（¥6 / 10 幅）；下单后轮询 15 次 × 1.5s（首轮 600ms）；免费额度 3 幅/月 | env、auth |
| `couple.js` (6) | `queryCouple`、`cachedCouple`、`createCode(name)`、`joinByCode(code, name)`、`unbind` | 走 `bind` action 的 mode=query/create/join/unbind；缓存 key `sp_couple_cache` | env |
| `skeleton.js` (5) | `start(page)`、`end(page)` | 300ms 内完成不闪骨架 | — |
| `env.js` (5) | `USE_CLOUD`、`CLOUD_ENV` | 全项目唯一要手改的配置 | — |
| `date.js` (5) | `groupLabel`、`stubDate`、`weekday`、`todayMD`、`todaySign`、`annivYears` | 时光签 24 句；anniv 要求严格 `YYYY-MM-DD`（10 字符） | — |
| `ai.js` (5) | `parseDraftByAI(lines, fallback)`、`generateCaption(t, style, anniv)`、`CAPTION_STYLES`、`generateAnnual(stat)`、`annualFallback` | 端上直调；模型链 hunyuan-v3 → cloudbase 兜底；文案硬截 40 字；结语单行上限 18；`MAX_LINES=40` | weather |
| `mock.js` (3) | `TYPE_TEXT`、`tickets`（8 张）、`timeMachine`、`badges`（13 枚）、`MOCK_IDS` | 演示数据即数据模型样例 | — |
| `mapArt.js` (3) | `landSrc`、`routeSrc`、`stampSrc`、`toStage(lng,lat)`、`layoutBubbles`、`markersOf`、`bubbleColor`、`bubbleWidth` | 水彩中国投影：经度 73.4–135.1、纬度 17.8–53.6，标准纬线 35°；`ART 640×620` / `STAGE 666×645` | — |
| `duoData.js` (3) | `loadMerged(c)`、`eventKeyOf(t)`、`togetherKeys`、`togetherCities`、`recentRows` | 双人三页同源；场次键优先级 `eventKey` → `venue\|date` → `title\|date` | mock、env、date |
| `canvas-deco.js` (3) | `wrapText`、`roundRect`、`pinkedRect`、`watercolorBlob`、`drawStar4`、`drawHeart`、`drawTape`、`drawSprig` | 纯函数、不依赖 wx；card 与 annual 共用 | — |
| `ads.js` (2) | `REWARDED_ID`、`BANNER_DETAIL_ID`、`hasRewarded`、`hasBanner`、`showRewarded` | 广告位 ID 为空时 UI 整体隐藏；`showRewarded` 不 throw | — |
| `weather.js` (1) | `weatherText(w)`、`weatherHint(w)` | WMO 码表约 28 项；体感分界 5 / 14 / 30 ℃；`w` 为空一律返回空串（不造假） | — |
| `geo.js` (1) | `haversine(a,b)`、`totalKmOf(sortedTickets)` | 地球半径 6371 km | — |
| `badges.js` (1) | `computeBadges(ts, coupleInfo, shareCount, mapVisited, inviteSent)` | 13 枚勋章阈值见 §6.5 | mock |
| `auth.js` (经 pay) | `ensureSession(force)`、`isFresh`、`LS_AUTH_TIME`、`FRESH_MS` | key `sp_auth_time`；24h 新鲜度；模块内并发去重 | env |

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
1) event.Event 以 xpay_ 开头        → 支付推送分支（见 4.3）
2) event.action === 'xxx'          → 27 个 action 分支
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
| `wxacode` | — | 生成海报小程序码 → 云存储 + `prefs.wxacode_poster` 缓存 |
| `backfillGeo` | — | 老票根坐标回填（场馆级优先，退城市中心），批量写 `tickets` |
| `artRestyle` | `ticketId` | 建 `art_job`（`running`）→ 出图 → `tickets.artVersion`；额度不足返回不可用 |
| `artQuery` | `ticketId` | `{ok, status:'none'\|'running'\|'done'\|'failed', fileID?, msg?}` |
| `authLogin` | `code`（wx.login） | code2Session → 写 `prefs.auth_session`（含 sessionKey） |
| `payCreate` | `productId` | 建 `prefs.pay_order`（`created`，`buyQuantity` 服务端写死 1）→ 返回签名数据 |
| `payQuery` | `outTradeNo` | **主动查单**：向微信 `/xpay/query_order` 复核；未支付超 15 分钟 → `expired` |
| `payConfirm` | `outTradeNo` | 客户端确认后对账发货；`delivered` 幂等、`refunded` 拒发 |
| `quotaGet` | — | `{freeLeft, paid, left, freePerMonth}` 视图 |
| `artRewardGrant` | （校验用 `check`） | 激励视频奖励入账；每日上限 3（`prefs.ad_reward`） |
| `profileGet` / `profileSave` / `profileClear` | `nickname`（截 24 字）/ `avatar` | 读写 `prefs.user_profile`；昵称过内容安全 |
| `bind` | `mode: query\|create\|join\|unbind`，`name`（截 12 字），`code` | 双人绑定；`create` 复用未绑定的旧码 |
| `duoStats` | `full`（bool） | 双人统计（合并票数 / 城市 / 一起场次） |
| `eventStats` | `eventKey` | 同场收藏人数（匿名聚合；opt-out 用户不入列） |
| `goodsImgSetup` / `opsCleanup` / `opsAudit` | `opsToken`（= AppKey 校验），`imgBase64` | 运维专用：道具图上传 / 上线前清理 / 只读巡检 |

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
| `loadQuota` / `consumeQuota` / `refundQuota` / `quotaView` | 额度四件套，见 §5.3 |
| `humanizePayErr(errno, errMsg)` | 错误码 → 人话（-15001 ~ -15017，前端 `utils/pay.js` 同源） |

### 4.5 `recognizeTicket`

- 入参 `{ fileID }`；返回 `{ ok, draft, lines }` 或 `{ ok:false, msg }`；
- 链路：**fileID 格式白名单**（必须匹配 `cloud://环境.存储`，云函数是管理员权限，防伪造 fileID 探测）→ 下载 → OCR 双通道（百度 → 微信 `openapi.ocr.printedText` 兜底）→ `parser.js` 规则解析成草稿；
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
   │   └─ 收到退款但查无此单 ────→ refund_unknown_order（审计留痕）
```

只有 `delivered` 的订单才回退额度；`created` / 各种 mismatch 单从未发过货。

### 5.2 重绘任务（`prefs.art_job.status`）

```
（无）──artRestyle──→ running ──成功──→ done（带 fileID，写 tickets.artVersion）
                        └──失败──→ failed（带 msg，额度返还）
```

同一 `ticketId` 已有 `running` 任务时**不重复发起**。客户端 `artQuery` 还可能拿到 `none`（没有任务）。

### 5.3 额度池（`prefs.art_quota`）

| 规则 | 口径 |
|---|---|
| 每月免费 | `FREE_PER_MONTH = 3`（与前端 `art.js` 一致） |
| 跨月 | `ym` 变化 → `freeUsed` 归零，**付费次数不清零** |
| 消费 | 免费优先、付费兜底；两池皆空 → `allowed:false` |
| 返还 | **按同一铁律反推池子**：`freeUsed < 3` 时上次必扣免费，否则必扣付费（否则会出现「用户免费额度凭空缩水」） |
| 激励视频 | 每条视频补 1 幅，每天上限 3 次 |

### 5.4 双人绑定（`couples.status`）

```
create → waiting ──join──→ bound ──unbind──→ （文档删除，回到无绑定）
```

`create` 时若已有 `waiting` 文档：**复用原码**；已 `bound` 则直接返回绑定视图。

---

## 六、关键算法与不变量

### 6.1 同场聚合键 `eventKey`

```
eventKey = md5(venue + '|' + date)      // 服务端 makeEventKey
用户开了同场 opt-out → 存空串，聚合自然排除，偏好本身不入库
```

双人页的场次键另有兜底链：`eventKey` → `venue|date` → `title|date`（`utils/duoData.js` 的 `eventKeyOf`），**两个页面不许自己拼键**。

### 6.2 坐标三级来源（地图落点的源头）

```
① 客户端已有 geo              → 直接用（不覆盖）
② 城市静态字典命中 city       → 城市中心坐标，geoSource='city'（查不到保持 null，不猜）
③ 带场馆名 + 腾讯 LBS 可用    → 场馆级 POI 精化，geoSource='venue'（失败保持城市中心）
```

腾讯位置服务调用在 `cloudfunctions/saveTicket/geocode.js`（`apis.map.qq.com` 场馆检索）；Key 目前**明写在文件常量**里（已知项，经确认不轮换）。

### 6.3 水彩中国投影（`utils/mapArt.js`）

- 等距圆柱投影：经度 73.4–135.1、纬度 17.8–53.6，标准纬线 35°（`KX`、`S`、`MAP_TOP`）；
- 产物尺寸：插画 `ART_W×ART_H = 640×620`，舞台 `STAGE_W×STAGE_H = 666×645`；
- `toStage(lng, lat)` 对脏值返回 `null`，**绝不返回 NaN**（NaN 进 data-uri 会整图崩）；
- 气泡避让（`layoutBubbles`）：只推气泡（push / below 两条出路），**绝不挪落点**；避让算法用数值加法，禁止 `toFixed` 参与坐标计算（返回字符串会拼出 `"391"+16="39116"`——v7.0 修过的真实 bug）；
- 真地图图钉（`markersOf`）吃的是同一份 `cities`（含重心坐标），**图钉 id = cities 下标**，点图钉据此找回城市，与点气泡共用同一个面板入口。

### 6.4 里程（`utils/geo.js`）

`haversine` 大圆距离（R=6371 km），按时间排序后相邻两点累加；仅双人报告页使用。

### 6.5 勋章判定阈值（`utils/badges.js`，13 枚）

演出 10 场 / 电影 100 部 / 城市 10 座 / 交通 10 次 / 同乐队 3 场 / 观演 5 城 / 分享 10 张 / **进过地图且点亮 3 城**（`sp_map_visited`，v7.0 起由 `pages/discover` 打标）/ 跨年（12-31 或 01-01）/ 深夜场（23:00–05:59）等。

### 6.6 骨架屏时序（`utils/skeleton.js`）

300ms 内完成不发骨架，避免「闪一下」；页面 `onLoad` 起、数据到位或超时止。

---

## 七、错误处理与降级矩阵

| 场景 | 兜底 | 用户看到 |
|---|---|---|
| 云读列表失败 | 落本地兜底 + `flags.netFallback` | 页面横幅提示，不白屏 |
| 票根超 `LIST_MAX` | `flags.cap`（由真实 `count()` 比对得出） | 「只显示了最近 N 张」 |
| 单张票不存在（分享落地 / 过期 id） | 页面空态 | 「不在册子」而非白屏 |
| OCR 识别失败 | 云函数 `{ok:false,msg}` → 进**空表单**手动补填 | 「没认出来」+ 可编辑表单 |
| 无百度密钥 | 跳过该通道，走微信 OCR | 无感 |
| AI 文案 / 结语失败 | 规则兜底文案（`ai.js` fallback） | 仍有内容，不空卡 |
| 天气取不到 | `weather = null` | 天气印记整块不显示（不造假） |
| 内容安全平台故障 | **放行入库**（内容仅用户私有，不阻塞核心收藏） | 无感 |
| 内容安全判违规 | 拒绝入库 | 「票面文字未通过安全检查」 |
| 支付查单不可用 | 不发货 + 审计记录 | 稍后重试 |
| 重绘失败 | 写 `failed` + 返还额度 | 「重新画一幅」 |
| 重绘图临时链接过期 | 引导重画 | 「图版过期了（24 小时有效）」 |
| 卡片取票失败 | 空态 + 出路（去扫描 / 返回） | 不复用第一张票冒充 |
| 图片加载失败 | 占位图 / 跳过该张 | 不出现破图 |
| 广告位未配置 | 相关 UI 整体隐藏 | 不出现空按钮 |

---

## 八、安全与合规设计

| 面 | 设计 |
|---|---|
| 归属 | `_openid` 一律服务端写入；查询按 `_openid` 过滤，跨用户不可见 |
| 内容安全 | 用户可写文本（`title`、`note`、AI 文案、昵称）**入库前必检**（`security.msgSecCheck`，违规码 87014）；AI 生成内容界面必须带「AI 生成」标识 |
| 支付防伪 | 三道闸见 §4.3；发货前必须向微信侧回查真实订单 |
| 额度 | 服务端权威记账，客户端只读视图；客户端上报的数量、价格一律不采信 |
| 密钥 | 小程序 AppSecret、支付 appKey/appSecret、上传私钥均在 `.env` / `config` 集合，**不入仓库**；`config` 集合权限「仅管理端可读写」 |
| 隐私 | 不申请定位权限（城市来自票面识别）；`__usePrivacyCheck__` 开启；摄像头 / 相册按需触发 + 官方隐私弹窗 |
| 运维接口 | `opsCleanup` / `opsAudit` / `goodsImgSetup` 需 `opsToken`（与服务端 AppKey 比对） |

---

## 九、双模式（云 / 演示）

`utils/env.js` 的 `USE_CLOUD` 是全工程地基，**任何新功能必须两种模式都能跑**：

| 层 | 云模式 | 演示模式（`USE_CLOUD=false`） |
|---|---|---|
| 票根 | 云函数 + `tickets` 集合 | `sp_local_tickets` 本地 storage，封面与文案走 `utils/mock.js` 演示数据 |
| 文案改写 | `setCaption` 云函数 | `sp_caption_overrides` 本地覆盖表 |
| 删除 | 云库删除 | 记入 `sp_deleted_ids` 隐藏名单 |
| 双人 | `bind` action + `couples` | 本地演示绑定（`sp_couple_cache`），归属按排序 `i % 2` 交替分配 |
| 支付 / 重绘 | 云函数 + `prefs` | 额度视图本地模拟，不产生真实订单 |

演示内容**必须标注「演示」**（项目宪法的诚实原则）；演示票通过 `store.isMockTicket(id)` 判定。

---

## 十、改动影响面速查

| 你要改 | 必须同步看 |
|---|---|
| 票根字段 | §2.1 表 + `saveTicket` 入库段 + `store.js` 归一逻辑 + 页面读字段处（`_id` / `id` 别写反） |
| 新增云能力 | 加 action（不新建函数目录）+ `scripts/ci/deploy-fns.js` 部署 + §4.2 表 |
| 额度 / 价格 / 订单 | `pay.js` 四件套 + §5.1 状态机 + §4.3 三道闸（**动钱，先人工确认**） |
| 坐标 / 地图 | §6.2 三级来源 + `mapArt.js`（水彩与真地图同源，两处都要动）+ `tests/discover_map.test.js` |
| 主题令牌 | `app.wxss` 的 `.theme-*` 段 + `theme.js` 元数据 + `custom-tab-bar` **自己的 wxss**（组件是独立渲染树） |
| 图形 / 图标 | `icons.js` / `deco.js`：只能 data-uri SVG，颜色在 JS 拼实色，**图形里不写中文** |
| 页面新增 / 下线 | `app.json` 注册 + 入口可达（`tests/page_refs.test.js` 会拦孤立页）+ 挂在它身上的勋章标记 / 埋点由谁接手 |
| 本地 storage 字段名 | §2.1 与 ARCH 的 key 全表：**改名等于丢用户数据** |

---

*本文档由代码现状盘点整理，作为详细设计基线维护；与代码不符时以代码为准并回改本文件。*
