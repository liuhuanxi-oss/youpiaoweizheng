// pages/setting/setting.js —— 设置（v7.0 新建）
// 收纳「我的」页放不下的东西：外观主题 / AI 重绘额度 / 勋章墙 / 双人空间 / 回收站 / 协议。
// 全部是搬迁，不新增业务逻辑；唯一的净增是把 computeBadges 的结果真正渲染出来。
const store = require('../../utils/store.js');
const themeUtil = require('../../utils/theme.js');
const couple = require('../../utils/couple.js');
const { USE_CLOUD } = require('../../utils/env.js');
const pay = require('../../utils/pay.js');
const { iconSrc } = require('../../utils/icons.js');
const { computeBadges } = require('../../utils/badges.js');

const LS_SHARE = 'sp_share_count';

/** 「更多」四项：都是原「我的」页的入口，按原行为原样搬迁 */
const ROWS = [
  { key: 'duo',     name: '双人空间',      icon: 'users' },
  { key: 'recycle', name: '回收站',        icon: 'trash' },
  { key: 'privacy', name: '隐私设置',      icon: 'lock' },
  { key: 'terms',   name: '用户协议与隐私', icon: 'doc' }
];

Page({
  data: {
    theme: 'paper',
    ic: {},
    curTheme: themeUtil.getThemeMeta('paper'),
    themeDots: themeUtil.THEME_META.map((t) => ({ key: t.key, primary: t.primary })),
    quotaLabel: pay.quotaLabel({ freeLeft: 3, paid: 0, left: 3, freePerMonth: 3 }),
    quotaLeftNum: -1,   // -1 = 未取到，整块不渲染
    badges: [],
    unlocked: 0,
    rows: ROWS
  },

  onShow() {
    themeUtil.apply(this);
    this.setData({
      ic: { chevron: iconSrc('chevron', themeUtil.getThemeMeta(themeUtil.getTheme()).text, 0.45) },
      curTheme: themeUtil.getThemeMeta(themeUtil.getTheme()),
      rows: ROWS.map((r) => Object.assign({}, r, { ico: iconSrc(r.icon, themeUtil.getThemeMeta(themeUtil.getTheme()).text, 0.6) }))
    });
    this.refreshBadges();
    this.refreshQuota();
  },

  /** 13 枚勋章判定：已点亮的上色，未点亮的置灰（颜色按主题编译，SVG 不认 CSS 变量） */
  async refreshBadges() {
    const m = themeUtil.getThemeMeta(themeUtil.getTheme());
    const ts = await store.listTickets();
    const c = couple.cachedCouple();
    let shareCount = 0;
    let mapVisited = false;
    let inviteSent = false;
    try { shareCount = wx.getStorageSync(LS_SHARE) || 0; } catch (e) { /* 忽略 */ }
    try { mapVisited = !!wx.getStorageSync('sp_map_visited'); } catch (e) { /* 忽略 */ }
    try { inviteSent = !!wx.getStorageSync('sp_invite_sent'); } catch (e) { /* 忽略 */ }

    // 未解锁的用低透明度主题正文色置灰（iconSrc 对未知名会回落票根图标，所以这里不必再兜底）
    const badges = computeBadges(ts, c && c.boundAt ? c : null, shareCount, mapVisited, inviteSent)
      .map((b) => Object.assign(b, {
        src: iconSrc(b.icon, b.unlocked ? m.accent : m.text, b.unlocked ? 1 : 0.25)
      }));
    this.setData({ badges, unlocked: badges.filter((b) => b.unlocked).length });
  },

  /** 服务端权威额度（云失败静默，保持本地默认） */
  refreshQuota() {
    if (!USE_CLOUD) return;
    pay.getQuota().then((q) => {
      if (q && typeof q.left === 'number') {
        this.setData({ quotaLabel: pay.quotaLabel(q), quotaLeftNum: q.left });
      }
    });
  },

  goTheme() { wx.navigateTo({ url: '/pages/theme/theme' }); },

  /** 「更多」分发：duo/协议是真实页面，回收站与勋章墙仍是待建功能，如实告知不装死链 */
  onRow(e) {
    const key = e.currentTarget.dataset.key;
    wx.vibrateShort({ type: 'light' });
    const JUMP = {
      duo: '/pages/duo/duo',
      privacy: '/pages/protocol/protocol?type=privacy',
      terms: '/pages/protocol/protocol?type=terms'
    };
    if (JUMP[key]) { wx.navigateTo({ url: JUMP[key] }); return; }
    if (key === 'recycle') wx.showToast({ title: '回收站开发中，敬请期待', icon: 'none' });
  },

  copyIcp() {
    wx.setClipboardData({ data: '粤ICP备20010271号-11X' });
  }
});
