// utils/mapArt.js —— 回忆地图「水彩中国」插画 + 经纬度投影（品牌全案 · 稿屏7）  v7.0 新增
// ============================================================
// 【这个文件解决什么问题】
//   稿屏7 的回忆地图是一张**手绘水彩中国地图**：陆地是一团团晕开的淡彩，
//   城市气泡落在各自真实的省份位置上。它要求两件事同时成立：
//     ① 色块拼出来的陆地形体得是中国，不能是随便一朵云；
//     ② 城市气泡的落点得**真的**由票根的经纬度算出来，不是手摆的。
//   只要 ① 和 ② 各写各的，改一处另一处就错位 —— 所以投影常量和陆地色块
//   共用同一组经纬度定义（REGIONS 里的 lng/lat 和城市气泡走同一个 proj()）。
//
// 【为什么是「色块」而不是一条中国轮廓线】
//   稿屏7 画的本来就不是行政边界线，是水彩晕染。硬描一条边界既不像，
//   也违背稿子的手绘气质。这里在真实经纬度上摆 12 团形变云，
//   点与点之间天然连成大陆的体量，正是稿子里的做法。
//
// 【为什么颜色写死在 JS】
//   同 utils/icons.js / utils/deco.js：产物是 <image src="data:image/svg+xml;base64,...">，
//   SVG 是独立文档，页面的 CSS 变量不会继承进去，var() 一律失效。
//   好在陆地的三色（玫瑰 / 奶油黄 / 鼠尾草绿）是**品牌固定色**，六套主题下都不变，
//   与 pages/me/me.js 的 TINT 同源 —— 变的只是承载它的卡片底色。
//
// 【用法】
//   const mapArt = require('../../utils/mapArt.js');
//   mapArt.landSrc()                      // → 水彩陆地 data-uri（固定不变）
//   mapArt.routeSrc([[lng,lat], ...])     // → 时光路线 data-uri（按数据变）
//   mapArt.stampSrc(punchColor)           // → 装饰邮票 data-uri
//   mapArt.toStage(lng, lat)              // → { x, y } 相对舞台的 rpx 落点
// ============================================================

const { toDataUri } = require('./svg.js');

// —— 陆地的三色：与 pages/me/me.js 的 TINT、app.wxss 的 --sage 同源 ——
const ROSE = '#EFA392';   // 东北 / 华北 / 华东
const BUTTER = '#F2CE7E'; // 新疆 / 内蒙 / 华南
const SAGE = '#A9C3A6';   // 青藏 / 西南 / 华中 / 海南

// ============================================================
// 一、投影：经纬度 → 视图坐标
// ============================================================
// 中国经纬度包络（大陆主体；南海诸岛离得太远，纳入会把陆地压扁）
const LNG0 = 73.4, LNG1 = 135.1; // 东经
const LAT0 = 17.8, LAT1 = 53.6;  // 北纬
// 标准纬线 35°N：横向按 cos35° 压缩，陆地才不会被拉宽
// （不压的话中国会变成一条横着的扁带，一眼假）
const STD_PARALLEL = 35;

const ART_W = 640;                                    // 插画视图框宽（用户单位）
const KX = Math.cos((STD_PARALLEL * Math.PI) / 180);  // ≈ 0.819
const S = ART_W / ((LNG1 - LNG0) * KX);               // 每「度」占多少用户单位
const MAP_H = (LAT1 - LAT0) * S;                      // 陆地本身的高度 ≈ 453
const ART_H = 620;                                    // 整幅插画高（上下留白给邮票与星点）
const MAP_TOP = (ART_H - MAP_H) / 2;                  // 陆地在插画里垂直居中

/** 经度 → 视图 x */
function projX(lng) { return (lng - LNG0) * KX * S; }
/** 纬度 → 视图 y */
function projY(lat) { return MAP_TOP + (LAT1 - lat) * S; }

// —— 舞台：小程序里这块插画的落地尺寸（rpx）——
// 因为 rpx 本身就是「屏宽/750」的比例单位，这里写死高度不会在不同机型上变形，
// 反而让 WXML 的气泡定位与 SVG 的 viewBox 严格 1:1 对应，省掉百分比换算的误差。
// 666 = 750(屏宽) − 2×24(页边距) − 2×16(卡片内边距) − 2×2(虚线内框)
const STAGE_W = 666;
const STAGE_H = Math.round((STAGE_W * ART_H) / ART_W); // 645

/**
 * 经纬度 → 舞台像素（rpx）。城市气泡、路线、陆地共用这一个函数，
 * 所以「气泡压在哪个省」永远和眼下看到的色块一致。
 * @returns {{x:number, y:number, cx:number, cy:number}} x/y 为 rpx，cx/cy 为 viewBox 坐标
 */
