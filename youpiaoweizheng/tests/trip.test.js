// tests/trip.test.js —— 8.4.0「这一趟」：从一张票圈出前后那几天
// ============================================================
// 【为什么单开一套】这个功能错了**只有看图才知道**，而那张图是要存进相册的：
//   ① 圈错了范围 —— 图上多出几张根本不是这一趟的票（或少了几张）。用户看到的是
//      「我们这一趟的照片，可日期不对」，他不会去核对，只会觉得这 App 记错了；
//   ② 日子算错 —— 抬头那句「9月28日 — 10月1日 · 4 天」是**我们替他断言的**，
//      多一天少一天都是说了句假话（与「那年今天」守的是同一条线）；
//   ③ 排序错 —— 时间线倒着走，图上第一张是最晚的那张；
//   ④ 云兜底那批演示票根混进来 —— 拿别人的票拼一张「你的这一趟」，最坏的一种。
// 四条都不报错，所以这一套全部真跑（`utils/trip.js` 是纯函数，不依赖 wx）。
// ============================================================
const path = require('path');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const ROOT = path.resolve(__dirname, '..');
const trip = require(path.join(ROOT, 'utils/trip.js'));

const tk = (id, date, city, title) => ({ id, date, city: city || '武汉', title: title || ('票' + id) });

// 以 10-01 那张为锚：向前 3 天 = 09-28 起，向后 3 天 = 10-04 止
const TRIP = [
  tk('a', '2025-09-28', '武汉'),   // 早了 3 天 —— 边界内，该进来
  tk('b', '2025-10-01', '南京'),   // 锚
  tk('c', '2025-10-02', '南京'),
  tk('d', '2025-10-04', '苏州'),   // 晚了 3 天 —— 边界内，该进来
  tk('e', '2025-10-05', '上海'),   // 晚了 4 天 —— 出局
  tk('f', '2025-10-09', '杭州')    // 晚了 8 天 —— 出局
];

console.log('\n【一、圈的是哪几张】');

t('前后各 3 天内（含边界那一天）的都进来，更远的不进来', () => {
  const r = trip.tripOf(TRIP, 'b');
  const ids = r.items.map((x) => x.id).sort().join(',');
  ok(ids === 'a,b,c,d', '圈出来的是 ' + ids + '，该是 a,b,c,d（e 差 4 天、f 差 8 天，都不该进）');
});

t('同一天有好几张，都进来', () => {
  const all = [tk('x', '2025-10-01', '南京'), tk('y', '2025-10-01', '南京'), tk('z', '2025-10-02')];
  const r = trip.tripOf(all, 'x');
  ok(r.items.length === 3, '同一天的只进来了一部分：' + r.items.length + ' 张');
});

t('锚一换，范围跟着换（早的出界了，晚的进来了）', () => {
  const r = trip.tripOf(TRIP, 'd');   // 10-04：向前到 10-01（b/c 在内），向后到 10-07（e 进来了）
  const ids = r.items.map((x) => x.id).sort().join(',');
  ok(ids === 'b,c,d,e', '从 d 出发圈出来的是 ' + ids + '，该是 b,c,d,e —— a 是 09-28 差 6 天该出界，e 是 10-05 该进来');
});

console.log('\n【二、成不了一趟的时候】');

t('这一趟只有这一张 —— 拼不成，要说得出为什么', () => {
  const r = trip.tripOf([tk('solo', '2025-10-01')], 'solo');
  ok(r.ok === false, '一张票也报成图了');
  ok(r.reason === 'alone', '给的理由是 ' + r.reason + '，该是 alone');
  ok(r.items.length === 1, 'items 仍该带着那一张（页面要拿它说人话）');
});

t('找不到这张票 —— 不编，如实说', () => {
  const r = trip.tripOf(TRIP, '不存在');
  ok(r.ok === false && r.reason === 'no-anchor', '给的理由是 ' + r.reason + '，该是 no-anchor');
});

t('云兜底（演示票根）一律不成图 —— 拿别人的票拼「你的这一趟」是最坏的一种', () => {
  const r = trip.tripOf(TRIP, 'b', 3, { netFallback: true });
  ok(r.ok === false && r.reason === 'demo', '云兜底时 ok=' + r.ok + ' / reason=' + r.reason + '，该拦住');
});

console.log('\n【三、图上那几张怎么排、放几张】');

t('按日期升序 —— 时间线不许倒着走', () => {
  const shuffled = [TRIP[3], TRIP[0], TRIP[2], TRIP[1]];
  const r = trip.tripOf(shuffled, 'b');
  const ds = r.items.map((x) => x.date);
  ok(ds.join(',') === '2025-09-28,2025-10-01,2025-10-02,2025-10-04', '排出来的是 ' + ds.join(','));
});

