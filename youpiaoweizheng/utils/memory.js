// utils/memory.js —— 7.4.0 R4 个性化回忆（只推「你自己的回忆」）
// ============================================================
// 【诚实原则】绝不编一句「去年的今天你在某地看了某场」——那是假的，用户一眼就能看出来。
// 【命中规则】同月同日 + 更早的年份（本年度的不算「那年」，它就在今年）。
//   多条命中取最近的那一年：去年的事比五年前更戳人，也更容易想起来。
// 【时间口径】固定 UTC+8，与云函数签到（pay.ymdNow）同一口径。
//   不取设备时区：不然手机时区一变，「今天」在签到里和在回忆里会不是同一天。
//
// 【8.1.5 每日一票：命中不了就降级，但降下去不能变成说假话】
//   只有一档「同月同日」时命中率极低，大多数日子整行不显示 —— 那等于没有这一行。
//   改成三级，越往下越宽，但**每一级都还是真话**：
//     ① 同月同日 + 更早年 → 「去年今天」/「N 年前的今天」（原来那一档，原样不动）
//     ② 同月 + 更早年     → 「去年这个月」/「N 年前的这个月」（同月不同日）
//     ③ 都不命中时轮换一张 → 「重温这一张」
//   ① ② 是日期上的真命中。③ 不是命中，所以**文案里不许出现任何日期** ——
//   一旦写成「去年这个月你在……」就又是编的了，这一条比命中率重要。
// ============================================================
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const DAY_MS = 86400000;
/** 档③的门槛：少于这么多张就别轮了 —— 天天翻到同一张，比这一行不显示更尬 */
const MIN_POOL = 5;

/** 北京时间的那一天：{ md: 'MM-DD', year: 2026 } */
function bjDay(now) {
  const d = new Date((now || Date.now()) + 8 * 3600 * 1000);
  return {
    md: `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
    year: d.getUTCFullYear()
  };
}

/**
 * 那年今天：从票根里挑出唯一的那一张。
 * @param {Array} ts 票根列表（date 形如 2024-09-13）
 * @param {number=} now 时间戳（测试注入用，缺省取当前）
 * @returns {{ticket:object, years:number, year:number}|null} 没命中返回 null
 */
function onThisDay(ts, now) {
  const day = bjDay(now);
  const hits = (ts || []).filter((t) => {
    const m = DATE_RE.exec(String((t && t.date) || ''));
    if (!m) return false;
    return `${m[2]}-${m[3]}` === day.md && Number(m[1]) < day.year;
  });
  if (!hits.length) return null;
  // 日期串是 YYYY-MM-DD，直接按字典序倒排 = 最近的年份排最前
  hits.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const t = hits[0];
  const y = Number(DATE_RE.exec(String(t.date))[1]);
  return { ticket: t, years: day.year - y, year: y };
}

/**
 * 8.1.5 档②：同月、但不同日的往年票。
 * 同日子的那种挡在外面 —— 它归档①管（要么已被挑走，要么是今年的新票，不算「那年」）。
 * 取法同档①：多条命中取最近的那一年。
 * @returns {{ticket:object, years:number, year:number}|null}
 */
function onThisMonth(ts, now) {
  const day = bjDay(now);
  const mm = day.md.slice(0, 2);
  const hits = (ts || []).filter((t) => {
    const m = DATE_RE.exec(String((t && t.date) || ''));
    if (!m) return false;
    return m[2] === mm && `${m[2]}-${m[3]}` !== day.md && Number(m[1]) < day.year;
  });
  if (!hits.length) return null;
  hits.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const t = hits[0];
  const y = Number(DATE_RE.exec(String(t.date))[1]);
  return { ticket: t, years: day.year - y, year: y };
}

/**
 * 8.1.5 档③：轮换着重温一张。
 * 不记「看过没看过」—— 那要新存储、新字段、还得跨设备同步，为一个每天换一张的效果不值。
 * 改用日期序数取模：同一天永远同一张，第二天换下一张，n 天正好轮完一遍不重样。
 * 池子按日期**升序**，也就是从最早那张开始一天往前走一张 —— 顺着自己的时间线走，
 * 比随机更像「重温」；首日也不会把用户刚拍的那张又摆到他眼前。
 * 序数按北京时间翻页（+8h 再整除），与 ①② 同一条口径，免得不在一档里的两处各说各话。
 * @returns {{ticket:object, years:number, year:number}|null} 池子不够大返回 null
 */
function pickRotate(ts, now) {
  const pool = (ts || [])
    .filter((t) => t && t.title && DATE_RE.test(String(t.date || '')))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (pool.length < MIN_POOL) return null;
  const dayNo = Math.floor(((now || Date.now()) + 8 * 3600 * 1000) / DAY_MS);
  const t = pool[((dayNo % pool.length) + pool.length) % pool.length];
  const y = Number(DATE_RE.exec(String(t.date))[1]);
  return { ticket: t, years: bjDay(now).year - y, year: y };
}

/** 展示文案：「去年今天」比「1 年前的今天」顺口。
 *  档③不带日期 —— 它不是命中，说「这个月」就是编的。 */
function label(hit, kind) {
  if (!hit) return '';
  if (kind === 'month') return hit.years === 1 ? '去年这个月' : `${hit.years} 年前的这个月`;
  if (kind === 'rotate') return '重温这一张';
  return hit.years === 1 ? '去年今天' : `${hit.years} 年前的今天`;
}

/** 首页/时光机用的一行：{ text, title, id, years, kind }；三档都不成立才返回 null。
 *  kind 是给埋点用的 —— 三档混在一行里，不带它就分不出「今天真有回忆」还是「只是轮到了这一张」。 */
function row(ts, now) {
  const tiers = [['day', onThisDay], ['month', onThisMonth], ['rotate', pickRotate]];
  for (const [kind, pick] of tiers) {
    const hit = pick(ts, now);
    if (!hit) continue;
    return {
      kind,
      text: label(hit, kind),
      title: (hit.ticket && hit.ticket.title) || '',
      id: (hit.ticket && hit.ticket.id) || '',
      years: hit.years
    };
  }
  return null;
}

module.exports = { onThisDay, onThisMonth, pickRotate, label, row, bjDay, MIN_POOL };
