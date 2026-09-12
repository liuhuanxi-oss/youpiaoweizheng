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
const { iconSrc } = require('../../utils/icons.js');

// —— 尺寸（rpx）：WXSS 里写死的宽高必须与这里一致 ——
const CARD_W = 310, CARD_H = 240;   // 一张票根卡（(750 - 48×2 - 34) / 2 的列宽）
const PM_R = 48;                    // 邮戳半径（卡片右上角那枚，直径 96）

const FILTERS = [
  { key: 'show', name: '演出', ico: 'mask' },
  { key: 'movie', name: '电影', ico: 'film' },
  { key: 'traffic', name: '交通', ico: 'train' },
  { key: 'travel', name: '旅行', ico: 'plane' }
];

/** 类型 → 没照片时的兜底图标名 */
const TYPE_ICONS = { show: 'mask', movie: 'film', traffic: 'train', travel: 'plane' };

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const FAV_KEY = 'fav_ids';
const WHITE = '#FFF8F2';   // 压在玫瑰实底上的白

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
    loading: true,
    filters: [],
    active: 'show',      // 稿里默认亮着「演出」（= 空 时不过滤，四个都灭）
    colA: [],
    colB: [],
    total: 0,
    ic: {}, art: {}
  },

  _all: [],
  _ink: '',            // 上次编译图形用的正文色，主题没变就不重编

  onShow() {
    themeUtil.apply(this);
    this.buildArt();
    this.getTabBar && this.getTabBar().setData({ selected: 0, theme: themeUtil.getTheme() });
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  /** 拉全量票根 → 逐卡预处理（日期 / 邮戳 / 收藏态） → 按当前分类分两列 */
  async refresh() {
    this.setData({ loading: true });
    try {
      const raw = await store.listTickets();
      const all = (raw || [])
        .filter((t) => t && t.title)
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      const favIds = this._loadFav();
      this._all = all.map((t) => Object.assign({}, t, {
        // ⚠️ 主键统一用 id：store.listTickets 已把云库的 _id 归一成 id，
        // 旧版这里读写的是 t._id，演示数据里根本没有这个字段 —— 收藏心点了不会亮。
        dateText: String(t.date || '').replace(/-/g, '.'),
        ico: iconSrc(TYPE_ICONS[t.type] || 'ticket', this._ink || '#6B5B50', 0.4, 1.5),
        fav: favIds.indexOf(t.id) >= 0
      }, stampParts(t)));
      this.applyFilter();
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  /** 当前分类 → 左右两列 */
  applyFilter() {
    const key = this.data.active;
    const list = key ? this._all.filter((t) => t.type === key) : this._all;
    const colA = [];
    const colB = [];
    list.forEach((t, i) => (i % 2 ? colB : colA).push(t));
    this.setData({ colA, colB, total: list.length, loading: false });
  },

  onFilter(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.active) return;
    wx.vibrateShort({ type: 'light' });
    track.track('home_filter', { key });
    this.setData({ active: key });
    this.applyFilter();
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
    wx.vibrateShort({ type: 'light' });
    const on = favIds.indexOf(id) >= 0;
    const upd = (col) => col.map((t) => (t.id === id ? Object.assign({}, t, { fav: on }) : t));
    this.setData({ colA: upd(this.data.colA), colB: upd(this.data.colB) });
  },

  /** 主题切换 / 换页回来都要重编一遍图形（data-uri 里的颜色是编译时写死的） */
  buildArt() {
    const m = themeUtil.getThemeMeta(themeUtil.getTheme());
    if (this._ink === m.text && this.data.art.card) { this.buildChips(m); return; }
    this._ink = m.text;
    const pm = deco.postmarkParts(m);
    const white = WHITE;
    // 选中态是玫瑰实底 → 图标反白；未选态用正文色。SVG 不认 CSS 变量，只能按主题镜像一份。
    this.setData({
      ic: {
        brand: iconSrc('user', m.text, 0.72, 1.6),
        search: iconSrc('search', m.text, 0.5, 1.5),
        pin: iconSrc('pin', m.text, 0.5, 1.4),
        heartOn: iconSrc('heart', '#E8AFA8', 1, 1.5, true),
        heartOff: iconSrc('heart', m.text, 0.35, 1.5),
        emptyIc: iconSrc('ticket', m.text, 0.28, 1.4)
      },
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
    this.buildChips(m, white);
  },

  /** 分类胶囊的图标：选中反白 / 未选正文色，两个地址都得备一份 */
  buildChips(m, white) {
    const on = white || WHITE;
    this.setData({
      filters: FILTERS.map((f) => ({
        key: f.key,
        name: f.name,
        srcOn: iconSrc(f.ico, on, 1, 1.8),
        srcOff: iconSrc(f.ico, m.text, 1, 1.8)
      }))
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
    wx.vibrateShort({ type: 'light' });
    track.track('home_cta_scan', {});
    wx.navigateTo({ url: '/pages/scan/scan' });
  },
  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  }
});
