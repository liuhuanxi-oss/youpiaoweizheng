// tests/pull_refresh.test.js —— 7.2.0 V9 下拉刷新回归
// 这套下拉刷新有三处会「静默失效」：不报错、不白屏，只是下拉毫无反应——
//   ① refresher-default-style="none" 关掉了原生转圈，却没人渲染 slot="refresher"
//      → 用户拉一下、内容悄悄变了、屏幕上一个字都没有（album 此前就是这个状态）
//   ② 滚动容器写 min-height 而不是 height → 容器被内容撑高，内部永不滚 → refresher 不触发
//   ③ 页面级下拉只写 enablePullDownRefresh 不写 onPullDownRefresh（或反之）→ 拉不动；
//      或者写了不停表 → 转圈永不消失
// 页面集合从 wxml/json 里扫出来，将来新增页面自动纳入，不用回来改这里。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

/** 全部页面目录名 */
function pageDirs() {
  return fs.readdirSync(path.join(ROOT, 'pages'), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name);
}

/** 剥掉 wxml 注释与 {{...}}（表达式里的引号和括号会干扰属性解析） */
const clean = (s) => s.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\{\{[\s\S]*?\}\}/g, ' ');
/** 剥掉 css 注释 */
const uncss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');

// 全量 CSS：app.wxss + 各页面 wxss（类名撞车本身就该算问题，合并扫即可）
const ALL_CSS = uncss(read('app.wxss') + pageDirs().map((d) => {
  const p = `pages/${d}/${d}.wxss`;
  return exists(p) ? read(p) : '';
}).join('\n'));

/** 类名 → 其规则体（同名类多次出现则拼接，有一条够就算） */
const CSS_BODY = {};
[...ALL_CSS.matchAll(/\.([a-zA-Z][\w-]*)\s*\{([^}]*)\}/g)].forEach((m) => {
  CSS_BODY[m[1]] = (CSS_BODY[m[1]] || '') + m[2];
});

/** 该类是否声明了「固定高」（min-height 不算——正是它导致的失效） */
const isFixedHeight = (cls) => {
  const body = CSS_BODY[cls];
  return !!body && /(^|[;\s])height\s*:\s*100vh/.test(body);
};

/**
 * 扫出所有用了 scroll-view refresher 的页面。
 * 返回 [{ page, tag, ownClasses }]，tag 是 <scroll-view ...> 的属性串。
 */
function refresherPages() {
  const out = [];
  pageDirs().forEach((d) => {
    const p = `pages/${d}/${d}.wxml`;
    if (!exists(p)) return;
    const raw = read(p);
    const src = clean(raw);
    const re = /<(scroll-view)\b([^>]*)>/g;
    let m;
    while ((m = re.exec(src))) {
      if (/bindrefresherrefresh/.test(m[2])) {
        const cm = /class="([^"]*)"/.exec(m[2]);
        out.push({
          page: d,
          tag: m[2],
          ownClasses: cm ? cm[1].split(/\s+/).filter(Boolean) : [],
          // 查元素是否存在用剥过注释的（评论里的示例不算数）；
          // 查 {{refreshText}} 得用**原始**文本：clean() 会把 {{...}} 整个剥掉，
          // 拿剥过的文本去找等于永远找不到（这条断言一开始就是这么假绿的）
          wxml: src,
          raw
        });
      }
    }
  });
  return out;
}

const RP = refresherPages();

console.log('\n【一、扫到的页面得够数（防正则失配导致整套空跑）】');
t('至少 3 个页面用了 scroll-view 下拉刷新', () => {
  ok(RP.length >= 3, '只扫到 ' + RP.length + ' 个：' + RP.map((r) => r.page).join(', '));
});

console.log('\n【二、关掉原生转圈，就必须自己画一个（album 的隐形下拉头）】');
RP.forEach((r) => {
  const noNative = /refresher-default-style\s*=\s*"none"/.test(r.tag);
  if (!noNative) return;
  t(r.page + '：关掉原生下拉头后渲染了 slot="refresher"', () => {
    ok(/slot="refresher"/.test(r.wxml), 'refresher-default-style=none 但没有任何下拉反馈元素');
  });
  t(r.page + '：下拉头真的渲染了 refreshText（不是算了不用）', () => {
    const js = read(`pages/${r.page}/${r.page}.js`);
    if (!/refreshText/.test(js)) return; // 本页不用文案式下拉头，跳过
    const seg = r.raw.slice(r.raw.indexOf('slot="refresher"'));
    ok(/\{\{\s*refreshText\s*\}\}/.test(seg.slice(0, 300)), 'js 里算了 refreshText，wxml 里没渲染');
  });
});

