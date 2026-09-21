// tests/home_filter.test.js —— 8.2.0：首页四枚常驻胶囊（分类筛选）
// ============================================================
// 【为什么要真跑】home_wall.test.js 里那条是正则钉源码的，钉得住「怎么写」，
//   钉不住「筛出来几张」。8.2.0 把「筛选按钮 + 原生清单」改回品牌稿的四枚常驻胶囊：
//   每枚胶囊自带 data-key，原先「清单第 n 项 → FILTERS[n-1]」那个差一位就全错的映射没有了，
//   但换来一条同样容易写错的新路 —— **再点一次已选中的胶囊要回到「全部」**。
//
//   写成 onFilter(key) 而不是 onFilter('')，点下去列表照样会重排一次、看着完全正常，
//   只有张数能揭穿它（没回到全部的话还是 3 张，不是 6 张）。所以这套用一份
//   **每类张数都不一样**的票根，真调 onTabTap，只看最后列出来几张。
// ============================================================
const path = require('path');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const ROOT = path.resolve(__dirname, '..');
let filters = 0;       // applyFilter 被调了几次（用来钉「同键不重算」）

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
  showActionSheet: () => {},   // 8.2.0 起首页不再用它，留着是防别的路径顺手调到
  cloud: { callFunction: () => Promise.resolve({ result: {} }) }
};

let page = null;
global.Page = (o) => { page = o; };
require(path.join(ROOT, 'pages/home/home.js'));

/** 每类张数都不一样 —— 筛错了会筛出另一个数字，一眼看得出来 */
const FIXTURE = [
  ...Array(3).fill('show'),
  ...Array(2).fill('movie'),
  ...Array(1).fill('traffic')
  // travel 一张都没有：分类里可以有空的，这是合法的（空态文案另说）
];

/** 一个够用的页面实例：照着真页面的样子来 —— 方法从 page 上原样拿
 *  （onTabTap 里 `this.onFilter(...)` 调的是**实例上**的方法，光给 data 是会炸的），
 *  data 与本页的状态换成干净的，好让每条断言从零开始。 */
function ctx() {
  const c = Object.assign({}, page);
  c.data = { active: '', colA: [], colB: [], total: 0, hasAny: false, loading: false };
  c._all = FIXTURE.map((type, i) => ({ id: 't' + i, type, title: '票' + i }));
  c.setData = function (patch) { Object.assign(this.data, patch); };
  c.applyFilter = function () { filters++; page.applyFilter.call(this); };
  page.applyFilter.call(c);   // 进页面本来就会先排一次（onLoad），不然墙是空的
  return c;
}

/** 走完整条路：点一枚胶囊，带的是 WXML 上那枚自己的 data-key */
function tapKey(c, key) {
  page.onTabTap.call(c, { currentTarget: { dataset: { key: key } } });
}

const shown = (c) => c.data.total;

(async () => {
console.log('\n【一、四枚胶囊：key 与名字都得是稿子上那四类】');

t('分类清单是演出 / 电影 / 交通 / 旅行，不多不少', () => {
  const names = (page.data.tabs || []).map((x) => x.name);
  ok(names.length === 4, '胶囊有 ' + names.length + ' 枚，稿子上是四枚：' + names.join('/'));
  ['演出', '电影', '交通', '旅行'].forEach((n) => {
    ok(names.indexOf(n) >= 0, '少了分类「' + n + '」：' + names.join('/'));
  });
});

t('默认不过滤：进来先看到全部六张，一枚都没亮', () => {
  const c = ctx();
  ok(shown(c) === 6, '默认只列出 ' + shown(c) + ' 张，应当是全部 6 张');
  ok(c.data.active === '', '默认亮着分类「' + c.data.active + '」—— 非演出类的用户会看到假空态');
});

console.log('\n【二、点哪一枚就筛哪一类】');

t('演出 → 3 张｜电影 → 2 张｜交通 → 1 张｜旅行 → 0 张', () => {
  const want = [['show', '演出', 3], ['movie', '电影', 2], ['traffic', '交通', 1], ['travel', '旅行', 0]];
  want.forEach(([key, name, n]) => {
    const c = ctx();
    tapKey(c, key);
    ok(shown(c) === n, '点「' + name + '」列出 ' + shown(c) + ' 张，应当是 ' + n + ' 张');
    ok(c.data.active === key, '点了「' + name + '」，active 却是 ' + JSON.stringify(c.data.active));
  });
});

t('空分类筛出来是 0 张，但账还是记着的（空态文案另说）', () => {
  const c = ctx();
  tapKey(c, 'travel');
  ok(shown(c) === 0, '「旅行」一张都没有，却列出了 ' + shown(c) + ' 张');
  ok(c.data.hasAny === true, 'hasAny 没算上 —— 空态会把「这个分类没有」说成「你还没有票」');
});

console.log('\n【三、回头路：再点一次已选中的那枚】');

t('每一类都能回到「全部」（筛完必须有路回家）', () => {
  ['show', 'movie', 'traffic', 'travel'].forEach((key) => {
    const c = ctx();
    tapKey(c, key);
    tapKey(c, key);            // 再点一次同一枚 = 取消筛选
    ok(shown(c) === 6, '点「' + key + '」再点一次，只剩 ' + shown(c) + ' 张 —— 没回到全部');
    ok(c.data.active === '', '回了全部，active 却是 ' + JSON.stringify(c.data.active));
  });
});

console.log('\n【四、重复选同一个不重算】');

t('连着选两次同一个分类，第二次不再重排列表', () => {
  const c = ctx();
  filters = 0;          // 进页面那一次不算，只数用户点出来的
  tapKey(c, 'show');
  const once = filters;
  ok(once === 1, '第一次选就重算了 ' + once + ' 次');
  tapKey(c, 'show');    // 这一下是「取消筛选」，会重算，属于正常
  ok(filters === 2, '取消筛选没重排：' + filters + ' 次');
});

t('点同一枚胶囊来回切，每次都只重排一次（不会连闪）', () => {
  const c = ctx();
  filters = 0;
  tapKey(c, 'show');
  tapKey(c, 'show');
  tapKey(c, 'show');
  ok(filters === 3, '点三下重排了 ' + filters + ' 次，应当是 3 次（一下一次）');
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
