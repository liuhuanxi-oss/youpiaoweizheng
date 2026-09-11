// pages/detail/detail.js —— 票根详情
// M3：AI 纪念文案（一键代笔 → 内容安全校验 → 入库持久化）。
// 本页保留「同场印记」「天气」数据位（天气 V1.5 上 UI）。
const mock = require('../../utils/mock.js');
const store = require('../../utils/store.js');
const ai = require('../../utils/ai.js');
const sk = require('../../utils/skeleton.js');
const themeUtil = require("../../utils/theme.js");
const { weatherText } = require('../../utils/weather.js'); // V1.5：天气记忆 UI
const { annivYears } = require('../../utils/date.js');     // 4.11.0：周年语气
const track = require('../../utils/track.js');             // 4.17.0：拉新埋点
const ads = require('../../utils/ads.js');                 // 4.21.0：底部 Banner 广告位（未配置 ID 时整块隐藏）
const { iconSrc } = require('../../utils/icons.js');       // 7.0.0：线性图标（替换原 emoji）

const LS_CAP_STYLE = 'sp_cap_style'; // 4.11.0：文案风格本地记忆（detail/card 共用）

// 修复/重绘两颗胶囊的图标色：与 .dtc-btn.ghost / .dtc-btn.sage 的文字色同值
// （按钮是浅色实底 + 深色字，图标必须跟着字色走，不能吃主题变量）
const BTN_FIX_FG = '#5F7F5C';
const BTN_ART_FG = '#8A6F3A';

/**
 * 按当前主题色板编译本页用到的线性图标（7.0.0）。
 * 为什么要这么绕：SVG 的 stroke 不认 CSS 变量 var()，图标必须给**实色**，
 * 所以每套主题各编译一份，主题变了就重编（见 onShow）。
 * 副色一律用 text + stroke-opacity 表达，而不是取 meta.text2 ——
 * film/minimal 两套主题的 text2 是 rgba() 字面量，塞进 SVG 会变成无效色值。
 */
function buildIcons(themeKey) {
  const m = themeUtil.getThemeMeta(themeKey);
  return {
    // 卡内三行（设计稿：图标落在浅色圆角块里，故用主题色实色更好看）
    iRowTime: iconSrc('music', m.primary),
    iRowPlace: iconSrc('pin', m.primary),
    iRowNo: iconSrc('ticket', m.primary),
    // 补充信息面板（有值才出现）
    iSeat: iconSrc('seat', m.text, 0.5),
    iPrice: iconSrc('wallet', m.text, 0.5),
    iWeather: iconSrc('moon', m.text, 0.5),
    iSpark: iconSrc('sparkle', m.accent),
    iHeart: iconSrc('heart', m.text, 0.28),
    iHeartOn: iconSrc('heart', m.accent, 1, 1.6, true),
    iFix: iconSrc('wand', BTN_FIX_FG),
    iArt: iconSrc('palette', BTN_ART_FG),
    iShare: iconSrc('share', '#FFFFFF'),
    iTicketEmpty: iconSrc('ticket', m.text, 0.3)
  };
}

