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
//   同 utils/icons.js / utils/deco.js：产物是 <image src="data:image/svg+xml,...">，
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
// 48 个控制点，顺时针：帕米尔 → 阿尔泰 → 漠河 → 抚远 → 辽东 → 山东 → 华南 → 藏南 → 回到帕米尔。
// 精度到「省级尺度」够用，这不是一份测绘数据，是一张插画的骨。
const BORDER = [
  [73.6, 39.4], [76.5, 41.0], [80.3, 42.2], [82.5, 45.0], [85.0, 47.0], [87.3, 49.2],
  [90.5, 47.8], [95.5, 44.0], [100.0, 42.6], [105.0, 41.8], [110.0, 42.5], [111.5, 43.5],
  [115.0, 45.5], [119.5, 46.8], [120.0, 49.5], [122.5, 53.5], [127.5, 50.2], [130.8, 48.3],
  [134.8, 48.4], [131.5, 45.0], [131.2, 42.9], [128.0, 42.0], [124.4, 40.0], [121.6, 40.8],
  // 渤海湾：真实海岸是个深 V，按真深度画会从右侧切进去一大块白、
  // 看着像陆地断成两截。这里只留一个浅弧 —— 插画优先，不是测绘。
  [119.6, 39.3], [120.2, 37.8], [122.6, 37.4], [120.4, 35.4], [121.9, 30.9], [120.0, 27.0],
  [116.5, 23.4], [113.5, 22.2], [110.5, 21.2], [108.0, 21.5], [105.0, 22.9], [101.7, 21.2],
  [99.2, 22.1], [97.5, 24.0], [98.0, 27.5], [95.5, 29.0], [91.5, 27.8], [88.0, 27.3],
  [85.0, 28.3], [81.0, 30.4], [78.8, 31.5], [78.0, 35.0], [76.0, 36.5], [74.5, 37.5]
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

/** 海南单独一颗小色块（它是岛，不在上面那条国界里） */
const HAINAN = { lng: 109.7, lat: 19.3, rx: 24, ry: 16, rot: 12, fill: SAGE, op: 0.3, seed: 47 };

/** 纸浆色兜底（主题缺 soft 时用）——暖米白 */
const PULP_FALLBACK = '#F7E9D2';
/** 洇边：沿国界描几道由粗到细、由淡到浓的边，替代 SVG 滤镜做「水在纸上化开」（滤镜在小程序 image 里不保证支持） */
const BLEED = [
  { w: 30, op: 0.6 },
  { w: 15, op: 1 }
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

/** 中国国界 → 视图坐标路径（带轻微手抖，机械平滑的边不像手绘） */
function borderPath() {
  const rand = rng(20240907);
  return smoothClosed(BORDER.map(([lng, lat]) =>
    [projX(lng) + (rand() * 2 - 1) * 2.2, projY(lat) + (rand() * 2 - 1) * 2.2]));
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
function landSrc(theme) {
  const pulp = safeColor(theme && theme.soft, PULP_FALLBACK);
  const d = borderPath();
  const clip = "<clipPath id='cn'><path d='" + d + "'/></clipPath>";
  // 先铺纸浆，再把色块裁进国界内，最后沿国界补几道由粗到细的洇边
  const base = "<path d='" + d + "' fill='" + pulp + "' fill-opacity='0.62'/>";
  const washes = "<g clip-path='url(#cn)'>" +
    REGIONS.map(regionSvg).join('') + regionSvg(HAINAN) + '</g>';
  const bleed = BLEED.map((b) =>
    "<path d='" + d + "' fill='none' stroke='" + pulp + "' stroke-width='" + b.w +
    "' stroke-opacity='" + round2(0.16 * b.op) + "' stroke-linejoin='round'/>"
  ).join('');
  return toUri(ART_W, ART_H, clip + base + washes + bleed);
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

/** 城市名 → 气泡实宽。中文按字号近似等宽，两字以内回落到 min-width */
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
  const hits = (a, b) =>
    Math.abs(a.x - b.x) < a.half + b.half && a.top < b.bottom + BUBBLE_GAP && b.top < a.bottom + BUBBLE_GAP;
  const fits = (c, push, below) => {
    const b = box(c, push, below);
    if (b.top < EDGE || b.bottom > STAGE_H - EDGE) return false;
    return !placed.some((p) => hits(b, box(p, p.push, p.below)));
  };

  list.slice().sort((a, b) => a.y - b.y).forEach((c) => {
    let pick = { push: 0, below: false };
    if (!fits(c, 0, false)) {
      pick = null;
      for (let i = 1; i <= 4 && !pick; i++) if (fits(c, i * step, false)) pick = { push: i * step, below: false };
      for (let i = 1; i <= 2 && !pick; i++) if (fits(c, i * step, true)) pick = { push: i * step, below: true };
      // 实在放不下就按初始位置画：宁可略微压边，也不能让一座城从图上消失
      if (!pick) pick = { push: 0, below: false };
    }
    c.push = pick.push;
    c.below = pick.below;
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

/** 包一层 svg 根节点并转成可直接塞进 <image src> 的 data-uri */
function toUri(w, h, body) {
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + w + ' ' + h +
    "' width='" + w + "' height='" + h + "'>" + body + '</svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

module.exports = {
  landSrc,
  routeSrc,
  stampSrc,
  toStage,
  layoutBubbles,
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
