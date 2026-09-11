# 有票为证 · 微信小程序

> 2026-09-05 更名：因「拾光」已被注册为商标（备案驳回），产品由「拾光票根」更名为「有票为证」；slogan 沿用「让时光有票为证」，卡面落款用「有票为证 · 让时光有迹可循」。代码与《04-有票为证-视觉设计系统V2.md》已同步。

> 纸质票根数字化珍藏 —— 拍下票根，AI 帮你识别、存档、写文案、做卡片。**让时光有票为证。**

**当前版本：`6.3.0`（v6.2 三主题系统 warm/blue/dream · v6.3 首页 3D IP 化：小熊渔夫帽男孩怀抱粉票根 + 云朵绿植暖光场景 + 品牌 logo 区 + 四入口「票夹本/分类/地图足迹/回忆日历」带数量角标）** · 变更史见 [CHANGELOG.md](./CHANGELOG.md) · 产品全景交接见 `交接文档-给豆包.md`

## 里程碑进度

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 视觉骨架：纸质收藏册底座（撕票线+副券+条形码母题） | ✅ |
| M2 | 识别闭环：拍照 → OCR → 确认 → 入库 → 上墙（双模式数据层） | ✅ |
| M3 `3.0.0` | AI 灵魂：端上大模型解析 + AI 文案（安全校验）+ Canvas 卡片相册导出 | ✅ |
| M3.1 `3.1.0` | 原型还原补丁：海报照片区/暗色舞台/品牌头部/今日时光签/peek/勋章12枚 | ✅ |
| M3.2 `3.2.0` | 视觉三方案：A 纸质底座 + B 演出海报(午夜现场) + C 手账水彩，**四风格卡片** | ✅ |
| M4-a `4.0.0` | **双人空间**：邀请码绑定 + 合并统计 + 双人头像海报 + 勋章自动点亮 + 同场计数 | ✅ |
| M4.5-批次一 `4.1.0` | **交互层 P0**：全局按压反馈（hover-class + 震动）、三页骨架屏（300ms 防闪烁）、数字滚动（`animated-number` 组件） | ✅ |
| M4.5-批次二 `4.2.0` | **交互层 P1**：下拉弹性（scroll-view refresher 自定义下拉头）、bottom-sheet 弹出层组件（scan 类型选择 + me 关于）、detail 页 FAB（分享+卡片快捷） | ✅ |
| M4.5-批次三 `4.3.0` | **交互层 P2**：票根卡左滑（生成卡片/删除，全局单开、防误触）、**票根可删除**（store.removeTicket 双模式）、detail 照片视差滚动 | ✅ |
| M4.5-批次四 `4.4.0` | **足迹地图**（并入批次四）：map 页（markers/polyline/里程累计）+ 城市统计 chips + me 页入口 + b12 勋章联动 | ✅ |
| M4-b `4.5.0` | **双人时间线完整版**（按月分组/归属标记/同场「一起」/TA 的票行内展开）+ **我们的时光报告**（类型分布/城市 Top/里程/一起场次）+ `duoStats full` | ✅ |
| M5 `4.6.0` | **合规代码侧**：协议页（隐私/用户）+ 隐私授权弹窗（scan/card）+ 提审自查清单；资质项（ICP 备案、深度合成类目、算法备案、微信支付商户号）为用户侧行动项 | 🔶 代码完成 |
| V1.5-① `4.7.0` | **天气记忆 UI**：详情页天气印记（M2 起的存档数据上 UI）+ AI 文案融合感官细节（weatherHint） | ✅（4.8.0 起见 CHANGELOG） |

> M4.5 交互任务书评审结论（详见 `评审意见-第七节10项交互-给豆包.md`）：共享元素转场降级为两段式近似、拖拽排序砍掉（时间线母题）、wall 页 FAB 不做（tabBar 中央+是唯一主入口）、card 页风格切换保留 chip。

## 快速上手

