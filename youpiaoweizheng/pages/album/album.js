// pages/album/album.js —— 票夹（v6.0 视觉重写 · 业务沿用 wall 全套：拉全量/分组/筛选/搜索/那年今日/空态/分享/广告位/整理模式）
// 6.0 设计令牌双轨：业务继续用 paper/accent 旧令牌；卡片视觉套 v6-list-card
// v6 tabBar 4 项之一（selected=1）
// M3.1 对齐产品原型屏①：
//   + 顶部品牌头部（WXML）
//   + 问候语改按月口径：「九月，你收藏了 X 张时光」
//   + 时光机未命中 → 「今日时光签」时令短句，永不空转
//   + 月分组超 3 张折叠，点「还有 N 张」展开（v6.6.1 修复：此前 _expanded 只有读取、
//     没有赋值入口，导致每月第 4 张起用户永远看不到且无任何提示）
const mock = require('../../utils/mock.js');
const store = require('../../utils/store.js');
const sk = require('../../utils/skeleton.js');
const themeUtil = require("../../utils/theme.js");
const track = require('../../utils/track.js'); // 4.17.0：拉新埋点
const { groupLabel, weekday, todayMD, todaySign } = require('../../utils/date.js');

const MONTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const PEEK_AFTER = 3; // 每组默认露出 3 张，其余折叠（点「还有 N 张」展开）

