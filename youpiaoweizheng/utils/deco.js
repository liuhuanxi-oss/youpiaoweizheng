// utils/deco.js —— 主题装饰图形（IP 头像 + 19 款装饰元素）  v7.0 新增
// ============================================================
// 【为什么需要这个文件】
//   theme 页的 IP 头像与 4 个装饰元素，原来是用**内联 <svg> 标签**写的。
//   微信小程序 wxml 不渲染 <svg>（详见 utils/icons.js 顶部说明：视图层没有
//   SVG 原生渲染树，<svg>/<path> 被当未知自定义组件容器，子元素全部丢弃）。
//   结果是真机上这 20 处图形**全是空白**，只剩底下的中文角标。
//
// 【为什么颜色要在 JS 里编译，不能继续用 var(--primary)】
//   改成 <image src="data:image/svg+xml,..."> 之后，SVG 是一份**独立文档**，
//   页面的 CSS 变量不会继承进去，var() 一律失效、图形变黑或消失。
//   所以这里在拼 SVG 时就把该主题的具体色值写进去 —— 这也是色彩能随
//   主题切换的唯一办法（theme 页一次渲染 6 套主题，本来就各要一套实色）。
//
// 【用法】
//   const deco = require('../../utils/deco.js');
//   deco.avatarSrc(themeMeta)          // → 头像 data-uri
//   deco.decoSrc('postmark', themeMeta) // → 装饰元素 data-uri
//   themeMeta 直接传 utils/theme.js 里的 THEME_META 元素（含 bg/primary/accent…）
// ============================================================

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
      fillOf(c.accent, '#F5C86A') + '/>'
};

/** 每款装饰各自的 viewBox（宽高比不同，靠它让 image 的 aspectFit 算出正确比例） */
const DECO_VIEWBOX = {
  wave: '0 0 64 20',
  dots: '0 0 64 40',
  sprig: '0 0 66 44',
  wavelines: '0 0 64 28',
  heartsmall: '0 0 32 32',
  star4: '0 0 32 24'
};
const DECO_VIEWBOX_DEFAULT = '0 0 64 44';

// ============================================================
// IP 头像：六套一致形象，仅换色（渔夫帽 + 卷发 + 白卫衣）
// 肤色 #FFE0C8 与卫衣 #FFFFFF 是固定值，不随主题走
// ============================================================
const SKIN = '#FFE0C8';
const HOODIE = '#FFFFFF';

function avatarBody(c) {
  return '<ellipse cx="40" cy="27" rx="26" ry="8" ' + fillOf(c.primary, '#2B2420', 0.92) + '/>' +
    '<path d="M24 27Q24 12 40 12Q56 12 56 27Z" ' + fillOf(c.accent, '#C26B5E') + '/>' +
    '<circle cx="27" cy="37" r="7" ' + fillOf(c.text, '#2B2420', 0.86) + '/>' +
    '<circle cx="53" cy="37" r="7" ' + fillOf(c.text, '#2B2420', 0.86) + '/>' +
    '<ellipse cx="40" cy="43" rx="18" ry="17" fill="' + SKIN + '"/>' +
    '<circle cx="33" cy="42" r="2.6" ' + fillOf(c.text, '#2B2420') + '/>' +
    '<circle cx="47" cy="42" r="2.6" ' + fillOf(c.text, '#2B2420') + '/>' +
    '<ellipse cx="28" cy="49" rx="4" ry="2.4" ' + fillOf(c.primary, '#2B2420', 0.34) + '/>' +
    '<ellipse cx="52" cy="49" rx="4" ry="2.4" ' + fillOf(c.primary, '#2B2420', 0.34) + '/>' +
    '<path d="M36 51Q40 55 44 51" fill="none" ' +
      strokeOf(c.accent, '#C26B5E', 2, '') + ' stroke-linecap="round"/>' +
    '<path d="M22 68Q22 58 40 58Q58 58 58 68Z" fill="' + HOODIE + '"/>';
}

/** 包一层 svg 根节点并转成可直接塞进 <image src> 的 data-uri */
function toUri(viewBox, w, h, body) {
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='" + viewBox +
    "' width='" + w + "' height='" + h + "' fill='none'>" + body + '</svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
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

/**
 * IP 头像 → data-uri
 * @param {object} theme  THEME_META 里的一个主题
 */
function avatarSrc(theme) {
  return toUri('0 0 80 80', 80, 80, avatarBody(theme || {}));
}

module.exports = { decoSrc, avatarSrc };
