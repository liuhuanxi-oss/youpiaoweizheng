// utils/deco.js —— 主题装饰图形（主题预览票根 + 19 款装饰元素）  v7.0 新增
// ============================================================
// 【为什么需要这个文件】
//   theme 页的装饰元素原来是用**内联 <svg> 标签**写的。
//   微信小程序 wxml 不渲染 <svg>（详见 utils/icons.js 顶部说明：视图层没有
//   SVG 原生渲染树，<svg>/<path> 被当未知自定义组件容器，子元素全部丢弃）。
//   结果是真机上这 20 处图形**全是空白**，只剩底下的中文角标。
//
// 【为什么颜色要在 JS 里编译，不能继续用 var(--primary)】
//   改成 <image src="data:image/svg+xml;base64,..."> 之后，SVG 是一份**独立文档**，
//   页面的 CSS 变量不会继承进去，var() 一律失效、图形变黑或消失。
//   所以这里在拼 SVG 时就把该主题的具体色值写进去 —— 这也是色彩能随
//   主题切换的唯一办法（theme 页一次渲染 6 套主题，本来就各要一套实色）。
//
// 【用法】
//   const deco = require('../../utils/deco.js');
//   deco.previewSrc(themeMeta)         // → 主题预览票根 data-uri（theme 页顶部）
//   deco.decoSrc('postmark', themeMeta) // → 装饰元素 data-uri
//   themeMeta 直接传 utils/theme.js 里的 THEME_META 元素（含 bg/primary/accent…）
// ============================================================

const { toDataUri } = require('./svg.js');

/**
 * 把 '#RRGGBB' / '#RGB' / 'rgba(r,g,b,a)' 解析成 {hex, a}
 * 认不出来的值回落 fallback（默认中灰），绝不抛错 —— 宁可颜色不对，不能让整页崩。
 */
function parseColor(v, fallback) {
  const s = String(v == null ? '' : v).trim();
  let m = /^#([0-9a-fA-F]{6})$/.exec(s);
  if (m) return { hex: '#' + m[1].toUpperCase(), a: 1 };
  m = /^#([0-9a-fA-F]{3})$/.exec(s);
  if (m) {
    const x = m[1];
    return { hex: ('#' + x[0] + x[0] + x[1] + x[1] + x[2] + x[2]).toUpperCase(), a: 1 };
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) {
    const h = (n) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0');
    const a = m[4] === undefined ? 1 : Math.max(0, Math.min(1, parseFloat(m[4])));
    return { hex: ('#' + h(m[1]) + h(m[2]) + h(m[3])).toUpperCase(), a };
  }
  return { hex: fallback || '#9C8F80', a: 1 };
}

/** 透明度保留两位，避免 '0.30000000000000004' 这类脏值进 SVG */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/** 拼 fill 属性；op 是与色值自带 alpha 相乘的元素级透明度 */
function fillOf(v, fallback, op) {
  const c = parseColor(v, fallback);
  const a = round2(c.a * (typeof op === 'number' ? op : 1));
  return "fill='" + c.hex + "'" + (a < 1 ? " fill-opacity='" + a + "'" : '');
}

/** 拼 stroke 属性组；dash 传 '3 3' 这类 dasharray，不需要就传 '' */
function strokeOf(v, fallback, w, dash, op) {
  const c = parseColor(v, fallback);
  const a = round2(c.a * (typeof op === 'number' ? op : 1));
  return "stroke='" + c.hex + "' stroke-width='" + w + "'" +
    (dash ? " stroke-dasharray='" + dash + "'" : '') +
    (a < 1 ? " stroke-opacity='" + a + "'" : '');
}

// ============================================================
// 19 款装饰元素：每个函数吃主题色板 c，吐一段 SVG 内容
// 图形与原来的内联 svg 逐点一致，仅把 var(--x) 换成 c.x
// ============================================================

