// pages/me/me.js —— 我的 · 留存中心（品牌全案 · 稿屏11，7.2.0 L1 重整）
// 版面：品牌行 → hero（头像/昵称）→ 统计卡 → AI 重绘额度 → 勋章横滑 → 2 个功能入口。
//
// 【7.2.0 为什么把它翻了一遍】稿屏11 画的是 5 个入口，其中收藏夹/时光机/回忆地图
//   本来就是底部三个 tab —— 在自己家里又摆一遍，占的是最贵的位置，给的是零信息。
//   换成：额度（还剩几次）在前、勋章（攒到什么程度）在中、真正的二级页只留两个。
//   主题/协议/关于/清除归设置页，「我的」不再是个杂物间。
const store = require('../../utils/store.js');
const themeUtil = require('../../utils/theme.js');
const { USE_CLOUD } = require('../../utils/env.js');
const pay = require('../../utils/pay.js');
const couple = require('../../utils/couple.js');
const { iconSrc } = require('../../utils/icons.js');
const { computeBadges } = require('../../utils/badges.js');
const deco = require('../../utils/deco.js');
const enter = require('../../utils/enter.js');
const share = require('../../utils/share.js'); // 7.3.0 S1/S2：分享文案（好友 + 朋友圈）
const track = require('../../utils/track.js'); // 7.3.0 S1：分享埋点
const sign = require('../../utils/sign.js');   // 7.4.0 R1：今日时光签（端上只读，判定在服务端）
const points = require('../../utils/points.js'); // 7.4.0 B 段 R2：积分（端上只读，兑换门槛的文案）
const haptics = require('../../utils/haptics.js'); // 7.4.0：触觉三档，别再直接写 vibrateShort

const LS_SHARE = 'sp_share_count';

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
 * 2 个功能入口（7.2.0 L1：收藏夹 / 时光机 / 回忆地图 是底部 tab，不再重复摆一遍；
 * 设置挪到右上角齿轮。留下的两个都是没有别的入口的二级页）。
 * icon  : utils/icons.js 的图标名，白色线性图形压在圆形水彩底上
 * decoL/decoR : 卡左右两侧的手绘装饰（走 utils/deco.js，随主题换色）
 */
