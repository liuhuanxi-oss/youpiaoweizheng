// pages/home/home.js —— v6.4 时光档案墙（品牌全案 · 小程序核心三屏之一）
// ============================================================
// 6.4 重构：按品牌全案《小程序核心三屏》一比一还原「时光档案墙」——
//   logo + 问候语 + 搜索 + 分类 chips（演出/电影/交通/旅行）+ 2 列瀑布流票卡。
//   原 v6.3 营销首页（IP 场景/CTA/四宫格/今日时光签）按稿退场；
//   地图足迹/回忆日历入口由「发现」tab 与票夹页继续承载。
// 数据：store.listTickets 拉全量 → 分类过滤 → 奇偶双列瀑布分组；
//   邮戳三行（城市/日/月年）、序号、收藏心（storage: fav_ids）逐卡计算。
// ============================================================
const store = require('../../utils/store.js');
const themeUtil = require('../../utils/theme.js');
const track = require('../../utils/track.js');

const FILTERS = [
  { key: 'show', name: '演出', icon: '🎭' },
  { key: 'movie', name: '电影', icon: '🎬' },
  { key: 'traffic', name: '交通', icon: '🚌' },
  { key: 'travel', name: '旅行', icon: '✈️' }
];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const FAV_KEY = 'fav_ids';
const TYPE_ICON = { show: '🎭', movie: '🎬', traffic: '🚌', travel: '✈️' };

/** 邮戳三行：城市 / DD / MON YYYY（稿样「PARIS · 14 · JUN 1956」） */
function stampParts(t) {
  const s = String(t.date || '');
  const d = s.slice(8, 10);
  const mi = parseInt(s.slice(5, 7), 10);
  const y = s.slice(0, 4);
  const city = String(t.city || 'TICKET').toUpperCase().slice(0, 8);
  if (!d || !mi || !y) return { stampCity: city, stampD: '··', stampMY: '····' };
  return { stampCity: city, stampD: d, stampMY: `${MON[mi - 1]} ${y}` };
}

Page({
  data: {
    theme: 'paper',
    loading: true,
    filters: FILTERS,
    active: 'show',      // 默认选中「演出」（视觉稿选中态）
    colA: [],
    colB: [],
    total: 0
  },

  _tabIndex: 0,
  _all: [],

  onShow() {
    themeUtil.apply(this);
    this.getTabBar && this.getTabBar().setData({ selected: 0, theme: themeUtil.getTheme() });
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  /** 拉全量票根 → 逐卡预处理（日期/邮戳/序号/收藏态） → 按当前分类分组 */
  async refresh() {
    this.setData({ loading: true });
    try {
      const raw = await store.listTickets();
      const all = (raw || [])
        .filter((t) => t && t.title)
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      const favIds = this._loadFav();
      this._all = all.map((t, i) => Object.assign({}, t, {
        idx: i + 1,
        icon: TYPE_ICON[t.type] || '🎫',
        dateText: String(t.date || '').replace(/-/g, '.'),
        no: String(t._id || '').slice(-6).toUpperCase(),
        fav: favIds.indexOf(t._id) >= 0
      }, stampParts(t)));
      this.applyFilter();
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  /** 当前分类 → 奇偶双列瀑布分组 */
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
    const upd = (col) => col.map((t) => (t._id === id ? Object.assign({}, t, { fav: favIds.indexOf(id) >= 0 }) : t));
    this.setData({ colA: upd(this.data.colA), colB: upd(this.data.colB) });
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
