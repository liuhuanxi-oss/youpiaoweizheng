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
// 8.1.0 拉新 3/6「一键成片」：播放编排（纯逻辑，可真跑）、长图画笔、存相册
const mapFilm = require('../../utils/mapFilm.js');
const film = require('./film.js');
const saveimg = require('../../utils/saveimg.js');
const track = require('../../utils/track.js');
const { safeDpr } = require('../../utils/canvas-deco.js');
const share = require('../../utils/share.js');

/** 地图上最多画几座城（超出的仍计入统计，只是不落点，否则气泡会糊成一片） */
const MAX_CITIES = 12;
/** 超过这么多城，落点旁的小字标签就不画了（气泡已经写着城市名，拥挤时它只是碎字） */
const PIN_LABEL_MAX = 6;

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
    theme: themeUtil.getTheme(),
    // 朋友圈单页模式：那模式下拿不到身份、也跳不了页，本页会空得只剩空态 —— 换成品牌落地卡
    sp: false,
    // 入场动效开关（.fade-up 挂在根节点上）。初值为真：首次进场不该「先亮一帧再淡入」
    enter: true,
    refreshing: false, // 下拉刷新收口（scroll-view 的 refresher-triggered 读它）
    land: '',        // 水彩陆地 data-uri
    route: '',       // 时光路线 data-uri
    stampL: '',      // 左上装饰邮票
    stampR: '',      // 右下装饰邮票
    ic: {},          // 图标：星点 / 花枝 / 小粉心 / 定位 / 关闭 / 右箭头
    deco: {},        // 装饰：sparkle 星点两种尺寸
    cities: [],      // 落在图上的城市 [{city,count,x,y,push,below,color,w}]
    pinLabels: true, // 落点旁的小字标签要不要画（城市多了就不画，见 PIN_LABEL_MAX）
    total: 0,        // 票根总数
    cityCount: 0,    // 有坐标的城市数（气泡数）
    mapTip: '',      // 图下方那句「有 N 张没落点 / 有 M 座城没画上来」的实话
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
    // 两种看法：'real' 微信原生地图（**默认看这张** —— 能缩放能拖，图钉点得动）/
    //           'art' 手绘水彩中国（稿屏7 那张，一键成片在它上面演）
    view: 'real',
    swapping: false, // 换层中（整块淡出 → 换 → 淡回），见 setView
    markers: [],     // 原生地图的图钉（一城一枚）
    mapPts: [],      // include-points：让原生地图自动缩放到装下全部图钉
    mapLat: 35,      // 没数据时的中心（中国中部）
    mapLng: 105,

    /* ===== 8.1.0 拉新 3/6「一键成片」=====
       播放不是换一个页面，而是把**同一张地图卡**换个演法：气泡按到访先后一个接一个亮起。
       所以这里没有第二份图形数据 —— 亮出来的就是 cities 里那几个（见 _filmTick）。 */
    filmOn: false,   // 播放态：整页收起，只剩地图与底部那条 HUD
    canFilm: false,  // 入口显不显示（规则见 utils/mapFilm.js 的 canPlay）
    filmTotal: 0,    // 一共几站
    filmIdx: 0,      // 已经走到第几站（0 = 还没开始）
    filmNow: null,   // 当前这一站 {city, year, count, n}
    filmLit: [],     // 已经亮起来的城（就是 cities 的子集，字段原样带着）
    filmRoute: '',   // 已经走过的线（每亮一站重算一次，线是「一段段长出来」的）
    filmPct: 0,      // 进度条百分比
    filmDone: false, // 播完停在最后一帧（此时底部换成「存成长图」）
    saving: false,   // 存图中（防连点：导出一次要几百毫秒）
    scrollTop: 0     // 播放时把长页拉回顶部（卡片在顶上，不拉回去就播在半空里）
  },

  onLoad() {
    // 8.1.0：本页开始对外分享（回忆地图的落点就是本页），单页模式判定由启动参数决定、全程不变
    this.setData({ sp: share.sp() });
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
    this._stopFilmTimer();
    if (this._mqo) { try { this._mqo.disconnect(); } catch (e) { /* 忽略 */ } this._mqo = null; }
  },

  /** 本页是 tab 页：切走只触发 onHide、永远不触发 onUnload —— 播放必须在这里收口。
   *  不收的话，切到别的 tab 它还在一站一站往下走（setData 到一张看不见的页上），
   *  切回来时已经播完了 —— 用户看到的是「我还没看呢，它就演完了」。 */
  onHide() {
    this.stopFilm();
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

  /** 下拉刷新（scroll-view 的 refresher，不是页面级下拉）。
   *  收口只能靠 refresher-triggered：wx.stopPullDownRefresh 是页面级 API，对组件里的下拉头无效 ——
   *  少了 refreshing 这一路，下拉后转圈永远收不回来，看着像卡死（tests/pull_refresh.test.js 钉着）。 */
  onPullDownRefresh() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });
    this.refresh().finally(() => this.setData({ refreshing: false }));
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
        refresh: iconSrc('refresh', m.text, 0.28),
        // 8.1.0 一键成片：play 压在玫瑰实底（--stamp 六主题同值）上恒白，download 画在浅底上取正文色
        play: iconSrc('play', '#FFFFFF'),
        download: iconSrc('download', m.text, 0.7),
        // 8.1.6 集章册：与 play 同一块玫瑰实底，故同样恒白
        chapter: iconSrc('bookmark', '#FFFFFF')
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
        travel: iconSrc('plane', W),
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

      // 图底下那句实话：哪些票根没落点、哪几座城没画上来。两句都只在真的发生时出现 ——
      // 「还有 0 座城没画上来」是句废话，而少画了不说，用户会以为自己没去过。
      const mapTip = [
        noGeo ? `有 ${noGeo} 张票根没有城市或坐标，暂未落点` : '',
        byCity.size > MAX_CITIES ? `另有 ${byCity.size - MAX_CITIES} 座城没画上来（图上最多放 ${MAX_CITIES} 座）` : ''
      ].filter(Boolean).join(' · ');

      mapArt.layoutBubbles(cities);
      // 点气泡时才取该城的票根，不必把它们塞进 data（setData 有 1MB 上限，且大多用不上）。
      // 用 Map 不用普通对象：城市名叫 "constructor" 之类会在原型链上撞出脏值。
      this._byCity = new Map(cities.map((c) => [c.city, c.list]));

      // 路线按「首次到访」先后串 —— 地图讲的是走过的顺序，不是票数。
      // 8.1.0「一键成片」的播放顺序与这条线**共用同一个编排**（mapFilm.frames）：
      // 两处各排一次，迟早会出现「线是这么连的、片是那么演的」这种对不上的事。
      const station = mapFilm.frames(cities);
      const geoOf = new Map(cities.map((c) => [c.city, { lng: c.lng / c.count, lat: c.lat / c.count }]));
      const route = mapArt.routeSrc(station.map((s) => geoOf.get(s.city)).filter(Boolean));
      // 这两个都放实例字段：它们只驱动播放，不必进 data 白占 setData 的名额
      this._station = station;
      this._geo = geoOf;

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
            // 宽度必须下发：避让算法量的是这个数，而气泡在 0 尺寸父级里收缩出的实际宽度不等于它
            // （四字名会被 min-width 折成两行，横竖都对不上）——见 mapArt.bubbleWidth 的注释
            w: mapArt.bubbleWidth(c.city),
            // 气泡贴哪个边、隔多远：在上的贴 bottom、在下的贴 top（见 WXSS 的 .dc-bubble）
            bubblePos: (c.below ? 'top:' : 'bottom:') + gap + 'rpx',
            stemPos: (c.below ? 'top:11rpx;' : 'bottom:11rpx;') + 'height:' + stem + 'rpx',
            // 升起动效的错开延迟。气泡前面还夹着图层、骨架层（且真地图档会少一层），
            // :nth-child 的下标靠不住，所以排在 JS 这边
            d: Math.min(i, RISE_MAX) * RISE_STEP
          };
        }),
        total: all.length,
        // 必须是**全部**有坐标的城市数，不是落点的那几个：
        // 底部写的是「已走过 N 座城市」—— 一句关于用户的断言。
        // 画不下就不画（MAX_CITIES），但这句话不能跟着变小，那是替用户少算了几座城。
        cityCount: byCity.size,
        // 落点旁边的小字标签：城市少的时候是地图上的一点讲究，多了就是一层压着气泡的碎字
        // （气泡本来就写着城市名，它是重复信息，拥挤时先让位给气泡）
        pinLabels: cities.length <= PIN_LABEL_MAX,
        mapTip: mapTip,
        // 「一键成片」的入口：少于两座城、或刚好是云兜底的演示城市，都不该露（见 mapFilm.canPlay）
        canFilm: mapFilm.canPlay(cities, flags),
        netBar
      });
    } catch (e) {
      // 拉取失败：清空数据并立 error 标。页面据此显示「重试」——
      // 不能让它落进空态，空态说的是「你没有票根」，那是另一个意思
      // netBar 一并清掉：失败态自己已经带一个「重试」按钮，两条重试入口叠着显示只会让人犯迷糊
      this._station = [];
      this.setData({
        cities: [], markers: [], mapPts: [], route: '',
        total: 0, cityCount: 0, mapTip: '', error: true, netBar: null,
        // 失败时地图上一座城都没有：成片入口必须跟着收掉，否则点进去是一段空旅程
        canFilm: false
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
  goHome() { wx.switchTab({ url: '/pages/home/home' }); },

  /** 8.1.6 集章册：同一份城市数据的另一个看法（地图讲「在哪儿」，册子讲「攒了多少」） */
  goCitybook() {
    haptics.tap();
    wx.navigateTo({ url: '/pages/citybook/citybook' });
  },

  /* ============================================================
     8.1.0 拉新 3/6「一键成片」
     ------------------------------------------------------------
     演的是同一张地图：气泡按**首次到访**的先后一个接一个亮起，线一段段接上，
     底部一条 HUD 报「2019 · 北京 · 第 1 站」。演完停在最后一帧，给两个出口：
     存长图 / 发给朋友。编排（顺序、跨度、长图版面）全在 utils/mapFilm.js ——
     纯函数、可真跑，因为这三样错了都不报错（那边文件头写了为什么）。
     ============================================================ */

  /** 开演。减弱动态效果的用户直接给结局：一站一站闪过去反而更晃 */
  startFilm() {
    const station = this._station || [];
    if (station.length < mapFilm.MIN_STOPS) return;
    haptics.tap();
    track.track('map_film', { stops: station.length });
    this._stopFilmTimer();
    this.setData({
      filmOn: true, filmTotal: station.length, filmIdx: 0, filmNow: null,
      filmLit: [], filmRoute: '', filmPct: 0, filmDone: false,
      // 真地图那层是原生组件、画不了气泡：播放必须在「水彩」这层上演。
      // 顺带把长页拉回顶部 —— 卡片在最上面，不拉回去就演在半空里。
      view: 'art', scrollTop: 0
    });
    if (this._reduce) { this._filmTick(station.length); return; }
    this._filmTick();
    this._filmT = setInterval(() => this._filmTick(), mapFilm.FRAME_MS);
  },

  /** 走一站：亮出第 n 站，并重算已经走过的那条线 */
  _filmTick(force) {
    const station = this._station || [];
    const n = force || this.data.filmIdx + 1;
    if (n > station.length) { this._stopFilmTimer(); this.setData({ filmDone: true }); return; }
    const lit = new Set(station.slice(0, n).map((s) => s.city));
    const geoOf = this._geo || new Map();
    // 线按到访先后连，只连已经亮起来的 —— 与 refresh 里那条完整路线同一个函数、同一份坐标
    const route = mapArt.routeSrc(station.slice(0, n).map((s) => geoOf.get(s.city)).filter(Boolean));
    this.setData({
      filmIdx: n,
      filmNow: station[n - 1],
      // 亮出来的就是 cities 的子集（字段原样带着）—— 不另造一套气泡数据
      filmLit: this.data.cities.filter((c) => lit.has(c.city)),
      filmRoute: route,
      filmPct: Math.round((n / station.length) * 100),
      filmDone: n >= station.length
    });
    if (n >= station.length) this._stopFilmTimer();
  },

  /** 跳过播放：直接给结局。有人不想一站一站等，替他点完比让他干等强 */
  skipFilm() {
    if (!this.data.filmOn || this.data.filmDone) return;
    haptics.tap();
    this._stopFilmTimer();
    this._filmTick((this._station || []).length);
  },

  /**
   * 收掉播放。定时器必须清 —— 本页是 tab 页，切走只触发 onHide、永远不触发 onUnload，
   * 不清的话切到别的 tab 它还在一站一站往下走（setData 到一张看不见的页上），
   * 切回来已经演完了。onUnload 里也调一次（真被销毁时同理）。
   */
  stopFilm() {
    this._stopFilmTimer();
    if (!this.data.filmOn) return;
    this.setData({
      filmOn: false, filmIdx: 0, filmNow: null, filmLit: [],
      filmRoute: '', filmPct: 0, filmDone: false
    });
  },

  _stopFilmTimer() {
    if (this._filmT) { clearInterval(this._filmT); this._filmT = null; }
  },

  /** 把这一段旅程存成一张长图（画法与版面见 pages/discover/film.js 与 utils/mapFilm.js） */
  async saveFilm() {
    if (this.data.saving) return;
    const station = this._station || [];
    if (!station.length) return;
    this.setData({ saving: true });
    wx.showLoading({ title: '生成图片中…', mask: true });
    try {
      const canvas = await this._ensureFilmCanvas();
      if (!canvas) throw Object.assign(new Error('画布没建起来'), { msg: '生成失败，请重试' });
      const fit = mapFilm.sheet(station.length);
      // dpr 交给 canvas-deco.safeDpr 回夹：12 城那张长图逻辑高 1928，
      // dpr 3 会得到 5784 —— 越过 iOS 单边 4096 就直接建不起画布（表现为保存失败）
      const dpr = safeDpr(fit.w, fit.h, (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2);
      canvas.width = fit.w * dpr;
      canvas.height = fit.h * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      film.render(ctx, {
        fit,
        total: this.data.cityCount,   // **全部**城市数，不是图上画得下的那几座（同底部署名的口径）
        cities: station,
        span: mapFilm.span(station),
        tip: this.data.mapTip,        // 没落点/没画上来的城那句实话，长图照说
        slogan: share.SLOGAN
      });
      const path = await saveimg.exportCanvas(canvas);
      await saveimg.save(path);
      wx.hideLoading();
      haptics.confirm();
      wx.showToast({ title: '已存入相册', icon: 'success' });
      track.track('map_film_save', { stops: station.length, dpr });
    } catch (e) {
      wx.hideLoading();
      // shown = 授权/取消那两种，saveimg 已经自己弹过窗了，再 toast 一个是叠着两个提示
      if (!e || !e.shown) wx.showToast({ title: (e && e.msg) || '保存失败，请重试', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  /** 取长图的画布节点。节点由 wx:if 跟着播放态建，偶发取不到时重试几次（同 card 的做法） */
  _ensureFilmCanvas(tryN) {
    const n = tryN || 0;
    return new Promise((resolve) => {
      this.createSelectorQuery().select('#filmCanvas').fields({ node: true }).exec((res) => {
        const node = res && res[0] && res[0].node;
        if (node) return resolve(node);
        if (n >= 3) return resolve(null);
        // 这里碰的是画布节点，不是页面栈或弹窗，不受 page_timers 那条规则约束
        setTimeout(() => this._ensureFilmCanvas(n + 1).then(resolve), 120);
      });
    });
  },

  /* ===== 分享：把这段旅程发给朋友（文案与封面见 utils/share.js 的 map 场景）===== */

  onShareAppMessage() {
    track.track('share_click', { from: 'map' });
    return share.message('map', { cities: this.data.cityCount });
  },

  // 朋友圈只能带 query、落点固定本页；单页模式下由 spGate 落地卡接住（那模式下空地图是死的）
  onShareTimeline() {
    track.track('share_timeline', { from: 'map' });
    return share.timeline('map', { cities: this.data.cityCount });
  }
});
