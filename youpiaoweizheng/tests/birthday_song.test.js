// tests/birthday_song.test.js —— 生日歌单（多歌手）匹配引擎 + 版式
// ============================================================
// 为什么这套要单独写、而且必须真跑：
//   ① **「同一天 + 同一位歌手，永远同一首」是这个玩法的命门**。它一旦坏了，界面上看不出来 ——
//      用户今天看是《演员》，明天再来成了《绅士》，他不会报错，他会觉得「这玩意儿是随机的」
//      然后关掉。所以确定性只能靠断言守，不能靠肉眼。
//   ② 歌名是人工整理、又逐首联网核过的，错一个字粉丝一眼就看出来 ——
//      重名、空串、同一位歌手内部重名必须拦住（张冠李戴靠核对，测试拦不住，见引擎文件头）。
//   ③ 分享图是**顺流排版**（歌名两行会把后面全推下去），而页脚是固定坐标：
//      哪天加了长歌名就会压到「微信搜…」上，图看着只是有点挤。
//      所以是**每位歌手、366 天全跑一遍**，不是抽查 —— 歌手越多，长歌名的概率越大。
//   ④ 页面做了但没入口、按钮绑了不存在的方法、换了歌手结果不跟着换，
//      都是「看起来做完了」的典型死法 —— 这几条接线一起断言。
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
const share = require('../utils/share.js'); // 顶层不碰 wx，Node 里能直接跑（比正则断言强得多）

/** 每一位歌手 —— 全量遍历，不抽查：加一位歌手就自动多守一份 */
const WHO = engine.ARTISTS;
const NAMES = WHO.map((a) => a.name);

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
console.log('\n【一、歌手表与歌单表（人工整理 + 逐首联网核对的那几张表）】');

t('至少两位歌手，名字不空、不重', () => {
  ok(WHO.length >= 2, '只有 ' + WHO.length + ' 位歌手 —— 玩法页上的切换就没意义了');
  const seen = new Set();
  WHO.forEach((a) => {
    ok(a.name && a.name.trim(), '有歌手没名字');
    ok(!seen.has(a.name), '歌手重名：' + a.name);
    seen.add(a.name);
  });
  ok(engine.DEFAULT_ARTIST === WHO[0].name, '默认歌手不是第一位 —— 分享没带歌手时会落到哪儿就说不清了');
});

t('每位歌手都是 12 个月，且每月首数一致（不能有的月 3 首、有的月 2 首）', () => {
  WHO.forEach((a) => {
    ok(a.songs.length === 12, a.name + ' 的歌单不是 12 个月');
    const per = a.songs[0].length;
    ok(per >= 2, a.name + ' 每个月只有 ' + per + ' 首 —— 太少，那一天就没得匹配了');
    a.songs.forEach((list, i) => ok(list.length === per,
      a.name + ' 的 ' + (i + 1) + ' 月有 ' + list.length + ' 首，别的月是 ' + per + ' 首'));
    ok(engine.total(a.name) === per * 12, a.name + ' 的总数与每月首数对不上');
  });
});

t('每位歌手的歌名、意象句、鼓励语都不为空，且内部不重名', () => {
  WHO.forEach((a) => {
    const seen = new Set();
    a.songs.forEach((list, i) => list.forEach((s) => {
      ok(s.t && s.t.trim(), a.name + ' 的 ' + (i + 1) + ' 月有首歌没名字');
      ok(s.img && s.img.length >= 8, a.name + '《' + s.t + '》的意象句太短或为空');
      // 鼓励语是「贴这首歌」的，不是贴月份 —— 同月几首共用一句就等于没写
      ok(s.cheer && s.cheer.length >= 8, a.name + '《' + s.t + '》缺鼓励语或太短');
      ok(!seen.has(s.t), a.name + ' 内部歌名重复：《' + s.t + '》');
      seen.add(s.t);
    }));
    ok(seen.size === engine.total(a.name), a.name + ' 去重后的首数与歌单对不上');
  });
});

t('同一位歌手、同一个月份里各首歌的鼓励语互不相同（不共用一句）', () => {
  WHO.forEach((a) => {
    a.songs.forEach((list, i) => {
      const set = new Set(list.map((s) => s.cheer));
      ok(set.size === list.length, a.name + ' 的 ' + (i + 1) + ' 月有歌共用了同一句鼓励语');
    });
  });
});

