// tests/page_refs.test.js —— 页面可达性回归测试
// 为什么要有这一套：v7.0 改版把 tab 从「足迹地图」换成「回忆地图」之后，
//   pages/map 就成了**没有任何入口的孤立页**——它照常打进包里、照常编译通过，
//   站在页面上什么都看不出来。这类问题没有报错、只有「这个页面死了」和
//   「挂在它上面的勋章永远点不亮」两个后果。
// 所以这里钉两条：
//   ① app.json 注册的每个页面，在代码里必须至少有一处入口（navigateTo / switchTab / url）；
//   ② 「足迹地图」勋章(b12)的解锁标记必须有人打——页面换了，标记得跟着换。
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

const app = JSON.parse(read('app.json'));

/** 收集参与「入口」判定的源码：页面 / 组件 / 工具 / 云函数 / 脚本；不含测试与文档 */
function collect(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'tests') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p, out);
    else if (/\.(js|json|wxml|wxss)$/.test(e.name)) out.push(path.relative(ROOT, p).replace(/\\/g, '/'));
  }
  return out;
}

const files = collect(ROOT).map((f) => ({ f, text: read(f) }));

t('app.json 注册的每个页面都有入口，不存在孤立页', () => {
  const orphans = [];
  for (const page of app.pages) {
    const seg = page.split('/')[1];
    const hit = files.some(({ f, text }) => !f.startsWith(`pages/${seg}/`) && text.includes(page));
    if (!hit) orphans.push(page);
  }
  ok(orphans.length === 0, '这些页面没有任何入口，是死页：' + orphans.join(', '));
});

t('已下线的旧地图页不再被注册', () => {
  ok(!app.pages.includes('pages/map/map'), 'pages/map/map 又回到注册表了（v7.0 已由 pages/discover 取代）');
});

t('「足迹地图」勋章 b12 的解锁标记有人在打（页面换了标记要跟着换）', () => {
  const markers = files.filter(({ f, text }) => /setStorageSync\(\s*'sp_map_visited'/.test(text)).map(({ f }) => f);
  ok(markers.length > 0, '没有任何页面写 sp_map_visited → 「足迹地图」勋章永远点不亮');
  const badge = read('utils/badges.js');
  const visitedPage = markers[0].split('/')[1];
  ok(app.pages.includes(`pages/${visitedPage}/${visitedPage}`), `打标记的 ${markers[0]} 不在注册页面里`);
  ok(badge.includes('sp_map_visited') || /mapVisited/.test(badge), '勋章判定不再读 sp_map_visited');
});

console.log('\n──────────────────────────────');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