const DECO = {
  // ——— paper 纸感杂志 ———
  postmark: (c) =>
    '<circle cx="32" cy="22" r="17" fill="none" ' + strokeOf(c.accent, '#8A7E6E', 1.6, '3 3') + '/>' +
    '<circle cx="32" cy="22" r="11" fill="none" ' + strokeOf(c.accent, '#8A7E6E', 1, '') + '/>' +
    '<path d="M25 22h14" fill="none" ' + strokeOf(c.accent, '#8A7E6E', 1.4, '') + '/>',

  perf: (c) =>
    '<rect x="8" y="12" width="48" height="20" rx="3" ' + fillOf(c.soft, '#E9E2D4') + '/>' +
    '<circle cx="8" cy="18" r="2.6" ' + fillOf(c.bg, '#F5F0E6') + '/>' +
    '<circle cx="8" cy="26" r="2.6" ' + fillOf(c.bg, '#F5F0E6') + '/>' +
    '<circle cx="56" cy="18" r="2.6" ' + fillOf(c.bg, '#F5F0E6') + '/>' +
    '<circle cx="56" cy="26" r="2.6" ' + fillOf(c.bg, '#F5F0E6') + '/>' +
    '<path d="M20 22H44" fill="none" ' + strokeOf(c.accent, '#8A7E6E', 1.6, '4 4') + '/>',

  rule: (c) =>
    '<path d="M6 18H58" fill="none" ' + strokeOf(c.primary, '#2B2420', 2.6, '') + '/>' +
    '<path d="M6 26H58" fill="none" ' + strokeOf(c.primary, '#2B2420', 1.2, '') + '/>',

  stamp: (c) =>
    '<rect x="16" y="6" width="32" height="32" rx="2" ' +
      fillOf(c.soft, '#E9E2D4') + ' ' + strokeOf(c.primary, '#2B2420', 1.4, '2 2') + '/>' +
    '<circle cx="32" cy="22" r="7" fill="none" ' + strokeOf(c.accent, '#8A7E6E', 1.6, '') + '/>',

  // ——— glass 柔和玻璃 ———
  blob: (c) =>
    '<ellipse cx="24" cy="20" rx="18" ry="13" ' + fillOf(c.primary, '#D9A0A6', 0.5) + '/>' +
    '<ellipse cx="44" cy="28" rx="14" ry="11" ' + fillOf(c.soft, '#F6DFA8', 0.7) + '/>',

  glass: (c) =>
    '<rect x="14" y="8" width="36" height="28" rx="8" fill="#FFFFFF" fill-opacity="0.5" ' +
      'stroke="#FFFFFF" stroke-opacity="0.8" stroke-width="1.4"/>' +
    '<path d="M20 30Q32 12 44 30" fill="none" ' + strokeOf(c.primary, '#D9A0A6', 1.8, '', 0.7) + '/>',

  // ——— collage 手账拼贴 ———
  tape: (c) =>
    '<rect x="8" y="18" width="48" height="10" ' + fillOf(c.accent, '#F6DFA8', 0.75) +
      ' transform="rotate(-3 32 23)"/>' +
    '<rect x="8" y="18" width="48" height="10" fill="none" stroke="#6B5B50" stroke-opacity="0.18" ' +
      'stroke-width="0.8" transform="rotate(-3 32 23)"/>',

  sticky: (c) =>
    '<rect x="14" y="8" width="36" height="30" rx="3" ' + fillOf(c.soft, '#FBF3D9') +
      ' transform="rotate(-2 32 23)"/>' +
    '<path d="M20 18H44M20 24H44M20 30H36" fill="none" ' +
      strokeOf(c.text2, '#A5968A', 1.2, '', 0.6) + '/>',

  doodle: (c) =>
    '<path d="M14 30Q22 10 32 22T52 16" fill="none" ' +
      strokeOf(c.primary, '#D9A0A6', 2.2, '') + ' stroke-linecap="round"/>' +
    '<circle cx="50" cy="12" r="2.4" ' + fillOf(c.accent, '#F6DFA8') + '/>',

  // ——— film 胶片电影 ———
  filmperf: (c) =>
    '<rect x="6" y="14" width="52" height="16" ' + fillOf(c.soft, '#3A302A') + '/>' +
    '<rect x="10" y="17" width="4" height="4" ' + fillOf(c.bg, '#1F1A17') + '/>' +
    '<rect x="10" y="23" width="4" height="4" ' + fillOf(c.bg, '#1F1A17') + '/>' +
    '<rect x="50" y="17" width="4" height="4" ' + fillOf(c.bg, '#1F1A17') + '/>' +
    '<rect x="50" y="23" width="4" height="4" ' + fillOf(c.bg, '#1F1A17') + '/>' +
    '<rect x="20" y="18" width="24" height="8" ' + fillOf(c.accent, '#F6DFA8', 0.6) + '/>',

  timecode: (c) =>
    '<rect x="10" y="16" width="44" height="14" rx="3" fill="#000000" fill-opacity="0.35" ' +
      strokeOf(c.accent, '#F6DFA8', 1.2, '') + '/>' +
    '<path d="M18 23h6M28 23h6M38 23h6" fill="none" ' +
      strokeOf(c.accent, '#F6DFA8', 2, '') + ' stroke-linecap="round"/>',

  glow: (c) =>
    '<circle cx="32" cy="22" r="16" ' + fillOf(c.accent, '#F6DFA8', 0.22) + '/>' +
    '<circle cx="32" cy="22" r="9" ' + fillOf(c.accent, '#F6DFA8', 0.4) + '/>',

  // ——— literary 清新文艺 ———
  watercolor: (c) =>
    '<circle cx="22" cy="22" r="14" ' + fillOf(c.primary, '#A9C3A6', 0.4) + '/>' +
    '<circle cx="42" cy="20" r="11" ' + fillOf(c.accent, '#F4C6B4', 0.45) + '/>',

  leaf: (c) =>
    '<path d="M32 8Q46 16 42 32Q34 40 22 36Q16 22 32 8Z" ' + fillOf(c.primary, '#A9C3A6', 0.6) + '/>' +
    '<path d="M32 10Q30 24 24 34" fill="none" ' + strokeOf(c.bg, '#FAF5EE', 1.4, '') + '/>',

  // ——— minimal 极简留白 ———
  line: (c) =>
    '<path d="M8 22H56" fill="none" ' + strokeOf(c.text, '#1A1A1A', 1.6, '') + '/>',

  dot: (c) =>
    '<circle cx="32" cy="22" r="6" ' + fillOf(c.accent, '#D9A0A6') + '/>',

  frame: (c) =>
    '<rect x="12" y="10" width="40" height="24" fill="none" ' +
      strokeOf(c.text, '#1A1A1A', 1.4, '') + '/>',

  // ——— 多主题共用 ———
  wave: (c) =>
    '<path d="M2 14Q10 4 18 14T34 14T50 14T62 12" fill="none" ' +
      strokeOf(c.primary, '#2B2420', 3, '') + ' stroke-linecap="round"/>',

  dots: (c) =>
    '<circle cx="12" cy="14" r="5" ' + fillOf(c.primary, '#2B2420', 0.7) + '/>' +
    '<circle cx="26" cy="26" r="6" ' + fillOf(c.accent, '#C26B5E', 0.8) + '/>' +
    '<circle cx="42" cy="12" r="4.5" ' + fillOf(c.primary, '#2B2420', 0.5) + '/>' +
    '<circle cx="54" cy="26" r="6" ' + fillOf(c.accent, '#C26B5E', 0.6) + '/>',

  // ——— 我的页（稿屏11）：花枝 / 波浪排线 / 小粉心 / 四角星 ———
  // 花枝：一根斜茎 + 三片叶 + 顶端三朵五瓣小花（压在卡片边缘外做手绘感）
  sprig: (c) =>
    '<path d="M8 40Q16 26 30 16T52 8" fill="none" ' +
      strokeOf(c.primary, '#A9C3A6', 2.2, '') + ' stroke-linecap="round"/>' +
    '<path d="M20 27Q12 24 10 16Q20 16 24 24Z" ' + fillOf(c.primary, '#A9C3A6', 0.75) + '/>' +
    '<path d="M32 18Q28 10 32 4Q40 8 38 17Z" ' + fillOf(c.primary, '#A9C3A6', 0.6) + '/>' +
    '<path d="M42 13Q42 6 48 3Q54 8 50 15Z" ' + fillOf(c.primary, '#A9C3A6', 0.7) + '/>' +
    '<circle cx="52" cy="8" r="5" ' + fillOf(c.accent, '#F6DFA8') + '/>' +
    '<circle cx="52" cy="8" r="1.8" fill="#FFF6DF"/>' +
    '<circle cx="61" cy="14" r="3.6" ' + fillOf(c.accent, '#F6DFA8', 0.85) + '/>',

  // 波浪排线：三道粗细递减的手绘波浪（稿里成组出现在卡片左右外侧）
  wavelines: (c) =>
    '<path d="M2 6Q10 1 18 6T34 6T50 6T62 6" fill="none" ' +
      strokeOf(c.primary, '#C26B5E', 2.4, '') + ' stroke-linecap="round"/>' +
    '<path d="M2 14Q10 9 18 14T34 14T50 14T62 14" fill="none" ' +
      strokeOf(c.primary, '#C26B5E', 2, '', 0.7) + ' stroke-linecap="round"/>' +
    '<path d="M2 22Q10 17 18 22T34 22T50 22T62 22" fill="none" ' +
      strokeOf(c.primary, '#C26B5E', 1.6, '', 0.45) + ' stroke-linecap="round"/>',

  // 小粉心（稿里点缀在卡片右上/花枝旁）
  heartsmall: (c) =>
    '<path d="M16 26C8 20 3 15 3 9.6A6.6 6.6 0 0 1 16 5.6a6.6 6.6 0 0 1 13 4c0 5.4-5 10.4-13 16.4Z" ' +
      fillOf(c.accent, '#E8AFA8', 0.85) + '/>',

  // 金色四角星（稿里散布在标题与卡片上，比 sparkle 更胖更钝）
  star4: (c) =>
    '<path d="M16 2c1.6 6.4 3.6 8.4 10 10-6.4 1.6-8.4 3.6-10 10-1.6-6.4-3.6-8.4-10-10 6.4-1.6 8.4-3.6 10-10Z" ' +
      fillOf(c.accent, '#F5C86A') + '/>',

  // ——— 双人回忆（稿屏10）：白色小雏菊花枝 ———
  // 长在 hero 纸卡的左上/左下两角与页脚。花瓣按角度算出来排一圈 ——
  // 手写 8 个 ellipse 的话，改一次花瓣半径要改八处。
  daisy: (c) => {
    const petal = c.paper || '#FFFDF8';
    const leaf = c.leaf || '#A9C3A6';
    const core = c.core || '#F6DFA8';
    const edge = c.text || '#6B5B50';
    let s =
      // 主茎 + 一根侧枝
      '<path d="M28 100Q36 62 46 32" fill="none" ' + strokeOf(leaf, '#A9C3A6', 2, '') + ' stroke-linecap="round"/>' +
      '<path d="M37 66Q50 60 60 48" fill="none" ' + strokeOf(leaf, '#A9C3A6', 1.6, '', 0.85) + ' stroke-linecap="round"/>' +
      // 两片叶
      '<path d="M31 78Q17 76 11 64Q26 62 33 74Z" ' + fillOf(leaf, '#A9C3A6', 0.7) + '/>' +
      '<path d="M41 52Q36 39 41 28Q52 37 47 50Z" ' + fillOf(leaf, '#A9C3A6', 0.5) + '/>';
    // 主花：8 片白瓣绕中心（白瓣压在白纸卡上要靠一道极淡的描边才读得出）
    for (let i = 0; i < 8; i++) {
      const a = (i * 45) * Math.PI / 180;
      const x = round2(46 + Math.cos(a) * 10.5), y = round2(26 + Math.sin(a) * 10.5);
      s += '<ellipse cx="' + x + '" cy="' + y + '" rx="7.4" ry="4.8" transform="rotate(' + (i * 45) + ' ' + x + ' ' + y + ')" ' +
        'fill="' + petal + '" stroke="' + edge + '" stroke-opacity="0.22" stroke-width="0.9"/>';
    }
    s += '<circle cx="46" cy="26" r="5.6" ' + fillOf(core, '#F6DFA8') + '/>';
    // 副花：6 片，小一号，挂在侧枝末端
    for (let i = 0; i < 6; i++) {
      const a = (i * 60) * Math.PI / 180;
      const x = round2(62 + Math.cos(a) * 6.2), y = round2(46 + Math.sin(a) * 6.2);
      s += '<ellipse cx="' + x + '" cy="' + y + '" rx="4.4" ry="3" transform="rotate(' + (i * 60) + ' ' + x + ' ' + y + ')" ' +
        'fill="' + petal + '" stroke="' + edge + '" stroke-opacity="0.18" stroke-width="0.8"/>';
    }
    s += '<circle cx="62" cy="46" r="3.2" ' + fillOf(core, '#F6DFA8', 0.9) + '/>';
    return s;
  },

  // ——— 首页票根墙（稿屏2）：照片角上那一小朵花 ———
  // 稿里每张票根卡的照片左下角都压着一朵小白花、右边支着一片叶子。
  // 和 daisy 的差别只在"没有主茎、只有一个花头"，所以不复用它改参数 —— 参数一多就没人看得懂了。
  bloom: (c) => {
    const petal = c.paper || '#FFFDF8';
    const leaf = c.leaf || '#A9C3A6';
    const core = c.core || '#EFB7AE';
    const edge = c.text || '#6B5B50';
    let s =
      // 短茎 + 一片叶
      '<path d="M24 52Q25 40 24 30" fill="none" ' + strokeOf(leaf, '#A9C3A6', 1.6, '') + ' stroke-linecap="round"/>' +
      '<path d="M25 42Q14 41 9 33Q21 32 26 39Z" ' + fillOf(leaf, '#A9C3A6', 0.7) + '/>';
    // 5 片花瓣绕中心
    for (let i = 0; i < 5; i++) {
      const a = (i * 72 - 90) * Math.PI / 180;
      const x = round2(24 + Math.cos(a) * 8), y = round2(18 + Math.sin(a) * 8);
      s += '<ellipse cx="' + x + '" cy="' + y + '" rx="6.2" ry="4.4" transform="rotate(' + (i * 72) + ' ' + x + ' ' + y + ')" ' +
        'fill="' + petal + '" stroke="' + edge + '" stroke-opacity="0.2" stroke-width="0.8"/>';
    }
    s += '<circle cx="24" cy="18" r="4.2" ' + fillOf(core, '#EFB7AE') + '/>';
    return s;
  }
};

