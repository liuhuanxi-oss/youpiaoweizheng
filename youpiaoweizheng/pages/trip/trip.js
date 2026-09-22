// pages/trip/trip.js —— 8.4.0「这一趟」：从一张票圈出前后那几天，拼成一张图
// ============================================================
// 【这一页只做三件事】圈范围 → 画图 → 存相册。
//   圈范围在 utils/trip.js，版式在 pages/trip/poster.js —— 两个都不依赖 wx，
//   能在 npm test 里真跑（tests/trip.test.js、tests/trip_poster.test.js）。
//   所以这一页里不该再出现任何「哪张算这一趟」的判断。
//
// 【照片要自己加载】小程序画布吃不了 cloud:// 文件 ID（canvas 2d 的 Image.src 只认
//   http/file/data），得先换临时链接再 createImage。一张取不到不拖累其余几张 ——
//   那一张的框里退回它的类型文字（见 poster.js 的 photoFrame）。
//
// 【抬头那句是替用户断言的】tripOf 回的是**整趟**的真数，图上最多 6 张；挑过就在图上明说
//   「这一趟共 N 张，图里挑了 6 张」。这句不能省 —— 少了它，图就在替用户说一句不完整的话。
// ============================================================
const store = require('../../utils/store.js');
const trip = require('../../utils/trip.js');
const poster = require('./poster.js');
const mock = require('../../utils/mock.js');       // 类型 → 中文（框里那份「演出 / 电影」）
const saveimg = require('../../utils/saveimg.js'); // 存相册的失败分类只此一份，别再各写一份
const haptics = require('../../utils/haptics.js');
const track = require('../../utils/track.js');
const { safeDpr } = require('../../utils/canvas-deco.js');

// 成不了一趟时说的话：每句都指得出下一步，不甩一句「暂无数据」了事
const WHY = {
  demo: '这会儿读不到你的票根，先把网络理顺，再来拼这一趟',
  'no-anchor': '没找到这张票根',
  'no-date': '这张票根还没填日期 —— 不知道是哪天，就圈不出这一趟',
  alone: '这一趟暂时只有这一张。前后三天里再攒几张，就能拼成一段'
};

Page({
  data: {
    ready: false,
    head: '',        // 日期跨度（图上那行大字下面那句）
    stat: '',        // 统计行
    items: [],       // 图上那几张（轻量副本，照片不进 data）
    total: 0,        // 这一趟的真实张数
    capped: false,   // 图上挑过（>6 张）
    why: '',         // 成不了一趟时的原因（人话）
    saving: false
  },

  onLoad(o) {
    this._id = String((o && o.id) || '');
    this.load();
  },

  onUnload() {
    // 画布显式释放：这一屏的位图是全页最大的一块内存（同年度报告 / 生日歌单）
    if (this._canvas) { this._canvas.width = 0; this._canvas.height = 0; }
    this._canvas = null;
    this._ctx = null;
    this._imgs = null;
  },

  /** 读列表 → 圈这一趟 → 摆进 data（照片要用的原件留在 this._r，不进 setData） */
  async load() {
    let list = [];
    let flags = null;
    try {
      list = await store.listTickets();
      flags = store.listFlags(); // 云兜底那份演示票不能拼成「你的这一趟」
    } catch (e) {
      this.setData({ ready: true, why: '没能读到票根，过一会儿再试' });
      return;
    }
    const r = trip.tripOf(list, this._id, undefined, flags);
    if (!r.ok) {
      this.setData({ ready: true, why: WHY[r.reason] || '这一趟还没攒够票' });
      return;
    }
    this._r = r;
    this.setData({
      ready: true,
      head: trip.spanText(r.from, r.to),
      stat: trip.statText(r),
      total: r.total,
      capped: r.capped,
      items: r.items.map((x) => ({
        id: x.id,
        date: x.date || '',
        title: x.title || '票根',
        typeText: mock.TYPE_TEXT[x.type] || '票根',
        city: x.city || ''
      }))
    });
    track.track('trip_open', { n: r.total, shown: r.items.length });
  },

  goBack() {
    haptics.tap();
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/album/album' }) });
  },

  // ── 出图 ──
  _ensureCanvas() {
    if (this._canvas) return Promise.resolve(true);
    return new Promise((resolve) => {
      this.createSelectorQuery()
        .select('#tripCanvas')
        .fields({ node: true })
        .exec((res) => {
          const node = res && res[0] && res[0].node;
          if (!node) return resolve(false);
          // 1080×1440 × dpr 3 = 3240×4320，在 iOS 单边 4096 之内；仍走 safeDpr，与全项目一个口径
          const dpr = safeDpr(poster.TW, poster.TH, (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2);
          node.width = poster.TW * dpr;
          node.height = poster.TH * dpr;
          const ctx = node.getContext('2d');
          ctx.scale(dpr, dpr);
          this._canvas = node;
          this._ctx = ctx;
          resolve(true);
        });
    });
  },

  /** 票根照片 → Canvas Image（一张失败不拖累其余几张，那张的框里会退回类型文字） */
  _loadPhotos() {
    const items = (this._r && this._r.items) || [];
    this._imgs = this._imgs || {};
    return Promise.all(items.map((p) => new Promise((resolve) => {
      if (!p.img || this._imgs[p.img] || !this._canvas) return resolve(false);
      const finish = (url) => {
        if (!url) return resolve(false);
        const img = this._canvas.createImage();
        img.onload = () => { this._imgs[p.img] = img; resolve(true); };
        img.onerror = () => resolve(false);
        img.src = url;
      };
      if (/^cloud:/.test(p.img)) {
        wx.cloud.getTempFileURL({
          fileList: [p.img],
          success: (r) => finish(r.fileList && r.fileList[0] && r.fileList[0].tempFileURL),
          fail: () => resolve(false)
        });
      } else {
        finish(p.img);
      }
    })));
  },

  /** 画（照片加载好才画；画布未就绪自愈一次，同年度报告） */
  _paint() {
    if (!this._r) return Promise.resolve(false);
    if (!this._ctx) {
      return this._ensureCanvas().then((ok) => (ok ? this._paint() : false));
    }
    return this._loadPhotos().then(() => {
      const r = this._r;
      poster.render(this._ctx, {
        head: this.data.head,
        stat: this.data.stat,
        items: r.items.map((x) => ({ im: this._imgs[x.img] || null, typeText: mock.TYPE_TEXT[x.type] || '票根' })),
        total: r.total,
        capped: r.capped
      });
      return true;
    });
  },

  onSave() {
    if (!this._r || this.data.saving) return;
    haptics.tap();
    this.setData({ saving: true });
    wx.showLoading({ title: '正在出图', mask: true });
    this._paint()
      .then((ok) => {
        if (!ok) throw Object.assign(new Error('画布未就绪'), { msg: '出图失败，请重试' });
        return saveimg.exportCanvas(this._canvas);
      })
      .then((path) => saveimg.save(path))
      .then(() => {
        wx.hideLoading();
        track.track('trip_poster', { n: this._r.total, shown: this._r.items.length });
        wx.showToast({ title: '已存进相册', icon: 'success' });
      })
      .catch((e) => {
        wx.hideLoading();
        // saveimg 里弹过窗的（权限/取消）不再弹第二个，见 utils/saveimg.js 顶部
        if (!e.shown) wx.showToast({ title: e.msg || '保存失败，请重试', icon: 'none' });
      })
      .then(() => { this.setData({ saving: false }); });
  }
});
