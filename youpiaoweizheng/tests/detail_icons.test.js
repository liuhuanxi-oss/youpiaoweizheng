// tests/detail_icons.test.js —— 票根详情页（品牌全案 · 稿屏4）回归测试
// 核心断言：页面里的图形一律走 <image src="data:image/svg+xml;base64,...">，
// 不允许出现 emoji 当图标、不允许出现内联 <svg>、不允许出现 var() 色值。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const wxml = read('pages/detail/detail.wxml');
const wxss = read('pages/detail/detail.wxss');
const js = read('pages/detail/detail.js');
const icons = read('utils/icons.js');

// 去掉 HTML 注释后再检查（注释里合法地提到过 <svg>）
const wxmlClean = wxml.replace(/<!--[\s\S]*?-->/g, '');

console.log('\n【一、WXML 不得有内联 svg / emoji 图标】');
t('wxml 正文无 <svg> / <path> / <circle> 标签', () => {
  ok(!/<svg[\s>]/i.test(wxmlClean), '发现内联 <svg>');
  ok(!/<path[\s>]/i.test(wxmlClean), '发现内联 <path>');
  ok(!/<circle[\s>]/i.test(wxmlClean), '发现内联 <circle>');
});
t('wxml 正文无 emoji / ✦ 字形当装饰（真机字形覆盖不可控）', () => {
  const bad = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2728}\u{2764}]/u;
  const m = wxmlClean.match(bad);
  ok(!m, '残留：' + (m && m[0]));
});
t('分享按钮已换成 icons.iShare', () => ok(wxml.includes('icons.iShare'), '缺少 iShare'));
t('notFound 票根已换成 icons.iTicketEmpty', () => ok(wxml.includes('icons.iTicketEmpty'), '缺少 iTicketEmpty'));

