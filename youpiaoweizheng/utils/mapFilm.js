// utils/mapFilm.js —— 回忆地图「一键成片」的编排（8.1.0 拉新 3/6）
// ============================================================
// 【这文件是什么】两张纯数字的桌子，都给「成片」这一件事用：
//   ① 播放：把地图上的城市排成「一站一站走过来」的顺序（frames）—— 入口该不该露（canPlay）
//   ② 长图：按城市数算出画布该多大（sheet）—— 真机上这张画布能不能建起来
//
// 【为什么单拎出来】这两件事错了都**不报错**：
//   - 顺序排错：用户看到的是一段和自己的记忆对不上的旅程，他会觉得「这 App 记错了」，
//     但界面上一切正常，日志里一个字都没有；
//   - 画布算错：iOS 单边超过 4096 直接建不起画布（表现为「保存失败」，重的会闪退），
//     而开发者工具的 dpr 固定是 2、屏幕又小，**永远越不了这条线** ——
//     又是一类「工具里看着好、真机出事」（同 utils/canvas-deco.js 顶部那段）。
//   所以它们必须是纯函数，能在 Node 里真跑真断言，而不是靠翻页面看。
//
// 【播放顺序按什么排】按「首次到访」的先后 —— 和地图上那条时光路线是同一个口径
//   （discover.js 的 ordered）。但只有日期还不够：同一年的几座城谁先谁后，取决于
//   输入顺序，而输入顺序来自 byCity 这个 Map 的插入序，也就是「你哪张票先入库」——
//   那不是用户记得的顺序，而且**两次播放可能不一样**。故补第二把钥匙：城市名字典序。
//   同一天的行程本来就说不清先后，按名字排至少是稳定的。
//
// 【没有日期的城市排最后】票根可以没有日期（手填时留空）。那种城不参与「哪一年」
//   的叙事，但它是用户真去过的地方，不能丢 —— 排到最后，年份留空、界面上不画年份。
// ============================================================
const mapArt = require('./mapArt.js');

const YEAR_RE = /^(\d{4})/;
const MIN_STOPS = 2;          // 至少两站才「走得起来」：一座城播不出旅程
const FRAME_MS = 900;         // 每一站停留多久（播放编排与动画时长共用这一个数）

// —— 长图版面（逻辑像素，rpx 口径 750）——
// 这里的每个数都直接决定 sheet() 算出来的高度，而高度决定真机上的 dpr 会被夹到几倍。
// 改之前先看 sheet() 上面那段注释。
const SHEET_W = 750;
const MASTHEAD_H = 320;       // 顶部：品牌 + 「这些年，你走过 N 座城」+ 年份跨度
// 地图区宽度。500 时中国只占纸宽的 2/3，标题比它还宽 —— 地图是这张图的主角，
// 得压得住；560 是「再大就顶到 12 城时 dpr 2 那条 4096 的线」之前的值。
const MAP_W = 560;
const MAP_H = Math.round((MAP_W * mapArt.STAGE_H) / mapArt.STAGE_W);
const LIST_GAP = 56;          // 轨迹图与年表之间
const ROW_H = 68;             // 年表每座城一行
const FOOT_H = 170;           // 页脚：slogan + 品牌名
// 保险丝：年表行数的硬上限（上游 discover 已按 12 城封顶）。
// 12 行 = 1928 高，dpr 2 = 3856；超过 13 行就会撞上 iOS 单边 4096 那条线，
// safeDpr 会把倍率夹到 1（不崩，但存出来的图会软）。真到那一步要么调小 MAP_W、
// 要么承认「图会软一点」—— 别默默把行数放上去。
const MAX_ROWS = 20;

/** 票根日期串里的年份；取不到返回空串（不猜、不编） */
function yearOf(date) {
  const m = YEAR_RE.exec(String(date || ''));
  return m ? m[1] : '';
}

/** 一座城能不能进播放：要有名字，还要有落点（没有坐标的城在地图上根本画不出来） */
function stopOf(c) {
  return !!(c && c.city && Number.isFinite(Number(c.x)) && Number.isFinite(Number(c.y)));
}

/**
 * 能不能成片。两种情况下这个入口不该露：
 *   - **云兜底**（store 读失败时会兜底成演示票根）：那批城市不是用户去过的，
 *     拿它给他放一段「你走过的城」，等于对着假数据请他回忆 —— 同 utils/legacy.js 的理由；
 *   - **不足两座城**：一座城播不出旅程，一个站点的「成片」是自欺欺人。
 */
function canPlay(cities, flags) {
  if (flags && flags.netFallback) return false;
  return (cities || []).filter(stopOf).length >= MIN_STOPS;
}

/**
 * 站点序列：按首次到访先后排好，并补上 year（哪一年）与 n（第几站）。
 * 返回**新对象**，不改入参 —— discover 的 cities 还在页面上画着。
 */
function frames(cities) {
  return (cities || [])
    .filter(stopOf)
    .slice()
    .sort(byFirst)
    .map((c, i) => ({
      city: String(c.city),
      year: yearOf(c.first),
      count: Number(c.count) || 0,
      x: Number(c.x),
      y: Number(c.y),
      color: c.color || '',
      n: i + 1
    }));
}

/** 首次到访升序；没有日期的排最后；同日期再按城市名（否则同一年的几座城顺序会飘） */
function byFirst(a, b) {
  const da = String(a.first || '');
  const db = String(b.first || '');
  if (!da !== !db) return da ? -1 : 1;
  if (da !== db) return da < db ? -1 : 1;
  const ca = String(a.city);
  const cb = String(b.city);
  return ca < cb ? -1 : ca > cb ? 1 : 0;
}

/** 年份跨度：'2019 – 2026'；只有一年就只写那一年；一座有年份的城都没有则空串 */
function span(fs) {
  const ys = (fs || []).map((f) => f.year).filter(Boolean).sort();
  if (!ys.length) return '';
  const a = ys[0], b = ys[ys.length - 1];
  return a === b ? a : a + ' – ' + b;
}

/**
 * 长图尺寸与版面（逻辑像素）。
 * 【为什么要在这里就夹住】iOS 上画布单边超过 4096 直接建不起来 —— 真机表现为
 * 「保存失败」，重的会闪退；而开发者工具的 dpr 是 2、屏幕又小，永远越不了线。
 * 12 城时本图高 1928：dpr 2 得 3856（安全），dpr 3 得 5784（要回夹到 2）。
 * 回夹交给 utils/canvas-deco.js 的 safeDpr —— 这里只保证**逻辑尺寸**本身别失控。
 * @param {number} rows 年表行数（= 图上真画出来的城市数）
 */
function sheet(rows) {
  const n = Math.max(1, Math.min(Math.floor(Number(rows) || 0) || 1, MAX_ROWS));
  const mapY = MASTHEAD_H + 24;
  const listY = mapY + MAP_H + LIST_GAP;
  return {
    w: SHEET_W,
    h: listY + n * ROW_H + FOOT_H,
    rows: n,
    masthead: { x: 0, y: 0, w: SHEET_W, h: MASTHEAD_H },
    map: { x: Math.round((SHEET_W - MAP_W) / 2), y: mapY, w: MAP_W, h: MAP_H },
    list: { x: 0, y: listY, w: SHEET_W, h: n * ROW_H, rowH: ROW_H },
    foot: { x: 0, y: listY + n * ROW_H, w: SHEET_W, h: FOOT_H }
  };
}

module.exports = {
  canPlay, frames, span, sheet, yearOf,
  MIN_STOPS, FRAME_MS, MAX_ROWS, SHEET_W, MAP_W, MAP_H
};
