// pages/theme/theme.js —— 主题选择页（v6.5 六主题「皮肤」）
// ============================================================
// 六张统一版式卡片：顶部 IP 头像 → 主题名 → 6 色色板（含 hex）
//                  → 字体层级样例 → 4 个装饰元素 SVG
// 交互：点卡片 = 即时预览（当场换肤，不落库）
//       「应用此主题」= setTheme 落库 + 提示 + 返回
// 装饰 SVG 全部内联在 wxml，颜色直接读 CSS 变量，随主题换色。
// ============================================================
const themeUtil = require('../../utils/theme.js');

Page({
  data: {
    theme: 'paper',           // 当前生效主题（已落库）
    preview: 'paper',         // 预览中主题（未落库时与 theme 不同）
    themes: themeUtil.THEME_META,
    typeScale: themeUtil.TYPE_SCALE,
    // 装饰元素类型 → 供 wxml 内联 SVG 分支渲染（4 个/主题）
    decoLabels: themeUtil.DECO_LABELS
  },

  onLoad() {
    const cur = themeUtil.getTheme();
    this.setData({ theme: cur, preview: cur });
  },

  onShow() {
    // 页面根节点挂 theme-{{preview}}，预览期间就能整页换肤
    this.setData({ theme: themeUtil.getTheme() });
  },

  /** 点选卡片 = 即时预览（不落库） */
  onPick(e) {
    const k = e.currentTarget.dataset.key;
    if (!k || k === this.data.preview) return;
    wx.vibrateShort({ type: 'light' });
    this.setData({ preview: k });
  },

  /** 确认应用：落库 + 同步导航栏 + 返回 */
  onApply() {
    const k = this.data.preview;
    if (!themeUtil.setTheme(k)) {
      wx.showToast({ title: '主题切换失败', icon: 'none' });
      return;
    }
    wx.vibrateShort({ type: 'medium' });
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
    wx.vibrateShort({ type: 'light' });
    this.setData({ preview: cur });
  }
});