const ENTRIES = [
  { key: 'duo',    name: '双人空间', icon: 'users', tint: TINT.rose,   decoL: 'sprig',     decoR: 'heartsmall' },
  { key: 'annual', name: '年度报告', icon: 'chart', tint: TINT.butter, decoL: 'wavelines', decoR: 'star4'     }
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
    // 入场动效开关（.fade-up 挂在根节点上）。初值为真：首次进场不该「先亮一帧再淡入」
    enter: true,
    // 7.3.0 S1：朋友圈单页模式（无身份、不能跳页）→ 整页换品牌落地卡
    sp: share.sp(),
    ic: {},            // 图标 data-uri（onShow 按主题填充）
    deco: {},          // 装饰 data-uri
    entries: [],       // 功能入口（含编译好的图标与装饰）
    stats: { total: 0, shows: 0, cities: 0 },
    // 7.2.0 L1：额度与勋章从设置页搬到这一页（荣誉与余额得先被看见）
    quotaLabel: '',
    quotaLeftNum: -1,  // -1 = 未取到，整块不渲染（演示模式没有服务端额度）
    quotaPct: 0,       // 进度条宽度：WXML 里做不了这个算术，JS 算好再给
    badges: [],
    unlocked: 0,
    // 7.4.0 R1：时光签（null = 取不到，整块不渲染；演示模式与云失败都走这条）
    sign: null, signText: { title: '', sub: '', btn: '' }, signing: false,
    signPoints: 0,   // 积分余额（服务端权威，端上只显示）
    pointsHint: '',  // 7.4.0 B 段：积分离「1 次 AI 重绘」还差多少
  pointsRules: null, // 8.0.5：挣分规则（服务端下发的公开三条，端上只负责展示）
    pointsReady: false, // 攒够 100 分才显示兑换按钮（不够时不摆一个点了会失败的按钮）
    // 兑换确认弹层（7.4.0 B 段 R2）
    redeemShow: false, redeeming: false,
    redeemCost: 0, redeemAfter: 0,
    profile: { nickname: '', avatar: '' },
    nickFocus: false,  // 4.22.0：编程聚焦昵称输入框（原生 input 无法 selectComponent 唤起键盘）
    refreshing: false, // 7.2.0 下拉刷新
    refreshText: '下拉翻册',
    // 8.0.4：云故障 / 超上限横幅（{ text, retry }；null = 不显示），同 album 的 netBar
    netBar: null
  },

  /** 下拉刷新：统计数字会变（加过票根之后），下拉是这一页唯一的手动重取入口 */
  onRefresh() {
    this.setData({ refreshing: true, refreshText: '正在翻册…' });
    this.refresh().then(() => {
      this.setData({ refreshing: false, refreshText: '已更新' });
    }).catch(() => {
      this.setData({ refreshing: false, refreshText: '刷新失败，再试一次' });
    });
  },

  onPulling(e) {
    const dy = (e && e.detail && e.detail.dy) || 0;
    const next = dy >= 60 ? '松手翻册' : '下拉翻册';
    if (next !== this.data.refreshText) this.setData({ refreshText: next });
  },

  onRestore() {
    this.setData({ refreshText: '下拉翻册' });
  },

  /** 云故障横幅重试（截断提示不可点，故只认 retry） */
  onNetBarTap() {
    if (this.data.netBar && this.data.netBar.retry) this.refresh();
  },

  onShow() {
    themeUtil.apply(this);
    // 7.3.0 S1：朋友圈单页模式（朋友圈点进来的落地）——不读空数据（wxml 整页换成落地卡），
    // 并尽量把 tab 栏收起来：单页模式不能切页，留着它就是一排点了没反应的按钮。
    // hideTabBar 在单页模式下可能被拒，失败无妨（那排按钮点了也只是没反应，不会出错）。
    if (this.data.sp) {
      try { wx.hideTabBar({ animation: false, fail: () => {} }); } catch (e) { /* 见上 */ }
      return;
    }
    enter.replay(this);   // 切 tab 回来重播入场（tab 页常驻内存，动画不会自己重来）
    this.getTabBar() && this.getTabBar().setData({ selected: 3, theme: themeUtil.getTheme() });
    this.buildView();
    this.refresh();
    this.refreshProfile(); // 4.20.0：授权资料回显
    this.refreshQuota();   // 7.2.0 L2：额度卡从设置页迁来
    this.refreshSign();    // 7.4.0 R1：时光签 + 积分
  },

  // ===== 7.4.0 R1 今日时光签（留存中心的第一屏）=====

  /** 积分三件套只在这里算：余额 / 差额文案 / 能不能兑 —— 三个调用点说一样的话 */
  _applyPoints(balance) {
    const h = points.artHint(balance);
    this.setData({ signPoints: Math.max(Number(balance) || 0, 0), pointsHint: h.text, pointsReady: h.ready });
  },

  /** 签到状态：同一页两个调用点（勋章墙 / 签到卡）**共用一次请求**。
   *  各拉一次不只是多一次云函数调用 —— 两次返回可能不同（用户刚好在中间签到了），
   *  会出现「勋章说连签 2 天、签到卡说连签 3 天」这种自相矛盾。
   *  拿到后即作废，下次 onShow 重新拉（状态要新，不能一直吃缓存）。 */
  _signStatus() {
    if (!this._signP) {
      this._signP = sign.status().then((s) => { this._signP = null; return s; });
    }
    return this._signP;
  },

  /** 拉签到状态：只看不动。取不到就整块不显示（演示模式 / 云失败） */
  refreshSign() {
    this._signStatus().then((s) => {
      if (!s) return;
      // 积分与签到取同一次返回值：两处各拉一次会出现「这里 128、那里 118」的自相矛盾。
      // 8.0.5：挣分规则也搭这一趟车（服务端 status 顺带下发），「积分怎么来」就不必
      // 为一次弹窗再单开一次云调用；这一次拿不到就沿用上次的，不把规则清空
      this.setData({
        sign: s,
        signText: sign.bannerText(s),
        pointsRules: s.rules || this.data.pointsRules
      });
      this._applyPoints(s.balance);
    });
  },

  /** 收下今日时光签：判定与发奖在服务端，这里只负责说结果 */
  async onCheckIn() {
    if (this.data.signing) return;
    if (this.data.sign && this.data.sign.signed) return;
    this.setData({ signing: true });
    haptics.tap();
    const r = await sign.checkIn();
    this.setData({ signing: false });
    if (!r || !r.ok) {
      wx.showToast({ title: (r && r.msg) || '签到失败，请再点一次', icon: 'none' });
      return;
    }
    track.track('sign_in', { from: 'me', streak: r.streak || 0, milestone: r.milestone || 0 });
    this.setData({ sign: r, signText: sign.bannerText(r) });
    this._applyPoints(r.balance);
    const text = sign.rewardText(r);
    if (r.milestone) wx.showModal({ title: '连签有礼', content: text, showCancel: false, confirmText: '收下' });
    else wx.showToast({ title: text, icon: 'none' });
  },

  /** 8.0.5「积分怎么来」：规则由服务端下发，端上只负责摆出来。
   *  此前这一页只有余额与「还差多少」—— 用户不知道分从哪来，攒到 100 也只会觉得是运气。
   *  拿不到规则就直说拿不到：不编一套默认规则顶上（编的那套迟早和实物对不上）。 */
  onPointsRule() {
    const text = points.rulesText(this.data.pointsRules);
    if (!text) {
      wx.showToast({ title: '规则暂时取不到，稍后再看', icon: 'none' });
      return;
    }
    haptics.tap();
    wx.showModal({ title: '积分怎么来', content: text, showCancel: false, confirmText: '知道了' });
  },

  // ===== 7.4.0 B 段 R2 兑换：100 分 = 1 次 AI 重绘（一天 1 次）=====

  /** 打开兑换确认：把「花多少、还剩多少」摊开给用户看，再让他点确认 */
  onOpenRedeem() {
    const b = this.data.signPoints || 0;
    if (b < points.POINTS_PER_ART) {
      wx.showToast({ title: '积分还不够', icon: 'none' });
      return;
    }
    haptics.tap();
    this.setData({
      redeemShow: true,
      redeemCost: points.POINTS_PER_ART,
      redeemAfter: b - points.POINTS_PER_ART
    });
  },

  onCloseRedeem() {
    if (this.data.redeeming) return; // 兑换进行中不许关，避免用户以为没兑上又点一次
    this.setData({ redeemShow: false });
  },

  /** 确认兑换：判定与入账都在服务端；这里只负责把结果显示出来 */
  async onConfirmRedeem() {
    if (this.data.redeeming) return;
    this.setData({ redeeming: true });
    const r = await points.redeem(points.makeReq());
    this.setData({ redeeming: false });
    if (!r || !r.ok) {
      wx.showToast({ title: (r && r.msg) || '兑换失败，请稍后再试', icon: 'none' });
      return;
    }
    haptics.confirm();
    this.setData({ redeemShow: false });
    this._applyPoints(r.balance);
    this.refreshQuota(); // 额度卡就在下面一张：不刷新就会出现「刚兑了 1 次，可用次数没变」
    track.track('points_redeem', { cost: r.cost || points.POINTS_PER_ART, dup: r.dup ? 1 : 0, left: r.balance || 0 });
    wx.showModal({
      title: '兑换成功',
      content: 'AI 重绘次数 +1，去「图版」用起来吧',
      showCancel: false,
      confirmText: '知道了'
    });
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
    haptics.tap();
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
    haptics.tap();
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

  /** 统计卡三列 + 勋章墙的数据源（一次 listTickets 供两处用） */
  async refresh() {
    // 三件事并行：票根列表（统计卡 + 勋章墙）、签到状态、积分 —— 串行拉会让这一页明显变慢。
    // 7.4.0 C 段 R3：连签与积分那三枚勋章要服务端数据（端上算不了，见 utils/badges.js 文件头）。
    // 两个都取不到就传 null，勋章退化成「只说门槛、不说进度」，一个字都不编。
    const [ts, sg, pt, c] = await Promise.all([
      store.listTickets(), this._signStatus(), points.status(),
      // 绑定态必须现查一次：解绑是**对方手机上**发生的事，本地的 sp_couple_cache 无从作废 ——
      // 只读缓存的话这页的双人勋章会一直亮着，而同一时刻双人空间页说「未绑定」，两页结论相反。
      // 查失败（断网/无云）退回缓存：宁可显示旧的，也不该让已经绑定的用户勋章全灭
      couple.queryCouple().catch(() => couple.cachedCouple())
    ]);
    const m = themeUtil.getThemeMeta(themeUtil.getTheme());
    let shareCount = 0;
    let mapVisited = false;
    let inviteSent = false;
    try { shareCount = wx.getStorageSync(LS_SHARE) || 0; } catch (e) { /* 忽略 */ }
    try { mapVisited = !!wx.getStorageSync('sp_map_visited'); } catch (e) { /* 忽略 */ }
    try { inviteSent = !!wx.getStorageSync('sp_invite_sent'); } catch (e) { /* 忽略 */ }
    // 未解锁的用低透明度正文色置灰（iconSrc 对未知名会回落票根图标，故不必再兜底）
    const badges = computeBadges(ts, c && c.boundAt ? c : null, shareCount, mapVisited, inviteSent, {
      streak: sg && sg.streak,
      lifetime: pt && pt.lifetime
    })
      .map((b) => Object.assign(b, { src: iconSrc(b.icon, b.unlocked ? m.accent : m.text, b.unlocked ? 1 : 0.25) }));
    this._trackBadgeUnlock(badges);
    // 8.0.4：这一页此前是全站唯一「读了列表却不挂横幅」的页面。云库读失败时 store 兜底成
    // 8 张演示票，统计卡与勋章就全按演示数据算 —— 一个字的提示都没有，首用者会以为
    // 别人已经替他存过票了。（tests/list_banner.test.js 原来把 me 放在白名单里，
    // 理由是「偏的是张数不是内容」；对老用户成立，对第一次进来的人不成立。）
    const flags = store.listFlags();
    const netBar = flags.netFallback
      ? { text: '网络开小差了，这页数字暂不可信 · 点我重试', retry: true }
      : (flags.truncated ? { text: `票根超过 ${flags.cap} 张，统计只算到最近的 ${flags.cap} 张`, retry: false } : null);
    this.setData({
      netBar,
      stats: {
        total: ts.length,
        shows: ts.filter((t) => t.type === 'show').length,
        cities: new Set(ts.filter((t) => t.city).map((t) => t.city)).size
      },
      badges,
      unlocked: badges.filter((b) => b.unlocked).length
    });
  },

  /**
   * 7.4.0 C1 遗留：勋章点亮埋点（走 track 双通道，未在后台登记时本地缓冲区仍可对账）。
   * 只报**这次新亮的**：本地存着上次见到的名单，与之相减就是要报的那几枚。
   * 首次进页面（本地没有基准）只记基准、不上报 —— 否则老用户第一次打开会一次性
   * 上报十几条「解锁」，看板上那一天凭空多出一堆假事件。
   */
  _trackBadgeUnlock(badges) {
    try {
      const ids = badges.filter((b) => b.unlocked).map((b) => b.id);
      const prev = wx.getStorageSync('sp_badge_seen');
      if (Array.isArray(prev)) {
        ids.filter((id) => prev.indexOf(id) < 0)
          .forEach((id) => track.track('badge_unlock', { id: id, total: ids.length }));
      }
      wx.setStorageSync('sp_badge_seen', ids);
    } catch (e) { /* 埋点失败不影响页面 */ }
  },

  /** 服务端权威额度（云失败静默，保持本地默认；演示模式取不到 → 整块不渲染） */
  refreshQuota() {
    if (!USE_CLOUD) return;
    pay.getQuota().then((q) => {
      if (!q || typeof q.left !== 'number') return;
      const cap = (q.freePerMonth || 3) + (q.paid || 0);
      this.setData({
        quotaLabel: pay.quotaLabel(q),
        quotaLeftNum: q.left,
        quotaPct: cap > 0 ? Math.max(0, Math.min(100, Math.round((q.left / cap) * 100))) : 0
      });
    });
  },

  /**
   * 4.20.3 清除署名资料 —— 隐私政策里白纸黑字写了「在『我的』一键删除」，
   * 但界面上一直没有这个入口（云函数 profileClear 与 pay.clearProfile 早就写好了）。
   * 这里把承诺补上；没设过昵称头像时按钮不出现。
   */
  clearProfile() {
    wx.showModal({
      title: '清除昵称与头像',
      content: '昵称与头像会从云端删除，票根卡上的落款一并取消。票根本身不受影响。',
      confirmText: '清除',
      confirmColor: '#C26B5E',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await pay.clearProfile();
          this.setData({ profile: { nickname: '', avatar: '' } });
          wx.showToast({ title: '已清除', icon: 'success' });
        } catch (e) {
          wx.showToast({ title: (e && e.message) || '清除失败，请重试', icon: 'none' });
        }
      }
    });
  },

  /** 两个入口的路由：都是没有别的入口的二级页（tab 与设置另有入口） */
  _route(key) {
    haptics.tap();
    const PAGE = { duo: '/pages/duo/duo', annual: '/pages/annual/annual', setting: '/pages/setting/setting' };
    if (PAGE[key]) wx.navigateTo({ url: PAGE[key] });
  },

  onEntry(e) { this._route(e.currentTarget.dataset.key); },
  goSetting() { this._route('setting'); },

  // ===== 7.3.0 S1/S2：分享我的收藏册（此前「我的」没有分享出口，好友与朋友圈一起补上） =====
  onShareAppMessage() {
    track.track('share_click', { from: 'me' });
    return share.message('ticket', {}); // 无 id → 落地回收藏册（别人点开读不到我的票，见 share.js）
  },
  onShareTimeline() {
    track.track('share_timeline', { from: 'me' });
    return share.timeline('ticket', {});
  },

  // ===== 4.22.2 ICP 备案展示（工信部要求：小程序底部标注备案号；点击复制） =====
  copyIcp() {
    wx.setClipboardData({ data: '粤ICP备20010271号-11X' });
  }
});
