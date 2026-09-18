// pages/discover/film.js —— 回忆地图「一键成片」那张长图（8.1.0 拉新 3/6）
// ============================================================
// 【为什么单独成文件】同 pages/annual/poster.js 的理由：要存相册、要当转发图，
//   就必须是一张真位图，只能画在 Canvas 上。拆出来，它就成了一个纯函数 render(ctx, v)——
//   不碰 wx、不碰 setData，可以在 Node 里用一支「录画笔」真跑一遍（tests/map_film.test.js），
//   版式改坏、算出一个 NaN 的坐标，测试当场就红，而不是等用户存出来一张花图。
//
// 【图上画什么】三块：抬头（走过多少座城）、地图、年表。
//   地图 = **同一份水彩中国**（国界与色块都是 mapArt 的数据，见下）+ 每座到过的城
//   一团同色水彩晕 + 一条按到访先后串起来的虚线 + 白芯落点。颜色在哪儿，你就去过哪儿。
//
// 【陆地怎么来的 —— 8.1.0 修】原先这里没画陆地，只有一堆圆环飘在空白纸上，
//   存下来的图看不出是哪儿。当初不画的理由是「SVG 不能喂给 canvas 的 drawImage」
//   —— 这条是对的（iOS 上画不出来，安卓/工具上又画得出来，典型的「工具里看着好、
//   真机空白」），但**结论下错了**：不能喂的是 landSrc() 产出的 SVG 字符串，
//   而陆地本身在 mapArt 里就是纯数据（96 个经纬度点 + 两座岛的闭合环 + 椭圆的色块）。
//   投影完 canvas 直接能画，于是改成画路径 —— 长图与页面用的是同一份国界。
//
// 【图上不写城市名】8.1.0 起不写。写过一版：小字按落点固定偏移，压在折线上，
//   城一挤就是一层白底碎字（页面上的气泡有 layoutBubbles 避让，那套是给气泡算的，
//   尺寸形状都不同，抄不过来）。城市名与年份、张数在下面的年表里一个不少 ——
//   图上只留落点，反而干净。
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
const SPRIG_PAL = { leaf: C.leaf, petal: C.petal, gold: C.gold };
// 陆地几何是**静态**的（国界、色块都写死在 mapArt 里），算一次就够 ——
// 每存一张图重算 96 个投影点没有意义。
const LAND = mapArt.stageLand();

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

  // 陆地：水彩中国（与页面上那张同源），画在晕与线下面
  land(ctx, box);

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
 * 一团椭圆水彩：外层大而淡、内层小而浓，边界于是「化」开而不是一刀切
 * （页面上 mapArt.regionSvg 就是这么两层的，这里同构）。
 * 椭圆与旋转靠画布变换实现 —— canvas-deco.watercolorBlob 只画正圆。
 */
function blobAt(ctx, r, box, k) {
  const rx = r.rx * k, ry = r.ry * k;
  if (!(rx > 0) || !(ry > 0)) return;
  [[1.16, 0.45], [0.88, 1]].forEach((pair) => {
    ctx.save();
    ctx.translate(box.x + r.x * k, box.y + r.y * k);
    ctx.rotate(((r.rot || 0) * Math.PI) / 180);
    ctx.scale(1, ry / rx);
    watercolorBlob(ctx, 0, 0, rx * pair[0], withAlpha(r.fill, r.op * pair[1]));
    ctx.restore();
  });
}

/**
 * 陆地：外晕（沿国界往外描两道淡边）→ 纸浆底 → 色块（裁在国界里）→ 内沿积色。
 * 几何与配色全部来自 mapArt.stageLand()，这里只负责画 —— 界在哪儿、色配成什么，
 * 与页面上那张水彩中国是同一份，不是各写一套。
 */
function land(ctx, box) {
  const k = box.w / mapArt.STAGE_W;
  const X = (p) => box.x + p[0] * k;
  const Y = (p) => box.y + p[1] * k;
  const trace = (pts) => {
    ctx.beginPath();
    ctx.moveTo(X(pts[0]), Y(pts[0]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i]), Y(pts[i]));
    ctx.closePath();
  };
  /** 内沿：颜料被水推到边沿积成的那道深圈 —— 「一眼看出这是块陆地」靠的是它 */
  const rim = (pts) => LAND.RIM.forEach((r) => {
    trace(pts);
    ctx.strokeStyle = withAlpha(LAND.rim, r.op);
    ctx.lineWidth = r.w * k;
    ctx.lineJoin = 'round';
    ctx.stroke();
  });

  ctx.save();
  ctx.lineJoin = 'round';
  LAND.BLEED.forEach((b) => {
    trace(LAND.border);
    ctx.strokeStyle = withAlpha(LAND.pulp, 0.2 * b.op);
    ctx.lineWidth = b.w * k;
    ctx.stroke();
  });
  trace(LAND.border);
  ctx.fillStyle = withAlpha(LAND.pulp, 0.9);
  ctx.fill();
  trace(LAND.border);
  ctx.clip();
  LAND.regions.forEach((r) => blobAt(ctx, r, box, k));
  rim(LAND.border);
  ctx.restore();

  // 两座岛各自带自己的裁剪圈：它们的经纬度落在国界路径**以外**，
  // 跟着大陆一起裁就是「代码里有、图上一个像素都没有」（页面上踩过这个坑）
  LAND.isles.forEach((isle) => {
    ctx.save();
    ctx.lineJoin = 'round';
    trace(isle.ring);
    ctx.fillStyle = withAlpha(LAND.pulp, 0.9);
    ctx.fill();
    ctx.clip();
    blobAt(ctx, isle.blob, box, k);
    rim(isle.ring);
    ctx.restore();
  });
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

module.exports = { render, C, withAlpha, safeDpr };
