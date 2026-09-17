/**
 * scripts/dev/gen-share-covers.js —— 生成转发封面（分享卡片上那张 5:4 的图）
 * ============================================================
 * 【为什么不要用现成的那张】
 *   转发封面原先是 images/brand-logo.png —— 那其实是**应用图标**：方形、纯图形、
 *   一个字没有。好友在聊天里看到的是「一个粉色方块」，看不出这是什么、有什么用。
 *   分享封面是拉新链路上第一次露脸的地方，值得单独画。
 *
 * 【怎么出图】
 *   本脚本只负责把设计拼成 SVG；栅格化交给 Edge 无头模式（Windows 自带，零依赖）：
 *     msedge --headless --screenshot=out.png --window-size=W,H file:///xxx.svg
 *   —— 所以中文字体走系统字体，烘焙进位图，小程序那边只拿到一张普通 PNG，没有字体风险。
 *
 * 【用法】
 *   node scripts/dev/gen-share-covers.js          # 生成 SVG + PNG 到 dist/share-covers/
 *   node scripts/dev/gen-share-covers.js --svg     # 只出 SVG（不调浏览器）
 *   定稿后把 PNG 拷进 images/share/，再改 utils/share.js 的场景表。
 *
 * 环境变量 MSEDGE 可指定浏览器路径（默认找 Edge 的两个常见安装位置）。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
// 回忆地图那版封面要把地图页的水彩中国嵌进来 —— 同一个投影、同一份图形
const mapArt = require('../../utils/mapArt.js');
const themeUtil = require('../../utils/theme.js');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'dist', 'share-covers');

// 品牌色（与 utils/theme.js 的 paper 主题同源）
const BG = '#F5F0E6', INK = '#2B2420', SEAL = '#C26B5E', SOFT = '#E9E2D4', GREY = '#8A7E6E';

const W = 750, H = 600;   // 5:4，微信分享卡片的规定比例

// 【安全区 —— 一张图要伺候两个地方，这是本脚本最重要的一条约束】
//   好友卡片（onShareAppMessage）按 5:4 显示 → 整张 750×600 都用得上；
//   朋友圈（onShareTimeline）按 1:1 显示 → 微信会**居中裁切**成中间 600×600。
//   所以所有内容都得收在 x ∈ [75, 675] 里，否则朋友圈里左右两边会被切掉。
//   utils/share.js 里两个场景共用同一个 cover，就靠这条约束成立。
const SAFE_L = 75, SAFE_R = W - 75;
const SQ = W - SAFE_L * 2;   // 600：朋友圈里真正看得到的那块正方形

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 条形码：宽窄交替的竖条，铺满 [x, x+w] */
function barcode(x, y, w, h, color, op) {
  const GAP = 4;
  const widths = [6, 4, 8, 4, 6, 4, 8, 6];
  const scale = (w - GAP * (widths.length - 1)) / widths.reduce((a, b) => a + b, 0);
  let bx = x;
  return widths.map((n) => {
    const bw = Math.round(n * scale * 10) / 10;
    const r = '<rect x="' + bx + '" y="' + y + '" width="' + bw + '" height="' + h + '" fill="' +
      color + '" fill-opacity="' + op + '"/>';
    bx += bw + GAP;
    return r;
  }).join('');
}

/**
 * 照片位里的山与日头（与 utils/deco.js 的主题预览同一套意象）
 * 全部按比例算 —— 第一版按固定像素写死，换个尺寸就画出框了。
 */
