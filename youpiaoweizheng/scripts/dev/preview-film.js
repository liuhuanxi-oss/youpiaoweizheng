// scripts/dev/preview-film.js —— 把「一键成片」的长图录成 SVG 再光栅化成 PNG（开发期自检，不进小程序包）
// 用法：node scripts/dev/preview-film.js
// 产物：dist/_film/sheet.svg 与 sheet.png，肉眼核版式用。
// ============================================================
// pages/discover/film.js 是纯绘制、不碰 wx.*，所以在 Node 里能直接跑。
// 样例里的落点不是手摆的 —— 走 mapArt.toStage 用真经纬度算，这样「图上那一团在
// 版面的哪一侧」才是真机上的样子（手摆的坐标会让人看不出省份挤在一起时的糊）。
// 想看别的行数：node scripts/dev/preview-film.js 12
// ============================================================
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Recorder } = require('./canvas2svg.js');

const ROOT = path.resolve(__dirname, '../..');

/** 七座城的真经纬度（够撑起一条从西北到华南的线） */
const PLACES = [
  ['北京', '116.4074', '39.9042', '2019-05-18'],
  ['上海', '121.4737', '31.2304', '2019-11-02'],
  ['成都', '104.0665', '30.5723', '2020-08-14'],
  ['乌鲁木齐', '87.6168', '43.8256', '2021-09-30'],
  ['广州', '113.2644', '23.1291', '2022-06-11'],
  ['西安', '108.9398', '34.3416', '2023-04-22'],
  ['大理', '100.2676', '25.6065', '2024-10-03']
];

const { toStage } = require(path.join(ROOT, 'utils/mapArt.js'));
const mapFilm = require(path.join(ROOT, 'utils/mapFilm.js'));
const film = require(path.join(ROOT, 'pages/discover/film.js'));

/** 一份用来核版式的样例：n 座城（默认 7），落点由真经纬度算出 */
function demo(n) {
  const k = Math.max(2, Math.min(Math.floor(Number(n) || PLACES.length), PLACES.length));
  const raw = PLACES.slice(0, k).map(([city, lng, lat, first], i) => {
    const p = toStage(Number(lng), Number(lat));
    return {
      city: city, first: first, count: (i % 4) + 1,
      lng: Number(lng), lat: Number(lat),
      x: p && p.x, y: p && p.y,
      color: ['#EFA392', '#A9C3A6', '#F2CE7E', '#D9A0A6'][i % 4]
    };
  });
  const cities = mapFilm.frames(raw);
  return {
    fit: mapFilm.sheet(cities.length),
    total: 47,
    cities: cities,
    span: mapFilm.span(cities),
    tip: '另有 40 座城没画上来（图上最多放 12 座）'
  };
}

if (require.main === module) {
  const v = demo(process.argv[2]);
  const OUT = path.join(ROOT, 'dist/_film');
  fs.mkdirSync(OUT, { recursive: true });
  const rec = new Recorder(v.fit.w, v.fit.h);
  film.render(rec, v);
  const svgPath = path.join(OUT, 'sheet.svg');
  fs.writeFileSync(svgPath, svgPath && rec.toSVG(), 'utf8');
  console.log('写出 ' + svgPath + '（' + v.fit.w + '×' + v.fit.h + '，' + v.cities.length + ' 座城）');
  const png = path.join(OUT, 'sheet.png');
  try {
    execFileSync('python', ['-c',
      `import resvg_py;open(r"${png.replace(/\\/g, '\\\\')}","wb").write(bytes(resvg_py.svg_to_bytes(svg_path=r"${svgPath.replace(/\\/g, '\\\\')}", width=600)))`
    ], { stdio: 'inherit' });
    console.log('光栅化 ' + png);
  } catch (e) {
    console.log('（无 resvg_py，跳过光栅化：' + e.message + '）');
  }
}

module.exports = { demo, PLACES };
