// pages/report/report.js —— M4-b 我们的时光报告
// 裁剪说明：交接文档原写"年度回忆报告"，但产品规划 V1 把年度报告排在 V1.5（年终仪式感）——
// 9 月做"年度"名不副实，落地为实时「时光报告」：基于当前合并数据，随时可看；数据层同源，年底可升级年度版。
// 全部端上计算（类型分布/城市 Top/里程/一起场次/最早最近），无新增云函数。
const duoData = require('../../utils/duoData.js');
const couple = require('../../utils/couple.js');
const { totalKmOf } = require('../../utils/geo.js');
const themeUtil = require("../../utils/theme.js");
const sk = require('../../utils/skeleton.js');
const pay = require('../../utils/pay.js'); // 4.20.3：署名（昵称 → 报告尾款）
const share = require('../../utils/share.js'); // 7.3.0 S1/S2：分享文案（好友 + 朋友圈）
const track = require('../../utils/track.js'); // 7.3.0 S1：朋友圈分享埋点
const { iconSrc } = require('../../utils/icons.js');

const TYPE_TEXT = { show: '演出', movie: '电影', traffic: '交通' };

Page({

  onShow() {
    themeUtil.apply(this);
    this.buildIc();
    this._loadSignature(); // 4.20.3：署名异步到货，晚到只补 setData（WXML 表达式自适应）
  },

  /** 错误态图标按当前主题编译（data-uri 里的颜色是编译时写死的） */
  buildIc() {
    const m = themeUtil.getThemeMeta(themeUtil.getTheme());
    this.setData({ ic: { link: iconSrc('users', m.text, 0.28, 1.4) } });
  },

  /** 4.20.3 报告署名：有昵称 → 尾款带「昵称 · 时光有票为证」；无则保持品牌原样 */
  _loadSignature() {
    pay.getProfile().then((p) => {
      const nick = String((p && p.nickname) || '').trim();
      const sig = nick ? (nick.length > 10 ? nick.slice(0, 10) + '…' : nick) : '';
      if (sig !== this.data.signature) this.setData({ signature: sig });
    }).catch(() => {});
  },
  data: {
    theme: "a", legacyTheme: "a",
    // 7.3.0 S1：朋友圈单页模式（无身份、不能跳页）→ 整页换品牌落地卡
    sp: share.sp(),
    skeleton: false,
    demo: false,
    signature: '', // 4.20.3：报告尾款署名（昵称，截 10 字；空=品牌原样）
    myName: '', partnerName: '',
    meChar: '', partnerChar: '',
    total: 0,
    span: '',        // "2025.10 — 2026.08"
    bars: [],        // [{ key, name, n, pct }]
    cityTop: [],     // [{ name, n }] 前 3
    cityMore: 0,     // 其余城市数
    km: 0,
    together: 0,
    first: null,     // 最早一张
    last: null,      // 最近一张
    error: '',
    bindNeeded: false, // 错误态分岔：没绑定（去绑定）vs 取数失败（重试）
    ic: {}
  },

  onLoad() {
    if (this.data.sp) return; // 单页模式：不读空数据（wxml 整页换成落地卡）
    this.load();
  },

  async load() {
    sk.start(this);
    this.setData({ error: '' });
    try {
      const c = await couple.queryCouple();
      if (!c || !c.boundAt) {
        this.setData({ error: '尚未绑定双人空间', bindNeeded: true });
        return;
      }
      const m = await duoData.loadMerged(c);
      const items = m.items;

      // 类型分布（按占比画横条）
      const counts = { show: 0, movie: 0, traffic: 0 };
      items.forEach((t) => { if (counts[t.type] !== undefined) counts[t.type]++; });
      // 分母用「认得出的那几类」之和，不用总数：库里要是混进别的 type，
      // 按总数当分母会让三条加起来不到 100%（用户看着像丢票）。
      const known = counts.show + counts.movie + counts.traffic;
      // 一张票都没有就不画：三根 0% 的空条比空态更像「数据丢了」（外层 wx:if 会整块收起）
      const bars = known > 0
        ? ['show', 'movie', 'traffic']
          .filter((k) => counts[k] > 0)
          .map((k) => ({ key: k, name: TYPE_TEXT[k], n: counts[k], pct: Math.round((counts[k] / known) * 100) }))
        : [];

      // 城市 Top3
      const cityMap = {};
      items.forEach((t) => { if (t.city) cityMap[t.city] = (cityMap[t.city] || 0) + 1; });
      const cityArr = Object.keys(cityMap)
        .map((name) => ({ name, n: cityMap[name] }))
        .sort((a, b) => b.n - a.n);
      const cityTop = cityArr.slice(0, 3);
      const cityMore = Math.max(0, cityArr.length - 3);

      // 里程：合并票根按日期走过的地方（geo 缺失的票不计入）
      const km = totalKmOf(items.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))));

      // 一起看过的场次
      const together = duoData.togetherKeys(items).size;

      // 最早 / 最近
      const first = items.length ? items[items.length - 1] : null;
      const last = items.length ? items[0] : null;
      const span = first && last && first.date !== last.date
        ? `${String(first.date).replace(/-/g, '.')} — ${String(last.date).replace(/-/g, '.')}`
        : (first ? String(first.date).replace(/-/g, '.') : '');

      this.setData({
        demo: m.demo,
        myName: m.myName, partnerName: m.partnerName,
        meChar: m.myName[0], partnerChar: m.partnerName[0],
        total: m.total,
        span, bars, cityTop, cityMore, km, together, first, last
      });
    } catch (e) {
      this.setData({ error: String(e.message || e).slice(0, 60), bindNeeded: false });
    } finally {
      sk.end(this);
    }
  },

  onShareAppMessage() {
    const { total, partnerName } = this.data;
    // 7.3.0 S2：文案与落地页走 share.js（双人场景；报告页本身没有邀请码，落地回双人空间）
    return share.message('duo', { total, partnerName });
  },

  /** 7.3.0 S1：分享到朋友圈（朋友圈只能带 query、落地就是本页） */
  onShareTimeline() {
    const { total, partnerName } = this.data;
    track.track('share_timeline', { from: 'report' });
    return share.timeline('duo', { total, partnerName });
  },

  /** 错误态出路：没绑定去绑定，取数失败就重试（7.2.0 V10 空态规范） */
  goDuo() {
    wx.navigateTo({ url: '/pages/duo/duo' });
  },
  retry() {
    this.load();
  }
});