Page({

  onShow() {
    themeUtil.apply(this);
    // 主题可能在「外观主题」页被改过，回到本页要重编图标实色
    this.setData({ icons: buildIcons(themeUtil.getTheme()) });
  },

  /** 4.15.0：离开页面清掉彩蛋定时器（v5.1 D2：一并清打字机） */
  onUnload() {
    if (this._eggTimer) clearTimeout(this._eggTimer);
    if (this._capTimer) { clearInterval(this._capTimer); this._capTimer = null; }
  },
  data: {
    theme: "paper",
    icons: {},        // 7.0.0：按主题编译的线性图标 data-uri（onShow 填充）
    t: null,
    typeText: '',
    genLoading: false,
    captionShow: '',  // v5.1 D2：AI 文案打字机「已显示部分」
    captionTyping: false, // v5.1 D2：打字进行中（驱动光标显隐；WXML 不支持链式表达式故用布尔）
    sameText: '你是第一个收藏这场演出的人',
    // —— 4.11.0 AI 文案 3 风格（PRD：用户可改可重生） ——
    capStyles: Object.keys(ai.CAPTION_STYLES).map((k) => ({ key: k, label: ai.CAPTION_STYLES[k].label })),
    capStyle: 'restraint',
    skeleton: false,  // M4.5：加载超 300ms 才显示骨架
    // 4.12.1 照片淡入 + 失败兜底
    imgLoaded: false,
    imgFail: false,
    // 4.15.0 周年彩蛋：打开恰逢票面日期 N 周年的票根时触发
    anniv: 0,
    eggShow: false,
    confetti: [],
    // 4.18.0 分享落地空态：票根不存在/不属于你（云库仅创建者可读写）
    notFound: false
  },

  /** 4.12.1 照片解码完成 → 淡入；失败 → 落回纸票样式兜底 */
  onImgLoad() { this.setData({ imgLoaded: true }); },
  onImgError() { this.setData({ imgFail: true, imgLoaded: false }); },

  /** v5.1 D1：点击票根照片全屏查看（previewImage 原生支持双指缩放） */
  previewPhoto() {
    const t = this.data.t;
    if (!t || !t.img || this.data.imgFail) return;
    wx.previewImage({ urls: [t.img], current: t.img });
  },

  /** v5.1 D2：AI 文案打字机——30ms/字逐字显示（换一句/重进先清旧计时器） */
  _typeCaption(text) {
    if (!text) return;
    if (this._capTimer) { clearInterval(this._capTimer); this._capTimer = null; }
    const full = String(text);
    let i = 0;
    this.setData({ captionShow: '', captionTyping: true });
    this._capTimer = setInterval(() => {
      i += 1;
      this.setData({ captionShow: full.slice(0, i) });
      if (i >= full.length) {
        clearInterval(this._capTimer);
        this._capTimer = null;
        this.setData({ captionTyping: false });
      }
    }, 30);
  },

  async onLoad(options) {
    sk.start(this);
    // 4.21.0 广告位 ID 透传（未配置为空串 → wxml wx:if 不渲染）
    this.setData({ adsBannerId: ads.BANNER_DETAIL_ID });
    // 风格本地记忆（card 页「换一版」同源）
    try { this.setData({ capStyle: wx.getStorageSync(LS_CAP_STYLE) || 'restraint' }); } catch (e) { /* 忽略 */ }
    try {
      const raw = await store.getTicket(options.id);
      if (!raw) {
        // 4.18.0：空票不再白屏——亮「不在册子」空态（分享落地/过期 id 的正常去处）
        this.setData({ notFound: true });
        return;
      }
      // v6.4 品牌稿屏2：票号（id 尾 6 位）+ 邮戳三行（城市/DD/MON YYYY）+ 收藏态
      const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      const ds = String(raw.date || '');
      const mi = parseInt(ds.slice(5, 7), 10);
      let favIds = [];
      try { favIds = wx.getStorageSync('fav_ids') || []; } catch (e) { /* 忽略 */ }
      this.setData({
        // M4.9.6：云模式兜底时用户看到的是演示票，明确标出来不再迷惑
        t: {
          ...raw,
          isDemo: store.isMockTicket(raw.id),
          no: String(raw.id || '').slice(-6).toUpperCase(),
          fav: favIds.indexOf(raw.id) >= 0,
          stampCity: String(raw.city || 'TICKET').toUpperCase().slice(0, 8),
          stampD: ds.slice(8, 10) || '··',
          stampMY: mi ? `${MON[mi - 1]} ${ds.slice(0, 4)}` : '····'
        },
        typeText: mock.TYPE_TEXT[raw.type] || '票根',
        weatherText: weatherText(raw.weather), // V1.5：入库时存档的真实天气（null 不显示）
        notFound: false // 4.18.0：命中后显式清空态（防 onLoad 复用时残留）
      });
      this._anniv = annivYears(raw.date); // 4.11.0：今天恰逢 N 周年 → 文案带纪念语气
      this.maybeAnnivEgg();               // 4.15.0：恰逢周年 → 打开彩蛋
      this.loadSameCount(raw);
      this._typeCaption(raw.aiCaption);   // v5.1 D2：已有文案也走打字机逐字显示
    } finally {
      sk.end(this);
    }
  },

  /**
   * 4.15.0 周年彩蛋：打开的票根恰逢票面日期 N 周年（今天=月-日 且年份差>0）→
   * 14 片品牌色纸屑散落 + 周年印章弹性落章 + medium 振动，3.2s 自动收起。
   * 层级 pointer-events:none 全程不挡操作；日期判断复用 utils/date.js annivYears（4.11.0）。
   */
  maybeAnnivEgg() {
    const n = this._anniv || 0;
    if (n <= 0) return;
    const colors = ['#E0532F', '#C9A063', '#95B088', '#F0A888', '#B07FE8'];
    const confetti = [];
    for (let i = 0; i < 14; i++) {
      const w = 10 + Math.round(Math.random() * 8);
      confetti.push({
        i,
        l: Math.round(Math.random() * 94),              // 水平落点 left%
        d: Math.round(Math.random() * 500),             // 错峰延迟 ms
        c: colors[i % colors.length],
        w,
        h: i % 3 === 2 ? w : w * 2,                     // 三分之一圆点，其余长条纸屑
        r: i % 3 === 2 ? w : Math.round(w / 2)
      });
    }
    this.setData({ anniv: n, eggShow: true, confetti });
    wx.vibrateShort({ type: 'medium' }); // 关键仪式时刻（与收票/保存同级）
    this._eggTimer = setTimeout(() => this.setData({ eggShow: false }), 3200);
  },

  // 4.11.0：切换文案风格（记住选择；已有文案时点「换一句」即按新风格重生）
  pickCapStyle(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.capStyle) return;
    wx.vibrateShort({ type: 'light' });
    try { wx.setStorageSync(LS_CAP_STYLE, key); } catch (err) { /* 忽略 */ }
    this.setData({ capStyle: key });
  },

  /** M4：同场真实计数（云模式按 eventKey 统计；演示模式保持「第一个」） */
  loadSameCount(t) {
    if (!store.USE_CLOUD || !t.eventKey) return;
    wx.cloud.callFunction({
      name: 'saveTicket',
      data: { action: 'eventStats', eventKey: t.eventKey }
    }).then((res) => {
      const r = (res && res.result) || {};
      if (!r.ok) return;
      this._sameCount = r.count || 0; // 4.11.0：同场数随卡片入口传给 card 页画角标
      this.setData({
        sameText: r.count <= 1
          ? '你是第一个收藏这场演出的人'
          : `这场演出已被收藏 ${r.count} 次 · 也许有人正和你同场`
      });
    }).catch(() => { /* 统计失败保持默认文案 */ });
  },

  // 生成纪念卡片 → card 页（4.11.0：带上同场数，卡片画「同场 N 人收藏」角标）
  // v6.4：入口从 FAB 迁至导航「···」更多菜单（品牌稿屏2 无 FAB）
  goCard() {
    wx.vibrateShort({ type: 'medium' }); // M4.5：关键操作（进入卡片仪式）
    const same = this._sameCount > 1 ? this._sameCount : '';
    wx.navigateTo({ url: `/pages/card/card?id=${this.data.t.id}${same ? '&same=' + same : ''}` });
  },

  // 4.19.0 票根博物志：艺术图版入口（生图走云函数 artRestyle，异步轮询）
  // v6.4：对应品牌稿底部「🎨 重绘」按钮
  goArt() {
    wx.vibrateShort({ type: 'medium' });
    wx.navigateTo({ url: `/pages/art/art?id=${this.data.t.id}` });
  },

  // ===== 4.21.0 底部 Banner 广告位：加载失败静默（品牌稿无此项，作为商业基建保留在页尾） =====
  onAdError() { /* 广告拉取失败由平台侧自动兜底，前端静默 */ },

  /** 品牌稿「✦ 修复」：AI 修复（restore）能力待接入 artRestyle，先如实告知 */
  goRepair() {
    wx.vibrateShort({ type: 'light' });
    track.track('detail_repair', {});
    wx.showToast({ title: 'AI 修复即将上线', icon: 'none' });
  },

  /** 导航「···」更多菜单：AI 艺术重绘 / 纪念卡片 / AI 文案
   *  6.4.0：FAB 移除后功能挂载点——原 FAB 级联三钮（图版/分享/卡片）中
   *  图版（goArt）与卡片（goCard）迁入此处，分享走底部实底按钮 */
  onMore() {
    const hasCap = !!(this.data.t && this.data.t.aiCaption);
    wx.showActionSheet({
      itemList: ['AI 艺术重绘', '生成纪念卡片', hasCap ? 'AI 换一句文案' : 'AI 写一句文案'],
      success: (res) => {
        if (res.tapIndex === 0) this.goArt();
        if (res.tapIndex === 1) this.goCard();
        if (res.tapIndex === 2) this.genCaption();
      }
    });
  },

  /** 收藏心：与首页共用 storage（fav_ids） */
  toggleFav() {
    const t = this.data.t;
    if (!t) return;
    const KEY = 'fav_ids';
    let favIds = [];
    try { favIds = wx.getStorageSync(KEY) || []; } catch (e) { /* 忽略 */ }
    const i = favIds.indexOf(t.id);
    if (i >= 0) favIds.splice(i, 1); else favIds.push(t.id);
    try { wx.setStorageSync(KEY, favIds); } catch (e) { /* 忽略 */ }
    wx.vibrateShort({ type: 'light' });
    this.setData({ 't.fav': favIds.indexOf(t.id) >= 0 });
  },

  noop() {},

  /** 分享这张票根：卡片晒票名，落地直达详情页。
   *  4.18.0：path 从固定首页改为带 id 的详情（v6.1：首页兜底由 wall 改指 album）——
   *  本人点开自己的分享卡可直达票根；好友打开时因云库「仅创建者可读写」
   *  读不到 → 走 notFound 空态引导收自己的第一张票（拉新转化位）。 */
  onShareAppMessage() {
    const t = this.data.t;
    // 4.17.0 share_click：分享是社交拉新的起点，先记下来
    track.track('share_click', { from: 'detail', tid: t ? String(t.id || '').slice(-6) : '' });
    return {
      title: t ? `我在有票为证收藏了「${t.title}」` : '有票为证 · 让时光有迹可循',
      path: t ? `/pages/detail/detail?id=${t.id}` : '/pages/album/album'
    };
  },

  /** 4.18.0 notFound 空态动作：去收自己的第一张票（替换当前空页，不回退） */
  goScan() {
    wx.redirectTo({ url: '/pages/scan/scan' });
  },

  /** M3：让 AI 替你写一句纪念文案（生成 → 安全校验 → 入库） */
  async genCaption() {
    const t = this.data.t;
    if (!t || this.data.genLoading) return;
    this.setData({ genLoading: true });
    wx.showLoading({ title: 'AI 代笔中…', mask: true });
    try {
      // 1. 大模型生成（4.11.0：按所选风格 + 周年语气）
      const caption = await ai.generateCaption(t, this.data.capStyle, this._anniv || 0);
      // 2. 内容安全校验（审核硬要求；复用 saveTicket 云函数的 action 路由）
      const check = await wx.cloud.callFunction({
        name: 'saveTicket',
        data: { action: 'checkText', content: caption }
      });
      if (!check.result || !check.result.ok) {
        throw new Error((check.result && check.result.msg) || '未通过安全检查');
      }
      // 3. 持久化（云模式更新云库 / 演示模式写本地覆盖层）
      await store.setCaption(t.id, caption);
      this.setData({ 't.aiCaption': caption });
      this._typeCaption(caption); // v5.1 D2：新生成文案逐字显示
      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      // M4.9.6：原始错误码人话化（正常情况不会再出现，云函数侧已自愈建集合）
      const raw = String(e.message || e);
      const msg = /-502005|collection not exists/i.test(raw)
        ? '云数据库还没建好：请到云开发控制台创建 tickets 集合后重试'
        : raw;
      wx.showModal({
        title: '生成失败',
        content: msg.slice(0, 80),
        showCancel: false
      });
    } finally {
      this.setData({ genLoading: false });
    }
  }
});