function photo(x, y, w, h, fill) {
  const px = (r) => Math.round((x + w * r) * 10) / 10;
  const py = (r) => Math.round((y + h * r) * 10) / 10;
  const rx = Math.round(Math.min(14, h * 0.16) * 10) / 10;
  const sun = Math.round(Math.min(w, h) * 0.09 * 10) / 10;
  return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + rx +
      '" fill="' + fill + '"/>' +
    '<path d="M' + px(0.12) + ' ' + py(0.94) + 'L' + px(0.38) + ' ' + py(0.45) +
      'L' + px(0.56) + ' ' + py(0.66) + 'L' + px(0.73) + ' ' + py(0.41) +
      'L' + px(0.94) + ' ' + py(0.94) + 'Z" fill="' + INK + '" fill-opacity="0.13"/>' +
    '<circle cx="' + px(0.75) + '" cy="' + py(0.27) + '" r="' + sun +
      '" fill="' + INK + '" fill-opacity="0.1"/>';
}

/** 一张小票根（横版），以 (cx,cy) 为中心旋转 deg —— 叠票、对倾都靠它 */
function ticketH(cx, cy, deg, w, h) {
  const hw = w / 2, hh = h / 2;
  const split = w - 64;                              // 撕票线（相对卡片左边）
  const barX = -hw + split + 9;
  return '<g transform="translate(' + cx + ' ' + cy + ') rotate(' + deg + ')">' +
    '<rect x="' + -hw + '" y="' + -hh + '" width="' + w + '" height="' + h +
      '" rx="14" fill="#FFFFFF" stroke="#E2D9C7" stroke-width="2"/>' +
    '<circle cx="' + (-hw + split) + '" cy="' + -hh + '" r="9" fill="' + BG + '"/>' +
    '<circle cx="' + (-hw + split) + '" cy="' + hh + '" r="9" fill="' + BG + '"/>' +
    '<path d="M' + (-hw + split) + ' ' + (-hh + 18) + 'V' + (hh - 18) +
      '" fill="none" stroke="' + INK + '" stroke-opacity="0.2" stroke-width="2" stroke-dasharray="7 7"/>' +
    photo(-hw + 16, -hh + 18, split - 34, h - 88, SOFT) +
    '<rect x="' + (-hw + 16) + '" y="' + (hh - 54) + '" width="' + Math.round((split - 34) * 0.7) +
      '" height="11" rx="5.5" fill="' + INK + '" fill-opacity="0.85"/>' +
    '<rect x="' + (-hw + 16) + '" y="' + (hh - 32) + '" width="' + Math.round((split - 34) * 0.48) +
      '" height="8" rx="4" fill="' + GREY + '" fill-opacity="0.55"/>' +
    // 叠票场景下露出来的常是边角上的条形码，压淡一点 —— 不然三团密线抢戏
    barcode(barX, -hh + 30, hw - 9 - barX, h - 62, INK, 0.42) +
    '</g>';
}

/** 一张小票根（竖版，电影票那种：下部一道横撕线 + 副券条形码） */
function ticketV(cx, cy, deg) {
  const HW = 100, HH = 145;   // 半宽 / 半高
  const SPLIT = 86;           // 撕票线（相对卡片中心）
  return '<g transform="translate(' + cx + ' ' + cy + ') rotate(' + deg + ')">' +
    '<rect x="' + -HW + '" y="' + -HH + '" width="' + HW * 2 + '" height="' + HH * 2 +
      '" rx="16" fill="#FFFFFF" stroke="#E2D9C7" stroke-width="2"/>' +
    '<circle cx="' + -HW + '" cy="' + SPLIT + '" r="10" fill="' + BG + '"/>' +
    '<circle cx="' + HW + '" cy="' + SPLIT + '" r="10" fill="' + BG + '"/>' +
    '<path d="M' + (-HW + 18) + ' ' + SPLIT + 'H' + (HW - 18) +
      '" fill="none" stroke="' + INK + '" stroke-opacity="0.2" stroke-width="2" stroke-dasharray="7 7"/>' +
    photo(-HW + 20, -HH + 26, 160, 126, SOFT) +
    '<rect x="' + (-HW + 20) + '" y="' + (-HH + 178) + '" width="124" height="13" rx="6.5" fill="' +
      INK + '" fill-opacity="0.85"/>' +
    '<rect x="' + (-HW + 20) + '" y="' + (-HH + 202) + '" width="88" height="9" rx="4.5" fill="' +
      GREY + '" fill-opacity="0.55"/>' +
    barcode(-HW + 20, SPLIT + 16, HW * 2 - 40, 34, INK, 0.55) +
    '</g>';
}

