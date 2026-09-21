// pages/annual/poster.js —— 年度回忆报告「分享海报」的 1080×1920 版式
// ============================================================
// 【为什么单独成文件】
//   海报要存相册、要当转发图，必须是一张真位图，只能画在 Canvas 上。把它从页面里拆出来，
//   scripts/dev/preview-annual.js 就能在 Node 里直接录成 SVG 核版式 ——
//   本机没有 node-canvas，不拆出来就只能盲改。
//
// 【它和页面（annual.wxml）的关系】
//   同一套视觉语言（齿边纸 / 水彩卡 / 齿边照片框 / 邮戳 / 花枝），但不是逐像素照搬：
//   页面是竖版长页（可以无限往下滚），海报是定长 1080×1920，留白节奏排不下就得压。
//
// 【约定】本文件不 require 任何 wx.* 模块，照片由调用方加载好后以 Image 传入。
// ============================================================
const { wrapText, roundRect, pinkedRect, watercolorBlob, drawStar4, drawHeart, drawSprig, drawTape } = require('../../utils/canvas-deco.js');
const { CANVAS_TITLE: FT } = require('../../utils/font.js'); // 画布字体：ctx.font 不认 CSS 变量，导出图里的手写体只能这么拼

const RW = 1080, RH = 1920;
// 海报调色（导出图固定「纸感浅色」视觉，不随主题变化——存进相册的图要质感统一）
const C = {
  paper: '#FAF5EE', card: '#FFFDF8', ink: '#4A3B2E', soft: '#8A7B66', faint: '#B3A690',
  rose: '#D9A0A6', roseD: '#C26B5E', sage: '#A9C3A6', sageD: '#7C9878',
  gold: '#E2B85C', butter: '#F6DFA8', line: '#C9A469', petal: '#E8AFA8'
};
// 拼贴里四张照片的倾角（手账是贴上去的，张张都正才会像表格）
const TILTS = [-3.4, 2.6, 2.2, -2.8];
const SPRIG_PAL = { leaf: C.sage, petal: C.petal, gold: C.gold };

/**
 * 画整张海报。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} v 视图数据
 *   v.y     年份字符串（标题与编号标签用）
 *   v.s     年度指标 {total, cities, ...}
 *   v.picks 年度精选（最多 4 张），每项 {im: Image|null, typeText}
 *   v.pm    邮戳（最多 2 枚），每项 {city, dd, mm, yy}
 *   v.no    编号标签上的数字串
 *   v.ai    AI 年度结语（两行）
 *   v.sig   署名（可空）
 */
function render(ctx, v) {
  const s = v.s || {};
  const picks = v.picks || [];
  const pm = v.pm || [];
  const ai = v.ai || [];
  const year = String(v.y || s.range || '');

  // —— 纸底 + 两团水彩晕 + 齿边外框 ——
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, RW, RH);
  watercolorBlob(ctx, 900, 180, 420, 'rgba(244,198,180,0.20)');
  watercolorBlob(ctx, 160, 1560, 420, 'rgba(169,195,166,0.18)');
  ctx.strokeStyle = 'rgba(201,164,105,0.75)';
  ctx.lineWidth = 3;
  pinkedRect(ctx, 30, 30, RW - 60, RH - 60, 34, 9);
  ctx.stroke();

  brand(ctx, year);
  title(ctx, year);
  stats(ctx, s);
  collage(ctx, picks, pm, v.no);
  closing(ctx, ai);
  foot(ctx, v.sig);

  // S2 品牌水印（右下角，转发自带品牌曝光）
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(156,143,128,0.78)';
  ctx.font = '22px sans-serif';
  ctx.fillText('@有票为证 · 你的时光档案馆', RW - 62, RH - 58);
}

