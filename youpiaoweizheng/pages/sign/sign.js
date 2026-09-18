// pages/sign/sign.js —— 合作场馆立牌（8.1.0 拉新 4/6）
// ============================================================
// 【这一页给谁用】给「要去谈一家场馆、谈成了要一张能印的东西」的人 —— 也就是你自己。
//   填上场馆名（或活动名），选一句号召，存一张 A4 比例的竖图，拿去图文店印出来，
//   摆在取票口或入口。观众散场时手里正好捏着一张票，那是他这辈子最可能把票存下来的几十秒。
//
// 【码为什么和分享那张不一样】分享卡上的码落在**首页**：好友点进来要先知道这是个什么 App。
//   立牌不一样 —— 站在场馆里扫码的人手里有票、脚下就是这一场，多一屏就少一半人。
//   所以立牌码的 scene 是 `b=sign`、落地页直接是拍照页（云函数 wxacode 的 kind='sign'），
//   扫码 → 取景框，中间不隔任何一屏（page 写在云函数里，端上**指定不了**任意页面）。
//
// 【版式与文案不在这里】在 utils/signBoard.js（纯函数，Node 里真跑）
//   与 pages/sign/board.js（画笔）。这一页只管：输入、取码、画、存。
//
// 【码没取到就不给存】宁可让用户等一下，也不能让他印出一张扫不动的图 ——
//   那种错直到贴在门口都不会被发现。云兜底/演示模式下直接不给存（见 isDemo 横幅）。
// ============================================================
const themeUtil = require('../../utils/theme.js');
const track = require('../../utils/track.js');
const haptics = require('../../utils/haptics.js');
const saveimg = require('../../utils/saveimg.js');
const { safeDpr } = require('../../utils/canvas-deco.js');
const board = require('../../utils/signBoard.js');
const painter = require('./board.js');
const { USE_CLOUD } = require('../../utils/env.js');

// 输入时的重画节流：每敲一个字重画一遍整张 750×1060 的画布，低端机上会掉帧。
// 180ms 是「停下来就刷新」的手感，又不至于在连打时排队重画。
const REDRAW_MS = 180;

