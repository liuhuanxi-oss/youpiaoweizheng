// tests/theme_preview.test.js —— 主题页那张「微缩票根」的护栏（2026-09-16）
// ============================================================
// 【背景】theme 页每张卡顶部的图，从「六套共用一个戴渔夫帽的小人、只换背景色」
//   换成了该主题下的一张微缩票根。图形是手算坐标拼出来的 SVG，最容易犯三类错：
//     ① 坐标算出画布 —— 图形被裁掉一角，真机上只看到半张票根，且不报错
//     ② 主题色没传进去 —— 六张图长得一模一样，等于又变回「同一个东西看六遍」
//     ③ 拼串拼漏了 —— 画面上少一块，没有任何报错
//   本套逐条钉死。previewSrc 是纯函数，全部真跑（不扫源码猜行为）。
// ============================================================
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const themeUtil = require(path.resolve(__dirname, '../utils/theme.js'));
const deco = require(path.resolve(__dirname, '../utils/deco.js'));

const PREFIX = 'data:image/svg+xml;base64,';
const raw = (uri) => Buffer.from(String(uri).slice(PREFIX.length), 'base64').toString('utf8');
const META = themeUtil.THEME_META;
const byKey = (k) => META.find((t) => t.key === k);

const W = 320, H = 176;

/** 抠出 SVG 里每个 rect / circle 的包围盒（虚线那条 path 有意贴近卡片，不参与判定） */
function boxes(svgText) {
  const out = [];
  const re = /<(rect|circle)\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(svgText))) {
    const a = {};
    // 两种引号都要认：deco.js 里坐标拼的是双引号、fillOf/strokeOf 拼的是单引号
    m[2].replace(/([\w-]+)=["']([^"']*)["']/g, (_, k, v) => { a[k] = v; return ''; });
    const n = (v) => (v === undefined ? 0 : parseFloat(v));
    if (m[1] === 'rect') {
      out.push({ el: 'rect', a, x: n(a.x), y: n(a.y), w: n(a.width), h: n(a.height) });
    } else {
      const r = n(a.r);
      out.push({ el: 'circle', a, x: n(a.cx) - r, y: n(a.cy) - r, w: 2 * r, h: 2 * r });
    }
  }
  return out;
}

/** 按左上角坐标认领一个图元 —— 比「数第几个」稳，坐标一动就找不到，当场红 */
const at = (list, x, y) => list.find(
  (b) => Math.abs(b.x - x) < 0.6 && Math.abs(b.y - y) < 0.6
);

console.log('\n【一、六套主题都出得来，而且是真机认的形态】');

t('六套主题各生成一张 base64 data-uri', () => {
  ok(META.length === 6, '主题数变了：' + META.length);
  META.forEach((m) => {
    const u = deco.previewSrc(m);
    ok(u.startsWith(PREFIX), m.key + ' 没走 base64 底座（真机会整片不显示）');
    ok(u.length > 800, m.key + ' 的图太短，像是没画出东西：' + u.length);
  });
});

t('解回来是完整的 svg 骨架（viewBox / 尺寸都在）', () => {
  META.forEach((m) => {
    const s = raw(deco.previewSrc(m));
    ok(s.indexOf("viewBox='0 0 " + W + ' ' + H + "'") >= 0, m.key + ' 的 viewBox 不对');
    ok(/^<svg[\s>]/.test(s) && s.endsWith('</svg>'), m.key + ' 的 svg 骨架不完整');
  });
});

t('没传主题也不崩（回落色顶着，宁可颜色不对不能让整页白）', () => {
  const s = raw(deco.previewSrc(null));
  ok(s.indexOf('<svg') === 0, '缺参数时没出图');
  ok(s.indexOf('#F5F0E6') >= 0, '回落的背景色没进去');
});

console.log('\n【二、颜色真的随主题走（六张图不能长得一样）】');

// 断言必须认准「这块图用的是这个色」——只查「SVG 里出现过这个色」是不够的：
// 底色同时被两个缺口圆用着，铺底那层改成别的色也照样能通过。
t('铺底那一块用的就是主题底色', () => {
  META.forEach((m) => {
    const first = boxes(raw(deco.previewSrc(m)))[0];
    ok(first.x === 0 && first.y === 0 && first.w === W && first.h === H,
      m.key + ' 的第一块不是铺满画布的底');
    ok(String(first.a.fill).toUpperCase() === m.bg.toUpperCase(),
      m.key + ' 的底铺的是 ' + first.a.fill + '，不是主题底色 ' + m.bg);
  });
});

