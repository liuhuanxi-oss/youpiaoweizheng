// pages/annual/annual.js —— 年度回忆报告（品牌全案 · 稿屏9）
// ============================================================
// 页面本体（品牌行 / 大标题 / 两张水彩统计卡 / 年度精选拼贴 / AI 年度结语 / 两枚按钮）
// 走 WXML + WXSS，随六主题换色 —— 稿屏9 本来就是一张竖版长页，页面就直接长成这样。
//
// 「生成分享海报」导出的那张 1080×1920 长图仍由 Canvas 画：它要能存相册、要能当转发图，
// 必须是一张真位图。导出图用的是页面这同一套视觉语言（齿边纸 / 水彩卡 / 齿边照片框 /
// 邮戳 / 花枝），但不是逐像素照搬 —— 竖版长页排不下页面的留白节奏。
//
// 数据全部端上聚合 store.listTickets()，无新增云函数。
// ============================================================
const store = require('../../utils/store.js');
const themeUtil = require("../../utils/theme.js");
const pay = require('../../utils/pay.js');     // 署名：昵称 → 报告尾款
const track = require('../../utils/track.js'); // 埋点
const share = require('../../utils/share.js'); // 7.3.0 S1/S2：分享文案（好友 + 朋友圈）
const deco = require('../../utils/deco.js');   // 图形：齿边面板 / 邮戳 / 花枝 / 星点
const poster = require('./poster.js');         // 分享海报的 1080×1920 版式（Canvas）
const { iconSrc } = require('../../utils/icons.js'); // 全页无 emoji，图标一律线性 SVG
const ai = require('../../utils/ai.js');       // AI 年度结语（失败有本地兜底，不空着）
const haptics = require('../../utils/haptics.js'); // 7.4.0：触觉三档，别再直接写 vibrateShort
const { safeDpr } = require('../../utils/canvas-deco.js'); // 画布倍率回夹（iOS 单边 4096 上限）

// 海报画布尺寸
const RW = poster.RW, RH = poster.RH;
// 海报调色（导出图固定「纸感浅色」视觉，不随主题变化——存进相册的图要质感统一）
const C = poster.C;
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// —— 页面尺寸（rpx）：WXSS 里写死的宽高必须与这里一致 ——
// 齿边是贴着框边跑一圈的，盒子与 viewBox 差一点齿就偏出边框（同 utils/deco.js artFrame 的约定）。
const PA_W = 320, PA_H = 250;   // 两张水彩统计卡
const FW = 322, FH = 268;       // 年度精选的齿边照片框
const AI_W = 670, AI_H = 290;   // AI 年度结语卡
// 拼贴里四张照片的倾角（手账是贴上去的，张张都正才会像表格）
const TILTS = [-3.4, 2.6, 2.2, -2.8];
// 和纸胶带的三种色（与时光机页同源，贴在照片框角上）
const TAPE_TINT = ['#F6DFA8', '#E8AFA8', '#A9C3A6'];

