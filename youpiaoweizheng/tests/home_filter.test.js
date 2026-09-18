// tests/home_filter.test.js —— 8.1.1：首页「筛选」按钮（四枚胶囊收进原生清单之后）
// ============================================================
// 【为什么要真跑】home_wall.test.js 里那条是用正则钉源码的，钉得住「怎么写」，
//   钉不住「写对了没有」—— 而这里恰好是个差一位就全错的映射：
//
//     this.onFilter(res.tapIndex === 0 ? '' : FILTERS[res.tapIndex - 1].key);
//                                    ↑ 第一项是「全部」，所以分类从 -1 开始
//
//   写成 FILTERS[res.tapIndex] 的话：点「演出」筛出的是电影、点「旅行」筛出的是
//   undefined（空 key，反而显示全部）—— 而「点下去列表变了」这件事本身看起来完全正常。
//   所以这套用一份**每类张数都不一样**的票根，真调 onFilterOpen、真让桩弹窗回调，
//   只看最后列出来的张数对不对。
// ============================================================
const path = require('path');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const ROOT = path.resolve(__dirname, '..');
let sheet = null;      // 最近一次 showActionSheet 的入参
let filters = [];      // applyFilter 被调了几次（用来钉「同键不重算」）

global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {},
  showToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  vibrateShort: () => {},
  getWindowInfo: () => ({ pixelRatio: 2 }),
  getSystemInfoSync: () => ({ platform: 'ios' }),
  getTabBar: () => {},
  showActionSheet: (o) => { sheet = o; },
  cloud: { callFunction: () => Promise.resolve({ result: {} }) }
};

let page = null;
global.Page = (o) => { page = o; };
require(path.join(ROOT, 'pages/home/home.js'));

/** 每类张数都不一样 —— 差一位的映射会筛出另一个数字，一眼看得出来 */
const FIXTURE = [
  ...Array(3).fill('show'),
  ...Array(2).fill('movie'),
  ...Array(1).fill('traffic')
  // travel 一张都没有：分类里可以有空的，这是合法的（空态文案另说）
];

/** 一个够用的页面实例：照着真页面的样子来 —— 方法从 page 上原样拿（onFilterOpen 里
 *  `this.onFilter(...)` 调的是**实例上**的方法，光给 data 是会炸的），
 *  data 与本页的状态换成干净的，好让每条断言从零开始。 */
function ctx() {
  const c = Object.assign({}, page);
  c.data = { active: '', activeName: '', colA: [], colB: [], total: 0, hasAny: false, loading: false };
  c._all = FIXTURE.map((type, i) => ({ id: 't' + i, type, title: '票' + i }));
  c.setData = function (patch) { Object.assign(this.data, patch); };
  c.applyFilter = function () { filters++; page.applyFilter.call(this); };
  page.applyFilter.call(c);   // 进页面本来就会先排一次（onLoad），不然墙是空的
  return c;
}

/** 走完整条路：点按钮 → 桩弹窗把清单交出来 → 按 tapIndex 回调 */
function tap(c, index) {
  sheet = null;
  page.onFilterOpen.call(c);
  ok(sheet, 'onFilterOpen 没弹出清单');
  sheet.success({ tapIndex: index });
}

const shown = (c) => c.data.total;

(async () => {
console.log('\n【一、清单长什么样】');

t('清单第一项是「全部」，后面四个是四个分类（不多不少）', () => {
  const c = ctx();
  page.onFilterOpen.call(c);
  ok(sheet && Array.isArray(sheet.itemList), 'onFilterOpen 没弹出清单');
  ok(sheet.itemList[0] === '全部', '第一项不是「全部」：' + sheet.itemList[0]);
  ['演出', '电影', '交通', '旅行'].forEach((n) => {
    ok(sheet.itemList.indexOf(n) > 0, '清单里少了分类「' + n + '」：' + sheet.itemList.join('/'));
  });
  // showActionSheet 的 itemList 上限是 6 项，超了会静默失败（弹窗不出现，点了没反应）
  ok(sheet.itemList.length <= 6, '清单 ' + sheet.itemList.length + ' 项，超出 showActionSheet 的 6 项上限');
});

console.log('\n【二、点哪一项就筛哪一类（差一位的映射在这儿现形）】');

t('从分类回「全部」→ 六张全回来，按钮上回到「全部」', () => {
  const c = ctx();
  tap(c, 1);
  ok(shown(c) === 3, '点「演出」没筛出来，后面的断言就没意义了');
  tap(c, 0);
  ok(shown(c) === 6, '「全部」只列出 ' + shown(c) + ' 张');
  ok(c.data.active === '', '「全部」没映到空 key：active = ' + JSON.stringify(c.data.active));
  ok(c.data.activeName === '', '「全部」时按钮上的字该是空的（WXML 兜底成「全部」），实际：' + c.data.activeName);
});

t('演出 → 3 张｜电影 → 2 张｜交通 → 1 张｜旅行 → 0 张', () => {
  const want = [['演出', 3], ['电影', 2], ['交通', 1], ['旅行', 0]];
  want.forEach(([name, n], i) => {
    const c = ctx();
    tap(c, i + 1);   // 1..4 → FILTERS[0..3]
    ok(shown(c) === n, '点「' + name + '」列出 ' + shown(c) + ' 张，应当是 ' + n + ' 张'
      + '（差一位的映射会筛出隔壁那一类的数字）');
    ok(c.data.activeName === name, '按钮上的字没跟上：点「' + name + '」，按钮却写「' + c.data.activeName + '」');
  });
});

t('按钮上那行字与清单里的标签逐字一致 —— 否则用户看到两个名字', () => {
  const c0 = ctx();
  page.onFilterOpen.call(c0);
  sheet.itemList.forEach((name, i) => {
    const c = ctx();
    tap(c, i);
    const shownName = c.data.activeName || '全部';
    ok(shownName === name, '清单写「' + name + '」，按钮写「' + shownName + '」');
  });
});

t('每一类都能回到「全部」（筛完必须有路回家）', () => {
  for (let i = 1; i <= 4; i++) {
    const c = ctx();
    tap(c, i);
    tap(c, 0);
    ok(shown(c) === 6, '点第 ' + i + ' 项再回「全部」，只剩 ' + shown(c) + ' 张');
  }
});

console.log('\n【三、重复选同一个不重算】');

t('连着选两次同一个分类，第二次不再重排列表', () => {
  const c = ctx();
  filters = 0;          // 进页面那一次不算，只数用户点出来的
  tap(c, 1);
  const once = filters;
  ok(once === 1, '第一次选就重算了 ' + once + ' 次');
  tap(c, 1);
  ok(filters === once, '又选了一遍同一个分类，列表被重排了一次 —— 整面墙会白闪一下（胶囊那版的老毛病）');
});

t('选完之后再选「全部」，是换键、要重排', () => {
  const c = ctx();
  filters = 0;          // 同上
  tap(c, 1);
  tap(c, 0);
  ok(filters === 2, '换键没重排：' + filters + ' 次');
});

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
