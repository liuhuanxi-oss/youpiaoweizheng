// pages/discover/discover.js —— 回忆地图（品牌全案 · 稿屏7）
// ============================================================
// 这一版把 v6 的「地图占位 + 时间轴列表」整体换掉了：
//   ① 地图不再是 CSS 渐变的方块，而是 utils/mapArt.js 画的水彩中国，
//      城市气泡的落点由票根的 geo.lat/lng 真算出来（同一个投影函数）；
//   ② 按用户拍板，删掉了下方的时间轴列表 —— 改成点城市气泡、
//      从底部升起该城市的票根面板。列表和地图说的是同一件事，留着重复。
//
// 【为什么图形都要在 JS 里编译】
//   见 utils/icons.js / utils/mapArt.js 顶部：产物是 data-uri 的 SVG，
//   是独立文档，页面的 CSS 变量不会继承进去，var() 一律失效。
// ============================================================
const store = require('../../utils/store.js');
const themeUtil = require('../../utils/theme.js');
const { iconSrc } = require('../../utils/icons.js');
const deco = require('../../utils/deco.js');
const mapArt = require('../../utils/mapArt.js');

/** 地图上最多画几座城（超出的仍计入统计，只是不落点，否则气泡会糊成一片） */
const MAX_CITIES = 12;

/** 票根行左侧色块：品牌固定色，不随主题走（与「我的」页入口卡同一套） */
const ROW_TINT = { show: '#D98C8A', movie: '#C4A9B8', traffic: '#E2B45E', other: '#93AE8F' };

/** 压在水彩实底上的字色：恒白，品牌常量，故不走主题变量 */
const ON_TINT = '#FFFFFF';