/** 每款装饰各自的 viewBox（宽高比不同，靠它让 image 的 aspectFit 算出正确比例） */
const DECO_VIEWBOX = {
  // 胶带：shape 只占 64×44 画布中间一条窄带，不收紧的话 image 的 aspectFit
  // 会把整块画布缩进盒子，胶带细成一根线（时光机页每张明信片上都要贴一条）
  tape: '7 16 50 14',
  wave: '0 0 64 20',
  dots: '0 0 64 40',
  sprig: '0 0 66 44',
  wavelines: '0 0 64 28',
  heartsmall: '0 0 32 32',
  star4: '0 0 32 24',
  daisy: '0 0 80 104',
  bloom: '0 0 48 56'
};
const DECO_VIEWBOX_DEFAULT = '0 0 64 44';

/** 包一层 svg 根节点并转成可直接塞进 <image src> 的 data-uri */
function toUri(viewBox, w, h, body) {
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='" + viewBox +
    "' width='" + w + "' height='" + h + "' fill='none'>" + body + '</svg>';
  return toDataUri(svg);
}

/**
 * 装饰元素 → data-uri
 * @param {string} name   DECO 的键；未知键回落 dot（不抛错，避免整页白屏）
 * @param {object} theme  THEME_META 里的一个主题（含 bg/primary/accent/soft/text/text2）
 */