/** 邮戳：双圈 + 两行小字，压在卡片角上 */
function postmark(cx, cy, r, top, bottom) {
  return '<g transform="translate(' + cx + ' ' + cy + ')">' +
    '<circle r="' + r + '" fill="none" stroke="' + SEAL + '" stroke-width="2.5" stroke-opacity="0.8"/>' +
    '<circle r="' + (r - 9) + '" fill="none" stroke="' + SEAL + '" stroke-width="1.5" stroke-opacity="0.55"/>' +
    '<text y="-3" font-family="Microsoft YaHei, sans-serif" font-size="' + Math.round(r / 3.4) +
      '" fill="' + SEAL + '" text-anchor="middle" letter-spacing="1">' + esc(top) + '</text>' +
    '<text y="' + Math.round(r / 2.6) + '" font-family="Microsoft YaHei, sans-serif" font-size="' +
      Math.round(r / 4.6) + '" fill="' + SEAL + '" fill-opacity="0.85" text-anchor="middle" ' +
      'letter-spacing="1">' + esc(bottom) + '</text>' +
    '</g>';
}

const head = (title) =>
  '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
  '<title>' + esc(title) + '</title>' +
  '<rect width="' + W + '" height="' + H + '" fill="' + BG + '"/>';

// 衬线标题：宋体压场，正文用雅黑。两款都是 Windows 自带，不引外部字体。
const SERIF = 'SimSun, STSong, serif';
const SANS = 'Microsoft YaHei, PingFang SC, sans-serif';

// ============================================================
// 版本一 · 票根（给「分享某张票根」用）
//   一张微倾的横向票根占满画面，邮戳压右上角 —— 最直白地说明「这是个收票根的地方」
// ============================================================
function coverTicket() {
  const CW = 560, CH = 300, CX = 95, CY = 180;
  return head('有票为证 · 转发封面（票根）') +
    '<g transform="translate(' + CX + ' ' + CY + ') rotate(-2.4 280 150)">' +
      '<rect x="0" y="0" width="' + CW + '" height="' + CH + '" rx="18" fill="#FFFFFF" ' +
        'stroke="#E2D9C7" stroke-width="2"/>' +
      '<circle cx="430" cy="0" r="12" fill="' + BG + '"/>' +
      '<circle cx="430" cy="' + CH + '" r="12" fill="' + BG + '"/>' +
      '<path d="M430 28V272" fill="none" stroke="' + INK + '" stroke-opacity="0.22" ' +
        'stroke-width="2.5" stroke-dasharray="9 9"/>' +
      photo(34, 44, 160, 160, SOFT) +
      '<text x="228" y="110" font-family="' + SERIF + '" font-size="48" font-weight="700" ' +
        'fill="' + INK + '" letter-spacing="6">有票为证</text>' +
      // 副标题只能到撕票线（430）为止：字号 × 字数 + 字距 ≤ 195，超一点就压条形码
      '<text x="228" y="152" font-family="' + SANS + '" font-size="17" fill="' + GREY + '" ' +
        'letter-spacing="1">拍下票根，自动存档</text>' +
      '<rect x="228" y="178" width="126" height="42" rx="21" fill="' + SEAL + '"/>' +
      '<text x="291" y="206" font-family="' + SANS + '" font-size="19" fill="#FFF8F2" ' +
        'text-anchor="middle" letter-spacing="2">票根收藏册</text>' +
      barcode(452, 62, 76, 108, INK, 0.6) +
      '<circle cx="490" cy="218" r="27" fill="none" stroke="' + SEAL + '" stroke-width="2.5" ' +
        'stroke-dasharray="6 6"/>' +
      '<text x="490" y="226" font-family="' + SERIF + '" font-size="24" fill="' + SEAL + '" ' +
        'text-anchor="middle">存</text>' +
      '<text x="490" y="266" font-family="' + SANS + '" font-size="13" fill="' + GREY + '" ' +
        'text-anchor="middle" letter-spacing="2">一张一存</text>' +
    '</g>' +
    // 邮戳压在卡片右上角上（卡片右上角在 648,168）：一半在册子上、一半在纸上才是盖章的样子。
    // 右缘 667 —— 再往右就出安全区，朋友圈里会被切掉一牙。
    postmark(615, 178, 52, '有票为证', 'TIMES') +
    '<text x="375" y="545" font-family="' + SERIF + '" font-size="28" fill="' + INK + '" ' +
      'text-anchor="middle" letter-spacing="12">让时光有票为证</text>' +
    '</svg>';
}