/** 品牌行：玫瑰票根标 + 有票为证 + No.年份 标签 + 注销波浪 */
function brand(ctx, year) {
  const L = 100, X = 88, Y = 96;
  const g = ctx.createLinearGradient(X, Y, X + L, Y + L);
  g.addColorStop(0, '#F4C6B4');
  g.addColorStop(1, C.rose);
  ctx.fillStyle = g;
  roundRect(ctx, X, Y, L, L, 30);
  ctx.fill();
  // 标里那枚小白票根，票心上压一颗玫瑰星（红星压白比白星压白读得清）
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  roundRect(ctx, X + 20, Y + 26, L - 40, 48, 9);
  ctx.fill();
  drawStar4(ctx, X + L / 2, Y + L / 2, 13, 'rgba(217,160,166,0.95)');

  ctx.textAlign = 'left';
  ctx.fillStyle = C.ink;
  ctx.font = '700 46px ' + FT;
  ctx.fillText('有票为证', X + L + 26, Y + 66);

  // No. 年份 标签：奶油底 + 虚线内框，微微歪一点（手写标签的观感）
  const tw = 236, th = 62, tx = RW - 88 - tw - 118, ty = Y + 18;
  ctx.save();
  ctx.translate(tx + tw / 2, ty + th / 2);
  ctx.rotate(-0.028);
  ctx.fillStyle = C.butter;
  roundRect(ctx, -tw / 2, -th / 2, tw, th, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(107,91,80,0.5)';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 6]);
  roundRect(ctx, -tw / 2 + 8, -th / 2 + 8, tw - 16, th - 16, 6);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = C.ink;
  ctx.font = '600 34px ' + FT;
  ctx.textAlign = 'center';
  ctx.fillText('No.' + year, 0, 12);
  ctx.restore();

  // 注销波浪：从标签右侧延伸出去
  ctx.strokeStyle = 'rgba(194,107,94,0.75)';
  [0, 1, 2].forEach((i) => {
    ctx.lineWidth = 3 - i * 0.6;
    ctx.beginPath();
    const y = ty + 14 + i * 18;
    for (let k = 0; k <= 4; k++) {
      const x = tx + tw + 14 + k * 25;
      if (k === 0) ctx.moveTo(x, y); else ctx.quadraticCurveTo(x - 12, y - 6, x, y);
    }
    ctx.stroke();
  });
}

/** 大标题 + 玫瑰笔触 */
function title(ctx, year) {
  ctx.textAlign = 'center';
  ctx.fillStyle = C.ink;
  ctx.font = '800 82px ' + FT;
  ctx.fillText(`我的 ${year} 时光档案`, RW / 2, 330);
  ctx.fillStyle = 'rgba(217,160,166,0.55)';
  roundRect(ctx, RW / 2 - 230, 356, 460, 16, 8);
  ctx.fill();
}

/** 两张水彩统计卡：珍藏票根 / 走过城市 */
function stats(ctx, s) {
  const w = 440, h = 280, y = 420;
  statPanel(ctx, 88, y, w, h, '珍藏票根', String(s.total || 0), '张', C.roseD, ['#FBE4E5', '#F5D6D4'], C.rose);
  statPanel(ctx, RW - 88 - w, y, w, h, '走过城市', String(s.cities || 0), '座', C.sageD, ['#E8F0E1', '#D6E3CD'], C.sage);
}

/** 一张统计卡：齿边 + 水彩晕 + ✦ 标签 + 大数字 */
function statPanel(ctx, x, y, w, h, label, num, unit, tone, blotch, ink) {
  const g = ctx.createRadialGradient(x + w * 0.34, y + h * 0.26, 10, x + w * 0.34, y + h * 0.26, w * 0.92);
  g.addColorStop(0, blotch[0]);
  g.addColorStop(1, blotch[1]);
  ctx.fillStyle = g;
  pinkedRect(ctx, x, y, w, h, 20, 5);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2.4;
  pinkedRect(ctx, x, y, w, h, 20, 5);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 标签：✦ + 文字（星点用画的，不塞字符）
  drawStar4(ctx, x + 48, y + 58, 15, C.gold);
  ctx.textAlign = 'left';
  ctx.fillStyle = tone;
  ctx.font = '600 34px ' + FT;
  ctx.fillText(label, x + 76, y + 70);

  // 数字：一个特别大的 + 一个小一号的单位（主次关系全在这两个字号上）
  ctx.fillStyle = tone;
  ctx.font = '800 150px ' + FT;
  ctx.fillText(num, x + 40, y + 236);
  const nw = ctx.measureText(num).width;
  ctx.font = '600 46px ' + FT;
  ctx.fillText(unit, x + 40 + nw + 12, y + 236);
}

/** 年度精选：玫瑰标签 + 2×2 齿边照片拼贴 + 两枚邮戳 + 编号标签 + 花枝 */
function collage(ctx, picks, pm, no) {
  if (!picks.length) return;

  // —— 「✦ 年度精选 ✦」玫瑰标签 ——
  ctx.save();
  ctx.translate(190, 758);
  ctx.rotate(-0.03);
  ctx.fillStyle = C.rose;
  roundRect(ctx, -132, -34, 264, 68, 10);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFF8F2';
  ctx.font = '700 38px ' + FT;
  ctx.fillText('年度精选', 0, 14);
  drawStar4(ctx, -104, 0, 13, '#FFF8F2');
  drawStar4(ctx, 104, 0, 13, '#FFF8F2');
  ctx.restore();
  drawStar4(ctx, RW - 120, 742, 18, C.gold);
  drawHeart(ctx, 62, 700, 13, 'rgba(217,142,155,0.8)');

  // —— 拼贴：两列两行，逐张歪一点、互相咬合 ——
  const fw = 432, fh = 300, gap = 40;
  const x0 = 88, y0 = 830;
  picks.slice(0, 4).forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const cx = x0 + col * (fw + gap) + fw / 2;
    const cy = y0 + row * (fh + 44) + fh / 2;
    photoFrame(ctx, p, cx, cy, fw, fh, TILTS[i] || 0);
  });

  // —— 邮戳：落在第 1 张右下角与第 3 张左下角（稿里两枚戳就是错开这两处） ——
  const spots = [
    { cx: x0 + fw - 46, cy: y0 + fh - 26, r: 62 },
    { cx: x0 + 62, cy: y0 + fh + 44 + fh - 42, r: 58 }
  ];
  pm.slice(0, 2).forEach((k, i) => postmark(ctx, spots[i].cx, spots[i].cy, spots[i].r, k));

  // —— 编号标签：压在第 2 张右下角 ——
  if (no) {
    ctx.save();
    ctx.translate(RW - 88 - 118, y0 + fh + 46);
    ctx.rotate(-0.02);
    ctx.fillStyle = '#FDF6E8';
    roundRect(ctx, -118, -28, 236, 56, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(217,160,166,0.9)';
    ctx.lineWidth = 2;
    roundRect(ctx, -118, -28, 236, 56, 8);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = C.roseD;
    ctx.font = '600 30px ' + FT;
    ctx.fillText('No. ' + no, 0, 11);
    ctx.restore();
  }
  drawSprig(ctx, 34, 1180, 96, -1.25, false, SPRIG_PAL);
  drawSprig(ctx, RW - 34, 1440, 96, -1.25, true, SPRIG_PAL);
}