function toStage(lng, lat) {
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  return {
    x: round1((projX(lng) / ART_W) * STAGE_W),
    y: round1((projY(lat) / ART_H) * STAGE_H),
    cx: round1(projX(lng)),
    cy: round1(projY(lat))
  };
}

// ============================================================
// 二、陆地：先用一条简化国界框出「中国」，再把水彩色块裁进去
// ============================================================
// 为什么不能只堆色块：只堆圆块得到的是「一朵云」或「一只爪印」，
// 看不出是哪儿。国界轮廓里真正让人一眼认出中国的是三处凹口 ——
// 北缘中段被蒙古咬进去的凹陷、渤海湾、以及南端的尖角。
// 这三处丢了，颜色再对也不像。
//
// 顺时针：帕米尔 → 阿尔泰 → 漠河 → 抚远 → 辽东 → 山东 → 华南 → 藏南 → 回到帕米尔。
// 精度到「省级尺度」够用，这不是一份测绘数据，是一张插画的骨。
//
// 【为什么从 48 个点加到 96 个】（7.4.0 修）
//   48 个点连出来是一朵**云**，不是中国 —— 圆角平滑会把半岛、海湾、半岛全抹平，
//   而「一眼认得出是中国」靠的恰恰是这几处转折：
//     ① 蒙古方向那道**南北落差 12 个纬度**的大凹（阿尔泰 49°N 一路掉到 42°N 再升回漠河 53.5°N）；
//     ② 渤海湾的深 V 与山东半岛那根伸出去的角；
//     ③ 辽东半岛与雷州半岛两根朝下的刺。
//   上一版为了「不像断成两截」把渤海填成浅弧，恰恰丢掉了最容易认的那一处。
//   海岸与半岛处**点距刻意加密**：卡米尔-罗姆曲线在小步长下才拐得住急弯。
const BORDER = [
  // —— 帕米尔 → 阿尔泰（西段，中塔/中吉/中哈） ——
  [73.5, 39.4], [74.0, 40.5], [75.0, 40.5], [76.5, 41.0], [78.5, 41.4], [80.2, 42.2],
  [80.3, 43.0], [82.0, 45.0], [82.3, 45.6], [83.0, 47.2], [85.0, 47.0], [85.7, 48.4],
  [87.3, 49.2],                                                        // 友谊峰 · 西北角
  // —— 蒙古方向的大凹（北段） ——
  [90.0, 47.9], [91.0, 45.2], [93.5, 44.9], [95.5, 44.0], [96.4, 42.8], [99.0, 42.7],
  [100.0, 42.6], [104.0, 41.9], [105.0, 41.8], [109.0, 42.5], [110.0, 42.5], [111.5, 43.5],
  [112.5, 44.5], [115.0, 45.5], [117.5, 46.5], [119.5, 46.8], [119.9, 47.7], [117.4, 49.6],
  [120.7, 52.0], [122.5, 53.5],                                        // 漠河 · 最北
  // —— 东段：黑龙江 → 抚远 → 图们江 ——
  [124.5, 53.2], [125.7, 53.0], [127.5, 50.2], [130.7, 48.9], [133.0, 48.1], [134.8, 48.4],
  [134.0, 47.3], [133.0, 45.2], [131.3, 45.0], [131.2, 42.9], [130.5, 42.5], [128.0, 42.0],
  [126.5, 41.6], [124.4, 40.0],                                        // 丹东 · 鸭绿江口
  // —— 辽东半岛 → 渤海湾 → 山东半岛（最容易认的一段，点距最密） ——
  [123.0, 39.8], [121.6, 40.8], [122.1, 39.6], [121.0, 39.0], [118.9, 39.2], [117.7, 38.4],
  [118.5, 37.8], [119.3, 37.4], [120.7, 37.8], [122.7, 37.4], [121.0, 36.6], [120.3, 36.0],
  [119.2, 34.5], [121.0, 32.0], [121.9, 30.9], [122.2, 29.9], [121.6, 28.5], [120.0, 27.0],
  [119.6, 25.4], [118.1, 24.4], [116.5, 23.4], [114.2, 22.5], [113.5, 21.9], [112.0, 21.6],
  [110.4, 21.2],                                                       // 雷州半岛 · 南端
  [109.0, 21.4], [108.5, 21.6], [107.0, 21.6], [105.0, 22.9], [103.5, 22.6], [102.0, 22.4],
  [101.7, 21.2],                                                       // 西双版纳 · 最南
  [99.9, 22.0], [99.2, 22.1], [97.5, 24.0], [97.8, 25.6], [98.0, 27.5], [96.5, 28.5],
  [95.5, 29.0], [93.0, 28.3], [91.5, 27.8], [88.0, 27.3], [86.0, 27.9], [85.0, 28.3],
  [82.0, 30.3], [81.0, 30.4], [79.5, 31.2], [78.8, 31.5], [78.3, 33.0], [78.0, 35.0],
  [76.5, 36.0], [76.0, 36.5], [74.5, 37.5], [74.0, 38.5]
];

