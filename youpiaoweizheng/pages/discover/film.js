// pages/discover/film.js —— 回忆地图「一键成片」那张长图（8.1.0 拉新 3/6）
// ============================================================
// 【为什么单独成文件】同 pages/annual/poster.js 的理由：要存相册、要当转发图，
//   就必须是一张真位图，只能画在 Canvas 上。拆出来，它就成了一个纯函数 render(ctx, v)——
//   不碰 wx、不碰 setData，可以在 Node 里用一支「录画笔」真跑一遍（tests/map_film.test.js），
//   版式改坏、算出一个 NaN 的坐标，测试当场就红，而不是等用户存出来一张花图。
//
// 【图上画什么】三块：抬头（走过多少座城）、轨迹图、年表。
//   轨迹图**不是**地图页那张水彩中国的翻拍 —— 那张中国轮廓是 mapArt 拼出来的 SVG，
//   而 SVG **不能**喂给 canvas 的 drawImage（iOS 上画不出来，安卓/工具上又画得出来，
//   典型的「工具里看着好、真机空白」）。这里改用 canvas 自己的笔重画：
//     每座到过的城落一团同色的水彩晕（位置就是它在地图上那个落点），
//     再用一条线按到访先后把它们串起来。颜色在哪儿，你就去过哪儿 —— 说的是同一件事。
//
// 【调色不跟主题走】与年报海报一致（见 pages/annual/poster.js 的 C 那段）：
//   存进相册的图要质感统一，六套主题各出一个版本没有意义。这两份色值刻意各自持有一份。
// ============================================================
const { wrapText, roundRect, pinkedRect, watercolorBlob, drawStar4, drawSprig, safeDpr } =
  require('../../utils/canvas-deco.js');
const mapArt = require('../../utils/mapArt.js');

const C = {
  paper: '#FAF5EE', card: '#FFFDF8', ink: '#4A3B2E', soft: '#8A7B66', faint: '#B3A690',
  rose: '#D9A0A6', roseD: '#C26B5E', gold: '#E2B85C', line: '#C9A469', petal: '#E8AFA8',
  leaf: '#A9C3A6'
};
const PAD = 66;                 // 左右留白（与 mapFilm.sheet 的 750 宽配套）
const CITY_LABEL_MAX = 8;       // 轨迹图上最多给几座城写名字：城一多，小字就是糊住线的碎字
                                // （与地图页 PIN_LABEL_MAX 同一个道理，那边是怕压气泡）
const SPRIG_PAL = { leaf: C.leaf, petal: C.petal, gold: C.gold };

