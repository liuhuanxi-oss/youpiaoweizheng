// tests/legacy_lot.test.js —— 8.1.0 老票根专场：首页那一行 + 活动页 + 扫码提示
// ============================================================
// 为什么单开一套：这一整套的错法都是**看不出来的错**——
//   ① 首页那行该藏没藏：对着云兜底出来的演示票根说「你还没拍过老票」，
//      用户看到的是一句和他无关的话（甚至以为 App 在催他干一件他已经干过的事）；
//   ② 该显示没显示：这行的作用只是拉新，漏了不报错、只是没人来；
//   ③ 活动页在**朋友圈单页模式**下留一个点了没反应的按钮（那模式下跳不了页）。
// 显示规则是纯函数（utils/legacy.js），所以这一套真跑，不靠扫源码猜。
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

const legacy = require(path.resolve(ROOT, 'utils/legacy.js'));

// 北京时间 2026-09-17 12:00（UTC 04:00）—— 用例一律以它为「今天」
const NOW = Date.UTC(2026, 8, 17, 4, 0);
const tk = (date, title) => ({ id: 't_' + date, title: title || '某场演出', date });

console.log('\n【一、首页那一行：什么时候该显示（真跑规则）】');

t('有票、但一张五年前的都没有 → 显示', () => {
  ok(legacy.row([tk('2024-05-01'), tk('2025-10-26')], { netFallback: false }, NOW) === true,
    '手里全是近几年的票，这行本该露一次脸');
});

t('已经有一张五年前（含）的老票 → 不显示：它自己收了，不需要用户手动关', () => {
  ok(legacy.row([tk('2024-05-01'), tk('2021-08-21')], {}, NOW) === false,
    '已经有老票了还挂着一行「翻翻抽屉」——他要的是回忆，不是活动');
});

t('边界：正好第五年算老票（今年 − 5 = 2021）', () => {
  ok(legacy.row([tk('2022-01-01')], {}, NOW) === true, '2022 年的票不该算老票');
  ok(legacy.row([tk('2021-12-31')], {}, NOW) === false, '2021 年的票就是五年前，该算老票');
});

t('一张票都没有 → 不显示：他该先拍第一张，不是先看活动页', () => {
  ok(legacy.row([], {}, NOW) === false, '空收藏册的人不该看到这行');
  ok(legacy.row(null, {}, NOW) === false, '列表没拿到时不许崩、也不许显示');
});

t('云兜底时不显示 —— 那是演示票根，不是他的票', () => {
  // 关键用例：兜底数据里恰好有一张 2013 年的「老票」，逐条判断会得出「他有老票」，
  // 但那些票根本不是他的。这条路径错了，用户看到的是和另一个人的收藏册有关的话。
  const demo = [tk('2013-03-09', '演示用老票'), tk('2025-10-26')];
  ok(legacy.row(demo, { netFallback: true }, NOW) === false,
    '云库读失败时拿演示票根下了结论');
  // 反过来也要对：同样是这批数据，没有 netFallback 标记时才按真数据处理
  ok(legacy.row(demo, { netFallback: false }, NOW) === false, '真有这批票时该收起来');
});

t('日期缺失 / 乱填的票不算老票，也不许崩', () => {
  ok(legacy.row([{ id: 'x', title: '没填日期' }], {}, NOW) === true, '没有日期的票被当成了老票');
  ok(legacy.row([tk('待填写'), tk('2025-1O-26')], {}, NOW) === true, '乱填的日期串被当成了年份');
});

t('「五年前」按年份算，不按日期差：跨年那几张不会忽老忽少', () => {
  // 2020-12-31 与 2025-01-01 只隔一天，但它们是两个年份 —— 用户数的是年份
  ok(legacy.row([tk('2020-12-31')], {}, NOW) === false, '2020 年的票该算老票');
  ok(legacy.row([tk('2025-01-01')], {}, NOW) === true, '2025 年的票不该算老票');
});

t('年份口径固定走北京时间（跨年那一刻不能随设备时区摇摆）', () => {
  const utcNewYear = Date.UTC(2026, 0, 1, 2, 0);  // 北京时间 2026-01-01 10:00
  const utcNyEve = Date.UTC(2025, 11, 31, 18, 0); // 北京时间 2026-01-01 02:00
  ok(legacy.row([tk('2021-06-01')], {}, utcNewYear) === false, '2026 年的判据下 2021 该算老票');
  ok(legacy.row([tk('2021-06-01')], {}, utcNyEve) === false, '同一刻的另一种写法结论必须一致');
});

console.log('\n【二、首页真的用了这条规则】');

t('refresh 里算这行的值，并把 flags 一起喂进去（漏了 flags 就等于没有兜底保护）', () => {
  const js = decomment(read('pages/home/home.js'));
  ok(/legacy: legacy\.row\(this\._all, flags\)/.test(js), '首页没接这条规则，或没把 flags 传进去');
  ok(/require\('\.\.\/\.\.\/utils\/legacy\.js'\)/.test(read('pages/home/home.js')), '没引 utils/legacy.js');
});

t('home.wxml 的入口行挂在 legacy 上，且点了真能到活动页', () => {
  const wxml = read('pages/home/home.wxml');
  ok(/wx:if="\{\{legacy\}\}"/.test(wxml), '入口行的显示条件不对');
  ok(/bindtap="goLegacy"/.test(wxml), '入口行没有点击事件');
  const js = decomment(read('pages/home/home.js'));
  ok(/navigateTo\(\{ url: '\/pages\/legacy\/legacy' \}\)/.test(js), 'goLegacy 没跳到老票根专场');
});

