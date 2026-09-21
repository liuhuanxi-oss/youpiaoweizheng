// pages/citybook/citybook.js —— 城市集章册（8.1.6）
// ============================================================
// 【这页是什么】把票根按城市归成「一枚一枚的章」，按第一次去的时间先后排开。
//
// 【为什么要有它】票根是一张一张的，看不见「我去过哪些地方」的整体感。
//   回忆地图讲的是空间（在哪儿、连成一条线），集章册讲的是收集（攒了多少枚）——
//   一个是地图，一个是册子，两页说的不是一件事。
//   集章册还多一个地图没有的好处：**它不需要坐标**。云端只认得 88 座城的坐标，
//   小地方查不到就只能在地图上丢掉；而「我到过这儿」这件事不需要坐标来证明，
//   只要票上填了城市就能盖一枚章（见 utils/citybook.js 顶部）。
//
// 【数据从哪来】store.listTickets()，不新增云函数、不写任何新存储 ——
//   「第一次去是什么时候」是拿该城最早那张票的日期现算的，不是记下来的。
//
// 【本页不单记「访问」埋点】同 pages/legacy：全局路由钩子已经记了 page_view，
//   再记一条只会多一个要登记的冗余事件名（埋点登记清单还欠着账，见 PROJECT §4 U1）。
// ============================================================
const store = require('../../utils/store.js');
const themeUtil = require('../../utils/theme.js');
const { iconSrc } = require('../../utils/icons.js');
const deco = require('../../utils/deco.js');
const sk = require('../../utils/skeleton.js');
const citybook = require('../../utils/citybook.js');
const mapArt = require('../../utils/mapArt.js');
const share = require('../../utils/share.js');

/** '2019-08-01' → '2019.08'；认不出的日期回空串 —— 章上宁可不写年份，也不编一个 */
function ymOf(d) {
  const s = String(d || '');
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 4) + '.' + s.slice(5, 7) : '';
}

Page({
  data: {
    theme: themeUtil.getTheme(),
    sp: false,       // 朋友圈单页模式：那模式下不能跳页，整页换品牌落地卡
    enter: true,     // 入场动效（.fade-up 挂根节点）。本页是 navigateTo 打开的，每次都是新实例，会自然播
    loading: true,
    skeleton: false,
    error: false,
    netBar: null,    // 云故障 / 超上限横幅。与回忆地图同理：云读失败时 store 会兜底成演示票根，
                     // 册子上就会凭空多出用户没去过的城 —— 不说明白等于替他编了一段旅程
    cities: [],      // 章：{city, count, ym, times, color}
    cityCount: 0,
    yearNew: 0,
    noCity: 0,       // 有票根、但没填城市的张数（这些人还盖不出章，得说清楚）
    total: 0,
    ic: {},
    deco: {}
  },

  onLoad() {
    // 单页模式由启动参数决定，全程不变，故放 onLoad（同 legacy / discover）
    this.setData({ sp: share.sp() });
  },

  onShow() {
    themeUtil.apply(this);
    this.buildArt();
    if (!this.data.sp) this.refresh();
  },

  /** 图形随主题编译（SVG 是独立文档，不认页面 CSS 变量，见 utils/icons.js 顶部） */
  buildArt() {
    const m = themeUtil.getThemeMeta(themeUtil.getTheme());
    this.setData({
      ic: { compass: iconSrc('compass', m.text2, 1, 1.5) },
      deco: {
        postmark: deco.decoSrc('postmark', m),
        sprig: deco.decoSrc('sprig', m)
      }
    });
  },

  async refresh() {
    sk.start(this);   // 300ms 后才真的亮骨架，快时不闪
    this.setData({ loading: true, error: false });
    try {
      const raw = await store.listTickets();
      const flags = store.listFlags();
      const netBar = flags.netFallback
        ? { text: '网络开小差了，这本册子是演示章 · 点我重试', retry: true }
        : (flags.truncated ? { text: `票根超过 ${flags.cap} 张，册子只统计了最近的 ${flags.cap} 张`, retry: false } : null);
      const all = (raw || []).filter((t) => t && t.title);
      const b = citybook.build(all, Date.now());

      this.setData({
        cities: b.cities.map((c) => ({
          city: c.city,
          count: c.count,
          ym: ymOf(c.first),
          times: c.count > 1 ? '×' + c.count : '',
          // 与回忆地图的气泡同一个取色函数：同一座城在两页里是同一个颜色，
          // 而且它只跟城市名有关 —— 多收一张票不会让某座城换个颜色（像搬了家）
          color: mapArt.bubbleColor(c.city)
        })),
        cityCount: b.cityCount,
        yearNew: b.yearNew,
        noCity: b.noCity,
        total: all.length,
        netBar,
        loading: false,
        error: false
      });
    } catch (e) {
      this.setData({ loading: false, error: true });
    } finally {
      sk.end(this);
    }
  },

  /** 云故障横幅重试（截断提示不可点，故只认 retry） */
  onNetBarTap() {
    if (this.data.netBar && this.data.netBar.retry) this.refresh();
  },

  /** 空册子的那条路：去拍第一张（有票、只是没填城市时不给这个按钮，那是另一回事） */
  goScan() {
    wx.navigateTo({ url: '/pages/scan/scan' });
  }
});
