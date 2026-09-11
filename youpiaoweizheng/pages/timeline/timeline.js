// pages/timeline/timeline.js —— M4-b 双人时间线完整版
// 「我们的时间线」：双方全部票根按月分组，TA 的票带归属标记，同场挂「一起」。
// 权限现实：详情数据仅创建者可见（store.getTicket 只查自己的票）——
//   自己的票点行进详情；TA 的票行内展开（不进详情，避免空页）。
// 数据：utils/duoData.loadMerged（云 = duoStats full / 演示 = mock），与 duo/report 三页同源。
const duoData = require('../../utils/duoData.js');
const couple = require('../../utils/couple.js');
const { groupLabel } = require('../../utils/date.js');
const themeUtil = require("../../utils/theme.js");
const sk = require('../../utils/skeleton.js');

const TYPE_TEXT = { show: '演出', movie: '电影', traffic: '交通' };

Page({

  onShow() {
    themeUtil.apply(this);
  },
  data: {
    theme: "a", legacyTheme: "a",
    skeleton: false,
    demo: false,
    total: 0,
    cities: 0,
    months: [],     // [{ label:'2025 · 十月', rows:[...] }]
    expandId: '',   // TA 的票行内展开的 id
    error: ''
  },

  onLoad() {
    this.load();
  },

  async load() {
    sk.start(this);
    this.setData({ error: '' });
    try {
      const c = await couple.queryCouple();
      if (!c || !c.boundAt) {
        this.setData({ error: '尚未绑定双人空间' });
        return;
      }
      const merged = await duoData.loadMerged(c);
      const tks = duoData.togetherKeys(merged.items);

      // 按月分组（items 已按日期倒序）
      const months = [];
      const idx = {};
      merged.items.forEach((t) => {
        const label = groupLabel(t.date);
        if (idx[label] === undefined) {
          idx[label] = months.length;
          months.push({ label, rows: [] });
        }
        months[idx[label]].rows.push({
          ...t,
          typeText: TYPE_TEXT[t.type] || '时光',
          together: tks.has(t.eventKey || `${t.venue}|${t.date}` || `${t.title}|${t.date}`)
        });
      });

      this.setData({
        demo: merged.demo,
        total: merged.total,
        cities: merged.cities,
        months,
        expandId: ''
      });
    } catch (e) {
      this.setData({ error: String(e.message || e).slice(0, 60) });
    } finally {
      sk.end(this);
    }
  },

  // 自己的票 → 详情；TA 的票 → 行内展开（详情数据仅创建者可见，TA 的票进详情必空页）
  onRow(e) {
    const { id, mine } = e.currentTarget.dataset;
    if (String(mine) === 'true' || mine === true) {
      wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
      return;
    }
    wx.vibrateShort({ type: 'light' });
    this.setData({ expandId: this.data.expandId === id ? '' : id });
  },

  /** 4.12.1 空态直达录入（与 wall 空态同构） */
  goScan() {
    wx.navigateTo({ url: '/pages/scan/scan' });
  }
});