function decoSrc(name, theme) {
  const c = theme || {};
  const fn = DECO[name] || DECO.dot;
  const vb = DECO_VIEWBOX[name] || DECO_VIEWBOX_DEFAULT;
  const parts = vb.split(' ');
  return toUri(vb, parts[2], parts[3], fn(c));
}

// ============================================================
// 主题预览：一张「微缩票根卡」（theme 页每张卡顶部那张）
// 【为什么换掉 IP 头像】原来六张卡顶部都是同一个戴渔夫帽的小人，只换背景色 ——
//   六张卡看下来等于没看：用户想知道的是「这套主题下我的票根长什么样」，
//   而一个与主题无关的卡通人像答不上来。现在直接铺一张该主题的票根卡：
//   底色、卡片色、文字色、主色、强调色一次性看全，比读色号快得多。
// 【造型】沿用产品母题：主券（照片 + 票名 + 类型胶囊）+ 撕票虚线 + 副券（条形码）。
// ============================================================

/** 副券上的条形码：宽窄交替的竖条，占满给定宽度 */
function barcode(x, y, w, h, c) {
  const GAP = 3;
  const widths = [4, 3, 5, 3, 4, 3, 5, 4];              // 合计 31
  const bars = w - GAP * (widths.length - 1);            // 条身可用宽度
  const scale = bars / 31;
  let out = '';
  let bx = x;
  for (let i = 0; i < widths.length; i++) {
    const bw = Math.round(widths[i] * scale * 10) / 10;
    out += '<rect x="' + bx + '" y="' + y + '" width="' + bw + '" height="' + h +
      '" ' + fillOf(c.text, '#2B2420', 0.58) + '/>';
    bx += bw + GAP;
  }
  return out;
}

