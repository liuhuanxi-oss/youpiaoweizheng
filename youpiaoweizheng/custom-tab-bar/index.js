// custom-tab-bar/index.js —— v7.0 自定义 tabBar（按《精修》规范图重做）
// ============================================================
// 结构：票根墙 / 时光机 /〔中央凸起相机〕/ 回忆地图 / 我的
//   —— 与设计规范图逐项对齐：
//      栏高 56pt(112rpx)　图标 24pt(48rpx)　文字 10pt(20rpx)
//      选中色 #D9A0A6 + 图标下方小圆点　未选色 #6B5B50（40% 透明）　栏底 毛玻璃白
//      中央相机钮 直径 56pt(112rpx)、凸起 12pt(24rpx)
//
// ⚠️ 本文件的两处关键修正（v7.0）：
//   1. 图标由「内联 <svg> 标签」改为「<image> + data-uri SVG」。
//      微信小程序 WXML **不支持内联 svg 标签**（小程序没有 SVG 原生渲染树，
//      <svg> 会被当作普通自定义组件容器，子元素 path/circle 全部丢弃），
//      结果是 4 个 tab 图标**一个都不显示**、只剩文字。本仓库
//      components/svg-icon 与 CHANGELOG 4.10.7 都记录过这个坑，
//      这里改走官方 image 组件（image 原生支持 SVG），颜色在拼 SVG 字符串时
//      直接写进 stroke —— 不依赖 mask、不依赖 currentColor。
//   2. 图标造型按规范图更正：时光机=时钟（原误用票根）、回忆地图=折页地图
//      （原误用罗盘）、票根墙=票根、我的=人像。
//
// ⚠️ 自定义组件独立渲染树，不继承 app.wxss 挂在 page 上的 CSS 变量，
//    故 index.wxss 内按主题类重新声明一份令牌；此处只额外需要「图标描边色」，
//    单独用 THEME_INK 表镜像一份（改色时与 index.wxss / theme.js 同步）。
const themeUtil = require('../utils/theme.js');
const { iconSrc } = require('../utils/icons.js');

// —— 描边色（十六进制实色：SVG 属性不认 var() / rgba()）——
// on = 选中态主色；off = 未选色（#6B5B50 基准，按各主题正文色调配）
// op  = 未选态透明度（规范图：未选色 40% 透明）
const THEME_INK = {
  paper:   { on: '#2B2420', off: '#2B2420' },
  glass:   { on: '#D9A0A6', off: '#6B5B50' },
  collage: { on: '#D9A0A6', off: '#6B5B50' },
  film:    { on: '#C26B5E', off: '#EDE3D6' },
  literary:{ on: '#A9C3A6', off: '#6B5B50' },
  minimal: { on: '#1A1A1A', off: '#1A1A1A' }
};
const OFF_OPACITY = 0.4;

/** 4 个 tab 的文案与图标名（顺序即 app.json tabBar.list 顺序） */
const TABS = [
  { text: '票根墙', ico: 'ticket' },
  { text: '时光机', ico: 'clock' },
  { text: '回忆地图', ico: 'map' },
  { text: '我的', ico: 'user' }
];

/** 按主题算出 4 个 tab 的选中/未选图标地址 */
function buildList(theme) {
  const ink = THEME_INK[theme] || THEME_INK.glass;
  return TABS.map((t, idx) => ({
    idx,
    text: t.text,
    ico: t.ico,
    icoOn: iconSrc(t.ico, ink.on, 1),
    icoOff: iconSrc(t.ico, ink.off, OFF_OPACITY)
  }));
}

Component({
  data: {
    selected: 0,
    theme: 'glass',
    list: buildList('glass')
  },

  // 各 tab 页 onShow 会 setData({ theme }) 同步主题；图标是位图 src，
  // 换主题必须重建 list（不能靠 CSS 变量），故用 observer 兜住所有入口
  observers: {
    theme(t) {
      const k = themeUtil.THEMES.indexOf(t) !== -1 ? t : themeUtil.DEFAULT_THEME;
      const list = buildList(k);
      // 只在真的换了主题时写回，避免无谓的 setData
      if (!this.data.list || this.data.list[0].icoOn !== list[0].icoOn) {
        this.setData({ list });
      }
    }
  },

  lifetimes: {
    attached() {
      const t = themeUtil.getTheme();
      this.setData({ theme: t, list: buildList(t) });
    }
  },

  methods: {

    switchTab(e) {
      wx.vibrateShort({ type: 'light' });
      const idx = e.currentTarget.dataset.idx;
      if (idx == null) return;
      const map = ['/pages/home/home', '/pages/album/album', '/pages/discover/discover', '/pages/me/me'];
      wx.switchTab({ url: map[idx] });
    },

    goFab() {
      wx.vibrateShort({ type: 'medium' });
      wx.navigateTo({ url: '/pages/scan/scan' });
    }
  }
});
