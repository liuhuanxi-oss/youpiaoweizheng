// tests/memory.test.js —— 7.4.0 A3「那年今天」命中逻辑
// ============================================================
// 为什么单开一套：这是**纯函数**，可以真跑，不用扫源码猜。
// 而它错起来是「静默地错」：命中早了一天，用户看到的是「去年的今天你在看演出」，
// 可他那天根本不在——回忆功能一旦说假话，比没有这个功能更伤。
// 所以口径（同月同日 + 更早年份 + 北京时间）逐条钉死。
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

console.log('\n【五、接线：页面真的用上了它（改一处漏一处就白做）】');
const fs = require('fs');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

t('首页确实渲染了这一行，且点得动', () => {
  const wxml = read('pages/home/home.wxml');
  ok(/wx:if="\{\{mem\}\}"/.test(wxml), '首页没有按 mem 判定显示（没命中会显示空行）');
  ok(/bindtap="goMemory"/.test(wxml), '那一行点不动');
  const js = read('pages/home/home.js');
  ok(/memory\.row\(this\._all\)/.test(js), '首页没有把票根喂给 memory.row');
  ok(/navigateTo\(\{ url: `\/pages\/detail\/detail\?id=\$\{m\.id\}` \}\)/.test(js), '没跳详情页');
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
