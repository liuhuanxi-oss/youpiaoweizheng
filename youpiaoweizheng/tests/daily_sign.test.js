// tests/daily_sign.test.js —— 7.4.0 第三批（留存闭环）：每日时光签 + 积分账本
// ============================================================
// 为什么这批要单独一套：
//   ① 签到是**发东西**的地方 —— 积分能换成真金白银的 AI 重绘。判重若留在客户端，
//      改一下手机日期就能天天领；所以「今天签过没有」必须由服务端按北京时间判定，
//      这条得钉死，否则以后有人图省事挪回前端也没人发现；
//   ② 连签阶梯是按 streak 恰好命中发奖的：写错成 >= 就会「连签 7 天后天天送重绘」，
//      成本闸门直接失灵，而功能界面上完全看不出来；
//   ③ pay.ymdNow 是纯函数（只依赖 Date.now），可以真跑 —— 跨天/跨年的北京时区口径
//      用真断言验，不用扫源码猜。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const cloud = decomment(read('cloudfunctions/saveTicket/index.js'));
const paySrc = read('cloudfunctions/saveTicket/pay.js');
const pay = require('../cloudfunctions/saveTicket/pay.js');

// ════════════════════════════════════════════════════════════
console.log('\n【一、北京时间口径（真跑，不是扫源码）】');

t('ymdNow：UTC 与北京时间差 8 小时 —— UTC 16:30 已经是北京第二天', () => {
  const real = Date.now;
  try {
    Date.now = () => Date.UTC(2026, 8, 13, 16, 30); // 北京 2026-09-14 00:30
    ok(pay.ymdNow() === '2026-09-14', '北京日期算错了：' + pay.ymdNow());
  } finally { Date.now = real; }
});

t('ymdNow(-1)：跨年也要退对（12-31 的昨天是 12-30，不是上一年）', () => {
  const real = Date.now;
  try {
    Date.now = () => Date.UTC(2026, 11, 31, 16, 0); // 北京 2027-01-01 00:00
    ok(pay.ymdNow() === '2027-01-01', '跨年当天算错：' + pay.ymdNow());
    ok(pay.ymdNow(-1) === '2026-12-31', '跨年的昨天算错：' + pay.ymdNow(-1));
  } finally { Date.now = real; }
});

t('ymdNow(-1)：北京时间同一天内退一天，差 86400000 毫秒', () => {
  const a = new Date(pay.ymdNow() + 'T00:00:00Z').getTime();
  const b = new Date(pay.ymdNow(-1) + 'T00:00:00Z').getTime();
  ok(a - b === 86400000, '昨天不等于今天减一天：' + (a - b));
});

t('日期串格式固定 YYYY-MM-DD（补零：1 月 1 日不能是 2027-1-1）', () => {
  const real = Date.now;
  try {
    Date.now = () => Date.UTC(2027, 0, 1, 4, 0); // 北京 2027-01-01 12:00
    ok(/^\d{4}-\d{2}-\d{2}$/.test(pay.ymdNow()), '格式不对：' + pay.ymdNow());
  } finally { Date.now = real; }
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、签到判定只能在服务端（改本地时间无效）】');

t('签发日期取服务端北京时间，不取运行环境本地时间', () => {
  const fn = /async function dailySignAction[\s\S]*?\n}/.exec(cloud);
  ok(fn, '找不到 dailySignAction');
  ok(/pay\.ymdNow\(\)/.test(fn[0]), '没走统一的北京时间口径');
  ok(/pay\.ymdNow\(-1\)/.test(fn[0]), '没用「昨天」判连签');
  ok(!/new Date\(\)/.test(fn[0]), '出现了 new Date()：云函数 TZ 可能是 UTC，签到会提前/延后一天');
  ok(!/getFullYear|getMonth|getDate\(\)/.test(fn[0]), '出现了本地日期取值，口径会被运行环境带偏');
});

t('路由挂上且把 event 传进去（查状态要读 event.check）', () => {
  ok(/if \(event\.action === 'dailySign'\)/.test(cloud), '路由里没有 dailySign');
  ok(/return dailySignAction\(event, OPENID\)/.test(cloud), '调用点没把 event 传进去');
});

t('今天签过就直接返回，不再发一次奖', () => {
  const fn = /async function dailySignAction[\s\S]*?\n}/.exec(cloud);
  ok(/d\.ymd === today[\s\S]{0,120}already: true/.test(fn[0]), '没有「今天签过」的短路返回');
});

