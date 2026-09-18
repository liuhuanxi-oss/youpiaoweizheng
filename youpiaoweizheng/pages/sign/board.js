// pages/sign/board.js —— 立牌那张图的画笔（8.1.0 拉新 4/6）
// ============================================================
// 【为什么单独成文件】同 pages/discover/film.js 的理由：要存相册就必须是一张真位图，
//   只能画在 Canvas 上。拆出来它就成了一个纯函数 render(ctx, v) —— 不碰 wx、不碰 setData，
//   可以在 Node 里用一支「录画笔」真跑一遍（tests/sign_board.test.js），
//   字号算错、坐标算出 NaN、码压到标题上，测试当场就红。
//
// 【码没到位就不画码】不画一个假的方块冒充小程序码 —— 印出来就是个扫不动的黑块，
//   而用户直到贴在门口都不会发现。没码就空着，并且页面上不给存（见 sign.js 的 save）。
//
// 【调色不跟主题走】同 pages/annual/poster.js 与 pages/discover/film.js：
//   印出来的东西质感要统一，六套主题各印一版没有意义。这三份色值刻意各自持有一份。
// ============================================================
const { wrapText, roundRect, pinkedRect, watercolorBlob, drawStar4 } =
  require('../../utils/canvas-deco.js');
const board = require('../../utils/signBoard.js');

const C = {
  paper: '#FAF5EE', card: '#FFFDF8', ink: '#4A3B2E', soft: '#8A7B66', faint: '#B3A690',
  rose: '#D9A0A6', roseD: '#C26B5E', gold: '#E2B85C', line: '#C9A469',
  petal: '#E8AFA8', leaf: '#A9C3A6'
};

// 标题自动收字的底线：再小就站在两米外看不清了，宁可让用户自己删两个字。
const TITLE_MIN = 26;

/**
 * 量出来的标题字号。
 * 为什么不能只按 signBoard.titleSize 的分档走：那一档是按**中文字数**分的，
 * 而 16 个汉字的「2026 草莓音乐节·广州站」与 16 个「1」宽度差一倍 ——
 * 按字数算必然有一头溢出纸边。这里真量一遍，超了就每档收 2px 再量。
 * （这个错画出来之前看不出来：字冲出纸边不报错，只是被裁掉半行。）
 */
function fitTitle(ctx, text, maxW, base) {
  let size = base;
  while (size > TITLE_MIN) {
    ctx.font = 'bold ' + size + 'px sans-serif';
    if (ctx.measureText(String(text || '')).width <= maxW) break;
    size -= 2;
  }
  return size;
}

/** 居中画一行字（画布没有 CSS，每一行都要自己摆） */
function center(ctx, text, y, size, color, weight) {
  ctx.font = (weight ? weight + ' ' : '') + size + 'px sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(text == null ? '' : text), board.SIZE.w / 2, y);
}

/**
 * 画整张立牌。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} v
 *   v.title 场馆名 / 活动名（必填，已 sanitize）
 *   v.sub   号召语（已 sanitize，留空时调用方给默认值）
 *   v.qr    小程序码图（已 load 的 canvas Image；没就绪传 null → 码位留白）
 *   v.fit   版面（utils/signBoard.js 的 sheet()；不传就现算一份）
 *   v.dim   true = 标题画浅色占位（用户还没填名字）
 */
function render(ctx, v) {
  const d = v || {};
  const fit = d.fit || board.sheet();
  if (!ctx || !fit) return;                  // 没有版面就不画 —— 不猜一个尺寸出来
  const W = fit.w, H = fit.h;

  // ① 纸底 + 两团水彩晕（左上玫瑰、右下鼠尾草，压住四角的空）
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  watercolorBlob(ctx, 120, 180, 260, 'rgba(217,160,166,0.16)');
  watercolorBlob(ctx, W - 110, H - 220, 280, 'rgba(169,195,166,0.14)');

  // ② 齿边纸片（贴边一圈，与纸面同色系、只描一道浅边）
  pinkedRect(ctx, fit.frame.x, fit.frame.y, fit.frame.w, fit.frame.h,
    fit.frame.tooth, fit.frame.amp);
  ctx.fillStyle = C.card;
  ctx.fill();
  ctx.strokeStyle = 'rgba(201,164,105,0.32)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // ③ 品牌区：名字 + 一行小口号，两侧各一颗小星
  center(ctx, board.BRAND, fit.brand.y + fit.brand.h / 2, 26, C.roseD, 'bold');
  center(ctx, board.SLOGAN, fit.slogan.y + fit.slogan.h / 2, 18, C.faint);
  const starY = fit.brand.y + fit.brand.h / 2;
  drawStar4(ctx, W / 2 - 132, starY, 11, C.gold);
  drawStar4(ctx, W / 2 + 132, starY, 11, C.gold);

  // ④ 主标题：先按字数取一档（见 signBoard.titleSize），再量一遍收进纸宽。
  //    d.dim = 用户还没填名字，画的是浅色占位（与输入框的 placeholder 同义）——
  //    占位色与真标题必须一眼能分开，否则用户会把占位当成已经填好的内容直接存走。
  const title = d.title || '';
  center(ctx, title, fit.title.y + fit.title.h / 2,
    fitTitle(ctx, title, fit.title.w, board.titleSize(title)),
    d.dim ? C.faint : C.ink, 'bold');

  // ⑤ 号召语：最多两行，行距 1.25
  const size = 26;
  ctx.font = size + 'px sans-serif';
  const lines = wrapText(ctx, d.sub || board.SUB_DEFAULT, fit.sub.w, 2);
  const lh = size * 1.25;
  const startY = fit.sub.y + (fit.sub.h - (lines.length - 1) * lh) / 2;
  lines.forEach((ln, i) => center(ctx, ln, startY + i * lh, size, C.soft));

  // ⑥ 小程序码：白底圆角块托着。**码没就绪就不画**（见文件头）
  const q = fit.qr;
  if (d.qr) {
    const pad = 16;
    roundRect(ctx, q.x - pad, q.y - pad, q.w + pad * 2, q.h + pad * 2, 20);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = 'rgba(201,164,105,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.drawImage(d.qr, q.x, q.y, q.w, q.h);
  }

  // ⑦ 码下说明 + 页脚
  center(ctx, board.SCAN_TIP, fit.tip.y + fit.tip.h / 2, 21, C.soft);
  center(ctx, board.BRAND + ' · ' + board.SLOGAN, fit.foot.y + fit.foot.h / 2, 17, C.faint);
}

module.exports = { render, C };