// ============================================================
// 版本二 · 年度报告（给「我的年度回忆报告」用）
//   一叠票根扇形摊开，像把一年的票根从册子里倒出来 —— 不写具体数字：
//   封面是所有用户共用的一张图，印上「12 张票」对只有一个的人就是假话。
// ============================================================
function coverAnnual() {
  return head('有票为证 · 转发封面（年度报告）') +
    '<text x="375" y="132" font-family="' + SERIF + '" font-size="46" font-weight="700" ' +
      'fill="' + INK + '" text-anchor="middle" letter-spacing="6">我的年度回忆</text>' +
    // 两侧各留 27px 余量：旋转出来的角正好顶在安全区边上，再往外就贴到朋友圈的裁切边了
    ticketH(255, 320, -15, 265, 190) +    // 先画最底下那张，后画的压在上面
    ticketH(495, 320, 13, 265, 190) +
    ticketH(375, 306, 0, 265, 190) +
    '<text x="375" y="492" font-family="' + SANS + '" font-size="18" fill="' + GREY + '" ' +
      'text-anchor="middle" letter-spacing="3">这一年，我把日子收成了票根</text>' +
    '<text x="375" y="545" font-family="' + SERIF + '" font-size="28" fill="' + INK + '" ' +
      'text-anchor="middle" letter-spacing="12">让时光有票为证</text>' +
    '</svg>';
}

// ============================================================
// 版本三 · 双人（给「双人空间 / 咱俩的票根」用）
//   两张竖票根并排对倾，中间一颗星 —— 不画人，用「两张票」说「两个人」
// ============================================================
function coverDuo() {
  const star = (cx, cy, r) => '<path d="M' + cx + ' ' + (cy - r) +
    'L' + (cx + r * 0.33) + ' ' + (cy - r * 0.33) + 'L' + (cx + r) + ' ' + cy +
    'L' + (cx + r * 0.33) + ' ' + (cy + r * 0.33) + 'L' + cx + ' ' + (cy + r) +
    'L' + (cx - r * 0.33) + ' ' + (cy + r * 0.33) + 'L' + (cx - r) + ' ' + cy +
    'L' + (cx - r * 0.33) + ' ' + (cy - r * 0.33) + 'Z" fill="' + SEAL + '"/>';
  return head('有票为证 · 转发封面（双人）') +
    '<text x="375" y="112" font-family="' + SERIF + '" font-size="44" font-weight="700" ' +
      'fill="' + INK + '" text-anchor="middle" letter-spacing="6">咱俩的票根</text>' +
    ticketV(230, 290, -3.5) +
    ticketV(520, 290, 3.5) +
    star(375, 290, 26) +
    '<text x="375" y="492" font-family="' + SANS + '" font-size="18" fill="' + GREY + '" ' +
      'text-anchor="middle" letter-spacing="4">一起看过的时光，一张都不会少</text>' +
    '<text x="375" y="553" font-family="' + SERIF + '" font-size="28" fill="' + INK + '" ' +
      'text-anchor="middle" letter-spacing="12">让时光有票为证</text>' +
    '</svg>';
}