/** 一张齿边白框照片：白框 → 照片 → 胶带（邮戳由 collage 统一画在最上层） */
function photoFrame(ctx, p, cx, cy, fw, fh, deg) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((deg * Math.PI) / 180);

  // 白框：齿边 + 一点投影（像是从整版邮票上撕下来的）
  ctx.save();
  ctx.shadowColor = 'rgba(74,59,46,0.20)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 9;
  ctx.fillStyle = C.card;
  pinkedRect(ctx, -fw / 2, -fh / 2, fw, fh, 18, 6);
  ctx.fill();
  ctx.restore();
  // 齿边描边要压得住白底才看得出「邮票边」（太淡会糊成一圈白边）
  ctx.strokeStyle = 'rgba(166,134,80,0.72)';
  ctx.lineWidth = 2.2;
  pinkedRect(ctx, -fw / 2, -fh / 2, fw, fh, 18, 6);
  ctx.stroke();

  // 照片：内缩 20 居中，无图则铺一块素色 + 类型文字
  const iw = fw - 40, ih = fh - 40;
  ctx.save();
  ctx.beginPath();
  ctx.rect(-iw / 2, -ih / 2, iw, ih);
  ctx.clip();
  ctx.fillStyle = '#E8DFD0';
  ctx.fillRect(-iw / 2, -ih / 2, iw, ih);
  if (p.im) {
    try { ctx.drawImage(p.im, -iw / 2, -ih / 2, iw, ih); } catch (e) { /* 图挂了就留素色底 */ }
  } else {
    ctx.fillStyle = 'rgba(107,91,80,0.35)';
    ctx.textAlign = 'center';
    ctx.font = '600 30px sans-serif';
    ctx.fillText(p.typeText || '票根', 0, 10);
  }
  ctx.restore();

  drawTape(ctx, -fw / 2 + 42, -fh / 2 + 6, -0.62, 96, 30, 'rgba(246,223,168,0.85)');
  ctx.restore();
}

