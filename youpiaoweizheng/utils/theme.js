// utils/theme.js —— 主题系统（双轨）
// ============================================================
// 轨道一（v6.5 · 六主题「皮肤」）—— 由 8 套风格方案保留 1/2/4/5/6/8 而来
//   paper    纸感杂志 —— 米白纸底 · 衬线刊头 · 编辑网格 · 墨黑主色
//   glass    柔和玻璃 —— 弥散光斑 · 磨砂玻璃卡 · 大圆角 · 灰玫粉
//   collage  手账拼贴 —— 胶带贴纸 · 便签卡 · 轻微旋转 · 手写衬线（默认）
//   film     胶片电影 —— 深褐暗底 · 胶片颗粒 · 暖黄光晕 · 暗房感（深色）
//   literary 清新文艺 —— 水彩晕染 · 淡彩 · 大圆角白卡 · 鼠尾草绿
//   minimal  极简留白 —— 纯白底 · 大字标题 · 细线分隔 · 图片主导
//   Storage key: app_theme   页面根节点 class: theme-{{theme}}
//   令牌定义在 app.wxss，前缀 .theme-*；通用类前缀 .tk-*
//
// 轨道二（4.9.0 · 历史兼容）纸感三主题 theme-a/b/c
//   a 纸质收藏册 / b 午夜现场 / c 手账水彩
//   Storage key: sp_theme   供 detail/card/art/annual 等深色 Canvas 页继续使用
//
// 页面根节点同时挂两个 class（theme-{{theme}} tk-page theme-{{legacy}}），
// 新页面读 --primary/--bg/…，旧页面读 --ink/--paper/…，互不干扰。
// ============================================================

// —— 轨道一：v6.5 六主题 ——
const THEME_KEY = 'app_theme';
const THEMES = ['paper', 'glass', 'collage', 'film', 'literary', 'minimal'];
// 8.2.0：默认主题由 paper 改为 collage —— 品牌稿是奶油底 + 灰玫粉的手账风，
// 与 collage 的背景 #FAF5EE / 主色 #D9A0A6 / 强调 #F6DFA8 逐项对得上（paper 是墨黑+砖红，差得最远）。
// 注意：老用户若自己在「主题」页选过，storage 里已有值，这里不会覆盖他们的选择 —— 这是对的。
const DEFAULT_THEME = 'collage';

/** 六主题元数据：供选择页与 me 页卡片渲染
 *  每套含 dark（深色页，导航栏文字反白）与 serif（标题衬线）两个工程标志 */
