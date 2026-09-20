// tests/type_keys.test.js —— 8.1.6 票根类型白名单：四处必须是同一份口径
// ============================================================
// 【为什么单开一套】「类型」这个值要在四个地方各判一次：
//   ① 识别端规则正则（cloudfunctions/recognizeTicket/parser.js 的 matchType）
//   ② 端上大模型结果的清洗（utils/ai.js 的 TYPE_OK）
//   ③ **入库白名单**（cloudfunctions/saveTicket/index.js）—— 这一处不认就静默打回 show
//   ④ 端上表单（pages/scan/scan.js 的 TYPE_KEYS / TYPE_ICONS）
// 任何一处漏了，现象都是「我选的是旅行，存进去变成演出」，而且**不报错**。
// 「旅行」就是这么一直空着的：首页那枚筛选胶囊从上线起没筛出过任何一张票，
// 而它看起来只是「还没人传过旅行的票」。
//
// 【断言为什么分两种】parser 是纯模块（不依赖 wx-server-sdk），能真跑就真跑；
// 其余几处散在端上与云端、形态各异，扫源码钉住「这一处也提到 travel」——
// 不是扫着玩：漏一处不会报错，只会静默归错类，正是这类 bug 最难被发现的原因。
// ============================================================
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const parser = require(path.join(ROOT, 'cloudfunctions/recognizeTicket/parser.js'));

console.log('\n【一、识别端：真跑 matchType】');

t('景区 / 乐园 / 酒店这类票面，认得成「旅行」', () => {
  const cases = [
    ['故宫博物院 门票', 'travel'],
    ['上海迪士尼乐园 一日票', 'travel'],
    ['如家酒店 入住单', 'travel'],
    ['黄山风景区 索道票', 'travel']
  ];
  cases.forEach(([line, want]) => {
    const got = parser.matchType(line);
    ok(got === want, '「' + line + '」判成了 ' + got + '，该是 ' + want);
  });
});

t('演出 / 电影 / 交通还是各归各的 —— 不许被「旅行」抢走', () => {
  const cases = [
    ['五月天 演唱会 门票', 'show'],
    ['万达影城 3 号厅', 'movie'],
    ['G1234 北京南 候车', 'traffic']
  ];
  cases.forEach(([line, want]) => {
    const got = parser.matchType(line);
    ok(got === want, '「' + line + '」判成了 ' + got + '，该是 ' + want);
  });
});

t('parse 全链路也能出 travel（不只是 matchType 单独成立）', () => {
  const d = parser.parse(['上海迪士尼乐园', '2024-05-01', '成人票 499']);
  ok(d.type === 'travel', '整条解析出来的 type 是 ' + d.type);
});

console.log('\n【二、四处白名单都认 travel】');

t('入库白名单认 travel —— 不认就静默打回 show，端上毫无提示', () => {
  const src = read('cloudfunctions/saveTicket/index.js');
  const m = src.match(/\[\s*'show'\s*,\s*'movie'\s*,\s*'traffic'\s*,\s*'travel'\s*\]/);
  ok(m, 'saveTicket 的入库白名单里没有 travel —— 用户选了旅行，存进去会变成演出');
});

t('端上大模型清洗认 travel（TYPE_OK）', () => {
  const src = read('utils/ai.js');
  ok(/TYPE_OK\s*=\s*\[[^\]]*'travel'/.test(src), 'utils/ai.js 的 TYPE_OK 少了 travel，AI 判出来的旅行会被打回 show');
});

t('给大模型的提示词里也写着四选一（否则它根本不会返回 travel）', () => {
  const src = read('utils/ai.js');
  ok(/show或movie或traffic或travel|show\/movie\/traffic\/travel/.test(src), '提示词里的 type 还是三选一');
  ok(/travel=/.test(src), '提示词没告诉模型 travel 是什么（景区/酒店/门票）');
});

console.log('\n【三、端上表单：用户能选到，也能看到】');

t('scan 的类型清单里有 travel', () => {
  const src = read('pages/scan/scan.js');
  ok(/TYPE_KEYS\s*=\s*\[[^\]]*'travel'/.test(src), 'scan 的 TYPE_KEYS 少了 travel —— 用户选不到，只能被识别成什么算什么');
  ok(/TYPE_ICONS\s*=\s*\{[^}]*travel/.test(src), 'scan 的 TYPE_ICONS 少了 travel（选了旅行会没有图标）');
});

t('TYPE_TEXT 四类齐全（scan / detail / album 都读这一份）', () => {
  const mock = require(path.join(ROOT, 'utils/mock.js'));
  ['show', 'movie', 'traffic', 'travel'].forEach((k) => {
    ok(mock.TYPE_TEXT[k], 'utils/mock.js 的 TYPE_TEXT 少了 ' + k);
  });
});

console.log('\n【四、每个按类型取图标的地方都不能漏 travel】');

t('各页的 TYPE_ICONS 都有 travel 分支', () => {
  ['pages/home/home.js', 'pages/album/album.js', 'pages/annual/annual.js', 'pages/duo/duo.js'].forEach((f) => {
    ok(/TYPE_ICONS\s*=\s*\{[^}]*travel/.test(read(f)), f + ' 的 TYPE_ICONS 少了 travel');
  });
});

t('回忆地图的票根行图标（rowIc）也有 travel', () => {
  ok(/rowIc:\s*\{[\s\S]{0,300}?travel/.test(read('pages/discover/discover.js')), 'discover 的 rowIc 少了 travel');
});

t('三个页面自己的 TYPE_TEXT 副本也都有 travel（它们是各写各的）', () => {
  ['pages/annual/annual.js', 'pages/report/report.js', 'pages/timeline/timeline.js'].forEach((f) => {
    ok(/TYPE_TEXT\s*=\s*\{[^}]*travel/.test(read(f)), f + ' 的 TYPE_TEXT 副本少了 travel');
  });
});

t('时光报告的类型分布也统计 travel（它按白名单累加，漏了就被静默丢掉）', () => {
  const src = read('pages/report/report.js');
  ok(/counts\s*=\s*\{[^}]*travel/.test(src), 'report 的 counts 少了 travel —— 旅行票在类型分布里等于不存在');
  ok(/known\s*=[^;]*travel/.test(src), 'report 的 known（分母）没算 travel，占比会不到 100%');
});

// —— 跑 ——
tests.forEach(([name, fn]) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
});
console.log('\n测试套件：type_keys —— ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
