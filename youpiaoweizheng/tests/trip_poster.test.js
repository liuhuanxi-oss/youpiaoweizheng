// tests/trip_poster.test.js —— 8.4.0「这一趟」回忆图：在假画布上真跑一遍
// ============================================================
// 【为什么这套必须存在】这张图会存进用户相册、会当转发图，而它错了**没人会发现**：
//   字画到画布外 → 图上一句话被切掉，看着像「手抖」，其实是坐标写错了；
//   张数对不上 → 图上 6 张、抬头说 4 张（或反过来），是**我们替他断言的假话**；
//   照片没画上 → 一张框里空空的白纸，还存进了相册。
// 这几条都不抛异常，所以只能在假画布上把 render 跑一遍，从调用记录里反查。
// （假 ctx 的写法抄自 tests/birthday_song.test.js，那边已经跑熟了。）
// ============================================================
const path = require('path');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const ROOT = path.resolve(__dirname, '..');
const poster = require(path.join(ROOT, 'pages/trip/poster.js'));

/**
 * 假的 CanvasRenderingContext2D：没写死的方法一律空操作，整串参数记进 log
 * （整串记才拿得到 fillText 的 y —— 它是第三个参数，只记 args[0] 会把文字当坐标）。
 *
 * 【要跟 save/restore 的深浅】照片框和邮戳都是 translate+rotate 之后画本地坐标的
 * （框里那块「票根」文字就落在 y=-10 这种位置），拿局部坐标去比画布尺寸会全是假红。
 * 所以 save/restore 记个深度，深度 >0 时画下的笔标记成 local，只有绝对坐标才参与「出没出画布」的检查。
 */
function fakeCtx(log) {
  const store = { canvas: { width: poster.TW, height: poster.TH } };
  let depth = 0;
  return new Proxy(store, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        if (key === 'save') depth++;
        if (key === 'restore') depth = Math.max(0, depth - 1);
        if (log && typeof key === 'string') {
          const row = [key].concat(args);
          if (depth > 0) row.local = true;
          log.push(row);
        }
        return { width: String(args[0] == null ? '' : args[0]).length * 60, addColorStop() {} };
      };
    },
    set(target, key, v) { target[key] = v; return true; }
  });
}
const textsOf = (log) => log.filter((x) => x[0] === 'fillText').map((x) => String(x[1]));
/** 只取绝对坐标的 fillText —— local 的那批在 translate 里，坐标含义不同 */
const ysOf = (log) => log.filter((x) => x[0] === 'fillText' && !x.local).map((x) => Number(x[3]));
const imgsOf = (log) => log.filter((x) => x[0] === 'drawImage').length;

const tk = (id, date, city) => ({ id, date, city: city || '南京', title: '票' + id, im: { fake: 1 } });
const mk = (n) => {
  const list = [];
  for (let i = 0; i < n; i++) list.push(tk('t' + i, '2025-10-0' + (1 + (i % 4)), i % 2 ? '南京' : '苏州'));
  return list;
};
const view = (n, extra) => Object.assign({
  head: '10月1日 — 10月4日', stat: '4 天 · ' + n + ' 张票 · 2 座城',
  items: mk(n), total: n, capped: false, sig: ''
}, extra || {});

console.log('\n【一、抬头那几句必须画出来】');

t('标题、日期跨度、统计行都在图上', () => {
  const log = [];
  poster.render(fakeCtx(log), view(4));
  const all = textsOf(log).join('|');
  ok(all.indexOf('这一趟') >= 0, '图上没有标题「这一趟」');
  ok(all.indexOf('10月1日 — 10月4日') >= 0, '图上没有日期跨度');
  ok(all.indexOf('4 天 · 4 张票 · 2 座城') >= 0, '图上没有统计行');
  ok(all.indexOf('让时光有票为证') >= 0, '图上没有落款');
  ok(all.indexOf('@有票为证 · 你的时光档案馆') >= 0, '图上没有品牌水印（转出去就没了来处）');
});

t('署名：给了才画，没给不许画一条空的', () => {
  const withSig = textsOf((() => { const l = []; poster.render(fakeCtx(l), view(4, { sig: '阿宝' })); return l; })()).join('|');
  ok(withSig.indexOf('阿宝') >= 0, '给了署名却没画');
  const noSig = textsOf((() => { const l = []; poster.render(fakeCtx(l), view(4)); return l; })()).join('|');
  ok(noSig.indexOf('——') < 0, '没署名却画了一行破折号，图上会留一条空落款');
});

console.log('\n【二、张数不许说岔】');

t('挑过图时明说「共 N 张，图里挑了 6 张」', () => {
  const log = [];
  poster.render(fakeCtx(log), view(6, { total: 10, capped: true }));
  const all = textsOf(log).join('|');
  ok(all.indexOf('这一趟共 10 张') >= 0, '图上 6 张、实际 10 张，却没在图上交代 —— 这就是一句假话');
});

t('没挑过就不许说那句（不然是凭空多一句）', () => {
  const log = [];
  poster.render(fakeCtx(log), view(4));
  ok(textsOf(log).join('|').indexOf('图里挑了') < 0, '没挑过却说「图里挑了 6 张」');
});

console.log('\n【三、2 / 3 / 4 / 5 / 6 张都要排得下】');

[2, 3, 4, 5, 6].forEach((n) => {
  t(n + ' 张：文字都在画布内、照片都画上了、版式不压落款', () => {
    const log = [];
    const bottom = poster.render(fakeCtx(log), view(n));
    ysOf(log).forEach((y) => ok(y >= 0 && y <= poster.TH, n + ' 张时有文字跑到画布外（y=' + y + '）'));
    ok(imgsOf(log) === n, n + ' 张里只画上了 ' + imgsOf(log) + ' 张照片');
    ok(typeof bottom === 'number' && bottom > 0, 'render 没返回版式底部 y');
    ok(bottom <= poster.GRID_BOTTOM, n + ' 张的照片块伸出了照片区（bottom=' + Math.round(bottom) + '）');
    ok(bottom < 1340, n + ' 张时照片压到了落款（bottom=' + Math.round(bottom) + '）');
    ok(log.length > 60, n + ' 张时画的东西太少（' + log.length + ' 笔），八成是中途断了');
  });
});

console.log('\n【四、没有照片的票根也不能开天窗】');

t('票根没图时，框里得写上它的类型文字（不能留一块白）', () => {
  const log = [];
  const items = [{ id: 'x', date: '2025-10-01', city: '南京', typeText: '演出' },
    { id: 'y', date: '2025-10-02', city: '南京', typeText: '电影' }];
  poster.render(fakeCtx(log), view(2, { items }));
  ok(imgsOf(log) === 0, '没图却调了 drawImage');
  const all = textsOf(log).join('|');
  ok(all.indexOf('演出') >= 0 && all.indexOf('电影') >= 0, '没图的两张在图上什么都没写');
});

// —— 跑 ——
tests.forEach(([name, fn]) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
});
console.log('\n测试套件：trip_poster —— ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
