/**
 * scripts/dev/preview-map.js —— 回忆地图「水彩中国」离线预览
 * ============================================================
 * 【解决什么问题】
 *   水彩陆地是 utils/mapArt.js 在 JS 侧拼出来的 SVG（data-uri），
 *   改完投影常量或色块参数没法在命令行里「看到」对不对，
 *   只能开微信开发者工具翻到回忆地图页。
 *   本脚本把地图卡按真实布局渲染成一张 HTML，浏览器打开即见。
 *
 * 【用法】
 *   node scripts/dev/preview-map.js
 *   产物：dist/preview-map.html（dist/ 已在 .gitignore 里，不会入库）
 *
 * ⚠️ 这里只是「图形长什么样」的离线预览。真机验收仍须走开发者工具 ——
 *    原生 <map>、自定义 tabBar、真机字体这些这里都看不出来。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const mapArt = require(path.join(ROOT, 'utils', 'mapArt.js'));
const themeUtil = require(path.join(ROOT, 'utils', 'theme.js'));

// rpx → px：预览按 750rpx = 750px 画（整体放大 2 倍），
// 好处是 WXSS 里每个 rpx 数值都能原样搬进来，不用心算换算。
const STAGE_W = mapArt.STAGE_W;
const STAGE_H = mapArt.STAGE_H;

/** 数据集：演示数据的 3 城（新用户看到的样子）+ 一组散在全国的 10 城（老用户） */
const SETS = [
  {
    key: 'demo',
    name: '演示数据（3 城：武汉 / 长沙 / 上海）',
    tickets: [
      { city: '武汉', lat: 30.508, lng: 114.39, date: '2026-03-12' },
      { city: '武汉', lat: 30.48, lng: 114.35, date: '2026-05-02' },
      { city: '武汉', lat: 30.51, lng: 114.42, date: '2026-08-19' },
      { city: '长沙', lat: 28.15, lng: 112.98, date: '2026-04-06' },
      { city: '长沙', lat: 28.2, lng: 112.97, date: '2026-07-21' },
      { city: '上海', lat: 31.22, lng: 121.46, date: '2026-06-01' },
      { city: '上海', lat: 31.23, lng: 121.47, date: '2026-09-02' }
    ]
  },
  {
    key: 'wide',
    name: '满图（12 城，散在全国 —— 看气泡避让与路线）',
    tickets: [
      ['乌鲁木齐', 43.83, 87.62], ['哈尔滨', 45.80, 126.53], ['北京', 39.90, 116.41],
      ['西安', 34.34, 108.94], ['成都', 30.57, 104.07], ['昆明', 25.04, 102.71],
      ['拉萨', 29.65, 91.14], ['广州', 23.13, 113.26], ['厦门', 24.48, 118.09],
      ['杭州', 30.27, 120.16], ['武汉', 30.51, 114.42], ['长沙', 28.20, 112.97]
    ].map(([city, lat, lng], i) => ({ city, lat, lng, date: '2026-0' + ((i % 9) + 1) + '-11' }))
  }
];

/** 复刻 discover.js 的归并：同城取重心、按首访排序串路线 */
function build(tickets) {
  const byCity = new Map();
  tickets.forEach((t) => {
    if (!byCity.has(t.city)) byCity.set(t.city, { city: t.city, count: 0, lat: 0, lng: 0, first: '' });
    const e = byCity.get(t.city);
    e.count++; e.lat += t.lat; e.lng += t.lng;
    if (!e.first || t.date < e.first) e.first = t.date;
  });
  const cities = Array.from(byCity.values()).map((e) => {
    const st = mapArt.toStage(e.lng / e.count, e.lat / e.count);
    return Object.assign(e, { x: st.x, y: st.y, color: mapArt.bubbleColor(e.city), push: 0, below: false });
  });
  mapArt.layoutBubbles(cities);
  const ordered = cities.slice().sort((a, b) => String(a.first).localeCompare(String(b.first)));
  const route = mapArt.routeSrc(ordered.map((c) => ({ lng: c.lng / c.count, lat: c.lat / c.count })));
  return { cities, route };
}