function ticketPreview(c) {
  const SPLIT = 226;   // 撕票虚线所在的 x
  const CARD = { x: 22, y: 22, w: 276, h: 132, r: 12 };
  const RIGHT = CARD.x + CARD.w;   // 卡片右边界 298
  return '' +
    // 底：主题背景色（铺满，让每张卡的第一印象就是它）
    '<rect x="0" y="0" width="320" height="176" ' + fillOf(c.bg, '#F5F0E6') + '/>' +
    // 票根卡：主题卡片色 + 描边
    '<rect x="' + CARD.x + '" y="' + CARD.y + '" width="' + CARD.w + '" height="' + CARD.h +
      '" rx="' + CARD.r + '" ' + fillOf(c.card, '#FFFFFF') + ' ' +
      strokeOf(c.border, '#E9E2D4', 1, '') + '/>' +
    // 主券 · 照片位（左）：色块里压一道极淡的山脊与日头 —— 不然它就是
    // 「一块没上色的地方」，读者不知道那是什么。
    // 山与日头的坐标自己收在圆角内，不用 clipPath：少一个 SVG 特性，少一处真机风险。
    '<rect x="38" y="50" width="72" height="72" rx="10" ' + fillOf(c.soft, '#E9E2D4') + '/>' +
    '<path d="M46 120L60 96L72 108L86 92L102 120Z" ' + fillOf(c.text, '#2B2420', 0.13) + '/>' +
    '<circle cx="88" cy="66" r="6" ' + fillOf(c.text, '#2B2420', 0.1) + '/>' +
    // 主券 · 票名（粗）+ 两行说明（细）
    '<rect x="124" y="48" width="86" height="12" rx="6" ' + fillOf(c.text, '#2B2420', 0.88) + '/>' +
    '<rect x="124" y="70" width="80" height="6" rx="3" ' + fillOf(c.text2, '#8A7E6E', 1) + '/>' +
    '<rect x="124" y="84" width="58" height="6" rx="3" ' + fillOf(c.text2, '#8A7E6E', 1) + '/>' +
    // 主券 · 类型胶囊（整张图上主色唯一的大色块，一眼看出这套主题的主色）
    '<rect x="124" y="102" width="56" height="20" rx="10" ' + fillOf(c.primary, '#2B2420') + '/>' +
    // 撕票虚线 + 上下两个缺口（缺口用主题底色「咬」出来，省一层遮罩）
    // 撕票线是票根的标志，别用 border 那种浅到看不见的颜色 —— 用正文色压到 22%
    '<path d="M' + SPLIT + ' ' + (CARD.y + 12) + 'V' + (CARD.y + CARD.h - 12) + '" fill="none" ' +
      strokeOf(c.text, '#2B2420', 1.4, '5 5', 0.3) + '/>' +
    '<circle cx="' + SPLIT + '" cy="' + CARD.y + '" r="8" ' + fillOf(c.bg, '#F5F0E6') + '/>' +
    '<circle cx="' + SPLIT + '" cy="' + (CARD.y + CARD.h) + '" r="8" ' + fillOf(c.bg, '#F5F0E6') + '/>' +
    // 副券 · 条形码（副券宽 72，两侧各留 6）
    barcode(SPLIT + 6, 44, RIGHT - SPLIT - 12, 56, c) +
    // 副券 · 下半部一枚小印章（强调色），六套主题各显其色
    '<circle cx="' + (SPLIT + 36) + '" cy="128" r="11" fill="none" ' +
      strokeOf(c.accent, '#C26B5E', 1.6, '3 3') + '/>';
}

/**
 * 主题预览（微缩票根卡）→ data-uri
 * @param {object} theme  THEME_META 里的一个主题
 */
function previewSrc(theme) {
  return toUri('0 0 320 176', 320, 176, ticketPreview(theme || {}));
}

// ============================================================
// 邮戳（品牌全案 · 稿屏8 时光机）：每张明信片右上角那一枚
//   = 双圈圆环 + 右侧四道注销波浪线。
//
// ⚠️ 圈里的**城市名与日期不走 SVG 文字**，只画圈和波浪线：
//    SVG 一旦塞进 <image src="data:..."> 就是一份独立文档，字体由系统按
//    默认字族解析，中文字形在 iOS / Android 上回落结果不一致（此前
//    项目里已有过一次「真机字形丢失」的教训）。故文字交给 WXML 用真文本渲染，
//    城市名的弧形排列由「逐字 rotate + translateY」在 CSS 里实现（见 album.wxml）。
// ============================================================

/**
 * 双圈圆环（60×60 方形，圆心正中有利于文字层对齐）
 * 半径是有讲究的：外圈 27.4/60 托住弧形城市名，内圈虚线 17/60 圈住中间的三行日期，
 * 两者之间留出 20rpx 左右的环带给文字 —— 改半径前先看 tests/album_timemachine.test.js。
 */
function postmarkRing(c) {
  const ink = (c || {}).text;
  return toUri('0 0 60 60', 60, 60,
    '<circle cx="30" cy="30" r="27.4" fill="none" ' + strokeOf(ink, '#6B5B50', 1.6, '', 0.9) + '/>' +
    '<circle cx="30" cy="30" r="17" fill="none" ' + strokeOf(ink, '#6B5B50', 0.9, '2 2', 0.5) + '/>');
}

