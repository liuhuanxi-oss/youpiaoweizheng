// scripts/dev/preview-annual.js —— 把年报海报录成 SVG 再光栅化成 PNG（开发期自检，不进小程序包）
// 用法：node scripts/dev/preview-annual.js
// 产物：dist/_annual/poster.svg 与 poster.png，肉眼核版式用。
// ============================================================
// pages/annual/poster.js 是纯绘制、不碰 wx.*，所以能在 Node 里直接跑。
// 照片位传 null（drawImage 在录制里落成占位还是素色底），正好看出让位对不对。
// ============================================================
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Recorder } = require('./canvas2svg.js');

const ROOT = path.resolve(__dirname, '../..');

/** 一份用来核版式的样例：四张票根、两枚邮戳、两行结语 */
const DEMO = {
  y: '2025',
  sig: '阿茶',
  no: '078463',
  s: { total: 36, cities: 8, shows: 21, cost: 8960 },
  picks: [
    { im: null, typeText: '演出' },
    { im: null, typeText: '电影' },
    { im: null, typeText: '出行' },
    { im: null, typeText: '演出' }
  ],
  pm: [
    { city: '上海', dd: '14', mm: 'JUN', yy: '2025' },
    { city: '大理', dd: '12', mm: 'APR', yy: '2023' }
  ],
  ai: [
    '这一年，36 张票根替你记住了 8 座城市的灯光。',
    '愿这些票根，继续替你保存温柔。'
  ]
};

/** 录一张海报 → SVG 文本 */
function render(v) {
  const poster = require(path.join(ROOT, 'pages/annual/poster.js'));
  const rec = new Recorder(poster.RW, poster.RH);
  poster.render(rec, v || DEMO);
  return { svg: rec.toSVG(), W: poster.RW, H: poster.RH };
}

module.exports = { render, DEMO, ROOT };

if (require.main === module) {
  const OUT = path.join(ROOT, 'dist/_annual');
  fs.mkdirSync(OUT, { recursive: true });
  const { svg } = render();
  const svgPath = path.join(OUT, 'poster.svg');
  fs.writeFileSync(svgPath, svg, 'utf8');
  console.log('写出 ' + svgPath);
  const png = path.join(OUT, 'poster.png');
  try {
    execFileSync('python', ['-c',
      `import resvg_py;open(r"${png.replace(/\\/g, '\\\\')}","wb").write(bytes(resvg_py.svg_to_bytes(svg_path=r"${svgPath.replace(/\\/g, '\\\\')}", width=760)))`
    ], { stdio: 'inherit' });
    console.log('光栅化 ' + png);
  } catch (e) {
    console.log('（无 resvg_py，跳过光栅化：' + e.message + '）');
  }
}
