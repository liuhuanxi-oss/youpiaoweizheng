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
const sk = require('../../utils/skeleton.js');
const enter = require('../../utils/enter.js');
const haptics = require('../../utils/haptics.js'); // 7.4.0：触觉三档，别再直接写 vibrateShort

/** 地图上最多画几座城（超出的仍计入统计，只是不落点，否则气泡会糊成一片） */
const MAX_CITIES = 12;

/** 票根行左侧色块：品牌固定色，不随主题走（与「我的」页入口卡同一套） */
const ROW_TINT = { show: '#D98C8A', movie: '#C4A9B8', traffic: '#E2B45E', other: '#93AE8F' };

/** 压在水彩实底上的字色：恒白，品牌常量，故不走主题变量 */
const ON_TINT = '#FFFFFF';

/** 气泡依次升起：与全局 .stagger 同一口径（85ms 一档，最多错开前 6 颗） */
const RISE_STEP = 85;
const RISE_MAX = 5;
/** 换层（水彩 ↔ 真地图）淡出/淡回的时长，必须与 discover.wxss 的 .is-swapping 一致 */
const SWAP_MS = 180;

Page({
  data: {
    theme: 'paper',
    // 入场动效开关（.fade-up 挂在根节点上）。初值为真：首次进场不该「先亮一帧再淡入」
    enter: true,
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
    // 三态：loading 立即为真（骨架要等 300ms，见 utils/skeleton.js），
    // error 必须与「空态」分开——拉取失败时若长得像空态，等于告诉用户「你没有票根」
    loading: true,
    skeleton: false,
    error: false,
    // 云故障 / 超上限横幅。本页比别的页更吃这一条：云库读失败时 store 兜底成演示票根，
    // 地图会**凭空虚构出用户没去过的城市**，还配一句「已走过 N 座城市」的断言。
    netBar: null,
    picked: null,    // 当前选中的城市名
    sheet: [],       // 选中城市的票根
    stageW: mapArt.STAGE_W,
    stageH: mapArt.STAGE_H,
    // 两种看法：'art' 水彩中国（稿屏7 的默认）/ 'real' 微信原生地图（可缩放、可拖）
    view: 'art',
    swapping: false, // 换层中（整块淡出 → 换 → 淡回），见 setView
    markers: [],     // 原生地图的图钉（一城一枚）
    mapPts: [],      // include-points：让原生地图自动缩放到装下全部图钉
    mapLat: 35,      // 没数据时的中心（中国中部）
    mapLng: 105
  },

  onLoad() {
    // 「减弱动态效果」探测：只影响换层（别的动效在 CSS 里降级）。
    // 探测不到（老基础库）按「没开」处理：换层多一次淡变代价很小，
    // 反过来把动效当降级，用户看到的才是「点了半天不换」。
    this._reduce = false;
    try {
      const mq = wx.createMediaQueryObserver();
      mq.observe({ query: '(prefers-reduced-motion: reduce)' }, (res) => { this._reduce = !!res.matches; });
      this._mqo = mq;
    } catch (e) { /* 该基础库不支持：_reduce 保持 false */ }
  },

  onUnload() {
    if (this._swapT) { clearTimeout(this._swapT); this._swapT = null; }
    if (this._mqo) { try { this._mqo.disconnect(); } catch (e) { /* 忽略 */ } this._mqo = null; }
  },

  onShow() {
    themeUtil.apply(this);
    enter.replay(this);   // 切 tab 回来重播入场（tab 页常驻内存，动画不会自己重来）
    this.getTabBar && this.getTabBar().setData({ selected: 2, theme: themeUtil.getTheme() });
    // 勋章「足迹地图」(b12) 的解锁依据。v7.0 起本页就是地图页（旧的 pages/map 已下线），标记改在这里打
    try { wx.setStorageSync('sp_map_visited', true); } catch (e) { /* 忽略 */ }
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
        empty: iconSrc('map', m.text, 0.28),
        refresh: iconSrc('refresh', m.text, 0.28)
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
    sk.start(this);
    // loading 与 error 必须同时置位：只清 error 的话，会有一瞬间处于
    // 「不 loading、不 error、total 还是 0」——刚好命中空态条件，闪一下假空态
    this.setData({ loading: true, error: false });
    try {
      const raw = await store.listTickets();
      const flags = store.listFlags();
      const netBar = flags.netFallback
        ? { text: '网络开小差了，地图上是演示城市 · 点我重试', retry: true }
        : (flags.truncated ? { text: `票根超过 ${flags.cap} 张，地图只统计了最近的 ${flags.cap} 张`, retry: false } : null);
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

      /* 原生地图的图钉：与水彩图同源（都吃真实经纬度），点标记也走同一套面板 */
      const markers = mapArt.markersOf(cities, themeUtil.getThemeMeta(themeUtil.getTheme()));

      this.setData({
        route,
        markers,
        mapPts: markers.map((k) => ({ latitude: k.latitude, longitude: k.longitude })),
        mapLat: markers.length ? markers[0].latitude : 35,
        mapLng: markers.length ? markers[0].longitude : 105,
        cities: cities.map((c, i) => {
          const gap = mapArt.PIN_GAP + c.push;
          const stem = Math.max(0, gap - 11); // 11 = 落点圆环半径，杆从环外起画
          return {
            city: c.city, count: c.count, x: c.x, y: c.y, color: c.color, below: c.below, fg: ON_TINT,
            // 气泡贴哪个边、隔多远：在上的贴 bottom、在下的贴 top（见 WXSS 的 .dc-bubble）
            bubblePos: (c.below ? 'top:' : 'bottom:') + gap + 'rpx',
            stemPos: (c.below ? 'top:11rpx;' : 'bottom:11rpx;') + 'height:' + stem + 'rpx',
            // 升起动效的错开延迟。气泡前面还夹着图层、骨架层（且真地图档会少一层），
            // :nth-child 的下标靠不住，所以排在 JS 这边
            d: Math.min(i, RISE_MAX) * RISE_STEP
          };
        }),
        total: all.length,
        cityCount: cities.length,
        noGeo: noGeo,
        netBar
      });
    } catch (e) {
      // 拉取失败：清空数据并立 error 标。页面据此显示「重试」——
      // 不能让它落进空态，空态说的是「你没有票根」，那是另一个意思
      // netBar 一并清掉：失败态自己已经带一个「重试」按钮，两条重试入口叠着显示只会让人犯迷糊
      this.setData({
        cities: [], markers: [], mapPts: [], route: '',
        total: 0, cityCount: 0, noGeo: 0, error: true, netBar: null
      });
    } finally {
      this.setData({ loading: false });
      sk.end(this);
    }
  },

  /** 云故障横幅重试（截断提示不可点，故只认 retry） */
  onNetBarTap() {
    if (this.data.netBar && this.data.netBar.retry) this.refresh();
  },

  /** 切换「水彩 / 真地图」 */
  setView(e) {
    const v = e.currentTarget.dataset.view;
    if (!v || v === this.data.view) return;
    haptics.tap();
    // 换层不是「啪」地换一张：先让整块淡出（SWAP_MS），换完再淡回来。
    // 为什么要分两步而不是给两层都挂过渡：真地图是**原生组件**，各机型对它吃不吃
    // opacity 不一致（同层渲染的新基础库吃，老的直接把地图画在最上层），
    // 让两层同时在场赌不起 —— 赌输就是「水彩视图上盖着一张地图」。
    // 分两步则最坏情况只是「原地换一张」，与改动前一样，不会更糟。
    // 减弱动效：CSS 那边把过渡撤了，这里就不能再等 SWAP_MS ——
    // 否则会变成「点了没反应，180ms 后突然换掉」，比直接换还差。
    if (this._reduce) { this.setData({ view: v }); return; }
    if (this._swapT) clearTimeout(this._swapT);
    this.setData({ swapping: true });
    this._swapT = setTimeout(() => {
      this._swapT = null;
      this.setData({ view: v, swapping: false });
    }, SWAP_MS);
  },

  /** 点气泡：底部升起这座城的票根面板 */
  onCityTap(e) {
    this.openCity(e.currentTarget.dataset.city);
  },

  /** 点原生地图的图钉：图钉 id 就是 cities 的下标（见 mapArt.markersOf） */
  onMarkerTap(e) {
    const c = this.data.cities[e.detail.markerId];
    if (c) this.openCity(c.city);
  },

  openCity(name) {
    const hit = this._byCity && this._byCity.get(name);
    if (!hit || !hit.length) return;
    haptics.tap();
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
  goHome() { wx.switchTab({ url: '/pages/home/home' }); }
});
