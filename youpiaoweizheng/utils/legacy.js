// utils/legacy.js —— 8.1.0 老票根专场：首页那一行的显示规则
// ============================================================
// 【为什么要单独有个规则】这一行是拉新入口，摆在首页第一屏。摆错了就是说假话：
//   ① 云库读失败时 store 会兜底成演示票根（flags.netFallback）—— 那一批「老票」
//      根本不是用户的，拿它去判断「你还没拍过老票」，等于对着演示数据给他派活；
//   ② 一张票都没有的人，抽屉还没开始翻：他该先拍第一张，不是先看一个活动页；
//   ③ 手里已经有五年前票的人，这行对他没有用 —— 他要的是回忆，不是活动。
//   三条都排掉才露出；等他真翻出来一张老票，这行自己就收了（不需要他手动关）。
// 【口径】按**年份差额**算，不按日期串比大小：2020-12-31 与 2025-01-01 只隔一天，
//   但用户心里的「五年前」是按年份数的。固定 UTC+8，与 memory.js / 签到同一口径 ——
//   不取设备时区，不然手机时区一变，同一张票算不算「老票」会跟着变。
// ============================================================
const DATE_RE = /^(\d{4})/;
const YEARS = 5;

/** 北京时间的那一年 */
function bjYear(now) {
  return new Date((now || Date.now()) + 8 * 3600 * 1000).getUTCFullYear();
}

/**
 * 首页「老票根专场」那一行要不要显示。
 * @param {Array} ts 票根列表（date 形如 2015-08-21）
 * @param {{netFallback?:boolean}=} flags store.listFlags()
 * @param {number=} now 时间戳（测试注入用，缺省取当前）
 * @returns {boolean} 该显示为 true
 */
function row(ts, flags, now) {
  if (flags && flags.netFallback) return false;  // 兜底数据不是他的票，别拿它下结论
  const list = ts || [];
  if (!list.length) return false;                // 一张都没有：先拍第一张
  const cut = bjYear(now) - YEARS;
  return !list.some((t) => {
    const m = DATE_RE.exec(String((t && t.date) || ''));
    return m && Number(m[1]) <= cut;
  });
}

module.exports = { row, YEARS, bjYear };
