// utils/signBoard.js —— 线下立牌的版面与文案（8.1.0 拉新 4/6）
// ============================================================
// 【这块立牌是什么】合作场馆（剧场 / 影院 / livehouse / 展馆）摆在取票口或入口的
//   一张竖版海报，上面一个大大的小程序码。散场的人手里正好捏着一张票 ——
//   那是「他有一张票根要存」这件事最强烈的时刻，也是唯一不需要我们解释的地方。
//
// 【为什么码要单独做一个（不走分享那个码）】分享用的那张码落在**首页**：好友点进来
//   要先看看这是个什么 App。立牌不一样：站在场馆里扫码的人手里有票、脚下就是这场演出，
//   多一步就是少一半人。所以立牌码的 scene 是 `b=sign`、落地页直接指到拍照页
//   （见云函数 wxacode 的 kind='sign' 分支）—— 扫码 → 取景框，中间不隔任何一屏。
//
// 【为什么单独一个文件】与 utils/mapFilm.js 同一个理由：版面与文案是**纯数据与纯函数**，
//   不碰 wx、不碰 setData，可以在 Node 里真跑（tests/sign_board.test.js）。
//   字号算错、长标题冲出纸边这类错**画出来之前看不出来**，等真机存出一张压字的图就晚了。
//
// 【调色不跟主题走】同 pages/annual/poster.js 与 pages/discover/film.js：
//   印出来的东西要质感统一，六套主题各印一版没有意义。色值由画笔自己持有。
// ============================================================

// —— 纸面尺寸：A4 竖版（210×297 → 1:1.4142）。打印时按比例缩放即可，不必再做适配 ——
// 750 宽与 mapFilm.sheet / annual poster 同一把尺子，出图 dpr=2 → 1500×2120，
// 约 180dpi，A4 摆在门口看得清；离 iOS 那张「单边 4096」的生死线也还远。
const SIZE = { w: 750, h: 1060 };

const BRAND = '有票为证';
const SLOGAN = '让时光有票为证';
const SCAN_TIP = '微信扫一扫，收进你自己的收藏册';

// 用户留空时的默认号召语。不写「快来分享」「拉好友得奖励」这类话 ——
// 这一版立牌不设任何奖励，写了就是骗。
const SUB_DEFAULT = '看完别走，先把今晚这张收进来';

// 标题最多 16 字：够写「2026 草莓音乐节·广州站」，再长就该用户自己精简了。
// 副标题 24 字 —— 超过这个长度在 750 宽里必然折成三行，版面会被挤歪。
const TITLE_MAX = 16;
const SUB_MAX = 24;

// 码的边长一律 340（占纸宽 45%）。这不是审美选择：码越小，站远一点就扫不动，
// 而门口的人是走过来的 —— 他会走近，但不会贴着看。
const QR_SIZE = 340;

/** A4 的长宽比，测试里拿它对尺寸（750/1060 与 210/297 的差在 0.1% 以内） */
const A4_RATIO = 297 / 210;

/**
 * 把用户输入收成能画的东西。
 * 空标题 = 不能出图（立牌不能没有名字）；副标题留空就退回默认那句。
 * @param {{title?:string, sub?:string}} raw
 * @returns {{title:string, sub:string, ok:boolean}}
 */
function sanitize(raw) {
  const t = raw || {};
  // 换行会让「一行标题」的版面假设失效，折成空格；连续空白同样折一个
  const title = String(t.title || '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  const sub = String(t.sub || '').replace(/\s+/g, ' ').trim().slice(0, SUB_MAX) || SUB_DEFAULT;
  return { title, sub, ok: !!title };
}

/**
 * 主标题字号：字数越多越小。
 * 为什么不用 wrapText 折行就好：立牌上的名字折成两行会被读成一个陌生的长句，
 * 而「广州大剧院」和「2026 草莓音乐节·广州站」本来就该长得不一样大。
 * 分界点按 750 宽 - 两侧留白 132 = 618 可用宽度反推（中文字宽≈字号）。
 * @param {string} title
 * @returns {number} px
 */
function titleSize(title) {
  const n = String(title || '').length;
  if (n <= 6) return 66;
  if (n <= 10) return 52;
  return 40;
}

/**
 * 整张立牌的版面。画笔与测试**共用这一份** —— 版面一旦两处各算一份，迟早对不上
 * （同 mapFilm.sheet 的理由）。
 * @returns {object} 各块矩形 {x,y,w,h} 与关键坐标
 */
function sheet() {
  const W = SIZE.w, H = SIZE.h;
  const pad = 66;
  const inner = W - pad * 2;              // 618
  const qrX = (W - QR_SIZE) / 2;
  return {
    w: W,
    h: H,
    pad,
    // 齿边纸片：贴边跑一圈，与 deco.artFrame 的约定一样，盒子与 viewBox 必须严丝合缝
    frame: { x: 22, y: 22, w: W - 44, h: H - 44, tooth: 26, amp: 8 },
    brand: { x: pad, y: 96, w: inner, h: 34 },       // 品牌名
    slogan: { x: pad, y: 142, w: inner, h: 26 },     // 品牌口号（小字，压在品牌名下面）
    title: { x: pad, y: 262, w: inner, h: 130 },     // 场馆名 / 活动名
    sub: { x: pad, y: 424, w: inner, h: 84 },        // 号召语（最多两行）
    qr: { x: qrX, y: 556, w: QR_SIZE, h: QR_SIZE },  // 小程序码
    tip: { x: pad, y: 932, w: inner, h: 30 },        // 码下那行说明
    foot: { x: pad, y: 1000, w: inner, h: 24 }       // 页脚
  };
}

module.exports = {
  SIZE, A4_RATIO, BRAND, SLOGAN, SCAN_TIP, SUB_DEFAULT,
  TITLE_MAX, SUB_MAX, QR_SIZE,
  sanitize, titleSize, sheet
};