function citiesHtml(cities) {
  const pinLabels = cities.length <= 6; // 同 discover.js 的 PIN_LABEL_MAX
  return cities.map((c) => {
    const gap = mapArt.PIN_GAP + c.push;
    const stem = Math.max(0, gap - 11);
    const bubblePos = (c.below ? 'top:' : 'bottom:') + gap + 'px';
    const stemPos = (c.below ? 'top:11px;' : 'bottom:11px;') + 'height:' + stem + 'px';
    return '' +
      '<div class="dc-city" style="left:' + c.x + 'px; top:' + c.y + 'px">' +
        '<div class="dc-stem" style="background:' + c.color + ';' + stemPos + '"></div>' +
        '<div class="dc-bubble ' + (c.below ? 'down' : 'up') + '" style="background:' + c.color +
          ';color:#FFFFFF;' + bubblePos + ';width:' + mapArt.bubbleWidth(c.city) + 'px">' +
          '<span class="dc-bubble-n">' + c.city + '</span>' +
          '<span class="dc-bubble-c">' + c.count + '</span>' +
        '</div>' +
        '<div class="dc-pin" style="border-color:' + c.color + '"></div>' +
        (pinLabels ? '<div class="dc-pin-name">' + c.city + '</div>' : '') +
      '</div>';
  }).join('');
}

function cardHtml(set, t) {
  const { cities, route } = build(set.tickets);
  const land = mapArt.landSrc(t);
  return '' +
    '<figure class="fig">' +
      '<figcaption>' + set.name + ' ｜ 主题 ' + t.name + '（' + t.key + '）</figcaption>' +
      '<div class="dc-page" style="background:' + t.bg + '">' +
        '<div class="dc-card" style="background:' + t.card + '">' +
          '<div class="dc-card-inner" style="border-color:' + t.border + '">' +
            '<div class="dc-stage" style="width:' + STAGE_W + 'px;height:' + STAGE_H + 'px">' +
              '<img class="dc-layer" src="' + land + '" alt="水彩陆地">' +
              (route ? '<img class="dc-layer" src="' + route + '" alt="时光路线">' : '') +
              citiesHtml(cities) +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</figure>';
}

const themes = themeUtil.THEME_META;
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
  '<title>有票为证 · 回忆地图水彩预览</title><style>' +
  'body{margin:0;padding:24px;background:#EFEAE1;font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#2B2420}' +
  'h1{font-size:18px;margin:0 0 4px}.lead{color:#8A7E6E;margin:0 0 20px}' +
  '.grid{display:flex;flex-wrap:wrap;gap:28px;align-items:flex-start}' +
  '.fig{margin:0}.fig figcaption{font-weight:600;margin-bottom:8px}' +
  '.dc-page{padding:0 0 20px;border-radius:10px}' +
  '.dc-card{margin:20px 24px 0;padding:16px;border-radius:32px}' +
  '.dc-card-inner{padding:18px 0 0;border:2px dashed;border-radius:22px}' +
  '.dc-stage{position:relative;margin:8px auto 0}' +
  '.dc-layer{position:absolute;left:0;top:0;width:100%;height:100%}' +
  '.dc-city{position:absolute;width:0;height:0}' +
  '.dc-stem{position:absolute;left:0;width:3px;margin-left:-1.5px;border-radius:2px;opacity:.65}' +
  '.dc-pin{position:absolute;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;' +
    'box-sizing:border-box;border:5px solid;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.2)}' +
  '.dc-pin-name{position:absolute;left:0;top:16px;transform:translateX(-50%);white-space:nowrap;font-size:20px;letter-spacing:1px}' +
  '.dc-bubble{position:absolute;left:0;transform:translateX(-50%);box-sizing:border-box;min-width:96px;' +
    'padding:10px 18px 12px;border-radius:26px;display:flex;flex-direction:column;align-items:center;' +
    'box-shadow:0 6px 16px rgba(0,0,0,.22)}' +
  '.dc-bubble::after{content:"";position:absolute;left:50%;width:15px;height:15px;margin-left:-7.5px;' +
    'background:inherit;border-radius:2px;transform:rotate(45deg)}' +
  '.dc-bubble.up::after{bottom:-6px}.dc-bubble.down::after{top:-6px}' +
  '.dc-bubble-n{white-space:nowrap;font-size:26px;font-weight:700;line-height:1.2}' +
  '.dc-bubble-c{font-size:21px;opacity:.85;line-height:1.2}' +
  '</style></head><body>' +
  '<h1>有票为证 · 回忆地图水彩预览</h1>' +
  '<p class="lead">按 750rpx = 750px 原尺寸渲染（rpx 数值原样搬进来）。数据 → 落点 → 陆地，走的都是 utils/mapArt.js 的真实代码。</p>' +
  '<div class="grid">' +
  SETS.map((s) => cardHtml(s, themes[0])).join('') +
  '</div>' +
  '<h2 style="font-size:15px;margin:28px 0 8px">六套主题下的同一张图（看图与卡片底色搭不搭）</h2>' +
  '<div class="grid">' +
  themes.map((t) => cardHtml(SETS[0], t)).join('') +
  '</div>' +
  '</body></html>';

const outDir = path.join(ROOT, 'dist');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'preview-map.html');
fs.writeFileSync(out, html, 'utf8');

console.log('已生成：' + out);
