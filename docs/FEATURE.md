# 有票为证 · 功能清单（FEATURE）

> **版本对齐**：小程序 `7.1.0` ｜ **日期**：2026-09-12
> **本文件管什么**：**每个功能现在到底有没有、入口在哪、落在哪些文件、有哪些已知限制。** 编号与 [PRD.md](./PRD.md) 的 FR-* 一一对应。
> **不管什么**：需求为什么这么做见 PRD；字段与接口细节见 [SDD.md](./SDD.md)；怎么测见 [TEST.md](./TEST.md)。
> **状态图例**：✅ 可用 ｜ 🔶 部分完成 ｜ ⬜ 未建 ｜ 🔴 **有界面/有代码但实际不可用**（最需要留意的一类）

**总览**：PRD 共列 47 项功能 + 合规 10 条，实测 ✅ 41 ／ 🔶 3 ／ ⬜ 3 ／ 🔴 0。

---

## 二、A 录入与识别（核心闭环入口）

| 编号 | 功能 | 入口 | 关键文件 | 状态与已知限制 |
|---|---|---|---|---|
| FR-A1 | 拍照录入 | 底部导航中央相机钮 → 快门 | `pages/scan`、`components/privacy-sheet` | ✅ 相机不可用有降级视图与权限引导 |
| FR-A2 | 相册导入 | `pages/scan` 左钮 | 同上 | ✅ 走同一套隐私授权 |
| FR-A3 | 自动识别 | 拍照后自动开始 | `cloudfunctions/recognizeTicket`（OCR 双通道 → `parser.js`）→ 端上 `utils/ai.js` 再解析 | ✅ 百度密钥为空时自动走微信通道，链路不断 |
| FR-A4 | 手动补录 | 识别结果页可改任意字段；识别失败直接落空表单 | `pages/scan` | ✅ |
| FR-A5 | 类型归类 | 识别后自动带出；`bottom-sheet` 里手改 | `pages/scan`、`utils/icons.js` | ✅ 可选类型只有 **演出 / 电影 / 交通** 三种（见 §十-4） |
| FR-A6 | 识别进度与失败兜底 | 拍完的四步进度；失败弹「没认出来」 | `pages/scan` | ✅ |
| FR-A7 | 入库前校验 | 确认页 | `pages/scan` | ✅ 票名与日期格式不合法不允许入档 |

## 三、B 归档与查找

| 编号 | 功能 | 入口 | 关键文件 | 状态与已知限制 |
|---|---|---|---|---|
| FR-B1 | 票根墙 | tab ① 首页 | `pages/home`、`utils/store.listTickets` | ✅ 两列齿边票根卡（邮戳 + 花 + 收藏心） |
| FR-B2 | 搜索 | 首页搜索框 → **切到 tab ② 时光机**，在那边输入关键词 | `pages/home.goSearch` → `pages/album` | ✅ 按票名 / 场馆 / 城市匹配，可与类型筛选叠加 |
| FR-B3 | 分类筛选 | 首页四个分类胶囊；时光机顶部类型筛选 | `pages/home`、`pages/album` | 🔶 「旅行」胶囊**恒为空**（见 §十-4） |
| FR-B4 | 收藏标记 | 首页卡片与详情页的心 | `fav_ids`（本地） | ✅ 主键必须是 `id`（`_id` 是历史 bug） |
| FR-B5 | 下拉刷新 | 首页 / 时光机 / 双人页的 `scroll-view` refresher | 各页 | ✅ 自定义下拉头 |
| FR-B6 | 空态与加载态 | 各列表页 | `utils/skeleton.js`、各页空态分支 | ✅ 300ms 内完成不闪骨架；空态有出路 |
| FR-B7 | 数据量兜底 | 票根很多时 | `utils/store.js` 的 `flags.cap` / `flags.netFallback` | ✅ 分批拉取（20/批，上限 500），触顶出横幅 |

## 四、C 单张票根的深加工

