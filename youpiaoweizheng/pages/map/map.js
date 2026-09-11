// pages/map/map.js —— M4.5 足迹地图
// 把票根上的坐标点亮成一张旅行足迹：
//   markers（票根定位 pin + 点击看票名）· polyline（按票面日期连成足迹线）
//   总里程（哈弗辛公式，相邻票根球面距离累加）· 城市统计 chip（点选聚焦该城）
// 数据全部来自端上 store.listTickets()——看自己的票根不需要云函数；
// geo 坐标从 M2 起入库时由城市字典自动配对（88 城）。
// 勋章联动：首次进入标记 sp_map_visited，「足迹地图」(b12) 解锁条件 = 访问过 + 3 城。
const store = require('../../utils/store.js');
const mock = require('../../utils/mock.js');
const { TYPE_TEXT } = mock;
const themeUtil = require("../../utils/theme.js");
const { haversine } = require('../../utils/geo.js'); // M4-b：抽公共（report 页里程同源）

Page({
  data: {
    theme: "a", legacyTheme: "a",
    markers: [],
    polyline: [],
    allPts: [],        // 全量点：自动缩放到全部足迹
    focusPts: [],      // 当前聚焦点（点城市 chip 切换）
    cities: [],        // [{ name, count, pts }]
    activeCity: '',
    cityTickets: [],   // 选中城市的票根（详情列表）
    totalKm: 0,
    ticketCount: 0,
    hasGeo: true       // 一张带坐标的票都没有 → 引导态
  },

  onLoad() {
    // b12 勋章判定依据：访问过足迹地图
    try { wx.setStorageSync('sp_map_visited', true); } catch (e) { /* 忽略 */ }
  },

  async onShow() {
    themeUtil.apply(this);
    const ts = await store.listTickets();
    const withGeo = ts.filter((t) => t.geo && typeof t.geo.lat === 'number');
    const ordered = withGeo
      .slice()
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

    // —— markers：pin + 点击呼出票名 ——
    const markers = ordered.map((t, i) => ({
      id: i,
      latitude: t.geo.lat,
      longitude: t.geo.lng,
      iconPath: '/images/map-pin.png',
      width: 26,
      height: 34,
      callout: {
        content: String(t.title || '票根').slice(0, 14),
        display: 'BYCLICK',
        padding: 8,
        borderRadius: 8,
        fontSize: 12,
        color: '#2B2420',
        bgColor: '#FFFCF5',
        borderWidth: 1,
        borderColor: '#E5DCCB'
      }
    }));

    // —— 足迹线：按日期连点（≥2 点才有线） ——
    const line = ordered.map((t) => ({ latitude: t.geo.lat, longitude: t.geo.lng }));
    const polyline = line.length >= 2
      ? [{ points: line, color: '#E0532F99', width: 2, dottedLine: true }]
      : [];

    // —— 总里程：相邻票根哈弗辛累加 ——
    let totalKm = 0;
    for (let i = 1; i < line.length; i++) totalKm += haversine(line[i - 1], line[i]);
    totalKm = Math.round(totalKm);

    // —— 城市统计（含无坐标票根的计数） ——
    const cMap = {};
    ts.forEach((t) => {
      if (!t.city) return;
      const c = (cMap[t.city] = cMap[t.city] || { name: t.city, count: 0, pts: [], tickets: [] });
      c.count += 1;
      c.tickets.push(t);
      if (t.geo && typeof t.geo.lat === 'number') c.pts.push({ latitude: t.geo.lat, longitude: t.geo.lng });
    });
    const cities = Object.values(cMap).sort((a, b) => b.count - a.count);
    cities.forEach((c) => {
      c.tickets.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    });

    const allPts = line.length
      ? line
      : [{ latitude: 35.0, longitude: 105.0 }]; // 无点：定位到中国全图

    this.setData({
      markers,
      polyline,
      allPts,
      focusPts: allPts,
      cities,
      totalKm,
      ticketCount: ts.length,
      hasGeo: withGeo.length > 0,
      activeCity: '',
      cityTickets: []
    });
  },

  /** 点城市 chip：地图聚焦该城 + 下方展开该城票根 */
  onCityTap(e) {
    const name = e.currentTarget.dataset.name;
    if (this.data.activeCity === name) {
      this.setData({ activeCity: '', cityTickets: [], focusPts: this.data.allPts });
      return;
    }
    const c = this.data.cities.find((x) => x.name === name);
    if (!c) return;
    wx.vibrateShort({ type: 'light' });
    this.setData({
      activeCity: name,
      cityTickets: c.tickets.map((t) => ({
        id: t.id,
        title: t.title,
        date: t.date,
        typeText: TYPE_TEXT[t.type] || '票根'
      })),
      focusPts: c.pts.length ? c.pts : this.data.allPts
    });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  }
});
