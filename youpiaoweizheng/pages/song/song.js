// pages/song/song.js —— 生日歌单：选一个日子，翻出属于它的那首歌
// ============================================================
// 【这一页只做三件事】选日期 → 出结果 → 出图。
//   匹配在 utils/birthdaySong.js，版式在 pages/song/poster.js ——
//   两个都不依赖 wx，能在 npm test 里真跑（见 tests/birthday_song.test.js）。
//   所以这一页里不该再出现任何「哪首歌配哪一天」的判断。
//
// 【日期为什么用「月 + 日」两列，不用日期控件】生日不需要年份，带上年份反而怪
//   （「我 1998 年生的，跟这首歌有关系吗」）。两列的日数跟着月份变，2 月按 29 天。
//
// 【分享带 m/d + 歌手】好友点开的落地页会自动翻出**同一个结果**（同一天、同一位歌手），
//   否则他点进来只会看到一对没选过的空选择器 —— 这条见 utils/share.js 的 song 场景。
// ============================================================
const engine = require('../../utils/birthdaySong.js');
const poster = require('./poster.js');
const saveimg = require('../../utils/saveimg.js');
const share = require('../../utils/share.js');
const track = require('../../utils/track.js');
const haptics = require('../../utils/haptics.js');
const { safeDpr } = require('../../utils/canvas-deco.js');

const MONTHS = engine.DAYS.map((_, i) => (i + 1) + ' 月'); // 12 个月的列文案
const dayLabels = (m) => {
  const n = engine.DAYS[m - 1];
  const out = [];
  for (let i = 1; i <= n; i++) out.push(i + ' 日');
  return out;
};
// 翻找动效的三步文案：慢一点才有「在 366 天里找」的感觉，但别慢到让人等
const STEP_MS = 340;
const steps = (m, d) => ['在 366 天里翻找…', '翻到 ' + m + ' 月 ' + d + ' 日…', '找到了'];

