// tests/birthday_song.test.js —— 生日歌单（薛之谦）匹配引擎 + 版式
// ============================================================
// 为什么这套要单独写、而且必须真跑：
//   ① **「同一天永远同一首」是这个玩法的命门**。它一旦坏了，界面上看不出来 ——
//      用户今天看是《演员》，明天再来成了《绅士》，他不会报错，他会觉得「这玩意儿是随机的」
//      然后关掉。所以确定性只能靠断言守，不能靠肉眼。
//   ② 歌名是人工整理的，错一个字粉丝一眼就看出来 —— 重名、空串这类低级错误必须拦住。
//   ③ 分享图是**顺流排版**（歌名两行会把后面全推下去），而页脚是固定坐标：
//      哪天加了长歌名就会压到「微信搜…」上，图看着只是有点挤。这里用 366 天全跑一遍守它。
//   ④ 页面做了但没入口、按钮绑了不存在的方法，都是「看起来做完了」的典型死法 ——
//      这几条接线一起断言。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const engine = require('../utils/birthdaySong.js');
const poster = require('../pages/song/poster.js');

/** 每一个可能的生日（含 2/29）：366 天是这套东西的完整输入域，能全跑就别抽样 */
const ALL_DAYS = [];
engine.DAYS.forEach((n, i) => { for (let d = 1; d <= n; d++) ALL_DAYS.push([i + 1, d]); });

/**
 * 假的 CanvasRenderingContext2D：任何没写死的方法都当空操作，整串参数记进 log
 * （整串记才拿得到 fillText 的 y —— 它是第三个参数，只记 args[0] 会把文字当坐标）。
 * measureText 每字按 60px 算 —— 故意比真实字号宽，好让「歌名太长要折行」这条路径真被走到。
 */
function fakeCtx(log) {
  const store = { canvas: { width: poster.RW, height: poster.RH } };
  return new Proxy(store, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        if (log && typeof key === 'string') log.push([key].concat(args));
        return { width: String(args[0] == null ? '' : args[0]).length * 60, addColorStop() {} };
      };
    },
    set(target, key, v) { target[key] = v; return true; }
  });
}
const textsOf = (log) => log.filter((x) => x[0] === 'fillText').map((x) => String(x[1]));
/** log 一项 = [方法, 参数1, 参数2, …]，fillText 的 y 在第 4 位 */
const ysOf = (log) => log.filter((x) => x[0] === 'fillText').map((x) => Number(x[3]));

// ════════════════════════════════════════════════════════════
console.log('\n【一、歌单表（人工整理的那几张表）】');

t('12 个月 × 每月 3 首，共 36 首', () => {
  ok(engine.SONGS.length === 12, '月份数不是 12');
  engine.SONGS.forEach((list, i) => ok(list.length === 3, (i + 1) + ' 月不是 3 首'));
  ok(engine.total() === 36, '总数不是 36，实际 ' + engine.total());
});

t('歌名与意象句都不为空，且 36 首不重名', () => {
  const seen = new Set();
  engine.SONGS.forEach((list, i) => list.forEach((s) => {
    ok(s.t && s.t.trim(), (i + 1) + ' 月有首歌没名字');
    ok(s.img && s.img.length >= 8, '《' + s.t + '》的意象句太短或为空');
    ok(!seen.has(s.t), '歌名重复：《' + s.t + '》');
    seen.add(s.t);
  }));
  ok(seen.size === 36, '去重后不是 36 首');
});

t('12 个月的季节词与鼓励语都在', () => {
  engine.MONTHS.forEach((m, i) => {
    ok(m.label && m.label.length >= 2, (i + 1) + ' 月缺季节词');
    ok(m.scene && m.scene.length >= 6, m.label + ' 缺物候句');
    ok(m.cheer && m.cheer.length >= 8, m.label + ' 缺鼓励语');
  });
});

