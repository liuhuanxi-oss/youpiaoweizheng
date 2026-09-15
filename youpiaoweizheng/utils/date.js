// utils/date.js —— 日期工具（纯函数，无依赖）

/** '2025-10-26' → '2025 · 十月'（双人时间线按月分组）
 *  7.4.3：补守卫 —— 空值 / 残缺日期 / 月份越界一律返回空串。
 *  同文件的 weekday 从 4.22.5 起就有这道守卫，这里一直漏着，脏数据会渲染成「undefined月」。 */
function groupLabel(dateStr) {
  const months = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  const s = String(dateStr || '');
  if (s.length < 10) return '';
  const [y, m] = s.split('-');
  const mi = Number(m) - 1;
  if (!(mi >= 0 && mi < 12)) return '';
  return `${y} · ${months[mi]}月`;
}

/** '2025-10-26' → '周日'（4.22.5：空/不完整（非 YYYY-MM-DD）/无效日期返回空串，防「周undefined」与残缺日期被补全误导） */
function weekday(dateStr) {
  if (!dateStr || dateStr.length < 10) return '';
  const d = new Date(String(dateStr).replace(/-/g, '/'));
  if (isNaN(d.getTime())) return '';
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  return `周${days[d.getDay()]}`;
}

/** 今天 → {m, d} 用于「那年今日」匹配（M3 用） */
function todayMD() {
  const n = new Date();
  return { m: n.getMonth() + 1, d: n.getDate() };
}

// 今日时光签（每月两句，上/下半月轮换）——时光机未命中时兜底，永不空转
const SIGN_LINES = [
  ['新的一年，从一句「开场铃响了」开始。', '一月的冷，是为了让掌声听起来更暖。'],
  ['冬天快过完了，把暖的那部分存进票根。', '短的是假期，长的是散场后不愿走的路。'],
  ['春天适合出发，也适合把出发变成纪念。', '风一软，就想去看一场很吵的演出。'],
  ['四月最好的座位，是靠窗的那一侧人间。', '花开了，票根也该翻新一张。'],
  ['初夏的第一场风，替你把幕布吹开。', '五月的人间值得，票根作证。'],
  ['梅雨和安可一样，都是舍不得停的东西。', '半年过去了，你收藏的时光替你记得。'],
  ['盛夏的灯牌亮起来，合唱和汗水都值得收藏。', '七月的热浪里，总有一场不肯散的夜。'],
  ['暑假的尾巴，再看一场电影才算数。', '夏天的最后一个安可，留给八月。'],
  ['开学季也是开场季，新的故事检票入场。', '九月的风穿过场馆，把夏天正式送走。'],
  ['秋天的第一张票根，比奶茶更值得晒。', '十月最适合出门，把秋天折进副券里。'],
  ['落叶是大地散场的纸屑，捡一张当书签。', '初冬的第一场演出，要穿最暖的外套去。'],
  ['年末盘点：今年你收藏了多少张时光？', '把最后一枚票根留给今年，跨年见。']
];

/** 今天 → { date:'2026.09.04', text:时光签 } */
function todaySign() {
  const n = new Date();
  const text = SIGN_LINES[n.getMonth()][n.getDate() > 15 ? 1 : 0];
  const date = `${n.getFullYear()}.${String(n.getMonth() + 1).padStart(2, '0')}.${String(n.getDate()).padStart(2, '0')}`;
  return { date, text };
}

/**
 * '2025-09-05' → 周年数（今天恰是那张票的 N 周年时返回 N，否则 0）
 * 4.11.0：AI 文案周年语气（PRD「那年今日：AI 文案自动感知 N 周年」）
 */
function annivYears(dateStr) {
  const s = String(dateStr || '');
  if (s.length < 10) return 0;
  const n = new Date();
  const md = s.slice(5, 10);
  const today = `${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  const years = n.getFullYear() - Number(s.slice(0, 4));
  return md === today && years > 0 ? years : 0;
}

// stubDate（'2025-10-26' → '10.26'）7.4.3 已删：全项目 0 个调用方，且同样缺守卫
module.exports = { groupLabel, weekday, todayMD, todaySign, annivYears };