// ============================================================
// 版本四 · 老票根专场（8.1.0，给「翻出抽屉里那些老票」用）
//   一眼要能看出「这是旧票」：纸色泛黄、字迹淡、边上有磨损，但撕票线/条码的结构
//   和新票一样 —— 让人认得出「这是同一个东西，只是更老了」，而不是另一种票。
//   标题下那句「认不出字也没关系」，是这版的**主要作用**：老票褪色、印刷体、
//   票面小字多，OCR 成功率天然低，先把预期说在前面，用户才不会被一次识别失败劝退。
// ============================================================
/** 一张老票根（横版，泛黄褪色 + 边缘磨损） */
function ticketOld(cx, cy, deg, w, h) {
  const hw = w / 2, hh = h / 2;
  const split = w - 56;
  const barX = -hw + split + 8;
  const PAPER = '#EFE6D4';   // 泛黄的纸（比新票的纯白旧一档）
  const FADE = '#8A7E6E';    // 褪色的墨：老票上的字不再黑得起来
  return '<g transform="translate(' + cx + ' ' + cy + ') rotate(' + deg + ')">' +
    '<rect x="' + -hw + '" y="' + -hh + '" width="' + w + '" height="' + h +
      '" rx="10" fill="' + PAPER + '" stroke="#DCCFB6" stroke-width="2"/>' +
    // 内圈细框：老票那种印在纸上的框线
    '<rect x="' + (-hw + 11) + '" y="' + (-hh + 11) + '" width="' + (w - 22) + '" height="' + (h - 22) +
      '" rx="5" fill="none" stroke="' + FADE + '" stroke-opacity="0.3" stroke-width="1.5"/>' +
    // 顶边的磨损缺口（两个大小不一的半圆）：比画整圈毛边省事，也够读出「旧」
    '<circle cx="' + (-hw + 46) + '" cy="' + -hh + '" r="5" fill="' + BG + '"/>' +
    '<circle cx="' + (-hw + 64) + '" cy="' + -hh + '" r="3" fill="' + BG + '"/>' +
    // 撕票孔与虚线：与新票同构，一眼认出是同一类东西
    '<circle cx="' + (-hw + split) + '" cy="' + -hh + '" r="8" fill="' + BG + '"/>' +
    '<circle cx="' + (-hw + split) + '" cy="' + hh + '" r="8" fill="' + BG + '"/>' +
    '<path d="M' + (-hw + split) + ' ' + (-hh + 16) + 'V' + (hh - 16) +
      '" fill="none" stroke="' + FADE + '" stroke-opacity="0.3" stroke-width="2" stroke-dasharray="6 6"/>' +
    // 褪色的年份：老票根上最动人的一个字就是这个数字
    '<text x="' + (-hw + 150) + '" y="' + (hh - 62) + '" font-family="' + SERIF +
      '" font-size="92" font-weight="700" fill="' + INK + '" fill-opacity="0.16" ' +
      'text-anchor="middle" letter-spacing="4">2015</text>' +
    '<rect x="' + (-hw + 30) + '" y="' + (hh - 46) + '" width="' + Math.round((split - 60) * 0.62) +
      '" height="12" rx="6" fill="' + INK + '" fill-opacity="0.5"/>' +
    '<rect x="' + (-hw + 30) + '" y="' + (hh - 24) + '" width="' + Math.round((split - 60) * 0.4) +
      '" height="8" rx="4" fill="' + FADE + '" fill-opacity="0.45"/>' +
    barcode(barX, -hh + 28, hw - 8 - barX, h - 56, FADE, 0.4) +
    '</g>';
}

