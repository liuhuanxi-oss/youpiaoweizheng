// pages/song/poster.js —— 生日歌单的分享图（1080×1920 竖版）
// ============================================================
// 【为什么是竖版 9:16】微信转发那两种尺寸（朋友圈 1:1、好友卡片 5:4）都不是这张图
//   的主要出路 —— 它主要被**存进相册**、再发小红书 / 抖音 / 群里，竖版最占屏。
//   所以按 1080×1920 出，微信转发时被裁掉上下两头也无所谓：
//   日期、歌名、理由、鼓励全压在中间那一段里（首尾只留装饰与水印）。
//
// 【本文件不 require 任何 wx.*】和 annual/poster.js 同一个理由：拆出来之后
//   tests/birthday_song.test.js 能用假的 ctx 真跑一遍版式 ——
//   不拆，画布代码就只能靠肉眼在真机上看，改一次盲一次。
// ============================================================
const { wrapText, roundRect, pinkedRect, watercolorBlob, drawStar4, drawSprig } = require('../../utils/canvas-deco.js');
const { CANVAS_TITLE: FT } = require('../../utils/font.js'); // 画布不认 CSS 变量，手写体只能这么拼

const RW = 1080, RH = 1920;
// 出图固定「纸感浅色」，不随主题走 —— 存进相册的图要质感统一（同 annual/poster.js）
const C = {
  paper: '#FAF5EE', ink: '#4A3B2E', soft: '#8A7B66', faint: '#B3A690',
  accent: '#C4623A', gold: '#B98D52', sage: '#A9C3A6', petal: '#E8AFA8', line: '#C9A469'
};
const SPRIG_PAL = { leaf: C.sage, petal: C.petal, gold: C.gold };

/**
 * 居中画一段会自动折行的文字。
 * @returns {number} 下一段的起始 y（版式顺流而下，歌名两行也不会压到底部）
 */
function block(ctx, text, y, o) {
  const size = o.size;
  ctx.font = (o.weight || 400) + ' ' + size + 'px ' + (o.title ? FT : 'sans-serif');
  ctx.fillStyle = o.color;
  const lines = wrapText(ctx, text, o.width || 820, o.maxLines || 2);
  const lh = Math.round(size * (o.lh || 1.5));
  lines.forEach((ln, i) => ctx.fillText(ln, RW / 2, y + i * lh));
  return y + lines.length * lh;
}

/** 一条带四角星的分隔线 */
function divider(ctx, y) {
  ctx.strokeStyle = 'rgba(201,164,105,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(RW / 2 - 210, y);
  ctx.lineTo(RW / 2 - 34, y);
  ctx.moveTo(RW / 2 + 34, y);
  ctx.lineTo(RW / 2 + 210, y);
  ctx.stroke();
  drawStar4(ctx, RW / 2, y, 15, C.line);
}

/**
 * 画整张分享图。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} v birthdaySong.match() 的结果，另加 v.artist（歌手名）
 */
function render(ctx, v) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // —— 纸底 + 两团水彩晕 + 齿边外框（与年度报告同一套视觉语言）——
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, RW, RH);
  watercolorBlob(ctx, 200, 340, 470, 'rgba(232,175,168,0.22)');
  watercolorBlob(ctx, 920, 1560, 450, 'rgba(169,195,166,0.20)');
  ctx.strokeStyle = 'rgba(201,164,105,0.7)';
  ctx.lineWidth = 3;
  pinkedRect(ctx, 32, 32, RW - 64, RH - 64, 34, 9);
  ctx.stroke();

  // 两支花枝压在底部两角（装饰溢出齿边框外，读起来像贴上去的）
  drawSprig(ctx, 118, 1806, 168, -0.55, false, SPRIG_PAL);
  drawSprig(ctx, 962, 1806, 168, 0.55, true, SPRIG_PAL);

  // —— 眉标 ——
  ctx.font = '26px sans-serif';
  ctx.fillStyle = C.soft;
  ctx.fillText((v.artist || '') + ' · 生日歌单', RW / 2, 128);

  // —— 日期 + 季节 ——
  ctx.font = '700 148px ' + FT;
  ctx.fillStyle = C.ink;
  ctx.fillText(v.m + ' / ' + v.d, RW / 2, 300);

  ctx.font = '30px sans-serif';
  const chipW = ctx.measureText(v.label).width + 62;
  ctx.fillStyle = 'rgba(196,98,58,0.10)';
  roundRect(ctx, RW / 2 - chipW / 2, 398, chipW, 62, 31);
  ctx.fill();
  ctx.fillStyle = C.accent;
  ctx.fillText(v.label, RW / 2, 430);

  // —— 歌名（主角：手写体 + 书名号，最多两行）——
  let y = block(ctx, '《' + v.song.t + '》', 570, {
    size: 88, weight: 700, title: true, color: C.ink, width: 880, lh: 1.35
  });
  y += 34;
  divider(ctx, y);
  y += 88;

  // —— 意象句 ——
  y = block(ctx, v.song.img, y, { size: 36, color: C.ink, width: 820, lh: 1.6 });
  y += 76;

  // —— 为什么是它（两句）——
  y = block(ctx, v.reasonA, y, { size: 29, color: C.soft, width: 780, lh: 1.6 });
  y += 18;
  y = block(ctx, v.reasonB, y, { size: 29, color: C.soft, width: 780, lh: 1.6 });
  y += 74;

  // —— 鼓励语：一张纸卡压在最后 ——
  ctx.font = '33px sans-serif';
  const cheerLines = wrapText(ctx, v.cheer, 700, 2);
  const cardH = cheerLines.length * 52 + 68;
  ctx.fillStyle = 'rgba(196,98,58,0.07)';
  roundRect(ctx, RW / 2 - 420, y, 840, cardH, 26);
  ctx.fill();
  ctx.fillStyle = C.accent;
  cheerLines.forEach((ln, i) => ctx.fillText(ln, RW / 2, y + 46 + i * 52));

  // —— 页脚：搜索词是唯一的拉新入口（别的平台跳不回小程序，只能手搜）——
  ctx.fillStyle = C.gold;
  ctx.font = '30px sans-serif';
  ctx.fillText('微信搜「有票为证」', RW / 2, 1666);
  ctx.fillStyle = 'rgba(156,143,128,0.78)';
  ctx.font = '22px sans-serif';
  ctx.fillText('@有票为证 · 你的时光档案馆', RW / 2, 1722);

  // 返回版式实际用到的底部 y：页脚是**固定**坐标，正文是顺流而下的 ——
  // 万一哪天加了首更长的歌名或更长的理由，就会压到页脚上，而图看上去只是「有点挤」。
  // 测试拿这个值守 366 天（见 tests/birthday_song.test.js），不必靠肉眼发现。
  return y + cardH;
}

module.exports = { render, RW, RH };
