// pages/discover/discover.js —— v6.0 发现/回忆地图（3D 地图预览 + 时间轴）
// ============================================================
// 顶部数据：足迹点亮 N 城 / 累计 M 张；地图区为 CSS 渐变占位（TODO 由设计提供 SVG/PNG 城市插画）；
// 时间轴按月分组列出票根（点击进详情）。
// ============================================================
const store = require('../../utils/store.js');
const themeUtil = require("../../utils/theme.js");
const track = require('../../utils/track.js');

Page({
  data: {
    theme: 'paper',
    loading: true,
    total: 0,
    cities: 0,
    cityList: [],       // 城市列表（按出现频次倒序）
    timeline: [],       // 时间轴：[{label, list: [tickets]}]
    showAll: false
  },

  _tabIndex: 2,

  onShow() {
    themeUtil.apply(this);
    this.getTabBar && this.getTabBar().setData({ selected: 2, theme: themeUtil.getTheme() });
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  async refresh() {
    this.setData({ loading: true });
    try {
      const raw = await store.listTickets();
      const all = (raw || []).filter((t) => t && t.title);
      const total = all.length;
      const cityMap = new Map();
      all.forEach((t) => {
        if (!t.city) return;
        const c = String(t.city);
        cityMap.set(c, (cityMap.get(c) || 0) + 1);
      });
      const cityList = Array.from(cityMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([city, count], idx) => ({ city, count, idx }));
      // 时间轴：按月分组
      const monthMap = new Map();
      all.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).forEach((t) => {
        const ym = String(t.date || '').slice(0, 7);
        if (!ym) return;
        if (!monthMap.has(ym)) monthMap.set(ym, []);
        monthMap.get(ym).push(t);
      });
      const timeline = Array.from(monthMap.entries()).map(([ym, list]) => {
        const [y, m] = ym.split('-');
        return { label: `${y} 年 ${parseInt(m, 10)} 月`, ym, list };
      });
      this.setData({ loading: false, total, cities: cityMap.size, cityList, timeline });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  toggleShowAll() { this.setData({ showAll: !this.data.showAll }); },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  goMapFull() {
    track.track('discover_map_full', {});
    wx.navigateTo({ url: '/pages/map/map' });
  }
});
