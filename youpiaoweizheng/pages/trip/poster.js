// pages/trip/poster.js —— 8.4.0「这一趟」回忆图的 1080×1440 版式
// ============================================================
// 【这文件是什么】把「这一趟」的几张票画成一张 3:4 的图（小红书竖图尺寸，也是存相册最舒服的比例）。
//
// 【为什么单独成文件】和年度海报同一个理由：要存相册就得是真位图，只能画在 Canvas 上。
//   拆出来 tests/trip_poster.test.js 才能在假画布上真跑一遍 —— 图错了是看不出来的，
//   跑一遍至少能钉住「该有的字都画了」「没画到画布外」「正文没压到页脚」。
//
// 【它和年度海报（pages/annual/poster.js）的关系】同一套纸感语言，积木直接复用
//   照片框与邮戳（那边已导出）。区别只有尺寸与内容：那边是「一年」（4 张精选 + AI 结语），
//   这边是「一趟」（最多 6 张 + 一句都不用 AI 写的老实话）。
//
// 【图上不留白说】所有文字都是数据里有的：日期跨度、张数、城市数、张数上限。
//   一个字的 AI 文案都没有 —— 不花钱、人人可用，也不会替用户编出一段他没经历过的旅程。
// ============================================================
const { roundRect, pinkedRect, watercolorBlob, drawStar4, drawSprig } = require('../../utils/canvas-deco.js');
const { CANVAS_TITLE: FT } = require('../../utils/font.js'); // ctx.font 不认 CSS 变量，导出图的手写体只能这么拼
const { photoFrame, postmark, C } = require('../annual/poster.js'); // 纸感积木复用：同一种白框照片、同一枚邮戳

const TW = 1080, TH = 1440;

// 照片区：2 列，最多 3 行（MAX_PHOTOS=6）。这几个数改一个就要顺一遍 tests/trip_poster.test.js
const FW = 432, FH = 284, GAP_X = 40, GAP_Y = 40, COL_X0 = 88;
const GRID_TOP = 390, GRID_BOTTOM = 1330;
const TILTS = [-3.0, 2.4, -2.0, 3.0, -2.6, 2.2];

/**
 * 画整张图。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} v 视图数据
 *   v.head 日期跨度（utils/trip.js 的 spanText）
 *   v.stat 统计行（utils/trip.js 的 statText）
 *   v.items 图片上的那几张，每项 {im: Image|null, typeText, city, date}
 *   v.total 这一趟的真实张数（图里挑过时用来说实话）
 *   v.capped 是否挑过
 *   v.sig 署名（可空）
 * @returns {number} 照片区的底部 y（测试拿它断「没压到页脚」）
 */
function render(ctx, v) {
  const items = (v.items || []).slice(0, 6);

  // —— 纸底 + 两团水彩晕 + 齿边外框（与年度海报同一套）——
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, TW, TH);
  watercolorBlob(ctx, 880, 160, 380, 'rgba(244,198,180,0.20)');
  watercolorBlob(ctx, 170, 1180, 380, 'rgba(169,195,166,0.18)');
  ctx.strokeStyle = 'rgba(201,164,105,0.75)';
  ctx.lineWidth = 3;
  pinkedRect(ctx, 30, 30, TW - 60, TH - 60, 34, 9);
  ctx.stroke();

  // —— 抬头：这一趟 / 从哪天到哪天 / 几张几座城 ——
  ctx.textAlign = 'center';
  ctx.fillStyle = C.ink;
  ctx.font = '800 84px ' + FT;
  ctx.fillText('这一趟', TW / 2, 150);
  drawStar4(ctx, TW / 2 - 190, 118, 15, C.gold);
  drawStar4(ctx, TW / 2 + 190, 118, 15, C.gold);

  ctx.fillStyle = C.roseD;
  ctx.font = '600 42px ' + FT;
  ctx.fillText(String(v.head || ''), TW / 2, 222);

  ctx.fillStyle = C.soft;
  ctx.font = '500 30px ' + FT;
  ctx.fillText(String(v.stat || ''), TW / 2, 286);

  ctx.fillStyle = C.rose;
  roundRect(ctx, TW / 2 - 160, 310, 320, 8, 4);
  ctx.fill();

  // 挑过图才说 —— 图上只有 6 张，抬头报的是整趟，这一句把差额交代清楚
  if (v.capped) {
    ctx.fillStyle = C.faint;
    ctx.font = '500 24px ' + FT;
    ctx.fillText('这一趟共 ' + (v.total || items.length) + ' 张，图里挑了 6 张', TW / 2, 358);
  }

  // —— 照片：2 列铺开，整块在照片区里垂直居中（1 行时不会挤在顶上）——
  const rows = Math.ceil(items.length / 2);
  const blockH = rows * FH + (rows - 1) * GAP_Y;
  const y0 = GRID_TOP + (GRID_BOTTOM - GRID_TOP - blockH) / 2;

  items.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const cx = COL_X0 + col * (FW + GAP_X) + FW / 2;
    const cy = y0 + row * (FH + GAP_Y) + FH / 2;
    photoFrame(ctx, p, cx, cy, FW, FH, TILTS[i] || 0);
  });

  // 邮戳：压在第一张右下角，内容取第一张的城与日子（有城市才盖 —— 没填城就留白）
  const first = items[0] || {};
  const city = String(first.city || '').slice(0, 4);
  if (items.length) {
    const d = String(first.date || '').split('-');
    postmark(ctx, COL_X0 + FW - 46, y0 + FH - 26, 58, {
      city,
      dd: d[2] || '--',
      mm: d[1] ? d[1] + '月' : '',
      yy: d[0] ? d[0] + '年' : ''
    });
  }

  drawSprig(ctx, 40, 1300, 88, -1.25, false, { leaf: C.sage, petal: C.petal, gold: C.gold });
  drawSprig(ctx, TW - 40, 1300, 88, -1.25, true, { leaf: C.sage, petal: C.petal, gold: C.gold });

  // —— 落款 ——
  if (v.sig) {
    ctx.textAlign = 'center';
    ctx.fillStyle = C.faint;
    ctx.font = 'italic 26px ' + FT;
    ctx.fillText('—— ' + String(v.sig).slice(0, 10), TW / 2, 1362);
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = C.ink;
  ctx.font = '600 34px ' + FT;
  ctx.fillText('让时光有票为证', TW / 2, 1408);

  // S2 品牌水印（转发自带品牌曝光，与年度海报同一句）
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(156,143,128,0.78)';
  ctx.font = '20px sans-serif';
  ctx.fillText('@有票为证 · 你的时光档案馆', TW - 58, TH - 52);

  return y0 + blockH;
}

module.exports = { render, TW, TH, C, FW, FH, GRID_BOTTOM };