/** 邮戳：双圈 + 城市 + 日/月/年 三行 + 一颗小星 + 注销波浪 */
function postmark(ctx, cx, cy, r, pm) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.12);
  ctx.strokeStyle = 'rgba(107,91,80,0.85)';
  ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = 0.6;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(74,59,46,0.9)';
  ctx.font = '600 20px sans-serif';
  ctx.fillText(String(pm.city || '').slice(0, 4), 0, -r * 0.18);
  ctx.font = '600 22px sans-serif';
  ctx.fillText(String(pm.dd || '--'), 0, r * 0.12);
  ctx.fillText(String(pm.mm || ''), 0, r * 0.44);
  ctx.fillText(String(pm.yy || ''), 0, r * 0.76);
  drawStar4(ctx, r * 0.5, r * 0.5, 7, 'rgba(107,91,80,0.7)');

  // 注销波浪：从圆环右沿往外拉
  ctx.strokeStyle = 'rgba(107,91,80,0.6)';
  [0, 1, 2].forEach((i) => {
    ctx.lineWidth = 2.2 - i * 0.5;
    const y = -r * 0.1 + i * r * 0.4;
    ctx.beginPath();
    for (let k = 0; k <= 3; k++) {
      const x = r + 12 + k * 22;
      if (k === 0) ctx.moveTo(x, y); else ctx.quadraticCurveTo(x - 11, y - 5, x, y);
    }
    ctx.stroke();
  });
  ctx.restore();
}

/** AI 年度结语卡：奶油底 + 左侧玫瑰带 + 标题下划线 + 两行正文 */
function closing(ctx, ai) {
  const x = 88, y = 1500, w = RW - 176, h = 200;
  ctx.save();
  ctx.shadowColor = 'rgba(74,59,46,0.14)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#FDF6E8';
  pinkedRect(ctx, x, y, w, h, 22, 5);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(201,164,105,0.5)';
  ctx.lineWidth = 2;
  pinkedRect(ctx, x, y, w, h, 22, 5);
  ctx.stroke();

  // 左侧玫瑰色带（从卡片左缘长出来的一条）
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, 54, h);
  ctx.clip();
  ctx.fillStyle = 'rgba(232,175,168,0.72)';
  pinkedRect(ctx, x, y, 54, h, 22, 5);
  ctx.fill();
  ctx.restore();
  drawSprig(ctx, x + 30, y + h - 34, 46, -1.3, false, SPRIG_PAL);

  ctx.textAlign = 'left';
  ctx.fillStyle = C.ink;
  ctx.font = '700 38px ' + FT;
  ctx.fillText('AI 年度结语', x + 92, y + 66);
  ctx.fillStyle = 'rgba(217,160,166,0.75)';
  roundRect(ctx, x + 92, y + 80, 172, 10, 5);
  ctx.fill();

  ctx.fillStyle = C.soft;
  ctx.font = '30px sans-serif';
  ai.slice(0, 2).forEach((ln, i) => {
    ctx.fillText(wrapText(ctx, ln, w - 190, 1)[0], x + 92, y + 132 + i * 42);
  });

  drawStar4(ctx, x + w - 150, y + 34, 12, C.gold);
}

/** 落款：署名 + slogan（署名异步到货，没有就不画那一行） */
function foot(ctx, sig) {
  ctx.textAlign = 'center';
  ctx.fillStyle = C.ink;
  ctx.font = '600 36px ' + FT;
  ctx.fillText('让时光有票为证', RW / 2, 1798);
  if (sig) {
    ctx.fillStyle = C.faint;
    ctx.font = 'italic 26px ' + FT;
    ctx.fillText(`—— ${String(sig).slice(0, 10)} 的年度档案`, RW / 2, 1844);
  }
}

module.exports = { render, RW, RH, C };
