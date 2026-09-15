# 「有票为证」小程序 · 代码全面审查报告

- **审查对象**：`youpiaoweizheng/`（外层主工程 · 16 页 / 5 组件 / 15 工具模块 / 2 云函数 · 约 17,600 行）
- **审查日期**：2026-09-11
- **审查方式**：逐文件静态通读（js + wxml + json + wxss 四侧对账）+ 跨文件系统化脚本扫描 + 关键结论二次复核
- **不在范围**：`youpiaoweizheng/youpiaoweizheng/`（内层历史旧副本，见 P1-14）
- **报告位置说明**：放在仓库根 `docs/` 而非小程序工程内，避免 `docs/**` 被计入小程序包体积

---

## 总体结论

**主链路有 4 个必修阻断问题，其中 2 个是「静默失效」——不报错、不崩溃，用户只感觉到「点了没反应」。** 工程质量在细节上很扎实（幂等、归属校验、内容安全、双模式都有意识地在做），但**「点不动」类缺陷集中在最近改版的复制粘贴处**，以及**云数据库查询上限被错误假设成 200**。

| 级别 | 数量 | 说明 |
|---|---|---|
| 🔴 P0 | 4 | 阻断发布 / 核心数据不可见 / 资金敞口 |
| 🟠 P1 | 17 | 功能异常、主链路断裂、合规风险 |
| 🟡 P2 | 26 | 健壮性、边界、体验 |
| 🔵 P3 | 30+ | 优化建议 |

**已复核标记**：标 ✅ 的条目由我本人读代码或查官方文档二次确认，可直接修；标 ⚠️ 的需真机/后台确认后再定方案。

---

## 一、🔴 P0 · 阻断级（修完才可进下一阶段）

### P0-1 ✅ 云数据库查询上限写错，云模式下全站最多只能看到 20 张票根

- **位置**：`utils/store.js:267`（`.limit(200)`）
- **现象**：票根墙、时光机、双人空间、足迹地图、年度报告、我的页统计——**全部数据源都是这一个查询**。微信官方规定：**小程序端 `limit` 最大 20 条**（云函数端才是 100 条），写 200 会被截断/报错。
- **后果（两种表现都严重）**：
  - 若静默截断 → 用户收到第 21 张票根起，**旧票根在 App 内彻底消失**（只能靠分享链接打开单张），且**永不提示**；
  - 若报错被 catch 吞掉 → 每个页面**静默切换成 8 张演示票根**，用户以为自己的票全没了。