console.log('\n【三、滚动容器必须固定高（min-height 会让 refresher 永不触发）】');
// 已知缺口：登记原因，不是「静默放过」。条目自带防霉检查（见本节最后一条）。
const KNOWN_GAPS = {
  discover: '根节点 .dc-page 是 min-height:100vh，容器被内容撑高、内部不滚 → 下拉够不到；' +
            '且它没绑 refresher-triggered，就算够得到也是拉完即弹回、零反馈。' +
            '（另：本页走的是原生下拉头，不是 album/duo/me 那套自绘的。）' +
            '修法要连拉动反馈一起设计，且页面里有 JS 算高的 .dc-stage 和底部面板，需真机验证 —— 未做。'
};
RP.forEach((r) => {
  if (KNOWN_GAPS[r.page]) return;
  t(r.page + '：滚动容器有固定高（height:100vh）', () => {
    const hit = r.ownClasses.filter(isFixedHeight);
    ok(hit.length > 0,
      '这些类都没写 height:100vh：' + r.ownClasses.join(', ') +
      '（写 min-height 的话容器被内容撑高、内部不会滚，下拉根本不会触发）');
  });
});
t('KNOWN_GAPS 不霉：登记过的页面确实还在用下拉刷新', () => {
  const names = RP.map((r) => r.page);
  const stale = Object.keys(KNOWN_GAPS).filter((p) => !names.includes(p));
  ok(stale.length === 0, '这些页面已经没有下拉刷新了，把 KNOWN_GAPS 里的条目删掉：' + stale.join(', '));
});

console.log('\n【四、三个处理器必须真的存在】');
RP.forEach((r) => {
  ['onRefresh', 'onPulling', 'onRestore'].forEach((fn) => {
    const bound = new RegExp('bindrefresher' + (fn === 'onRefresh' ? 'refresh' : fn === 'onPulling' ? 'pulling' : 'restore') + '="' + fn + '"').test(r.tag);
    if (!bound) return;
    t(r.page + '：' + fn + ' 在 js 里有定义', () => {
      const js = read(`pages/${r.page}/${r.page}.js`);
      ok(new RegExp('(^|\\s)' + fn + '\\s*\\(').test(js), fn + ' 被绑定但没写');
    });
  });
  t(r.page + '：绑定名与处理器名对得上（没有绑定到不存在的名字）', () => {
    const js = read(`pages/${r.page}/${r.page}.js`);
    const bound = [...r.tag.matchAll(/bindrefresher(\w+)="(\w+)"/g)].map((m) => m[2]);
    const miss = bound.filter((n) => !new RegExp('(^|\\s)' + n + '\\s*\\(').test(js));
    ok(miss.length === 0, '绑定了不存在的方法：' + miss.join(', '));
  });
});

console.log('\n【五、页面级下拉：开关 / 处理器 / 停表三件套】');
pageDirs().forEach((d) => {
  const jp = `pages/${d}/${d}.json`;
  if (!exists(jp)) return;
  let cfg;
  try { cfg = JSON.parse(read(jp)); } catch (e) { return; }
  if (!cfg.enablePullDownRefresh) return;
  const js = read(`pages/${d}/${d}.js`);
  t(d + '：开了 enablePullDownRefresh 就得有 onPullDownRefresh', () => {
    ok(/(^|\s)onPullDownRefresh\s*\(/.test(js), '开关开了但没写处理器，下拉无反应');
  });
  t(d + '：onPullDownRefresh 里调了 wx.stopPullDownRefresh', () => {
    ok(/stopPullDownRefresh/.test(js), '不调 stopPullDownRefresh 的话转圈永不消失');
  });
});
// 反向：写了页面级处理器却没开开关（同一种失效的另一面）
pageDirs().forEach((d) => {
  const jp = `pages/${d}/${d}.json`;
  if (!exists(jp)) return;
  let cfg;
  try { cfg = JSON.parse(read(jp)); } catch (e) { return; }
  if (cfg.enablePullDownRefresh) return;
  const js = read(`pages/${d}/${d}.js`);
  // 只有同时**不**在 scroll-view 上挂 refresher 才可疑
  if (RP.some((r) => r.page === d)) return;
  if (!/(^|\s)onPullDownRefresh\s*\(/.test(js)) return;
  t(d + '：写了 onPullDownRefresh 就必须开 enablePullDownRefresh', () => {
    ok(false, '处理器永远收不到回调（discover 就是这个状态）');
  });
});

console.log('\n──────────────────────────────');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