/** 千分位金额（iOS toLocaleString 不稳，手写） */
function fmtN(n) {
  const s = String(Math.round(Number(n) || 0));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 2025-06-21 → { dd:'21', mm:'JUN', yy:'2025' }（邮戳里那三行） */
function stampDate(dateStr) {
  const p = String(dateStr || '').split('-');
  if (p.length !== 3) return { dd: '--', mm: '---', yy: '----' };
  return { dd: p[2], mm: MON[Math.max(0, Math.min(11, Number(p[1]) - 1))], yy: p[0] };
}

/** 类型 → 无照片时的兜底图标名与中文（与时光机页同一套） */
const TYPE_ICONS = { show: 'mask', movie: 'film', traffic: 'train' };
const TYPE_TEXT = { show: '演出', movie: '电影', traffic: '出行' };

/** 年度精选挑四张：有照片的优先，其次票价高的，其次时间近的（拼贴是照片墙，图最要紧） */
function pickTop(ts) {
  return ts.slice().sort((a, b) =>
    (b.img ? 1 : 0) - (a.img ? 1 : 0) ||
    (Number(b.price) || 0) - (Number(a.price) || 0) ||
    String(b.date).localeCompare(String(a.date))
  ).slice(0, 4);
}

Page({
  data: {
    theme: 'a', legacyTheme: 'a',
    // 7.3.0 S1：朋友圈单页模式（无身份、不能跳页）→ 整页换品牌落地卡
    sp: share.sp(),
    loading: true,
    empty: false,
    error: false,
    // 云故障 / 超上限横幅（{ text, retry }；null = 不显示），同 album 的 netBar
    netBar: null,
    exporting: false,
    closing: false,      // AI 结语重新生成中
    y: '',               // 年份（取最近一张票根的年份）
    s: null,             // 年度指标
    picks: [],           // 年度精选（最多 4 张）
    ai: [],              // AI 年度结语：恰好两行
    no: '',              // 拼贴上那枚「No. xxxxxx」标签
    pm: [],              // 拼贴上的邮戳（0~2 枚）
    ic: {}, art: {}
  },

  onShow() {
    themeUtil.apply(this);
    this.buildArt();
    this._loadSignature(); // 4.20.3：署名异步到货，晚到只补 setData 重绘尾款
  },

  onReady() {
    this._ensureCanvas();
  },

  onLoad() {
    if (this.data.sp) return; // 单页模式：不读空数据（wxml 整页换成落地卡）
    this.reload();
  },

  /** 拉全量票根 → 聚合年度指标（重试/首载同路） */
  async reload() {
    this.setData({ loading: true, empty: false, error: false, netBar: null });
    try {
      const raw = await store.listTickets();
      // 年报是全网最容易「一本正经胡说八道」的一页：云库读失败时 store 兜底成演示票根，
      // 于是总张数、去过的城市、花了多少钱全是编的，还配一段 AI 结语。
      // 不挂横幅，用户会把这份年报当成自己的真实年度。
      const flags = store.listFlags();
      const netBar = flags.netFallback
        ? { text: '网络开小差了，这份年报用的是演示票根 · 点我重试', retry: true }
        : (flags.truncated ? { text: `票根超过 ${flags.cap} 张，年报只统计了最近的 ${flags.cap} 张`, retry: false } : null);
      const ts = (raw || [])
        .filter((t) => t && t.title && /^\d{4}-\d{2}-\d{2}/.test(String(t.date || '')))
        .slice()
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      if (!ts.length) { this.setData({ loading: false, empty: true }); return; }

      const cities = new Set(ts.filter((t) => t.city).map((t) => t.city));
      const cost = ts.reduce((s, t) => s + (Number(t.price) || 0), 0);
      const shows = ts.filter((t) => t.type === 'show').length;
      const first = ts[0];
      const last = ts[ts.length - 1];
      // 「最贵的一场」（有价才计入）
      const priciest = ts.filter((t) => Number(t.price) > 0)
        .reduce((m, t) => (!m || Number(t.price) > Number(m.price) ? t : m), null);
      const y0 = String(first.date).slice(0, 4);
      const y1 = String(last.date).slice(0, 4);
      const s = {
        total: ts.length, cost, cities: cities.size, shows, first, last, priciest,
        firstCity: first.city || '', lastCity: last.city || '',
        firstLabel: y0 === y1 ? `在 ${y0} 年攒下第一张，之后一张接一张` : `从 ${y0} 攒到 ${y1}，一路没停过`,
        range: y0 === y1 ? y0 : `${y0} — ${y1}`
      };

      const picks = pickTop(ts).map((t, i) => {
        const d = stampDate(t.date);
        return {
          id: t.id,
          img: t.img || '',
          ico: iconSrc(TYPE_ICONS[t.type] || 'ticket', '#6B5B50', 0.55, 1.6),
          typeText: TYPE_TEXT[t.type] || '票根',
          tilt: TILTS[i] || 0,
          tape: deco.decoSrc('tape', Object.assign({}, themeUtil.getThemeMeta(themeUtil.getTheme()), { accent: TAPE_TINT[i % 3] })),
          bg: deco.pinkedPanel(FW, FH, { fill: '#FFFDF8', ink: '#C9A469', tooth: 16, amp: 4.5, inset: 4, strokeAlpha: 0.35 }),
          // 邮戳只给第 1、3 张（左上与左下）——稿里两枚戳就是错开落在这两处的
          pm: (i === 0 || i === 2) ? { city: t.city || '未知', dd: d.dd, mm: d.mm, yy: d.yy } : null
        };
      });

      this._s = s;
      this.setData({
        loading: false, s, picks, y: y1, netBar,
        pm: picks.filter((p) => p.pm).map((p) => p.pm),
        no: String(last.id || '').replace(/\D/g, '').slice(-6) || String(last.date).replace(/-/g, '').slice(2)
      });
      this.draw();
      this.writeClosing();
    } catch (e) {
      this.setData({ loading: false, error: true });
    }
  },

  /** 云故障横幅重试（截断提示不可点，故只认 retry） */
  onNetBarTap() {
    if (this.data.netBar && this.data.netBar.retry) this.reload();
  },

  /** 写 AI 年度结语；失败/超时都由 ai.js 兜底成本地文案，卡片不会空着 */
  async writeClosing() {
    if (!this._s || this.data.closing) return;
    this.setData({ closing: true, ai: ai.annualFallback(this._s) }); // 先亮兜底，AI 到了再换
    const lines = await ai.generateAnnual(this._s);
    this.setData({ closing: false, ai: lines });
  },

  /** 「重新生成」：重写结语 */
  redoAi() {
    if (this.data.closing) return;
    track.track('annual_redo', { total: this._s ? this._s.total : 0 });
    this.writeClosing();
  },

  /** 主题切换 / 换页回来都要重编一遍图形（data-uri 里的颜色是编译时写死的） */
  buildArt() {
    const m = themeUtil.getThemeMeta(themeUtil.getTheme());
    this.setData({
      ic: {
        logo: iconSrc('ticket', '#FFF8F2', 0, 1.7, true),
        ticket: iconSrc('ticket', m.text, 0.42, 1.4),
        plane: iconSrc('plane', C.sageD, 0.8, 1.5),
        refresh: iconSrc('refresh', m.text, 0.75),
        send: iconSrc('plane', '#FFF8F2', 0, 1.6),
        clock: iconSrc('clock', m.text, 0.28, 1.5),
        emptyIc: iconSrc('ticket', m.text, 0.28, 1.4),
        cloud: iconSrc('sparkle', m.text, 0.3, 1.5)
      },
      art: {
        wave: deco.decoSrc('wavelines', Object.assign({}, m, { primary: C.roseD })),
        sprig: deco.decoSrc('sprig', Object.assign({}, m, { primary: C.sage, accent: C.gold })),
        star: deco.decoSrc('star4', Object.assign({}, m, { accent: C.gold })),
        heart: deco.decoSrc('heartsmall', Object.assign({}, m, { accent: C.petal })),
        // 两张统计卡：齿边 + 水彩晕（纯平涂会像贴上去的色块，有深浅才像颜料洇开）
        panRose: deco.pinkedPanel(PA_W, PA_H, { blotch: ['#FBE4E5', '#F5D6D4'], ink: C.rose, strokeAlpha: 0.55 }),
        panSage: deco.pinkedPanel(PA_W, PA_H, { blotch: ['#E8F0E1', '#D6E3CD'], ink: C.sage, strokeAlpha: 0.55 }),
        panCream: deco.pinkedPanel(AI_W, AI_H, { fill: '#FDF6E8', ink: C.gold, strokeAlpha: 0.45 }),
        // 稿里 AI 卡右侧那枚邮票（花邮票，粉底 + 五瓣花），底下再压三道注销波浪
        stamp: deco.flowerStamp(Object.assign({}, m, { soft: '#FBE3E7', primary: C.rose, petal: C.petal, center: C.gold })),
        stampWave: deco.decoSrc('wavelines', Object.assign({}, m, { primary: C.rose })),
        // 拼贴上那两枚邮戳的圈与注销线：只画图形，城市与日期交给 WXML 用真文本叠上去
        // （SVG 塞进 data-uri 就成了独立文档，中文字形在 iOS/Android 回落不一致——见 utils/deco.js）
        pm: deco.postmarkParts(m)
      }
    });
  },

  goScan() {
    wx.redirectTo({ url: '/pages/scan/scan' });
  },

  // ---------- Canvas（导出海报） ----------
  _ensureCanvas() {
    if (this._canvas) return Promise.resolve(true);
    return new Promise((resolve) => {
      this.createSelectorQuery()
        .select('#annualCanvas')
        .fields({ node: true })
        .exec((res) => {
          const node = res && res[0] && res[0].node;
          if (!node) return resolve(false);
          // 1080×1920 × dpr 3 = 3240×5760，早越过了 iOS 单边 4096 的画布上限 → 回夹到 2。
          // 这一屏是全局最大内存单点，导出失败/闪退都出在这里（规则见 canvas-deco.safeDpr）
          const dpr = safeDpr(RW, RH, ((wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2));
          node.width = RW * dpr;
          node.height = RH * dpr;
          const ctx = node.getContext('2d');
          ctx.scale(dpr, dpr);
          this._canvas = node;
          this._ctx = ctx;
          resolve(true);
        });
    });
  },

  /**
   * 票根照片 → Canvas Image。画布吃不了 cloud:// 文件 ID（小程序 canvas 2d 的
   * Image.src 只认 http/file/data），故先换临时链接；单张失败不拖累其余三张。
   */
  _ensurePhotos() {
    const picks = this.data.picks || [];
    this._photos = this._photos || {};
    return Promise.all(picks.map((p) => new Promise((resolve) => {
      if (!p.img || this._photos[p.img] || !this._canvas) return resolve(false);
      const finish = (url) => {
        if (!url) return resolve(false);
        const img = this._canvas.createImage();
        img.onload = () => { this._photos[p.img] = img; resolve(true); };
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

  /**
   * 绘制海报长图（数据就绪即画；画布未就绪自愈补画，同 card 4.22.4 模式）。
   * @returns {Promise<Boolean>} 图真的落到画布上了才 resolve(true) —— 保存前要等它。
   */
  draw() {
    const s = this._s;
    if (!s) return Promise.resolve(false);
    if (!this._ctx) {
      return this._ensureCanvas().then((ok) => (ok ? this.draw() : false));
    }
    return this._ensurePhotos().then(() => { this._render(s); return true; });
  },

  /** 交给 poster.js 画（照片已加载好，这里只把视图数据摆过去） */
  _render(s) {
    poster.render(this._ctx, {
      y: String(this.data.y || s.range || ''),
      sig: this.data.signature || '',
      s,
      ai: this.data.ai,
      pm: this.data.pm,
      no: this.data.no,
      // picks 里的 img 是给 WXML 用的文件 ID；画布要的是已加载的 Image，按 URL 取
      picks: (this.data.picks || []).map((p) => ({
        im: (p.img && this._photos && this._photos[p.img]) || null,
        typeText: p.typeText
      }))
    });
  },

  /** 存相册：导出 → 保存（授权引导同 card/art） */
  async save() {
    if (!this._canvas || this.data.exporting) return;
    this.setData({ exporting: true });
    wx.showLoading({ title: '正在生成海报…', mask: true });
    try {
      await this.draw(); // 防署名晚到/照片未到货/尺寸未就绪：导出前等重绘真的落图
      const res = await wx.canvasToTempFilePath({ canvas: this._canvas });
      await new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({ filePath: res.tempFilePath, success: resolve, fail: reject });
      });
      wx.hideLoading();
      haptics.confirm();
      track.track('annual_save', { total: this._s ? this._s.total : 0 });
      wx.showToast({ title: '海报已存入相册', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      const msg = String((e && e.errMsg) || e.message || e);
      if (/auth/i.test(msg)) {
        wx.showModal({
          title: '需要相册权限',
          content: '保存海报需要「添加到相册」权限，请在设置中开启',
          confirmText: '去设置',
          success: (r) => { if (r.confirm) wx.openSetting(); }
        });
      } else if (!/cancel/i.test(msg)) {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      }
    } finally {
      this.setData({ exporting: false });
    }
  },

  /** 稿屏9 只留两枚按钮，没有转发按钮 —— 分享走右上角胶囊菜单，这里仍给足转发信息 */
  onShareAppMessage() {
    const t = this._s;
    track.track('annual_share', { total: t ? t.total : 0 });
    // 7.3.0 S2：报告场景文案（数字前置）与落地页走 share.js
    const promise = this._canvas
      ? wx.canvasToTempFilePath({ canvas: this._canvas })
        .then((r) => ({ imageUrl: r.tempFilePath }))
        .catch(() => ({}))
      : null;
    return share.message('annual', { total: t && t.total, cities: t && t.cities }, { promise });
  },

  /** 7.3.0 S1：分享到朋友圈（朋友圈只能带 query、落地就是本页） */
  onShareTimeline() {
    const t = this._s;
    track.track('share_timeline', { from: 'annual' });
    return share.timeline('annual', { total: t && t.total, cities: t && t.cities });
  },

  /** 4.20.3 署名：昵称 → 报告尾款（晚到只补 setData；与 card 页同源） */
  _loadSignature() {
    pay.getProfile().then((p) => {
      const n = p && p.nickname ? String(p.nickname).trim() : '';
      this.setData({ signature: n }, () => { if (this._s && this.data.signature) this.draw(); });
    });
  }
});