console.log('\n【二、所有 icons.* 绑定都在 detail.js 里编译出来】');
t('wxml 用到的每个 icons.X 都在 buildIcons 里有定义', () => {
  const used = new Set([...wxmlClean.matchAll(/icons\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
  const body = js.slice(js.indexOf('function buildIcons'), js.indexOf('Page({'));
  const defined = new Set([...body.matchAll(/^\s*(i[A-Za-z0-9_]+):/gm)].map((m) => m[1]));
  const missing = [...used].filter((u) => !defined.has(u));
  ok(missing.length === 0, '未定义：' + missing.join(', '));
  ok(used.size >= 12, '绑定数量偏少，疑似漏改：' + used.size);
  // 反向：定义了却没用也是垃圾（这次就是它抓出 iTime/iCal 等 5 条死数据）
  const unused = [...defined].filter((d) => !used.has(d));
  ok(unused.length === 0, '定义了但 wxml 未使用：' + unused.join(', '));
});

console.log('\n【三、图标色必须是实色，且不能吃 rgba 字面量主题】');
t('buildIcons 不把 meta.text2 喂给 iconSrc（film/minimal 是 rgba）', () => {
  ok(!/iconSrc\([^)]*m\.text2/.test(js), 'iconSrc 收到 m.text2，rgba 会变无效色值');
});
t('所有 iconSrc 的色参都是主题实色或十六进制常量', () => {
  // 色参在第一个 , 或 ) 处收尾：', )' 同时收，才能既拿到 m.primary 又拿到 BTN_FIX_FG
  const calls = [...js.matchAll(/iconSrc\('([a-z]+)',\s*([^,)]+)/g)];
  ok(calls.length >= 12, '调用点偏少：' + calls.length);
  const bad = calls.filter((c) => {
    const v = c[2].trim();
    return !/^m\.[a-z]+$/.test(v) && !/^'#[0-9A-Fa-f]{6}'$/.test(v) && !/^BTN_[A-Z_]+$/.test(v);
  });
  ok(bad.length === 0, '色参不合法：' + bad.map((b) => b[0]).join(' | '));
});
t('浅底胶囊的图标色与文字色同值（不能吃主题变量）', () => {
  // 8.1.3：原先这里还管着「修复」那颗（BTN_FIX_FG / .dtc-btn.ghost），
  // 那颗假按钮摘掉后只剩「重绘」一颗 —— 详见 tests/audit_812.test.js 第三节
  ok(/BTN_ART_FG = '#8A6F3A'/.test(js), 'BTN_ART_FG 与 .dtc-btn.sage 文字色不一致');
  ok(/\.dtc-btn\.sage\s*\{[\s\S]*?color:\s*#8A6F3A/.test(wxss), 'wxss 胶囊文字色改了，JS 常量要跟着改');
  ok(!/BTN_FIX_FG/.test(js), '修复胶囊的色常量还在（那颗按钮已经摘了）');
});

console.log('\n【四、icons.js 必须提供本页用到的全部路径】');
t('本页用到的图标名都在 ICON_PATH 里', () => {
  const need = ['music', 'pin', 'seat', 'wallet', 'moon', 'palette', 'share', 'heart', 'sparkle', 'ticket'];
  const missing = need.filter((n) => !new RegExp('^\\s*' + n + ':', 'm').test(icons));
  ok(missing.length === 0, '缺少：' + missing.join(', '));
});
t('iconSrc 支持第 5 个 solid 参数（收藏态实心心）', () => {
  ok(/function iconSrc\([^)]*solid/.test(icons), 'signature 未含 solid');
  ok(/solid\s*\?/.test(icons), 'solid 分支缺失');
});
t('iHeartOn 走了 solid 分支', () => ok(/iHeartOn:\s*iconSrc\([^)]*true\)/.test(js), 'iHeartOn 未传 true'));

console.log('\n【五、WXSS 与 WXML 的类名对得上】');
t('wxml 里的类名都在 wxss 里有定义（白名单放行全局公共类）', () => {
  const GLOBAL = /^(tk-page|tk-safe-bottom|pressable|press-hover|card|b-tape|b-stamp|b-stamp-in|b-stamp-city|b-stamp-date|b-perf|b-serial|b-spark|b-dash-path|theme-|skeleton-bone|ad-cap|fade-up)/;
  // 先剔掉 {{ ... }} 表达式再按空格切，否则 '{{imgLoaded ? 'ld' : ''}}' 会被切成 5 个垃圾类名
  const used = new Set([...wxmlClean.matchAll(/(?:^|\s)class="([^"]*)"/g)]
    .flatMap((m) => m[1].replace(/\{\{[\s\S]*?\}\}/g, ' ').split(/\s+/)).filter(Boolean));
  const defined = new Set([...wxss.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));
  const missing = [...used].filter((u) => !defined.has(u) && !GLOBAL.test(u));
  ok(missing.length === 0, 'wxss 缺样式：' + missing.join(', '));
});
t('wxss 里没有残留的旧类名（dtc-line / dtc-no-row / dtc-cap / dtc-fb-emoji）', () => {
  const dead = ['dtc-line', 'dtc-no-row', 'dtc-no-label', 'dtc-no-heart', 'dtc-fb-emoji', 'dtc-cap']
    .filter((c) => wxss.includes('.' + c));
  ok(dead.length === 0, '残留死样式：' + dead.join(', '));
});
t('新增的样式块都在（stamp-frame / rows / memo / btn-ic）', () => {
  ['dtc-stamp-frame', 'dtc-rows', 'dtc-row-ic', 'dtc-heart', 'dtc-memo', 'dtc-memo-bar', 'dtc-btn-ic', 'nf-ic']
    .forEach((c) => ok(wxss.includes('.' + c), '缺少 .' + c));
});

console.log('\n【六、邮票框与照片的内外圆角必须匹配】');
t('.dtc-img 圆角已收小（不再是大圆角裸图）', () => {
  // A3 起圆角落在视差裁剪框 .dtc-par 上（照片被它 overflow:hidden 裁，自己不再需要圆角）
  const par = wxss.slice(wxss.indexOf('.dtc-par {'), wxss.indexOf('.dtc-img {'));
  const r = /border-radius:\s*(\d+)rpx/.exec(par);
  ok(r && Number(r[1]) <= 8, '.dtc-par 圆角仍为 ' + (r && r[1]) + 'rpx，与外框 6rpx 不搭');
  ok(/overflow:\s*hidden/.test(par), '.dtc-par 没裁剪照片，视差上移会露出框底');
});
t('.dtc-stamp-frame 有白边 + 齿孔两层', () => {
  ok(/\.dtc-stamp-frame\s*\{[\s\S]*?padding:\s*16rpx/.test(wxss), '白边不是 16rpx');
  ok(/\.dtc-stamp-frame::before/.test(wxss) && /\.dtc-stamp-frame::after/.test(wxss), '齿孔伪元素缺失');
  ok(/repeat-x, repeat-x/.test(wxss) && /repeat-y, repeat-y/.test(wxss), '上下/左右齿孔未拆两片');
});

console.log('\n【七、信息面板不再与卡内三行重复】');
t('补充面板只剩 座位/票价/天气 三项', () => {
  const panel = wxmlClean.slice(wxmlClean.indexOf('dtc-fields'), wxmlClean.indexOf('dtc-actions'));
  const keys = [...panel.matchAll(/class="dtc-f-k">([^<]+)</g)].map((m) => m[1]);
  ok(JSON.stringify(keys) === JSON.stringify(['座位', '票价', '当晚天气']), '实际：' + keys.join('/'));
});
t('卡内三行是 时间/地点/票号', () => {
  const rows = wxmlClean.slice(wxmlClean.indexOf('dtc-rows'), wxmlClean.indexOf('dtc-perf'));
  const keys = [...rows.matchAll(/class="dtc-row-k">([^<]+)</g)].map((m) => m[1]);
  ok(JSON.stringify(keys) === JSON.stringify(['时间', '地点', '票号']), '实际：' + keys.join('/'));
});

console.log('\n【八、主题切换后图标会重编（不能只在 onLoad 编一次）】');
t('onShow 里重新 buildIcons 并 setData', () => {
  const onShow = js.slice(js.indexOf('onShow()'), js.indexOf('onUnload()'));
  ok(/themeUtil\.getTheme\(\)/.test(onShow), 'onShow 没取当前主题');
  ok(/buildIcons\(/.test(onShow), 'onShow 未重编图标');
  ok(/this\.setData\(\{\s*icons:/.test(onShow), 'onShow 未 setData icons');
});

console.log('\n【九、删除入口（7.1.1 加回：v7.0 重做时随旧票根卡丢了，隐私协议却还写着能删）】');
t('「···」更多菜单里带「删除这张票根」，且点得到 removeTicket', () => {
  const more = js.slice(js.indexOf('onMore()'), js.indexOf('removeTicket() {'));
  ok(/itemList:\s*(items|\[)/.test(more), '找不到更多菜单的 itemList');
  ok(/items\.push\([\s\S]{0,140}?'删除这张票根'\)/.test(more), '菜单里没有「删除这张票根」，或它不在最后一项');
  // 8.4.0：「这一趟的票」是条件插入的，分发从「第几项」改成了「哪一项」。
  // 原来那条 `tapIndex === 3 → removeTicket` 在下标会漂的菜单里守不住任何东西：
  // 多插一项，它要么当场变红（只是运气好），要么在别处悄悄接错（那才是灾难）。
  ok(/pick === '删除这张票根'\)\s*return this\.removeTicket\(\)/.test(more), '菜单里的「删除这张票根」没有接到 removeTicket');
});
t('删除必须二次确认、走数据层（云/演示双模式）、失败有提示', () => {
  const fn = js.slice(js.indexOf('removeTicket() {'), js.indexOf('goBack() {'));
  ok(/wx\.showModal\(/.test(fn), '没有二次确认框');
  ok(/if \(!r\.confirm\) return;/.test(fn), '点了取消还会继续删');
  ok(/await store\.removeTicket\(t\.id\)/.test(fn), '没有走 store.removeTicket（数据层入口）');
  ok(/this\._removing/.test(fn), '没有防连点（删两次会报错）');
  ok(/删除失败/.test(fn), '删除失败没有提示');
});
t('删完退回上一页，且无上级页面时有兜底', () => {
  const fn = js.slice(js.indexOf('goBack() {'), js.indexOf('toggleFav'));
  ok(/wx\.navigateBack\(/.test(fn), '没有 navigateBack');
  ok(/switchTab\(\{ url: '\/pages\/album\/album' \}\)/.test(fn), '分享落地进来看详情时删完会卡在原页');
});
t('隐私政策写的删除路径必须真的存在（不能承诺做不到的事）', () => {
  const protocol = read('pages/protocol/protocol.js');
  ok(!/左滑删除/.test(protocol), '协议仍写着「左滑删除」，而界面上没有这个手势');
  ok(/更多[\s\S]{0,20}删除/.test(protocol),
    '协议没写清删除的实际入口（详情页「···」更多）');
  ok(/'删除这张票根'/.test(js), '协议里说的菜单项在页面里不存在');
});

console.log('\n──────────────────────────────');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
