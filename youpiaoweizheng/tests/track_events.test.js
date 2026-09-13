// tests/track_events.test.js —— 埋点（v8.0 §3.3 补线：page_view / 付费墙）
// ============================================================
// 守两件事：
//   ① **埋点记在那一刻，不是记在附近**。pay_start 若记在登录/下单之前，
//      「登录失败」会被算成「用户不想买」——这种数一旦进了看板，是会被拿去做决策的。
//   ② **高频事件不许走后端存储那条路**。track 的第二通道是同步 setStorageSync，
//      每次路由变化都把 500 条事件重写一遍，掉帧掉在页面切换上最明显。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const appJs = decomment(read('app.js'));
const trackJs = decomment(read('utils/track.js'));
const payJs = decomment(read('utils/pay.js'));

console.log('\n【一、page_view：一处盖住全部页面】');
t('走全局路由钩子，不是逐页各加一行', () => {
  ok(/wx\.onAppRoute\(/.test(appJs), 'app.js 没有用 onAppRoute');
  const fn = /onAppRoute\([\s\S]*?\)\s*;/.exec(appJs);
  ok(fn && /track\.track\('page_view'/.test(fn[0]), 'onAppRoute 里没有发 page_view');
  ok(/if\s*\(\s*wx\.onAppRoute\s*\)/.test(appJs), '没做能力守卫：老基础库上会直接抛在 onLaunch 里');
});

t('page_view 不写本地缓冲（同步写会拖慢每次切页）', () => {
  ok(/page_view[\s\S]{0,80}local:\s*false/.test(appJs), 'page_view 没关掉本地通道');
  ok(/opts\s*&&\s*opts\.local\s*===\s*false\s*\)\s*return/.test(trackJs),
    'track.js 没有 local:false 这条提前返回 —— 参数传了也没人看');
  ok(/wx\.reportEvent/.test(trackJs), '通道一被误删：local:false 不等于不报后台');
});

console.log('\n【二、付费墙与支付：各自记在发生的那一刻】');
t('paywall_show 记在付费墙真的打开时', () => {
  const fn = /_offerBuy\s*\(\)\s*\{([\s\S]*?)\n  \},/.exec(decomment(read('pages/art/art.js')));
  ok(fn, '找不到 _offerBuy');
  ok(/setData\(\{\s*paywall:\s*true\s*\}\)/.test(fn[1]), '付费墙没打开');
  ok(/track\.track\('paywall_show'/.test(fn[1]), '开了墙却没记 paywall_show');
  // 演示模式那段是提前 return 的，不该记成「看过付费墙」
  const tip = fn[1].indexOf('wx.showModal');
  const ev = fn[1].indexOf("track.track('paywall_show'");
  ok(tip < 0 || ev > tip, '演示模式的系统弹窗也被记成了付费墙曝光');
});

t('pay_start 记在拉起收银台那一刻（不是登录/下单之前）', () => {
  const start = payJs.indexOf("track.track('pay_start'");
  const request = payJs.indexOf('wx.requestVirtualPayment');
  ok(start > -1 && request > -1, '找不到 pay_start 或 requestVirtualPayment');
  ok(start < request, 'pay_start 记晚了（收银台已经拉起来了）');
  // 登录与下单都必须在它前面 —— 否则「登录失败」「下单失败」会被算成用户不想买
  ok(payJs.indexOf('ensureSession') < start, 'pay_start 记在了登录之前');
  ok(payJs.indexOf("action: 'payCreate'") < start, 'pay_start 记在了下单之前');
  // 中间不许夹 return：那说明有分支根本没拉起收银台，却也记了 pay_start
  ok(!/\breturn\b/.test(payJs.slice(start, request)), 'pay_start 与收银台之间还夹着 return');
});

t('取消与成功各走各的分支', () => {
  const cancel = payJs.indexOf("track.track('pay_cancel'");
  ok(cancel > -1, '没有 pay_cancel');
  ok(/cancelled:\s*true/.test(payJs.slice(cancel, cancel + 200)), 'pay_cancel 不在「用户主动取消」那条分支里');
  const success = payJs.indexOf("track.track('pay_success'");
  ok(success > -1, '没有 pay_success');
  ok(success > cancel, 'pay_success 写在取消分支里了');
  ok(success < payJs.indexOf('requestVirtualPayment') === false, 'pay_success 记在支付之前（顺序反了）');
});

console.log('\n【三、全仓事件名：小写蛇形，且不重名冲突】');
t('所有 track.track 的事件名都合法', () => {
  const files = [];
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    });
  })(ROOT);
  const bad = [];
  const seen = new Map();
  files.filter((f) => !f.includes('node_modules') && !f.includes('tests' + path.sep)).forEach((f) => {
    const src = decomment(fs.readFileSync(f, 'utf8'));
    [...src.matchAll(/track\.track\(\s*'([^']*)'/g)].forEach((m) => {
      const n = m[1];
      if (!/^[a-z][a-z0-9_]*$/.test(n)) bad.push(path.relative(ROOT, f) + ':' + n);
      seen.set(n, (seen.get(n) || 0) + 1);
    });
  });
  ok(bad.length === 0, '事件名不合规（小程序自定义分析只认小写字母/数字/下划线）：' + bad.join(', '));
  ok(seen.size >= 15, '事件总数偏少，疑似漏扫：' + seen.size);
  ok(seen.has('page_view') && seen.has('paywall_show'), '§3.3 要求的事件没铺上');
});

t('广告事件确实没铺（广告接线随 §3.2 暂缓，不铺空事件）', () => {
  // 两个广告位 ID 都还是空串 → 铺了也永远不会触发，只是看着像做了
  const ads = read('utils/ads.js');
  const empty = /REWARDED_ID\s*=\s*''/.test(ads) && /BANNER_DETAIL_ID\s*=\s*''/.test(ads);
  if (!empty) {
    console.log('        （广告位已回填，ad_show/ad_click/ad_complete 该补上了）');
    return;
  }
  const src = decomment(read('pages/detail/detail.js')) + decomment(read('pages/art/art.js'));
  ok(!/track\.track\('ad_/.test(src), '广告位还是空的，却已经铺了 ad_* —— 永远不会触发的埋点是假的完成度');
});

console.log('\n──────────────────────────────');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
