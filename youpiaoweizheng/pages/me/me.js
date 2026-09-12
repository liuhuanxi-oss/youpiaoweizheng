// pages/me/me.js —— 我的（品牌全案 · 稿屏11）
// 页面只剩三块：品牌行 → hero（头像/昵称）→ 统计卡 → 5 个功能入口。
// 原来堆在这里的「外观主题卡 / 免费额度卡 / 勋章墙 / 双人空间 / 回收站 / 协议」全部
// 迁到 pages/setting —— 稿屏11 只画 5 个入口，其余归设置页。
const store = require('../../utils/store.js');
const themeUtil = require('../../utils/theme.js');
const { USE_CLOUD } = require('../../utils/env.js');
const pay = require('../../utils/pay.js');
const { iconSrc } = require('../../utils/icons.js');
const deco = require('../../utils/deco.js');

// 功能入口的水彩底色。这四色与 app.wxss 的 --rose/--butter/--sage 同源，
// 六套主题下都不变（品牌固定色，不随主题走），与稿屏11 一致。
// 为什么写死在 JS：SVG 的 fill 不认 CSS 变量，必须给实色（详见 utils/icons.js 顶部）。
const TINT = {
  rose: '#EFA392',
  butter: '#F2CE7E',
  sage: '#B5CBAE',
  mauve: '#C4A9B8'
};

/**
 * 5 个功能入口（稿屏11 顺序）。
 * icon  : utils/icons.js 的图标名，白色线性图形压在圆形水彩底上
 * decoL/decoR : 卡左右两侧的手绘装饰（走 utils/deco.js，随主题换色）
 */
const ENTRIES = [
  { key: 'collection', name: '我的收藏夹', icon: 'bookmark', tint: TINT.rose,   decoL: 'sprig',     decoR: 'wavelines' },
  { key: 'album',      name: '时光机',     icon: 'clock',    tint: TINT.butter, decoL: 'wavelines', decoR: 'star4'     },
  { key: 'discover',   name: '回忆地图',   icon: 'map',      tint: TINT.sage,   decoL: 'star4',     decoR: 'sprig'     },
  { key: 'annual',     name: '数据统计',   icon: 'chart',    tint: TINT.rose,   decoL: 'sprig',     decoR: 'heartsmall' },
  { key: 'setting',    name: '设置',       icon: 'settings', tint: TINT.mauve,  decoL: 'wavelines', decoR: 'sprig'     }
];

/**
 * 按当前主题编译本页要用到的全部图形（7.0.0）。
 * 为什么要整页重编：SVG 是独立文档、不认页面的 CSS 变量，颜色必须在 JS 里写死，
 * 主题一变就得重来一遍（见 onShow）。
 * 副色一律用 text + opacity 表达，不取 meta.text2 —— film/minimal 的 text2 是 rgba() 字面量。
 */
function buildGraphics(themeKey) {
  const m = themeUtil.getThemeMeta(themeKey);
  const W = '#FFFFFF';
  const ic = {
    // 品牌行 / hero
    gear: iconSrc('settings', m.text, 0.75),
    star: iconSrc('sparkle', m.accent),
    heart: iconSrc('heart', m.accent),
    chevron: iconSrc('chevron', m.text, 0.45),
    avatar: deco.avatarSrc(m),
    // 统计卡三列
    bookmark: iconSrc('bookmark', m.text, 0.7),
    pin: iconSrc('pin', m.text, 0.7),
    sprig: iconSrc('sprig', m.text, 0.7)
  };
  const de = {
    // hero 右侧花枝（溢出页面右缘）
    sprig: deco.decoSrc('sprig', m),
    // 5 个入口卡的左右装饰
    entries: ENTRIES.map((e) => ({
      decoL: deco.decoSrc(e.decoL, m),
      decoR: deco.decoSrc(e.decoR, m)
    }))
  };
  return { ic, de };
}

