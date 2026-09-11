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

const TYPE_TEXT = { show: '演出', movie: '电影', traffic: '交通' };

Page({

  onShow() {
    themeUtil.apply(this);
    this._loadSignature(); // 4.20.3：署名异步到货，晚到只补 setData（WXML 表达式自适应）
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
    error: ''
  },

  onLoad() {
    this.load();
  },

  async load() {
    sk.start(this);
    this.setData({ error: '' });
    try {
      const c = await couple.queryCouple();
      if (!c || !c.boundAt) {
        this.setData({ error: '尚未绑定双人空间' });
        return;
      }
      const m = await duoData.loadMerged(c);
      const items = m.items;

      // 类型分布（按占比画横条）
      const counts = { show: 0, movie: 0, traffic: 0 };
      items.forEach((t) => { if (counts[t.type] !== undefined) counts[t.type]++; });
      const bars = ['show', 'movie', 'traffic'].map((k) => ({
        key: k,
        name: TYPE_TEXT[k],
        n: counts[k],
        pct: m.total ? Math.round((counts[k] / m.total) * 100) : 0
      })).filter((b) => b.n > 0 || m.total === 0);

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
      this.setData({ error: String(e.message || e).slice(0, 60) });
    } finally {
      sk.end(this);
    }
  },

  onShareAppMessage() {
    const { total, partnerName } = this.data;
    return {
      title: total
        ? `我和${partnerName}一起收藏了 ${total} 张票根`
        : '我们的时光报告 · 有票为证',
      path: '/pages/duo/duo'
    };
  }
});
