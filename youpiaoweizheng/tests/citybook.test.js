// tests/citybook.test.js —— 8.1.6 城市集章册：把票根归成「一枚一枚的章」
// ============================================================
// 为什么单开一套：这是纯函数，可以真跑，不用扫源码猜。而它错起来是「静默地错」：
//   ① 「武汉」和「武汉市」没归到一起 → 同一座城盖出两枚章，册子自己就是错的；
//   ② 首访日期取错 → 章的先后顺序全乱，而集章册讲的正是「我什么时候第一次到这儿」；
//   ③ 没填城市的票被塞进某座城 → 凭空多一枚章，等于替用户断言「你去过」。
//   —— 第 ③ 条与「那年今天」守的是同一条线：回忆类功能宁可少说，不许说假话。
// ============================================================
const path = require('path');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const citybook = require(path.resolve(__dirname, '../utils/citybook.js'));

// 北京时间 2026-09-13 12:00（UTC 04:00）—— 「今年」的基准
const NOW = Date.UTC(2026, 8, 13, 4, 0);
const tk = (city, date, title) => ({ id: 't_' + city + date, title: title || '票', city, date });

console.log('\n【一、归成几枚章】');

t('一座城一枚章，票数累加', () => {
  const r = citybook.build([tk('武汉', '2024-05-01'), tk('武汉', '2025-05-01')], NOW);
  ok(r.cities.length === 1, '应该只有一枚章，实际 ' + r.cities.length);
  ok(r.cities[0].count === 2, '票数不对：' + r.cities[0].count);
  ok(r.cityCount === 1, 'cityCount 不对：' + r.cityCount);
});

t('没填城市的票不盖章，也不许塞进别的城', () => {
  const r = citybook.build([tk('武汉', '2024-05-01'), tk('', '2024-06-01'), { title: '没城市' }], NOW);
  ok(r.cities.length === 1, '空城市的票被盖了章，章数 ' + r.cities.length);
  ok(r.noCity === 2, '没数清「没城市」的票：' + r.noCity);
});

t('一张票都没有：空册子，不炸', () => {
  const r = citybook.build([], NOW);
  ok(r.cities.length === 0, '空列表该是空册子');
  ok(r.cityCount === 0 && r.yearNew === 0 && r.noCity === 0, '空册子的计数该全是 0');
});

console.log('\n【二、城市名归一：同一个地方不许盖两枚章】');

t('「武汉」和「武汉市」是同一枚章', () => {
  const r = citybook.build([tk('武汉', '2024-05-01'), tk('武汉市', '2025-05-01')], NOW);
  ok(r.cities.length === 1, '被当成了两座城，章数 ' + r.cities.length);
  ok(r.cities[0].count === 2, '票数没并到一起：' + r.cities[0].count);
});

t('展示名取最短的那个 —— 是「武汉」不是「武汉市」', () => {
  const r = citybook.build([tk('武汉市', '2024-05-01'), tk('武汉', '2025-05-01')], NOW);
  ok(r.cities[0].city === '武汉', '展示名取错了：' + r.cities[0].city);
});

t('市/省/区/县等后缀全剥掉', () => {
  const pairs = [['上海市', '上海'], ['广州市', '广州'], ['哈尔滨市', '哈尔滨'], ['成都市', '成都']];
  pairs.forEach(([raw, want]) => {
    const r = citybook.build([tk(raw, '2024-05-01'), tk(want, '2025-05-01')], NOW);
    ok(r.cities.length === 1, '「' + raw + '」与「' + want + '」没归到一起');
    ok(r.cities[0].city === want, '展示名该是「' + want + '」，实际「' + r.cities[0].city + '」');
  });
});

t('空格、中点、全角空格都不算两个地方', () => {
  const r = citybook.build([tk('成都', '2024-01-01'), tk('成 都', '2024-02-01'), tk('成·都', '2024-03-01')], NOW);
  ok(r.cities.length === 1, '空格/中点没归到一起，章数 ' + r.cities.length);
  ok(r.cities[0].count === 3, '票数不对：' + r.cities[0].count);
});