- **演示模式（0 配置）**：微信开发者工具导入本项目即可跑。`utils/env.js` 的 `USE_CLOUD: false` 时全部功能走本地 storage + 演示数据（识别为示例数据）。
- **云模式（当前状态）**：`USE_CLOUD: true`，AppID `wx42ef98dfb4ecab23`，环境 `cloud1-d5gpnyzjw64a60ac7`。集合 `tickets`（票根）/ `couples`（绑定）由云函数 `ensureCollection` 自动创建，无需手动建。
- 体验版部署走 miniprogram-ci（脚本在 `/root/.codebuddy/artifact/ci-workspace/`；上传密钥文件**保密、勿入仓库**）。

## M5 提审清单（4.6.0 代码侧已就绪，资质项需运营推进）

**代码侧（已完成）**：协议页 `pages/protocol`（隐私/用户双模式，模板文本）、隐私授权弹窗 `components/privacy-sheet`（scan 拍照相册 / card 存相册场景，`__usePrivacyCheck__` 已开启）、AI 文案入库前 msgSecCheck（M3 起就有）。

**用户侧行动项（提审前逐项打勾）**：

1. **小程序后台配置《用户隐私保护指引》**：声明「相册（仅写入）」「摄像头」「选中的照片或视频」及用途——与 `privacy-sheet` 弹窗文案一致
2. **~~协议文本替换~~ ✅ 已完成（4.7.1）**：运营主体/联系方式/生效日期已落进协议页，如后续法务有修订意见改 `pages/protocol/protocol.js` 的 DOCS 常量即可
3. **ICP 备案**：小程序主体备案（微信平台流程，需营业执照/法人身份证）
4. **服务类目**：工具/效率类为主；因含 AI 生成文案，可能被要求「深度合成服务」相关材料或承诺函（算法备案按微信平台指引）
5. **微信支付商户号**：仅 V2 会员功能需要，不阻塞首版提审
6. **提审材料**：版本描述写清核心功能；UGC（用户上传照片+AI 文案）需说明审核机制——如实回答「接入微信内容安全 msgSecCheck，文字先审后显」

## 架构红线（改代码前必读）

1. **云函数 action 路由**：后端只有 `saveTicket`（万能路由：入库 / `checkText` 内容安全 / `bind` 绑定 / `duoStats` 双人统计 / `eventStats` 同场计数）和 `recognizeTicket`（OCR）两个云函数。**miniprogram-ci 只能更新、不能创建云函数**——新能力一律加 action，不要新建函数目录。
2. **AI 在端上调**：`utils/ai.js` 直调 `wx.cloud.extend.AI` 的 hunyuan-lite（免费免密钥）。AI 生成文案入库前**必须**过 `checkText`（msgSecCheck，违规码 87014），对外展示**必须**带「文案由 AI 生成」角标。
3. **双模式**：所有新功能必须同时支持云模式与演示模式（参考 `utils/couple.js`）。
4. **诚实原则**：不做假数据/假按钮；演示内容必须标注「演示」。
5. 每个里程碑收尾，逐屏对照 `/workspace/02-产品原型预览.html` 验收还原度。

## 目录导览