const THEME_META = [
  {
    key: 'paper',
    name: '纸感杂志',
    tagline: '纸张肌理 · 衬线刊头 · 编辑网格',
    desc: '米白纸底配墨黑，像一本值得收藏的印刷刊物',
    swatches: [
      { name: '背景', hex: '#F5F0E6' },
      { name: '卡片', hex: '#FFFFFF' },
      { name: '主色', hex: '#2B2420' },
      { name: '强调', hex: '#C26B5E' },
      { name: '柔光', hex: '#E9E2D4' },
      { name: '正文', hex: '#2B2420' }
    ],
    bg: '#F5F0E6',
    card: '#FFFFFF',
    primary: '#2B2420',
    accent: '#C26B5E',
    soft: '#E9E2D4',
    text: '#2B2420',
    text2: '#8A7E6E',
    border: '#E2D9C7',
    dark: false,
    serif: true,
    decos: ['postmark', 'perf', 'rule', 'stamp']
  },
  {
    key: 'glass',
    name: '柔和玻璃',
    tagline: '弥散光斑 · 磨砂玻璃 · 层叠',
    desc: '奶油底上浮着粉黄绿的光，卡片像半透明的糖',
    swatches: [
      { name: '背景', hex: '#FAF5EE' },
      { name: '卡片', hex: '#FFFFFF' },
      { name: '主色', hex: '#D9A0A6' },
      { name: '强调', hex: '#F4C6B4' },
      { name: '柔光', hex: '#F6DFA8' },
      { name: '正文', hex: '#5A4D42' }
    ],
    bg: '#FAF5EE',
    card: '#FFFFFF',
    primary: '#D9A0A6',
    accent: '#F4C6B4',
    soft: '#F6DFA8',
    text: '#5A4D42',
    text2: '#A5968A',
    border: '#F0E7DC',
    dark: false,
    serif: false,
    decos: ['blob', 'glass', 'wave', 'dots']
  },
  {
    key: 'collage',
    name: '手账拼贴',
    tagline: '胶带贴纸 · 便签 · 手写',
    desc: '奶油底上贴满胶带和便签，松弛随性的手账',
    swatches: [
      { name: '背景', hex: '#F9F1E3' },
      { name: '卡片', hex: '#FFFFFF' },
      { name: '主色', hex: '#D9A0A6' },
      { name: '强调', hex: '#F6DFA8' },
      { name: '柔光', hex: '#FBF3D9' },
      { name: '正文', hex: '#5A4D42' }
    ],
    bg: '#F9F1E3',
    card: '#FFFFFF',
    primary: '#D9A0A6',
    accent: '#F6DFA8',
    soft: '#FBF3D9',
    text: '#5A4D42',
    text2: '#A5968A',
    border: '#EFE5D8',
    dark: false,
    serif: true,
    decos: ['tape', 'sticky', 'doodle', 'wave']
  },
  {
    key: 'film',
    name: '胶片电影',
    tagline: '暗房颗粒 · 暖黄光晕 · 时间码',
    desc: '深褐暗底配暖黄，像暗房里晾着的一段记忆',
    swatches: [
      { name: '背景', hex: '#1F1A17' },
      { name: '卡片', hex: '#2A2320' },
      { name: '主色', hex: '#C26B5E' },
      { name: '强调', hex: '#F6DFA8' },
      { name: '柔光', hex: '#3A302A' },
      { name: '正文', hex: '#EDE3D6' }
    ],
    bg: '#1F1A17',
    card: '#2A2320',
    primary: '#C26B5E',
    accent: '#F6DFA8',
    soft: '#3A302A',
    text: '#EDE3D6',
    text2: 'rgba(237,227,214,.5)',
    border: 'rgba(246,223,168,.22)',
    dark: true,
    serif: false,
    decos: ['filmperf', 'timecode', 'glow', 'wave']
  },
  {
    key: 'literary',
    name: '清新文艺',
    tagline: '水彩晕染 · 淡彩 · 线描',
    desc: '奶油白上晕开水彩，清新治愈的文艺手帖',
    swatches: [
      { name: '背景', hex: '#FAF5EE' },
      { name: '卡片', hex: '#FFFFFF' },
      { name: '主色', hex: '#A9C3A6' },
      { name: '强调', hex: '#F4C6B4' },
      { name: '柔光', hex: '#E8F0E6' },
      { name: '正文', hex: '#5A4D42' }
    ],
    bg: '#FAF5EE',
    card: '#FFFFFF',
    primary: '#A9C3A6',
    accent: '#F4C6B4',
    soft: '#E8F0E6',
    text: '#5A4D42',
    text2: '#9BAF98',
    border: '#E6EFE4',
    dark: false,
    serif: true,
    decos: ['watercolor', 'leaf', 'wave', 'dots']
  },
  {
    key: 'minimal',
    name: '极简留白',
    tagline: '大留白 · 大字 · 细线',
    desc: '纯白底上只有图和字，像美术馆的一枚展签',
    swatches: [
      { name: '背景', hex: '#FFFFFF' },
      { name: '卡片', hex: '#FFFFFF' },
      { name: '主色', hex: '#1A1A1A' },
      { name: '强调', hex: '#D9A0A6' },
      { name: '柔光', hex: '#F5F5F5' },
      { name: '正文', hex: '#1A1A1A' }
    ],
    bg: '#FFFFFF',
    card: '#FFFFFF',
    primary: '#1A1A1A',
    accent: '#D9A0A6',
    soft: '#F5F5F5',
    text: '#1A1A1A',
    text2: 'rgba(26,26,26,.5)',
    border: '#EDEDED',
    dark: false,
    serif: false,
    decos: ['line', 'dot', 'frame', 'wave']
  }
];

/** 字体层级样例（选择页统一版式） */
const TYPE_SCALE = [
  { label: '主标题', spec: '64rpx / 900', cls: 'tk-h1', sample: '有票为证' },
  { label: '副标题', spec: '38rpx / 500', cls: 'tk-h2', sample: '每一张票，都是回得去的时光' },
  { label: '正文', spec: '28rpx / 400', cls: 'tk-body', sample: '上海 · 梅赛德斯奔驰文化中心' },
  { label: '辅助', spec: '23rpx / 400', cls: 'tk-cap', sample: '2024-05-18 19:30' },
  { label: '数字统计', spec: '52rpx / 900', cls: 'tk-num', sample: '128' }
];

/** 装饰元素中文名（选择页角标） */
const DECO_LABELS = {
  postmark: '邮戳', perf: '齿孔', rule: '双线', stamp: '邮票',
  blob: '光斑', glass: '玻璃', wave: '波纹', dots: '圆点',
  tape: '胶带', sticky: '便签', doodle: '涂鸦',
  filmperf: '片孔', timecode: '时间码', glow: '光晕',
  watercolor: '水彩', leaf: '叶子',
  line: '细线', dot: '圆点', frame: '线框'
};

// —— 轨道二：4.9.0 纸感三主题（兼容保留，勿删）——
const LEGACY_KEY = 'sp_theme';
const LEGACY_VALID = ['a', 'b', 'c'];
const META = {
  a: { name: '纸质收藏册', desc: '米白 + 墨色 + 印章橘 · 产品默认' },
  b: { name: '午夜现场', desc: '深色 + 霓虹粉紫 · Livehouse 氛围' },
  c: { name: '手账水彩', desc: '奶油底 + 抹茶蜜桃 · 旅行手帖感' }
};

