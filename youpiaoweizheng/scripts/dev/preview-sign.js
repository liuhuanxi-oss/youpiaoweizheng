// scripts/dev/preview-sign.js —— 把「合作场馆立牌」录成 SVG 再光栅化成 PNG（开发期自检，不进小程序包）
// 用法：node scripts/dev/preview-sign.js [标题] [一句话]
// 产物：dist/_sign/board.svg 与 board.png，肉眼核版式用。
// ============================================================
// 为什么这一页**必须**有肉眼那一步：立牌上的错法全都「打印出来才会发现」——
//   标题被裁掉半行、码压住号召语、页脚冲出纸边 —— 画布不会拦你，页面上也一切正常。
// 所以这里出一张真图，放大到 100% 看一眼再拿去打印。
// pages/sign/board.js 是纯绘制、不碰 wx.*，与 preview-card / preview-film 同一支录画笔。
//
// 注意：码的位置**画的是一个灰方块占位**（真码由云函数生成，这里取不到）。
//   录画笔把所有 drawImage 记成灰矩形，正好用来看「码占多大、压没压到别的字」——
//   版面核对要的正是这个；码长什么样不归这张图管。
// ============================================================
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Recorder } = require('./canvas2svg.js');

const ROOT = path.resolve(__dirname, '../..');

const board = require(path.join(ROOT, 'utils/signBoard.js'));
const painter = require(path.join(ROOT, 'pages/sign/board.js'));

/**
 * 一份用来核版式的样例。标题默认取**最长的档位**（16 个汉字，顶着 TITLE_MAX）——
 * 核版式就该拿最坏情况核，拿「广州大剧院」看什么都合适。
 */
function demo(title, sub) {
  const s = board.sanitize({ title: title, sub: sub });
  return {
    fit: board.sheet(),
    title: s.title || '一二三四五六七八九十一二三四五六',
    // 预览里不画浅色占位：默认那串就是拿来核版式的样例，画成灰的反而看错。
    // （占位色本身由 sign_board 的测试钉着，不靠肉眼。）
    dim: false,
    sub: s.sub,
    // 灰方块占位，见文件头。尺寸取真码的边长，版面才对得上真机
    qr: { width: board.QR_SIZE, height: board.QR_SIZE }
  };
}

if (require.main === module) {
  const v = demo(process.argv[2], process.argv[3]);
  const OUT = path.join(ROOT, 'dist/_sign');
  fs.mkdirSync(OUT, { recursive: true });
  const rec = new Recorder(v.fit.w, v.fit.h);
  painter.render(rec, v);
  const svgPath = path.join(OUT, 'board.svg');
  fs.writeFileSync(svgPath, rec.toSVG(), 'utf8');
  console.log('写出 ' + svgPath + '（' + v.fit.w + '×' + v.fit.h + '，标题「' + v.title + '」）');
  const png = path.join(OUT, 'board.png');
  try {
    execFileSync('python', ['-c',
      `import resvg_py;open(r"${png.replace(/\\/g, '\\\\')}","wb").write(bytes(resvg_py.svg_to_bytes(svg_path=r"${svgPath.replace(/\\/g, '\\\\')}", width=750)))`
    ], { stdio: 'inherit' });
    console.log('光栅化 ' + png + '（放大到 100% 看标题有没有被裁边）');
  } catch (e) {
    console.log('（无 resvg_py，跳过光栅化：' + e.message + '）');
  }
}

module.exports = { demo };
