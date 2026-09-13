// utils/memory.js —— 7.4.0 R4 个性化回忆（只推「你自己的回忆」）
// ============================================================
// 【诚实原则】没有命中就返回 null，页面整块不显示 ——
//   绝不编一句「去年的今天你在某地看了某场」，那是假的，用户一眼就能看出来。
// 【命中规则】同月同日 + 更早的年份（本年度的不算「那年」，它就在今年）。
//   多条命中取最近的那一年：去年的事比五年前更戳人，也更容易想起来。
// 【时间口径】固定 UTC+8，与云函数签到（pay.ymdNow）同一口径。
//   不取设备时区：不然手机时区一变，「今天」在签到里和在回忆里会不是同一天。
// ============================================================
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

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

/** 展示文案：「去年今天」比「1 年前的今天」顺口 */
function label(hit) {
  if (!hit) return '';
  return hit.years === 1 ? '去年今天' : `${hit.years} 年前的今天`;
}

/** 首页/时光机用的一行：{ text, title, id, years }；没命中返回 null */
function row(ts, now) {
  const hit = onThisDay(ts, now);
  if (!hit) return null;
  return {
    text: label(hit),
    title: (hit.ticket && hit.ticket.title) || '',
    id: (hit.ticket && hit.ticket.id) || '',
    years: hit.years
  };
}

module.exports = { onThisDay, label, row, bjDay };
