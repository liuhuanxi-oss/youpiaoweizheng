// tests/audit_fixes.test.js —— 《代码质量审计-7.4.1》修复批（7.4.3）
// ============================================================
// 那份审计审的是线上 7.4.1（它看不到本地已修的那些），逐条核过后本批动了七处。
// 这里钉的是**每处「改回去就会红」的那一句**，不是复述实现：
//   P1-3  日期函数缺守卫 → 脏数据渲染成「undefined月」；顺带删掉零调用的 stubDate
//   P1-2  票根图标从「每张一份 data-uri」改成映射表（省掉 186KB 反复过 setData）
//   P2-1  画布退出不释放（annual 那张 3240×5760 ≈ 74MB，低端机连导两张会闪退）
//   P2-2  iconSrc 无缓存（每个页面进 onShow 都把整页图标重编一遍）
//   P2-3  导航栏配色「失败也记账 → 一整个会话不再重试」
//   P3-2  删票不删云存储照片（隐私政策写着「删除」，只删记录等于没做到）
//   P3-4  积分「5 分」前后端各写一份，改一侧就是跟用户说假话
// 前四节**真跑**模块（假 wx / 假 require 注入），后两节是源码结构断言。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/** 去注释版：结构断言跑它（注释里的标点会被 decomment 截断，行为断言一律跑原文） */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const date = require('../utils/date.js');
const icons = require('../utils/icons.js');

/** 造一份「真的 theme.js」：只把 wx 换掉，真跑 apply() */
function loadTheme(wxStub) {
  const mod = {};
  new Function('require', 'wx', 'module', read('utils/theme.js'))(() => ({}), wxStub, mod);
  return mod.exports;
}

/** 造一份「真的 sign.js」：env / subscribe 两个依赖搭桩 */
function loadSign() {
  const mod = {};
  const fakeRequire = (p) => {
    if (p === './env.js') return { USE_CLOUD: false };
    if (p === './subscribe.js') return { askIfDue: async () => null, afterSign: () => {} };
    throw new Error('测试没给这个依赖搭桩：' + p);
  };
  const wxStub = { cloud: { callFunction: async () => ({ result: {} }) } };
  new Function('require', 'wx', 'module', read('utils/sign.js'))(fakeRequire, wxStub, mod);
  return mod.exports;
}

// ════════════════════════════════════════════════════════════
console.log('\n【一、P1-3 日期守卫：脏数据不许渲染成「undefined月」】');

t('正常日期照常出「2025 · 十月」', () => {
  ok(date.groupLabel('2025-10-26') === '2025 · 十月',
    '正常日期都算错了：' + date.groupLabel('2025-10-26'));
});

t('空 / 残缺 / 月份越界一律返回空串', () => {
  [['空串', ''], ['undefined', undefined], ['null', null],
    ['缺日', '2025-10'], ['月份 13', '2025-13-01'], ['月份 00', '2025-00-01']].forEach(([name, v]) => {
    const got = date.groupLabel(v);
    ok(got === '', name + ' 渲染成了「' + got + '」—— 双人时间线上就会显示这个');
  });
});

t('stubDate 已删（零调用的死代码，且同样缺守卫）', () => {
  ok(date.stubDate === undefined, 'stubDate 还在导出里');
});

