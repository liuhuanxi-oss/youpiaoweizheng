// pages/home/home.js —— 票根墙（品牌全案 · 稿屏2，tab 页）
// ============================================================
// 版式：品牌行（logo + 有票为证 + 人像）→ 两行问候语（左侧花枝、右侧金星与波浪）
//   → 搜索框 → 四个分类胶囊 → 2 列齿边票根卡（每张带邮戳、照片角上的花、收藏心）。
//
// 【为什么不是瀑布流了】旧版按奇偶把票分成两列错落排；稿屏2 的三排卡片上下是对齐的，
//   两列只是同一行的左右两格。改成等高网格后，齿边底图才编得成一张定尺的图形 ——
//   瀑布流每张高度不同，就得逐卡编一张 data-uri（一张底图好几 KB，setData 会撑爆）。
//
// 【邮戳里为什么不印日期】稿里邮戳内圈是三行小字（BEIJING / 23 / APR 2024）。按卡宽折算，
//   那行字只有 10rpx 上下，真机上就是一团墨点，而且日期在卡片下方已经写了一行。
//   所以戳里只留城市 + 年份 —— 该有的信息都在，只是不重复第二遍。
// ============================================================
const store = require('../../utils/store.js');
const themeUtil = require('../../utils/theme.js');
const track = require('../../utils/track.js');
const deco = require('../../utils/deco.js');
const enter = require('../../utils/enter.js');
const { iconSrc } = require('../../utils/icons.js');
const share = require('../../utils/share.js'); // 7.3.0 A6：长按菜单里的「分享」要转发这一张
const sign = require('../../utils/sign.js');   // 7.4.0 R1：今日时光签（端上只读，判定在服务端）
const memory = require('../../utils/memory.js'); // 7.4.0 R4 / 8.1.5：那年今天 → 同月 → 轮换重温（三级都说真话）
const legacy = require('../../utils/legacy.js'); // 8.1.0 老票根专场：那一行的显示规则（不是每人都该看到）
const haptics = require('../../utils/haptics.js'); // 7.4.0：触觉三档，别再直接写 vibrateShort

// —— 尺寸（rpx）：WXSS 里写死的宽高必须与这里一致 ——
// 8.1.1：卡高 240 → 256，多出来的 16rpx 给了照片（132 → 144）与地点行（22 → 26）——
// 照片是这张卡唯一「有内容」的部分；地点行原先 22rpx 的行高连 22rpx 的字都兜不住。
const CARD_W = 310, CARD_H = 256;   // 一张票根卡（(750 - 48×2 - 34) / 2 的列宽）
const PM_R = 48;                    // 邮戳半径（卡片右上角那枚，直径 96）

/** 分类筛选。8.1.1 起这四枚不再自己占一行胶囊（见 home.wxml .hc-find），
 *  而是「筛选」按钮点开的那份清单 —— 所以这里只留 key 与显示名。
 *  图标不在这里写：没照片时的兜底图标由下面 TYPE_ICONS 那份管，两处各写一份必漏一处。 */
const FILTERS = [
  { key: 'show', name: '演出' },
  { key: 'movie', name: '电影' },
  { key: 'traffic', name: '交通' },
  { key: 'travel', name: '旅行' }
];

/** key → 显示名（'' 或认不出的 key 都回空串，按钮上会兜底成「全部」） */
function filterName(key) {
  const f = FILTERS.find((x) => x.key === key);
  return f ? f.name : '';
}

/** 类型 → 没照片时的兜底图标名 */
const TYPE_ICONS = { show: 'mask', movie: 'film', traffic: 'train', travel: 'plane' };

/** 7.4.3：把「类型 → 兜底图标」编成一张映射表（每个类型一张，外加未知类型的兜底）。
 *  原先每张票根各塞一个 data-uri，500 张就是 ~186KB，点一次分类胶囊全量过一遍 setData 桥；
 *  而图标只跟 type 有关，编 5 张就够 —— 列表数据从此不含图形。 */
function buildTypeIc(color) {
  const map = {};
  Object.keys(TYPE_ICONS).forEach((k) => { map[k] = iconSrc(TYPE_ICONS[k], color, 0.4, 1.5); });
  map._ = iconSrc('ticket', color, 0.4, 1.5);
  return map;
}