/** 海南岛：不在上面那条陆界里（它是岛），单独一圈 */
const HAINAN_RING = [
  [108.6, 19.5], [109.2, 18.4], [110.0, 18.2], [110.6, 18.7],
  [111.0, 19.6], [110.6, 20.1], [109.9, 20.1], [109.3, 19.9]
];

/** 台湾岛：同上，单独一圈。画不画它是「这张图是谁的地图」的问题，不是精度问题 */
const TAIWAN_RING = [
  [120.1, 23.0], [120.2, 22.0], [120.9, 21.9], [121.5, 22.5],
  [122.0, 24.0], [121.9, 25.1], [121.5, 25.3], [120.9, 24.7], [120.3, 23.9]
];

/**
 * 色块：中心点取各区域的地理中心，半径按纬向/经向分别给（rx, ry）并带旋转角，
 * 才能拉出「新疆又宽又扁、东北又高又斜」这类真实体量。
 * 相邻色块故意压边，重叠处颜色更深 —— 那正是水彩的积色。
 * op 是各自的浓度：后画的压住先画的，顺序即层次，别随意调换。
 */
const REGIONS = [
  // —— 底层：奶油黄，铺西北与内蒙 ——
  { lng: 84.5, lat: 40.5, rx: 118, ry: 74, rot: -8, fill: BUTTER, op: 0.46, seed: 31 }, // 新疆
  { lng: 97.0, lat: 41.0, rx: 78, ry: 46, rot: 6, fill: BUTTER, op: 0.42, seed: 33 },  // 河西走廊
  { lng: 109.0, lat: 43.0, rx: 96, ry: 46, rot: -5, fill: BUTTER, op: 0.42, seed: 35 }, // 内蒙
  { lng: 113.0, lat: 24.5, rx: 76, ry: 56, rot: -24, fill: BUTTER, op: 0.44, seed: 51 },// 华南
  // —— 中层：鼠尾草绿，铺青藏与西南 ——
  { lng: 88.0, lat: 32.5, rx: 108, ry: 62, rot: 4, fill: SAGE, op: 0.46, seed: 41 },    // 青藏
  { lng: 101.5, lat: 27.5, rx: 90, ry: 60, rot: -16, fill: SAGE, op: 0.44, seed: 43 },  // 西南
  { lng: 112.0, lat: 30.0, rx: 80, ry: 56, rot: 10, fill: SAGE, op: 0.38, seed: 45 },   // 华中
  // —— 上层：玫瑰，铺东北与华北 ——
  { lng: 126.0, lat: 46.0, rx: 58, ry: 72, rot: 16, fill: ROSE, op: 0.46, seed: 11 },   // 东北
  { lng: 121.0, lat: 41.5, rx: 50, ry: 42, rot: 0, fill: ROSE, op: 0.38, seed: 13 },    // 辽吉
  { lng: 114.5, lat: 36.5, rx: 74, ry: 56, rot: -12, fill: ROSE, op: 0.44, seed: 21 },  // 华北
  { lng: 120.0, lat: 30.5, rx: 56, ry: 50, rot: 0, fill: ROSE, op: 0.36, seed: 23 }     // 华东
];

/** 海南那颗小色块（岛，不在陆界里，故按岛自己的路径裁） */
const HAINAN = { lng: 109.8, lat: 19.2, rx: 26, ry: 18, rot: 12, fill: SAGE, op: 0.42, seed: 47 };
/** 台湾那颗（同上）。比海南细长，故 rx/ry 反着给 */
const TAIWAN = { lng: 121.0, lat: 23.7, rx: 18, ry: 30, rot: -6, fill: SAGE, op: 0.42, seed: 53 };

/** 纸浆色兜底（主题缺 soft 时用）——暖米白 */
const PULP_FALLBACK = '#F7E9D2';
/**
 * 外晕：沿国界往外描几道由粗到细的淡边，做「水在纸上化开」（SVG 滤镜在小程序
 * image 里不保证支持，只能拿描边冒充）。
 * ⚠️ 上一版这里给到 30 宽，晕得比国界本身还显眼 —— 形状就是被这圈糊掉的。
 *    外晕只该是「收边」，交代陆地在哪儿的是下面那道**内沿**。
 */
