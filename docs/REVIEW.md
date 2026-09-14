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
| P2-26 | `pages/me/me.js:86`；`me.js:241`；`me.js:150` | 三处**只写不渲染的死状态**：`sameOptOut`（PRD 要求的「关闭同场印记」开关不可达）、`burstId`（新勋章爆闪动效不存在）、`nickHint`（首次设昵称引导永不出现） |

---

## 四、🔵 P3 · 优化建议（择要）

- **构建期**：`project.config.json:3-5` 的 `packOptions.ignore` 为空，从微信开发者工具直接上传会把 `youpiaoweizheng/**`、`scripts/**`、`CHANGELOG.md`（121KB）等全打进包（CI 脚本有 ignores，工具端没有）。
- **废弃 API**：`pages/scan/scan.js:426` 仍用 `wx.getSystemInfoSync`（已有 `wx.getWindowInfo` 兜底，可接受）；`pages/map/map.js:15` `enable-poi` 已废弃。
- **死代码/死样式**：`app.wxss` 第 813-1073 行约 261 行 v6 设计系统，其中 **133 行 `.v6-*` 类选择器零引用**（`.v6-boy/.v6-dog/.v6-case/.v6-fab/.v6-func-grid` 等一整套「首页 3D IP 化」样式只落了 CSS 没落 WXML）；`app.wxss:726,745,748,758` 的 `.theme-blue/.theme-dream` 同样零引用（无任何代码产生这两个类名）。
- **主题体系混乱**：三套令牌并存——`--v6-*` 治愈系（仅 38 次引用）、六主题 `.theme-paper/glass/…`（主线）、legacy `.theme-a/b/c`（Canvas 深色页）。`svg-icon/index.js:40` 与 `ticket-card` 只认老 a/b/c，`wall.js:114` 把老键传给新系统 —— 建议老轨道收敛为只服务 Canvas 页。
- **重复实现**：`TYPE_TEXT` 存在 4 份定义；「城市统计/里程/类型分布」在 `duoData/map/report/annual` 有 4 套近似实现（map 手写里程还漏了 lng 校验）；card.js 与 art.js 各自重复实现 dpr 初始化、图片加载、`canvasToTempFilePath`、`saveImageToPhotosAlbum`+授权引导约 150 行 → 建议抽 `utils/canvas.js`、`utils/stats.js`、`utils/constants.js`。
- **文档与代码漂移**：README 写「AI 直调 hunyuan-lite」，`utils/ai.js:20-22` 实际用 `hunyuan-v3`；README 写「v6.3 首页 3D IP 化」，实际只有 CSS 没有结构；README 写「六主题」，另有 warm/blue/dream 三主题残留。
- **杂项**：`pages/me/me.js:283/315` `copyIcp` 在同一对象里重复定义两次；`pages/me/me.json` 声明了 2 个未使用的组件；`pages/album/album.wxml:26` 顶部 🔔 是无事件的死控件；`app.js` 缺 `onPageNotFound` 兜底（遇到失效路径只会白屏）。

---

## 五、专项优化分析

### 1. 包体积（⚠️ 当前主包已逼近 2MB 上限）

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

- **无任何缓存**：四个 tab 页 `onShow` 无条件全量 `listTickets()`，来回切 tab 反复打云库；`duo` 页 `onShow` 串行发 2-3 次云调用；`report`/`annual` 每次 `onShow` 各调一次 `profileGet`。
  → **建议**：`store.listTickets` 加 5-30 秒 TTL 内存缓存 + 写操作置脏；profile 缓存进 globalData。可把切 tab 的请求量降到接近 0。
- **对账在用户请求路径上**：`quotaGet` 每次最多触发 3 单对账（6 次 HTTPS）。→ 移到定时触发器。
- **入库路径串行 3 次外呼**（secCheck + geocode + weather）：geocode 与 weather 改 `Promise.all` 并行，weather 改入库后异步补写 → 尾延迟从约 8s 降到约 4s。
- **推送 token 无缓存**：按 `expires_in` 缓存 ≥10 分钟，对账从 2 次 HTTPS 降到 1 次。
- **长耗时任务**：生图、地理回填、对账都应迁到定时触发器，既避超时又省调用。

### 3. 内存

- **最大单点**：`annual.js` 画布按 dpr=3 放大到 3240×5760，位图约 75MB → dpr 上限降为 2 或按导出需要降采样。
- `card.js` 的 canvas 与 Image 引用常驻页面实例且无 `onUnload` 释放；`art.js` 画布同理。
- `wall/album` 的 `offsets/groupOffsets` 大对象在退出整理模式时未全部释放。
- 地图 markers **一张票一个 pin 无上限**，上百张时地图卡顿 → 超阈值按城市聚合。

### 4. 性能

- `detail.js:68-76` 打字机 **每字一次 `setData`**（40 字≈40 次），低端机掉帧 → 改 2-3 字一批或一次性渲染 + CSS 动画。
- 长列表（200 条一次性渲染）无分页、无 `onReachBottom` → 建议虚拟列表或分片渲染；收藏态等更新改用**路径 setData**（`colA[i].fav`）而非整列重算。
- `pages/album/album.js:104-127` 下拉手势**每帧 setData**，但视图无 refresher 插槽 → 纯属白烧，删掉或补插槽。

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

**第 4 批 · 架构与优化（P3）**
16. 云函数拆分 + 表驱动路由；抽 `utils/canvas.js`、`utils/stats.js`
17. store 层加 TTL 缓存；长耗时任务迁定时触发器
18. 引入分包；清理 v6 死样式与三套主题体系收敛

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

**仍未动（要先拍板或另开批次）**：
- **P1-11**（生图卡死后退额度）、**P2-9 / P2-10**（绑定并发、token 无缓存）——**涉及额度，按铁律 2 先出设计再动手**；
- **P2-26**（`sameOptOut` 等三处只写不渲染的死状态）——「关闭同场印记」开关是 `protocol.js` 对外承诺过的可退出项，**要么补 UI 要么改协议文本**，属产品决定，等确认；
- P2-1 / P2-4 / P2-5 / P2-6 / P2-8 / P2-11 与其余 P3——云端加固，随下次云函数改动一起做。
