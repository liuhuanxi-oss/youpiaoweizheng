// pages/wall/wall.js —— 同场票根墙（8.1.0 拉新）
// ============================================================
// 【这页是什么】某一场演出下，**别人自愿公开**的票根摊在一起。
//   拉新的逻辑：散场当晚是情绪最高点，一个人看到「这场有 37 张票根」，
//   会想把手里那张也放上去；发给朋友，朋友点进来又看到一片票根。
//
// 【为什么默认不加入】协议原文承诺的是「匿名场次键只做聚合计数，不展示、不共享
//   任何身份信息」。用户按「同场印记」开关时同意的是「你数人头」，不是「把我票根
//   拿给陌生人看」——沿用旧开关等于偷偷扩大用户没同意过的范围。所以上墙是
//   一张票一次的选择，入口在详情页，默认关。
//
// 【本页拿到的就是脱敏数据】服务端出口只回 票名/场馆/日期/图 四项，
//   没有身份、座位、票价、坐标，也**没有 `_id`**（card 页支持按 id 取票，
//   漏 id 等于白送一条读别人完整票根的旁路）。本页不许从别处把字段补回来。
// ============================================================
const themeUtil = require('../../utils/theme.js');
const store = require('../../utils/store.js');
const track = require('../../utils/track.js');
const share = require('../../utils/share.js');

Page({
  onShow() {
    themeUtil.apply(this);
  },

  data: {
    theme: 'a', legacyTheme: 'a',
    eventKey: '',
    venue: '',
    date: '',
    items: [],
    state: 'loading', // loading 打开中 / done 有票根 / empty 这场还没人公开 / error 打不开
  },

  onLoad(options) {
    this.setData({
      eventKey: String(options.eventKey || ''),
      venue: decodeURIComponent(String(options.venue || '')),
      date: String(options.date || '')
    });
    track.track('wall_open', { eventKey: this.data.eventKey });
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    if (!this.data.eventKey) {
      this.setData({ state: 'error' });
      return;
    }
    const rows = await store.listWallTickets(this.data.eventKey);
    this.setData({
      // wx:key 用自增键：行里没有 id（服务端刻意不给），title 又可能重名
      items: rows.map((r, i) => ({ ...r, k: i })),
      state: rows.length ? 'done' : 'empty'
    });
  },

  goScan() {
    wx.navigateTo({ url: '/pages/scan/scan' });
  },

  // 分享带场次参数回去 —— 收到的人点开看到的是同一面墙，而不是首页
  onShareAppMessage() {
    const d = this.data;
    return {
      title: share.withSlogan((d.venue || '这一场') + ' · ' + d.items.length + ' 张票根'),
      path: '/pages/wall/wall?eventKey=' + encodeURIComponent(d.eventKey)
        + '&venue=' + encodeURIComponent(d.venue)
        + '&date=' + encodeURIComponent(d.date)
    };
  }
});