console.log('\n【三、活动页自己站得住】');

t('app.json 注册了，且首页之外还有入口（分享落点就是它自己）', () => {
  const app = JSON.parse(read('app.json'));
  ok(app.pages.includes('pages/legacy/legacy'), '活动页没在 app.json 注册');
  ok(read('utils/share.js').indexOf("'/pages/legacy/legacy'") >= 0, '分享没有落到活动页');
});

t('活动页不读票根列表：没有云调用，也就没有「兜底成演示票根」这条路径', () => {
  const js = decomment(read('pages/legacy/legacy.js'));
  ok(!/store\./.test(js), '活动页读了 store：静态页不该依赖任何用户数据');
  ok(!/wx\.cloud/.test(js), '活动页里有云调用');
});

t('朋友圈过来是单页模式：不能留一个点了没反应的按钮', () => {
  const js = decomment(read('pages/legacy/legacy.js'));
  const wxml = read('pages/legacy/legacy.wxml');
  ok(/onShareTimeline\s*\(/.test(js), '活动页没接朋友圈分享');
  ok(/share\.sp\(\)/.test(js), '活动页没判单页模式（那模式下「去拍一张」点了不会有反应）');
  ok(wxml.indexOf('templates/sp.wxml') >= 0, '活动页没引品牌落地卡');
  ok(/wx:if="\{\{!sp\}\}"/.test(wxml), '单页模式下没把正文让位给落地卡');
});

t('两条分享各记各的来源（否则看板只有一个总数，分不出哪条路带来的）', () => {
  const js = decomment(read('pages/legacy/legacy.js'));
  ok(/track\.track\('share_click'[\s\S]{0,40}from: 'legacy'/.test(js), '好友分享没记来源');
  ok(/track\.track\('share_timeline'[\s\S]{0,40}from: 'legacy'/.test(js), '朋友圈分享没记来源');
});

t('分享用的是 legacy 那一套文案与封面（不是默认的票根场景）', () => {
  const js = decomment(read('pages/legacy/legacy.js'));
  ok(/share\.message\('legacy'/.test(js), '好友分享没用 legacy 场景');
  ok(/share\.timeline\('legacy'/.test(js), '朋友圈分享没用 legacy 场景');
});

console.log('\n【四、去拍票根这条路是通的】');

t('活动页的按钮带 from=legacy，扫码页据此换提示', () => {
  const js = decomment(read('pages/legacy/legacy.js'));
  ok(/navigateTo\(\{ url: '\/pages\/scan\/scan\?from=legacy' \}\)/.test(js), '按钮没带 from=legacy');
});

t('scan 页真的读了 from=legacy（它原先没有 onLoad，这条是这次加的）', () => {
  const js = decomment(read('pages/scan/scan.js'));
  ok(/onLoad\s*\(options\)[\s\S]{0,200}options\.from === 'legacy'/.test(js), 'scan 没读 from=legacy');
  ok(/fromLegacy: true/.test(js), 'scan 没把标记落到 data 上');
  const wxml = read('pages/scan/scan.wxml');
  ok(/fromLegacy \?/.test(wxml), '取景提示没跟着 fromLegacy 变');
});

t('提示只说「可以自己填」，不改任何识别与保存行为', () => {
  const js = decomment(read('pages/scan/scan.js'));
  // 老票认不准是必然的，靠的是原本就有的「识别失败进空表单」这条路，
  // 不是给老票单开一条保存分支 —— 单开一条就是两套行为，早晚不一致
  const onLoad = /onLoad\s*\(options\)\s*\{[\s\S]*?\n  \}/.exec(js);
  ok(onLoad, '找不到 scan 的 onLoad');
  ok(!/save|upload|recognize/i.test(onLoad[0]), 'onLoad 里动了识别/保存的流程');
});

console.log('\n【五、合规与诚实】');

t('活动页不诱导分享、不承诺奖励（不设奖励的活动写奖励就是骗）', () => {
  // 只扫**用户看得到的字**：注释里写「不写『拉好友得奖励』这类话」是自证清白，
  // 不该把它自己判成违规 —— 所以先去掉两种注释再查
  const txt = read('pages/legacy/legacy.wxml').replace(/<!--[\s\S]*?-->/g, '')
    + decomment(read('pages/legacy/legacy.js'));
  const bad = ['邀请好友', '分享给好友', '转发', '得奖励', '领红包', '免费领', '助力', '拉新'];
  const hit = bad.filter((w) => txt.includes(w));
  ok(hit.length === 0, '活动页出现了诱导分享 / 承诺奖励的字眼：' + hit.join('、'));
});

t('所有可点元素都有按压反馈（没反馈用户以为没点上，会连点）', () => {
  const wxml = read('pages/legacy/legacy.wxml');
  const hits = wxml.match(/class="[^"]*\bpressable\b[^"]*"[^>]*/g) || [];
  ok(hits.length > 0, '活动页一个可点元素都没有？主按钮不该走 pressable 之外的写法');
  hits.forEach((h) => ok(/hover-class=/.test(h), '可点元素没有 hover-class：' + h.slice(0, 60)));
});

t('文案里没有禁用字符（› → ✓ ★ 之类的符号只能走图标）', () => {
  const wxml = read('pages/legacy/legacy.wxml');
  const BANNED = /\p{Emoji_Presentation}|[✦▾▸›⟶→✓✔★☆↻➤▶❤♥♡✿📍]/u;
  ok(!BANNED.test(wxml), '活动页 wxml 里出现了禁用字符：' + (wxml.match(BANNED) || [''])[0]);
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
