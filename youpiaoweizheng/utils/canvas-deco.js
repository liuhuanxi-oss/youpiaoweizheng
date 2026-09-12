// utils/canvas-deco.js —— Canvas 手绘工具（卡面 / 年报长图共用的那几支笔）
// ============================================================
// 【为什么单独成文件】
//   纪念卡片（pages/card）与年度回忆报告（pages/annual）画的是同一套语言：
//   齿边、白框、花枝、星点、水彩晕。原先这些都长在 card.js 里，年报要用就得抄一份 ——
//   两份「一样的齿边」早晚会改歪一边。故把与业务无关的纯画笔收在这里。
//
// 【约定】本文件不 require 任何 wx.* 模块，可在 Node 里直接跑 ——
//   scripts/dev/preview-card.js 正是靠这一点把卡面录成 SVG 核版的。
//   颜色一律由调用方传入（画布读不到 CSS 变量，也读不到主题变量）。
// ============================================================

/** 按最大宽度与最大行数折行（CJK 逐字断行；返回的数组至少有一个元素） */
function wrapText(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let line = '';
  for (const ch of String(text || '')) {
    if (ctx.measureText(line + ch).width > maxWidth) {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines) return lines;
    } else {
      line += ch;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.length ? lines : [''];
}

/** 圆角矩形路径（闭合，顺时针） */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * 齿孔矩形 → Canvas 路径（闭合，顺时针）。
 * 与 utils/deco.js 的 pinkedPath 是同一套走齿逻辑，区别只在这里产出的是画笔路径、
 * 那边产出的是 SVG 的 d 串——卡面要导出成图，只能画在画布上。
 * @param {number} tooth 齿距  @param {number} amp 齿高（半个峰谷）
 */
function pinkedRect(ctx, x, y, w, h, tooth, amp) {
  const cmds = [];
  /**
   * 沿一条边走齿：每一齿用一段二次曲线，控制点探到边外/边内 ±amp 交替 ——
   * 齿顶被磨圆，读起来是「手撕的毛边」而不是「锯齿」。
   * （deco.js 的 pinkedPath 走的是折线版本：那边是细描边的画框，圆角反而糊。）
   */
  const seg = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const n = Math.max(2, Math.round(len / tooth));
    const nx = (-dy / len) * amp, ny = (dx / len) * amp;
    for (let i = 0; i < n; i++) {
      const k = i % 2 ? -1 : 1;
      cmds.push(['Q',
        ax + (dx * (i + 0.5)) / n + nx * k, ay + (dy * (i + 0.5)) / n + ny * k,
        ax + (dx * (i + 1)) / n, ay + (dy * (i + 1)) / n]);
    }
  };
  seg(x, y, x + w, y);
  seg(x + w, y, x + w, y + h);
  seg(x + w, y + h, x, y + h);
  seg(x, y + h, x, y);
  ctx.beginPath();
  ctx.moveTo(x, y);
  cmds.forEach((c) => ctx.quadraticCurveTo(c[1], c[2], c[3], c[4]));
  ctx.closePath();
}

/** 水彩晕染：中心实、边缘散的径向渐变色斑 */
function watercolorBlob(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** 四角星（稿里散在画面上的小星点） */
function drawStar4(ctx, x, y, r, color) {
  const w = r * 0.34;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + w, y - w, x + r, y);
  ctx.quadraticCurveTo(x + w, y + w, x, y + r);
  ctx.quadraticCurveTo(x - w, y + w, x - r, y);
  ctx.quadraticCurveTo(x - w, y - w, x, y - r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 小爱心（稿里散在画面上的点缀） */
function drawHeart(ctx, x, y, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.72);
  ctx.bezierCurveTo(x - r * 1.5, y - r * 0.35, x - r * 0.5, y - r * 1.15, x, y - r * 0.28);
  ctx.bezierCurveTo(x + r * 0.5, y - r * 1.15, x + r * 1.5, y - r * 0.35, x, y + r * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 和纸胶带：半透明斜色带（手账贴照片的灵魂） */
function drawTape(ctx, x, y, angle, w, h, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

/**
 * 花枝（绿叶 + 粉花）：稿里长在画面角上的那几枝。
 * @param {number} len 茎长  @param {number} angle 茎的朝向（弧度）
 * @param {boolean} flip 左右镜像（右下角那枝用）
 * @param {object} [pal] {leaf, petal, gold} 缺省取品牌标准色
 */
function drawSprig(ctx, x, y, len, angle, flip, pal) {
  const p = pal || {};
  const leaf = p.leaf || '#A9C3A6';
  const petal = p.petal || '#E8AFA8';
  const gold = p.gold || '#E2B85C';
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);
  ctx.rotate(angle);
  ctx.strokeStyle = leaf;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.45, -len * 0.16, len, -len * 0.5);
  ctx.stroke();
  // 三对叶：沿茎两侧交替，越往上越小
  ctx.fillStyle = leaf;
  [[0.28, 1], [0.52, -1], [0.74, 1]].forEach(([k, side]) => {
    const lx = len * k, ly = -len * (k * 0.5);
    const r = len * 0.15 * (1 - k * 0.45);
    ctx.beginPath();
    ctx.ellipse(lx + side * r * 0.7, ly - r * 0.5, r, r * 0.58, side * 0.7, 0, Math.PI * 2);
    ctx.fill();
  });
  // 顶端一朵五瓣小花 + 金心
  ctx.fillStyle = petal;
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.translate(len, -len * 0.5);
    ctx.rotate((i * Math.PI * 2) / 5);
    ctx.beginPath();
    ctx.ellipse(0, -len * 0.09, len * 0.07, len * 0.095, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = gold;
  ctx.beginPath(); ctx.arc(len, -len * 0.5, len * 0.055, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

module.exports = {
  wrapText, roundRect, pinkedRect, watercolorBlob,
  drawStar4, drawHeart, drawSprig, drawTape
};