/** 右侧注销线：四道起伏波浪，长短粗细交替 */
function postmarkWave(c) {
  const ink = (c || {}).text;
  let body = '';
  [8, 20, 32, 44].forEach((y, i) => {
    const half = i % 2 ? 9 : 11;      // 半个波长的横向跨度
    const amp = i % 2 ? 2.6 : 3.4;    // 起伏幅度
    body += '<path d="M2 ' + y + 'q' + half + ' -' + amp + ' ' + (half * 2) + ' 0t' + (half * 2) + ' 0" ' +
      'fill="none" ' + strokeOf(ink, '#6B5B50', 1.7, '', 0.7 - i * 0.11) + ' stroke-linecap="round"/>';
  });
  return toUri('0 0 48 52', 48, 52, body);
}

/**
 * 邮戳的两块图形 → { ring, wave }
 * 文字层由调用方（album.wxml）叠在这两块之上。
 */
function postmarkParts(theme) {
  return { ring: postmarkRing(theme), wave: postmarkWave(theme) };
}

// ============================================================
// 齿边画框（品牌全案 · 稿屏5 AI 艺术重绘）：「艺术重绘」卡里那圈齿孔描边
//   —— 像从整版邮票上撕下来的一枚。
//
// ⚠️ 为什么这个图形要**带尺寸参数**、不能像别的装饰那样固定 64×44：
//   齿孔是**贴着框边跑一圈**的闭合线，框的宽高比变了，齿距就必须跟着变；
//   而 <image> 的 aspectFit 是先按 viewBox 等比缩放再居中，viewBox 和盒子
//   比例对不上就会上下/左右留白，齿孔线立刻偏离框边。
//   所以这里由调用方把盒子的 rpx 宽高一并传进来（1 viewBox 单位 = 1rpx），
//   WXSS 里写死的宽高必须与它一致 —— tests/art_repaint.test.js 有断言盯着。
// ============================================================
/**
 * @param {object} theme 主题色板（只取 text2 当墨色）
 * @param {number} w  框宽（rpx）
 * @param {number} h  框高（rpx）
 * @param {string} [ink] 墨色覆盖（不传则用主题 text2）
 */
function artFrame(theme, w, h, ink) {
  const c = theme || {};
  return toUri('0 0 ' + w + ' ' + h, w, h,
    '<path d="' + pinkedPath(w, h, 12, 2.6, 5) + '" fill="none" ' +
    strokeOf(ink || c.text2, '#C9A469', 1.8, '', 0.55) + '/>');
}

/**
 * 齿孔矩形 → path d（闭合，顺时针）
 * @param {number} w 宽  @param {number} h 高（与 viewBox 同单位）
 * @param {number} tooth 齿距  @param {number} amp 齿高（半个峰谷）  @param {number} inset 离边留白
 */
function pinkedPath(w, h, tooth, amp, inset) {
  const x0 = inset, y0 = inset, x1 = w - inset, y1 = h - inset;
  const pts = [];
  /** 沿一条边走齿：每隔 tooth 落一个点，垂直于边走正负 amp 交替 */
  const seg = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const n = Math.max(2, Math.round(len / tooth));
    const nx = (-dy / len) * amp, ny = (dx / len) * amp;
    for (let i = 0; i < n; i++) {
      const k = i % 2 ? -1 : 1;
      pts.push((ax + (dx * i) / n + nx * k).toFixed(1) + ' ' +
               (ay + (dy * i) / n + ny * k).toFixed(1));
    }
  };
  seg(x0, y0, x1, y0);
  seg(x1, y0, x1, y1);
  seg(x1, y1, x0, y1);
  seg(x0, y1, x0, y0);
  return 'M' + pts.join('L') + 'Z';
}

// ============================================================
// 齿边面板（品牌全案 · 稿屏9 年度回忆报告）：手撕纸片 / 水彩卡 / 齿边照片框
//   —— 稿屏9 里两张统计卡、四张照片的白框、AI 结语卡用的都是同一种「撕边纸」。
//
// ⚠️ 和 artFrame 一样：齿是贴着边跑一圈的，宽高比一变齿距就错位，
//    所以尺寸由调用方传进来，1 viewBox 单位 = 1rpx，WXSS 的盒子必须与之一致。
//
// 【为什么水彩底要两团径向渐变、而不是一个纯色】
//   纯色平涂出来是「贴上去的色块」，没有纸被水洇开的深浅；
//   这里用一枚偏移的径向渐变当底，深浅过渡就是颜料浓淡的观感。
// ============================================================
let _panelSeq = 0;

/**
 * @param {number} w 面板宽（rpx）  @param {number} h 面板高（rpx）
 * @param {object} o
 *   fill       底色（无 blotch 时即纯色）
 *   blotch     [深色, 浅色] 两色水彩晕（给了就盖过 fill）
 *   ink        齿边描边色（缺省藤黄）  strokeW / strokeAlpha 描边粗细与浓度
 *   stroke     === false 时只填不描边
 *   tooth/amp/inset  齿距 / 齿高 / 离边留白
 *   fillOpacity 底填充的整体透明度
 */
function pinkedPanel(w, h, o) {
  const c = o || {};
  const inset = c.inset == null ? 5 : c.inset;
  const amp = c.amp == null ? 5 : c.amp;
  const d = pinkedPath(w, h, c.tooth || 20, amp, inset);
  const id = 'pp' + (++_panelSeq);
  let defs = '';
  let fill = c.fill || '#FFFDF8';
  if (c.blotch && c.blotch.length === 2) {
    defs = '<radialGradient id="' + id + '" cx="0.34" cy="0.26" r="0.92">' +
      '<stop offset="0" stop-color="' + c.blotch[0] + '"/>' +
      '<stop offset="1" stop-color="' + c.blotch[1] + '"/></radialGradient>';
    fill = 'url(#' + id + ')';
  }
  return toUri('0 0 ' + w + ' ' + h, w, h,
    defs +
    '<path d="' + d + '" fill="' + fill + '"' +
      (c.fillOpacity == null ? '' : ' fill-opacity="' + c.fillOpacity + '"') + '/>' +
    (c.stroke === false ? '' :
      '<path d="' + d + '" fill="none" ' +
      strokeOf(c.ink, '#C9A469', c.strokeW || 1.8, '', c.strokeAlpha == null ? 0.45 : c.strokeAlpha) + '/>'));
}