t('最多 6 张：超了就均匀挑，且必须保住头尾两张', () => {
  // 10 张摊在 10-01 ~ 10-04 四天里 —— 必须整批都落在「锚前后各 3 天」的窗口内，
  // 否则测的就成了「窗口」，不是「挑图」。故意让 m9 是最晚那天的那张，头尾才测得出真假
  const many = [];
  for (let i = 0; i < 10; i++) many.push(tk('m' + i, '2025-10-0' + (1 + Math.min(3, Math.floor(i / 3)))));
  const r = trip.tripOf(many, 'm0');
  ok(r.items.length === 6, '图上给了 ' + r.items.length + ' 张，上限是 6');
  ok(r.total === 10, 'total 该如实报 10（图里挑过，抬头仍要说实话）');
  ok(r.capped === true, 'capped 该为真 —— 页面要据它决定说不说「图里挑了 6 张」');
  ok(r.items[0].id === 'm0', '第一张该是最早那张');
  ok(r.items[r.items.length - 1].id === 'm9', '最后一张该是最晚那张');
  const uniq = new Set(r.items.map((x) => x.id));
  ok(uniq.size === 6, '挑重了：只有 ' + uniq.size + ' 个不同的 id');
});

t('正好 6 张时不算挑过（capped 为假）', () => {
  const six = [];
  for (let i = 0; i < 6; i++) six.push(tk('n' + i, '2025-10-0' + (1 + Math.floor(i / 2))));
  const r = trip.tripOf(six, 'n0');
  ok(r.items.length === 6 && r.capped === false, 'items=' + r.items.length + ' capped=' + r.capped);
});

console.log('\n【四、抬头那句实话】');

t('日期跨度与天数（含首尾）算得对', () => {
  const r = trip.tripOf(TRIP, 'b');
  ok(r.from === '2025-09-28' && r.to === '2025-10-04', '跨度是 ' + r.from + ' — ' + r.to);
  ok(r.days === 7, '天数算成了 ' + r.days + '，09-28 到 10-04 含首尾该是 7 天');
});

t('同一天的几张：跨度一天、天数是 1', () => {
  const r = trip.tripOf([tk('p', '2025-10-01'), tk('q', '2025-10-01')], 'p');
  ok(r.days === 1 && r.from === r.to, 'days=' + r.days + ' from=' + r.from + ' to=' + r.to);
});

t('跨年也算得对（12-30 到 01-02 是 4 天，不是 −362 天）', () => {
  const all = [tk('y1', '2024-12-30'), tk('y2', '2025-01-02')];
  const r = trip.tripOf(all, 'y1');
  ok(r.days === 4, '跨年算成了 ' + r.days + ' 天');
  ok(r.from === '2024-12-30' && r.to === '2025-01-02', '跨度 ' + r.from + ' — ' + r.to);
});

t('城市数按归一口径（「武汉」与「武汉市」是一座，不是两座）', () => {
  const all = [tk('c1', '2025-10-01', '武汉'), tk('c2', '2025-10-02', '武汉市')];
  const r = trip.tripOf(all, 'c1');
  ok(r.cities === 1, '数出来 ' + r.cities + ' 座 —— 与集章册同一份归一口径，两处不能各说各话');
});

t('抬头那句日期：同一天只写一个，跨月写两个，跨年两边都带年', () => {
  ok(trip.spanText('2025-10-01', '2025-10-01') === '10月1日', '同一天写成了 ' + trip.spanText('2025-10-01', '2025-10-01'));
  ok(trip.spanText('2025-09-28', '2025-10-04') === '9月28日 — 10月4日', '同一年写成了 ' + trip.spanText('2025-09-28', '2025-10-04'));
  ok(trip.spanText('2024-12-30', '2025-01-02') === '2024年12月30日 — 2025年1月2日',
    '跨年写成了 ' + trip.spanText('2024-12-30', '2025-01-02') + ' —— 少了年份，读的人得自己猜是哪一年');
});

t('统计行说的是整趟的真数（不是图上那几张）', () => {
  const r = trip.tripOf(TRIP, 'b');
  ok(trip.statText(r) === '7 天 · 4 张票 · 3 座城', '写出来是「' + trip.statText(r) + '」');
});

t('同一天的不说「1 天」（那是句废话）；一座城都没填就不说城', () => {
  // 这里不能用 tk：它给空城市兜底了「武汉」，会把这套测成另一回事
  const bare = (id) => ({ id, date: '2025-10-01', city: '', title: '票' + id });
  const one = trip.tripOf([bare('p'), bare('q')], 'p');
  ok(trip.statText(one) === '同一天 · 2 张票', '写出来是「' + trip.statText(one) + '」');
});

console.log('\n【五、脏数据】');

t('没填日期的票不进这一趟，也不崩', () => {
  const all = TRIP.concat([tk('nodate', '')]);
  const r = trip.tripOf(all, 'b');
  ok(r.items.every((x) => x.id !== 'nodate'), '没日期的票被圈进来了 —— 它的日子都不知道，凭什么是「这一趟」');
  ok(r.ok === true, '不该因为一张脏票就整趟作废');
});

t('日期乱填的票也不进这一趟（不猜、不编）', () => {
  const all = TRIP.concat([tk('bad', '2025-13-45'), tk('bad2', '前两天')]);
  const r = trip.tripOf(all, 'b');
  ok(r.items.every((x) => x.id !== 'bad' && x.id !== 'bad2'), '乱填日期的票混进来了');
});

t('空列表 / 不是数组 —— 不崩，如实说没有', () => {
  [null, undefined, [], 'nope'].forEach((bad) => {
    const r = trip.tripOf(bad, 'b');
    ok(r.ok === false, '喂进 ' + JSON.stringify(bad) + ' 时 ok 该为假');
  });
});

// —— 跑 ——
tests.forEach(([name, fn]) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
});
console.log('\n测试套件：trip —— ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
