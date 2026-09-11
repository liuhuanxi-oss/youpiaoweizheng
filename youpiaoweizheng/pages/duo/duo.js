// pages/duo/duo.js —— M4 双人空间
// 未绑定：生成/复制我的邀请码 · 输 TA 的码 · 分享邀请卡片（bind 中转页承接）
// 已绑定：∞ 头像对 · 同行天数 · 合并统计 · 最近共同时光（M4-b 起「全部」进时间线页）· 时光报告 · 双人卡片 · 解绑
// 演示模式：本地造演示绑定，走通全部交互（数据不出本机）。
// M4-b：合并数据组装下沉到 utils/duoData.js（duo/timeline/report 三页同源）。
const couple = require('../../utils/couple.js');
const duoData = require('../../utils/duoData.js');
const themeUtil = require("../../utils/theme.js");
const sk = require('../../utils/skeleton.js');
const track = require('../../utils/track.js'); // 4.17.0：拉新埋点

/** 绑定时间 → 同行天数（当天算第 1 天） */
function daysTogether(boundAt) {
  if (!boundAt) return 1;
  return Math.max(1, Math.floor((Date.now() - boundAt) / 86400000) + 1);
}

Page({
  data: {
    theme: "a",
    skeleton: false,  // M4.5：加载超 300ms 才显示骨架（原 loading 状态由骨架时序接管）
    bound: false,
    // —— M4.5 下拉弹性 ——
    refreshing: false,
    refreshText: '下拉翻册',
    pullDeg: 0,
    // —— 未绑定 ——
    myCode: '',
    codeBusy: false,
    // —— 已绑定 ——
    duo: null,   // { myName, partnerName, meChar, partnerChar, days }
    stats: null  // { total, shows, cities, recent }
  },

  onShow() {
    themeUtil.apply(this);
    this.getTabBar() && this.getTabBar().setData({ selected: 1, theme: themeUtil.getTheme() });
    this.refresh();
  },

  // ===== M4.5 下拉弹性（重新拉绑定态 + 统计） =====
  onRefresh() {
    this.setData({ refreshing: true, refreshText: '正在翻册…' });
    this.refresh().then(() => {
      this.setData({ refreshing: false, refreshText: '已更新 ✦' });
    }).catch(() => {
      this.setData({ refreshing: false, refreshText: '刷新失败，再试一次' });
    });
  },

  onPulling(e) {
    const dy = (e && e.detail && e.detail.dy) || 0;
    const deg = Math.round(Math.min(dy / 60, 1) * 360);
    const next = dy >= 60 ? '松手翻册' : '下拉翻册';
    if (next !== this.data.refreshText) {
      this.setData({ refreshText: next, pullDeg: deg });
    } else if (Math.abs(deg - this.data.pullDeg) > 5) {
      this.setData({ pullDeg: deg });
    }
  },

  onRestore() {
    this.setData({ refreshText: '下拉翻册', pullDeg: 0 });
  },

  async refresh() {
    sk.start(this);
    try {
      const c = await couple.queryCouple();
      if (c && c.boundAt) {
        await this.renderBound(c);
      } else {
        // 未绑定：静默预生成邀请码（幂等，已有则复用），分享卡片随时可发
        this.setData({ bound: false, duo: null, stats: null, myCode: '' });
        try {
          const r = await couple.createCode('');
          if (r && r.code) this.setData({ myCode: r.code });
        } catch (e) { /* 码生成失败不阻塞浏览 */ }
      }
    } catch (e) {
      wx.showToast({ title: String(e.message || e).slice(0, 40), icon: 'none' });
    } finally {
      sk.end(this);
    }
  },

  async renderBound(c) {
    const duo = {
      myName: c.myName || '我',
      partnerName: c.partnerName || 'TA',
      meChar: (c.myName || '我')[0],
      partnerChar: (c.partnerName || 'TA')[0],
      days: daysTogether(c.boundAt),
      demo: !!c.demo
    };
    this.setData({ bound: true, duo });

    // M4-b：统一走 duoData.loadMerged（云=duoStats full / 演示=mock）
    const merged = await duoData.loadMerged(c);
    this.setData({
      stats: {
        total: merged.total,
        shows: merged.shows,
        cities: merged.cities,
        recent: duoData.recentRows(merged, 5)
      }
    });
  },

  // —— 未绑定：生成我的邀请码 ——
  genCode() {
    if (this.data.myCode) return;
    wx.showModal({
      title: '你在双人空间的称呼',
      editable: true,
      placeholderText: '选填，如：小柯',
      success: async (r) => {
        if (!r.confirm) return;
        this.setData({ codeBusy: true });
        try {
          const res = await couple.createCode(r.content || '');
          this.setData({ myCode: res.code || '' });
          wx.showToast({ title: '邀请码已生成', icon: 'success' });
        } catch (e) {
          wx.showToast({ title: String(e.message || e).slice(0, 40), icon: 'none' });
        } finally {
          this.setData({ codeBusy: false });
        }
      }
    });
  },

  copyCode() {
    if (!this.data.myCode) return;
    wx.setClipboardData({
      data: this.data.myCode,
      success: () => wx.showToast({ title: '已复制，发给 TA 吧', icon: 'none' })
    });
  },

  // —— 未绑定：输入 TA 的邀请码 ——
  joinCode() {
    wx.showModal({
      title: '输入 TA 的邀请码',
      editable: true,
      placeholderText: '4 位字符，如：K7MP',
      success: async (r) => {
        if (!r.confirm) return;
        const code = String(r.content || '').trim();
        if (!code) return;
        this.setData({ codeBusy: true });
        wx.showLoading({ title: '正在绑定…', mask: true });
        try {
          const c = await couple.joinByCode(code, '');
          wx.hideLoading();
          wx.vibrateShort({ type: 'medium' }); // M4.5：关键操作（绑定成功）
          // 4.17.0 invite_bind：被邀请方落地成功（增长口径：K 因子的转化环节）
          track.track('invite_bind', { via: 'code' });
          wx.showToast({ title: `已和 ${c.couple.partnerName} 绑定`, icon: 'success' });
          this.refresh();
        } catch (e) {
          wx.hideLoading();
          wx.showModal({ title: '绑定失败', content: String(e.message || e).slice(0, 80), showCancel: false });
        } finally {
          this.setData({ codeBusy: false });
        }
      }
    });
  },

  // —— 分享邀请卡片（bind 中转页承接 code） ——
  onShareAppMessage() {
    const code = this.data.myCode;
    // 4.17.0 M2 时光同谋：发起过邀请就点亮勋章资格 + 埋点
    try { wx.setStorageSync('sp_invite_sent', Date.now()); } catch (e) { /* 忽略 */ }
    track.track('share_click', { from: 'duo' });
    // v5.1 L2：标题用「我们」钩子 + 结果前置，比功能描述更能唤起绑定（分享卡片直达绑定位）
    return {
      title: '我把咱俩看过的时光收成了收藏册，给你留了位置，来一起翻',
      path: code ? `/pages/bind/bind?code=${code}` : '/pages/duo/duo',
      imageUrl: '/images/brand-logo.png'
    };
  },

  // —— 已绑定 ——
  // 4.22.5 修复（BUG审查②）：此前跳 card 不带 id，card 依赖已被移除的错误 fallback
  // 会显示自己的票。改为带上「最近一张共同票根」的 id（无共同票 → 跳完整时间线）。
  goDuoCard() {
    const recent = (this.data.stats && this.data.stats.recent) || [];
    if (recent[0] && recent[0].id) {
      wx.navigateTo({ url: `/pages/card/card?id=${recent[0].id}` }); // 海报自动带上双人头像
      return;
    }
    wx.vibrateShort({ type: 'light' });
    wx.navigateTo({ url: '/pages/timeline/timeline' });
  },

  // 4.22.5 改名（BUG审查⑨）：原名 goTimeline 却跳 detail 详情页，易误导维护；函数语义=最近共同时光详情
  goRecentDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` });
  },

  // —— M4-b：完整时间线 + 时光报告 ——
  goTimelineAll() {
    wx.vibrateShort({ type: 'light' });
    wx.navigateTo({ url: '/pages/timeline/timeline' });
  },

  goReport() {
    wx.vibrateShort({ type: 'light' });
    wx.navigateTo({ url: '/pages/report/report' });
  },

  unbindTap() {
    wx.showModal({
      title: '解除绑定',
      content: '解绑后双人空间会清空，双方回到各自收藏册。确定解除吗？',
      confirmText: '解除',
      confirmColor: '#E0532F',
      success: async (r) => {
        if (!r.confirm) return;
        wx.vibrateShort({ type: 'heavy' }); // M4.5：删除类操作的明确反馈
        try {
          await couple.unbind();
          wx.showToast({ title: '已解绑', icon: 'none' });
          this.refresh();
        } catch (e) {
          wx.showToast({ title: String(e.message || e).slice(0, 40), icon: 'none' });
        }
      }
    });
  },

  // 了解双人空间是什么
  about() {
    wx.showModal({
      title: '双人记忆空间',
      content: '和最重要的人绑定后，你们的票根会汇入同一条时间线，还能生成两人头像并排的纪念卡片。',
      showCancel: false,
      confirmText: '期待'
    });
  }
});