Page({
  data: {
    theme: 'paper',
    ic: {},            // 图标 data-uri（onShow 按主题填充）
    deco: {},          // 装饰 data-uri
    entries: [],       // 5 个功能入口（含编译好的图标与装饰）
    stats: { total: 0, shows: 0, cities: 0 },
    profile: { nickname: '', avatar: '' },
    nickFocus: false   // 4.22.0：编程聚焦昵称输入框（原生 input 无法 selectComponent 唤起键盘）
  },

  onShow() {
    themeUtil.apply(this);
    this.getTabBar() && this.getTabBar().setData({ selected: 3, theme: themeUtil.getTheme() });
    this.buildView();
    this.refresh();
    this.refreshProfile(); // 4.20.0：授权资料回显
  },

  /** 按当前主题编译图形 + 组装 5 个入口（一次 setData，约 12KB） */
  buildView() {
    const themeKey = themeUtil.getTheme();
    const { ic, de } = buildGraphics(themeKey);
    this.setData({
      ic,
      deco: { sprig: de.sprig },
      entries: ENTRIES.map((e, i) => Object.assign({}, e, {
        ico: iconSrc(e.icon, '#FFFFFF'),
        decoL: de.entries[i].decoL,
        decoR: de.entries[i].decoR
      }))
    });
  },

  // ===== 4.20.0 授权登录资料（署名展示位，纯可选——票根卡/年报署名用，可一键清除） =====

  /** 拉取云端资料（云失败静默，保持本地默认；输入中不覆盖昵称回显） */
  refreshProfile() {
    if (!USE_CLOUD) return;
    if (this._nickEditing) return;
    pay.getProfile().then((p) => {
      if (p && (p.nickname || p.avatar)) this.setData({ profile: p });
    });
  },

  /** 头像授权（open-type=chooseAvatar）：临时路径 → 云存储持久化 → 服务端 user_profile */
  async onChooseAvatar(e) {
    const url = e.detail && e.detail.avatarUrl;
    if (!url) return;
    wx.vibrateShort({ type: 'light' });
    if (!USE_CLOUD) {
      this.setData({ 'profile.avatar': url }); // 演示模式：临时路径仅本会话可见
      wx.showToast({ title: '演示模式不持久化头像', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中…', mask: true });
    try {
      const ext = (/\.(\w+)$/.exec(url) || [, 'png'])[1];
      const up = await wx.cloud.uploadFile({
        cloudPath: `avatar/a${Date.now()}${Math.random().toString(36).slice(2, 6)}.${ext}`,
        filePath: url
      });
      await pay.saveProfile('', up.fileID);
      this.setData({ 'profile.avatar': up.fileID });
      wx.hideLoading();
      wx.showToast({ title: '头像已更新', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '头像保存失败，请重试', icon: 'none' });
    }
  },

  /** 昵称输入中：实时同步 data（键盘「使用微信昵称」快捷填充后即使未 blur 也不丢值） */
  onNickInput(e) {
    this.setData({ 'profile.nickname': String(e.detail.value || '').slice(0, 24) });
  },

  /** 聚焦：进入编辑态（onShow 云端回显暂停覆盖）+ 快照已保存值 */
  onNickFocus() {
    this._nickEditing = true;
    this._savedNick = this.data.profile.nickname;
    if (this.data.nickFocus) this.setData({ nickFocus: false }); // 编程聚焦一次性触发后复位
  },

  /** 4.22.0 修复：原生 input 无 selectComponent/focus()——改绑 focus 属性编程聚焦，
      键盘上方「使用微信昵称」快捷条由 type=nickname 原生提供（需已同意隐私协议） */
  onNickAssist() {
    wx.vibrateShort({ type: 'light' });
    this.setData({ nickFocus: true });
  },

  /** 昵称授权（type=nickname 键盘自带快捷填充）：blur/confirm 时保存 */
  async onNickBlur(e) {
    this._nickEditing = false;
    if (this.data.nickFocus) this.setData({ nickFocus: false }); // 失焦复位，保证可重复聚焦
    const nick = String((e.detail && e.detail.value) || '').trim().slice(0, 24);
    // 4.20.1：与「聚焦时已保存值」对比（bindinput 已同步 data，不能再与 data 比对，否则永不保存）
    const saved = this._savedNick !== undefined ? this._savedNick : this.data.profile.nickname;
    if (!nick || nick === saved) return;
    if (!USE_CLOUD) { this.setData({ 'profile.nickname': nick }); this._savedNick = nick; return; }
    try {
      await pay.saveProfile(nick, ''); // 服务端 nickname 过安全检测
      this._savedNick = nick;
      this.setData({ 'profile.nickname': nick });
      wx.showToast({ title: '昵称已更新', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '昵称保存失败', icon: 'none' });
    }
  },

  /** 统计卡三列的数据源 */
  async refresh() {
    const ts = await store.listTickets();
    this.setData({
      stats: {
        total: ts.length,
        shows: ts.filter((t) => t.type === 'show').length,
        cities: new Set(ts.filter((t) => t.city).map((t) => t.city)).size
      }
    });
  },

  /** 5 个入口的路由（稿屏11：收藏夹/时光机/回忆地图走 tab，统计与设置走二级页） */
  _route(key) {
    wx.vibrateShort({ type: 'light' });
    const TAB = { collection: '/pages/home/home', album: '/pages/album/album', discover: '/pages/discover/discover' };
    if (TAB[key]) { wx.switchTab({ url: TAB[key] }); return; }
    const PAGE = { annual: '/pages/annual/annual', setting: '/pages/setting/setting' };
    if (PAGE[key]) wx.navigateTo({ url: PAGE[key] });
  },

  onEntry(e) { this._route(e.currentTarget.dataset.key); },
  goSetting() { this._route('setting'); },

  // ===== 4.22.2 ICP 备案展示（工信部要求：小程序底部标注备案号；点击复制） =====
  copyIcp() {
    wx.setClipboardData({ data: '粤ICP备20010271号-11X' });
  }
});
