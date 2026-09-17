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
const { iconSrc } = require('../../utils/icons.js');
const haptics = require('../../utils/haptics.js'); // 7.4.0：触觉三档，别再直接写 vibrateShort

const TYPE_TEXT = { show: '演出', movie: '电影', traffic: '交通' };

Page({

  onShow() {
    themeUtil.apply(this);
    this.buildIc();
    // 每次显示都重取。本页数据只来自云，端上没有可依赖的脏标记，而页面栈里确实存在
    // 会改数据的路径：点自己的票进详情 → 删除 → 自动退回本页。原先只有 onLoad 与下拉会
    // 重取，删票回来那一行会留在原地，变成「点进去是空态」的幽灵行，页顶总张数也不变。
    // 首次给骨架，之后静默刷新（旧内容撑到新数据回来，不闪骨架）
    this.load(!!this._drawn);
  },
  data: {
    theme: "a", legacyTheme: "a",
    skeleton: false,
    demo: false,
    total: 0,
    cities: 0,
    months: [],     // [{ label:'2025 · 十月', rows:[...] }]
    expandId: '',   // TA 的票行内展开的 id
    error: '',
    bindNeeded: false, // 错误态分岔：没绑定（去绑定）vs 取数失败（重试）
    ic: {}
  },

  /** 空态/错误态图标按当前主题编译（data-uri 里的颜色是编译时写死的，切主题要重编） */
  buildIc() {
    const m = themeUtil.getThemeMeta(themeUtil.getTheme());
    this.setData({
      ic: {
        empty: iconSrc('calendar', m.text, 0.28, 1.4),
        link: iconSrc('users', m.text, 0.28, 1.4),
        chevron: iconSrc('chevron', m.text, 0.5, 1.5)
      }
    });
  },

  // onLoad 不取数：紧跟着的 onShow 一定会跑，两处都写等于首次进来拉两次

  /** 下拉刷新（7.2.0 V9）：本页根节点是普通 view、由页面本身滚动，故走页面级下拉，
      不用 scroll-view 的 refresher。TA 那边刚存了票根时，下拉是唯一的重取入口 ——
      此前本页只有 onLoad 拉一次，切回来永远是旧的。 */
  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  /** @param {boolean} silent 静默刷新：不闪骨架、失败也不砸掉已有内容 */
  async load(silent) {
    if (!silent) sk.start(this);
    this.setData({ error: '' });
    try {
      const c = await couple.queryCouple();
      if (!c || !c.boundAt) {
        this.setData({ error: '尚未绑定双人空间', bindNeeded: true });
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
          together: tks.has(duoData.eventKeyOf(t))
        });
      });

      this._drawn = true;
      this.setData({
        demo: merged.demo,
        total: merged.total,
        cities: merged.cities,
        months,
        expandId: ''
      });
    } catch (e) {
      // 静默刷新失败：留着旧内容 —— 用户刚看完列表返回，网络抖一下不该把整页换成错误页
      if (!silent) this.setData({ error: String((e && e.errMsg) || e.message || e).slice(0, 60), bindNeeded: false });
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
    haptics.tap();
    this.setData({ expandId: this.data.expandId === id ? '' : id });
  },

  /** 4.12.1 空态直达录入（与 wall 空态同构） */
  goScan() {
    wx.navigateTo({ url: '/pages/scan/scan' });
  },

  /** 错误态出路：没绑定去绑定，取数失败就重试 */
  goDuo() {
    wx.navigateTo({ url: '/pages/duo/duo' });
  },
  retry() {
    this.load();
  }
});