/** 十六进制 → rgba(...)：水彩晕要半透明，而 bubbleColor 给的是实色 */
function withAlpha(hex, a) {
  const h = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return 'rgba(217,160,166,' + a + ')'; // 兜不住的按品牌粉算
  const n = parseInt(h, 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

/**
 * 画整张长图。坐标全部来自 v.fit（utils/mapFilm.js 的 sheet 算好的版面），
 * 这里不自己算高度 —— 版面一旦两处各算一份，迟早对不上。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} v
 *   v.fit    版面 {w,h,masthead,map,list,foot}
 *   v.total  用户真走过的城市数（**全部**，不是图上画得下的那几座）
 *   v.cities 轨迹图与年表上的城（mapFilm.frames 的产物）
 *   v.span   年份跨度串（可能为空）
 *   v.tip    图底那句实话（可能为空）
 *   v.slogan 口号   v.brand 品牌名
 */
function render(ctx, v) {
  const d = v || {};
  const fit = d.fit;
  if (!fit || !ctx) return;                 // 没有版面就不画 —— 不猜一个尺寸出来
  const cities = (d.cities || []).filter((c) => c && c.city);
  const W = fit.w, H = fit.h;

  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  // 两团水彩底子，压在最下面（年报那张的同一支笔）
  watercolorBlob(ctx, W - 90, 150, 300, 'rgba(244,198,180,0.18)');
  watercolorBlob(ctx, 90, H - 160, 300, 'rgba(169,195,166,0.16)');
  ctx.strokeStyle = 'rgba(201,164,105,0.75)';
  ctx.lineWidth = 3;
  pinkedRect(ctx, 22, 22, W - 44, H - 44, 26, 8);
  ctx.stroke();

  masthead(ctx, d, fit, W);
  trail(ctx, cities, fit.map);
  if (cities.length <= CITY_LABEL_MAX) cityLabels(ctx, cities, fit.map);
  ledger(ctx, cities, d, fit);
  foot(ctx, d, fit, W);

  return { w: W, h: H };
}

/** 抬头：品牌 → 那句总结 → 年份跨度 */
function masthead(ctx, d, fit, W) {
  const b = fit.masthead;
  ctx.textAlign = 'center';
  ctx.fillStyle = C.soft;
  ctx.font = '24px sans-serif';
  ctx.fillText(String(d.brand || '有票为证'), W / 2, b.y + 78);

  ctx.fillStyle = C.ink;
  ctx.font = '600 46px serif';
  const total = Number(d.total) || 0;
  ctx.fillText(total ? '这些年，你走过 ' + total + ' 座城' : '这些年，你走过的路', W / 2, b.y + 156);

  // 年份跨度：一座有日期的城都没有时这条是空串 —— 不编年份
  if (d.span) {
    ctx.fillStyle = C.roseD;
    ctx.font = '30px serif';
    ctx.fillText(String(d.span), W / 2, b.y + 226);
  }
  drawStar4(ctx, PAD + 18, b.y + 148, 9, C.gold);
  drawStar4(ctx, W - PAD - 18, b.y + 172, 7, C.rose);
}

/** 轨迹图：每座城一团同色水彩晕 + 一条按到访先后串起来的线 + 落点 */
function trail(ctx, cities, box) {
  const k = box.w / mapArt.STAGE_W;                 // 舞台坐标 → 长图坐标
  const X = (x) => box.x + x * k;
  const Y = (y) => box.y + y * k;
  const pts = cities.map((c) => ({ x: X(c.x), y: Y(c.y), c: c }));

  // 底子：先铺一团浅色水彩代表「这片地方」
  watercolorBlob(ctx, box.x + box.w / 2, box.y + box.h / 2, box.w * 0.66, 'rgba(226,184,92,0.10)');

  // 每座城一团自己的颜色（就是地图上那颗气泡的颜色）
  pts.forEach((p) => {
    const col = p.c.color || mapArt.bubbleColor(p.c.city);
    watercolorBlob(ctx, p.x, p.y, 62, withAlpha(col, 0.34));
  });

  // 路线：按到访先后连起来。只有一座城时没有线可画
  if (pts.length >= 2) {
    ctx.save();
    ctx.strokeStyle = withAlpha(C.roseD, 0.85);
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  // 落点：白芯 + 同色圆环（与地图页 .dc-pin 一个样子）
  pts.forEach((p) => {
    const col = p.c.color || mapArt.bubbleColor(p.c.city);
    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

/**
 * 落点旁的城市名。只在城不多时画 —— 名字在下面的年表里一个不少，
 * 轨迹图上再写一遍，城一多就是压住线的一层碎字。
 */
function cityLabels(ctx, cities, box) {
  const k = box.w / mapArt.STAGE_W;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '22px sans-serif';
  cities.forEach((c) => {
    const x = box.x + c.x * k;
    const y = box.y + c.y * k + 34;     // 写在落点下方，避开圆环
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const w = ctx.measureText(c.city).width;
    ctx.fillRect(x - w / 2 - 6, y - 20, w + 12, 28);
    ctx.fillStyle = C.soft;
    ctx.fillText(c.city, x, y);
  });
  ctx.restore();
}

/** 年表：一年一座城一行，年份 · 城市 · 张数；末尾交代没画上来的城 */
function ledger(ctx, cities, d, fit) {
  const L = fit.list;
  const shown = cities.length;

  if (d.tip) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = C.faint;
    ctx.font = '22px sans-serif';
    const lines = wrapText(ctx, d.tip, fit.w - PAD * 2, 2);
    lines.forEach((ln, i) => ctx.fillText(ln, fit.w / 2, L.y - 26 + i * 30));
    ctx.restore();
  }

  cities.forEach((c, i) => {
    const y = L.y + i * L.rowH + L.rowH / 2;
    if (i) {                                  // 行与行之间的细分隔线
      ctx.save();
      ctx.strokeStyle = 'rgba(201,164,105,0.28)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(PAD, L.y + i * L.rowH);
      ctx.lineTo(fit.w - PAD, L.y + i * L.rowH);
      ctx.stroke();
      ctx.restore();
    }
    const col = c.color || mapArt.bubbleColor(c.city);
    drawStar4(ctx, PAD + 10, y, 7, withAlpha(col, 0.9));

    ctx.textAlign = 'left';
    ctx.fillStyle = C.faint;
    ctx.font = '26px sans-serif';
    ctx.fillText(c.year || '——', PAD + 34, y + 9);

    ctx.fillStyle = C.ink;
    ctx.font = '600 30px serif';
    ctx.fillText(c.city, PAD + 132, y + 10);

    ctx.textAlign = 'right';
    ctx.fillStyle = C.soft;
    ctx.font = '24px sans-serif';
    ctx.fillText(c.count ? c.count + ' 张' : '', fit.w - PAD, y + 9);
  });

  if (!shown) {   // 年表空着的时候也得说一句话，别留一块空白让人以为图坏了
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = C.faint;
    ctx.font = '26px sans-serif';
    ctx.fillText('还没有落到地图上的城市', fit.w / 2, L.y + 44);
    ctx.restore();
  }
}

/** 页脚：口号 + 花枝收尾 */
function foot(ctx, d, fit, W) {
  const f = fit.foot;
  drawSprig(ctx, PAD + 20, f.y + f.h - 76, 74, -0.35, false, SPRIG_PAL);
  drawSprig(ctx, W - PAD - 20, f.y + f.h - 76, 74, Math.PI + 0.35, true, SPRIG_PAL);
  ctx.textAlign = 'center';
  ctx.fillStyle = C.ink;
  ctx.font = '600 34px serif';
  ctx.fillText(String(d.slogan || '让时光有票为证'), W / 2, f.y + 72);
  ctx.fillStyle = C.faint;
  ctx.font = '22px sans-serif';
  ctx.fillText('每一座城，都有一张票为证', W / 2, f.y + 116);
}

module.exports = { render, C, withAlpha, safeDpr, CITY_LABEL_MAX };
