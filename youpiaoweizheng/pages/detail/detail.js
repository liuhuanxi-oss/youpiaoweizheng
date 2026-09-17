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
const share = require('../../utils/share.js');             // 7.3.0 S1/S2：分享文案（好友 + 朋友圈）
const ads = require('../../utils/ads.js');                 // 4.21.0：底部 Banner 广告位（未配置 ID 时整块隐藏）
const { iconSrc } = require('../../utils/icons.js');       // 7.0.0：线性图标（替换原 emoji）
const haptics = require('../../utils/haptics.js'); // 7.4.0：触觉三档，别再直接写 vibrateShort

const LS_CAP_STYLE = 'sp_cap_style'; // 4.11.0：文案风格本地记忆（detail/card 共用）

// 修复/重绘两颗胶囊的图标色：与 .dtc-btn.ghost / .dtc-btn.sage 的文字色同值
// （按钮是浅色实底 + 深色字，图标必须跟着字色走，不能吃主题变量）
const BTN_FIX_FG = '#5F7F5C';
const BTN_ART_FG = '#8A6F3A';

// 7.4.0：删除后退场的时长，必须与 detail.wxss 里 .dtc-card.leaving 的动画时长一致
// （不一致会出现两种坏法：短了 → 卡片还没收完就跳页；长了 → 退场播完干等着）
const LEAVE_MS = 260;
// 生成失败时手记卡抖动一次，抖完要自己撤掉类名，否则第二次点不会再抖（类名没变化）
const SHAKE_MS = 320;

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

/**
 * A3 顶栏毛玻璃渐变的底色。
 * 为什么由 JS 编译：那层遮罩挂在根节点**之外**（根节点带 .fade-up，其 transform
 * 会让 position:fixed 相对它定位，app.wxss 里记过这个坑），因此吃不到 --bg 变量。
 * 末端用同色 alpha 0 收尾，而不是 transparent —— 后者在部分渲染器上按「透明黑」插值，
 * 渐变会脏成灰边。
 */
function topFadeOf(themeKey) {
  const hex = String(themeUtil.getThemeMeta(themeKey).bg || '#F5F0E6').replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `linear-gradient(180deg, rgba(${r}, ${g}, ${b}, 0.94) 45%, rgba(${r}, ${g}, ${b}, 0))`;
}