/**
 * 花邮票（稿屏5「艺术重绘」卡右上角那枚）：齿边粉底 + 中间一朵五瓣小花。
 * 与 artFrame 共用走齿逻辑，只是这里尺寸固定（48×48），可以登记进 DECO_VIEWBOX。
 */
function flowerStamp(c) {
  const petal = '<ellipse cx="24" cy="16.6" rx="5.4" ry="7.6" ' + fillOf(c.petal, '#E8AFA8', 0.85) + '/>';
  let body = '<path d="' + pinkedPath(48, 48, 6, 1.8, 3) + '" ' +
    fillOf(c.soft, '#FBE3E7', 0.9) + ' ' + strokeOf(c.primary, '#D98E9B', 1.2, '', 0.7) + '/>';
  for (let i = 0; i < 6; i++) {
    body += '<g transform="rotate(' + i * 60 + ' 24 24)">' + petal + '</g>';
  }
  body += '<circle cx="24" cy="24" r="4" ' + fillOf(c.center, '#E8C070') + '/>';
  return toUri('0 0 48 48', 48, 48, body);
}

// ============================================================
// 首页票根墙（稿屏2）的页边装饰层
// ============================================================
// 稿子两侧的页边铺满了枝叶、波浪、色块、星星 —— 这是这一版「手账感」的主要来源。
// 8.2.0 之前这些一个都没有，整页光秃秃，所以看着素、看着空。
//
// 【为什么做成一张整屏大图铺成页面底纹，而不是 wxml 里的一层 view】
//   1) 底纹天然在内容之下，不用跟一摞 z-index 打架；
//   2) 页面根节点带 .fade-up，动画播完仍留着 transform: translateY(0)，
//      fixed 后代会把它当包含块、跟着页面一起滚（见 home.wxml 里 .guide-mask 的注释）；
//   3) 底纹随背景重复，翻到第几屏边上都有东西，不会只有首屏好看。
//
// 【坐标怎么来的】稿子 1152×2048，机器 750×1454rpx，两个方向缩放比不同（稿子是
//   9:16，机器不是），所以 x 与 y 各按各的比例量：x_rpx = x_稿 × 750/1152，
//   y_rpx = y_稿 × 1454/2048。每个位置都是从稿子上按行扫出来的色差段（见
//   docs/UI复刻差异清单.md 稿屏 02），不是目测。颜色也是从稿子取的，落回品牌标准色。

/** 一片叶：从 (x,y) 出发，叶尖朝 ang 方向（度，0 = 正上，正值顺时针），长 len
 *  edge 是描边色。8.2.0 补的：这张底图铺在根节点上、按 750rpx 宽的 viewBox 缩到屏幕，
 *  实机缩放比约 0.5 —— 纯色块缩完边缘就化成糊，只有一圈略深的描边能把叶形留住。 */
function leafAt(x, y, ang, len, col, op, edge) {
  const w = round2(len * 0.44);
  const b = round2(len * 0.72);
  const l = round2(len * 0.3);
  return '<path d="M0 0C' + w + ' -' + l + ' ' + w + ' -' + b + ' 0 -' + len +
    'C-' + w + ' -' + b + ' -' + w + ' -' + l + ' 0 0Z" ' +
    fillOf(col, '#A9C3A6', op) +
    (edge ? ' stroke="' + edge + '" stroke-width="1.4" stroke-opacity="' + (op == null ? 1 : op) + '"' : '') +
    ' transform="translate(' + x + ' ' + y + ') rotate(' + ang + ')"/>';
}

/** 一枝叶 = 一条弯茎 + 沿途交错长出的叶（稿里两侧全是这个长相，不是单摆的叶子） */
function twigAt(d, leaves, col, stemCol) {
  let s = '<path d="' + d + '" fill="none" ' +
    strokeOf(stemCol, '#A9C3A6', 3, '', 1) + ' stroke-linecap="round"/>';
  for (let i = 0; i < leaves.length; i++) {
    const L = leaves[i];
    s += leafAt(L[0], L[1], L[2], L[3], col, L[4] == null ? 1 : L[4], stemCol);
  }
  return s;
}

/**
 * 有机色块：稿子两侧那些"圆"其实都不是正圆，是水彩一样化开的块。
 * 8 个控制点、半径各自扰动，再用「相邻点中点为锚、控制点落在点上」的二次曲线连成闭环 ——
 * 这是画平滑闭合曲线最省事的写法（不用算切线），出来的边自然是软的。
 * seed 决定扰动序列：同一个 seed 每次编译结果一样，不会每次进页面形状都变。
 */
