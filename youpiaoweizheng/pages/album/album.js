// pages/album/album.js —— 时光机（品牌全案 · 稿屏8 一比一）
// ============================================================
// 与旧版（v6 票夹）的三处差别：
//   1. 分组口径由「月」改为「年」—— 稿屏8 是一条纵向时间轴，节点是 2025 / 2024 / 2023；
//   2. 列表卡换成**明信片**：白卡 + 胶带 + 邮戳 + 日期行，卡片带轻微倾斜；
//   3. 左侧一条虚线时间轴贯穿，年份节点是玫瑰圆点，节点下方三道波浪排线。
// 图形一律走 <image src="data:image/svg+xml,...">：小程序 wxml 不渲染内联 <svg>，
// 且 SVG 是独立文档、不认 CSS 变量，故颜色由 buildArt() 按当前主题编译成实色。
//
// 业务逻辑（拉全量 / 类型筛选 / 搜索 / 折叠展开 / 那年今日 / 下拉刷新 / 空态 / 横幅）
// 与旧版一致，未做增删。
// ============================================================
const mock = require('../../utils/mock.js');
const store = require('../../utils/store.js');
const sk = require('../../utils/skeleton.js');
const themeUtil = require('../../utils/theme.js');
const { iconSrc } = require('../../utils/icons.js');
const deco = require('../../utils/deco.js');
const { todayMD, todaySign } = require('../../utils/date.js');

const PEEK_AFTER = 3;      // 每个年份默认露出 3 张，其余折叠（点「还有 N 张」展开）
const PM_R = 51;           // 邮戳城市名的弧半径（rpx），落在双圈之间的环带上（见 album.wxss）
const NO_YEAR = '更早';     // 日期缺失的票根归到这一组，避免凭空消失

/** 类型 → 图标名（稿屏8 全页无 emoji，图标一律走 utils/icons.js） */
const TYPE_ICONS = { show: 'mask', movie: 'film', traffic: 'train' };
/**
 * 胶带三色（黄 / 蓝 / 粉）。
 * 胶带是**实物**的颜色——贴在手账上的和纸胶带不会因为 App 换主题就变色，
 * 故这三色是品牌固定色，不读主题变量，由 JS 下发（WXSS 里不许出现十六进制）。
 */
const TAPE_TINT = ['#E8CE86', '#A9C3D6', '#E8AFA8'];
/** 明信片倾斜角：像一张张贴进手账本，三张一循环 */
const CARD_TILT = [-2.4, 1.8, -1.5];

/**
 * 城市名逐字排上圆弧：n 个字张开成一段弧。
 * 每个字写 transform:rotate(角度) translateY(-半径) —— 先按角度自转，再沿自身「上」方
 * 推出半径，于是 n 个字正好落在圆周上且各自朝外，就是邮戳上的弧形字。
 * （不用 SVG textPath：见 utils/deco.js 里 postmarkParts 的说明。）
 */
function pmChars(city) {
  const chars = String(city || '票根').slice(0, 4).split('');
  if (chars.length < 2) return [{ c: chars[0] || '票', a: 0 }];
  const spread = 26 * (chars.length - 1);          // 2 字 26°、3 字 52°、4 字 78°
  const step = spread / (chars.length - 1);
  return chars.map((c, i) => ({ c, a: Math.round((-spread / 2 + step * i) * 10) / 10 }));
}

/** '2025-10-26' → 邮戳里的三行日期（日 / 月 / 年，与稿内排法一致） */
function pmDate(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-');
  return { pdd: d || '--', pmm: m ? Number(m) + '月' : '--', pyy: y || '----' };
}