Page({

  onShow() {
    themeUtil.apply(this);
    // 主题可能在「外观主题」页被改过，回到本页要重编图标实色
    const k = themeUtil.getTheme();
    this.setData({ icons: buildIcons(k), fxTop: topFadeOf(k) });
  },

  /**
   * A3 滚动驱动：照片视差 + 顶栏渐变（16ms 节流）。
   * 两个值合并成一次 setData；位移量化到 2px、透明度量化到 0.1——
   * 视觉上看不出台阶，但 setData 次数少一大截（滚动里 setData 是性能大头的）。
   */
  onPageScroll(e) {
    const y = e.scrollTop || 0;
    const now = Date.now();
    if (now - (this._psT || 0) < 16) return;
    this._psT = now;
    // 上限 20px：与 .dtc-par 那 12% 的余量（≈26px）对应，再大就露出框底
    const dy = Math.min(20, Math.round(y * 0.12 / 2) * 2);
    const fade = Math.round(Math.min(y, 72) / 72 * 10) / 10;
    if (dy === this._psDy && fade === this._psFade) return;
    this._psDy = dy; this._psFade = fade;
    this.setData({ psDy: dy, psFade: fade });
  },

  /** 4.15.0：离开页面清掉彩蛋定时器（v5.1 D2：一并清打字机） */
  onUnload() {
    if (this._eggTimer) clearTimeout(this._eggTimer);
    if (this._capTimer) { clearInterval(this._capTimer); this._capTimer = null; }
    // 删除后的「收拢淡出 → 退回」定时器：用户在这 700ms 内自己按了返回，定时器还在，
    // 于是**再退一层**（一下退回两层）——与 scan 保存后那个是同一类问题。
    if (this._leaveTimer) { clearTimeout(this._leaveTimer); this._leaveTimer = null; }
    // AI 手记生成失败后那个延迟弹窗（见 onGenCaption 的 catch）
    if (this._failTimer) { clearTimeout(this._failTimer); this._failTimer = null; }
  },
  data: {
    theme: "paper",
    icons: {},        // 7.0.0：按主题编译的线性图标 data-uri（onShow 填充）
    // A3 滚动视差与顶栏渐变（onPageScroll 填充；初值即「未滚动」的样子）
    psDy: 0,
    psFade: 0,
    fxTop: '',
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
    notFound: false,
    // 7.3.0 S1：朋友圈单页模式（无身份、不能跳页 → 空态不摆死按钮）
    sp: false,
    // 7.4.0：删除成功后的退场（主卡收拢淡出后再跳页，不再干等 700ms）
    leaving: false,
    // 7.4.0：AI 生成失败时手记卡抖一下（只弹个窗，用户容易当成「点了没反应」）
    memoErr: false
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
    // 7.3.0 S1：朋友圈打开 = 单页模式（拿不到身份、不能跳页）→ 直接亮空态并指路微信自带的
    // 「前往小程序」，不去白跑一趟注定读不到的云库（也给不出点了没反应的按钮）
    if (share.sp()) {
      this.setData({ sp: true, notFound: true, adsBannerId: ads.BANNER_DETAIL_ID });
      sk.end(this);
      return;
    }
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
    haptics.confirm(); // 关键仪式时刻（与收票/保存同级）
    this._eggTimer = setTimeout(() => this.setData({ eggShow: false }), 3200);
  },

  // 4.11.0：切换文案风格（记住选择；已有文案时点「换一句」即按新风格重生）
  pickCapStyle(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.capStyle) return;
    haptics.tap();
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
    haptics.confirm(); // M4.5：关键操作（进入卡片仪式）
    const same = this._sameCount > 1 ? this._sameCount : '';
    wx.navigateTo({ url: `/pages/card/card?id=${this.data.t.id}${same ? '&same=' + same : ''}` });
  },

  // 4.19.0 票根博物志：艺术图版入口（生图走云函数 artRestyle，异步轮询）
  // v6.4：对应品牌稿底部「🎨 重绘」按钮
  goArt() {
    haptics.confirm();
    wx.navigateTo({ url: `/pages/art/art?id=${this.data.t.id}` });
  },

  // ===== 4.21.0 底部 Banner 广告位：加载失败静默（品牌稿无此项，作为商业基建保留在页尾） =====
  onAdError() { /* 广告拉取失败由平台侧自动兜底，前端静默 */ },

  /** 品牌稿「✦ 修复」：AI 修复（restore）能力待接入 artRestyle，先如实告知 */
  goRepair() {
    haptics.tap();
    track.track('detail_repair', {});
    wx.showToast({ title: 'AI 修复即将上线', icon: 'none' });
  },

  /** 导航「···」更多菜单：AI 艺术重绘 / 纪念卡片 / AI 文案 / 删除
   *  6.4.0：FAB 移除后功能挂载点——原 FAB 级联三钮（图版/分享/卡片）中
   *  图版（goArt）与卡片（goCard）迁入此处，分享走底部实底按钮
   *  7.1.1：删除入口加回——v7.0 逐屏重做时左滑删除随旧票根卡一起没了，
   *  而隐私协议仍写着「左滑删除」，用户实际删不掉（详见 docs/FEATURE.md §十-3） */
  onMore() {
    const hasCap = !!(this.data.t && this.data.t.aiCaption);
    wx.showActionSheet({
      itemList: ['AI 艺术重绘', '生成纪念卡片', hasCap ? 'AI 换一句文案' : 'AI 写一句文案', '删除这张票根'],
      success: (res) => {
        if (res.tapIndex === 0) this.goArt();
        if (res.tapIndex === 1) this.goCard();
        if (res.tapIndex === 2) this.genCaption();
        if (res.tapIndex === 3) this.removeTicket();
      }
    });
  },

  /** 删除这张票根：二次确认 → store.removeTicket（云/演示双模式）→ 退回上一页。
   *  照片文件仍留在云存储（全项目还没有清理机制，见 docs/OVERVIEW.md 已知债），
   *  但数据库记录与列表里的它会立刻消失。 */
  removeTicket() {
    const t = this.data.t;
    if (!t || this._removing) return;
    wx.showModal({
      title: '删除这张票根？',
      content: '删除后它和它的 AI 文案都不会再出现在册子里。',
      confirmText: '删除',
      confirmColor: '#C26B5E',
      cancelText: '再想想',
      success: async (r) => {
        if (!r.confirm) return;
        this._removing = true;
        wx.showLoading({ title: '删除中', mask: true });
        try {
          await store.removeTicket(t.id);
          wx.hideLoading();
          track.track('detail_delete', {});
          wx.showToast({ title: '已删除', icon: 'none' });
          // 先让这张票根当着用户的面收拢淡出，再退回上一页 ——
          // 干等 700ms 什么都不发生，用户会怀疑到底删没删掉（期间还容易再点一次）
          this.setData({ leaving: true });
          this._leaveTimer = setTimeout(() => this.goBack(), LEAVE_MS);
        } catch (e) {
          wx.hideLoading();
          this._removing = false;
          wx.showToast({ title: '删除失败，请重试', icon: 'none' });
        }
      }
    });
  },

  /** 退回上一页；从分享卡直接落地时没有上级页面 → 兜底回时光机 */
  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.switchTab({ url: '/pages/album/album' })
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
    haptics.tap();
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
    // 7.3.0 S2：文案统一走 share.js（带口号 + 带邀请码），不在页面里各写一套
    return share.message('ticket', { title: t && t.title, id: t && t.id });
  },

  /** 7.3.0 S1：分享到朋友圈（朋友圈只能带 query、落地就是本页） */
  onShareTimeline() {
    const t = this.data.t;
    track.track('share_timeline', { from: 'detail' });
    return share.timeline('ticket', { title: t && t.title, id: t && t.id });
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
      const raw = String((e && e.errMsg) || e.message || e);
      console.warn('[detail] 生成文案失败：', raw);
      // 8.0.4：平台原始报错（cloud.callFunction:fail…）截 80 字摆给用户看 = 等于没说，
      // 只能截图来问；自己 throw 的人话（「未通过安全检查」）照说。细节进日志。
      const platform = /:fail|cloud\.|Error:|-\d{6}/i.test(raw);
      const msg = /-502005|collection not exists/i.test(raw)
        ? '云端还没准备好，稍后再试一次'
        : (platform ? 'AI 暂时联系不上，稍后再点一次试试' : raw);
      // 先让手记卡当着用户的面红抖一下，再弹窗说明原因：
      // 弹窗会立刻把整屏压暗，抖在弹窗底下等于没抖。
      haptics.warn();
      this._shakeMemo();
      // 登记定时器：showModal 是应用级 API、不认页面 —— 用户在这 320ms 内返回，
      // 弹窗会落到上一页上（与 card 那个署名弹窗同一类问题）
      this._failTimer = setTimeout(() => {
        this._failTimer = null;
        wx.showModal({
          title: '生成失败',
          content: msg.slice(0, 80),
          showCancel: false
        });
      }, SHAKE_MS);
    } finally {
      this.setData({ genLoading: false });
    }
  },

  /** 手记卡抖一下（生成失败）。抖完必须自己摘掉类名 ——
   *  类名不变的话第二次点同样的失败不会再抖（小程序不会重放同名动画）。 */
  _shakeMemo() {
    if (this._shakeT) clearTimeout(this._shakeT);
    this.setData({ memoErr: true });
    this._shakeT = setTimeout(() => {
      this._shakeT = null;
      this.setData({ memoErr: false });
    }, SHAKE_MS);
  }
});