// A8 新用户三步引导：拍一张 → AI 认字 → 上墙（只看一次，可跳过）
const GUIDE_KEY = 'sp_guide_done';
const GUIDE = [
  { ico: 'camera', title: '拍一张', desc: '对准票根拍下来，拍歪了也认得出' },
  { ico: 'wand', title: 'AI 自动认字', desc: '票名、时间、地点自动填好，你核对一下就行' },
  { ico: 'ticket', title: '贴上票根墙', desc: '收进你的册子，随时翻回那一天' }
];

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const FAV_KEY = 'fav_ids';
/** 滚过这么多（px）就认为品牌行已经吸顶。给一点点余量，免得上下一抖就闪边框 */
const HEAD_STICK_AT = 8;

/** 邮戳两行：城市 / MON YYYY（稿样「PARIS · 14 · JUN 1956」，这里只留城市与年月，见文件头） */
function stampParts(t) {
  const s = String(t.date || '');
  const mi = parseInt(s.slice(5, 7), 10);
  const y = s.slice(0, 4);
  const city = String(t.city || '').trim();
  return {
    stampCity: city ? city.slice(0, 8) : '',
    stampYear: y && mi ? `${MON[mi - 1]} ${y}` : ''
  };
}

Page({
  data: {
    theme: 'paper',
    // 入场动效开关（.fade-up 挂在根节点上）。初值为真：首次进场不该「先亮一帧再淡入」
    enter: true,
    // 品牌行吸顶态：滚过一点才浮出实底与描边（.is-stuck）。滚回顶部就收回去
    stuck: false,
    // 列表淡入开关：骨架替成真数据、切分类时重播一次（节点没重建，动画不会自己重来）
    listIn: true,
    loading: true,
    // 空 = 不过滤（「全部」）。原为 'show'（默认亮着「演出」）：
    // 那样只有电影票 / 车票的用户进首页看到的是「这里还没贴上票根」——
    // 有票却被说成一张都没有，这是假空态；分类是筛选，不该决定首屏能不能看到自己的票。
    active: '',
    activeName: '',      // 筛选按钮上那句当前分类（空 = 全部，WXML 里兜底）
    colA: [],
    colB: [],
    total: 0,
    hasAny: false,       // 账号里到底有没有票根 —— 空态文案要分清「这个分类没票」和「一张都没有」
    ic: {}, art: {},
    // 云故障 / 超上限横幅（{ text, retry }；null = 不显示）。同 album 的 netBar
    netBar: null,
    flyingId: '',        // A1：正在「飞向详情」的那张卡（照片放大淡出期间），其余时刻为空
    // A8 新用户引导：0 = 不显示，1..3 = 当前步号
    guide: 0, guideTitle: '', guideDesc: '', guideIc: '',
    // A6 长按快捷菜单（7.3.0）：menuId/menuTitle 是「被长按的那一张」
    menu: false, menuId: '', menuTitle: '',
    // 7.4.0 R1 今日时光签：sign 为 null 时整块不渲染（演示模式 / 云失败都保持这样）
    sign: null, signText: { title: '', sub: '', btn: '' }, signing: false,
    // 7.4.0 R4 那年今天：null = 三档都不成立（票太少的新用户），整行不显示。见 utils/memory.js
    mem: null,
    // 8.1.0 老票根专场：只在「有票、但一张五年前的都没有」时露一次脸（见 utils/legacy.js）
    legacy: false
  },

  _all: [],
  _ink: '',            // 上次编译图形用的正文色，主题没变就不重编
  // 已经「就位」的照片（id → true）。挂在页面上而不是挂在每条数据里：
  // 列表每次重建（换分类 / 下拉刷新）都会造一批新对象，而节点是按 id 复用的 ——
  // src 没变的那张图不会再触发 bindload，标记一丢，照片就永久停在透明态。
  _ready: {},

  onShow() {
    themeUtil.apply(this);
    enter.replay(this);   // 切 tab 回来重播入场（tab 页常驻内存，动画不会自己重来）
    this.buildArt();
    this.getTabBar && this.getTabBar().setData({ selected: 0, theme: themeUtil.getTheme() });
    this.refresh();
    this.refreshSign();
  },

  /**
   * 切走时把「飞向详情」的定时器停掉并复位，两个理由缺一不可：
   * ① 它 150ms 后会在**已隐藏的 tab 页**上发起 navigateTo —— 详情页会突然盖在别的 tab 上；
   * ② 不复位 _flying，切回来时卡片就永久点不动了（防连点标记卡住）。
   * 用 onHide 而不是 onUnload：首页是 tab 页，切 tab 只触发 onHide，页面常驻不卸载。
   */
  onHide() {
    if (this._flyTimer) { clearTimeout(this._flyTimer); this._flyTimer = null; }
    this._flying = false;
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  /** 品牌行吸顶：只在「跨过阈值」那一次 setData。
   *  每帧都推会让滚动掉帧；这里绝大多数帧只是一次数字比较，开销可以忽略。 */
  onPageScroll(e) {
    const stuck = (e.scrollTop || 0) > HEAD_STICK_AT;
    if (stuck === this.data.stuck) return;
    this.setData({ stuck });
  },

  /** 拉全量票根 → 逐卡预处理（日期 / 邮戳 / 收藏态） → 按当前分类分两列 */
  async refresh() {
    this.setData({ loading: true });
    try {
      const raw = await store.listTickets();
      // 列表状态横幅：云库读取失败时 store 会兜底成演示票根，此时页面上全是
      // 「不是用户的票」——不说明白，用户会当成自己的收藏丢了或者凭空多出来。
      const flags = store.listFlags();
      const netBar = flags.netFallback
        ? { text: '网络开小差了，先看演示票根 · 点我重试', retry: true }
        : (flags.truncated ? { text: `票根超过 ${flags.cap} 张，当前显示最近的 ${flags.cap} 张`, retry: false } : null);
      const all = (raw || [])
        .filter((t) => t && t.title)
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      const favIds = this._loadFav();
      this._all = all.map((t) => Object.assign({}, t, {
        // ⚠️ 主键统一用 id：store.listTickets 已把云库的 _id 归一成 id，
        // 旧版这里读写的是 t._id，演示数据里根本没有这个字段 —— 收藏心点了不会亮。
        dateText: String(t.date || '').replace(/-/g, '.'),
        fav: favIds.indexOf(t.id) >= 0,
        loaded: !!this._ready[t.id]
      }, stampParts(t)));
      // 每次都写（含 null）：上一次亮过横幅、这次恢复正常时必须能收回去
      // 那年今天跟着列表一起算（三档都落空才是 null，整行不显示 —— 不编一句假的回忆）
      // 老票根专场同理：不该显示就不显示（含云兜底那条路径，理由见 utils/legacy.js）
      this.setData({ netBar, mem: memory.row(this._all), legacy: legacy.row(this._all, flags) });
      this.applyFilter();
      this.maybeGuide();
    } catch (e) {
      // 兜底链本身也抛（storage 损坏等）：不许留下一句与当前数据不符的横幅
      this.setData({ loading: false, netBar: null });
    }
  },

  // ===== 7.4.0 R1 今日时光签（每天来的第一个理由）=====

  /** 拉签到状态：只看不动。取不到就整块不显示 —— 不摆一个点不动的假横条 */
  refreshSign() {
    sign.status().then((s) => {
      if (!s) return;
      this.setData({ sign: s, signText: sign.bannerText(s) });
    });
  },

  /**
   * 收下今日时光签。服务端判定 + 发奖，端上只负责把结果说出来：
   * 命中连签阶梯（第 3/7/14 天）用弹窗，普通签到用轻提示 —— 重量级要和奖励匹配。
   */
  async onCheckIn() {
    if (this.data.signing) return;
    if (this.data.sign && this.data.sign.signed) return; // 已经收过就别再发一次请求
    this.setData({ signing: true });
    haptics.tap();
    const r = await sign.checkIn();
    this.setData({ signing: false });
    if (!r || !r.ok) {
      wx.showToast({ title: (r && r.msg) || '签到失败，请再点一次', icon: 'none' });
      return;
    }
    track.track('sign_in', { streak: r.streak || 0, milestone: r.milestone || 0 });
    this.setData({ sign: r, signText: sign.bannerText(r) });
    const text = sign.rewardText(r);
    if (r.milestone) wx.showModal({ title: '连签有礼', content: text, showCancel: false, confirmText: '收下' });
    else wx.showToast({ title: text, icon: 'none' });
  },

  /** 那年今天 → 直接进那一天（回忆该有的落点：点开就是那张票根本身）。
   *  8.1.5 起这一行有三档，埋点带上 kind：不然「今天真有回忆」和「只是轮到了这一张」
   *  在数据里长得一模一样，这个功能到底有没有把人叫回来就说不清了。 */
  goMemory() {
    const m = this.data.mem;
    if (!m || !m.id) return;
    haptics.tap();
    track.track('memory_open', { years: m.years || 0, kind: m.kind || '' });
    wx.navigateTo({ url: `/pages/detail/detail?id=${m.id}` });
  },

  /** 云故障横幅重试（截断提示不可点，故只认 retry） */
  onNetBarTap() {
    if (this.data.netBar && this.data.netBar.retry) this.refresh();
  },

  /** 当前分类 → 左右两列 */
  applyFilter() {
    const key = this.data.active;
    const list = key ? this._all.filter((t) => t.type === key) : this._all;
    const colA = [];
    const colB = [];
    list.forEach((t, i) => (i % 2 ? colB : colA).push(t));
    this.setData({ colA, colB, total: list.length, hasAny: this._all.length > 0, loading: false });
  },

  /** 8.1.1 筛选：点开一份原生清单（「全部」+ 四个分类）。
   *  原先这四个是常驻胶囊，自己占一行 90rpx —— 而这一页的主角是墙，
   *  筛选只是个偶尔动一下的动作，收进按钮里，还把「现在在哪个分类」写在按钮上。
   *  用 showActionSheet 而不是自绘弹层：系统原生的，零 UI 代码，5 项也没到它的 6 项上限
   *  （全项目已有多处在用，见 detail.js onMore）。 */
  onFilterOpen() {
    const names = ['全部'].concat(FILTERS.map((f) => f.name));
    wx.showActionSheet({
      itemList: names,
      success: (res) => {
        // 0 号是「全部」→ 空 key（不过滤）；其余按 FILTERS 的次序往后挪一位
        this.onFilter(res.tapIndex === 0 ? '' : FILTERS[res.tapIndex - 1].key);
      }
    });
  },

  /** 切到某个分类；空 key = 回到全部。
   *  「全部」这条路必须有 —— 否则点进一个空分类就再也回不到全部票根了。
   *  也保留原来的规矩：同一个 key 再选一次不重算，免得整面墙白闪一下。 */
  onFilter(key) {
    const next = String(key || '');
    if (next === this.data.active) return;
    haptics.tap();
    track.track('home_filter', { key: next });
    this.setData({ active: next, activeName: filterName(next) });
    this.applyFilter();
    this._replayListIn();
  },

  /** 重播列表淡入：节点还在（只是换了数据），动画不会自己重来 ——
   *  先摘类名、隔一次渲染再挂回（与 utils/enter.js 同一套路），否则这里是「唰」地一下换掉。 */
  _replayListIn() {
    clearTimeout(this._tIn);
    this.setData({ listIn: false });
    this._tIn = setTimeout(() => this.setData({ listIn: true }), 30);
  },

  /** 收藏心：本地 storage（fav_ids），云端字段后续接入 */
  _loadFav() {
    try { return wx.getStorageSync(FAV_KEY) || []; } catch (e) { return []; }
  },
  toggleFav(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const favIds = this._loadFav();
    const i = favIds.indexOf(id);
    if (i >= 0) favIds.splice(i, 1); else favIds.push(id);
    try { wx.setStorageSync(FAV_KEY, favIds); } catch (e) { /* storage 异常静默 */ }
    haptics.tap();
    const on = favIds.indexOf(id) >= 0;
    // 只把变的那一张推过去。整列重传一次等于把几十张卡（连 data-uri 底图）全量过一遍，
    // 票多的用户每点一次心都卡一下 —— 而这只值一个布尔值。
    const patch = {};
    const ia = this.data.colA.findIndex((t) => t.id === id);
    const ib = this.data.colB.findIndex((t) => t.id === id);
    if (ia >= 0) patch['colA[' + ia + '].fav'] = on;
    if (ib >= 0) patch['colB[' + ib + '].fav'] = on;
    if (ia < 0 && ib < 0) return;   // 两列都没这张（列表刚被筛掉）：不推空数据
    this.setData(patch);
  },

  /** 照片就位（解码完成 / 加载失败都算）：淡入落位。失败也放行，
   *  否则那张卡的照片会永远停在透明态 —— 比加载失败本身更像坏了 */
  onShotReady(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this._ready[id] = true;
    const patch = {};
    const ia = this.data.colA.findIndex((t) => t.id === id);
    const ib = this.data.colB.findIndex((t) => t.id === id);
    if (ia >= 0 && !this.data.colA[ia].loaded) patch['colA[' + ia + '].loaded'] = true;
    if (ib >= 0 && !this.data.colB[ib].loaded) patch['colB[' + ib + '].loaded'] = true;
    if (!Object.keys(patch).length) return;
    this.setData(patch);
  },

  /** 主题切换 / 换页回来都要重编一遍图形（data-uri 里的颜色是编译时写死的） */
  buildArt() {
    const m = themeUtil.getThemeMeta(themeUtil.getTheme());
    if (this._ink === m.text && this.data.art.card) return;
    this._ink = m.text;
    const pm = deco.postmarkParts(m);
    // 图标一律按主题的正文色编（SVG 不认 CSS 变量）—— 所以主题一变就得整批重编
    this.setData({
      ic: {
        brand: iconSrc('user', m.text, 0.72, 1.6),
        search: iconSrc('search', m.text, 0.5, 1.5),
        pin: iconSrc('pin', m.text, 0.5, 1.4),
        // 8.1.1 今天卡：签到那行没收下是日历（今天这件事），收下了换对勾（今天已了结）
        signIc: iconSrc('calendar', m.text, 0.5, 1.5),
        signDone: iconSrc('check', m.text, 0.5, 1.5),
        memIc: iconSrc('clock', m.text, 0.5, 1.5),   // 7.4.0 R4 那年今天
        legacyIc: iconSrc('ticket', m.text, 0.5, 1.5), // 8.1.0 老票根专场
        goIc: iconSrc('chevron', m.text, 0.4, 1.5),
        heartOn: iconSrc('heart', '#E8AFA8', 1, 1.5, true),
        heartOff: iconSrc('heart', m.text, 0.35, 1.5),
        emptyIc: iconSrc('ticket', m.text, 0.28, 1.4)
      },
      // 没照片时的兜底图标：编成映射表，列表里每张票根只带一个 type 字符串
      typeIc: buildTypeIc(m.text),
      art: {
        // 卡片是等高网格 → 底图只编一张，六张卡共用（见文件头）
        card: deco.pinkedPanel(CARD_W, CARD_H, { fill: '#FFFDF8', ink: '#C9A469', tooth: 16, amp: 4, inset: 4, strokeAlpha: 0.28 }),
        pmRing: pm.ring,
        pmWave: pm.wave,
        bloom: deco.decoSrc('bloom', Object.assign({}, m, { paper: '#FFFDF8', leaf: '#A9C3A6', core: '#EFB7AE' })),
        sprig: deco.decoSrc('sprig', Object.assign({}, m, { primary: '#A9C3A6', accent: '#FFFDF8' })),
        // 问候语左边那枝白花：与 duo 页同一枝（daisy 的茎够长，才撑得起竖着的版面）
        daisy: deco.decoSrc('daisy', Object.assign({}, m, { paper: '#FFFDF8', leaf: '#A9C3A6', core: '#F6DFA8' })),
        star: deco.decoSrc('star4', Object.assign({}, m, { accent: '#E2B85C' })),
        // wavelines 取的是 primary（不是 accent），传错键会静默落回戳红，颜色就不对了
        wave: deco.decoSrc('wavelines', Object.assign({}, m, { primary: '#E9B3AA' }))
      }
    });
  },

  // —— 搜索 → 票夹页（搜索功能落点）｜人像 → 个人中心 ｜ 空态 CTA → 拍照 ——
  goSearch() {
    track.track('home_search', {});
    wx.switchTab({ url: '/pages/album/album' });
  },
  goProfile() {
    wx.switchTab({ url: '/pages/me/me' });
  },
  goScan() {
    haptics.tap();
    track.track('home_cta_scan', {});
    wx.navigateTo({ url: '/pages/scan/scan' });
  },

  /** 8.1.0 老票根专场：翻出抽屉里的票来拍（这一行的显示规则见 utils/legacy.js） */
  goLegacy() {
    haptics.tap();
    track.track('legacy_enter', { from: 'home' });
    wx.navigateTo({ url: '/pages/legacy/legacy' });
  },
  /**
   * A1 近似共享元素：小程序不支持真共享元素（M4.5 已定论），用两段式近似——
   * 本页照片 150ms 放大淡出（.fly），详情页那侧由 .fade-up 接住落位。
   * 防连点：动画期间再点不重复入栈（navigateTo 栈满会直接失败）。
   * reduced-motion：动画由 CSS 媒体查询关掉，这 150ms 的等待保留——
   *   为它做一次 JS 侧偏好探测要多一份跨基础库的兼容代码，收益只是少等 0.15 秒。
   */
  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this._flying) return;
    this._flying = true;
    this.setData({ flyingId: id });
    this._flyTimer = setTimeout(() => {
      this._flyTimer = null;
      wx.navigateTo({
        url: `/pages/detail/detail?id=${id}`,
        // 跳转动画结束后再复位：先复位会在新页盖上来之前闪回原状
        complete: () => { this._flying = false; this.setData({ flyingId: '' }); }
      });
    }, 150);
  },

  // ===== A6 长按快捷菜单（7.3.0）=====
  /**
   * 长按票根卡：弹出「生成纪念卡片 / 分享给好友 / 删除」。
   * 长按与点击不冲突 —— 长按触发后小程序会吞掉随之而来的 tap，不会顺带跳详情。
   * 震一下是长按唯一的「握住了」反馈：没有它，手感上就是「按了没反应」。
   */
  onCardLong(e) {
    const d = e.currentTarget.dataset;
    if (!d.id) return;
    haptics.tap();
    track.track('menu_long', { from: 'home' });
    this.setData({ menu: true, menuId: d.id, menuTitle: d.title || '' });
  },

  closeMenu() { this.setData({ menu: false }); },

  /** 菜单里删掉了那张 → 重取列表（顺带把骨架屏走一遍，用户看得见「确实没了」） */
  onMenuDeleted() {
    this.setData({ menu: false });
    this.refresh();
  },

  /**
   * 分享：菜单里点「分享给好友」时，res.target 是那个 button，dataset 里带着被长按的那一张；
   * 右上角菜单直接转发时没有 target → 走默认的「我的票根收藏册」（落地收藏册）。
   */
  onShareAppMessage(res) {
    const d = (res && res.target && res.target.dataset) || {};
    track.track('share_click', { from: d.id ? 'home_card' : 'home' });
    return share.message('ticket', { id: d.id, title: d.title });
  },

  // —— A8 新用户三步引导（拍一张 → AI 认字 → 上墙）——
  /**
   * 只在「一张票都还没有」+「没看过」时弹。
   * 一次会话只判一次：refresh() 挂在 onShow 上，切 tab 回来就会再跑一遍，
   * 不设闸的话每次回首页都要重判一次存储。
   */
  maybeGuide() {
    if (this._guideChecked) return;
    this._guideChecked = true;
    if (this._all.length) return;                     // 有票 = 不是新用户
    try { if (wx.getStorageSync(GUIDE_KEY)) return; } catch (e) { /* 读不到就照常引导 */ }
    this._guideSet(1);
    track.track('guide_show', {});
  },

  _guideSet(n) {
    const g = GUIDE[n - 1];
    const m = themeUtil.getThemeMeta(themeUtil.getTheme());
    this.setData({
      guide: n,
      guideTitle: g.title,
      guideDesc: g.desc,
      guideIc: iconSrc(g.ico, m.primary, 1, 1.6)
    });
  },

  guideNext() {
    if (this.data.guide >= GUIDE.length) {
      this._guideDone();
      track.track('guide_scan', {});
      return this.goScan();                            // 最后一步就是去拍那张
    }
    haptics.tap();
    this._guideSet(this.data.guide + 1);
  },

  guideClose() {
    track.track('guide_skip', { step: this.data.guide });
    this._guideDone();
  },

  /** 关掉并记已读：下次进来不再弹（记不住就多看一次，不算故障） */
  _guideDone() {
    this.setData({ guide: 0 });
    try { wx.setStorageSync(GUIDE_KEY, Date.now()); } catch (e) { /* 见上 */ }
  },

  /** 只为 catchtouchmove 挂在浮层上：挡住滑动穿透（浮层底下的票根墙照样会被带着滚） */
  noop() {}
});