// 给原始票根补渲染字段
function decorate(t) {
  return {
    ...t,
    typeText: mock.TYPE_TEXT[t.type] || '票根',
    weekday: weekday(t.date),
    groupLabel: groupLabel(t.date),
    seatShort: (t.seat || '').replace(/\s/g, '').slice(0, 9)
  };
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
    theme: "paper",
    timeMachine: null,
    greet: '',
    filters: [],
    activeFilter: 'all',
    groups: [],
    kw: '',           // 4.11.0 搜索关键词（与类型筛选叠加）
    skeleton: false,  // M4.5：加载超 300ms 才显示骨架
    // —— 4.18.0 云故障/超限横幅（{ text, retry }；null = 不显示） ——
    netBar: null,
    // —— M4.5 下拉弹性（scroll-view refresher 状态机） ——
    refreshing: false,
    refreshText: '下拉翻册',
    pullDeg: 0,
    // —— 4.22.0 首页模块化升级 ——
    hasTickets: false,  // 有真实票根才渲染金刚区美术馆入口 + 时光小记卡
    summary: null       // 时光小记数据 { month, total, cities, firstYear }
  },

  onShow() {
    themeUtil.apply(this);
    // 同步自定义 tabBar 选中态（v6.0 4 tab · 票夹=1）
    this.getTabBar() && this.getTabBar().setData({ selected: 1, theme: themeUtil.getTheme() });
    this.refresh();
  },

  // ===== M4.5 下拉弹性：票根图标随手势转圈 → 松手刷新 → 「已更新」→ 回弹复位 =====
  onRefresh() {
    this.setData({ refreshing: true, refreshText: '正在翻册…' });
    this.refresh().then(() => {
      this.setData({ refreshing: false, refreshText: '已更新 ✦' });
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

  /** 拉全量票根 → 重算筛选胶囊 + 那年今日 + 分组渲染（4.16.0：并行拉章节顺序快照） */
  async refresh() {
    sk.start(this);
    try {
      const [raw, gOrder] = await Promise.all([store.listTickets(), store.getGroupOrder()]);
      // 4.18.0：列表状态横幅——云库读取失败兜底成演示数据（可点重试）/ 超上限截断提示
      // 演示模式两标志恒 false，横幅不亮；成功读取会自动清掉旧横幅
      // 5.0.0：上限改成 store 的 LIST_MAX（随分批拉取一并调整），文案不再写死数字
      const flags = store.listFlags();
      const netBar = flags.netFallback
        ? { text: '网络开小差了，先看演示票根 · 点我重试', retry: true }
        : (flags.truncated ? { text: `票根超过 ${flags.cap} 张，当前显示最近的 ${flags.cap} 张`, retry: false } : null);
      this._groupOrder = Array.isArray(gOrder) ? gOrder : [];
      const all = raw.map(decorate);
      this._all = all;

      const count = (key) => all.filter((t) => key === 'all' || t.type === key).length;
      const filters = [
        { key: 'all', label: '全部' },
        { key: 'show', label: '演出' },
        { key: 'movie', label: '电影' },
        { key: 'traffic', label: '交通' }
      ].map((f) => ({ ...f, label: `${f.label} ${count(f.key)}` }));

      // 按月口径问候（对齐原型「十月，你收藏了 12 张时光」）
      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const monthCount = all.filter((t) => String(t.date || '').slice(0, 7) === ym).length;
      // 4.22.0 时光小记（数据内容展示区）：收藏总量/城市足迹/最早一张的年份
      const cities = new Set(all.filter((t) => t.city).map((t) => t.city)).size;
      const firstYear = all.reduce((min, t) => {
        const y = String(t.date || '').slice(0, 4);
        return y && (!min || y < min) ? y : min;
      }, '');

      this.setData({
        filters,
        timeMachine: buildTimeMachine(all, store.USE_CLOUD === false),
        greet: all.length ? { label: `${MONTHS[now.getMonth()]}月`, num: monthCount } : null,
        netBar,
        hasTickets: all.length > 0,
        summary: all.length ? { month: monthCount, total: all.length, cities, firstYear } : null,
        // 4.22.1 品牌头时令签（右上角小字日期，像日记落款）
        nowLabel: `${now.getMonth() + 1}月${now.getDate()}日 · 周${'日一二三四五六'[now.getDay()]}`
      });
      this.applyFilter(this.data.activeFilter, all);
    } finally {
      sk.end(this);
    }
  },

  // 4.18.0 云故障横幅重试（netBar 数据层保留；v6 视觉未渲染横幅，供后续接回视图用）
  onNetBarTap() {
    if (this.data.netBar && this.data.netBar.retry) this.refresh();
  },

  /** 按类型 + 关键词过滤 → 按月分组 → 倒序（新的在上）→ 超 4 张的组折叠出 peek */
  applyFilter(key, source) {
    const all = source || this._all || [];
    // 4.11.0 关键词过滤：票名/场馆/城市/座位/备注，大小写不敏感包含匹配
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
    const map = {};
    filtered.forEach((t) => {
      (map[t.groupLabel] = map[t.groupLabel] || []).push(t);
    });
    // 4.16.0 组间排序应用：已整理组按快照保持相对顺序；
    // 快照之后新增的月份组按默认日期序融入最前（不打乱已整理的相对序）
    const rank = {};
    (this._groupOrder || []).forEach((l, i) => { rank[l] = i; });
    const labels = Object.keys(map);
    labels.sort((a, b) => {
      const ra = rank[a], rb = rank[b];
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return 1;   // 已整理的组排在新月份组后面
      if (rb != null) return -1;
      return b.localeCompare(a);  // 全新组之间：默认新的在上
    });
    this._expanded = this._expanded || {};
    const groups = labels
      .map((label) => {
        const list = map[label];
        const fold = list.length > PEEK_AFTER && !this._expanded[label];
        return {
          label,
          fold,
          total: list.length,                              // 本月真实张数（小标题显示用，不受折叠影响）
          list: fold ? list.slice(0, PEEK_AFTER) : list,
          more: fold ? list.length - PEEK_AFTER : 0
        };
      });

    this.setData({ activeFilter: key, groups });
  },


  // ===== 4.11.0 搜索：输入 250ms 节流后重筛（与类型筛选叠加） =====
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

  // 时光机点击：那年今日直达详情；今日时光签弹签
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

  // 票根卡片点击 → 详情
  // v6.6.1 修复：卡片用的是原生 view + data-id（见 album.wxml），事件里取 id 必须走
  // e.currentTarget.dataset；此前误按自定义组件写法读 e.detail.id，恒为 undefined，
  // 导致本页每一张票根都点不动。
  goDetail(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const id = ds.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  // 展开某个月的折叠（v6.6.1 新增：补上 _expanded 唯一赋值入口）
  expandGroup(e) {
    const label = (e && e.currentTarget && e.currentTarget.dataset || {}).label;
    if (!label) return;
    this._expanded = this._expanded || {};
    this._expanded[label] = true;
    this.applyFilter(this.data.activeFilter);
  },

  // 收起某个月：恢复默认 3 张 + 展开入口
  collapseGroup(e) {
    const label = (e && e.currentTarget && e.currentTarget.dataset || {}).label;
    if (!label) return;
    this._expanded = this._expanded || {};
    delete this._expanded[label];
    this.applyFilter(this.data.activeFilter);
  },

  // 空态引导（筛选结果为空时展示）
  goScan() {
    wx.navigateTo({ url: '/pages/scan/scan' });
  }
});