function blobAt(cx, cy, rx, ry, col, op, seed) {
  const n = 8;
  const s0 = seed || 0;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.84 + 0.24 * Math.abs(Math.sin(s0 * 7.3 + i * 2.1));
    pts.push([round2(cx + Math.cos(a) * rx * k), round2(cy + Math.sin(a) * ry * k)]);
  }
  const mid = (p, q) => [round2((p[0] + q[0]) / 2), round2((p[1] + q[1]) / 2)];
  const m0 = mid(pts[0], pts[1]);
  let d = 'M' + m0[0] + ' ' + m0[1];
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n];
    const m = mid(p, pts[(i + 1) % n]);
    d += 'Q' + p[0] + ' ' + p[1] + ' ' + m[0] + ' ' + m[1];
  }
  return '<path d="' + d + 'Z" ' + fillOf(col, '#C4C89E', op) + '/>';
}

/** 四角星（凹边，像一颗小火花）：尖角到中心 r */
function star4At(x, y, r, col, op) {
  const k = round2(r * 0.14);
  return '<path d="M' + x + ' ' + (y - r) +
    'Q' + x + ' ' + (y - k) + ' ' + (x + r) + ' ' + y +
    'Q' + (x + k) + ' ' + y + ' ' + x + ' ' + (y + r) +
    'Q' + x + ' ' + (y + k) + ' ' + (x - r) + ' ' + y +
    'Q' + (x - k) + ' ' + y + ' ' + x + ' ' + (y - r) + 'Z" ' +
    fillOf(col, '#F6DFA8', op) + '/>';
}

/** 手绘波浪：从 (x,y) 起，n 个波峰，每峰宽 seg */
function waveAt(x, y, n, seg, w, col, op) {
  let d = 'M' + x + ' ' + y;
  for (let i = 0; i < n; i++) d += 'q' + round2(seg / 2) + ' -' + round2(seg * 0.5) + ' ' + seg + ' 0';
  return '<path d="' + d + '" fill="none" ' + strokeOf(col, '#F4C6B4', w, '', op) +
    ' stroke-linecap="round"/>';
}

/**
 * @param {object} o 可选色：leaf 叶 / leafDeep 深叶 / petal 花与色块 / gold 金，缺省取下面这四个
 * @return {string} 750×1454rpx 的整屏页边装饰 data-uri（供 .tk-page 的 background-image）
 *
 * 下面这四个色不是"品牌标准色"，是从稿子上取的**落地值**（即已经和奶油底混过之后的成品色，
 * 见 docs/UI复刻差异清单.md 稿屏 02）。所以它们直接不透明铺上去就是稿子的样子；
 * 用品牌色 + 透明度去凑，混出来的绿会偏冷偏灰（第一版就是这么错的）。
 */
function homeEdges(o) {
  const c = o || {};
  // 8.2.0 第三版：叶色退回稿子的实测值，色块也压了一档不透明度。
  // 中间为了「看得见」把这一层加深加大过一轮（叶 #BFC58F、色块 op 1）—— 那是卡片 279 高、
  // 整页挤在一起时的补偿：页边不抢眼就压不住满屏的卡。卡片收小、三行归位之后，
  // 这层就该退回去当背景了 —— 稿子上它本来就是很淡的一层。
  const leaf = c.leaf || '#D2D2B2';        // 叶（稿实测 #D4D4B3）
  const leafDeep = c.leafDeep || '#B4B284'; // 深叶、茎、叶的描边（稿子叶脉实测 #ACAA6D）
  const petal = c.petal || '#F6CDB4';      // 桃色色块（稿 #F7D6C2）
  const gold = c.gold || '#E9C77F';        // 金（稿 #F8E0B0 略深一档才看得见）
  const BLOB = 0.7;                        // 实心色块压在米底上最扎眼，单独压一档

  let s = '';

  // ——— 左页边 ———
  s += twigAt('M26 296Q52 262 92 214', [
    [46, 274, -56, 54], [68, 246, 42, 50], [88, 218, -52, 46]
  ], leaf, leafDeep);
  s += blobAt(6, 488, 84, 64, petal, BLOB, 1);
  s += twigAt('M12 650Q38 614 78 566', [
    [32, 628, -54, 50], [54, 600, 44, 46], [74, 570, -50, 42]
  ], leaf, leafDeep);
  s += blobAt(-4, 668, 78, 60, leaf, BLOB, 2);
  s += blobAt(-6, 796, 74, 58, leaf, BLOB, 3);
  s += blobAt(-10, 958, 70, 64, petal, BLOB, 4);
  s += twigAt('M18 1214Q44 1178 86 1128', [
    [38, 1192, -56, 52], [60, 1164, 42, 48], [82, 1132, -50, 44]
  ], leaf, leafDeep);
  s += star4At(96, 1146, 15, gold, 1);
  s += waveAt(6, 1252, 3, 34, 3, gold, 1);

  // ——— 右页边 ———
  s += waveAt(618, 186, 4, 38, 3.2, petal, 1);
  s += waveAt(618, 204, 4, 38, 2.8, petal, 1);
  s += waveAt(618, 220, 4, 38, 2.4, petal, 0.8);
  s += blobAt(772, 450, 80, 62, petal, BLOB, 5);
  s += twigAt('M770 792Q742 742 728 686', [
    [756, 764, 34, 52], [742, 730, -132, 50], [732, 698, 30, 46]
  ], leaf, leafDeep);
  s += waveAt(694, 866, 3, 34, 3, gold, 1);
  s += waveAt(712, 892, 3, 34, 2.6, gold, 0.85);
  s += star4At(736, 1072, 19, gold, 1);
  s += blobAt(780, 1206, 76, 66, leaf, BLOB, 6);

  return toUri('0 0 750 1454', 750, 1454, s);
}

module.exports = {
  decoSrc, previewSrc, postmarkParts, artFrame, flowerStamp, pinkedPanel, homeEdges
};