t('并发/重试用条件更新抢签发权，只有一支能改到', () => {
  const fn = /async function dailySignAction[\s\S]*?\n}/.exec(cloud);
  ok(/where\(\{ _id: d\._id, ymd: _\.neq\(today\) \}\)[\s\S]{0,60}\.update\(/.test(fn[0]),
    '签发没有用条件更新抢占（并发双击会签两次、发两次奖）');
  ok(/claim\.stats\.updated/.test(fn[0]), '抢没抢到没判定');
});

t('查状态（event.check）只看不动：必须在任何写库之前返回', () => {
  const fn = /async function dailySignAction[\s\S]*?\n}/.exec(cloud);
  const checkAt = fn[0].indexOf('event.check');
  const firstWrite = fn[0].search(/col\.(add|doc)\(/);
  ok(checkAt > 0, '没有 check 分支（进页面看一眼就会签到）');
  ok(firstWrite < 0 || checkAt < firstWrite, 'check 分支在写库之后，看一眼就把人签到了');
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、连签天数与阶梯奖励】');

t('昨天签过才 +1，否则归 1（前天签的不能算连上）', () => {
  const fn = /async function dailySignAction[\s\S]*?\n}/.exec(cloud);
  ok(/d\.ymd === yesterday \? \(d\.streak \|\| 0\) \+ 1 : 1/.test(fn[0]),
    '连签的续接/归零判定不对');
});

t('阶梯按「恰好等于」发，不是「大于等于」（否则连签 7 天后天天送重绘）', () => {
  ok(/SIGN_MILESTONES\[streak\]/.test(cloud), '没有按 streak 精确命中阶梯');
  ok(!/streak >=\s*\d+\s*\)\s*\{\s*points/.test(cloud), '阶梯用了 >= 判定，会天天发奖');
  ['3:', '7:', '14:'].forEach((d) => {
    ok(new RegExp('\\n  ' + d).test(/const SIGN_MILESTONES = \{[\s\S]*?\n\};/.exec(cloud)[0]),
      '连签 ' + d.replace(':', '') + ' 天的档位不见了');
  });
});

t('连签 7 天送的是重绘（真实成本），走与邀请奖励同一条入账口径', () => {
  ok(/7: \{ art: 1 \}/.test(cloud), '第 7 天不是送重绘');
  const fn = /async function dailySignAction[\s\S]*?\n}/.exec(cloud);
  ok(/grantBonusArt\(db, OPENID\)/.test(fn[0]), '领奖没走统一的额度入账函数');
});

t('发奖失败要把今天退回「未签」（否则这一天被吃掉，用户点不回来）', () => {
  const fn = /async function dailySignAction[\s\S]*?\n}/.exec(cloud);
  ok(/catch \(e\)[\s\S]{0,400}ymd: d\.ymd \|\| ''/.test(fn[0]), '发奖失败没有回滚签到状态');
  ok(/remove\(\)/.test(fn[0]), '首次签到失败时没有删掉那条记录');
});

t('断签后 streak 归零展示（前天签的不能还显示「连续 N 天」）', () => {
  const fn = /function signView[\s\S]*?\n}/.exec(cloud);
  ok(fn, '找不到 signView');
  ok(/d\.ymd === yesterday/.test(fn[0]), '连签是否还活着没判昨天');
  ok(/alive \? \(d\.streak \|\| 0\) : 0/.test(fn[0]), '断了还显示原天数');
});

// ════════════════════════════════════════════════════════════
console.log('\n【四、积分账本（B 批兑换的地基）】');

t('余额走原子自增，不是「读出来加一写回去」', () => {
  const fn = /async function addPoints[\s\S]*?\n}/.exec(cloud);
  ok(fn, '找不到 addPoints');
  ok(/balance: _\.inc\(d\)/.test(fn[0]), '余额不是原子自增（并发会丢更新）');
  ok(!/balance:\s*\(?\s*p\.balance/.test(fn[0]), '余额用了读-改-写');
});

t('流水只留最近 50 条（否则单文档会被流水撑爆）', () => {
  const fn = /async function addPoints[\s\S]*?\n}/.exec(cloud);
  ok(/slice: -50/.test(fn[0]), '没有截断流水长度');
});

t('余额入账与流水记录分开写：流水失败不影响已经到账的积分', () => {
  const fn = /async function addPoints[\s\S]*?\n}/.exec(cloud);
  const logAt = fn[0].indexOf('log: _.push');
  const balanceAt = fn[0].indexOf('balance: _.inc');
  ok(balanceAt > 0 && logAt > balanceAt, '流水写在余额之前，流水一失败积分就没了');
  ok(/slice: -50[\s\S]{0,40}\}\)\s*\n?\s*\.catch\(\(\) => \{\}\)/.test(fn[0]), '流水失败没有兜底');
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