t('引擎不依赖任何运行环境（端上要能直接引，Node 里要能直接测）', () => {
  const src = read('utils/birthdaySong.js');
  ok(!/require\s*\(/.test(src), 'birthdaySong.js 里出现了 require —— 它必须是零依赖的纯数据 + 纯函数');
  ok(!/\bwx\./.test(src), 'birthdaySong.js 里出现了 wx. —— 那样就没法在 npm test 里跑');
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、确定性（命门：同一天永远同一首）】');

t('366 天连算两遍，结果逐字相同', () => {
  ALL_DAYS.forEach(([m, d]) => {
    const a = engine.match(m, d);
    const b = engine.match(m, d);
    ok(a && b && a.song.t === b.song.t, m + '/' + d + ' 两次算出来不是同一首');
  });
});

t('同月同日的两个对象也同歌（9/15 稳定为《演员》）', () => {
  ok(engine.match(9, 15).song.t === engine.match(9, 15).song.t, '同一参数结果不稳定');
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、覆盖与分布（366 天每天都要有歌，且不能挤在三首上）】');

t('366 天都有结果，且那首歌确实属于这个月', () => {
  ok(ALL_DAYS.length === 366, '输入域不是 366 天，实际 ' + ALL_DAYS.length);
  ALL_DAYS.forEach(([m, d]) => {
    const r = engine.match(m, d);
    ok(r, m + '/' + d + ' 没结果');
    ok(engine.SONGS[m - 1].some((s) => s.t === r.song.t), m + '/' + d + ' 配到了别的月份的《' + r.song.t + '》');
  });
});

t('每首歌至少被命中 5 天、最多 15 天（分布均匀）', () => {
  const hit = {};
  ALL_DAYS.forEach(([m, d]) => {
    const k = engine.match(m, d).song.t;
    hit[k] = (hit[k] || 0) + 1;
  });
  Object.keys(hit).forEach((k) => {
    ok(hit[k] >= 5, '《' + k + '》只覆盖 ' + hit[k] + ' 天 —— 偏少了');
    ok(hit[k] <= 15, '《' + k + '》占了 ' + hit[k] + ' 天 —— 有别的歌几乎轮不到');
  });
  ok(Object.keys(hit).length === 36, '有歌一首都没被翻到过');
});

t('每个月里的三首都轮到过（没有一首是摆设）', () => {
  for (let m = 1; m <= 12; m++) {
    const got = new Set();
    for (let d = 1; d <= engine.DAYS[m - 1]; d++) got.add(engine.match(m, d).song.t);
    ok(got.size === 3, m + ' 月只翻得出 ' + got.size + ' 首');
  }
});

t('理由里带着月份季节词与歌名（模板没拼错）', () => {
  ALL_DAYS.forEach(([m, d]) => {
    const r = engine.match(m, d);
    ok(r.reasonA.indexOf(r.label) >= 0 && r.reasonA.indexOf(m + ' 月') >= 0, m + '/' + d + ' 的理由缺月份');
    ok(r.reasonB.indexOf('《' + r.song.t + '》') >= 0, m + '/' + d + ' 的理由缺歌名');
    ok(r.cheer === engine.MONTHS[m - 1].cheer, m + '/' + d + ' 的鼓励语不是这个月的');
  });
});

// ════════════════════════════════════════════════════════════
console.log('\n【四、非法入参（选不出歌时不能编一首出来）】');

t('月份越界 / 日子超过当月天数 → null', () => {
  const bad = [[0, 1], [13, 1], [2, 30], [4, 31], [6, 31], [9, 0], ['', ''], [null, null], ['x', 'y']];
  bad.forEach(([m, d]) => ok(engine.match(m, d) === null, m + '/' + d + ' 本该是 null'));
});

t('2/29 有结果（闰日不能漏）', () => {
  ok(engine.match(2, 29), '2 月 29 日翻不出歌');
});

// ════════════════════════════════════════════════════════════
console.log('\n【五、接线（做了但进不去 = 没做）】');

t('app.json 注册了 pages/song/song', () => {
  ok(/"pages\/song\/song"/.test(read('app.json')), '页面没注册，编译都进不去');
});

t('「我的」页有入口，且 key 能路由到这一页', () => {
  const me = read('pages/me/me.js');
  const entry = /\{ key: 'song',[\s\S]*?\}/.exec(me);
  ok(entry, 'ENTRIES 里没有 song 这条');
  ok(/icon: 'music'/.test(entry[0]), '入口图标不是音符（utils/icons.js 里叫 music）');
  ok(/song: '\/pages\/song\/song'/.test(me), 'PAGE 映射里没有 song —— 点了不会跳');
});

t('页面里绑的事件都有对应的方法（按钮不能点空）', () => {
  const wxml = read('pages/song/song.wxml');
  const js = read('pages/song/song.js');
  const handlers = [];
  const re = /bind(?:tap|change|columnchange)="([A-Za-z0-9_]+)"/g;
  let m;
  while ((m = re.exec(wxml))) handlers.push(m[1]);
  ok(handlers.length >= 3, '只绑到 ' + handlers.length + ' 个事件，页面是不是没写完');
  handlers.forEach((h) => ok(new RegExp('\\n\\s*' + h + '\\s*\\(').test(js), 'song.wxml 绑了 ' + h + '，song.js 里没有这个方法'));
});

t('分享按钮与出图画布都在，画布 id 对得上', () => {
  const wxml = read('pages/song/song.wxml');
  const js = read('pages/song/song.js');
  ok(/open-type="share"/.test(wxml), '没有分享按钮 —— 玩法就断了唯一的传播口');
  const id = /id="([A-Za-z0-9_]+)"[^>]*class="canvas-off"/.exec(wxml);
  ok(id, '找不到屏外画布（没有它就不能出图）');
  ok(js.indexOf("select('#" + id[1] + "')") >= 0, 'js 里 select 的 id 与 wxml 对不上：' + id[1]);
});

t('分享场景 song 已注册，且生日写进了 path 与 query', () => {
  const share = read('utils/share.js');
  const s = /song: \{[\s\S]*?\n  \}/.exec(share);
  ok(s, 'share.js 的 SCENES 里没有 song');
  ok(/path:[\s\S]*?m=\$\{d\.m\}&d=\$\{d\.d\}/.test(s[0]), 'path 没带生日 —— 好友点开看到的是空选择器');
  ok(/query:[\s\S]*?m=\$\{d\.m\}&d=\$\{d\.d\}/.test(s[0]), 'query 没带生日 —— 朋友圈点开看不到那个结果');
  ok(/cover: ''/.test(s[0]), 'cover 不该是别的场景的封面图（那会挂上一张不相干的图）');
});

// ════════════════════════════════════════════════════════════
console.log('\n【六、分享图（顺流排版，366 天都不能压到页脚）】');

t('假画布上能画出整张图，歌名真被写进去了', () => {
  const log = [];
  const r = engine.match(9, 15);
  const bottom = poster.render(fakeCtx(log), Object.assign({ artist: engine.ARTIST }, r));
  const texts = textsOf(log);
  const all = texts.join(''); // 折了行的那几段要拼起来看（鼓励语在窄栏里会被拆成两行）
  ok(texts.some((x) => x.indexOf('《' + r.song.t + '》') >= 0), '海报上没画歌名');
  ok(all.indexOf(engine.ARTIST) >= 0, '海报上没写歌手');
  ok(all.indexOf('有票为证') >= 0, '海报上没有品牌 / 搜索词（别的平台只能照着手搜）');
  ok(all.indexOf(r.cheer) >= 0, '海报上没画鼓励语');
  ok(typeof bottom === 'number' && bottom > 0, 'render 没返回版式底部 y');
});

t('366 天逐天出图：文字不出画布、正文不压页脚', () => {
  ALL_DAYS.forEach(([m, d]) => {
    const log = [];
    const r = engine.match(m, d);
    const bottom = poster.render(fakeCtx(log), Object.assign({ artist: engine.ARTIST }, r));
    ysOf(log).forEach((y) => ok(y >= 0 && y <= poster.RH, m + '/' + d + ' 的文字落到了画布外（y=' + y + '）'));
    // 页脚（品牌 + 搜索词）固定在 1666，正文必须停在它上面
    ok(bottom < 1640, m + '/' + d + ' 的正文压到了页脚（bottom=' + Math.round(bottom) + '）');
    ok(log.length > 30, m + '/' + d + ' 画的东西太少，是不是渲染中断了');
  });
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