t('12 个月的季节词与物候句都在', () => {
  engine.MONTHS.forEach((m, i) => {
    ok(m.label && m.label.length >= 2, (i + 1) + ' 月缺季节词');
    ok(m.scene && m.scene.length >= 6, m.label + ' 缺物候句');
  });
});

t('引擎不依赖任何运行环境（端上要能直接引，Node 里要能直接测）', () => {
  const src = read('utils/birthdaySong.js');
  ok(!/require\s*\(/.test(src), 'birthdaySong.js 里出现了 require —— 它必须是零依赖的纯数据 + 纯函数');
  ok(!/\bwx\./.test(src), 'birthdaySong.js 里出现了 wx. —— 那样就没法在 npm test 里跑');
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、确定性（命门：同一天同一位歌手，永远同一首）】');

t('每位歌手 366 天连算两遍，结果逐字相同', () => {
  WHO.forEach((a) => {
    ALL_DAYS.forEach(([m, d]) => {
      const x = engine.match(m, d, a.name);
      const y = engine.match(m, d, a.name);
      ok(x && y && x.song.t === y.song.t, a.name + ' ' + m + '/' + d + ' 两次算出来不是同一首');
    });
  });
});

t('换歌手不会串：同一组月日，各自的歌互不干扰', () => {
  ALL_DAYS.forEach(([m, d]) => {
    const got = NAMES.map((n) => engine.match(m, d, n));
    got.forEach((r, i) => ok(r && r.artist === NAMES[i], m + '/' + d + ' 给 ' + NAMES[i] + ' 返回了 ' + (r && r.artist)));
    // 每位歌手的结果都要来自他自己的表（借到别人的表 = 一次点击就穿帮）
    got.forEach((r, i) => ok(WHO[i].songs[m - 1].some((s) => s.t === r.song.t),
      m + '/' + d + ' 给 ' + NAMES[i] + ' 配了不属于他的《' + r.song.t + '》'));
  });
});

t('省略歌手名 = 默认歌手（老链接 / 没带歌手时不能瞎配）', () => {
  const a = engine.match(9, 15);
  const b = engine.match(9, 15, engine.DEFAULT_ARTIST);
  ok(a && b && a.song.t === b.song.t && a.artist === b.artist, '省略歌手名时没落到默认歌手');
});

t('歌手名不认识时回落到默认歌手，而不是空白', () => {
  const r = engine.match(9, 15, '张三');
  ok(r && r.artist === engine.DEFAULT_ARTIST, '链接里的歌手名过期 / 写错时，页面会翻不出任何东西');
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、覆盖与分布（366 天每天都要有歌，且不能挤在一两首上）】');

t('每位歌手 366 天都有结果，且那首歌确实属于这个月', () => {
  ok(ALL_DAYS.length === 366, '输入域不是 366 天，实际 ' + ALL_DAYS.length);
  WHO.forEach((a) => {
    ALL_DAYS.forEach(([m, d]) => {
      const r = engine.match(m, d, a.name);
      ok(r, a.name + ' ' + m + '/' + d + ' 没结果');
      ok(a.songs[m - 1].some((s) => s.t === r.song.t), a.name + ' ' + m + '/' + d + ' 配到了别的月份的《' + r.song.t + '》');
    });
  });
});

// 天数一律从 engine.DAYS 和歌单长度推，**不写死数字**：每月放 2 首还是 3 首是选歌时的自由
// （客户 2026-09-22 要求「冷门不要」，于是从 3 首压到 2 首），断言不该跟着改一遍。
t('每位歌手的每首歌都被翻到过，且同月内天数均匀（差不超过 1 天）', () => {
  WHO.forEach((a) => {
    const hit = {}; // 歌名 → 一年被命中多少天
    ALL_DAYS.forEach(([m, d]) => {
      const k = engine.match(m, d, a.name).song.t;
      hit[k] = (hit[k] || 0) + 1;
    });
    Object.keys(hit).forEach((k) => {
      // 每首歌只属于一个月：2 首/月时每首一年被翻到 14~16 天。给个宽松下限只为拦「白占位置」
      ok(hit[k] >= 2, a.name + '《' + k + '》只覆盖 ' + hit[k] + ' 天 —— 基本轮不到，等于白占一个位置');
    });
    ok(Object.keys(hit).length === engine.total(a.name), a.name + ' 有歌一首都没被翻到过');
    // 同月内各首天数最多差 1（`day % 歌数` 的天然结果）：
    // 哪天有人把取模改成手写映射、或歌单长度参差，这条会立刻报警
    for (let m = 1; m <= 12; m++) {
      const ds = a.songs[m - 1].map((s) => hit[s.t]);
      ok(Math.max.apply(null, ds) - Math.min.apply(null, ds) <= 1,
        a.name + ' 的 ' + m + ' 月里几首歌天数不均：' + ds.join(' / '));
    }
  });
});

t('每位歌手每个月里的几首都轮到过（没有一首是摆设）', () => {
  WHO.forEach((a) => {
    for (let m = 1; m <= 12; m++) {
      const got = new Set();
      for (let d = 1; d <= engine.DAYS[m - 1]; d++) got.add(engine.match(m, d, a.name).song.t);
      ok(got.size === a.songs[m - 1].length, a.name + ' 的 ' + m + ' 月只翻得出 ' + got.size + ' 首');
    }
  });
});

t('理由与鼓励语：模板没拼错，鼓励语来自这首歌而不是这个月', () => {
  WHO.forEach((a) => {
    ALL_DAYS.forEach(([m, d]) => {
      const r = engine.match(m, d, a.name);
      ok(r.reasonA.indexOf(r.label) >= 0 && r.reasonA.indexOf(m + ' 月') >= 0, a.name + ' ' + m + '/' + d + ' 的理由缺月份');
      ok(r.reasonB.indexOf('《' + r.song.t + '》') >= 0, a.name + ' ' + m + '/' + d + ' 的理由缺歌名');
      ok(r.cheer === r.song.cheer, a.name + ' ' + m + '/' + d + ' 的鼓励语不是这首歌的');
      ok(r.reasonB.indexOf(r.song.img) >= 0, a.name + ' ' + m + '/' + d + ' 的理由没带上意象句');
    });
  });
});

// ════════════════════════════════════════════════════════════
console.log('\n【四、非法入参（选不出歌时不能编一首出来）】');

t('月份越界 / 日子超过当月天数 → null', () => {
  const bad = [[0, 1], [13, 1], [2, 30], [4, 31], [6, 31], [9, 0], ['', ''], [null, null], ['x', 'y']];
  bad.forEach(([m, d]) => ok(engine.match(m, d) === null, m + '/' + d + ' 本该是 null'));
});

t('2/29 有结果（闰日不能漏）', () => {
  NAMES.forEach((n) => ok(engine.match(2, 29, n), '2 月 29 日翻不出歌：' + n));
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
  ok(handlers.length >= 4, '只绑到 ' + handlers.length + ' 个事件，页面是不是没写完');
  handlers.forEach((h) => ok(new RegExp('\\n\\s*' + h + '\\s*\\(').test(js), 'song.wxml 绑了 ' + h + '，song.js 里没有这个方法'));
});

t('页面上有歌手切换，且换了会就地重翻（不是只换个高亮）', () => {
  const wxml = read('pages/song/song.wxml');
  const js = read('pages/song/song.js');
  ok(/wx:for="\{\{artists\}\}"/.test(wxml), 'wxml 没有遍历歌手 —— 加了几位也只能玩第一位');
  ok(/bindtap="onWho"/.test(wxml), '歌手按钮没绑 onWho');
  ok(/artists:\s*engine\.names\(\)/.test(js), 'artists 不是从引擎取的（写死了歌手名，加歌手要改页面）');
  ok(/onWho\s*\(e\)/.test(js), 'song.js 里没有 onWho');
  // 换歌手必须重新 match，否则卡片上还是上一个歌手的歌
  ok(/onWho\s*\(e\)[\s\S]{0,700}?engine\.match\(/.test(js), 'onWho 里没有重新匹配 —— 换了歌手结果不会变');
});

t('分享按钮与出图画布都在，画布 id 对得上', () => {
  const wxml = read('pages/song/song.wxml');
  const js = read('pages/song/song.js');
  ok(/open-type="share"/.test(wxml), '没有分享按钮 —— 玩法就断了唯一的传播口');
  const id = /id="([A-Za-z0-9_]+)"[^>]*class="canvas-off"/.exec(wxml);
  ok(id, '找不到屏外画布（没有它就不能出图）');
  ok(js.indexOf("select('#" + id[1] + "')") >= 0, 'js 里 select 的 id 与 wxml 对不上：' + id[1]);
});

t('分享链接带生日 + 歌手，好友点开是同一天同一位歌手的同一个结果', () => {
  const d = { m: 9, d: 15, song: '演员', artist: '周杰伦' };
  const msg = share.message('song', d);
  ok(msg.path.indexOf('m=9&d=15') >= 0, 'path 没带生日 —— 好友点开看到的是空选择器');
  ok(msg.path.indexOf('a=' + encodeURIComponent('周杰伦')) >= 0, 'path 没带歌手 —— 好友看到的会是另一位歌手的歌');
  ok(msg.title.indexOf('周杰伦') >= 0 && msg.title.indexOf('演员') >= 0, '标题里没有歌手或歌名');
  const tl = share.timeline('song', d);
  ok(tl.query.indexOf('a=' + encodeURIComponent('周杰伦')) >= 0, '朋友圈 query 没带歌手');
  ok(tl.query.indexOf('m=9&d=15') >= 0, '朋友圈 query 没带生日');
  // 没有歌手时不能编一个出来
  const no = share.message('song', { m: 9, d: 15, song: '演员' });
  ok(no.path.indexOf('&a=') < 0, '没传歌手却拼了个空的 a= 参数');
  ok(/cover: ''/.test(read('utils/share.js')), 'cover 不该是别的场景的封面图（那会挂上一张不相干的图）');
});

t('页面 onLoad 会把链接里的中文歌手名解回来', () => {
  const js = read('pages/song/song.js');
  ok(/decodeURIComponent\(o\.a\)/.test(js), 'onLoad 没解码歌手名 —— 中文会乱码，回落到默认歌手');
  ok(/engine\.names\(\)\.indexOf\(/.test(js), 'onLoad 没校验歌手名是否合法');
  ok(/engine\.match\(m, d, artist\)/.test(js), 'onLoad 没有把歌手名传进匹配');
});

// ════════════════════════════════════════════════════════════
console.log('\n【六、分享图（顺流排版，每位歌手 366 天都不能压到页脚）】');

t('假画布上能画出整张图：歌名、歌手、品牌、鼓励语都在', () => {
  NAMES.forEach((n) => {
    const log = [];
    const r = engine.match(9, 15, n);
    const bottom = poster.render(fakeCtx(log), r);
    const texts = textsOf(log);
    const all = texts.join(''); // 折了行的那几段要拼起来看（鼓励语在窄栏里会被拆成两行）
    ok(texts.some((x) => x.indexOf('《' + r.song.t + '》') >= 0), n + ' 的海报上没画歌名');
    ok(all.indexOf(n) >= 0, '海报上没写歌手（现在是 ' + n + '，画布上却是别人）');
    ok(all.indexOf('有票为证') >= 0, '海报上没有品牌 / 搜索词（别的平台只能照着手搜）');
    ok(all.indexOf(r.cheer) >= 0, '海报上没画鼓励语');
    ok(typeof bottom === 'number' && bottom > 0, 'render 没返回版式底部 y');
  });
});

t('每位歌手 366 天逐天出图：文字不出画布、正文不压页脚', () => {
  WHO.forEach((a) => {
    ALL_DAYS.forEach(([m, d]) => {
      const log = [];
      const r = engine.match(m, d, a.name);
      const bottom = poster.render(fakeCtx(log), r);
      ysOf(log).forEach((y) => ok(y >= 0 && y <= poster.RH, a.name + ' ' + m + '/' + d + ' 的文字落到了画布外（y=' + y + '）'));
      // 页脚（品牌 + 搜索词）固定在 1666，正文必须停在它上面
      ok(bottom < 1640, a.name + ' ' + m + '/' + d + ' 的正文压到了页脚（bottom=' + Math.round(bottom) + '）');
      ok(log.length > 30, a.name + ' ' + m + '/' + d + ' 画的东西太少，是不是渲染中断了');
    });
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
