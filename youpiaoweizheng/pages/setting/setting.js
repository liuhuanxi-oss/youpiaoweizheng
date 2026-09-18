// pages/setting/setting.js —— 设置（v7.0 新建，7.2.0 L2 精简）
// 7.2.0 起只留真正的设置：外观主题 / 协议 / 关于 / 清除。
// 原先堆在这里的 AI 重绘额度与 13 枚勋章墙已迁到「我的 · 留存中心」——
// 荣誉与余额放在需要翻一层才能看到的地方，等于没有。
const themeUtil = require('../../utils/theme.js');
const track = require('../../utils/track.js');
const store = require('../../utils/store.js'); // 同场印记开关（P2-26）
const { iconSrc } = require('../../utils/icons.js');
const haptics = require('../../utils/haptics.js'); // 7.4.0：触觉三档，别再直接写 vibrateShort

/**
 * 只清本地记录，不动云端。
 * 不含 sp_theme：主题是用户当面选的外观，清「本地数据」把外观也换掉会像故障。
 * 也不含票根：票根在云库，详情页「···」里有它自己的删除入口。
 * 也不含 sp_same_optout（同场印记的退出开关）：那是一次隐私选择，
 * 清「本地数据」把用户说过的「退出」改回「参与」，等于替他同意。
 */
const LS_CLEAR = [
  'fav_ids',        // 收藏心（本地标记）
  'sp_share_count', // 分享计数（勋章判定用）
  'sp_first_saved', // 首次保存埋点标记
  'sp_map_visited', // 去过回忆地图
  'sp_invite_sent', // 发过邀请
  'sp_poster_ab',   // 卡片 A/B 分组
  'sp_cap_style',   // 卡片样式偏好
  'sp_guide_done'   // 新手指引已读
];

const ROWS = [
  { key: 'privacy', name: '隐私政策',     icon: 'lock' },
  { key: 'terms',   name: '用户协议',     icon: 'doc' },
  { key: 'about',   name: '关于有票为证', icon: 'help' },
  // 8.1.0 拉新 4/6：合作场馆立牌。这是一件**运营工具**，本来不该待在「设置」里 ——
  // 但它的使用者只有你自己（去谈场馆时印一张），放进「我的」的常驻入口会白占一格，
  // 而这里本来就是「不常点、但找得到」的那一栏。clear 永远排最后（破坏性操作垫底）。
  { key: 'sign',    name: '合作场馆立牌', icon: 'ticket' },
  { key: 'clear',   name: '清除本地数据', icon: 'trash' }
];

Page({
  data: {
    theme: 'paper',
    ic: {},
    curTheme: themeUtil.getThemeMeta('paper'),
    themeDots: themeUtil.THEME_META.map((t) => ({ key: t.key, primary: t.primary })),
    rows: ROWS,
    // 同场印记：存的是「退出」（sameOptOut），开关展示的是「参与」。
    // 两个方向相反，只在这里取反一次 —— WXML 里 checked="{{!sameOptOut}}"
    sameOptOut: false,
    primary: '#2B2420'
  },

  onShow() {
    themeUtil.apply(this);
    const m = themeUtil.getThemeMeta(themeUtil.getTheme());
    this.setData({
      ic: { chevron: iconSrc('chevron', m.text, 0.45) },
      curTheme: m,
      rows: ROWS.map((r) => Object.assign({}, r, { ico: iconSrc(r.icon, m.text, 0.6) })),
      primary: m.primary,
      // 每次进页面都回读：清除本地数据、换机恢复都可能改过它
      sameOptOut: store.getSameOptOut()
    });
  },

  /**
   * 同场印记开关。开关说的是「参与」，存的是「退出」—— 这里取反一次，
   * 别让方向在页面和存储之间来回翻（翻错一次，用户以为退出了其实还在参与）。
   * 只影响之后入库的票根，所以不调云端、不需要二次确认。
   */
  onSameMark(e) {
    const participate = !!e.detail.value;
    store.setSameOptOut(!participate);
    haptics.tap();
    track.track('setting_same_mark', { on: participate });
    this.setData({ sameOptOut: !participate });
    wx.showToast({
      title: participate ? '之后的票根会计入同场' : '已退出，之后的票根不再计入',
      icon: 'none'
    });
  },

  goTheme() { wx.navigateTo({ url: '/pages/theme/theme' }); },

  onRow(e) {
    const key = e.currentTarget.dataset.key;
    haptics.tap();
    const JUMP = {
      privacy: '/pages/protocol/protocol?type=privacy',
      terms: '/pages/protocol/protocol?type=terms',
      sign: '/pages/sign/sign'
    };
    if (JUMP[key]) { wx.navigateTo({ url: JUMP[key] }); return; }
    if (key === 'about') this.about();
    if (key === 'clear') this.clearLocal();
  },

  /** 关于：版本取当前包的真实版本，不写死（写死的版本号迟早与线上不符） */
  about() {
    const v = (wx.getAccountInfoSync && (wx.getAccountInfoSync().miniProgram || {}).version) || '开发版';
    wx.showModal({
      title: '有票为证',
      content: `版本 ${v}\n把看过的每一场，都留下来。\n\n粤ICP备20010271号-11X`,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  /** 清除本地数据：二次确认 + 逐键删（单键失败不连累其余的键） */
  clearLocal() {
    wx.showModal({
      title: '清除本地数据',
      content: '会清掉收藏标记、指引已读、分享与邀请记录等本机记录。票根与外观主题不受影响。',
      confirmText: '清除',
      confirmColor: '#C26B5E',
      success: (r) => {
        if (!r.confirm) return;
        LS_CLEAR.forEach((k) => { try { wx.removeStorageSync(k); } catch (e) { /* 单键失败不影响其余 */ } });
        track.track('setting_clear_local', { keys: LS_CLEAR.length });
        wx.showToast({ title: '已清除', icon: 'success' });
      }
    });
  },

  copyIcp() {
    wx.setClipboardData({ data: '粤ICP备20010271号-11X' });
  }
});
