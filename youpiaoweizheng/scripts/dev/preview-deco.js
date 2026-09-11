/**
 * scripts/dev/preview-deco.js —— 主题装饰图形离线预览
 * ============================================================
 * 【解决什么问题】
 *   theme 页的头像与装饰元素是 JS 侧拼出来的 SVG（data-uri），
 *   改完没法在命令行里「看到」对不对，只能开微信开发者工具、翻到设置页。
 *   本脚本把 6 套主题 ×（1 头像 + 4 装饰）共 30 张图形渲染成一张 HTML，
 *   浏览器打开即见 —— 改完颜色/形状能当场肉眼验收，不用等真机。
 *
 * 【用法】
 *   node scripts/dev/preview-deco.js
 *   产物：dist/preview-deco.html（dist/ 已在 .gitignore 里，不会入库）
 *
 * ⚠️ 注意：这里只是「图形长什么样」的离线预览。真机验收仍须走开发者工具，
 *    因为小程序特有的问题（布局、自定义 tabBar、真机字体）这里看不出来。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const theme = require(path.join(ROOT, 'utils', 'theme.js'));
const deco = require(path.join(ROOT, 'utils', 'deco.js'));

// utils/theme.js 在模块加载时不会碰 wx 全局，但 deco.js 也不会 —— 这里直接 require 是安全的。
// 若将来 theme.js 顶层用到 wx，需在此补一个最小桩。

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cardHtml(t) {
  const decos = t.decos.map((d) => {
    const src = deco.decoSrc(d, t);
    return '' +
      '<figure class="deco">' +
        '<img src="' + esc(src) + '" alt="' + esc(d) + '">' +
        '<figcaption>' + esc(theme.DECO_LABELS[d] || d) + '</figcaption>' +
      '</figure>';
  }).join('');

  const swatches = t.swatches.map((s) =>
    '<div class="sw"><span style="background:' + esc(s.hex) + '"></span>' +
    '<b>' + esc(s.name) + '</b><i>' + esc(s.hex) + '</i></div>'
  ).join('');

  return '' +
    '<section class="card" style="background:' + esc(t.bg) + ';color:' + esc(t.text) + '">' +
      '<header>' +
        '<div class="ip" style="background:' + esc(t.bg) + '">' +
          '<div class="glow" style="background:' + esc(t.soft) + '"></div>' +
          '<img class="avatar" src="' + esc(deco.avatarSrc(t)) + '" alt="IP 头像">' +
          '<span style="color:' + esc(t.text) + '">' + esc(t.name) + '</span>' +
        '</div>' +
        '<h2 style="color:' + esc(t.primary) + '">' + esc(t.name) + ' <small>' + esc(t.key) + '</small></h2>' +
        '<p class="tag">' + esc(t.tagline) + '</p>' +
        '<p class="desc">' + esc(t.desc) + '</p>' +
      '</header>' +
      '<h3>装饰元素</h3>' +
      '<div class="decos">' + decos + '</div>' +
      '<h3>色板</h3>' +
      '<div class="sws">' + swatches + '</div>' +
    '</section>';
}

const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
  '<title>有票为证 · 主题装饰图形预览</title>' +
  '<style>' +
  'body{margin:0;padding:32px;background:#EFEAE1;font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#2B2420}' +
  'h1{font-size:20px;margin:0 0 6px}.lead{color:#8A7E6E;margin:0 0 28px}' +
  '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:20px}' +
  '.card{border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,.06)}' +
  '.ip{position:relative;height:150px;border-radius:14px;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;overflow:hidden;margin-bottom:14px}' +
  '.glow{position:absolute;width:190px;height:190px;border-radius:50%;opacity:.55;filter:blur(26px)}' +
  '.avatar{position:relative;width:104px;height:104px;z-index:1}' +
  '.ip span{position:relative;z-index:1;font-weight:700;letter-spacing:1px;font-size:13px}' +
  '.card h2{margin:0;font-size:17px}.card h2 small{font-weight:400;opacity:.45;font-size:11px}' +
  '.tag{margin:4px 0 0;font-size:12px;opacity:.7}.desc{margin:2px 0 0;font-size:12px;opacity:.55}' +
  '.card h3{margin:18px 0 8px;font-size:11px;letter-spacing:2px;opacity:.5;font-weight:600}' +
  '.decos{display:flex;gap:10px}' +
  '.deco{flex:1;margin:0;border-radius:12px;background:rgba(0,0,0,.045);padding:10px 6px 8px;' +
    'display:flex;flex-direction:column;align-items:center;gap:6px}' +
  '.deco img{width:56px;height:40px;object-fit:contain}' +
  '.deco figcaption{font-size:11px;opacity:.6}' +
  '.sws{display:flex;flex-wrap:wrap;gap:8px}' +
  '.sw{width:74px;background:rgba(0,0,0,.045);border-radius:10px;padding:6px;text-align:center}' +
  '.sw span{display:block;height:26px;border-radius:6px;border:1px solid rgba(0,0,0,.06)}' +
  '.sw b{display:block;font-size:11px;font-weight:500;margin-top:4px}' +
  '.sw i{font-style:normal;font-size:10px;opacity:.5}' +
  '</style></head><body>' +
  '<h1>有票为证 · 主题装饰图形预览</h1>' +
  '<p class="lead">6 套主题 ×（1 头像 + 4 装饰）＝ 30 张图形。' +
  '由 utils/deco.js 在 JS 侧编译成 SVG 实色，走 &lt;image src&gt; 渲染 —— 真机与浏览器应一致。</p>' +
  '<div class="grid">' + theme.THEME_META.map(cardHtml).join('') + '</div>' +
  '</body></html>';

const outDir = path.join(ROOT, 'dist');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'preview-deco.html');
fs.writeFileSync(out, html, 'utf8');

console.log('已生成：' + out);
console.log('用浏览器打开即可验收（30 张图形；重点看：图形有没有画出来、颜色有没有随主题变）。');
