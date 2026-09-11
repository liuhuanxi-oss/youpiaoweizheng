// custom-tab-bar/index.js —— v6.5 自定义 tabBar（4 tab + 中央凸起主色 + 按钮）
// 4 tab：首页 / 票夹 / 发现 / 我的；中央 FAB 跳上传识别（非 tab 页）
// 由各 tab 页在 onShow 里同步 selected（0/1/2/3）与 theme（六主题 key）。
// ⚠️ 自定义组件独立渲染树，不继承 app.wxss 挂在 page 上的 CSS 变量，
//    故组件 wxss 内按主题类重新声明一份令牌（见 index.wxss）。
const themeUtil = require('../utils/theme.js');

Component({
  data: {
    selected: 0,
    theme: 'paper',            // 跟随全局主题（各 tab 页 onShow 注入）
    list: [
      { text: '票根墙', ico: 'home', idx: 0 },
      { text: '时光机', ico: 'ticket', idx: 1 },
      { text: '回忆地图', ico: 'compass', idx: 2 },
      { text: '我的', ico: 'user', idx: 3 }
    ]
  },
  lifetimes: {
    attached() {
      this.setData({ theme: themeUtil.getTheme() });
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