Page({
  data: {
    theme: 'a',
    isDemo: !USE_CLOUD,   // 演示模式：没有小程序码，印出来扫不了 → 页面上明说，且不给存
    title: '',
    sub: '',
    subPh: board.SUB_DEFAULT,
    titleMax: board.TITLE_MAX,
    subMax: board.SUB_MAX,
    // 出图像素：要等 dpr 定下来才知道，_init 里回填。填之前页面上的说明是空的，
    // 所以这里给个 0 而不是编一个数（编出来的数就是假信息）。
    fitW: 0,
    fitH: 0,
    qrFail: false,
    saving: false
  },

  onShow() {
    themeUtil.apply(this);
  },

  onReady() {
    this._init();
  },

  /** 建画布 → 画一版没有码的 → 再去取码（不挡首屏，同 card.js 4.17.1 的理由） */
  async _init() {
    const canvas = await this._canvasNode();
    if (!canvas) return;   // 取不到节点就没得画；用户重新进页面即可，不必弹窗吓他
    this._canvas = canvas;
    this._fit = board.sheet();
    // dpr 交给 safeDpr 回夹（750×1060 的 2 倍是 1500×2120，离 iOS 单边 4096 那条线还远）
    this._dpr = safeDpr(this._fit.w, this._fit.h,
      (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2);
    canvas.width = this._fit.w * this._dpr;
    canvas.height = this._fit.h * this._dpr;
    this._ctx = canvas.getContext('2d');
    this.setData({ fitW: canvas.width, fitH: canvas.height });
    this.draw();

    if (this.data.isDemo) return;     // 演示模式没有真码，也不必空跑一次云调用
    const qr = await this._ensureQR();
    if (qr) this.draw();
    else this.setData({ qrFail: true });
  },

  /** 取画布节点。节点由 wx:if 跟着数据建，偶发取不到时重试几次（同 card / discover 的做法） */
  _canvasNode(tryN) {
    const n = tryN || 0;
    return new Promise((resolve) => {
      this.createSelectorQuery().select('#sgCanvas').fields({ node: true }).exec((res) => {
        const node = res && res[0] && res[0].node;
        if (node) return resolve(node);
        if (n >= 3) return resolve(null);
        setTimeout(() => this._canvasNode(n + 1).then(resolve), 120);
      });
    });
  },

  /** 小程序码图（云函数生成 + 云存储缓存；失败静默 null，页面上给明确提示） */
  _ensureQR() {
    if (this._qrImg) return Promise.resolve(this._qrImg);
    if (this._qrPend) return this._qrPend;
    this._qrPend = new Promise((resolve) => {
      wx.cloud.callFunction({
        name: 'saveTicket',
        data: { action: 'wxacode', kind: 'sign' },
        success: (res) => {
          const fileID = res.result && res.result.fileID;
          if (!fileID) return resolve(null);
          wx.cloud.getTempFileURL({
            fileList: [fileID],
            success: (r) => {
              const url = r.fileList && r.fileList[0] && r.fileList[0].tempFileURL;
              if (!url || !this._canvas) return resolve(null);
              const img = this._canvas.createImage();
              img.onload = () => { this._qrImg = img; resolve(img); };
              img.onerror = () => resolve(null);
              img.src = url;
            },
            fail: () => resolve(null)
          });
        },
        fail: () => resolve(null)
      });
    });
    return this._qrPend;
  },

  /** 按当前输入重画预览。标题空着时画的是浅色占位（与输入框的 placeholder 同义，不是编内容） */
  draw() {
    if (!this._ctx) return;
    const s = board.sanitize({ title: this.data.title, sub: this.data.sub });
    this._san = s;
    // 每次重画前复位变换：scale 是叠加的，不复位的话第二次起就画到纸外面去了
    this._ctx.setTransform(1, 0, 0, 1, 0, 0);
    this._ctx.scale(this._dpr, this._dpr);
    painter.render(this._ctx, {
      fit: this._fit,
      title: s.title || '场馆 / 活动名',
      dim: !s.ok,
      sub: s.sub,
      qr: this._qrImg || null
    });
  },

  onTitle(e) { this.setData({ title: e.detail.value }); this._queueDraw(); },
  onSub(e) { this.setData({ sub: e.detail.value }); this._queueDraw(); },

  _queueDraw() {
    if (this._drawT) clearTimeout(this._drawT);
    this._drawT = setTimeout(() => { this._drawT = null; this.draw(); }, REDRAW_MS);
  },
  _clearDrawT() {
    if (this._drawT) { clearTimeout(this._drawT); this._drawT = null; }
  },
  onHide() { this._clearDrawT(); },
  onUnload() { this._clearDrawT(); },

  /** 存到相册：出图 → 保存（授权引导在 utils/saveimg.js 里，别在这里再写一份） */
  async save() {
    if (this.data.saving) return;
    const s = board.sanitize({ title: this.data.title, sub: this.data.sub });
    if (!s.ok) return wx.showToast({ title: '先填上场馆或活动名', icon: 'none' });
    if (this.data.isDemo) {
      return wx.showToast({ title: '演示模式没有小程序码，印出来扫不了', icon: 'none' });
    }
    if (!this._qrImg) {
      return wx.showToast({ title: this.data.qrFail ? '小程序码没取到，重进本页再试' : '小程序码还在生成，稍等一下', icon: 'none' });
    }
    if (!this._canvas) return wx.showToast({ title: '画布还没准备好，稍等一下', icon: 'none' });

    this.setData({ saving: true });
    wx.showLoading({ title: '生成图片中…', mask: true });
    try {
      const path = await saveimg.exportCanvas(this._canvas);
      await saveimg.save(path);
      wx.hideLoading();
      haptics.confirm();
      track.track('sign_save', {});
      wx.showToast({ title: '已存入相册', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      // shown = 授权被拒 / 用户自己取消那两种，saveimg 已经弹过或本就不该弹，别再叠一个 toast
      if (!e || !e.shown) wx.showToast({ title: (e && e.msg) || '保存失败，请重试', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
