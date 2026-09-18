// utils/anniv.js —— 8.1.2 拉新 6/6：周年提醒（纯函数，真跑）
// ============================================================
// 要算的只有一件事：这张票的**下一个周年日**是哪天、几周年、还差几天。
// 【为什么只认未来 1–30 天】
//   小程序订阅消息是**一次授权只换一条**。半年前问「到那天提醒你」，用户不会记得
//   自己答应过什么；周年当天才问，今早九点那条已经排不上了。30 天是「他还记得」
//   与「云端来得及」之间的那条线，超出去既不问、也不显示那一行。
// 【为什么今天不算】今天正是周年 → 详情页的彩蛋（4.15.0）已经在管这件事了，
//   再摆一行「到那天提醒我」是重复；而且那条消息得在前一天就排好。
// 【口径】一律北京时间 —— 与 utils/memory.js 的 bjDay、签到的 pay.ymdNow 同源。
//   设备时区不是东八区时，跨日那几个小时里各页不能各说各话。
// ============================================================

const WINDOW_DAYS = 30;   // 窗口：未来 1–30 天

const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const pad2 = (n) => (n < 10 ? '0' + n : String(n));

/** 'YYYY-MM-DD' → { y, m, d }｜null（格式不对、或那一天根本不存在，都算没有日期） */
function parse(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return null;
  // 「2025-02-30」这种格式对、日子不存在的脏数据不能当日期用：Date 会把它滚到 3 月 2 日，
  // 那等于替用户编出另一天（与「无数据不造假」冲突），索性当成没有日期。
  const dim = mo === 2 && isLeap(y) ? 29 : DIM[mo - 1];
  return d <= dim ? { y, m: mo, d } : null;
}

/** 目标年那个「月-日」的时间戳（UTC 零点）；平年的 2/29 落到 2/28 —— 那天本来就不存在 */
function dayIn(y, m, d) {
  return Date.UTC(y, m - 1, m === 2 && d === 29 && !isLeap(y) ? 28 : d);
}

/** 北京时间「今天」的 UTC 零点（用时间戳表示）——与 date.js 的 todayMD 同一套 UTC+8 口径 */
function bjToday(now) {
  const n = new Date((Number(now) || Date.now()) + 8 * 3600 * 1000);
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
}

/**
 * 这张票的下一个周年日。
 * @param {string} dateStr 票面日期 'YYYY-MM-DD'
 * @param {number=} now 时间戳（测试注入用；缺省取当前）
 * @returns {{ymd:string, years:number, days:number}|null}
 *   ymd = 周年日（'2026-08-12'）/ years = 到那天满几年 / days = 距今几天；
 *   不在未来 1–30 天里（含「今天正好是周年」）一律 null —— 调用方据此决定要不要出现
 */
function next(dateStr, now) {
  const p = parse(dateStr);
  if (!p) return null;
  const today = bjToday(now);
  const ty = new Date(today).getUTCFullYear();
  let y = ty;
  let at = dayIn(y, p.m, p.d);
  if (at <= today) { y = ty + 1; at = dayIn(y, p.m, p.d); }   // 今年这天已过（或就是今天）→ 看明年
  const years = y - p.y;
  if (years < 1) return null;   // 今年的票：满一年还在 365 天后，落不进窗口
  const days = Math.round((at - today) / 86400000);
  if (days < 1 || days > WINDOW_DAYS) return null;
  const d2 = p.m === 2 && p.d === 29 && !isLeap(y) ? 28 : p.d;   // 平年的 2/29 → 2/28，不编一个 3/1
  return { ymd: `${y}-${pad2(p.m)}-${pad2(d2)}`, years, days };
}

/** '2026-08-12' → '8月12日'（详情页那一行上的小字） */
function cnDay(ymd) {
  const p = parse(ymd);
  return p ? `${p.m}月${p.d}日` : '';
}

module.exports = { WINDOW_DAYS, parse, next, cnDay, bjToday };