| 编号 | 功能 | 入口 | 关键文件 | 状态与已知限制 |
|---|---|---|---|---|
| FR-C1 | 票根详情 | 首页/时光机/地图点票根 | `pages/detail` | ✅ 照片四边齿孔白框、票面信息、照片可点开 |
| FR-C2 | AI 时光手记 | 详情页文案区，可「换一句」 | `utils/ai.generateCaption` → `setCaption` + `checkText` | ✅ 逐字显示；入库前必过内容安全 |
| FR-C3 | AI 修复 | 详情页「修复」胶囊 | `pages/detail.goRepair` | 🔴 **能力未接入**：点了只提示「AI 修复即将上线」（见 §十-1） |
| FR-C4 | 艺术重绘 | 详情页「重绘」胶囊 → `pages/art` | `utils/pay`、`utils/ads`、`artRestyle`/`artQuery` | ✅ 免费 3 幅/月 + 次数包 + 激励视频补额度 |
| FR-C5 | 纪念卡片 | 详情页「分享」→ `pages/card` | `pages/card`、`utils/canvas-deco`、`preview-card.js` | ✅ 五种卡面（默认齿边明信片），存相册与分享 |
| FR-C6 | 卡片分享语气 | — | `pages/card` | ⬜ 已下线：v5.1 的三套语气文案已收（卡片页只剩一枚「分享给好友」） |
| FR-C7 | 同场印记 | 详情页 | `eventStats` action、`utils/store.getSameOptOut` | ✅ 匿名聚合；用户可退出参与（opt-out 后不入列） |
| FR-C8 | 天气印记 | 详情页 | `cloudfunctions/saveTicket/weather.js`、`utils/weather.js` | ✅ 取不到就是空白，不造假 |
| FR-C9 | 删除票根 | 详情页 → 右上「···」更多 → 删除这张票根（二次确认） | `pages/detail`、`utils/store.removeTicket` | ✅ 7.1.1 加回；回收站仍未建（删了不可找回），照片文件留在云存储 |

## 五、D 回忆的可视化

| 编号 | 功能 | 入口 | 关键文件 | 状态与已知限制 |
|---|---|---|---|---|
| FR-D1 | 时光机 | tab ② | `pages/album` | ✅ 按**年**分组的纵向时间轴；展开/折叠、搜索、类型筛选都在本页 |
| FR-D2 | 回忆地图 | tab ③ | `pages/discover`、`utils/mapArt.js` | ✅ 水彩中国（默认）↔ 微信原生地图切换；点城市升起该城票根面板 |
| FR-D3 | 年度回忆报告 | 我的 / 详情入口 | `pages/annual`、`pages/annual/poster.js` | ✅ 统计 + 精选 + AI 结语 + 1080×1920 竖版长图 |
| FR-D4 | 月度章节 | — | `pages/album` | ⬜ 已按 v7.0 改成按年分组（稿屏8 口径），月章节不再做 |

## 六、E 关系（双人空间）

| 编号 | 功能 | 入口 | 关键文件 | 状态与已知限制 |
|---|---|---|---|---|
| FR-E1 | 邀请绑定 | 我的 → 双人空间 → 生成码 / 输码 | `pages/duo`、`pages/bind`、`utils/couple.js`、`bind` action | ✅ 4 位码（去易混字符）；分享卡片带 code 落地 |
| FR-E2 | 共同票根 | `pages/duo` 的 2×3 网格 | `utils/duoData` | ✅ |
| FR-E3 | 共同场次 / 共同城市 | 双人页胶囊、`pages/timeline`、`pages/report` | `utils/duoData.eventKeyOf` | ✅ 场次键三处同源，页面不许自己拼 |
| FR-E4 | 同行天数 | 双人页（绑定天数） | `couples.boundAt`、`utils/date.annivYears` | ✅ |
| FR-E5 | 解绑 | 双人页（已绑定态） | `bind` action 的 `unbind` | ✅ 二次确认后才解 |

## 七、F 个人中心与设置

| 编号 | 功能 | 入口 | 关键文件 | 状态与已知限制 |
|---|---|---|---|---|
| FR-F1 | 头像与昵称 | 我的 → 头像卡 | `profileGet/Save/Clear`、`prefs.user_profile` | ✅ 昵称走内容安全；可清除 |
| FR-F2 | 个人统计 | 我的 → 票根造型统计卡 | `pages/me`、`utils/store` | ✅ 张数 / 城市 / 回忆段数 |
| FR-F3 | 外观主题 | 我的 → 主题（或设置页） | `pages/theme`、`utils/theme.js`、`custom-tab-bar` | ✅ 六套即点即换，底部导航跟随 |
| FR-F4 | 勋章墙 | 我的 → 设置 → 勋章墙 | `pages/setting`、`utils/badges.js`、`utils/mock.js` | ✅ 13 枚；「足迹地图」要求进过地图且点亮 3 城 |
| FR-F5 | 我的收藏夹 | 我的 → 收藏 | `pages/home`（`fav_ids`） | 🔶 入口回到票根墙，没有独立列表页 |
| FR-F6 | 设置与协议 | 我的 → 设置 / 协议页 | `pages/setting`、`pages/protocol` | ✅ 隐私政策与用户协议为正式文本 |
| FR-F7 | 备案号展示 | 我的页底部 & 设置页，点击复制 | `pages/me`、`pages/setting`、`pages/protocol` | ✅ 粤ICP备20010271号-11X |
| FR-F8 | 数据统计 | 我的 → 数据统计 | `pages/me` | 🔶 入口在，视图为现有统计卡复用，未单开明细 |