const BLEED = [
  { w: 13, op: 0.5 },
  { w: 6, op: 1 }
];
/**
 * 内沿：水彩真正画完时，颜料会被水推到边沿积成一道更深的圈（边缘沉积），
 * 这才是「一眼看出这是块陆地」的东西。所以它必须裁在国界**里面**，
 * 且用比纸浆更深/更浅的色（深色主题上反过来）。
 */
const RIM = [
  { w: 34, op: 0.18 },
  { w: 14, op: 0.32 }
];

/** mulberry32：确定性伪随机 —— 同一个 seed 永远长出同一朵云 */
function rng(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = (p) => round1(p[0]) + ' ' + round1(p[1]);

/**
 * 卡米尔-罗姆样条：把一串折点连成**过每一点**的平滑闭合曲线。
 * 为什么不直接用折线：48 个控制点连折线会得到一圈 48 边形，棱角分明，不是手绘。
 * 也不直接上贝塞尔拟合：那样曲线不经过原点，凹口会被抹平 —— 凹口正是要保的东西。
 */
function smoothClosed(pts) {
  const n = pts.length;
  const get = (i) => pts[(i + n) % n];
  let d = 'M' + at(get(0));
  for (let i = 0; i < n; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += 'C' + at(c1) + ' ' + at(c2) + ' ' + at(p2);
  }
  return d + 'Z';
}

/**
 * 一串经纬度 → 视图坐标的平滑闭合路径。
 * 手抖只剩 ±0.9：原先的 ±2.2 是画在 48 点上的，那时点稀、抖一点才像手绘；
 * 现在点密了，同样幅度会把渤海湾、辽东半岛这些小转折抖没 ——
 * 手绘感该来自**色块的晕染**，不该来自把地图形状抖糊。
 */
function ringPath(ring, seed) {
  const rand = rng(seed);
  return smoothClosed(ring.map(([lng, lat]) =>
    [projX(lng) + (rand() * 2 - 1) * 0.9, projY(lat) + (rand() * 2 - 1) * 0.9]));
}

/** 中国国界 → 视图坐标路径 */
function borderPath() {
  return ringPath(BORDER, 20240907);
}

/**
 * 一团手绘水彩的闭合路径：椭圆环上取 n 个点，半径起伏 ±wob，
 * 再用「中点二次贝塞尔」连成平滑曲线（这样起点天然落在两点之间，收尾无缝）。
 */
function blobPath(cx, cy, reg, k, seed) {
  const rand = rng(seed);
  const n = 12;
  const cos = Math.cos(reg.rot * Math.PI / 180);
  const sin = Math.sin(reg.rot * Math.PI / 180);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const j = 1 + (rand() * 2 - 1) * 0.16;
    const ex = Math.cos(a) * reg.rx * k * j;
    const ey = Math.sin(a) * reg.ry * k * j;
    pts.push([cx + ex * cos - ey * sin, cy + ex * sin + ey * cos]);
  }
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  let d = 'M' + at(mid(pts[n - 1], pts[0]));
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    d += 'Q' + at(p) + ' ' + at(mid(p, pts[(i + 1) % n]));
  }
  return d + 'Z';
}

/**
 * 一团区域 → 两层晕：外圈大而淡、内圈小而浓，边界于是「化」开而不是一刀切。
 */
function regionSvg(reg) {
  const cx = projX(reg.lng);
  const cy = projY(reg.lat);
  return [[1.16, 0.45], [0.88, 1]].map(([k, mul], i) =>
    "<path d='" + blobPath(cx, cy, reg, k, reg.seed + i * 7) + "'" +
    " fill='" + reg.fill + "' fill-opacity='" + round2(reg.op * mul) + "'/>"
  ).join('');
}

/**
 * 水彩陆地 → data-uri。
 * 色块本身是品牌固定色（玫瑰/奶油黄/鼠尾草绿，六主题不变），
 * 但**纸浆底色必须跟着主题走**：固定用暖米白的话，在 film 的深褐卡上
 * 会沿国界烧出一圈亮边，整块陆地像发了光。
 * 取主题的 soft 当纸浆 —— 浅色主题下是合拍的纸色，深色主题下自然隐没。
 * @param {object} theme utils/theme.js 的 THEME_META 元素（用其 soft）
 */
/**
 * 一块陆地的画法：纸浆底 → 色块 → 边沿积色（内沿裁在自己的圈里）。
 * 大陆与两座岛共用这一段，只是色块清单不同 —— 三者要是各写一遍，
 * 「调一次对比度要改三处」就是下一轮不一致的来源。
 */
