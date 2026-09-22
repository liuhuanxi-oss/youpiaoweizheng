// utils/trip.js —— 8.4.0「这一趟」：从一张票圈出前后那几天
// ============================================================
// 【这文件是什么】纯函数。给一张票，算出「这一趟」是哪几张、从哪天到哪天、几座城。
//
// 【为什么单拎出来】它错了**只有看图才知道**，而那张图是要存进相册的：
//   圈错了范围 → 图上多出几张根本不是这一趟的票，用户不会去核对，只会觉得这 App 记错了；
//   日子算错 → 抬头那句「9月28日 — 10月1日 · 4 天」是**我们替他断言的**，多一天就是说了句假话。
//   分开成纯函数才能在 Node 里真跑起来断言（tests/trip.test.js 开头列了四条）。
//
// 【为什么是「前后各 3 天」而不是自动聚类】聚类有传递性：这一趟接上下一趟，
//   最后能把一整年连成一段 —— 那不是一段回忆，是一锅粥。固定窗口的边界说得出口，
//   用户也看得懂「为什么是这几张」。与 utils/mapFilm.js 的 canPlay 同一个路子：宁可少圈，不许乱圈。
//
// 【日子怎么算】只算「日历上的日期差」：用户填的是 2025-10-01，到哪儿都是这一天，
//   所以用 Date.UTC 构造再相减，不碰时区（memory.js 的 bjDay 那套是给「此刻」用的，这里不是此刻）。
// ============================================================
const { normCity } = require('./citybook.js'); // 城市归一只此一份，「武汉」与「武汉市」不许算两座

const SPAN_DAYS = 3;   // 这张票前后各几天算「同一趟」
const MAX_PHOTOS = 6;  // 图上最多贴几张
const DAY = 86400000;

/** 'YYYY-MM-DD' → 第几天（1970 起算）；填得不像话的返回 null（不猜、不顺延） */
function dayNum(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s == null ? '' : s).trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  // 回读校验：'2025-13-45'、'2025-02-30' 这类会被 Date 悄悄顺延成另一个日子，回读就对不上
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.round(t / DAY);
}

/** 第几天 → 'YYYY-MM-DD'（from/to 一律走这里，别直接抄票上的原串） */
function ymd(n) {
  const d = new Date(n * DAY);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

/**
 * 从一张票出发，圈出「这一趟」
 * @param {Array} all 全部票根
 * @param {String} id 出发的那张票
 * @param {Number} [span] 前后各几天（默认 3）
 * @param {Object} [flags] { netFallback } 云兜底时一律不成图
 * @returns {{ok:boolean, reason:string, anchor:Object|null, items:Array, total:number,
 *            from:string, to:string, days:number, cities:number, capped:boolean}}
 *   reason：'' 可以 / 'demo' 演示票根 / 'no-anchor' 没这张票 / 'no-date' 这张票没日期 / 'alone' 就这一张
 *   items 按日期升序；超过 MAX_PHOTOS 时保头保尾均匀取样，此时 capped 为真
 *   total / from / to / days / cities 描述的是**整趟**（不是图上那几张）—— 抬头要说的实话
 */
function tripOf(all, id, span, flags) {
  const no = (reason, anchor) => ({
    ok: false, reason, anchor: anchor || null, items: [],
    total: 0, from: '', to: '', days: 0, cities: 0, capped: false
  });

  // 演示票根是别人的旅程，拿它拼一张「你的这一趟」是最坏的一种错
  if (flags && flags.netFallback) return no('demo');

  const list = Array.isArray(all) ? all : [];
  const anchor = list.filter((t) => t && t.id === id)[0] || null;
  if (!anchor) return no('no-anchor');
  const a = dayNum(anchor.date);
  if (a == null) return no('no-date', anchor);

  const n = span > 0 ? span : SPAN_DAYS;
  // 没日期的票一律不参与 —— 它属于哪一天都不知道，凭什么是「这一趟」的
  const hit = list
    .map((t) => ({ t, d: t ? dayNum(t.date) : null }))
    .filter((x) => x.d != null && Math.abs(x.d - a) <= n)
    .sort((x, y) => x.d - y.d || String(x.t.id).localeCompare(String(y.t.id)));

  const total = hit.length;
  const from = ymd(hit[0].d), to = ymd(hit[total - 1].d);
  const cities = new Set();
  hit.forEach((x) => { const c = normCity(x.t.city); if (c) cities.add(c); });
  // dayNum 给的就是「第几天」，相减已经是天数 —— 别再除一次 DAY
  const head = { anchor, total, from, to, days: hit[total - 1].d - hit[0].d + 1, cities: cities.size };

  if (total < 2) return Object.assign(no('alone', anchor), head, { items: hit.map((x) => x.t) });

  // 超上限就均匀挑：图上第一张必须真的是第一张、最后一张真的是最后一张
  const capped = total > MAX_PHOTOS;
  let picked = hit;
  if (capped) {
    const idx = [];
    for (let i = 0; i < MAX_PHOTOS; i++) idx.push(Math.round((i * (total - 1)) / (MAX_PHOTOS - 1)));
    picked = idx.filter((v, i) => idx.indexOf(v) === i).map((i) => hit[i]);
  }

  return Object.assign({ ok: true, reason: '', capped, items: picked.map((x) => x.t) }, head);
}

// —— 抬头那两句话：图上要印出来给用户看的，所以也归这里，能测 ——

/** '2025-09-28' → '9月28日'（同一年里不写年份，那是噪音；跨年才写） */
function md(s) {
  const p = String(s || '').split('-').map(Number);
  return p[1] + '月' + p[2] + '日';
}

/** 日期跨度：「9月28日 — 10月4日」；同一天只写一个；跨年两边都带年 */
function spanText(from, to) {
  if (!from || !to) return '';
  if (from === to) return md(from);
  const y1 = +String(from).slice(0, 4), y2 = +String(to).slice(0, 4);
  const same = y1 === y2;
  return (same ? '' : y1 + '年') + md(from) + ' — ' + (same ? '' : y2 + '年') + md(to);
}

/** 统计行：「7 天 · 4 张票 · 2 座城」。同一天的不说「1 天」（那是句废话）；一座城都没填就不说城 */
function statText(r) {
  const parts = [r.days > 1 ? r.days + ' 天' : '同一天', r.total + ' 张票'];
  if (r.cities > 0) parts.push(r.cities + ' 座城');
  return parts.join(' · ');
}

module.exports = { tripOf, spanText, statText, SPAN_DAYS, MAX_PHOTOS };