console.log('\n【三、顺序：按第一次去的时间】');

t('按首访时间升序 —— 集章册讲的是先来后到', () => {
  const r = citybook.build([
    tk('上海', '2025-01-01'), tk('武汉', '2019-08-01'), tk('成都', '2022-03-01')
  ], NOW);
  const got = r.cities.map((c) => c.city).join(',');
  ok(got === '武汉,成都,上海', '顺序不对：' + got);
});

t('首访取该城最早的那张，不是最近那张', () => {
  const r = citybook.build([tk('武汉', '2025-06-01'), tk('武汉', '2019-08-01')], NOW);
  ok(r.cities[0].first === '2019-08-01', '首访取错了：' + r.cities[0].first);
});

t('没日期的票不能当首访', () => {
  const r = citybook.build([{ title: '没日期', city: '武汉', date: '' }, tk('武汉', '2024-05-01')], NOW);
  ok(r.cities[0].first === '2024-05-01', '把没日期的票当成了首访：' + r.cities[0].first);
});

t('整座城都没日期：first 为空串，排在最后', () => {
  const r = citybook.build([{ title: '无日期', city: '拉萨', date: '' }, tk('武汉', '2024-05-01')], NOW);
  ok(r.cities[r.cities.length - 1].city === '拉萨', '没日期的城该排最后，实际：' + r.cities[0].city);
  ok(r.cities[r.cities.length - 1].first === '', 'first 该是空串');
});

console.log('\n【四、今年新增】');

t('今年第一次去的才算「今年新增」', () => {
  const r = citybook.build([
    tk('武汉', '2019-08-01'),   // 往年
    tk('成都', '2026-03-01'),   // 今年第一次
    tk('上海', '2025-01-01')    // 往年
  ], NOW);
  ok(r.yearNew === 1, '今年新增算错：' + r.yearNew);
});

t('往年去过、今年又去的，不算新增', () => {
  const r = citybook.build([tk('武汉', '2019-08-01'), tk('武汉', '2026-03-01')], NOW);
  ok(r.yearNew === 0, '重复去的城被算成了新增');
});

t('「今年」按北京时间算，不跟设备时区走', () => {
  // 北京 2026-01-01 00:30 = UTC 2025-12-31 16:30 —— 设备还在去年，北京已是新年
  const ny = Date.UTC(2025, 11, 31, 16, 30);
  const r = citybook.build([tk('武汉', '2026-01-01')], ny);
  ok(r.yearNew === 1, '跨年那一刻算错了：北京已是 2026 年');
});

console.log('\n【五、每座城带着自己的票根】');

t('票根按日期倒序（点进去先看最近那张）', () => {
  const r = citybook.build([tk('武汉', '2019-08-01', '老的'), tk('武汉', '2025-06-01', '新的')], NOW);
  ok(r.cities[0].tickets[0].title === '新的', '票根没按日期倒序');
  ok(r.cities[0].tickets.length === 2, '票根数不对');
});

console.log('\n【六、脏数据】');

t('null / 缺字段 / 非字符串城市名都不炸', () => {
  const r = citybook.build([null, undefined, {}, { city: null }, { city: 123, date: '2024-01-01' }, tk('武汉', '2024-05-01')], NOW);
  ok(r.cities.length === 1, '脏数据混进来了，章数 ' + r.cities.length);
  ok(r.cities[0].city === '武汉', '剩下的那枚章不对：' + r.cities[0].city);
});

t('入参不是数组也不炸', () => {
  ok(citybook.build(null, NOW).cities.length === 0, 'null 入参炸了');
  ok(citybook.build(undefined, NOW).cities.length === 0, 'undefined 入参炸了');
});

// —— 跑 ——
tests.forEach(([name, fn]) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
});
console.log('\n测试套件：citybook —— ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