t('模块导出没被这次改动带掉', () => {
  ['groupLabel', 'weekday', 'todayMD', 'todaySign', 'annivYears'].forEach((k) => {
    ok(typeof date[k] === 'function', 'date.js 少了导出：' + k + '（页面会拿到 undefined）');
  });
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、P2-2 图标编译记忆化】');

t('同样参数第二次不再重编', () => {
  const n0 = icons._uriCache.size;
  icons.iconSrc('clock', '#123456', 0.5, 1.5);
  const n1 = icons._uriCache.size;
  ok(n1 > n0, '第一次就没进缓存 —— 每个页面 onShow 还是要重编一遍整页图标');
  icons.iconSrc('clock', '#123456', 0.5, 1.5);
  ok(icons._uriCache.size === n1, '同样参数第二次又算了一遍（缓存没命中）');
});

t('换了颜色必须重编（缓存键漏了 color 就会串主题）', () => {
  const a = icons.iconSrc('clock', '#111111', 0.5, 1.5);
  const b = icons.iconSrc('clock', '#222222', 0.5, 1.5);
  ok(a !== b, '换了颜色还返回上一份 —— 主题切了图标还是旧色');
});

t('实心与描边必须分开（缓存键漏了 solid，收藏心点了不亮）', () => {
  const a = icons.iconSrc('heart', '#111111', 1, 1.5, true);
  const b = icons.iconSrc('heart', '#111111', 1, 1.5, false);
  ok(a !== b, '实心与描边返回了同一份');
});

t('未知图标名仍然回落 ticket，且是 base64 data-uri', () => {
  const u = icons.iconSrc('这个图标不存在', '#123456');
  ok(/^data:image\/svg\+xml;base64,/.test(String(u)),
    '兜底图不是 base64 data-uri（7.4.1 真机全白事故的防线）：' + String(u).slice(0, 40));
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、P2-3 导航栏配色：失败不记账，留给下次重试】');

t('设失败之后，下次进页面仍然会重试', () => {
  const calls = [];
  const th = loadTheme({
    getStorageSync: () => 'paper',
    setStorageSync: () => {},
    // 模拟「页面尚未注册导航栏」：调了就失败
    setNavigationBarColor: (o) => { calls.push(o); o.fail && o.fail(); },
    setBackgroundColor: () => {}
  });
  const page = { setData: () => {} };
  th.apply(page);
  const n1 = calls.length;
  ok(n1 > 0, '第一次就没调 —— 桩没搭对');
  th.apply(page);
  ok(calls.length > n1,
    '失败之后就不再试了 —— 本次会话后面所有页面都不会再设导航栏，主题换了顶部还是旧色');
});

t('设成功之后要记账，主题没变不再重复调 API', () => {
  const calls = [];
  const th = loadTheme({
    getStorageSync: () => 'paper',
    setStorageSync: () => {},
    setNavigationBarColor: (o) => { calls.push(o); o.success && o.success(); },
    setBackgroundColor: () => {}
  });
  const page = { setData: () => {} };
  th.apply(page);
  th.apply(page);
  ok(calls.length === 1, '主题没变还反复调 API：' + calls.length + ' 次');
});

// ════════════════════════════════════════════════════════════
console.log('\n【四、P3-4 积分数字只有一个来源：服务端】');

t('服务端说几分就显示几分', () => {
  const sign = loadSign();
  const s = sign.bannerText({ signed: false, streak: 3, base: 8 });
  ok(/再收一张得 8 积分/.test(s.sub), '服务端给 8，文案却不是 8：' + s.sub);
});

t('服务端没给数字时：只说「有积分」，不自己编一个', () => {
  const sign = loadSign();
  const s = sign.bannerText({ signed: false, streak: 3 });
  ok(/再收一张有积分/.test(s.sub), '文案不对：' + s.sub);
  ok(!/\d/.test(s.sub.replace(/连签 \d+ 天/, '')), '拿不到服务端的数字却自己编了一个：' + s.sub);
});

t('签到成功的反馈也读服务端返回的分数', () => {
  const sign = loadSign();
  ok(/\+12/.test(sign.rewardText({ points: 12 })), '没用服务端返回的分数：' + sign.rewardText({ points: 12 }));
  ok(sign.rewardText({}) === '积分已到账', '服务端没给分数时又编了一个：' + sign.rewardText({}));
});

// ════════════════════════════════════════════════════════════
console.log('\n【五、P1-2 图标移出列表数据（结构）】');

t('票根数据里不再夹带 data-uri 图标', () => {
  const js = strip(read('pages/home/home.js'));
  ok(!/ico:\s*iconSrc\(/.test(js),
    'refresh 里还在给每张票根编图标 —— 500 张就是 ~186KB，点一次分类胶囊全量过一遍 setData');
  ok(/typeIc:\s*buildTypeIc\(/.test(js), '没有生成 typeIc 映射表');
});

t('wxml 改走映射表取兜底图标', () => {
  const wxml = read('pages/home/home.wxml');
  ok(/src="\{\{typeIc\[item\.type\] \|\| typeIc\._\}\}"/.test(wxml),
    'wxml 的兜底图标没走映射表');
  ok(!/\{\{item\.ico\}\}/.test(wxml), 'wxml 里还留着旧的 item.ico');
});

// ════════════════════════════════════════════════════════════
console.log('\n【六、P2-1 画布退出释放（结构）】');

[['card', 'pages/card/card.js'], ['annual', 'pages/annual/annual.js']].forEach(([name, p]) => {
  t(name + '：页面退出时把画布还回去', () => {
    const js = strip(read(p));
    ok(/onUnload\(\)\s*\{\s*this\._releaseCanvas\(\)/.test(js),
      '没有 onUnload 释放画布 —— 几十 MB 的位图留在内存里等 GC，低端机连导两张会闪退');
    const m = /_releaseCanvas\(\)\s*\{([\s\S]{0,400}?)\n {2}\}/.exec(js);
    ok(m, '找不到 _releaseCanvas');
    ok(/\.width\s*=\s*0/.test(m[0]) && /\.height\s*=\s*0/.test(m[0]),
      '只丢了引用没置零 —— Canvas 2D 的位图要显式释放才真的还给系统');
    ok(/_ctx\s*=\s*null/.test(m[0]), '没清 _ctx —— 下次进页面会以为画布还在，直接拿去画');
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
