# 有票为证 v4.22.4 · 代码BUG审查报告

> **审查日期：** 2026-09-09
> **审查版本：** v4.22.4
> **审查范围：** 7个核心页面JS + saveTicket云函数 + 7个工具函数
> **审查方式：** 静态代码审查（未覆盖真机运行时验证）

---

## 一、概览

| 严重程度 | 数量 | 说明 |
|---------|------|------|
| 🔴 P0 高危 | 3 | 影响核心功能正确性，上线前必须修复 |
| 🟡 P1 中危 | 5 | 边界情况或体验问题，建议尽快修复 |
| 🔵 P2 低危/优化 | 4 | 代码质量优化项，不影响功能 |
| **合计** | **12** | |

---

## 二、P0 高危（3个）

### ① 分享落地错误 fallback 到自己的票根

| 项目 | 内容 |
|------|------|
| **文件** | `pages/card/card.js` |
| **行号** | 第631行 |
| **类型** | 逻辑错误 |
| **严重程度** | 🔴 P0 |

**问题描述：**

```js
t = (await store.getTicket(options.id)) || (await store.listTickets())[0];
```

当 `getTicket(id)` 返回 null（票根不存在）时，代码自动 fallback 到 `listTickets()[0]`（用户自己的第一张票根），导致：

**触发条件：**
- 好友点击分享卡片打开 card 页（云库「仅创建者可读写」，好友读不到别人的票根）
- 票根 id 已过期或无效
- 用户从详情页跳转时 id 丢失

**影响：**
- 用户看到的是错误的票根内容（自己的票而非分享的票）
- 同场角标、海报文案全部错误
- 用户可能误以为数据丢失或功能故障

**修复方案：**

将 fallback 改为空态，不要自动跳自己的票：

```js
if (!t) {
  this.setData({ notFound: true });
  return;
}
```

---

### ② 双人卡片未传 id，显示错误票根

| 项目 | 内容 |
|------|------|
| **文件** | `pages/duo/duo.js` |
| **行号** | 第186行 |
| **类型** | 功能错误 |
| **严重程度** | 🔴 P0 |

**问题描述：**

```js
goDuoCard() {
  wx.navigateTo({ url: '/pages/card/card' }); // 未传 id
}
```

从双人空间点击「双人卡片」按钮时，跳转 card 页未传票根 id，card 页通过 P0-① 的 fallback 逻辑显示用户自己的第一张票根，而非双人共同票根。

**触发条件：**
- 双人空间已绑定后
- 点击「双人卡片」按钮

**影响：**
- 与「双人卡片」的产品预期严重不符
- 卡片上的双人头像徽章虽然会画，但票根本体是错的

**修复方案：**

传入最近一条共同票根的 id，或跳转到双人时间线页：

```js
goDuoCard() {
  const recent = this.data.stats && this.data.stats.recent && this.data.stats.recent[0];
  if (recent) {
    wx.navigateTo({ url: `/pages/card/card?id=${recent.id}` });
  } else {
    wx.navigateTo({ url: '/pages/timeline/timeline' });
  }
}
```

---

### ③ 异常日期显示「周undefined」

| 项目 | 内容 |
|------|------|
| **文件** | `utils/date.js` |
| **行号** | 第17-20行 |
| **类型** | 界面显示异常 |
| **严重程度** | 🔴 P0 |

**问题描述：**

```js
function weekday(dateStr) {
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  return `周${days[new Date(dateStr.replace(/-/g, '/')).getDay()]}`;
}
```

当日期为空、格式不完整或异常时：
- `new Date(Invalid Date)` 返回 `Invalid Date`
- `.getDay()` 返回 `NaN`
- `days[NaN]` 为 `undefined`
- 最终显示「周undefined」

**触发条件：**
- 票根日期为空字符串
- 日期格式不完整（如 `2025-10`）
- OCR 识别出异常日期格式

**影响：**
- 票根卡片界面显示乱码
- 降低产品专业感

**修复方案：**

加守卫，异常日期返回空字符串：

```js
function weekday(dateStr) {
  if (!dateStr || dateStr.length < 10) return '';
  const d = new Date(dateStr.replace(/-/g, '/'));
  if (isNaN(d.getDay())) return '';
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  return `周${days[d.getDay()]}`;
}
```

---