/** 那年今日：在全部票根里找「往年同月同日」，取最近年份的一条 */
function buildTimeMachine(all, isDemo) {
  const now = new Date();
  const { m, d } = todayMD();
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  const thisYear = String(now.getFullYear());

  const cands = all
    .filter((t) => {
      if (!t.date || t.date.length < 10) return false;
      return t.date.slice(0, 4) < thisYear &&           // 只要往年的
        t.date.slice(5, 7) === mm && t.date.slice(8, 10) === dd;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  if (cands.length) {
    const t = cands[0];
    const years = now.getFullYear() - Number(t.date.slice(0, 4));
    return {
      ticketId: t.id,
      label: `那年今日 · ${t.date.replace(/-/g, '.')}`,
      title: t.title,
      sub: years === 1 ? '一年前的今天，你收下了这张票根' : `${years} 年前的今天，你收下了这张票根`
    };
  }
  // 演示模式没命中 → 用演示卡打底（存真实票根后自动消失）
  if (isDemo && mock.timeMachine && mock.timeMachine.hit) {
    return {
      ticketId: mock.timeMachine.ticketId,
      label: '那年今日 · 演示',
      title: mock.timeMachine.title,
      sub: '存入真实票根后，往年今天会自动点亮'
    };
  }
  // 都没命中 → 今日时光签（时令短句，永不空转）
  const sign = todaySign();
  return {
    kind: 'sign',
    label: `今日时光签 · ${sign.date}`,
    title: sign.text,
    sub: '每天一句，把今天也过成值得收藏的日子'
  };
}

Page({
  data: {
    theme: 'paper',
    timeMachine: null,
    filters: [],
    activeFilter: 'all',
    groups: [],
    kw: '',           // 搜索关键词（与类型筛选叠加）
    skeleton: false,  // 加载超 300ms 才显示骨架
    netBar: null,     // 云故障/超限横幅（{ text, retry }；null = 不显示）
    // —— 下拉弹性（scroll-view refresher 状态机） ——
    refreshing: false,
    refreshText: '下拉翻册',
    pullDeg: 0,
    hasTickets: false,
    pmR: PM_R,
    ic: {},           // 单色图标（主题色，buildArt 编译）
    art: { tape: [], spot: [], wave: '', pm: {} }  // 胶带 / 点缀 / 排线 / 邮戳（图形层，buildArt 编译）
  },

  onShow() {
    themeUtil.apply(this);
    this.buildArt();
    // 同步自定义 tabBar 选中态（时光机 = 1）
    this.getTabBar() && this.getTabBar().setData({ selected: 1, theme: themeUtil.getTheme() });
    this.refresh();
  },

  /** 按当前主题把这一页要用的图形全部编译成实色 data-uri（主题切换后必须重编） */
  buildArt() {
    const m = themeUtil.getThemeMeta(themeUtil.getTheme());
    this._art = {
      meta: m,
      tape: TAPE_TINT.map((t) => deco.decoSrc('tape', Object.assign({}, m, { accent: t }))),
      spot: ['sprig', 'heartsmall', 'wavelines', 'star4'].map((n) => deco.decoSrc(n, m)),
      wave: deco.decoSrc('wavelines', m),
      pm: deco.postmarkParts(m)
    };
    this.setData({
      art: { tape: this._art.tape, spot: this._art.spot, wave: this._art.wave, pm: this._art.pm },
      ic: {
        spark: iconSrc('sparkle', m.accent),
        sparkSm: iconSrc('sparkle', m.accent, 0.7, 1.3),
        search: iconSrc('search', m.text, 0.5),
        clear: iconSrc('close', m.text, 0.5),
        calendar: iconSrc('calendar', m.text, 0.6),
        chevron: iconSrc('chevron', m.text, 0.45),
        clock: iconSrc('clock', m.accent, 0.9),
        ticket: iconSrc('ticket', m.text, 0.32, 1.5),
        searchBig: iconSrc('search', m.text, 0.32, 1.6),
        typeIcon: iconSrc('ticket', m.text, 0.6)
      }
    });
  },

  // ===== 下拉弹性：票根图标随手势转圈 → 松手刷新 → 「已更新」→ 回弹复位 =====
  onRefresh() {
    this.setData({ refreshing: true, refreshText: '正在翻册…' });
    this.refresh().then(() => {
      this.setData({ refreshing: false, refreshText: '已更新' });
    }).catch(() => {
      this.setData({ refreshing: false, refreshText: '刷新失败，再试一次' });
    });
  },

  /** 下拉中：旋转角度跟随手指（60px 内一圈封顶），过阈值提示松手 */
  onPulling(e) {
    const dy = (e && e.detail && e.detail.dy) || 0;
    const deg = Math.round(Math.min(dy / 60, 1) * 360);
    const next = dy >= 60 ? '松手翻册' : '下拉翻册';
    if (next !== this.data.refreshText) {
      this.setData({ refreshText: next, pullDeg: deg });
    } else if (Math.abs(deg - this.data.pullDeg) > 5) {
      this.setData({ pullDeg: deg }); // 节流：角度变化 >5° 才推送
    }
  },

  onRestore() {
    this.setData({ refreshText: '下拉翻册', pullDeg: 0 });
  },

  /** 拉全量票根 → 重算筛选胶囊 + 那年今日 + 按年分组 */
  async refresh() {
    sk.start(this);
    try {
      const raw = await store.listTickets();
      // 列表状态横幅——云库读取失败兜底成演示数据（可点重试）/ 超上限截断提示
      const flags = store.listFlags();
      const netBar = flags.netFallback
        ? { text: '网络开小差了，先看演示票根 · 点我重试', retry: true }
        : (flags.truncated ? { text: `票根超过 ${flags.cap} 张，当前显示最近的 ${flags.cap} 张`, retry: false } : null);
      const all = raw.filter((t) => t && t.id);
      this._all = all;

      const count = (key) => all.filter((t) => key === 'all' || t.type === key).length;
      const filters = [
        { key: 'all', label: '全部' },
        { key: 'show', label: '演出' },
        { key: 'movie', label: '电影' },
        { key: 'traffic', label: '交通' }
      ].map((f) => ({ ...f, label: `${f.label} ${count(f.key)}` }));

      this.setData({
        filters,
        timeMachine: buildTimeMachine(all, store.USE_CLOUD === false),
        netBar,
        hasTickets: all.length > 0
      });
      this.applyFilter(this.data.activeFilter, all);
    } finally {
      sk.end(this);
    }
  },

  /** 云故障横幅重试 */
  onNetBarTap() {
    if (this.data.netBar && this.data.netBar.retry) this.refresh();
  },

  /**
   * 按类型 + 关键词过滤 → 按年分组 → 年份倒序（新的在上）→ 超 3 张的年份折叠
   * 每张票根在这里补齐渲染字段（倾斜角 / 胶带 / 邮戳 / 点缀），
   * 主题切换后只要再跑一次就会换成新主题的图形。
   */
  applyFilter(key, source) {
    const all = source || this._all || [];
    const art = this._art || { tape: [''], spot: [''], pm: {} };
    const meta = (art.meta || {}).text || '#6B5B50';
    // 关键词过滤：票名/场馆/城市/座位/备注，大小写不敏感包含匹配
    const kw = String(this.data.kw || '').toLowerCase();
    const filtered = all.filter((t) => {
      if (key !== 'all' && t.type !== key) return false;
      if (kw) {
        const hay = [t.title, t.venue, t.city, t.seat, t.note]
          .map((v) => String(v || '').toLowerCase())
          .join(' ');
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });

    const buckets = {};
    filtered.forEach((t) => {
      const y = String(t.date || '').slice(0, 4);
      const label = /^\d{4}$/.test(y) ? y : NO_YEAR;
      (buckets[label] = buckets[label] || []).push(t);
    });

    this._expanded = this._expanded || {};
    const groups = Object.keys(buckets)
      .sort((a, b) => (a === NO_YEAR ? 1 : b === NO_YEAR ? -1 : b.localeCompare(a)))
      .map((label) => {
        const list = buckets[label];
        const fold = list.length > PEEK_AFTER && !this._expanded[label];
        return {
          label,
          fold,
          total: list.length,                                    // 本年真实张数（不受折叠影响）
          list: (fold ? list.slice(0, PEEK_AFTER) : list).map((t, i) => ({
            ...t,
            typeText: mock.TYPE_TEXT[t.type] || '票根',
            ico: iconSrc(TYPE_ICONS[t.type] || 'ticket', meta, 0.65),
            tilt: CARD_TILT[i % CARD_TILT.length],
            tape: art.tape[i % art.tape.length],
            spot: art.spot[i % art.spot.length],
            pmc: pmChars(t.city),
            ...pmDate(t.date)
          })),
          more: fold ? list.length - PEEK_AFTER : 0
        };
      });

    this.setData({ activeFilter: key, groups });
  },

  // ===== 搜索：输入 250ms 节流后重筛（与类型筛选叠加） =====
  onSearch(e) {
    const kw = String((e && e.detail && e.detail.value) || '').trim();
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      if (kw === this.data.kw) return; // 值未变不重复渲染
      this.setData({ kw });
      this.applyFilter(this.data.activeFilter);
    }, 250);
  },

  /** 清空搜索：同步输入框显示值并恢复当前类型全量 */
  onSearchClear() {
    clearTimeout(this._searchTimer);
    if (this.data.kw !== '') this.setData({ kw: '' });
    this.applyFilter(this.data.activeFilter);
  },

  onFilterTap(e) {
    this.applyFilter(e.currentTarget.dataset.key);
  },

  // 那年今日点击：命中票根直达详情；今日时光签弹签
  goTimeMachine() {
    const tm = this.data.timeMachine;
    if (!tm) return;
    if (tm.kind === 'sign') {
      wx.showModal({
        title: '今日时光签',
        content: tm.title,
        showCancel: false,
        confirmText: '收下今日',
        confirmColor: '#E0532F'
      });
      return;
    }
    wx.navigateTo({ url: `/pages/detail/detail?id=${tm.ticketId}` });
  },

  // 明信片点击 → 详情（原生 view + data-id，故必须走 currentTarget.dataset）
  goDetail(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    if (!ds.id) return;
    wx.navigateTo({ url: `/pages/detail/detail?id=${ds.id}` });
  },

  // 展开某个年份的折叠
  expandGroup(e) {
    const label = (e && e.currentTarget && e.currentTarget.dataset || {}).label;
    if (!label) return;
    this._expanded = this._expanded || {};
    this._expanded[label] = true;
    this.applyFilter(this.data.activeFilter);
  },

  // 收起某个年份：恢复默认 3 张 + 展开入口
  collapseGroup(e) {
    const label = (e && e.currentTarget && e.currentTarget.dataset || {}).label;
    if (!label) return;
    this._expanded = this._expanded || {};
    delete this._expanded[label];
    this.applyFilter(this.data.activeFilter);
  },

  // 空态引导
  goScan() {
    wx.navigateTo({ url: '/pages/scan/scan' });
  }
});