function landBody(pathD, clipId, pulp, rimCol, washes) {
  const clip = "url(#" + clipId + ")";
  return "<path d='" + pathD + "' fill='" + pulp + "' fill-opacity='0.9'/>" +
    "<g clip-path='" + clip + "'>" + washes + '</g>' +
    "<g clip-path='" + clip + "'>" + RIM.map((r) =>
      "<path d='" + pathD + "' fill='none' stroke='" + rimCol + "' stroke-width='" + r.w +
      "' stroke-opacity='" + r.op + "' stroke-linejoin='round'/>"
    ).join('') + '</g>';
}

function landSrc(theme) {
  const pulp = safeColor(theme && theme.soft, PULP_FALLBACK);
  // 内沿用「纸浆的反向」：浅底上积深，深底上积浅 —— 同一句代码管六套主题。
  // 判深浅按纸浆色的亮度，不按主题 key（新增主题时不用回来补一行）。
  // 必须这样算：minimal 的 soft 是 #F5F5F5、literary 是 #E8F0E6，
  // 白卡上几乎看不见 —— 只靠底色的陆地在浅色主题下等于没画。
  const rimCol = shade(pulp, lum(pulp) > 0.55 ? -0.22 : 0.26);
  const d = borderPath();
  const base = landBody(d, 'cn', pulp, rimCol, REGIONS.map(regionSvg).join(''));
  const bleed = BLEED.map((b) =>
    "<path d='" + d + "' fill='none' stroke='" + pulp + "' stroke-width='" + b.w +
    "' stroke-opacity='" + round2(0.2 * b.op) + "' stroke-linejoin='round'/>"
  ).join('');
  // 两座岛必须画在**陆界裁剪之外**：它们的经纬度落在国界路径以外，
  // 跟着 REGIONS 一起被裁就是「写了但一个字都看不见」（旧版就是这样，
  // 海南那颗色块一直在代码里、在图上一个像素都没有）。各自带自己的裁剪圈。
  const isles = [[HAINAN_RING, HAINAN, 'hn'], [TAIWAN_RING, TAIWAN, 'tw']].map(([ring, blk, id]) => {
    const p = ringPath(ring, blk.seed);
    return "<clipPath id='" + id + "'><path d='" + p + "'/></clipPath>" +
      landBody(p, id, pulp, rimCol, regionSvg(blk));
  }).join('');
  return toUri(ART_W, ART_H, "<clipPath id='cn'><path d='" + d + "'/></clipPath>" +
    base + bleed + isles);
}

/**
 * 陆地几何 → 舞台坐标 + 已配好的颜色（8.1.0「一键成片」的长图用）。
 *
 * 【为什么要有这个出口】长图画在 `<canvas>` 上，而 `landSrc()` 产出的是 SVG
 *   data-uri —— **SVG 不能喂给 canvas**（iOS 上画不出来，安卓与开发者工具又画得出来，
 *   典型的「工具里看着好、真机空白」）。
 *   但陆地从来就是**纯数据**：`BORDER` 是 96 个经纬度点、两座岛是各自的闭合环、
 *   色块是椭圆参数。投影完 canvas 直接能画，不必再画一份 —— 于是长图与页面上的水彩
 *   中国是**同一份国界**：以后改国界只改这一个文件，不会「页面上改了、长图还是老的」。
 *
 * 颜色一并配好（纸浆 / 内沿）：`shade(pulp, lum…)` 那一句判深浅的写法只有一份。
 */
function stageLand() {
  const k = STAGE_W / ART_W;                                  // 用户单位 → 舞台 rpx
  const pt = (p) => { const q = toStage(p[0], p[1]); return [q.x, q.y]; };
  const blob = (r) => {
    const q = toStage(r.lng, r.lat);
    return { x: q.x, y: q.y, rx: r.rx * k, ry: r.ry * k, rot: r.rot, fill: r.fill, op: r.op };
  };
  const pulp = PULP_FALLBACK;
  return {
    pulp: pulp,
    rim: shade(pulp, lum(pulp) > 0.55 ? -0.22 : 0.26),
    border: BORDER.map(pt),
    regions: REGIONS.map(blob),
    isles: [[HAINAN_RING, HAINAN], [TAIWAN_RING, TAIWAN]].map(([ring, blk]) => ({
      ring: ring.map(pt),
      blob: blob(blk)
    })),
    RIM: RIM,
    BLEED: BLEED
  };
}