## 三、P1 中危（5个）

### ④ 图版编号可能显示「Plate No.00」

| 项目 | 内容 |
|------|------|
| **文件** | `pages/art/art.js` |
| **行号** | 第155行 |
| **类型** | 显示错误 |
| **严重程度** | 🟡 P1 |

**问题描述：**

```js
const no = this.data.plateNo || this._plateNo(false);
```

`plateNo` 初始值为 0，`0 || _plateNo(false)` 会走右侧。如果全局编号也为 0（首次未累加），最终显示「Plate No.00」而非「Plate No.01」。

**触发条件：** 用户生成第一幅图版时

**修复方案：** `_plateNo` 累加后返回值应为 1 起步，或显示时 `String(no).padStart(2, '0')` 前确保 no ≥ 1。

---

### ⑤ 票价输入空格被存为「0」

| 项目 | 内容 |
|------|------|
| **文件** | `pages/scan/scan.js` |
| **行号** | 第230行 |
| **类型** | 数据错误 |
| **严重程度** | 🟡 P1 |

**问题描述：**

```js
this.setData({ 'form.price': res.content && !isNaN(n) ? String(n) : '' });
```

用户输入空格时：
- `Number(' ')` = `0`
- `!isNaN(0)` = `true`
- 结果：票价被存为 `"0"` 而非空

**触发条件：** 编辑票价字段时输入空格或仅空格

**修复方案：** 先 trim 再判断：

```js
const trimmed = (res.content || '').trim();
const n = Number(trimmed);
this.setData({ 'form.price': trimmed && !isNaN(n) ? String(n) : '' });
```

---

### ⑥ 支付轮询窗口偏短

| 项目 | 内容 |
|------|------|
| **文件** | `utils/pay.js` |
| **行号** | 第144-159行 |
| **类型** | 体验问题 |
| **严重程度** | 🟡 P1 |

**问题描述：**

支付后轮询 8 次，总时长约 11 秒（600ms + 7×1500ms）。微信发货推送延迟超过此时长时，前端返回 `pending: true`，用户看到「到账稍有延迟」提示。

**触发条件：** 支付成功但微信发货推送延迟（弱网/服务器繁忙）

**影响：** 用户有短时焦虑感，但云函数幂等发货兜底，最终会到账。

**修复方案：** 可考虑增加轮询次数至 12-15 次，或延长间隔至 2 秒。

---

### ⑦ adsNativeId 未在 data 初始化

| 项目 | 内容 |
|------|------|
| **文件** | `pages/wall/wall.js` |
| **行号** | 第108行 |
| **类型** | 潜在风险 |
| **严重程度** | 🟡 P1 |

**问题描述：**

```js
onLoad() {
  this.setData({ adsNativeId: ads.NATIVE_WALL_ID });
}
```

`adsNativeId` 在 `data` 中没有初始值，首次渲染时 WXML 引用为 `undefined`。虽然 `onLoad` 在渲染前执行，实际影响极小，但不符合数据初始化规范。

**修复方案：** 在 `data` 中添加初始值 `adsNativeId: ''`。

---

### ⑧ ai.js 函数内重复 require

| 项目 | 内容 |
|------|------|
| **文件** | `utils/ai.js` |
| **行号** | 第156行 |
| **类型** | 代码质量 |
| **严重程度** | 🟡 P1 |

**问题描述：**

```js
async function generateCaption(t, style, anniv) {
  const { weatherHint } = require('./weather.js'); // 函数内部 require
  // ...
}
```

每次调用 `generateCaption` 都执行一次 `require('./weather.js')`。虽然 Node 的 require 有缓存，但这是不好的实践，应提到文件顶部。

**修复方案：** 移到文件顶部：

```js
const { weatherHint } = require('./weather.js');
```

---

## 四、P2 低危/优化（4个）

### ⑨ goTimeline 函数名误导

| 项目 | 内容 |
|------|------|
| **文件** | `pages/duo/duo.js` |
| **行号** | 第190行 |
| **类型** | 代码可读性 |
| **严重程度** | 🔵 P2 |

**问题描述：** 函数名 `goTimeline` 但实际 `navigateTo` 到 `detail` 页（最近共同时光的详情），容易误导后续维护。

**修复方案：** 改名为 `goRecentDetail`。

---

