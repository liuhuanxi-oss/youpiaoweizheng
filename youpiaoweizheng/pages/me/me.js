// pages/me/me.js —— 我的（授权资料 + 统计 + 勋章墙 + 图版次数包）
// M4：勋章从真实数据自动点亮（13 枚动态解锁 + 进度文案；4.17.0 增「时光同谋」）。
// 绑定态读 couple 缓存；"时光信使"读分享/导出本地计数。
// 4.20.0：授权登录资料（头像 chooseAvatar / 昵称 type=nickname → 云端 user_profile，
//   后续拉新推广活动依赖）；图版次数包入口（虚拟支付，utils/pay.js）。
const mock = require('../../utils/mock.js');
const store = require('../../utils/store.js');
const themeUtil = require("../../utils/theme.js");
const couple = require('../../utils/couple.js');
const { USE_CLOUD } = require('../../utils/env.js');
const pay = require('../../utils/pay.js');
const track = require('../../utils/track.js'); // 4.21.0：会员提醒意向埋点

const LS_SHARE = 'sp_share_count';
const LS_VIP_NOTIFY = 'sp_vip_notify';        // 4.21.0：会员上线提醒意向标记
const VIP_SUB_TMPL_ID = '';                   // 4.21.0：订阅消息模板 ID（MP 后台建「上线提醒」模板后回填；空=仅记录意向）

/** 13 枚勋章的自动判定（base 取 mock 定义里的 icon/name/默认 desc；4.17.0 增「时光同谋」） */
function computeBadges(ts, coupleInfo, shareCount, mapVisited, inviteSent) {
  const total = ts.length;
  const shows = ts.filter((t) => t.type === 'show');
  const movies = ts.filter((t) => t.type === 'movie');
  const traffic = ts.filter((t) => t.type === 'traffic');
  const cities = new Set(ts.filter((t) => t.city).map((t) => t.city));
  const showCities = new Set(shows.filter((t) => t.city).map((t) => t.city));

  const crossNY = ts.some((t) => {
    const md = String(t.date || '').slice(5);
    return t.type === 'show' && (md === '12-31' || md === '01-01');
  });
  const lateNight = ts.some((t) => {
    const time = String(t.time || '');
    return time >= '23:00' || (!!time && time <= '05:59');
  });
  const repeat = {};
  shows.forEach((t) => { repeat[t.title] = (repeat[t.title] || 0) + 1; });
  const hasRepeat3 = Object.values(repeat).some((n) => n >= 3);

  const B = mock.badges;
  const def = (i, unlocked, progress) => ({ ...B[i], unlocked, desc: unlocked ? B[i].desc : progress });

  return [
    def(0, total >= 1, '收下第一张票根'),
    def(1, shows.length >= 10, `还差 ${10 - shows.length} 场`),
    def(2, crossNY, '在 12.31 或 01.01 看一场'),
    def(3, !!coupleInfo, '绑定最重要的人'),
    def(4, movies.length >= 100, `还差 ${100 - movies.length} 部`),
    def(5, cities.size >= 10, `还差 ${10 - cities.size} 座`),
    def(6, lateNight, '看一场 23 点后的场次'),
    def(7, traffic.length >= 10, `还差 ${10 - traffic.length} 次`),
    def(8, hasRepeat3, '同一乐队看满三场'),
    def(9, showCities.size >= 5, `还差 ${5 - showCities.size} 城`),
    def(10, shareCount >= 10, `还差 ${10 - shareCount} 张`),
    def(11, mapVisited && cities.size >= 3, cities.size >= 3 ? '去足迹地图点亮' : `还差 ${3 - cities.size} 座城`),
    // 4.17.0 M2 时光同谋：发起过邀请分享，或已和 TA 绑定（绑定的必然发起过邀请）
    def(12, !!inviteSent || !!coupleInfo, '把双人空间分享给 TA')
  ];
}