Page({
  data: {
    theme: 'paper',
    land: '',        // 水彩陆地 data-uri
    route: '',       // 时光路线 data-uri
    stampL: '',      // 左上装饰邮票
    stampR: '',      // 右下装饰邮票
    ic: {},          // 图标：星点 / 花枝 / 小粉心 / 定位 / 关闭 / 右箭头
    deco: {},        // 装饰：sparkle 星点两种尺寸
    cities: [],      // 落在图上的城市 [{city,count,x,y,push,below,color,tail}]
    total: 0,        // 票根总数
    cityCount: 0,    // 有坐标的城市数（气泡数）
    noGeo: 0,        // 缺坐标的票根数（旧数据，页面底部给一句提示）
    picked: null,    // 当前选中的城市名
    sheet: [],       // 选中城市的票根
    stageW: mapArt.STAGE_W,
    stageH: mapArt.STAGE_H
  },

  onShow() {
    themeUtil.apply(this);
    this.getTabBar && this.getTabBar().setData({ selected: 2, theme: themeUtil.getTheme() });
    this.buildArt();
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  /** 编译本页全部图形（主题一变就要重来：SVG 不认 CSS 变量，颜色是写死的） */
  buildArt() {
    const m = themeUtil.getThemeMeta(themeUtil.getTheme());
    const W = '#FFFFFF';
    this.setData({
      land: mapArt.landSrc(m),
      // 邮票齿孔要「咬掉」一块卡片底色，所以得把卡片色喂进去
      stampL: mapArt.stampSrc(m.card),
      stampR: mapArt.stampSrc(m.card),
      ic: {
        spark: iconSrc('sparkle', m.accent),
        sparkSm: iconSrc('sparkle', m.accent, 0.7, 1.3),
        pin: iconSrc('pin', m.text, 0.45),
        heart: iconSrc('heart', m.accent),
        close: iconSrc('close', m.text, 0.6),
        chevron: iconSrc('chevron', m.text, 0.4),
        empty: iconSrc('map', m.text, 0.28)
      },
      deco: {
        sprig: deco.decoSrc('sprig', m),
        wave: deco.decoSrc('wavelines', m),
        heart: deco.decoSrc('heartsmall', m)
      },
      /* 面板票根行的类型图标：白描线压在品牌色块上，故恒用白色 */
      rowIc: {
        show: iconSrc('mask', W),
        movie: iconSrc('film', W),
        traffic: iconSrc('train', W),
        other: iconSrc('ticket', W)
      }
    });
  },

  /** 拉票根 → 按城市归并 → 算落点 → 串路线 */
  async refresh() {
    try {
      const raw = await store.listTickets();
      const all = (raw || []).filter((t) => t && t.title);

      const byCity = new Map();
      let noGeo = 0;
      all.forEach((t) => {
        const g = t.geo;
        if (!t.city || !g || typeof g.lat !== 'number' || typeof g.lng !== 'number') {
          noGeo++;
          return;
        }
        const c = String(t.city);
        if (!byCity.has(c)) byCity.set(c, { city: c, count: 0, lat: 0, lng: 0, first: '', list: [] });
        const e = byCity.get(c);
        e.count++;
        // 同城多个坐标点取平均（场馆不同坐标会有几百米差），落点取城市的「重心」
        e.lat += g.lat; e.lng += g.lng;
        e.list.push(t);
        const d = String(t.date || '');
        if (d && (!e.first || d < e.first)) e.first = d;
      });

      const cities = Array.from(byCity.values())
        .sort((a, b) => b.count - a.count || String(a.first).localeCompare(String(b.first)))
        .slice(0, MAX_CITIES)
        .map((e) => {
          const st = mapArt.toStage(e.lng / e.count, e.lat / e.count);
          return Object.assign(e, {
            x: st.x,
            y: st.y,
            color: mapArt.bubbleColor(e.city),
            push: 0,
            below: false,
            list: e.list.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
          });
        });

      mapArt.layoutBubbles(cities);
      // 点气泡时才取该城的票根，不必把它们塞进 data（setData 有 1MB 上限，且大多用不上）。
      // 用 Map 不用普通对象：城市名叫 "constructor" 之类会在原型链上撞出脏值。
      this._byCity = new Map(cities.map((c) => [c.city, c.list]));

      // 路线按「首次到访」先后串 —— 地图讲的是走过的顺序，不是票数
      const ordered = cities.slice().sort((a, b) => String(a.first).localeCompare(String(b.first)));
      const route = mapArt.routeSrc(ordered.map((c) => ({ lng: c.lng / c.count, lat: c.lat / c.count })));

      this.setData({
        route,
        cities: cities.map((c) => {
          const gap = mapArt.PIN_GAP + c.push;
          const stem = Math.max(0, gap - 11); // 11 = 落点圆环半径，杆从环外起画
          return {
            city: c.city, count: c.count, x: c.x, y: c.y, color: c.color, below: c.below, fg: ON_TINT,
            // 气泡贴哪个边、隔多远：在上的贴 bottom、在下的贴 top（见 WXSS 的 .dc-bubble）
            bubblePos: (c.below ? 'top:' : 'bottom:') + gap + 'rpx',
            stemPos: (c.below ? 'top:11rpx;' : 'bottom:11rpx;') + 'height:' + stem + 'rpx'
          };
        }),
        total: all.length,
        cityCount: cities.length,
        noGeo: noGeo
      });
    } catch (e) {
      this.setData({ cities: [], total: 0, cityCount: 0, noGeo: 0, route: '' });
    }
  },

  /** 点气泡：底部升起这座城的票根面板 */
  onCityTap(e) {
    const name = e.currentTarget.dataset.city;
    const hit = this._byCity && this._byCity.get(name);
    if (!hit || !hit.length) return;
    wx.vibrateShort({ type: 'light' });
    const ic = this.data.rowIc;
    this.setData({
      picked: name,
      sheet: hit.map((t) => ({
        id: t.id,
        title: t.title,
        date: t.date,
        venue: t.venue,
        tint: ROW_TINT[t.type] || ROW_TINT.other,
        ic: ic[t.type] || ic.other
      }))
    });
  },

  closeSheet() { this.setData({ picked: null, sheet: [] }); },

  /** 面板里的票根 → 票根详情 */
  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  /** 空态：去票根墙收第一张 */
  goHome() { wx.switchTab({ url: '/pages/home/home' }); },

  /** 阻止面板内的滑动穿透到遮罩 */
  noop() {}
});