// ============================================================
// 轨道一 API：getTheme / setTheme
// ============================================================

/** 读取当前主题 key，异常/缺省回落 DEFAULT_THEME（collage） */
function getTheme() {
  try {
    const v = wx.getStorageSync(THEME_KEY);
    return THEMES.indexOf(v) !== -1 ? v : DEFAULT_THEME;
  } catch (e) {
    return DEFAULT_THEME;
  }
}

/** 写入主题 key 并持久化；非法值忽略（不抛错，避免打断交互） */
function setTheme(k) {
  if (THEMES.indexOf(k) === -1) return false;
  try {
    wx.setStorageSync(THEME_KEY, k);
    return true;
  } catch (e) {
    return false;
  }
}

/** 取主题元数据（key 非法时回落 DEFAULT_THEME 的 meta） */
function getThemeMeta(k) {
  const key = THEMES.indexOf(k) !== -1 ? k : DEFAULT_THEME;
  return THEME_META.find((t) => t.key === key) || THEME_META[0];
}

/** 是否深色主题（导航栏文字需反白） */
function isDark(k) {
  return getThemeMeta(k).dark === true;
}

// —— 导航栏 + 窗口背景配色 ——
// 原生区域无法用 CSS 变量，只能走 API；六主题取各自 --bg + 深/浅文字。
const THEME_NAV = {
  paper: { bg: '#F5F0E6', front: '#000000' },
  glass: { bg: '#FAF5EE', front: '#000000' },
  collage: { bg: '#F9F1E3', front: '#000000' },   // 与 --bg 同步（8.2.0 照品牌稿改）
  film: { bg: '#1F1A17', front: '#ffffff' },
  literary: { bg: '#FAF5EE', front: '#000000' },
  minimal: { bg: '#FFFFFF', front: '#000000' }
};

// ============================================================
// 轨道二 API（4.9.0 兼容保留）
// ============================================================
const KEY = LEGACY_KEY;
const VALID = LEGACY_VALID;

/** 当前纸感主题 key（'a' | 'b' | 'c'），异常时回落 a */
function current() {
  try {
    const v = wx.getStorageSync(LEGACY_KEY);
    return LEGACY_VALID.indexOf(v) !== -1 ? v : 'a';
  } catch (e) {
    return 'a';
  }
}

/** 切换纸感主题并持久化 */
function set(k) {
  if (LEGACY_VALID.indexOf(k) === -1) return;
  try { wx.setStorageSync(LEGACY_KEY, k); } catch (e) { /* 忽略 */ }
}

const NAV = {
  a: { bg: '#FDFBF7', front: '#000000' },
  b: { bg: '#0F0F1A', front: '#ffffff' },
  c: { bg: '#FFF9F0', front: '#000000' }
};

let _lastNav = '';

/**
 * 页面 onShow 调一次：把当前主题挂到 data 上（wxml 用 theme-{{theme}}）；
 * 同时同步导航栏/窗口背景（仅主题变化时调 API，避免无谓调用）。
 * 两个体系的导航栏配色合并判断：以 v6 六主题为准（v6 页面是当前主线）。
 */
function apply(page) {
  const k = getTheme();          // v6.5 六主题（主线）
  const lk = current();          // 纸感三主题（兼容）
  page.setData({ theme: k, legacyTheme: lk });
  if (_lastNav === k) return;
  const n = THEME_NAV[k] || THEME_NAV[DEFAULT_THEME];
  wx.setNavigationBarColor({
    frontColor: n.front,
    backgroundColor: n.bg,
    // 7.4.3：只有**真的设上了**才记账。原先无论成败都记 _lastNav，于是「页面尚未注册导航栏」
    // 那一次失败会把这套配色钉死一整个会话 —— 后面主题换了，顶部还是旧色且不再重试。
    // 失败不记账的代价只是下次进页面多调一次 API，比导航栏颜色一直错着便宜得多。
    success: () => { _lastNav = k; },
    fail: () => { /* 页面可能尚未注册导航栏，忽略；留给下次重试 */ }
  });
  if (wx.setBackgroundColor) {
    wx.setBackgroundColor({
      backgroundColor: n.bg,
      fail: () => { /* 部分场景不支持，忽略 */ }
    });
  }
}

module.exports = {
  // v6.5 六主题（主线）
  getTheme,
  setTheme,
  getThemeMeta,
  isDark,
  THEME_KEY,
  THEMES,
  DEFAULT_THEME,
  THEME_META,
  TYPE_SCALE,
  DECO_LABELS,
  // 4.9.0 纸感三主题（兼容）
  current,
  set,
  apply,
  META,
  KEY
};
