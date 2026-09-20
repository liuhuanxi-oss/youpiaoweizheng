// utils/citybook.js —— 8.1.6 城市集章册：把票根归成「一枚一枚的章」
// ============================================================
// 【为什么不跟回忆地图共用那份归并】
//   地图要的是「落点」—— 没有坐标的票必须丢掉，否则画不出来；
//   集章册要的是「我到过这儿」—— 只要有城市名就能盖一枚章，坐标有没有都无所谓。
//   两边的筛选条件不同，硬凑成一个函数只会让 discover 那个已经很绕的 refresh 更绕。
//   （已知差异：discover 那份没做城市名归一，「武汉」与「武汉市」在图上会落成两个点。）
//
// 【城市名归一】「武汉」和「武汉市」必须盖成同一枚章。
//   规则逐字抄自云函数 cloudfunctions/saveTicket/citydict.js 的 norm()——
//   那边带 88 城坐标字典，端上不需要坐标，只搬这条剥后缀的规则。
//   ⚠️ 两份规则要一起改：那边管落点、这边管盖章，改了一边不改另一边就会对不上。
//
// 【排序讲的是先来后到】按该城**第一次**去的时间升序 —— 集章册的全部意思就是
//   「我什么时候第一次到这儿」，所以取最早的日期而不是最近的。
// ============================================================
const { bjDay } = require('./memory.js'); // 「今年」的口径与签到 / 那年今天同源（北京时间）

/** 归一：去空格与中点、剥行政后缀、「武汉」「武汉市」「武 汉」都归成「武汉」 */
function normCity(s) {
  return String(s == null ? '' : s)
    .replace(/[\s·・　]/g, '')
    .replace(/(特别行政区|维吾尔自治区|回族自治区|壮族自治区|自治区|自治州|省|市|地区|盟|县)$/g, '')
    .toLowerCase();
}

/**
 * 票根列表 → 集章册
 * @param {Array} ts 票根列表（city 可空、date 可空，都能容忍）
 * @param {Number} [now] 当前时间戳（测试注入；不传取此刻）
 * @returns {{cities: Array, cityCount: number, yearNew: number, noCity: number}}
 *   cities 每项：{ city 展示名, count 票数, first 首访日期(可空), tickets 该城票根(倒序) }
 */
function build(ts, now) {
  const year = bjDay(now).year;
  const groups = new Map();
  let noCity = 0;

  (Array.isArray(ts) ? ts : []).forEach((t) => {
    if (!t) return;
    const raw = typeof t.city === 'string' ? t.city.trim() : '';
    const key = normCity(raw);
    // 没城市名的票不盖章，也不塞进任何一座城 —— 替用户编一座城出来，比不显示更糟
    if (!key) { noCity++; return; }
    let g = groups.get(key);
    if (!g) { g = { names: {}, count: 0, first: '', tickets: [] }; groups.set(key, g); }
    g.count++;
    g.names[raw] = (g.names[raw] || 0) + 1;
    g.tickets.push(t);
    const d = String(t.date || '');
    if (d && (!g.first || d < g.first)) g.first = d;
  });

  const cities = Array.from(groups.values()).map((g) => {
    // 展示名取组里最短的那个（「武汉」胜过「武汉市」）；一样长就取出现次数多的
    const names = Object.keys(g.names).sort((a, b) => a.length - b.length || g.names[b] - g.names[a]);
    return {
      city: names[0] || '',
      count: g.count,
      first: g.first,
      tickets: g.tickets.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    };
  }).sort((a, b) => {
    // 整座城都没日期的排最后：不知道什么时候去的，就不该挤在「第一次」的位置上
    if (!a.first && !b.first) return b.count - a.count;
    if (!a.first) return 1;
    if (!b.first) return -1;
    return a.first.localeCompare(b.first);
  });

  return {
    cities,
    cityCount: cities.length,
    yearNew: cities.filter((c) => c.first.slice(0, 4) === String(year)).length,
    noCity
  };
}

module.exports = { normCity, build };