function coverLegacy() {
  return head('有票为证 · 转发封面（老票根专场）') +
    '<text x="375" y="108" font-family="' + SERIF + '" font-size="46" font-weight="700" ' +
      'fill="' + INK + '" text-anchor="middle" letter-spacing="8">老票根专场</text>' +
    '<text x="375" y="146" font-family="' + SANS + '" font-size="17" fill="' + GREY + '" ' +
      'text-anchor="middle" letter-spacing="2">抽屉里那些，也值得留下来</text>' +
    ticketOld(375, 322, -2, 520, 250) +
    // 邮戳压在票的右上角上（跟「票根」那版同一种盖章感）：中心 620 + 半径 50 = 670，
    // 不出安全区 675；半径写 46 时「有票为证」四个字会顶到圈线上（试过）。
    postmark(620, 180, 50, '有票为证', '再存一张') +
    '<text x="375" y="512" font-family="' + SANS + '" font-size="18" fill="' + GREY + '" ' +
      'text-anchor="middle" letter-spacing="3">认不出字也没关系，自己填一遍就好</text>' +
    '<text x="375" y="556" font-family="' + SERIF + '" font-size="28" fill="' + INK + '" ' +
      'text-anchor="middle" letter-spacing="12">让时光有票为证</text>' +
    '</svg>';
}

// ============================================================
// 版本五 · 回忆地图（8.1.0 拉新 3/6「一键成片」的转发封面）
//   底图直接把地图页那张**水彩中国**嵌进来 —— 好友在卡片上看到的，就是他点进去
//   会看到的那张地图，一眼认得出是同一件事。landSrc 给的是 base64 data-uri，
//   无头浏览器能吃 <image href>，这一层是真烘进 PNG 的，不是外链。
//   上面的路线与落点用 toStage 投影 —— 和地图页落点是**同一个函数**，
//   所以封面上的点与页面上的点位置一致，不是手摆的。
// ============================================================
function coverMap() {
  const land = mapArt.landSrc(themeUtil.getThemeMeta('paper'));
  const MX = 175, MY = 150, MW = 400;
  const MH = Math.round((MW * mapArt.STAGE_H) / mapArt.STAGE_W);
  const at = (lng, lat) => {
    const p = mapArt.toStage(lng, lat);
    return [MX + (p.x / mapArt.STAGE_W) * MW, MY + (p.y / mapArt.STAGE_H) * MH];
  };
  // 一条从西走到东的假想足迹（封面不绑用户，是给所有人看的那一张）
  const ROUTE = [
    [87.62, 43.83, '#F2CE7E'],  // 乌鲁木齐
    [116.41, 39.90, '#EFA392'],  // 北京
    [104.07, 30.57, '#A9C3A6'],  // 成都
    [113.26, 23.13, '#A9C3A6'],  // 广州
    [121.47, 31.23, '#EFA392']   // 上海
  ].map(([lng, lat, c]) => ({ p: at(lng, lat), c: c }));

  const dots = ROUTE.map((r) =>
    '<circle cx="' + r.p[0] + '" cy="' + r.p[1] + '" r="40" fill="' + r.c + '" fill-opacity="0.22"/>' +
    '<circle cx="' + r.p[0] + '" cy="' + r.p[1] + '" r="11" fill="none" stroke="' + r.c + '" stroke-width="3.5"/>' +
    '<circle cx="' + r.p[0] + '" cy="' + r.p[1] + '" r="4.5" fill="#FFFFFF"/>'
  ).join('');

  return head('有票为证 · 转发封面（回忆地图）') +
    '<text x="375" y="86" font-family="' + SERIF + '" font-size="42" font-weight="700" ' +
      'fill="' + INK + '" text-anchor="middle" letter-spacing="8">回忆地图</text>' +
    '<text x="375" y="120" font-family="' + SANS + '" font-size="17" fill="' + GREY + '" ' +
      'text-anchor="middle" letter-spacing="2">这些年走过的路，一站一站演给你看</text>' +
    '<image x="' + MX + '" y="' + MY + '" width="' + MW + '" height="' + MH +
      '" href="' + land + '"/>' +
    '<path d="' + ROUTE.map((r, i) => (i ? 'L' : 'M') + r.p[0] + ' ' + r.p[1]).join(' ') +
      '" fill="none" stroke="' + SEAL + '" stroke-opacity="0.75" stroke-width="3" ' +
      'stroke-dasharray="9 7" stroke-linecap="round" stroke-linejoin="round"/>' +
    dots +
    '<text x="375" y="576" font-family="' + SERIF + '" font-size="28" fill="' + INK + '" ' +
      'text-anchor="middle" letter-spacing="12">让时光有票为证</text>' +
    '</svg>';
}