/** 保留两位小数（透明度用） */
function round2(n) { return Math.round(n * 100) / 100; }

// ============================================================
// 二·五、气泡落位：把城市钉在投影点上，撞了才挪气泡（绝不挪落点）
// ============================================================
/**
 * 气泡的排版尺寸（rpx）—— 必须与 pages/discover/discover.wxss 的 .dc-bubble 逐项对得上。
 * 「乌鲁木齐」这种四字名比「北京」宽一倍，若只用一个固定宽度：
 * 写小了短名够用、长名互压；写大了短名被无谓地顶得老远。
 * 故宽度按名字长度现算，下列三个数就是 WXSS 里的 min-width / font-size / 左右内边距。
 */
const BUBBLE_W = 96;      // .dc-bubble 的 min-width
const BUBBLE_FS = 26;     // .dc-bubble-n 的字号
const BUBBLE_PAD = 36;    // .dc-bubble 的左右内边距（18 × 2）
const BUBBLE_H = 84;      // 两行字 + 上下内边距（见 WXSS：26×1.2 + 21×1.2 + 10 + 12 ≈ 79）
const BUBBLE_GAP = 12;
const PIN_GAP = 16;   // 气泡边到落点的距离（给尾巴和连接杆留的位置）
const EDGE = 6;       // 气泡不许贴出舞台边缘
/** 气泡配色池：品牌固定色，六主题不变 */
const BUBBLE = ['#D98C8A', '#93AE8F', '#C97F6E', '#E2B45E', '#C4A9B8'];

/**
 * 城市名 → 气泡色。按名字取模，不用「按票数排序的下标」——
 * 否则多收一张票就可能让某座城换个颜色，看着像搬了家。
 */
function bubbleColor(city) {
  let h = 0;
  const s = String(city);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return BUBBLE[h % BUBBLE.length];
}

/**
 * 城市名 → 气泡实宽（含左右内边距）。中文按字号近似等宽，两字以内回落到 min-width。
 *
 * ⚠️ 这个值**必须由 JS 下发到气泡的行内 style 上**，不能只在避让算法里用：
 *    气泡是绝对定位、父级 .dc-city 又是 0 尺寸，收缩到合适宽度时可用宽度算出来是 0，
 *    于是实际宽度被 min-width 钉死在 96 —— 四字名「乌鲁木齐」（需要 140）会被**折成两行**：
 *    横向比算法以为的窄 8rpx（左右会压到邻居），纵向比算法以为的高 26rpx（上下也会压）。
 *    避让算法再准，量的是个不存在的盒子。WXML 里挂 width，实测宽度才等于这里算的。
 */
function bubbleWidth(city) {
  return Math.max(BUBBLE_W, String(city).length * BUBBLE_FS + BUBBLE_PAD);
}

/**
 * 气泡避让：**只推气泡，绝不动落点**。
 * 落点是这张图全部的信息量所在；为了排版好看去挪它，等于骗人。
 * 所以撞了就往上顶（顶到边界就往下），中间用一根细杆连回原来的落点。
 * 按 y 升序放 —— 北边的先占位，与看地图的习惯一致。
 * @param {Array<{x:number,y:number}>} list 已由 toStage 定好落点，就地写入 push/below
 */