Page({
  data: {
    theme: "paper",
    // v6.2 外观主题入口卡：当前主题元数据 + 三主题主色小圆点（真正的选择器在 pages/theme）
    curTheme: themeUtil.getThemeMeta('paper'),
    curThemeName: '暖光治愈',
    themeDots: themeUtil.THEME_META.map((t) => ({ key: t.key, primary: t.primary })),
    stats: { total: 0, shows: 0, cities: 0 },
    // 4.20.0 授权资料 + 次数包（quotaLabel 初值由公共格式化生成，避免与云端口径漂移）
    profile: { nickname: '', avatar: '' },
    quotaLabel: pay.quotaLabel({ freeLeft: 3, paid: 0, left: 3, freePerMonth: 3 }),
    quotaLeftNum: -1,     // 4.21.0：次数包卡余量大字（-1 = 未取到，不渲染）
    vipSubscribed: false, // 4.21.0：会员上线提醒已记意向
    nickFocus: false,     // 4.22.0：编程聚焦昵称输入框（原生 input 无法 selectComponent 唤起键盘）
    appVersion: '',       // 4.21.0：about 弹层动态版本号
    buyLabel: '¥6 / 10幅',
    badges: mock.badges,
    unlocked: 0,
    unlockedIcons: [],   // M4.5.1 折叠态摘要：已点亮勋章的图标
    badgesOpen: true     // M4.5.1 勋章墙默认展开，可折叠
  },

  onShow() {
    themeUtil.apply(this);
    this.syncCurTheme();
    this.getTabBar() && this.getTabBar().setData({ selected: 3, theme: themeUtil.getTheme() });
    this.setData({ sameOptOut: store.getSameOptOut() }); // 4.11.0：同场印记 opt-out 状态
    // 4.21.0：会员上线提醒意向回显（本地标记为权威）
    try { this.setData({ vipSubscribed: !!wx.getStorageSync(LS_VIP_NOTIFY) }); } catch (e) { /* 忽略 */ }
    this.refresh();
    this.refreshProfile(); // 4.20.0：授权资料 + 服务端额度回显
    this._syncV6Profile();   // v6.0：Lv 等级/收藏天数/署名状态（同步）
  },

  // ===== 4.20.0 授权登录资料（4.20.3 口径修订：署名展示位，纯可选——票根卡/年报署名用，可一键清除） =====

  /** 拉取云端资料 + 权威额度（云失败静默，保持本地默认；输入中不覆盖昵称回显） */
  refreshProfile() {
    if (!USE_CLOUD) return;
    if (!this._nickEditing) {
      pay.getProfile().then((p) => {
        if (p && (p.nickname || p.avatar)) this.setData({ profile: p });
      });
    }
    pay.getQuota().then((q) => {
      if (q && typeof q.left === 'number') {
        this.setData({ quotaLabel: pay.quotaLabel(q), quotaLeftNum: q.left }); // 4.21.0：余量大字直读
      }
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
      const ext = (/\.(\w+)$/.exec(url) || [,'png'])[1];
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

  /** 昵称输入中：实时同步 data（键盘「使用微信昵称」快捷填充后即使未 blur 也不丢值）。
      4.22.5（BUG审查⑩）：_savedNick 快照已由 onNickFocus 统一设置（输入必先聚焦），移除此处的不可达初始化 */
  onNickInput(e) {
    if (this.data.nickHint) this.setData({ nickHint: '' }); // 开始输入即撤引导
    this.setData({ 'profile.nickname': String(e.detail.value || '').slice(0, 24) });
  },

  /** 聚焦：进入编辑态（onShow 云端回显暂停覆盖）+ 快照已保存值 + 首次引导（昵称为空时） */
  onNickFocus() {
    this._nickEditing = true;
    this._savedNick = this.data.profile.nickname;
    if (this.data.nickFocus) this.setData({ nickFocus: false }); // 编程聚焦一次性触发后复位
    if (!this.data.profile.nickname && !this.data.nickHint) {
      // 4.20.1：type=nickname 的授权交互是键盘上方快捷条——部分机型不显示，显性告知
      this.setData({ nickHint: '键盘上方点「使用微信昵称」一键填入，或直接输入' });
    }
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
    if (this.data.nickHint) this.setData({ nickHint: '' }); // 离开输入框撤引导
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

  // ===== 4.20.0 图版次数包（虚拟支付） =====

  async buyPack() {
    if (this._buying) return;
    if (!USE_CLOUD) { wx.showToast({ title: '演示模式不支持支付', icon: 'none' }); return; }
    this._buying = true;
    wx.showLoading({ title: '正在拉起支付…', mask: true });
    const r = await pay.buyArtPack((s) => { wx.showLoading({ title: s, mask: true }); });
    wx.hideLoading();
    this._buying = false;
    if (r.ok) {
      this.setData({ quotaLabel: pay.quotaLabel(r.quota), quotaLeftNum: r.quota && typeof r.quota.left === 'number' ? r.quota.left : this.data.quotaLeftNum });
      wx.vibrateShort({ type: 'medium' });
      wx.showToast({ title: '次数包已到账', icon: 'success' });
      return;
    }
    if (r.cancelled) return; // 用户主动取消：静默
    wx.showModal({
      title: r.pending ? '到账稍有延迟' : '这次没有买成',
      content: r.msg || '支付未完成，请稍后再试',
      showCancel: false,
      confirmText: '知道啦'
    });
  },

  // —— 4.11.0 同场印记 opt-out（PRD L52：设置可退出参与匿名聚合） ——
  /** v6.2：外观主题入口 → 独立选择页；返回时 syncCurTheme 刷新入口卡 */
  goTheme() {
    wx.navigateTo({ url: '/pages/theme/theme' });
  },

  /** 把当前主题元数据同步到入口卡（onShow 与从 theme 页返回时调） */
  syncCurTheme() {
    const meta = themeUtil.getThemeMeta(themeUtil.getTheme());
    this.setData({ curTheme: meta, curThemeName: meta.name });
  },

  // —— M4.5.1 勋章墙折叠/展开（横向滑动勋章条） ——
  async refresh() {
    const ts = await store.listTickets();
    const c = couple.cachedCouple();
    let shareCount = 0;
    let mapVisited = false;
    try { shareCount = wx.getStorageSync(LS_SHARE) || 0; } catch (e) { /* 忽略 */ }
    try { mapVisited = !!wx.getStorageSync('sp_map_visited'); } catch (e) { /* 忽略 */ }
    let inviteSent = false;
    try { inviteSent = !!wx.getStorageSync('sp_invite_sent'); } catch (e) { /* 忽略 */ }
    const badges = computeBadges(ts, c && c.boundAt ? c : null, shareCount, mapVisited, inviteSent);

    // 4.8.0 勋章解锁提醒：对比上次快照，有新增才提示（首次记录快照、不提示）
    const curIds = badges.filter((b) => b.unlocked).map((b) => b.id);
    let prevIds = [];
    try { prevIds = wx.getStorageSync('sp_badge_prev') || []; } catch (e) { /* 忽略 */ }
    if (Array.isArray(prevIds) && prevIds.length > 0) {
      const fresh = badges.filter((b) => b.unlocked && prevIds.indexOf(b.id) === -1);
      if (fresh.length) {
        wx.vibrateShort({ type: 'medium' });
        wx.showToast({ title: '🏅 解锁新勋章「' + fresh[0].name + '」', icon: 'none', duration: 2500 });
        this.setData({ burstId: fresh[0].id });
        setTimeout(() => { this.setData({ burstId: '' }); }, 3400);
      }
    }
    try { wx.setStorageSync('sp_badge_prev', curIds); } catch (e) { /* 忽略 */ }

    this.setData({
      stats: {
        total: ts.length,
        shows: ts.filter((t) => t.type === 'show').length,
        cities: new Set(ts.filter((t) => t.city).map((t) => t.city)).size
      },
      badges,
      unlocked: badges.filter((b) => b.unlocked).length,
      unlockedIcons: badges.filter((b) => b.unlocked).map((b) => b.icon)
    });
  },

  // ===== 4.21.0 会员上线提醒（替代原「敬请期待」死 toast——死链变活卡） =====
  // 有订阅模板：走 requestSubscribeMessage 正式订阅；未配置：记录意向（本地标记 + 埋点）。
  // 意向名单即触点资产：上线当天就是一轮可推送的唤醒。
  async vipNotify() {
    track.track('vip_notify_tap', {});
    wx.vibrateShort({ type: 'light' });
    if (VIP_SUB_TMPL_ID && wx.requestSubscribeMessage) {
      try {
        const r = await wx.requestSubscribeMessage({ tmplIds: [VIP_SUB_TMPL_ID] });
        if (r && r[VIP_SUB_TMPL_ID] === 'accept') {
          try { wx.setStorageSync(LS_VIP_NOTIFY, Date.now()); } catch (e) { /* 忽略 */ }
          this.setData({ vipSubscribed: true });
          wx.showToast({ title: '好，上线第一时间通知你', icon: 'none' });
          return;
        }
      } catch (e) { /* 授权失败落意向标记 */ }
    }
    if (this.data.vipSubscribed) return; // 已记过不再重复提示
    try { wx.setStorageSync(LS_VIP_NOTIFY, Date.now()); } catch (e) { /* 忽略 */ }
    this.setData({ vipSubscribed: true });
    wx.showToast({ title: '已记下！上线后首页会告诉你', icon: 'none' });
  },

  // ===== 4.22.2 ICP 备案展示（点击复制；小程序内无法直跳工信部站点） =====
  copyIcp() {
    wx.setClipboardData({ data: '粤ICP备20010271号-11X' });
  },

  // ===== v6.0 我的页功能入口（替代旧版冗长业务，按方案 v6 设计简洁列表） =====
  /** 同步 v6 hero 用的衍生字段：Lv 等级 / 收藏天数 / 署名状态 / VIP */
  _syncV6Profile() {
    const profile = this.data.profile || {};
    const total = (this.data.stats && this.data.stats.total) || 0;
    const signed = !!profile.nickname;
    let firstDay = 30;
    try { firstDay = Math.max(1, Math.floor((Date.now() - (wx.getStorageSync('sp_first_saved') || Date.now())) / 86400000) + 1); } catch (e) { /* 忽略 */ }
    this.setData({
      'profile.level': 1 + Math.floor(total / 10),
      'profile.collectDays': firstDay,
      'profile.signature': signed,
      'profile.vip': !!this.data.vipSubscribed
    });
  },

  goCollection() { wx.switchTab({ url: '/pages/album/album' }); },
  goMap() { wx.navigateTo({ url: '/pages/map/map' }); },
  goAnnual() { wx.navigateTo({ url: '/pages/annual/annual' }); },
  // v6.6.1 新增：duo 不是 tab 页，此前 App 内唯一入口是 bind 页那两个必然失败的
  // wx.switchTab，双人空间/时间线/回忆报告 三页整簇不可达。这里补正常入口。
  goDuo() { wx.navigateTo({ url: '/pages/duo/duo' }); },
  goRecycle() { wx.showToast({ title: '回收站开发中，敬请期待', icon: 'none' }); },
  goBadges() { wx.showToast({ title: '勋章墙开发中，敬请期待', icon: 'none' }); },
  goSetting() { wx.showToast({ title: '设置项开发中，敬请期待', icon: 'none' }); },

  // v6.1 修复：me.wxml 绑定但此前未定义（点击无响应）
  goPrivacy() { wx.navigateTo({ url: '/pages/protocol/protocol?type=privacy' }); },
  goProtocol() { wx.navigateTo({ url: '/pages/protocol/protocol?type=terms' }); },

  // 4.22.2 ICP 备案展示（工信部要求：小程序底部标注备案号；点击复制）
  copyIcp() {
    wx.setClipboardData({ data: '粤ICP备20010271号-11X' });
  }
});
