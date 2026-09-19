// tests/memory.test.js —— 7.4.0 A3「那年今天」命中逻辑
// ============================================================
// 为什么单开一套：这是**纯函数**，可以真跑，不用扫源码猜。
// 而它错起来是「静默地错」：命中早了一天，用户看到的是「去年的今天你在看演出」，
// 可他那天根本不在——回忆功能一旦说假话，比没有这个功能更伤。
// 所以口径（同月同日 + 更早年份 + 北京时间）逐条钉死。
//
// 8.1.5 起多了一条降级链（同月 → 轮换重温），这一节更长了：
// **降级同样不许说假话** —— 「重温这一张」这种文案里不能出现任何日期，
// 出现了就是在替用户断言某一天，而那一天根本没发生过。
// ============================================================
const path = require('path');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const memory = require(path.resolve(__dirname, '../utils/memory.js'));

// 北京时间 2026-09-13 12:00（UTC 04:00）—— 往后的用例都以「今天」为基准
const NOW = Date.UTC(2026, 8, 13, 4, 0);
const tk = (date, title, id) => ({ id: id || 't_' + date, title, date });

console.log('\n【一、命中规则：同月同日 + 更早的年份】');

t('命中：同月同日、往年的票根', () => {
  const r = memory.onThisDay([tk('2024-09-13', '夜宴')], NOW);
  ok(r, '同月同日的往年票根没命中');
  ok(r.ticket.title === '夜宴', '挑错了票根');
  ok(r.years === 2, '年份差算错：' + r.years);
});

t('本年度的不算「那年」：今年同月同日不该被当成回忆', () => {
  ok(memory.onThisDay([tk('2026-09-13', '今晚的演出')], NOW) === null, '把今年的票当成了「那年今天」');
});

t('差一天不算命中（这是最容易错的地方）', () => {
  ok(memory.onThisDay([tk('2024-09-12', '前一天')], NOW) === null, '前一天误命中');
  ok(memory.onThisDay([tk('2024-09-14', '后一天')], NOW) === null, '后一天误命中');
  ok(memory.onThisDay([tk('2024-10-13', '下个月同日')], NOW) === null, '月份不同也命中了');
});

t('没有命中就返回 null —— 不许编一句假的回忆', () => {
  ok(memory.onThisDay([], NOW) === null, '空列表不该有命中');
  ok(memory.onThisDay(null, NOW) === null, 'null 入参不该炸');
  ok(memory.row([], NOW) === null, 'row 没命中时该返回 null');
});

t('多条命中取最近的那一年（去年的事比五年前更戳人）', () => {
  const r = memory.onThisDay([tk('2019-09-13', '很早以前'), tk('2025-09-13', '去年'), tk('2022-09-13', '三年前')], NOW);
  ok(r.ticket.title === '去年', '没挑最近的一年，挑的是：' + r.ticket.title);
  ok(r.years === 1, '年份差不对：' + r.years);
});

console.log('\n【二、时间口径：固定北京时间，不看设备时区】');

t('UTC 16:30 已是北京第二天 —— 回忆的「今天」要跟着签到一起翻页', () => {
  // 北京 2026-09-14 00:30
  const late = Date.UTC(2026, 8, 13, 16, 30);
  ok(memory.bjDay(late).md === '09-14', '北京日期算错：' + memory.bjDay(late).md);
  ok(memory.onThisDay([tk('2025-09-14', '去年的今天')], late), '按北京日期该命中 09-14');
  ok(memory.onThisDay([tk('2025-09-13', '昨天')], late) === null, '按北京日期不该命中 09-13');
});

t('跨年也退得对：北京 1 月 1 日命中去年的 1 月 1 日', () => {
  const ny = Date.UTC(2026, 11, 31, 16, 0); // 北京 2027-01-01 00:00
  const r = memory.onThisDay([tk('2026-01-01', '元旦那场')], ny);
  ok(r && r.years === 1, '跨年命中失败');
});

console.log('\n【三、脏数据不炸（票根日期是 OCR 来的，什么形状都可能有）】');

t('缺日期 / 短串 / 非字符串都不炸，也不误命中', () => {
  const dirty = [{ title: '没有日期' }, { date: '' }, { date: '2024-9' }, { date: 20240913 }, { date: '2024-09-13T20:00' }];
  const r = memory.onThisDay(dirty, NOW);
  ok(r && r.ticket.date === '2024-09-13T20:00', '带时间后缀的正常日期没识别出来');
});

t('日期串带时分秒也能命中（详情页的 date 有时是完整时间）', () => {
  const r = memory.onThisDay([tk('2024-09-13 19:30', '带时间的')], NOW);
  ok(r, '带时间后缀的日期没命中');
});

console.log('\n【四、给页面用的那一行】');

t('row：带 id 与 title（点它要能跳进详情），并给出年数', () => {
  const r = memory.row([tk('2024-09-13', '夜宴', 'abc123')], NOW);
  ok(r.id === 'abc123', 'row 没带 id，点了跳不进详情');
  ok(r.title === '夜宴', 'row 没带票名');
  ok(r.years === 2, 'row 没带年数（埋点要用）');
});

t('文案：一年说「去年今天」，两年以上说「N 年前的今天」', () => {
  ok(memory.label({ years: 1 }) === '去年今天', '一年的说法不对：' + memory.label({ years: 1 }));
  ok(memory.label({ years: 3 }) === '3 年前的今天', '多年的说法不对：' + memory.label({ years: 3 }));
  ok(memory.label(null) === '', '没命中时该是空串');
});

console.log('\n【五、8.1.5 降级链：真命中 → 同月 → 轮换重温（降级也要说真话）】');