### ⑩ _savedNick 初始化逻辑冗余

| 项目 | 内容 |
|------|------|
| **文件** | `pages/me/me.js` |
| **行号** | 第144行 |
| **类型** | 代码冗余 |
| **严重程度** | 🔵 P2 |

**问题描述：**

```js
onNickInput(e) {
  this._savedNick = this._savedNick === undefined ? this.data.profile.nickname : this._savedNick;
  // ...
}
```

`onNickFocus` 中已经设置了 `_savedNick`，`onNickInput` 中的初始化分支永远不会走到，属于冗余代码。

**修复方案：** 移除 `onNickInput` 中的 `_savedNick` 初始化行。

---

### ⑪ 云模式前端排序性能

| 项目 | 内容 |
|------|------|
| **文件** | `utils/store.js` |
| **行号** | 第274行 |
| **类型** | 性能优化 |
| **严重程度** | 🔵 P2 |

**问题描述：** 云查询取 200 条后在前端用 `sort(byOrder)` 排序。当前 200 条限制下性能无影响，但未来数据量增大时建议改为云数据库索引排序。

**修复方案：** 未来优化，当前可接受。

---

### ⑫ T5 引导每次 onShow 读写 storage

| 项目 | 内容 |
|------|------|
| **文件** | `pages/wall/wall.js` |
| **行号** | 第211-220行 |
| **类型** | 性能优化 |
| **严重程度** | 🔵 P2 |

**问题描述：** `_maybeT5` 每次 `onShow` 都读写 `sp_t5_asked` storage。虽然 storage 读写很快，但每次都读可以加内存缓存。

**修复方案：** 用模块级变量缓存，仅首次读取 storage。

---

## 五、修复优先级建议

### 上线前必须修（P0）

| # | BUG | 修复方案 | 预计工时 |
|---|-----|---------|---------|
| ① | card 页分享 fallback | 把 `|| listTickets()[0]` 改为 `notFound=true` 空态 | 5分钟 |
| ② | duo 页 goDuoCard 未传 id | 传入最近共同票根 id，或跳时间线页 | 10分钟 |
| ③ | weekday 异常日期 | 加 `isNaN` 守卫，异常返回空串 | 2分钟 |
| | **小计** | | **~17分钟** |

### 本周内修（P1）

| # | BUG | 修复方案 | 预计工时 |
|---|-----|---------|---------|
| ④ | 图版编号 00 | 确保 plateNo 从 1 开始 | 5分钟 |
| ⑤ | 票价空格存 0 | trim 后再判断数字 | 5分钟 |
| ⑥ | 支付轮询窗口 | 延长轮询次数或间隔 | 10分钟 |
| ⑦ | adsNativeId 初始化 | data 中加初始值 | 1分钟 |
| ⑧ | 函数内 require | 移到文件顶部 | 1分钟 |
| | **小计** | | **~22分钟** |

### 后续迭代优化（P2）

| # | BUG | 说明 |
|---|-----|------|
| ⑨ | 函数名误导 | 改名即可，不影响功能 |
| ⑩ | 冗余逻辑 | 清理代码 |
| ⑪ | 前端排序 | 数据量大时再优化 |
| ⑫ | storage 缓存 | 微优化，不急 |

---

## 六、审查说明

### 已覆盖范围
- ✅ 7个核心页面JS：wall / scan / detail / card / art / me / duo / map
- ✅ 主云函数：saveTicket/index.js（action路由层）
- ✅ 7个工具函数：store / pay / ads / ai / date / couple / weather（部分）

### 未覆盖范围
- ❌ WXML / WXSS 渲染层（界面布局、样式适配）
- ❌ 云函数子模块内部逻辑（artRestyle.js / pay.js / weather.js / geocode.js 等）
- ❌ 真机运行时验证（需真机测试）
- ❌ 网络异常/弱网/并发等边界场景
- ❌ 性能压测

### 建议
1. **P0 修复后真机回归测试**，重点验证：
   - 分享卡片打开 card 页的空态表现
   - 双人空间「双人卡片」按钮
   - 异常日期的票根卡片显示
2. P1 修复后走一遍核心流程（上传→识别→保存→卡片→双人）
3. 提审前建议做一轮完整的真机验收

---

*本报告由静态代码审查生成，实际行为请以真机测试为准。*
