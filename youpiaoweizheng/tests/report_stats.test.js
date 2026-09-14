// tests/report_stats.test.js —— 回忆报告页的类型分布
// 这一块错起来是「静默地错」，用户看到的是一个讲不通的数字：
//   ① 分母用「票根总数」而不是「认得出的类型之和」→ 库里混进别的 type 时，
//      三条占比加起来不到 100%，用户看着像丢票（他自己的票，数怎么会对不上）；
//   ② 一张票都没有（或某类为 0）时照画 0% 的空条 —— 比空态更像「数据坏了」。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const wxml = read('pages/report/report.wxml').replace(/<!--[\s\S]*?-->/g, '');
const jsClean = read('pages/report/report.js')
  .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

console.log('\n【一、三条占比加起来必须是 100%】');
t('分母是「认得出的类型之和」，不是票根总数', () => {
  ok(/const known = counts\.show \+ counts\.movie \+ counts\.traffic/.test(jsClean),
    '找不到 known（分母）—— 改了写法就把这条断言一起改');
  ok(/counts\[k\] \/ known/.test(jsClean), '占比不是拿 known 当分母');
  ok(!/counts\[k\] \/ (items\.length|total)/.test(jsClean),
    '分母又用回总票数了：混进别的 type 时三条加起来不到 100%，用户看着像丢票');
});

console.log('\n【二、空数据不画空条】');
t('一张票都没有时 bars 是空数组', () => {
  const m = /const bars = ([\s\S]*?);\n/.exec(jsClean);
  ok(m, '找不到 bars 的计算（改了写法就把这条断言一起改）');
  ok(/known > 0\s*\?/.test(m[1]), 'bars 没有「有票才画」的判断');
  ok(/:\s*\[\]/.test(m[1]), 'known 为 0 时没有落到空数组');
});
t('占比为 0 的类型不占一根空条', () => {
  ok(/\.filter\(\(k\) => counts\[k\] > 0\)/.test(jsClean),
    '没滤掉 0 条：一条演出票都没有的人，也会看到一根 0% 的空条');
});
t('空数组时整块收起（不然标题下面吊着半个空框）', () => {
  ok(/wx:if="\{\{[^}]*bars\.length[^}]*\}\}"/.test(wxml), '分布块的 wx:if 没有判 bars.length');
});

console.log('\n测试套件：report_stats —— ' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