t('卡片 / 照片 / 票名 / 胶囊 四处各自吃到卡片色、柔光色、正文色、主色', () => {
  META.forEach((m) => {
    const b = boxes(raw(deco.previewSrc(m)));
    const cx = (x, y) => { const e = at(b, x, y); return e ? String(e.a.fill).toUpperCase() : '(这块没了)'; };
    ok(cx(22, 22) === m.card.toUpperCase(), m.key + ' 的卡片色不对：' + cx(22, 22));
    ok(cx(38, 50) === m.soft.toUpperCase(), m.key + ' 的照片位没用柔光色：' + cx(38, 50));
    ok(cx(124, 48) === m.text.toUpperCase(), m.key + ' 的票名条没用正文色：' + cx(124, 48));
    ok(cx(124, 102) === m.primary.toUpperCase(), m.key + ' 的标签胶囊没用主色：' + cx(124, 102));
  });
});

t('六套主题生成六个不同的串（参数漏传会当场露馅）', () => {
  const all = META.map((m) => deco.previewSrc(m));
  const uniq = new Set(all);
  ok(uniq.size === 6, '有主题生成了一模一样的图：' + (6 - uniq.size) + ' 处重复');
});

t('深浅两端必须明显不同：film（深底）与 minimal（纯白）', () => {
  const film = raw(deco.previewSrc(byKey('film')));
  const mini = raw(deco.previewSrc(byKey('minimal')));
  ok(film !== mini, '两张图完全相同');
  ok(film.indexOf('#1F1A17') >= 0 && mini.indexOf('#FFFFFF') >= 0, '深/浅主题的底色没各归各位');
});

console.log('\n【三、图形不许算出画布（手算坐标的护栏）】');

t('每个矩形与圆都在 ' + W + '×' + H + ' 画布内（留 1px 给描边）', () => {
  META.forEach((m) => {
    boxes(raw(deco.previewSrc(m))).forEach((b) => {
      ok(b.w > 0 && b.h > 0, m.key + ' 有个零面积的图元');
      ok(b.x >= -1 && b.y >= -1, m.key + ' 有图元跑到画布左上外面：x=' + b.x + ' y=' + b.y);
      ok(b.x + b.w <= W + 1, m.key + ' 有图元右边出界：' + (b.x + b.w) + ' > ' + W);
      ok(b.y + b.h <= H + 1, m.key + ' 有图元下边出界：' + (b.y + b.h) + ' > ' + H);
    });
  });
});

t('副券区（撕票线右侧）铺着条形码，且没顶到卡边', () => {
  // 撕票线 x=226，卡片右边界 298 —— 副券区是 226..298
  const s = raw(deco.previewSrc(byKey('paper')));
  const bars = boxes(s).filter((b) => b.x > 226 && b.x + b.w < 298 + 1 && b.h > 40);
  ok(bars.length === 8, '副券里的竖条数不对：' + bars.length + '（预期 8）');
  const wide = bars.reduce((n, b) => n + b.w, 0);
  ok(wide > 30, '条形码太细，看不出是条形码：条宽合计 ' + wide.toFixed(1));
  const last = bars[bars.length - 1];
  ok(last.x + last.w <= 298, '条形码右端顶出了卡片：' + (last.x + last.w));
});

t('图元数量对得上（少画一块要当场发现）', () => {
  const n = boxes(raw(deco.previewSrc(byKey('paper')))).length;
  // 底 1 + 卡片 1 + 照片 1 + 日头 1 + 票名 1 + 两行说明 2 + 胶囊 1
  // + 两个缺口 2 + 条形码 8 + 印章 1 = 19（山脊是 path，不在此列）
  ok(n === 19, '图元数变了：' + n + '（预期 19）—— 是不是漏画/多画了一块？');
});

console.log('\n【四、页面确实在用这张图（防改回去）】');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

t('theme.js 编译的是 previewSrc，不再是那个头像', () => {
  const js = read('pages/theme/theme.js');
  ok(/previewSrc:\s*deco\.previewSrc\(/.test(js), 'theme.js 没在用 previewSrc');
  ok(js.indexOf('avatarSrc') < 0, 'theme.js 里还留着 avatarSrc');
});

t('theme.wxml 渲染的是 item.previewSrc，且没有残留的头像节点', () => {
  const wxml = read('pages/theme/theme.wxml');
  ok(/src="\{\{item\.previewSrc\}\}"/.test(wxml), 'wxml 没引用 previewSrc');
  ok(wxml.indexOf('th-ip') < 0, 'wxml 里还留着 .th-ip 头像节点');
  ok(wxml.indexOf('avatarSrc') < 0, 'wxml 里还留着 avatarSrc');
});

t('预览区靠 padding-bottom 撑比例（写死高度的话窄屏会把票根拉扁）', () => {
  const wxss = read('pages/theme/theme.wxss');
  ok(/\.th-preview\s*\{[^}]*padding-bottom:\s*55%/.test(wxss), '没找到按比例撑开的写法');
  ok(wxss.indexOf('.th-ip') < 0, 'wxss 里还留着 .th-ip 的样式');
});

// —— 跑 ——
for (const [name, fn] of tests) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