- **连带缺陷**：`utils/store.js:273` 的触顶判断 `rows.length >= 200` 用的是同一个错误假设 → 横幅永不触发，用户永远不知道自己只看到了一部分。
- **修复**：改 `skip + limit(20)` 分批循环拉取；触顶判断改为「总数 > 已拉取数」。
- **⚠️ 真机验证（30 秒）**：用一台有 25 张以上票根的设备打开票夹页，看是「只剩 20 张」还是「变成演示票根」。这决定修复的紧急程度，但两种都要修。
- 来源：[微信官方文档 Collection.get](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/reference-sdk-api/database/collection/Collection.get.html)、[腾讯云开发者社区笔记](https://cloud.tencent.cn/developer/article/1894026)

### P0-2 ✅ 票夹页每一张票卡都点不动（复制粘贴漏改）

- **位置**：`pages/album/album.js:274` 对比 `pages/album/album.wxml:97-98`
- **现象**：时光机页面点任意票根卡片**没有任何反应**，进不了详情。
- **根因**：`goDetail(e)` 读的是 `e.detail.id`，但 WXML 用的是**原生 `<view>`** 的 `bindtap` + `data-id`——原生事件里 `e.detail` 只有 `{x, y}`，取不到 id，于是被 `if (!id) return` 直接拦掉。
  这个写法是给 `<ticket-card>` **自定义组件**的 `triggerEvent('tap', {id})` 用的（组件里确实这么发），但 album 页早已不用该组件（`album.json` 无任何组件声明），代码是照着 wall 页抄过来的。
- **正确写法**：同项目 `pages/home/home.js:130` 是标准答案 → `const id = e.currentTarget.dataset.id;`
- **修复**：`album.js:274` 改用 `e.currentTarget.dataset.id`。

### P0-3 ✅ 可伪造支付推送，白拿付费额度

- **位置**：`cloudfunctions/saveTicket/index.js:1133-1136`（分发）、`payNotifyAction`（629-680）、`deliverOrder`（565-589）
- **现象**：任何用户用 `wx.cloud.callFunction` 直接调 `saveTicket`，把 `Event` 伪装成微信的 `xpay_goods_deliver_notify`，即可**零成本拿到任意次数的付费图版额度**。
- **为什么防不住**：
  1. `exports.main` 只按 `event.Event` 字符串分流，**没有校验调用来源**（无法区分「微信消息推送」与「客户端直调」）；
  2. 用户 openid 取自 `event.OpenId` —— **客户端可自填**（正确做法是取 `cloud.getWXContext().OPENID`）；
  3. 价格校验可绕过（商品价是公开信息，填对即可）；
  4. 归属校验 `Attach` 也是客户端传的，填自己的 openid 就过；
  5. **`Quantity` 完全由客户端控制且无上限**，`deliverOrder` 按 `产品幅数 × Quantity` 加额度，且**订单不存在时会「兜底落一笔 delivered 记录」**，连订单都不用先创建。
- **修复**：发货前必须用 `pay.queryOrderOnWx` 复核微信侧真实支付状态与金额；`Quantity` 设上限并要求本地订单存在且为 `created`；openid 一律取 `getWXContext()`。`payRefund` / `payIosRefundQuery` 同源，一并修。

### P0-4 ✅ 提审脚本指向一个未注册的页面，提审会被拒

- **位置**：`scripts/ci/audit-submit.js:19` → `address: 'pages/wall/wall'`
- **现象**：`pages/wall/` 目录存在但**未注册进 `app.json` 的 pages 数组**，提审接口填这个地址会被微信驳回（审核员点进去是空白）。
- **修复**：改成本次提审真正想展示的首页（当前应为 `pages/home/home`），并同步 `scripts/ci/preview.js:35` 的注释。
- **附带决策**：`pages/wall/**` 共约 1431 行是死代码（详见 P1-14），要么注册回去、要么删掉。

---

## 二、🟠 P1 · 功能异常

### A 组 · 导航与交互（点击无反应类）

| # | 位置 | 现象 | 修复 |
|---|---|---|---|
| P1-1 ✅ | `pages/bind/bind.js:53, 57` | **双人绑定闭环断裂**：分享卡进来接受邀请后，点「进入我们的回忆」或「先逛逛再说」**无反应**。`switchTab` 只能跳 tabBar 页，而 `duo` 不在 tabBar（只有 home/album/discover/me） | 改 `wx.navigateTo` |
| P1-2 ✅ | `pages/card/card.js:865` | 卡片导出成功后的「给卡片署个名？→ 去设置」**点了没反应**。`navigateTo` 不能跳 tab 页，而 `/pages/me/me` 是 tab 页 | 改 `wx.switchTab` |
| P1-3 ✅ | `pages/home/home.js:14-19, 40` | **首页（核心屏）对部分用户不可用**：顶部「旅行」筛选**永远筛不出东西**（全项目没有任何代码会产生 `type:'travel'`，`scan.js:16` 只允许 show/movie/traffic）；且**没有「全部」选项**、默认选中「演出」→ 只收藏电影/交通票的用户首屏永远是空态 | 去掉 travel，补「全部」并设为默认 |
| P1-4 ✅ | `pages/album/album.js:179-181` + `album.wxml` | 云库读取失败时**静默展示 8 张演示票根且无任何标注**——数据层算了 `netBar` 横幅，但 v6 改版后视图没渲染（代码注释自认「供后续接回视图用」）。违反项目 README 红线④「诚实原则：演示内容必须标注演示」 | 在 album.wxml 补横幅；`map/annual` 同样消费兜底数据且完全没做提示 |

### B 组 · 数据正确性

| # | 位置 | 现象 | 修复 |
|---|---|---|---|
| P1-5 ✅ | `pages/me/me.js:103` vs `:295-300` | **「我的」页等级/收藏天数/署名/VIP 每次进来都被清空**：`_syncV6Profile` 刚用路径写法写好 `profile.level/collectDays/signature/vip`，云端资料回包 `setData({ profile: p })` **整体覆盖**整个 profile 对象（只含 nickname/avatar） | 改按字段写入 `setData('profile.nickname'/'profile.avatar')` |
| P1-6 ✅ | `pages/scan/scan.js:252-269` | **识别失败时照片被丢掉**：`uploadFile` 已成功，但 `setData({imgFileID})` 在 `throw` 之后才执行 → 弹窗承诺「可以先收下照片」，用户点「手动填」保存后**票根无图**，同时云存储留下**孤儿文件持续计费** | 上传成功后立即写回 fileID；失败兜底也带图入库 |
| P1-7 ✅ | `utils/store.js:337-350` | **演示模式下拍照功能等于报废**：`addTicket` 演示分支硬编码 `img: ''` 且写在 `...payload` 之后，把传入的照片覆盖掉 | 演示模式把图片复制到 `USER_DATA_PATH` 后持久化路径（演示模式没有云存储，不能存 fileID） |

### C 组 · 支付与额度

| # | 位置 | 现象 | 修复 |
|---|---|---|---|
| P1-8 ✅ | `utils/pay.js:61-64, 88, 94` | **购买「次数包」可能把 App 卡死**：`callAction` 没有 try-catch，弱网/云函数异常时 `buyArtPack` 直接 reject（违背函数头「不 throw，一律返回 ok」的约定），`art.js:293-296` 的 `wx.hideLoading()` 与 `_buying = false` **永不执行** → 全屏 loading 卡住、按钮永久失效 | `callAction` 内 try-catch 返回 `{ok:false, code:'NETWORK'}` |
| P1-9 ✅ | `saveTicket/index.js:533-551` | **视频奖励日限额可被并发绕过**：`artRewardGrant` 是「读 count → 判断 → 写 count」的读-改-写，并发请求都读到 0 就都能通过 | 改原子抢占 `where({...,count:_.lt(3)}).update({count:_.inc(1)})`，`stats.updated===1` 才发奖 |
| P1-10 ✅ | `pay.js:141-161, 164-179, 188-200` + `index.js:565-589` | **额度全部读-改-写，会丢失更新**：并发下单/看视频/生图时，`paid: (q.paid||0) + n` 互相覆盖 → **用户已付费的额度可能被写少或写没**；`deliverOrder` 的幂等也是「先读状态再写」的 TOCTOU，并发会把同一笔订单发多次 | 全部改 `_.inc()` 原子自增 + 带余额条件的 where |
| P1-11 ⚠️ | `saveTicket/index.js:266-284` | **AI 生图可能永久卡住且不退额度**：生图是**在云函数里同步跑 10-60 秒**，而微信云函数超时上限 60 秒；一旦被超时杀掉，job 永远停在 `running`、额度不退，且防重入逻辑会永久挡住该票重画 | 改异步任务（任务表 + 定时触发器）；或给 job 加 `updatedAt` 超时回收（running 超 N 分钟判 failed 并退额度） |

### D 组 · 安全与合规

| # | 位置 | 现象 | 修复 |
|---|---|---|---|
| P1-12 ✅ | `cloudfunctions/saveTicket/geocode.js:15` | **腾讯位置服务 Key 明文硬编码**在源码里（`LBS_KEY = '7XKBZ-...'`），既无域名白名单也无环境变量隔离，仓库/截图/打包产物外泄即被盗刷配额 | 迁到环境变量或 config 集合；**并到 lbs.qq.com 轮换该 Key** |
| P1-13 ✅ | `saveTicket/index.js:947-953, 1015` | **邀请码可被枚举**：仅 4 位、字母表 31 个（约 92 万种），`join` 无任何频次限制，且「不存在」与「刚被别人用了」返回不同文案（存在性 oracle）→ 可脚本批量试探绑定陌生人，再通过 `duoStats(full:true)` **读取对方全量票根明细**（标题/日期/城市/场馆/座位/票价） | 码长提至 8 位 + 按 openid 限频与连续失败熔断（根因是无限频） |
| P1-14 ✅ | `pages/wall/**`（1431 行） | **死代码**：`pages/wall/` 4 个文件未注册进 `app.json`，仅被 CI 脚本引用（见 P0-4）。它与 `pages/album/` 是高度重复的复制体（约 100+ 行几乎逐行相同），且是 P0-2 那个复制粘贴错误的来源 | 确认后删除，并把 `youpiaoweizheng/**`、`scripts/**`、`*.md` 加进 `packOptions.ignore` |
| P1-15 ✅ | `pages/protocol/protocol.js:67, 132` + `pages/me/me.js:284, 316` | **对外法务文本疑似占位符残留**：备案号写作 `粤ICP备20010271号-11X`，结尾 `X` 不符合工信部备案号格式。协议页与「我的」页共 4 处对外展示 | 向运营方核对真实备案号后替换（提审前必须确认） |

### E 组 · 双模式红线（当前生产配置 `USE_CLOUD: true`，不影响线上，但违反项目自定架构红线）

| # | 位置 | 现象 |
|---|---|---|
| P1-16 ✅ | `pages/detail/detail.js:261-263` + `utils/ai.js:32` | 演示模式下「AI 写一句文案」**必然失败**：`ai.js` 没有 `USE_CLOUD` 分支，直接调未初始化的 `wx.cloud.extend.AI`；`checkText` 也没有演示分支。更糟的是报错文案写成「基础库版本过低，请升级微信」，**把用户引向错误方向** |
| P1-17 ✅ | `utils/couple.js:50` + `pages/duo/duo.js:76` | 演示模式第二次进双人页，邀请码**丢失且无法再生成**：缓存命中时 `createCode` 返回 `{bound:true}` 不带 `code`，页面显示「点这里生成」，点了却 toast「邀请码已生成」但页面上没有码 |

---

## 三、🟡 P2 · 健壮性 / 边界 / 体验

### 云函数

| # | 位置 | 问题 |
|---|---|---|
| P2-1 ⚠️ | `index.js:1225-1245, 1274` | 入库无字段白名单、无长度/大小校验：可注入任意字段、任意长度图片（含 base64）、超大文案，单文档逼近 1MB 上限；`img` 非云存储 fileID 也能入库 |
| P2-2 ✅ | `index.js:71-89` | `setCaption` 的文案**唯一没做内容安全校验**（title/note/昵称都检了），违规内容会经卡片/海报导出形成未审 UGC 展示 |
| P2-3 ✅ | `index.js:1260-1263` | `secCheck` 返回 error（平台故障）时**放行入库**，等于给违规文本留了「服务异常即通过」的旁路 |
| P2-4 ⚠️ | `index.js:87,114,...,1277`（十余处） | `catch` 把 `e.message` 原样回传前端，泄露集合名与 SDK 内部细节（335/377/924 还点出 config 集合与 `pay_secret` 字段名） |
| P2-5 ⚠️ | `pay.js:26-29` + `index.js:531-532` | `ymNow()`/`ymd` 用云函数本地时间，若运行环境 TZ 为 UTC，则免费额度月重置、视频日限额都在**北京早 8 点**才翻篇（注释宣称北京时间口径）→ 需确认运行时 TZ |
| P2-6 | `index.js:209-236` | `backfillGeo` 单次最多 200 票 × 每票串行一次 4 秒超时的 geocode，最坏 800 秒必然超时半途而废；`reorder`（96-116）逐条 await 最多 200 次 DB 往返同理 |
| P2-7 ✅ | `index.js:1065-1068` | `duoStats` 固定 `limit(500)` 静默截断，超限时 total/shows/cities 全少算且无提示 |
| P2-8 | `index.js:1250, 1268` | 入库关键路径**串行两次外部 HTTP**（geocode 4s + weather 4s），叠加 secCheck 后余量很小（历史上默认超时曾直接 -504003）。两者无依赖，应并行 |
| P2-9 | `index.js:983-1034` | `join` 只拦「已 bound」不拦「自己已有 waiting 码」，可同时属于多份 couples；两人并发 join 同一码时后写覆盖 |
| P2-10 | `pay.js:83-113` + `index.js:498-507` | `getStableToken` 无缓存，每次查单/确认先换 token；`quotaGet` 每次读额度还会对账最多 3 单 = 最多 6 次 HTTPS |
| P2-11 | `recognizeTicket/index.js:86-95` | OCR 云函数**不校验调用者、无频次限制**，脚本可刷爆免费额度并产生实付费用 |

### 页面

| # | 位置 | 问题 |
|---|---|---|
| P2-12 ✅ | `pages/map/map.js:35, 64, 71` | 坐标**只校验 `lat` 不校验 `lng`**，脏数据时 haversine 累加得 NaN → 页面显示「NaN 足迹 km」。（`utils/geo.js` 的 `totalKmOf` 两个都校验了，此处是手写降级版） |
| P2-13 ✅ | `pages/timeline/timeline.wxml:39` | `{{item.mine ? '' : 'partner'}}` 里 `item` **在该作用域不存在**（内层 `wx:for-item="it"`，外层是 `mo`）→ 所有行恒加 `partner` 类。当前 wxss 未定义 `.partner` 所以看不出，**一旦补样式全部票会被错标成「TA 的」** |
| P2-14 ⚠️ | `pages/home/home.js:55` / `pages/discover/discover.js:29` | 下拉刷新用 `wx.stopPullDownRefresh` 去关 `scroll-view` 的 refresher（**对组件无效**），且未绑 `refresher-triggered` → 下拉无反馈、状态无法收口。对照 `album.js` 的 `refreshing` 写法修正 。（**已修 2026-09-14**：discover 的 `.dc-page` 补 `height:100vh` + 绑 `refresher-triggered="{{refreshing}}"`，收口改走 setData。**home 那半是误判**——它是页面级下拉（home.json 开了 enablePullDownRefresh），`wx.stopPullDownRefresh` 正是它的标准收口。守卫：`pull_refresh` 第二·补 / 三节）
| P2-15 | `pages/art/art.js:392-397, 480`；`pages/annual/annual.js:185-187` | 画布按 dpr 放大：art 页 dpr=3 时达 3240×4320（14MP）；annual 页达 3240×5760（位图约 75MB），**超出 iOS 常用 4096 画布上限且是全局最大内存单点**，低端机可能导出失败或崩溃 。（**已修 2026-09-14**：`utils/canvas-deco.js` 新增 `safeDpr(w,h,dpr)` 统一回夹，art / annual / card 三页同源，倍数先取整再回夹。守卫：`art_repaint` 第六节真跑 + 三页源码断言）
| P2-16 | `pages/card/card.wxml:1, 50` | 取票返回前 `t=null` 且 `notFound=false`，两个分支都不渲染 → **弱网进卡片页整页白屏**（无骨架/加载态） 。（**复核即已修**：card.wxml 三分支 loading → t → notFound 齐全，`card_postcard` 第七节钉着）
| P2-17 | `pages/card/card.js:837-846` | 只校验 `_ctx` 存在就导出，未等绘制/照片就绪，首帧前点保存会导出空白图；`_canvas` 初始化失败时静默 return（用户点了没反应） 。（**已修 2026-09-14**：新增 `_waitFirstFrame()`，save 与 saveXHS 都在 `canvasToTempFilePath` 之前 await，带 3s 超时兜底。守卫：`card_postcard` 第八节）
| P2-18 | `pages/art/art.js:83, 335-344`；`scan.js:54-56, 223-228, 391-392`；`detail.js:80` | 多处 `setTimeout`/在途异步回包未做「页面存活」判断或清理，页面已销毁仍 `setData`（控制台告警），`scan` 的 900ms `navigateBack` 还会**多退一层** 。（**已修 2026-09-14**：scan 的定时器走 `_later()` 登记 + `onUnload` 统一清，在途回包由 `_scanSeq` 序号作废；detail 的退场定时器同理；art 的 `_poll` 加 `_dead` 判断（停表管不了已经发出去的那一发）。守卫：`scan_frame` 第十一节、`art_repaint` 第七节）
| P2-19 | `pages/scan/scan.js:103-118, 176-187` | 快门/相册无并发锁，连点会并起两条识别链路（重复上传、结果互相覆盖）；识别中也无取消入口与超时兜底 。（**已修 2026-09-14**：`_acquirePick()` 连点锁（快门 / 相册共用一个）；25s 没回包弹「识别有点慢」给两条出路，扫描中也有「等太久？先手动录入」。守卫：`scan_frame` 第十一节）
| P2-20 | `pages/scan/scan.js:72, 396` + `scan.wxml:124` | `saveErr` 无任何 WXML 落地（`scan.wxss:521` 的 `.shake-err` 从未被绑定）→ **保存失败的红抖动效静默失效** 。（**已修 2026-09-14**：保存按钮绑上 `shake-err`，`.shake-err` 不再是无主样式。守卫：`scan_frame` 第十一节）
| P2-21 | `pages/duo/duo.js:189-191` | 「生成双人纪念卡片」取双方最近一张票，未筛「我的」→ 若最近一条是 TA 的票，卡片页落 notFound 空态 。（**已修 2026-09-14**：`recent` 只从 `mineItems`（`t.mine`）里取；一张我的票都没有时退回时间线。守卫：`duo_bind` 第五节）
| P2-22 | `pages/report/report.js:72` | 空数据时显示 3 条 0% 空条；未知类型不计入导致占比和 < 100% 。（**已修 2026-09-14**：分母改「认得出的类型之和」，0 条的类型不占空条、known 为 0 时 `bars` 直接空数组。守卫：`report_stats` 全套）
| P2-23 | `pages/theme/theme.wxml:65` | `wx:key="hex"` 存在重复值（paper 的主色/正文同为 `#2B2420`）→ key 重复告警、列表可能漏渲染 。（**已修 2026-09-14**：`wx:key` 改 `name`。守卫：`page_refs` 第二节）
| P2-24 ⚠️ | `pages/theme/theme.wxml:31-176` | 内联 18 个 `<svg>` 标签，与项目 CHANGELOG 4.10.x「微信不能内联 svg」的既有结论冲突 → 需真机验证，可能是 24 个装饰元素全空白 。（**复核即已修**：theme 的图形早改走 `utils/deco.js` 编译的 base64 data-uri，全文件只剩注释里那一处 `<svg>` 字样）
| P2-25 | `pages/annual/annual.js:136, 266-268` | 年报同样消费兜底演示数据且无提示；只有 1 张票时「最早/最近/最贵」三张卡重复展示同一张 。（**复核即已修**：annual 已把 `flags.netFallback` 接回视图——`an-net` 横幅「这份年报用的是演示票根 · 点我重试」）
| P2-26 | `pages/me/me.js:86`；`me.js:241`；`me.js:150` | 三处**只写不渲染的死状态**：`sameOptOut`（PRD 要求的「关闭同场印记」开关不可达）、`burstId`（新勋章爆闪动效不存在）、`nickHint`（首次设昵称引导永不出现）。（**已修 2026-09-14**：同场印记开关补回设置页 + `store.setSameOptOut()`，协议路径同步为「我的-设置-同场印记」；`burstId` / `nickHint` 经核对早已在历次改版中删除。守卫：`me_setting` 第六·补节） |

---

## 四、🔵 P3 · 优化建议（择要）

> **2026-09-15 复核（7.4.2 批次开工前）**：本报告写于 9-14，之后修过四批。逐条核实后 **10 条早已不成立**（下面逐条标注）。7.4.2 只做**仍然成立、且用户能感觉到**的那几条；其余标注「为何不做」，不照单重做。

- **构建期** ✅ **已修（7.4.2）**：`packOptions.ignore` 为空 —— 实测主包 **3134 KB，超 2048 KB 上限**（`dist/` 1734KB、`tests/` 389KB、`package-lock.json` 204KB、`CHANGELOG.md` 179KB 全在包里；CI 有自己一份 excludes 所以线上没事，**开发者工具点上传/预览会直接撞上限**）。补齐后约 **1 MB**。清单**故意不含** `cloudfunctions/`（云函数根目录本就不打进小程序包，写进去反可能影响工具里的云函数右键上传）与 `templates/`（`templates/sp.wxml` 被 7 个页面 `import`，是运行时文件 —— 差一点误伤）。
- **废弃 API**：`pages/scan/scan.js:426` 仍用 `wx.getSystemInfoSync`（已有 `wx.getWindowInfo` 兜底）—— **保留**：为一个已兜底的调用动基线代码不值；`pages/map/map.js:15` `enable-poi` —— **过时**（map 页 7.0 已下线）。
- **死代码/死样式** ✅ **已修（7.4.2）**：`app.wxss` 的 v6 设计系统**已删 287 行**（46072 → 32680 字节）—— 含 `--v6-*` 整套令牌 + `.v6-*` 类（实测 61 处，全项目 wxml/js 零引用：只有 app.wxss 自己定义、自己消费）与 `.theme-blue/.theme-dream` 那 4 处覆盖（当前主题键只有 paper/glass/collage/film/literary/minimal 六套）。顺带发现 `.theme-dream .tk-hero` 引用的 `--macaron-*` **根本没定义过**，那条规则从写下的那天起就没生效。
- **主题体系混乱** 🔶 **部分已修（7.4.2）**：`--v6-*` 已随上一行删净，现在**两套令牌并存**（六主题 + legacy a/b/c）。legacy 那套**故意保留** —— `svg-icon/index.js` 与 Canvas 深色页仍认它，收敛它要逐个改 Canvas 页取色，属动视觉资产、需真机看图，不在这批顺手做。
- **重复实现** 🔶 **复核后仍成立，本轮不做**：`TYPE_TEXT` 4 份定义、城市统计/里程/类型分布 4 套近似实现、card/art 各重复约 150 行画布代码 —— 都是**纯可维护性问题，用户感觉不到**；而抽公共 util 要动 card / art / annual 三个已经跑通的页面，风险 > 收益。等真有第三个消费方再抽。
- **文档与代码漂移** ✅ **已修（7.4.2）**：README「AI 直调 hunyuan-lite」→ `hunyuan-v3`（模型 `hy3`，`cloudbase` 兜底）；「README 写 v6.3 首页 3D IP 化」—— **过时**（README 已无此表述，v6 样式也已删净）；「README 写六主题，另有 warm/blue/dream 残留」—— **已核对一致**（`utils/theme.js` 就是六套，三套残留在上面第二条里删了）。顺带修掉 README 版本号还停在 `7.1.1`、而顶部写着 7.4.x 的漂移，里程碑表补了 7.2.0 – 7.4.2 五行。
- **杂项**：`pages/me/me.js` `copyIcp` 重复定义 —— **过时**（实际只定义一处）；`pages/me/me.json` 未使用组件 —— **过时**（声明的组件都在用）；`pages/album/album.wxml:26` 顶部 🔔 死控件 —— **过时**（早改成了右侧品牌标）；`app.js` 缺 `onPageNotFound` ✅ **已修（7.4.2）**：补全局兜底 + `page_404` 埋点，老分享卡不再停白屏。

---

## 五、专项优化分析

### 1. 包体积（✅ 2026-09-15 已解决）

> **2026-09-15 复核**：下表四个「可删项」已全部消失 —— `assets/ip.png`、`images/tab-*.png` 已删，`pages/wall/` 随 7.0 下线，`youpiaoweizheng/**` 内层旧副本已随 `packOptions.ignore` 排除。**真实主包一度是 3134 KB（超上限），7.4.2 补齐排除清单后约 1 MB**，详见 §四「构建期」。仍成立但本轮不做的：`images/brand-logo.png`（142KB，album 页右侧品牌标在用，压缩要重出图 + 真机看图）、引入分包（card/art/detail/annual 移入 —— 属发布结构变更，等类目过了真机回归时一并评估）。
>
> 以下为 9-14 原始实测记录（保留备查）：

实测（排除 node_modules / .git / cloudfunctions）：

| 项目 | 体积 | 说明 |
|---|---|---|
| **整体** | **1309 KB**（不含内层旧副本）／**1872 KB**（含） | 微信主包上限 2MB |
| `assets/ip.png` | **445 KB** | ✅ **全项目零引用** —— 单项最大浪费，直接删 |
| `pages/` | 393 KB | 其中 `pages/wall/` 1431 行死代码 |
| `images/brand-logo.png` | 145 KB | 480×480 PNG，仅 3 处引用，可转 WebP 或压缩到 ~30KB |
| `images/tab-*.png` | 6 个文件 | ✅ **零引用**（tabBar 已改 custom + svg-icon），可删 |
| `youpiaoweizheng/**` | 564 KB | 内层历史旧副本，CI 已排除、工具端未排除 |

**优先级**：删 `assets/ip.png` + `tab-*.png`（省 450KB，零风险）→ 配 `packOptions.ignore` 排除旧副本/scripts/md（省 700KB）→ 压 brand-logo（省 115KB）→ 引入分包（推荐把 card/art/detail/annual 移入分包，主包只留 4 个 tab 页 + scan）。

### 2. 网络请求与云调用费用

- **无任何缓存** ✅ **已修（7.4.2）**：`store.listTickets` 加了 **30 秒 TTL 内存缓存 + 三个写操作（传票/删票/改文案）入口置脏**，切 tab 不再重走「1 次 count + 最多 25 次分批 get」。三条设计约束：置脏放函数**入口**而非成功之后（写分支多，逐个 `return` 前补一句迟早漏一个，漏掉的那个就是「传完票看不到新票」）、**只缓存成功结果**（失败兜底的演示票不进缓存，否则网络恢复了还给人看别人的票）、**返回副本**（页面原地改数组不污染缓存）。守卫：`tests/store_cache.test.js` 11 条，真跑 `store.js`。
  → 同条的另两项**仍成立，本轮不做**：`profileGet` 缓存进 globalData（收益小）、`duo` 页 `onShow` 串行 2-3 次云调用（改成并行要动双人页取数时序，风险 > 收益）。
- **对账在用户请求路径上**：`quotaGet` 每次最多触发 3 单对账（6 次 HTTPS）。→ 移到定时触发器。**仍成立，本轮不做**：属「额度读取时机」改动，按项目铁律②的精神不在这批里顺手碰。
- **入库路径串行 3 次外呼**（secCheck + geocode + weather）—— **过时**：第三批修复时已改 `Promise.all` 并行。
- **推送 token 无缓存**：按 `expires_in` 缓存 ≥10 分钟，对账从 2 次 HTTPS 降到 1 次。
- **长耗时任务**：生图、地理回填、对账都应迁到定时触发器，既避超时又省调用。

### 3. 内存

- **最大单点**：`annual.js` 画布按 dpr=3 放大到 3240×5760，位图约 75MB → dpr 上限降为 2 或按导出需要降采样。
- `card.js` 的 canvas 与 Image 引用常驻页面实例且无 `onUnload` 释放；`art.js` 画布同理。
- `wall/album` 的 `offsets/groupOffsets` 大对象在退出整理模式时未全部释放。
- 地图 markers **一张票一个 pin 无上限** —— **过时**：现已按城市聚合、上限 12 个（discover 页 7.x 改造时已做）。

### 4. 性能

- `detail.js:68-76` 打字机 **每字一次 `setData`**（40 字≈40 次），低端机掉帧 → 改 2-3 字一批或一次性渲染 + CSS 动画。
- 长列表（200 条一次性渲染）无分页、无 `onReachBottom` → 建议虚拟列表或分片渲染；收藏态等更新改用**路径 setData**（`colA[i].fav`）而非整列重算。
- `pages/album/album.js:104-127` 下拉手势**每帧 setData**，但视图无 refresher 插槽 —— **过时**：album 已补上真正的 `refresher` 插槽（`bindrefresherrefresh` / `refresher-triggered` 都在用），下拉有反馈不再是白烧。

### 5. 可维护性

- **`cloudfunctions/saveTicket/index.js` 1279 行**：建议按域拆 `actions/ticket.js`、`actions/bind.js`、`actions/art.js`、`actions/pay.js`、`actions/ops.js`，主文件只留 `ACTIONS` 映射表 + 统一 `wrap()`（鉴权→参数校验→错误包装→耗时日志），把 20+ 个 `if (event.action===...)` 平铺改成表驱动；魔法数字（3 幅/2500 字/200 条/500 条/4s/60s）抽常量区。
- **`pages/card/card.js` 975 行**：4 套绘制函数可拆 `card-draws.js`。
- **`utils/store.js`** 单文件承载 6 类职责（票根 CRUD/删除名单/文案覆盖/排序覆盖/章节顺序/列表标志），建议拆分。
- **AI 文案入口分散**在 `ai.js` + `detail.js` + `card.js`，`checkText` 靠调用方自觉（`card.js:816` 就没做）→ 建议收敛为 `captionService.generateAndSave()` 把校验和入库内聚，杜绝红线②被绕过。
- **补数据库索引**（否则全表扫描，RCU 与延迟随数据量线性恶化）：`tickets(_openid, eventKey)`、`tickets(_openid, geoSource, city)`、`couples(members)`、`couples(code, status)`、`prefs(_openid, type)`。
- **两个云函数 `wx-server-sdk` 版本不一致**：`3.0.5-beta.1`（生产用 beta）vs `~2.6.3` → 统一稳定版。

---

## 六、⚠️ 待验证清单（需真机或后台确认，勿直接改）

1. `.limit(200)` 的真实表现（报错走兜底 / 静默截断 20 条）—— 决定 P0-1 的形态
2. `duoStatsAction` 云函数端 `limit(500)` 是否触上限（官方口径 100）
3. 云函数运行时 TZ 是否为 UTC（影响额度重置口径，P2-5）
4. `pages/theme/theme.wxml` 内联 `<svg>` 在真机是否渲染（P2-24）
5. `wx.cloud.extend.AI` 在未 init 时的具体报错形态
6. `ai.js` 的 provider `hunyuan-v3`/model `hy3` 是否为当前有效模型名
7. `tickets` 集合控制台权限是否为「仅创建者可读写」（关系到客户端直删是否越权）
8. `pages/scan/scan.js:44-51` 的 `createMediaQueryObserver` 用法是否有效（该 API 疑似只支持宽高/朝向描述符，减弱动效降级可能永不生效）
9. `pages/art/art.js:252` / `utils/ads.js:67` 激励视频异常时 `_rewarding` 是否会被永久锁死
10. ICP 备案号 `-11X` 的真实正确值（P1-15，提审前必须确认）

---

## 七、修复路线图（按优先级排序）

**第 1 批 · 提审前必做（P0 + 发布阻断）**
1. 修 P0-1 数据库查询上限（含分批拉取与触顶判断）
2. 修 P0-2 票夹页点击（一行改动）
3. 修 P0-4 提审地址（一行改动）
4. 修 P1-15 备案号占位符
5. 删/注册 `pages/wall/` + 同步 CI 脚本
6. 删除 `assets/ip.png`、`images/tab-*.png`，配 `packOptions.ignore`

**第 2 批 · 上线前应做（P1 资金与安全）**
7. 修 P0-3 支付推送伪造（**资金敞口，优先级仅次于提审阻断**）
8. 修 P1-9/P1-10 额度原子化
9. 修 P1-11 生图超时回收
10. 轮换并外置 LBS Key；邀请码加长 + 限频
11. 修 P1-1~P1-7 全部「点击无反应 / 数据丢失」类

**第 3 批 · 体验与健壮性（P2）**
12. 画布 dpr 降级（art/annual）→ 解决最大内存单点
13. 全部异步存活守卫 + 定时器清理
14. 补齐云故障兜底提示（album/map/annual），守住「诚实原则」红线
15. 补数据库索引

**第 4 批 · 架构与优化（P3）** —— 2026-09-15 复核后重排

16. ⏸ **仍成立，未做**：云函数拆分 + 表驱动路由（云函数刚部署过，改了要重部署，且用户无感）；抽 `utils/canvas.js`、`utils/stats.js`（要动 card / art / annual 三个已跑通的页面，风险 > 收益）
17. 🔶 **做了一半（7.4.2）**：store 层 TTL 缓存 ✅ 已做（30 秒 + 三处写操作入口置脏）；长耗时任务迁定时触发器 ⏸ 未做（对账那条涉额度读取时机，按铁律②不顺手碰）
18. 🔶 **做了一半（7.4.2）**：清理 v6 死样式 ✅ 已做（删 287 行，省 13.4KB）；三套主题体系收敛 ⏸ 未做（legacy a/b/c 是 Canvas 页在认，属动视觉资产）；引入分包 ⏸ 未做（发布结构变更，等类目过后真机回归时一并评估）
19. ✅ **本批新增（7.4.2）**：`packOptions.ignore` 补齐（主包 3134 KB → 约 1 MB，开发者工具上传/预览不再撞 2MB 上限）+ `app.js` 补 `onPageNotFound`（老分享卡不再白屏，顺带 `page_404` 埋点）+ README 版本号与 AI 模型名漂移修正

---

*本报告为静态审查结论，标 ✅ 的条目均已二次复核，标 ⚠️ 的需先验证再动手。*

---

## 附：P0 修复状态（2026-09-11 补记）

> ⚠️ **上文 P0 标题后的 ✅ 语义是「已二次复核确认属实」，不是「已修复」**——两者混在一起容易误读，特此说明。

| # | 修复状态 | 提交 | 验证 |
|---|---|---|---|
| P0-1 数据库查询上限 | ✅ **已修复** | 见 HEALTH.md | 22 项断言全过（含反向复现旧写法只得 20 张） |
| P0-2 票夹点不动 | ✅ **已修复** | `06c5e72` | 8 项断言全过（含真实模拟原生 tap 事件跳转） |
| P0-3 伪造支付推送 | ✅ **已修复** | 见 HEALTH.md | 35 项断言全过（含反向对照：修复前一次白拿 9990 幅） |
| P0-4 提审地址 | ✅ **已修复** | 见 HEALTH.md | 已核对目标页在 `app.json` 注册表中 |

修复要点与残留风险见 `docs/HEALTH.md` 的「P0 修复记录」一节。
其中 **P0-3 尚有一项需到微信后台确认**：`saveTicket` 是否配了 HTTP 触发/云接入。

**P1 / P2 / P3 各条本轮未处理**，本文其余部分保持审查当时的原貌。

---

## 附二：P2 端上问题修复进度（2026-09-14 补记）

提交：见 `CHANGELOG.md` 7.4.0 的「发布前体检 · 端上修复」一节。**只动端上，没碰额度与支付**（铁律 2）。

| # | 问题 | 修复状态 | 改法 | 守卫（测试） |
|---|---|---|---|---|
| P2-14 | 下拉无反馈 / 收不回来 | ✅ 已修 | discover：`.dc-page` 补 `height:100vh` + 绑 `refresher-triggered`。**home 那条是误判**：页面级下拉本来就该用 `wx.stopPullDownRefresh` | `pull_refresh` 二·补 / 三节 |
| P2-15 | 画布越 iOS 4096 上限 | ✅ 已修 | `canvas-deco.safeDpr()` 三页同源，倍数先取整再回夹 | `art_repaint` 六节（真跑） |
| P2-17 | 空白卡存进相册 | ✅ 已修 | `_waitFirstFrame()`：截图前 await 首帧，3s 超时兜底 | `card_postcard` 八节 |
| P2-18 | 退了页面还在跑 | ✅ 已修 | scan 定时器登记 + `onUnload` 清 + 序号作废在途回包；detail 退场定时器；art `_poll` 加 `_dead` | `scan_frame` 十一节 / `art_repaint` 七节 |
| P2-19 | 连点并起两条识别 | ✅ 已修 | `_acquirePick()` 连点锁 + 25s 超时弹窗给出路 | `scan_frame` 十一节 |
| P2-20 | 保存失败的红抖静默失效 | ✅ 已修 | 按钮绑上 `shake-err` | `scan_frame` 十一节 |
| P2-21 | 双人卡片落到 TA 的票 | ✅ 已修 | `recent` 只从 `mineItems` 取；一张我的票都没有时退回时间线 | `duo_bind` 五节 |
| P2-22 | 空数据画 0% 空条 | ✅ 已修 | 分母改「认得出的类型之和」+ 0 条不占位 | `report_stats` 全套 |
| P2-23 | `wx:key` 重复 | ✅ 已修 | theme 色板改 `wx:key="name"` | `page_refs` 二节 |
| P2-16 / P2-24 / P2-25 | 白屏 / 内联 svg / 年报演示数据无提示 | 复核即已修 | 报告写得早，这三条在 7.2–7.4 期间已各自修掉 | 各自套里原有断言 |

**同批下半场（同日，另一次提交）：P2-26 「关闭同场印记」的 UI**

- 决定：**补 UI**（不改协议文字）——协议对外承诺过「可随时退出参与」，就把它做到。
- 改法：设置页新增「同场印记」卡 + 原生 `switch`；`utils/store.js` 补写入口 `setSameOptOut()`；开关说「参与」、存「退出」，取反只在 `onSameMark` 里做一次；「清除本地数据」的清单**不含**这个键；协议路径由「我的-同场印记」更正为「我的-设置-同场印记」。
- 守卫：`me_setting` 第六·补节（真跑存储读写往返 + 开关方向 + 清除清单 + 协议路径 ↔ 入口 ↔ 入库链路三段接得上）。
- **另外两处死状态（`burstId` / `nickHint`）经核对早已在历次改版中删除**，不是还挂着。

**仍未动（要先拍板或另开批次）**：
- **P1-11**（生图卡死后退额度）、**P2-9**（绑定并发）——**涉及额度，按铁律 2 先出设计再动手**；
- ~~P2-1 / P2-4 / P2-5 / P2-6 / P2-8 / P2-11——云端加固，随下次云函数改动一起做。~~ **已于 2026-09-15 做完，见附三**。

---

## 附三：云端加固修复进度（2026-09-15 补记）

提交：见 `CHANGELOG.md` 7.4.0 的「发布前体检 · 云端加固」一节。**只改防线，没碰额度与支付**（铁律 2）。改动落在 `saveTicket` 与 `recognizeTicket` 两个云函数——**要重新部署才生效**。

| # | 问题 | 修复状态 | 改法 | 守卫（测试） |
|---|---|---|---|---|
| P2-1 | 入库无字段白名单 | ✅ 已修 | `sanitizeTicket()`：只放行十个会填的字段并各自截断；`img` 只认本环境 `cloud://` fileID（base64 / 外链丢弃）；**丢弃不报错** | `cloud_hardening` 一节（真跑） |
| P2-2 | `setCaption` 文案没做安检 | ✅ 已修 | 改走 `secGate`，与标题 / 昵称同一条闸门 | `cloud_hardening` 二节 |
| P2-3 | 平台故障即放行（违规旁路） | ✅ 已修 | `secGate`：通过放行 / 违规拦下 / **故障重试一次**，两次都失败才拒绝并回人话。三处展示文本统一走它 | `cloud_hardening` 二节（真跑，含重试与两次失败） |
| P2-4 | `catch` 把 `e.message` 回传前端 | ✅ 已修 | 统一 `failLog(tag, e, 人话)`，17 条链路覆盖；细节只进 `console.error`。**刻意保留** payNotify / payRefund 回微信的 `ErrMsg` 与 `checkOpsToken` 的运维报错 | `cloud_hardening` 三节（全仓扫泄漏 + tag 齐备） |
| P2-5 / P2-7 / P2-10 | 时区口径 / `duoStats` 截断 / token 无缓存 | 复核即已修 | 代码里已带 `6.6.3（P2-x）` 修复注释（`bjNow()` 显式 +8h、token 缓存击穿保护），本轮未重复劳动 | 各自套里原有断言 |
| P2-6 | 回填最坏 800 秒必超时 | ✅ 已修 | 单批 200→60、批内并发 6、**同场馆共用一次 geocode**、返回值补 `more` 告知还有剩余 | `cloud_hardening` 四节 |
| P2-8 | 入库串行两次外部 HTTP | ✅ 已修 | 安检 / 场馆精化 / 天气改 `Promise.all`；「天气要坐标」用「先落城市中心、精化回来再覆盖」化解；两处失败都 `.catch(() => null)` 不拖垮入库 | `cloud_hardening` 四节 |
| P2-11 | OCR 云函数不校验调用者、无频次限制 | ✅ 已修 | ① 无 `OPENID` 一律拒（且在 `downloadFile` **之前**）；② 每人每天 30 次，条件更新原子抢占 + 固定 `_id` 建首条防并发翻倍；③ 库故障宁可放行、不谎称「次数用完了」 | `cloud_hardening` 五节（真跑配额，第 31 次被拦） |

**仍未动（要先拍板）**：
- ~~**P1-11**（生图卡死后退额度）、**P2-9**（`join` 并发 / 一人多绑定）~~ **同日做完，见附四**；
- 其余 P3 与广告接线——优化项，随 8.0.0 一并看。

---

## 附四：额度回收与绑定并发（2026-09-15 补记）

提交：见 `CHANGELOG.md` 7.4.0 的「图版卡死回收 + 双人绑定并发」一节；设计见 [PLAN-图版回收与绑定并发.md](./PLAN-图版回收与绑定并发.md)（**P1-11 涉额度，按铁律 2 先出设计并已获确认**：3 分钟判据、一律退一次、退回当初扣的那个池）。

| # | 问题 | 修复状态 | 改法 | 守卫（测试） |
|---|---|---|---|---|
| P1-11 | 生图被云函数超时杀掉 → job 永停 running、额度不退、该票再也画不出来 | ✅ 已修 | `reclaimStaleJob()`：`running` 且 `updatedAt` 早于 3 分钟 → 条件更新抢占后置 `failed` + 退额度（按 job 上记的 `pool`，老 job 无此字段走兼容反推）。触发点在轮询与重绘两处；成功回写 `done` 同时改成条件更新，堵住「既拿到图又拿回次数」 | `art_job_reclaim` 全套（真跑，含并发只退一次） |
| P2-9 | 并发输同一个码 → 后写覆盖先写，两人都以为绑上了；且一人可同时存在于两份关系 | ✅ 已修 | 绑定写入改条件更新（只有把 `waiting` 改成 `bound` 的那次算数）；加入成功后作废自己名下那条 waiting 码并在提示里说明；连点 / 重输同一个码走幂等成功 | `bind_concurrency` 全套（真跑，假库带真异步让路） |

**注**：P2-9 此前被归到「涉额度」挂起，读代码确认 `bind` 只读写 `couples` 文档、不碰额度（真正发额度的是 `refReward` 那条链），故本批直接修掉。

---

## 附五：P3 收尾与失效路径兜底（2026-09-15 补记）

**体检报告至此全部闭环。** §四 P3 开工前逐条复核，**10 条早已不成立**（见下），实际动手的是下面四条 —— 挑的都是「复核后仍然成立、且用户能感觉到」的。

| # | 问题 | 修复状态 | 改法 | 守卫（测试 / 验证） |
|---|---|---|---|---|
| 失效路径 | 老分享卡、老二维码指向 7.0 已下线的 `pages/wall` / `pages/map` → 用户点进来**停在白屏**（这一刻他本是带着兴趣点进来的，漏掉的最该接住） | ✅ 已修 | `app.js` 补 `onPageNotFound`：先记 `page_404` 埋点（「有人在传失效链接」唯一的可见迹象），再 `reLaunch` 回首页 | 埋点需在 mp 后台自定义分析里登记才收得到（同 U1） |
| P3 · 构建期 | `packOptions.ignore` 为空 → 工具端上传主包 **3134 KB，超 2048 KB 上限**（`dist/` 1734KB、`tests/` 389KB、`package-lock.json` 204KB、`CHANGELOG.md` 179KB 全在包里；CI 有自己的 excludes 所以线上没事，**只有开发者工具上传/预览会撞**） | ✅ 已修 | 补排除清单：`node_modules` / `dist` / `tests` / `scripts` / `decision-logs` / `.git` / `.gitee` / `package-lock.json` / `.env` / `*.md`。**故意不含** `cloudfunctions/`（云函数根目录本就不打进包）与 `templates/`（`sp.wxml` 被 7 个页面 `import`，是运行时文件） | 实测包体积 → 约 **1 MB** |
| P3 · 死样式 | `app.wxss` 约 261 行 v6 设计系统 + `.theme-blue/.theme-dream` 4 处覆盖，全项目零引用 | ✅ 已修 | 删 287 行（46072 → 32680 字节）。顺带发现 `.theme-dream .tk-hero` 引用的 `--macaron-*` **从未定义过**，那条规则从写下起就没生效 | 搜 `v6-` 残留 0、死主题残留 0、`.tk-hero`/`.tk-underline` 基础规则保留、花括号 162/162 配平 |
| P3 · 缓存 | 四个 tab 页 `onShow` 无条件全量 `listTickets()`（1 次 count + 最多 25 次分批 get），来回切 tab 等的是同一份数据 | ✅ 已修 | `utils/store.js` 加 30 秒 TTL + 三个写操作**入口**置脏；只缓存成功结果；返回副本。三条理由见 CHANGELOG 7.4.2 | `store_cache.test.js` 11 条（**真跑** store.js：假 wx / 假 require / 可拨动时钟），6 处反向验证逐个精准红在对应用例 |
| P3 · 文档 | README 版本号停在 `7.1.1`；AI 模型写作 `hunyuan-lite`（实为 `hunyuan-v3`）；里程碑表缺 7.2.0 之后五行 | ✅ 已修 | 逐项改对 | 人工核对 |

**复核后判定「早已不成立」的 10 条**（不重复劳动）：`pages/wall` 死代码、`pages/map` 的 `enable-poi`、`assets/ip.png`、`images/tab-*.png`、`me.json` 未使用组件、`me.js` 的 `copyIcp` 重复定义、album 下拉插槽、入库外呼串行、地图 markers 无上限、`duoStats` 的 `limit(500)`。

**复核后仍成立、本轮不做的**（各带理由，见 §四）：云函数拆分与表驱动路由、抽 `utils/canvas.js`/`utils/stats.js`、`TYPE_TEXT` 4 份合并、legacy a/b/c 主题收敛、`images/brand-logo.png` 压缩、引入分包、`quotaGet` 对账迁定时触发器（涉额度时机，铁律 2）、`profileGet` 缓存与 duo 页串行改并行。

**未验证**：真机（切 tab 的体感、失效链接是否真回首页）；`page_404` 埋点要后台登记才收得到。

---

## 附六：代码质量审计（7.4.1）修复批（2026-09-15 补记）

**背景**：7.4.1 上线后，外部跑了一份《代码质量审计-7.4.1》（审 GitHub 上的 `9f276db`，21 套测试基线）。逐条复核后**绝大多数属实**，只有 P1-1「列表无缓存」是它看不到本地已修的 7.4.2。本批落地七处，挑的都是「用户能感觉到、代码不报错」的。

**本批不涉额度写入**：七处改动均未碰扣减 / 返还逻辑（铁律 2），也未新增云函数（铁律 1）——唯一动到云函数的一行是把已有的 `SIGN_BASE_POINTS` 常量随签到视图下发，不产生任何写入。

| # | 问题 | 修复状态 | 改法 | 守卫（测试 / 验证） |
|---|---|---|---|---|
| P1-2 | `home` 每张票根各塞一个图标 data-uri，500 张约 **186 KB**，点一次分类胶囊全量过一遍 setData 桥（而图标只跟 `type` 有关） | ✅ 已修 | 编成「类型 → 兜底图标」映射表 `typeIc`（5 张 + 1 张未知兜底），列表数据从此不含图形；wxml 改 `typeIc[item.type] \|\| typeIc._` | `audit_fixes.test.js` 结构断言（wxml 引用映射表、refresh 不再写 `ico`）；**真机需看一眼票卡图标是否与改前一致** |
| P1-3 | `date.groupLabel` 无守卫 —— 空值 / 残缺日期 / 月份越界会渲染成「undefined月」；`stubDate` 全项目 0 调用方 | ✅ 已修 | 照同文件 `weekday` 的守卫补上（空串返回）；删 `stubDate` 并从导出摘除。**导出被改动带掉过一次，已补回并加防回归用例** | 7 条（含 4 类脏数据 + 月份边界）+ 1 条导出完整性；反向验证：撤守卫 → 1 红，撤导出 → 1 红 |
| P2-1 | `card` 600×960 画布按 dpr 放大后约 **53MB**、`annual` 竖版长图约 **74MB**，退出页面不释放，只能等 GC，低端机连导几张海报会闪退 | ✅ 已修 | 各加 `_releaseCanvas()`（`width = 0; height = 0` 显式释放位图，不是只丢引用），`onUnload` 调；annual 另清 `_photos` 里的 `createImage()`。**只在退出释放、不在导出后释放** —— `onShareAppMessage` 还要用同一块画布出转发图 | 2 条结构断言（必须同时置零）；反向验证：去掉 `onUnload` → 各 1 红 |
| P2-2 | 116 处 `iconSrc` 调用点无缓存，每个页面进 `onShow` 把整页图标重编一遍（500 张票根约 30–50ms） | ✅ 已修 | 模块级 `Map` 记忆化，**键带全部入参**（名 × 色 × 透明度 × 线宽 × 实心）—— 漏掉颜色就会把上一个主题的图发给新主题 | 3 条（命中数、不同色不串、不同线宽不串）；反向验证：不写缓存 → 1 红，键只剩 name → 2 红 |
| P2-3 | `setNavigationBarColor` 无论成败都记 `_lastNav` —— 页面尚未注册导航栏那一次失败，会把这套配色钉死一整个会话，之后主题换了顶部还是旧色且不再重试 | ✅ 已修 | 改成只有 `success` 才记账；失败忽略留给下次重试。代价是下次进页面多调一次 API，远小于「导航栏颜色一直错着」 | 3 条（失败后仍重试 / 成功后不重复调 / 换主题重设）；反向验证：成败都记账 → 1 红 |
| P3-2 | **删票只删记录、照片永远留在云存储** —— 用户以为删干净了，隐私政策也是这么写的 | ✅ 已修 | 删记录前先读一次拿 `img`（删完就取不到），`cloud://` 前缀的走 `wx.cloud.deleteFile`。删文件失败只 `console.warn`：留张孤儿图的代价，远小于「用户点了删除却弹报错」。**这不是优化，是承诺** | `store_cache.test.js` 新增 3 条（连图一起删 / 非 cloud 前缀不动 / 删文件失败不拦删记录）；反向验证 → 1 红 |
| P3-4 | 端上 `sign.js` 硬编码「签到 5 分」，服务端也有同一份 —— 两侧各写一个数字，只改一侧就是对用户的假承诺，且测试各测各的发现不了 | ✅ 已修 | 服务端 `signView` 随状态下发 `base`；端上删掉常量，有数字才说数字、没有就只说「有积分」（宁可少说一句，不说错一句）。**改完需部署云函数**，不部署只是文案退化、不会崩 | 3 条（有 base 说数字 / 无 base 不编数字 / 奖励文案不编数字）；反向验证：端上硬编码 5 → 2 红 |

**累计**：`npm test` **30 套 / 739 条全绿**（改动前 719）。九处反向验证**逐个精准红在对应用例上**，无一处「改坏了还全绿」。

**报告里复核后判定为误判的一条**：`pages/scan` 的「OCR 临时图识别完成即删」—— 核实后确认**上传的那张图就是最终入库的票根照片**（`store.addTicket({...f}, this.data.imgFileID)`），删了票根就没图。已写进 CHANGELOG。

**复核后仍成立、本批没做的**（各带理由）：OCR 置信度回传（要动 `recognizeTicket` 的返回结构，端上还要配套 UI）；降 DPR 上限到 2（属产品决策，影响导出清晰度）；card 与 annual 画布同驻留（**实测不成立**：`wx.switchTab` 会关闭所有非 tab 页，两者不会同时活着）；首次签到的并发（作者自认取舍，收益低）。

**没有发现新的额度 / 积分 / 签到写入问题**：本批唯一沾边的是 P3-4，方向是「把端上那份会撒谎的常量删掉」，让服务端成为唯一数字来源，与铁律 3（一律服务端结算、客户端只读）一致。