Page({
  data: {
    artists: engine.names(),  // 顶部的歌手切换（顺序就是引擎里 ARTISTS 的顺序）
    artist: engine.DEFAULT_ARTIST,
    total: engine.total(engine.DEFAULT_ARTIST),
    range: [MONTHS, dayLabels(1)],
    pick: [0, 0],          // picker 的选中下标（月、日）
    dateText: '1 月 1 日',
    busy: false,
    step: '',
    r: null,
    fromShare: false
  },

  onLoad(options) {
    const o = options || {};
    const m = parseInt(o.m, 10);
    const d = parseInt(o.d, 10);
    // 歌手名走 query，中文要自己解码；微信有的版本已解码过一次，这里解第二次也无害
    const want = o.a ? decodeURIComponent(o.a) : '';
    const artist = engine.names().indexOf(want) >= 0 ? want : engine.DEFAULT_ARTIST;
    const r = engine.match(m, d, artist);
    if (r) this._show(m, d, r, true); // 分享进来的：直接把那一天的结果摆出来
    this.setData({ artist, total: engine.total(artist) });
    track.track('song_open', { from: r ? 'share' : 'me', artist, m: m || 0, d: d || 0 });
  },

  onUnload() {
    this._gone = true; // 动效的定时器还挂着，页面已经走了就别再 setData
    this._canvas = null;
    this._ctx = null;
  },

  // ── 选日期 ──
  /** 滚月份那一列时，把日期列的长度换掉（31 天的月份滚到 2 月，日不能还停在 31） */
  onCol(e) {
    const det = e.detail || {};
    if (det.column !== 0) return;
    const days = dayLabels(det.value + 1);
    const pick = [det.value, Math.min(this.data.pick[1], days.length - 1)];
    this.setData({ range: [MONTHS, days], pick, dateText: this._text(pick) });
  },

  onPick(e) {
    haptics.tap();
    const pick = (e.detail && e.detail.value) || [0, 0];
    this.setData({ pick, dateText: this._text(pick) });
  },

  _text(pick) {
    return (pick[0] + 1) + ' 月 ' + (pick[1] + 1) + ' 日';
  },

  // ── 换歌手：已经翻出结果的就地重翻，不要求他再点一次「翻出」 ──
  onWho(e) {
    const a = (e.currentTarget.dataset || {}).a;
    if (!a || a === this.data.artist) return;
    haptics.tap();
    const r = this.data.r ? engine.match(this.data.r.m, this.data.r.d, a) : null;
    // fromShare 要清掉：换了歌手，「这是朋友分享的那一天」这句话就不成立了
    this.setData({ artist: a, total: engine.total(a), r, fromShare: false });
    if (r) this._paint();
    track.track('song_artist', { artist: a });
  },

  // ── 翻出结果 ──
  onDraw() {
    if (this.data.busy) return;
    haptics.tap();
    const m = this.data.pick[0] + 1;
    const d = this.data.pick[1] + 1;
    const r = engine.match(m, d, this.data.artist);
    if (!r) return wx.showToast({ title: '这一天不存在，换一个', icon: 'none' });

    // 三步文案走完再落结果：这一秒是「仪式感」的全部预算，多了就烦人
    const lines = steps(m, d);
    this.setData({ busy: true, r: null, step: lines[0] });
    lines.slice(1).forEach((s, i) => {
      setTimeout(() => { if (!this._gone) this.setData({ step: s }); }, STEP_MS * (i + 1));
    });
    setTimeout(() => {
      if (this._gone) return;
      this._show(m, d, r);
      this.setData({ busy: false, step: '' });
      this._paint(); // 先把画布画好：之后分享和保存都只是「导出」，不用再等渲染
    }, STEP_MS * lines.length);

    track.track('song_draw', { m, d, song: r.song.t });
  },

  /** 摆出结果（分享落地的 onLoad 与 onDraw 共用这一条路） */
  _show(m, d, r, fromShare) {
    this.setData({
      r,
      fromShare: !!fromShare,
      pick: [m - 1, d - 1],
      range: [MONTHS, dayLabels(m)],
      dateText: m + ' 月 ' + d + ' 日'
    });
  },

  onAgain() {
    haptics.tap();
    this.setData({ r: null, fromShare: false });
  },

  // ── 出图 ──
  _ensureCanvas() {
    if (this._canvas) return Promise.resolve(true);
    return new Promise((resolve) => {
      this.createSelectorQuery()
        .select('#songCanvas')
        .fields({ node: true })
        .exec((res) => {
          const node = res && res[0] && res[0].node;
          if (!node) return resolve(false);
          // 1080×1920 × dpr=3 会顶到 iOS 单边 4096 的上限，回夹交给 safeDpr（同年度报告）
          const dpr = safeDpr(poster.RW, poster.RH, (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2);
          node.width = poster.RW * dpr;
          node.height = poster.RH * dpr;
          const ctx = node.getContext('2d');
          ctx.scale(dpr, dpr);
          this._canvas = node;
          this._ctx = ctx;
          resolve(true);
        });
    });
  },

  /** 把当前结果画进画布（画好了才可能被分享/保存） */
  _paint() {
    if (!this.data.r) return Promise.resolve(false);
    return this._ensureCanvas().then((ok) => {
      if (!ok) return false;
      poster.render(this._ctx, this.data.r); // r 里已经带了 artist，不用在这儿补
      return true;
    });
  },

  onSave() {
    if (!this.data.r || this._saving) return;
    haptics.tap();
    this._saving = true;
    wx.showLoading({ title: '正在出图', mask: true });
    this._paint()
      .then((ok) => {
        if (!ok) throw Object.assign(new Error('画布未就绪'), { msg: '出图失败，请重试' });
        return saveimg.exportCanvas(this._canvas);
      })
      .then((path) => saveimg.save(path))
      .then(() => {
        wx.hideLoading();
        const r = this.data.r;
        track.track('song_poster', { m: r.m, d: r.d, song: r.song.t });
        wx.showToast({ title: '已存进相册', icon: 'success' });
      })
      .catch((e) => {
        wx.hideLoading();
        // saveimg 里弹过窗的（权限/取消）不再弹第二个，见 utils/saveimg.js 顶部
        if (!e.shown) wx.showToast({ title: e.msg || '保存失败，请重试', icon: 'none' });
      })
      .then(() => { this._saving = false; });
  },

  // ── 分享 ──
  onShareAppMessage() {
    track.track('share_click', { from: 'song' });
    const r = this.data.r || {};
    // 有画布就把海报当卡片图（promise 需 3 秒内返回，失败降级默认截图 —— 同 card.js）
    const promise = this._canvas
      ? wx.canvasToTempFilePath({ canvas: this._canvas })
        .then((res) => ({ imageUrl: res.tempFilePath }))
        .catch(() => ({}))
      : null;
    return share.message('song', { m: r.m, d: r.d, song: r.song && r.song.t, artist: this.data.artist }, { promise });
  },

  onShareTimeline() {
    track.track('share_timeline', { from: 'song' });
    const r = this.data.r || {};
    // 朋友圈落地页是当前页、只能带 query —— 把生日带上，别人点开看到的才是同一个结果
    return share.timeline('song', { m: r.m, d: r.d, song: r.song && r.song.t, artist: this.data.artist });
  }
});