## 八、商业化（CM）

| 编号 | 功能 | 入口 | 关键文件 | 状态与已知限制 |
|---|---|---|---|---|
| CM-1 | 次数包 | 重绘画框内额度不足时 | `utils/pay.buyArtPack`、`payCreate/payConfirm/quotaGet`、`prefs` | ✅ ¥6 / 10 幅；服务端权威记账、回查微信订单后发货 |
| CM-2 | 激励视频换额度 | 额度用完时 | `utils/ads.showRewarded`、`artRewardGrant` | 🔶 代码就绪，**广告位 ID 还是空的**（`ads.js`），每日上限 3 次 |
| CM-3 | 详情页广告位 | 详情页底部 | `utils/ads.BANNER_DETAIL_ID` | 🔶 代码就绪，广告位未开通（未配置时整体隐藏） |
| CM-4 / CM-5 | 会员订阅 / 实体周边 | — | — | ⬜ 待规划（PRD 明确不阻塞首版） |

## 九、怎么验（功能 ↔ 测试套件对照）

| 功能 | 自动化 | 真机 |
|---|---|---|
| A 录入与识别 | `scan_frame`（36 条） | 授权弹窗文案、真实识别率 |
| B 归档与查找 | `home_wall`（35）、`album_timemachine`（38） | 长列表滚动、弱网横幅 |
| C1/C2 详情与手记 | `detail_icons`（19） | 打字机效果、照片放大 |
| C3 AI 修复 | — | 目前只有「即将上线」提示 |
| C4 重绘 | `art_repaint`（26） | 三种作画状态、付费墙 |
| C5 卡片 | `card_postcard`（29，真跑渲染） | 五种卡面、存相册、分享 |
| D1 时光机 | `album_timemachine`（38） | 年份节点、邮戳字形 |
| D2 回忆地图 | `discover_map`（39，真跑投影） | **原生地图手势与滚动冲突**（重点） |
| D3 年报 | `annual_report`（36，真跑海报） | 长图存相册 |
| E 双人 | `duo_bind`（37） | 绑定全流程走两遍（两个号） |
| F 我的 / 设置 / 勋章 | `me_setting`（28）、`page_refs`（3） | 勋章点亮、六主题各切一遍 |
| 商业化 | —（**支付无自动化**） | 沙箱下单、额度到账、掉单自愈 |

## 十、文档与实际不符（本清单已按代码更正，PRD/其他文档待同步）

1. **FR-C3 AI 修复**：PRD 标 ✅，实际只有入口 + 「AI 修复即将上线」提示（`pages/detail/detail.js:231`）。
2. **FR-C6 卡片分享语气**：PRD 标 🔶，实际已下线（`pages/card/card.js:1220` 注释：v5.1 的三套文案已收）。
3. ~~**FR-C9 删除**：界面无入口、隐私政策却写着「左滑删除」~~ → **7.1.1 已修**：详情页「···」更多 → 删除这张票根（二次确认，云/演示双模式），协议文案同步写清实际路径，并加了回归断言防止再次出现「文案承诺了不存在的能力」。
4. **首页「旅行」分类恒为空**：分类胶囊有「旅行」，但入库时服务端类型白名单只有 `show / movie / traffic`（`saveTicket/index.js`），识别端也不产出 `travel` → 点这颗胶囊永远是空的（`docs/HEALTH.md` §3 已记过）。
5. **邀请码「7 天过期」**：README 数据模型写了，代码里没有这个逻辑（码一直可用到绑定成功），已在 [SDD.md](./SDD.md) §2.2 更正。

## 十一、维护约定

- 新增功能：先在 [PRD.md](./PRD.md) 立项拿编号（延续 A–F 或新开组），实现后回来补本表一行（入口 / 文件 / 状态）；
- 下线功能：本表状态改 ⬜ 并写清「什么时候、因为什么下线」，**顺手清掉遗留入口与文案**（§十-3 就是没清干净的反例）；
- 本表与 PRD 的「现状」列不一致时，**以本表为准**（本表按代码核对），同时回改 PRD。

---

*本文档由代码现状逐项核对生成；功能有增删时同步更新本表与 PRD 的现状列。*
