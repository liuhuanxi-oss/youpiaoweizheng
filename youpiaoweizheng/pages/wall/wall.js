// pages/wall/wall.js —— 票根墙（首页）
// M3.1 对齐产品原型屏①：
//   + 顶部品牌头部（WXML）
//   + 问候语改按月口径：「九月，你收藏了 X 张时光」
//   + 时光机未命中 → 「今日时光签」时令短句，永不空转
//   + 月分组超 4 张折叠，第 4 张半露（peek），点击展开
const mock = require('../../utils/mock.js');
const store = require('../../utils/store.js');
const sk = require('../../utils/skeleton.js');
const themeUtil = require("../../utils/theme.js");
const track = require('../../utils/track.js'); // 4.17.0：拉新埋点
const { groupLabel, weekday, todayMD, todaySign } = require('../../utils/date.js');
const ads = require('../../utils/ads.js'); // 4.21.0：流内原生模板广告位（未配置 ID 时整块隐藏）

const MONTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const PEEK_AFTER = 3; // 每组默认露出 3 张，其余折叠进半张预览

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
    theme: "a",
    timeMachine: null,
    greet: '',
    filters: [],
    activeFilter: 'all',
    groups: [],
    kw: '',           // 4.11.0 搜索关键词（与类型筛选叠加）
    skeleton: false,  // M4.5：加载超 300ms 才显示骨架
    // —— 4.14.0 整理模式（组内拖拽排序） ——
    reorderMode: false,
    dragId: '',       // 正被拖起的票 id（lifted 态）
    offsets: {},      // 让位偏移 { id: px }
    // —— 4.16.0 组间排序（月份章节拖拽） ——
    groupLift: -1,    // 正被拖起的组索引
    groupDy: 0,       // 拖动组跟手位移 px
    groupOffsets: {}, // 组让位偏移 { 组索引: px }
    // —— 4.17.0 T5「我的小程序」软引导（最多出现 2 次，克制） ——
    t5Show: false,
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

  onLoad() {
    // 首次数据加载放在 onShow（refresh），这里不做
    // 4.21.0 广告位 ID 透传（未配置为空串 → wxml wx:if 不渲染，流量主开通后回填即生效）
    this.setData({ adsNativeId: ads.NATIVE_WALL_ID });
  },

  onShow() {
    themeUtil.apply(this);
    // 同步自定义 tabBar 选中态（tab 页必须做）
    this.getTabBar() && this.getTabBar().setData({ selected: 0, theme: themeUtil.current() });
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
      // 4.17.0 T5：票根 ≥2 才值得引导收进「我的小程序」（复访基座）
      this._maybeT5(all.length);
    } finally {
      sk.end(this);
    }
  },

  // ===== 4.18.0 云故障横幅：点击重试真实数据（超限提示横幅不可点） =====
  onNetBarTap() {
    if (this.data.netBar && this.data.netBar.retry) this.refresh();
  },

  // ===== 4.21.0 流内广告位：加载失败静默（容器保留淡装饰，不弹任何提示） =====
  onAdError() { /* 广告拉取失败由平台侧自动兜底，前端静默 */ },

  // ===== 4.22.2 ICP 备案展示（工信部要求首页底部标注；小程序内无法直跳工信部站点，点击复制） =====
  copyIcp() {
    wx.setClipboardData({ data: '粤ICP备20010271号-11X' });
  },

  // ===== 4.17.0 T5「我的小程序」软引导 =====
  // 克制三原则：≥2 张票根才问；最多问 2 次、间隔 ≥7 天；点了「去添加」永不再问。
  _maybeT5(count) {
    let ask = null;
    try { ask = wx.getStorageSync('sp_t5_asked') || null; } catch (e) { /* 忽略 */ }
    if (ask && ask.n >= 2) return;                              // 问满 2 次（n=99 是「去添加」后的永久静默）
    if (ask && Date.now() - (ask.at || 0) < 7 * 86400000) return; // 距上次 <7 天不问
    if (count >= 2) {
      this.setData({ t5Show: true });
      track.track('t5_guide_view', { count });
    }
  },

  /** 「去添加」：弹操作指引（右上角 ⋯ → 添加到我的小程序），之后不再打扰 */
  t5Go() {
    try { wx.setStorageSync('sp_t5_asked', { n: 99, at: Date.now() }); } catch (e) { /* 忽略 */ }
    this.setData({ t5Show: false });
    track.track('t5_guide_click', { act: 'go' });
    wx.vibrateShort({ type: 'light' });
    wx.showModal({
      title: '两步收进「我的小程序」',
      content: '点右上角「···」→ 选「添加到我的小程序」。下次从微信顶部下拉，一秒直达你的票根墙。',
      confirmText: '知道啦',
      showCancel: false
    });
  },

  /** 「暂不」：记一次提问次数，7 天后最多再问一次 */
  t5Close() {
    try {
      const prev = wx.getStorageSync('sp_t5_asked') || { n: 0, at: 0 };
      wx.setStorageSync('sp_t5_asked', { n: (prev.n || 0) + 1, at: Date.now() });
    } catch (e) { /* 忽略 */ }
    this.setData({ t5Show: false });
    track.track('t5_guide_click', { act: 'close' });
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
          list: fold ? list.slice(0, PEEK_AFTER) : list,
          peekTicket: fold ? list[PEEK_AFTER] : null,
          more: fold ? list.length - PEEK_AFTER : 0
        };
      });

    this.setData({ activeFilter: key, groups });
  },

  // ===== 4.14.0 整理模式：组内拖拽排序（4.16.0 扩展组间章节拖拽） =====
  /** 进入：强制展开全部组（排序要看到整组），重建列表后测量卡片位置 */
  enterReorder() {
    // 4.16.0 修正：筛选/搜索态下整理会只对可见子集写 sortAt/组序，
    // 与未写入票混排后破坏既有顺序——统一回到「全部票根」再整理
    if (this.data.activeFilter !== 'all' || this.data.kw) {
      this.setData({ activeFilter: 'all', kw: '' });
    }
    this._expanded = this._expanded || {};
    (this.data.groups || []).forEach((g) => { this._expanded[g.label] = true; });
    wx.vibrateShort({ type: 'light' });
    this.applyFilter(this.data.activeFilter);
    this.setData({ reorderMode: true, dragId: '', offsets: {}, groupLift: -1, groupDy: 0, groupOffsets: {} }, () => this._measureCards());
  },

  exitReorder() {
    this._drag = null;
    this._gdrag = null;
    this.setData({ reorderMode: false, dragId: '', offsets: {}, groupLift: -1, groupDy: 0, groupOffsets: {} });
    this.applyFilter(this.data.activeFilter);
  },

  /** 测量全部票卡与组容器位置（模式内全展开无 peek，展平序 = groups 顺序），缓存组边界与卡高 */
  _measureCards() {
    wx.createSelectorQuery()
      .selectAll('ticket-card').boundingClientRect()
      .selectAll('.group').boundingClientRect()
      .exec((res) => {
        const rects = res && res[0];
        const rectsG = (res && res[1]) || [];
        if (!rects || !rects.length) return;
        const groups = this.data.groups;
        const starts = [];
        let acc = 0;
        groups.forEach((g) => { starts.push(acc); acc += g.list.length; });
        this._layout = { rects, starts, rectsG };
      });
  },

  /** id → {组号 g, 组内 idx i0}；找不到返回 null */
  _locate(id) {
    const groups = this.data.groups;
    for (let g = 0; g < groups.length; g++) {
      const i = groups[g].list.findIndex((t) => String(t.id) === String(id));
      if (i >= 0) return { g, i0: i };
    }
    return null;
  },

  onDragStart(e) {
    const id = e.detail.id;
    const loc = this._locate(id);
    if (!loc || !this._layout) return;
    const { rects, starts } = this._layout;
    const flat = starts[loc.g] + loc.i0;
    const rect = rects[flat];
    // 交换步长 = 拖动卡高 + 组内间距（票卡等高近似；margin 26rpx ≈ 13px）
    const H = (rect ? rect.height : 96) + 13;
    this._drag = { ...loc, id, vi: loc.i0, H, len: this.data.groups[loc.g].list.length };
    this.setData({ dragId: id });
  },

  onDragMove(e) {
    const d = this._drag;
    if (!d || String(e.detail.id) !== String(d.id)) return;
    const vi = Math.max(0, Math.min(d.len - 1, d.i0 + Math.round(e.detail.dy / d.H)));
    if (vi === d.vi) return; // 未跨位
    d.vi = vi;
    // 让位：i0 与 vi 之间的卡向拖动反方向挪一位（纯 transform，列表节点不动）
    const list = this.data.groups[d.g].list;
    const offsets = {};
    list.forEach((t, i) => {
      if (i > d.i0 && i <= vi) offsets[t.id] = -d.H;
      else if (i < d.i0 && i >= vi) offsets[t.id] = d.H;
    });
    this.setData({ offsets });
  },

  onDragEnd() {
    const d = this._drag;
    if (!d) return;
    this._drag = null;
    const list = this.data.groups[d.g].list.slice();
    if (d.vi !== d.i0) {
      const [moved] = list.splice(d.i0, 1);
      list.splice(d.vi, 0, moved);
      this.setData({ [`groups[${d.g}].list`]: list, offsets: {}, dragId: '' });
      // 落盘（异步；失败不回滚界面，下次进入以存储为准 + toast 提示）
      store.reorderGroup(list.map((t) => t.id)).catch(() => {
        wx.showToast({ title: '排序未保存，请重试', icon: 'none' });
      });
    } else {
      this.setData({ offsets: {}, dragId: '' });
    }
  },

  // ===== 4.16.0 组间排序：按住月头把手，整组（标题+票卡）拖到目标章节位置 =====
  onGroupTS(e) {
    const gi = Number(e.currentTarget.dataset.gi);
    const rg = this._layout && this._layout.rectsG;
    if (isNaN(gi) || !rg || !rg[gi]) return;
    // 组步长 = 相邻组 top 差（含组间距）；末组或异常时用自身高 + 实测组距兜底
    let Hg = rg[gi + 1] ? Math.round(rg[gi + 1].top - rg[gi].top) : 0;
    if (!Hg || Hg < 40) Hg = Math.round(rg[gi].height + 26);
    this._gdrag = { gi, vg: gi, Hg, len: this.data.groups.length, y0: e.touches[0].clientY, _t: 0 };
    wx.vibrateShort({ type: 'light' });
    this.setData({ groupLift: gi, groupDy: 0, groupOffsets: {} });
  },

  onGroupTM(e) {
    const d = this._gdrag;
    if (!d) return;
    const now = Date.now();
    if (now - d._t < 16) return; // 16ms 节流（与卡拖一致）
    d._t = now;
    const dy = e.touches[0].clientY - d.y0;
    const vg = Math.max(0, Math.min(d.len - 1, d.gi + Math.round(dy / d.Hg)));
    const patch = { groupDy: dy };
    if (vg !== d.vg) {
      d.vg = vg;
      // 让位：gi 与 vg 之间的组整体挪一组高（纯 transform，列表节点不动）
      const offs = {};
      for (let g = 0; g < d.len; g++) {
        if (g > d.gi && g <= vg) offs[g] = -d.Hg;
        else if (g < d.gi && g >= vg) offs[g] = d.Hg;
      }
      patch.groupOffsets = offs;
    }
    this.setData(patch);
  },

  onGroupTE() {
    const d = this._gdrag;
    if (!d) return;
    this._gdrag = null;
    if (d.vg === d.gi) {
      this.setData({ groupLift: -1, groupDy: 0, groupOffsets: {} });
      return;
    }
    const groups = this.data.groups.slice();
    const [moved] = groups.splice(d.gi, 1);
    groups.splice(d.vg, 0, moved);
    const labels = groups.map((g) => g.label);
    this._groupOrder = labels; // 端上即时生效；保存失败下次进入以存储为准
    this.setData({ groups, groupLift: -1, groupDy: 0, groupOffsets: {} });
    store.reorderGroups(labels).catch(() => {
      wx.showToast({ title: '章节顺序未保存，请重试', icon: 'none' });
    });
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

  /** 点开半张预览 → 展开该组全部票根 */
  onPeekTap(e) {
    const label = e.currentTarget.dataset.label;
    this._expanded = this._expanded || {};
    this._expanded[label] = true;
    this.applyFilter(this.data.activeFilter);
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

  // 票根卡片点击 → 详情（自定义 tap 带 id；原生冒泡 tap 无 id，直接忽略防双触发）
  goDetail(e) {
    const id = e && e.detail && e.detail.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  // ===== M4.5 左滑快捷动作 =====
  // 左滑 → 生成卡片
  goTicketCard(e) {
    const id = e && e.detail && e.detail.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/card/card?id=${id}` });
  },

  // 左滑 → 删除（二次确认 → heavy 震动 → 刷新）
  onTicketDel(e) {
    const id = e && e.detail && e.detail.id;
    if (!id) return;
    const t = (this._all || []).find((x) => String(x.id) === String(id));
    wx.showModal({
      title: '删除这张票根？',
      content: t && t.title ? `「${t.title}」将从收藏册移除，无法恢复。` : '将从收藏册移除，无法恢复。',
      confirmText: '删除',
      confirmColor: '#C94424',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await store.removeTicket(id);
          wx.vibrateShort({ type: 'heavy' });
          wx.showToast({ title: '已删除', icon: 'none' });
          this.refresh();
        } catch (err) {
          wx.showToast({ title: '删除失败：' + String(err.message || err).slice(0, 30), icon: 'none' });
        }
      }
    });
  },

  // 空态引导（筛选结果为空时展示）
  goScan() {
    wx.navigateTo({ url: '/pages/scan/scan' });
  },

  // ===== 4.22.0 首页金刚区快捷入口 =====
  // scan=扫一扫收藏（navigateTo）/ duo=双人空间（tab）/ map=足迹地图 / art=时光美术馆（带最新票根）
  goQuick(e) {
    const k = e && e.currentTarget && e.currentTarget.dataset.k;
    if (!k) return;
    wx.vibrateShort({ type: 'light' });
    if (k === 'scan') { wx.navigateTo({ url: '/pages/scan/scan' }); return; }
    if (k === 'duo') { wx.switchTab({ url: '/pages/duo/duo' }); return; }
    if (k === 'map') { wx.navigateTo({ url: '/pages/map/map' }); return; }
    if (k === 'art') {
      const first = (this._all || []).find((t) => t && t.id);
      if (first) wx.navigateTo({ url: `/pages/art/art?id=${first.id}` });
      return;
    }
  }
});
