// scripts/dev/preview-card.js —— 把卡面画布录成 SVG 再光栅化成 PNG（开发期自检，不进小程序包）
// 用法：node scripts/dev/preview-card.js [风格名]
// 产物：dist/_card/<风格>.svg 与 <风格>.png，肉眼核版式用。
// ============================================================
// pages/card/card.js 顶上那段绘制代码是自包含的（只用到 date.js 的 weekday），
// 所以这里把「页面」那半段切掉、补一个 weekday，就能在 Node 里直接跑绘制函数。
// tests/card_postcard.test.js 也复用 loadDrawers()，保证测的就是真在跑的那段代码。
// ============================================================
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Recorder } = require('./canvas2svg.js');

const ROOT = path.resolve(__dirname, '../..');

/** 取出 card.js 的绘制半段并求值，返回 { DRAWERS, W, H } */
function loadDrawers() {
  const src = fs.readFileSync(path.join(ROOT, 'pages/card/card.js'), 'utf8');
  const cut = src.indexOf('// ---------- 页面 ----------');
  if (cut < 0) throw new Error('card.js 的「页面」分段标记没了，preview/test 都取不到绘制代码');
  // 画笔（roundRect / pinkedRect / wrapText / 花枝 / 星点…）在 utils/canvas-deco.js，
  // 是纯函数、不碰 wx.*，这里按绝对路径真 require 进来 —— 测的就是真在跑的那几支笔。
  const brush = path.join(ROOT, 'utils/canvas-deco.js').replace(/\\/g, '/');
  // 画布字体常量走的是 card.js 的 require，而下面那步会把所有 `const … require(…)` 行剥掉，
  // 所以得跟 weekday 一样在序言里补一份 —— 少了它，预览和测试都会报 FT is not defined
  const fontjs = path.join(ROOT, 'utils/font.js').replace(/\\/g, '/');
  const code = `
const weekday = (d) => ['周日','周一','周二','周三','周四','周五','周六'][new Date(String(d).replace(/-/g,'/')).getDay()] || '';
const annivYears = () => 0;
const FT = require('${fontjs}').CANVAS_TITLE;
const { wrapText, roundRect, pinkedRect, watercolorBlob, drawStar4, drawHeart, drawSprig, drawTape } = require('${brush}');
${src.slice(0, cut).replace(/^const .*require\(.*\);.*$/gm, '')}
return { DRAWERS, W, H, XHS_ART, XHS_W, XHS_H };
`;
  return new Function('require', code)(require);
}

/** 一张用来核版式的样例票根（照片与码用假对象占位，drawImage 在录制里落成灰框） */
const DEMO = {
  id: 'tk_078463',
  title: '夏夜 Livehouse',
  date: '2025-06-21',
  time: '20:00',
  city: '上海',
  venue: 'MAO Livehouse',
  seat: 'A区 12排 08座',
  price: '280',
  img: ''
};

/** 录一张卡 → SVG 文本 */
function render(key, t) {
  const { DRAWERS, W, H } = loadDrawers();
  const rec = new Recorder(W, H);
  DRAWERS[key](rec, t || DEMO, '有些夜晚值得被留下来，一遍一遍地放。',
    { width: 1200, height: 900 }, null, 0, { width: 200, height: 200 }, '');
  return { svg: rec.toSVG(), W, H };
}

/** 录一张小红书素材图（封面图 / 步骤图，1080×1440）→ SVG 文本 */
function renderXhs(key, t) {
  const { XHS_ART, XHS_W, XHS_H } = loadDrawers();
  const rec = new Recorder(XHS_W, XHS_H);
  XHS_ART[key](rec, t || DEMO, '有些夜晚值得被留下来，一遍一遍地放。',
    { width: 1200, height: 900 }, null, 0);
  return { svg: rec.toSVG(), W: XHS_W, H: XHS_H };
}

/** 写 SVG + 光栅化成 PNG（没装 resvg_py 就只留 SVG，不阻断） */
function emit(outDir, name, res) {
  const svgPath = path.join(outDir, name + '.svg');
  fs.writeFileSync(svgPath, res.svg, 'utf8');
  console.log('写出 ' + svgPath);
  const png = path.join(outDir, name + '.png');
  try {
    execFileSync('python', ['-c',
      `import resvg_py;open(r"${png.replace(/\\/g, '\\\\')}","wb").write(bytes(resvg_py.svg_to_bytes(svg_path=r"${svgPath.replace(/\\/g, '\\\\')}", width=${res.W})))`
    ], { stdio: 'inherit' });
    console.log('光栅化 ' + png);
  } catch (e) {
    console.log('（无 resvg_py，跳过光栅化：' + e.message + '）');
  }
}

module.exports = { loadDrawers, render, renderXhs, DEMO, ROOT };

if (require.main === module) {
  const OUT = path.join(ROOT, 'dist/_card');
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.argv[2];
  // node scripts/dev/preview-card.js xhs → 只出小红书那两张素材图（1080×1440）
  if (only === 'xhs') {
    Object.keys(loadDrawers().XHS_ART).forEach((k) => emit(OUT, 'xhs-' + k, renderXhs(k)));
  } else {
    Object.keys(loadDrawers().DRAWERS).forEach((key) => {
      if (only && only !== key) return;
      emit(OUT, key, render(key));
    });
  }
}
