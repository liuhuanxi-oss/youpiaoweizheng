// pages/annual/annual.js —— v5.1 G1 我的时光年报（个人票根年度报告）
// ============================================================
// 方案 G1：一键生成「我的票根年报」——总票数/总花费/城市/演出/最早/最特别
// 形式：9:16 竖版长图（1080×1920 Canvas），可存相册晒朋友圈/小红书（自带 S2 品牌水印）
// 数据全部端上聚合 store.listTickets()，无新增云函数。
// ============================================================
const store = require('../../utils/store.js');
const themeUtil = require("../../utils/theme.js");
const pay = require('../../utils/pay.js');   // 署名：昵称 → 报告尾款
const track = require('../../utils/track.js'); // 埋点

const RW = 1080, RH = 1920;
// 调色（年报固定「纸感浅色」视觉，不随主题变化——导出图统一质感）
const C = {
  paper: '#F4EFE6', card: '#FFFDF8', ink: '#2B2420',
  inkSoft: '#6B5F52', faint: '#B3A690', accent: '#E0532F', gold: '#C9A24B'
};

/** 千分位金额（iOS toLocaleString 不稳，手写） */
function fmtN(n) {
  const s = String(Math.round(Number(n) || 0));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function wrapText(ctx, text, maxW, maxLines) {
  const lines = [];
  let line = '';
  for (const ch of String(text || '')) {
    if (ctx.measureText(line + ch).width > maxW) {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines) return lines;
    } else line += ch;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.length ? lines : [''];
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 数字卡（宫格） */
function statCard(ctx, x, y, w, h, num, unit, label, numColor) {
  ctx.fillStyle = C.card;
  ctx.save();
  ctx.shadowColor = 'rgba(43,36,32,0.10)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, x, y, w, h, 24);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(196,98,58,0.25)';
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 24);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = numColor || C.accent;
  ctx.font = '800 72px serif';
  ctx.fillText(num, x + w / 2, y + 88);
  ctx.fillStyle = C.inkSoft;
  ctx.font = '24px sans-serif';
  ctx.fillText(unit, x + w / 2 + ctx.measureText(num).width / 2 + 12, y + 88 - 6);
  ctx.fillStyle = C.faint;
  ctx.font = '26px sans-serif';
  ctx.fillText(label, x + w / 2, y + 132);
}

/** 「特别的票」entry 卡 */
function entryCard(ctx, x, y, w, h, tag, t) {
  ctx.fillStyle = C.card;
  ctx.save();
  ctx.shadowColor = 'rgba(43,36,32,0.08)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, x, y, w, h, 20);
  ctx.fill();
  ctx.restore();

  // 左侧标签徽章
  ctx.fillStyle = C.accent;
  roundRect(ctx, x + 26, y + 34, 96, 44, 10);
  ctx.fill();
  ctx.fillStyle = '#FFF6E8';
  ctx.font = '600 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(tag, x + 26 + 48, y + 65);

  // 票名（右区）
  ctx.textAlign = 'left';
  ctx.fillStyle = C.ink;
  ctx.font = '600 32px serif';
  const title = wrapText(ctx, String(t.title || '无题票根'), w - 170, 1)[0];
  ctx.fillText(title, x + 148, y + 58);
  // 日期 · 城市
  ctx.fillStyle = C.inkSoft;
  ctx.font = '24px sans-serif';
  const sub = `${String(t.date || '').replace(/-/g, '.')}${t.city ? ' · ' + t.city : ''}${t.price ? ' · ¥' + fmtN(t.price) : ''}`;
  ctx.fillText(sub.slice(0, 30), x + 148, y + 102);
}

Page({
  data: {
    theme: 'a', legacyTheme: 'a',
    loading: true,
    empty: false,
    error: false,
    exporting: false,
    s: null
  },

  onShow() {
    themeUtil.apply(this);
    this._loadSignature(); // 4.20.3：署名异步到货，晚到只补 setData 重绘尾款
  },

  onReady() {
    this._ensureCanvas();
  },

  onLoad() {
    this.reload();
  },

  /** 拉全量票根 → 聚合年报指标（重试/首载同路） */
  async reload() {
    this.setData({ loading: true, empty: false, error: false });
    try {
      const raw = await store.listTickets();
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
      // 「最贵的一场」（有价才计入；无价回退最近一张）
      const priciest = ts.filter((t) => Number(t.price) > 0).reduce((m, t) => (!m || Number(t.price) > Number(m.price) ? t : m), null);
      const y0 = String(first.date).slice(0, 4);
      const y1 = String(last.date).slice(0, 4);
      const s = {
        total: ts.length,
        cost,
        cities: cities.size,
        shows,
        first,
        last,
        priciest,
        firstLabel: y0 === y1 ? `在 ${y0} 年攒下第一张，之后一张接一张` : `从 ${y0} 攒到 ${y1}，一路没停过`,
        range: y0 === y1 ? y0 : `${y0} — ${y1}`
      };
      this._s = s;
      this.setData({ loading: false, s });
      this.draw();
    } catch (e) {
      this.setData({ loading: false, error: true });
    }
  },

  goScan() {
    wx.redirectTo({ url: '/pages/scan/scan' });
  },

  // ---------- Canvas ----------
  _ensureCanvas() {
    if (this._canvas) return Promise.resolve(true);
    return new Promise((resolve) => {
      this.createSelectorQuery()
        .select('#annualCanvas')
        .fields({ node: true })
        .exec((res) => {
          const node = res && res[0] && res[0].node;
          if (!node) return resolve(false);
          const dpr = Math.min((wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2, 3);
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

  /** 绘制年报长图（数据就绪即画；画布未就绪自愈补画，同 card 4.22.4 模式） */
  draw() {
    const s = this._s;
    if (!s) return;
    if (!this._ctx) {
      this._ensureCanvas().then((ok) => { if (ok) this.draw(); });
      return;
    }
    this._render(s);
  },

  _render(s) {
    const ctx = this._ctx;
    const sig = this.data.signature || '';

    // —— 纸色底 + 顶部暖晕 ——
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, RW, RH);
    const halo = ctx.createRadialGradient(540, 60, 20, 540, 60, 640);
    halo.addColorStop(0, 'rgba(224,106,63,0.16)');
    halo.addColorStop(1, 'rgba(224,106,63,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, RW, 760);
    // 内衬细线
    ctx.strokeStyle = 'rgba(196,98,58,0.35)';
    ctx.lineWidth = 3;
    roundRect(ctx, 44, 44, RW - 88, RH - 88, 26);
    ctx.stroke();

    // —— 眉题 ——
    ctx.textAlign = 'center';
    ctx.fillStyle = C.inkSoft;
    ctx.font = '26px sans-serif';
    ctx.fillText('Y O U P I A O · A N N U A L', RW / 2, 170);

    // —— 大标题 ——
    ctx.fillStyle = C.ink;
    ctx.font = '800 92px serif';
    ctx.fillText('我的时光年报', RW / 2, 290);
    // 橘色短横线
    ctx.fillStyle = C.accent;
    roundRect(ctx, RW / 2 - 70, 330, 140, 10, 5);
    ctx.fill();

    // —— 副题 ——
    ctx.fillStyle = C.inkSoft;
    ctx.font = '30px sans-serif';
    ctx.fillText(`${s.range} · 共 ${s.total} 张票根`, RW / 2, 402);
    ctx.fillStyle = C.faint;
    ctx.font = '24px sans-serif';
    ctx.fillText(s.firstLabel, RW / 2, 444);

    // —— 四宫格数字卡 ——
    const gw = 426, gh = 210, gx = 88, gap = 30, gy = 512;
    statCard(ctx, gx, gy, gw, gh, String(s.total), '张', '收进票根', C.accent);
    statCard(ctx, gx + gw + gap, gy, gw, gh, '¥' + (s.cost > 0 ? fmtN(s.cost) : '0'), '', '票钱花了', C.ink);
    statCard(ctx, gx, gy + gh + 30, gw, gh, String(s.cities), '座', '点亮城市', '#6E8FB0');
    statCard(ctx, gx + gw + gap, gy + gh + 30, gw, gh, String(s.shows), '场', '现场演出', C.gold);

    // —— 「时光深处」三张特别的票 ——
    ctx.textAlign = 'left';
    ctx.fillStyle = C.ink;
    ctx.font = '700 40px serif';
    ctx.fillText('时光深处', 88, 1110);
    ctx.fillStyle = C.accent;
    roundRect(ctx, 88, 1136, 60, 8, 4);
    ctx.fill();

    let ey = 1180;
    entryCard(ctx, 88, ey, 904, 150, '最早', s.first); ey += 170;
    entryCard(ctx, 88, ey, 904, 150, '最近', s.last); ey += 170;
    entryCard(ctx, 88, ey, 904, 150, s.priciest ? '最贵' : '压轴', s.priciest || s.last); ey += 170;

    // —— 底部收尾：署名 + slogan + 品牌水印 ——
    ctx.textAlign = 'center';
    ctx.fillStyle = C.gold;
    ctx.font = '28px sans-serif';
    ctx.fillText('✦ · ✦ · ✦', RW / 2, 1700);
    ctx.fillStyle = C.ink;
    ctx.font = '600 34px serif';
    ctx.fillText('让时光有票为证', RW / 2, 1766);
    if (sig) {
      ctx.fillStyle = C.faint;
      ctx.font = 'italic 24px serif';
      ctx.fillText(`—— ${String(sig).slice(0, 10)} 的票根收藏册`, RW / 2, 1810);
    }
    // S2 品牌水印（右下角，转发自带品牌曝光）
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(156,143,128,0.78)';
    ctx.font = '22px sans-serif';
    ctx.fillText('@有票为证 · 你的时光档案馆', RW - 56, RH - 52);
  },

  /** 存相册：导出 → 保存（授权引导同 card/art） */
  async save() {
    if (!this._canvas || this.data.exporting) return;
    this.setData({ exporting: true });
    wx.showLoading({ title: '生成年报长图中…', mask: true });
    try {
      this.draw(); // 防署名晚到/尺寸未就绪：保存前强制重绘一次
      const res = await wx.canvasToTempFilePath({ canvas: this._canvas });
      await new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({ filePath: res.tempFilePath, success: resolve, fail: reject });
      });
      wx.hideLoading();
      wx.vibrateShort({ type: 'medium' });
      track.track('annual_save', { total: this._s ? this._s.total : 0 });
      wx.showToast({ title: '已存入相册', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      const msg = String((e && e.errMsg) || e.message || e);
      if (/auth/i.test(msg)) {
        wx.showModal({
          title: '需要相册权限',
          content: '保存年报需要「添加到相册」权限，请在设置中开启',
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

  onShareAppMessage() {
    const t = this._s;
    track.track('annual_share', { total: t ? t.total : 0 });
    const payload = {
      title: t ? `我的票根年报：${t.total} 张票 · ${t.cities} 座城 · 让时光有票为证` : '我的时光年报 · 有票为证',
      path: '/pages/annual/annual'
    };
    if (this._canvas) {
      payload.promise = wx.canvasToTempFilePath({ canvas: this._canvas })
        .then((r) => ({ imageUrl: r.tempFilePath }))
        .catch(() => ({}));
    }
    return payload;
  },

  /** 4.20.3 署名：昵称 → 报告尾款（晚到只补 setData；与 card 页同源） */
  _loadSignature() {
    pay.getProfile().then((p) => {
      const n = p && p.nickname ? String(p.nickname).trim() : '';
      this.setData({ signature: n }, () => { if (this._s && this.data.signature) this.draw(); });
    });
  }
});
