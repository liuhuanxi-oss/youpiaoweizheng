// pages/theme/theme.js —— 主题选择页（v6.5 六主题「皮肤」）
// ============================================================
// 六张统一版式卡片：顶部 IP 头像 → 主题名 → 6 色色板（含 hex）
//                  → 字体层级样例 → 4 个装饰元素图形
// 交互：点卡片 = 即时预览（当场换肤，不落库）
//       「应用此主题」= setTheme 落库 + 提示 + 返回
//
// 7.0.0 修：头像与装饰元素原先是**内联 <svg> 标签**，小程序 wxml 不渲染，
//   真机上这 20 处图形全空白。现改为 utils/deco.js 在 JS 侧拼 SVG 实色 →
//   base64 → <image src="data:image/svg+xml;base64,...">（见 utils/svg.js）。
//   颜色不能再用 CSS 变量（<image> 载入的 SVG 是独立文档，继承不到页面变量），
//   所以在 onLoad 时按每套主题的色板一次性编译好，随 cards 一起 setData。
// ============================================================
const themeUtil = require('../../utils/theme.js');
const deco = require('../../utils/deco.js');
const { iconSrc } = require('../../utils/icons.js');
const haptics = require('../../utils/haptics.js'); // 7.4.0：触觉三档，别再直接写 vibrateShort

/** 把主题元数据 + 编译好的图形 data-uri 合成卡片数组（wxml 只认这个） */
function buildCards() {
  return themeUtil.THEME_META.map((t) => Object.assign({}, t, {
    avatarSrc: deco.avatarSrc(t),
    decoItems: t.decos.map((d) => ({
      name: d,
      label: themeUtil.DECO_LABELS[d] || '',
      src: deco.decoSrc(d, t)
    }))
  }));
}

Page({
  data: {
    theme: 'paper',           // 当前生效主题（已落库）
    preview: 'paper',         // 预览中主题（未落库时与 theme 不同）
    cards: [],
    typeScale: themeUtil.TYPE_SCALE,
    ic: {}
  },

  onLoad() {
    const cur = themeUtil.getTheme();
    // 编译 6 套 ×（1 头像 + 4 装饰）共 30 张 SVG，一次性 setData (~18KB)
    // 「当前预览」的勾选标记走 icons.js（原先是字符 ✓，真机字形覆盖不可控）：
    // 它恒为白描线、压在卡片自己的主题色圆底上，故只需编译一次
    this.setData({
      theme: cur, preview: cur, cards: buildCards(),
      ic: { check: iconSrc('check', '#FFF8F2', 0, 2) }
    });
  },

  onShow() {
    // 页面根节点挂 theme-{{preview}}，预览期间就能整页换肤
    this.setData({ theme: themeUtil.getTheme() });
  },

  /** 点选卡片 = 即时预览（不落库） */
  onPick(e) {
    const k = e.currentTarget.dataset.key;
    if (!k || k === this.data.preview) return;
    haptics.tap();
    this.setData({ preview: k });
  },

  /** 确认应用：落库 + 同步导航栏 + 返回 */
  onApply() {
    const k = this.data.preview;
    if (!themeUtil.setTheme(k)) {
      wx.showToast({ title: '主题切换失败', icon: 'none' });
      return;
    }
    haptics.confirm();
    themeUtil.apply(this);
    const meta = themeUtil.getThemeMeta(k);
    wx.showToast({ title: `已应用「${meta.name}」`, icon: 'none', duration: 1200 });
    setTimeout(() => {
      const pages = getCurrentPages();
      if (pages.length > 1) wx.navigateBack();
      else wx.switchTab({ url: '/pages/me/me' });
    }, 700);
  },

  /** 还原为已落库主题（放弃本次预览） */
  onReset() {
    const cur = themeUtil.getTheme();
    haptics.tap();
    this.setData({ preview: cur });
  }
});