```
youpiaoweizheng/
├── app.json / app.wxss / app.js   # 入口；app.wxss 为全局设计系统（CSS 变量，为换肤预留）
├── custom-tab-bar/        # 自定义 tabBar：票根 / 中央+ / 回忆 / 我的
├── components/ticket-card/  # 票卡组件（撕票线+副券+条形码母题）
├── pages/
│   ├── wall/    ① 票根墙首页：品牌头部、时光机/今日时光签、月分组、peek 折叠
│   ├── duo/     ④ 双人空间：未绑定(邀请码) / 已绑定(∞头像+合并统计+共同时光)
│   ├── me/      ⑤ 我的：真实统计 + 12 枚勋章自动点亮 + 足迹地图入口 + 会员占位
│   ├── scan/    ② 上传识别：取景框 → 识别中 → 确认表单
│   ├── detail/  详情：票面信息、同场计数、AI 文案
│   ├── map/     足迹地图：票根地理连线、城市聚焦、里程累计（4.4.0）
│   ├── timeline/ 双人时间线完整版：按月分组、归属/同场「一起」标记（4.5.0）
│   ├── report/  我们的时光报告：类型分布、城市 Top、里程、一起场次（4.5.0）
│   ├── card/    ③ 纪念卡片：Canvas 四风格海报（经典纸感/演出海报/手账水彩/每日日签）
│   └── bind/    邀请中转页：分享卡片带 code 进入 → 确认 → 绑定
├── cloudfunctions/
│   ├── saveTicket/        ★ 万能 action 路由云函数（全部后端核心逻辑）
│   │   ├── index.js       入库 + checkText + bind + duoStats + eventStats
│   │   ├── weather.js     历史天气静默存档（Open-Meteo）
│   │   └── config.json    云调用权限（security.msgSecCheck）
│   └── recognizeTicket/   OCR 识别 + 规则解析（88 城坐标字典）
├── utils/
│   ├── env.js     ★ 云开关 + 环境 ID
│   ├── store.js   统一数据层（页面读写票根唯一入口）
│   ├── couple.js  M4 绑定端上封装（含演示模式本地兜底）
│   ├── ai.js      端上大模型：parseDraftByAI + generateCaption
│   ├── date.js    日期工具 + 今日时光签短句库
│   └── mock.js    演示数据（8 张票根）+ 勋章 12 枚定义
└── images/                # tabBar 图标
```

## 数据模型

`tickets` 集合（`saveTicket` 在服务端补 ★ 字段）：

| 字段 | 说明 |
|---|---|
| `title/type/date/time` | 票名 / 类型(show·movie·traffic) / 日期(YYYY-MM-DD) / 时间 |
| `venue/city/seat/price/source` | 场馆 / 城市 / 座位 / 票价 / 购票来源 |
| `province / geo{lat,lng}` | 省份 / 坐标（城市字典自动配对）★ |
| `img` | 票根照片（云存储 fileID） |
| `eventKey` | 同场聚合键（场馆+日期 md5）★ |
| `weather` | 当天历史天气（可为 null）★ |
| `aiCaption` | AI 纪念文案（过安全校验后入库） |
| `_openid / createdAt` | 归属用户 / 入库时间 ★ |

`couples` 集合（M4 绑定关系）：

| 字段 | 说明 |
|---|---|
| `code` | 4 位邀请码（字符集去 0O1IL，7 天过期） |
| `members` | `[openid, openid]`，waiting 时只有 1 个 |
| `names` | `{openid: 称呼}`，绑定时各自填写 |
| `status / createdAt / boundAt` | waiting→bound / 创建时间 / 绑定时间 |

本地 storage：`sp_local_tickets`（演示票根）、`sp_caption_overrides`（演示文案）、`sp_couple_cache`（绑定缓存）、`sp_share_count`（时光信使勋章计数）。

## 云开发开通（新环境才需要，15 分钟）

1. 开发者工具登录小程序账号 → 「云开发」→ 开通（按量付费免费额度）→ 复制环境 ID
2. `utils/env.js` 改两行：`USE_CLOUD = true`、`CLOUD_ENV = '你的环境ID'`
3. `project.config.json` 的 appid 换成自己的
4. `cloudfunctions/` 下两个函数分别**右键 → 上传并部署：云端安装依赖**（CI 部署见上）
5. 编译 → tabBar「+」拍票根 → 状态依次显示「上传照片中…」「AI 识别中…」→ 确认保存

常见问题：识别失败 = 云函数没部署成功或照片太糊；保存报错 = 检查环境 ID 是否填对（集合会自动创建，无需手动建）。

> 任何报错或界面不对劲，直接把截图/报错信息丢给协作 AI。