function layoutBubbles(list) {
  const step = BUBBLE_H + BUBBLE_GAP;
  const placed = [];
  // 气泡是 translateX(-50%) 居中贴在自己落点上的，所以横向占位是「两个半宽之和」
  const box = (c, push, below) => {
    const top = below ? c.y + PIN_GAP + push : c.y - PIN_GAP - push - BUBBLE_H;
    return { x: c.x, half: bubbleWidth(c.city) / 2, top, bottom: top + BUBBLE_H };
  };
  /**
   * 这个位置「有多难看」= 压住邻居的面积 + 探出舞台的面积（单位 rpx²，0 = 一点没碍着）。
   * 纵向两侧各让出 BUBBLE_GAP/2，与「隔开一整格就算不碰」的口径对齐：
   * 隔着 12rpx 或正好贴着都算 0，真压上了才开始计。
   *
   * 为什么不用「压没压住」这个是非题：东部沿海在满图（12 城）时物理上就是塞不下 ——
   * 105°E 以东挤了 5 座城，而能横排的位置只够 2 颗气泡。是非题对这种图只能回答
   * 「哪个位置都不行」，于是只能随便选一个，结果就是两颗气泡整块糊在一起。
   * 改量「糊了多少」，算法就能挑出少糊一半的那个位置。
   */
  const pressed = (a, b) => {
    const dy = BUBBLE_GAP / 2;
    const wx = Math.min(a.x + a.half, b.x + b.half) - Math.max(a.x - a.half, b.x - b.half);
    if (wx <= 0) return 0;
    const wy = Math.min(a.bottom + dy, b.bottom + dy) - Math.max(a.top - dy, b.top - dy);
    return wy <= 0 ? 0 : wx * wy;
  };
  const cost = (c, push, below) => {
    const b = box(c, push, below);
    const out = (Math.max(0, EDGE - b.top) + Math.max(0, b.bottom - (STAGE_H - EDGE))) * b.half * 2;
    return placed.reduce((sum, p) => sum + pressed(b, box(p, p.push, p.below)), out);
  };

  // 候选位置按喜好排序：不动 → 往上顶 → 往下压。
  // 往上顶到 6 档（原先 4 档）：东部沿海那几个城市挨得太近，4 档不够用。
  // 往上优先于往下，是因为连接杆朝下伸更像气球（往下压时杆从头顶往下扎，本来就怪）。
  const CANDS = [{ push: 0, below: false }];
  for (let i = 1; i <= 6; i++) CANDS.push({ push: i * step, below: false });
  for (let i = 1; i <= 3; i++) CANDS.push({ push: i * step, below: true });

  list.slice().sort((a, b) => a.y - b.y).forEach((c) => {
    let pick = null;            // 一格都没碍着的位置，取喜好顺序里最靠前的那个
    let fallback = CANDS[0];    // 全都有碍时：碍得最轻的那个（压 1 颗总比压 3 颗强）
    let least = Infinity;
    CANDS.forEach((o) => {
      const n = cost(c, o.push, o.below);
      if (!n && !pick) pick = o;
      if (n < least) { least = n; fallback = o; }
    });
    const sel = pick || fallback;
    c.push = sel.push;
    c.below = sel.below;
    placed.push(c);
  });
  return list;
}

// ============================================================
// 三、时光路线：按「首次到访顺序」把城市串起来
// ============================================================
const ROUTE_COLOR = '#D98C7E'; // 稿屏7 的虚线是玫瑰色

/**
 * @param {Array<{lng:number, lat:number}>} pts 已按首次到访时间排序的城市坐标
 * @returns {string} data-uri；不足两个点返回空串（页面对空串不渲染该图层）
 */
function routeSrc(pts) {
  const list = (pts || []).filter((p) => p && typeof p.lng === 'number' && typeof p.lat === 'number');
  if (list.length < 2) return '';
  const xy = list.map((p) => [projX(p.lng), projY(p.lat)]);
  const d = xy.map((p, i) => (i ? 'L' : 'M') + round1(p[0]) + ' ' + round1(p[1])).join('');
  // 途经点的小圆点：稿子里虚线之间散着几颗点，是「这里也停过」的意思
  const dots = xy.map((p) =>
    "<circle cx='" + round1(p[0]) + "' cy='" + round1(p[1]) + "' r='5'" +
    " fill='" + ROUTE_COLOR + "' fill-opacity='0.5'/>"
  ).join('');
  return toUri(ART_W, ART_H,
    "<path d='" + d + "' fill='none' stroke='" + ROUTE_COLOR + "' stroke-opacity='0.75'" +
    " stroke-width='3' stroke-dasharray='11 9' stroke-linecap='round' stroke-linejoin='round'/>" + dots);
}

// ============================================================
// 四、装饰邮票（稿屏7 卡片左上 / 右下的两张）
// ============================================================
/**
 * 白齿孔边框 + 框内一小幅水彩日出。
 * @param {string} punch 齿孔的「挖空色」—— 必须填成卡片底色，才有真的被咬掉一块的感觉
 */
function stampSrc(punch) {
  const bg = safeColor(punch, '#FFFFFF');
  const W = 120, H = 140, PAD = 11, R = 3.6, STEP = 10.5;
  let holes = '';
  // 齿孔必须**正好骑在白边线上**（圆心落在 y=0 / y=H），露出来的才是半圆咬口；
  // 把圆心放在白边内侧会变成一排圆点，那是波点不是邮票。
  for (let x = STEP / 2; x < W; x += STEP) {
    holes += hole(x, 0, R, bg) + hole(x, H, R, bg);
  }
  for (let y = STEP / 2; y < H; y += STEP) {
    holes += hole(0, y, R, bg) + hole(W, y, R, bg);
  }
  const inner =
    // 框内：曙色天空 → 远山 → 落日
    "<rect x='" + PAD + "' y='" + PAD + "' width='" + (W - PAD * 2) + "' height='" + (H - PAD * 2) + "'" +
    " rx='3' fill='" + BUTTER + "' fill-opacity='0.42'/>" +
    "<path d='M" + PAD + " " + (H - PAD - 30) + "Q" + (W * 0.34) + " " + (H - PAD - 62) + " " + (W * 0.62) + " " + (H - PAD - 34) +
    "T" + (W - PAD) + " " + (H - PAD - 44) + "V" + (H - PAD) + "H" + PAD + "Z'" +
    " fill='" + SAGE + "' fill-opacity='0.55'/>" +
    "<circle cx='" + (W * 0.62) + "' cy='" + (H * 0.42) + "' r='11'" +
    " fill='" + ROSE + "' fill-opacity='0.75'/>";
  return toUri(W, H,
    "<rect x='0' y='0' width='" + W + "' height='" + H + "' rx='4' fill='#FFFFFF'/>" + inner + holes);
}