const COVERS = [
  { name: 'cover-ticket', build: coverTicket },
  { name: 'cover-annual', build: coverAnnual },
  { name: 'cover-duo', build: coverDuo },
  { name: 'cover-legacy', build: coverLegacy },
  { name: 'cover-map', build: coverMap }
];

// —— 出图 ——

function findEdge() {
  const cands = [
    process.env.MSEDGE,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  for (const p of cands) if (fs.existsSync(p)) return p;
  return null;
}

/** 用无头浏览器把页面栅格化成 PNG（中文字体在这一步烘焙进位图） */
function rasterize(browser, pageFile, pngFile, w, h) {
  execFileSync(browser, [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--screenshot=' + pngFile,
    '--window-size=' + w + ',' + h,
    'file:///' + pageFile.replace(/\\/g, '/')
  ], { stdio: 'ignore', timeout: 60000 });
}

/**
 * 朋友圈口径的验收图：把 5:4 的封面居中裁成 1:1，看有没有内容被切到边上。
 * 裁切规则（居中取中间 600×600）是微信自己定的，这里只是照做一遍给人眼看。
 */
function squareHtml(svgName) {
  return '<!doctype html><meta charset="utf-8">' +
    '<style>html,body{margin:0}' +
    '.sq{width:' + SQ + 'px;height:' + SQ + 'px;overflow:hidden;position:relative}' +
    '.sq img{position:absolute;left:-' + SAFE_L + 'px;top:0;width:' + W + 'px;height:' + H + 'px}</style>' +
    '<div class="sq"><img src="' + svgName + '"></div>';
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const svgOnly = process.argv.includes('--svg');
const browser = svgOnly ? null : findEdge();
if (!svgOnly && !browser) {
  console.error('没找到 Edge/Chrome，加 --svg 可只出 SVG。或用 MSEDGE 环境变量指定路径。');
  process.exit(1);
}

const kb = (f) => Math.round(fs.statSync(f).size / 1024) + ' KB';

for (const c of COVERS) {
  const svgFile = path.join(OUT, c.name + '.svg');
  fs.writeFileSync(svgFile, c.build(), 'utf8');
  console.log('  ' + c.name + '.svg');
  if (!browser) continue;
  try {
    const png = path.join(OUT, c.name + '.png');           // 好友卡片口径（5:4 全图）
    rasterize(browser, svgFile, png, W, H);
    let line = '    ' + c.name + '.png ' + kb(png) + '（好友卡片 5:4）';
    const sqHtml = path.join(OUT, c.name + '-square.html'); // 朋友圈口径（1:1 居中裁切）
    fs.writeFileSync(sqHtml, squareHtml(c.name + '.svg'), 'utf8');
    const sqPng = path.join(OUT, c.name + '-square.png');
    rasterize(browser, sqHtml, sqPng, SQ, SQ);
    line += '\n    ' + c.name + '-square.png ' + kb(sqPng) + '（朋友圈 1:1）';
    console.log(line);
  } catch (e) {
    console.log('    PNG 失败：' + e.message);
  }
}

console.log('\n共 ' + COVERS.length + ' 版，产物在 ' + OUT);
if (browser) {
  console.log('逐张肉眼验收 —— 重点看 square 那张：边上的图形被切了就是越出安全区了。');
  console.log('定稿后拷进 images/share/ 并改 utils/share.js 的 SCENES。');
}