/** n 张往年票，都在 3 月 —— 离 09-13 很远，保证 ①② 都不命中，只能落到档③。
 *  故意按日期**倒序**给，与首页真喂进来的顺序一致：档③ 要自己重排成升序，
 *  喂进来就是升序的话，「从最早那张往前走」这条断言等于没写。 */
const many = (n) => Array.from({ length: n }, (_, i) => tk('20' + String(10 + i) + '-03-0' + (i + 1), '票' + i, 'id' + i)).reverse();

t('档①优先：同月同日那张还在时，不会走同月或轮换', () => {
  const r = memory.row(many(6).concat([tk('2024-09-13', '正主', 'HIT')]), NOW);
  ok(r && r.kind === 'day', '走错档了：' + (r && r.kind));
  ok(r.id === 'HIT', '挑错了票：' + r.id);
});

t('档②：同月、但不同日的往年票 → 「去年这个月」', () => {
  const r = memory.row([tk('2025-09-20', '同月', 'M1')], NOW);
  ok(r && r.kind === 'month', '没降级到档②：' + JSON.stringify(r));
  ok(r.text === '去年这个月', '文案不对：' + r.text);
  ok(r.id === 'M1', '挑错了票：' + r.id);
});

t('档②：本年度同一个月的票不算「那年」（它就在今年）', () => {
  ok(memory.row([tk('2026-09-20', '今年的')], NOW) === null, '把今年的票当成了回忆');
});

t('档②：多条同月取最近的那一年', () => {
  const r = memory.row([tk('2019-09-20', '很早'), tk('2025-09-20', '去年'), tk('2022-09-20', '三年前')], NOW);
  ok(r.title === '去年', '没取最近的一年：' + r.title);
  ok(r.years === 1, '年份差不对：' + r.years);
});

t('档③：都不命中且票够多 →「重温这一张」，文案里不许出现任何日期', () => {
  const r = memory.row(many(5), NOW);
  ok(r && r.kind === 'rotate', '没降级到档③：' + JSON.stringify(r));
  ok(r.text === '重温这一张', '文案不对：' + r.text);
  ok(!/\d/.test(r.text), '文案里出现了数字 —— 那是在替用户断言某一天');
  ok(!!r.id && !!r.title, '档③也要带 id 与票名（点它得能跳进详情）');
});

t('档③的门槛：票太少就整行不显示（天天翻同一张比没有更尬）', () => {
  ok(memory.row(many(4), NOW) === null, '只有 4 张也走了档③');
  ok(memory.row(many(5), NOW) !== null, '5 张该走档③');
});

t('档③当天稳定：同一天里几点看都是同一张', () => {
  const ts = many(5);
  ok(memory.row(ts, NOW).id === memory.row(ts, NOW + 5 * 3600 * 1000).id, '同一天翻出了两张不同的票');
});

t('档③轮换跟着北京日期翻页（不是设备时区，也不是 UTC）', () => {
  const ts = many(5);
  const base = memory.row(ts, NOW).id;                                // 北京 09-13 12:00
  const late = memory.row(ts, NOW + 12 * 3600 * 1000 - 60000).id;     // 北京 09-13 23:59
  const next = memory.row(ts, NOW + 12 * 3600 * 1000).id;             // 北京 09-14 00:00
  ok(late === base, '北京还没到零点就换票了');
  ok(next !== base, '北京过了零点还没换票');
});

t('档③ n 天正好轮完一遍、不重样，且顺着日期从最早那张往前走', () => {
  const ts = many(5);
  const asc = ts.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).map((x) => x.id);
  const seen = [];
  for (let i = 0; i < 5; i++) seen.push(memory.row(ts, NOW + i * 86400000).id);
  ok(new Set(seen).size === 5, '5 天里出现了重复：' + seen.join(','));
  const start = asc.indexOf(seen[0]);
  ok(seen.every((id, i) => id === asc[(start + i) % 5]), '不是按日期顺序走的：' + seen.join(','));
});

t('档③的池子只收能用的票：没名字 / 没日期的票不算人头', () => {
  const dirty = many(4).concat([{ id: 'x1', date: '' }, { title: '没日期' }, { id: 'x2', title: '日期是脏的', date: '2024-9' }]);
  ok(memory.row(dirty, NOW) === null, '脏票被算进了档③的门槛');
});

console.log('\n【六、接线：页面真的用上了它（改一处漏一处就白做）】');
const fs = require('fs');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

t('首页确实渲染了这一行，且点得动', () => {
  const wxml = read('pages/home/home.wxml');
  ok(/wx:if="\{\{mem\}\}"/.test(wxml), '首页没有按 mem 判定显示（没命中会显示空行）');
  ok(/bindtap="goMemory"/.test(wxml), '那一行点不动');
  const js = read('pages/home/home.js');
  ok(/memory\.row\(this\._all\)/.test(js), '首页没有把票根喂给 memory.row');
  ok(/navigateTo\(\{ url: `\/pages\/detail\/detail\?id=\$\{m\.id\}` \}\)/.test(js), '没跳详情页');
  // 三档混在一行里，不带 kind 就分不出「今天是真有回忆」还是「只是轮到了这一张」——
  // 那这个功能上不上线、哪一档在生效，就又变成一个没法回答的问题。
  ok(/memory_open'[\s\S]{0,120}?kind:/.test(js), 'memory_open 没带上 kind');
});

// ════════════════════════════════════════════════════════════
(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log('  PASS  ' + name);
      pass++;
    } catch (e) {
      console.log('  FAIL  ' + name + '\n        ' + (e && e.message));
      fail++;
    }
  }
  console.log('\n──────────────────────────────');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