function hole(cx, cy, r, fill) {
  return "<circle cx='" + cx + "' cy='" + cy + "' r='" + r + "' fill='" + fill + "'/>";
}

// ============================================================
// 五、公共小工具
// ============================================================
/**
 * 保留一位小数（去掉浮点脏值）。
 * 必须返回**数值**：toStage 的落点要参与 layoutBubbles 的加减，
 * 一旦这里吐出字符串，`c.y + PIN_GAP + push` 会变成拼接（"391" + "16" → "39116"），
 * 被顶到落点下方的气泡会算出天文数字的坐标，直接飞出屏幕。
 * 拼 SVG 时数值照样能自动转字符串，不会多出 '.0'。
 */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/** 只放行十六进制色值：防注入，也防有人误传 var(--x)（SVG 不认） */
function safeColor(v, fallback) {
  const s = String(v == null ? '' : v).trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
}

/** #RRGGBB → 0..1 的相对亮度（够用的近似，不需要 gamma 校正） */
function lum(hex) {
  const n = parseInt(safeColor(hex, '#000000').slice(1), 16);
  return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
}

/**
 * 调深/调浅：amt 为负往黑走、为正往白走。用于从纸浆色推出「边沿积色」，
 * 免得把六个主题的内沿色一个个写死。入参必须是 safeColor 放行过的色值。
 */
function shade(hex, amt) {
  const n = parseInt(safeColor(hex, '#000000').slice(1), 16);
  const t = amt < 0 ? 0 : 255;
  const k = Math.abs(amt);
  const ch = (v) => Math.round(v + (t - v) * k).toString(16).padStart(2, '0');
  return '#' + ch((n >> 16) & 255) + ch((n >> 8) & 255) + ch(n & 255);
}

/**
 * 原生地图（微信 <map> 组件）的图钉：一个城市一枚，坐标取该城票根的重心。
 * 与水彩图同源——都吃 cities 里的真实经纬度，只是画法不同：
 *   水彩图 = 自己投影到舞台坐标；原生地图 = 交给微信去投影。
 * 点标记要用 id 找回城市，故 id 就是 cities 的下标（顺序一一对应，别打乱）。
 * @param {Array<{city:string,count:number,lat:number,lng:number}>} cities 累计经纬度（要除以 count）
 * @param {{text:string,card:string}} m 当前主题元数据（气泡配色跟主题走）
 */
function markersOf(cities, m) {
  return cities.map((c, i) => ({
    id: i,
    latitude: c.lat / c.count,
    longitude: c.lng / c.count,
    iconPath: '/images/map-pin.png',
    width: 26,
    height: 34,
    callout: {
      content: c.city + ' · ' + c.count + ' 张',
      color: m.text,
      bgColor: m.card,
      fontSize: 12,
      borderRadius: 8,
      padding: 6,
      textAlign: 'center',
      display: 'ALWAYS'
    }
  }));
}

/** 包一层 svg 根节点并转成可直接塞进 <image src> 的 data-uri */
function toUri(w, h, body) {
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + w + ' ' + h +
    "' width='" + w + "' height='" + h + "'>" + body + '</svg>';
  return toDataUri(svg);
}

module.exports = {
  landSrc,
  stageLand,
  routeSrc,
  stampSrc,
  toStage,
  layoutBubbles,
  markersOf,
  bubbleColor,
  bubbleWidth,
  STAGE_W,
  STAGE_H,
  ART_W,
  ART_H,
  BUBBLE_W,
  BUBBLE_FS,
  BUBBLE_PAD,
  BUBBLE_H,
  BUBBLE_GAP,
  PIN_GAP,
  // 导出供测试断言：投影常量一旦改动，气泡落点全体位移，必须有断言盯着
  LNG0, LNG1, LAT0, LAT1, KX, S, MAP_TOP
};
