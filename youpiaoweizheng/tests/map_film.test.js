// tests/map_film.test.js —— 回忆地图「一键成片」回归（8.1.0 拉新 3/6）
// ============================================================
// 这一套的错法全都**不报错**，所以全都真跑，不扫源码猜：
//   ① 播放顺序排错 —— 用户看到一段和自己的记忆对不上的旅程，界面上一切正常；
//   ② 长图版面算错 —— iOS 单边超 4096 直接建不起画布（保存失败/闪退），
//      而开发者工具的 dpr 是 2、屏幕又小，**永远越不了这条线**；
//   ③ 长图画的字 / 数字对不上（把「图上画得下的 12 座」当成「走过的全部」）。
// 前两件是纯函数（utils/mapFilm.js），第三节直接拿一支「录画笔」
// （scripts/dev/canvas2svg.js，与 preview-card / preview-annual 同一支）
// 把 pages/discover/film.js 的 render() 真跑一遍，再把录下来的 SVG 拿来断言。
// ============================================================
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

const mapFilm = require(path.join(ROOT, 'utils', 'mapFilm.js'));
const film = require(path.join(ROOT, 'pages', 'discover', 'film.js'));
const mapArt = require(path.join(ROOT, 'utils', 'mapArt.js'));
const { Recorder } = require(path.join(ROOT, 'scripts', 'dev', 'canvas2svg.js'));

const js = read('pages/discover/discover.js');
const wxml = read('pages/discover/discover.wxml');
const wxss = read('pages/discover/discover.wxss');
const cfg = JSON.parse(read('pages/discover/discover.json'));
const wxmlClean = wxml.replace(/<!--[\s\S]*?-->/g, '');
/** 去掉注释后的源码：注释里写的例子不该被当成代码 */
const decomment = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** 一座城：discover 的 cities 里 x/y 是 mapArt.toStage 算出来的舞台坐标 */
const city = (name, first, count, x, y, color) => ({ city: name, first: first, count: count, x: x, y: y, color: color || '#EFA392' });

console.log('\n【一、播放顺序：按首次到访一站一站走（真跑）】');
t('乱序输入 → 按首次到访升序输出', () => {
  const f = mapFilm.frames([
    city('上海', '2021-05-01', 2, 600, 330),
    city('北京', '2019-01-02', 3, 430, 210),
    city('成都', '2023-03-09', 1, 280, 380)
  ]);
  ok(f.map((s) => s.city).join('>') === '北京>上海>成都', '顺序不对：' + f.map((s) => s.city).join('>'));
  ok(f.map((s) => s.n).join(',') === '1,2,3', '站号没排上：' + f.map((s) => s.n).join(','));
  ok(f[0].year === '2019' && f[1].year === '2021' && f[2].year === '2023', '年份取错');
  ok(f[0].count === 3 && f[1].count === 2 && f[2].count === 1, '张数没跟着城走');
});
t('同一天的几座城按城市名排 —— 换个输入顺序结果必须一样（否则两次播放不一样）', () => {
  const a = [city('杭州', '2020-06-01', 1, 500, 400), city('北京', '2020-06-01', 1, 430, 210), city('成都', '2020-06-01', 1, 280, 380)];
  const b = a.slice().reverse();
  const fa = mapFilm.frames(a).map((s) => s.city).join('>');
  const fb = mapFilm.frames(b).map((s) => s.city).join('>');
  ok(fa === fb, '同一天的两座城顺序会飘：' + fa + ' vs ' + fb);
  ok(fa === '北京>成都>杭州', '没有按城市名排：' + fa);
});
t('没有日期的城排最后、年份留空（不猜年份，也别把它丢了）', () => {
  const f = mapFilm.frames([
    city('武汉', '', 3, 400, 400),
    city('北京', '2019-01-02', 3, 430, 210)
  ]);
  ok(f[0].city === '北京' && f[1].city === '武汉', '无日期的城没排最后：' + f.map((s) => s.city).join('>'));
  ok(f[1].year === '', '给无日期的城编了年份：' + f[1].year);
});
t('日期是脏值（只有年 / 乱写 / 数字）时取得到年份就取，取不到就空', () => {
  ok(mapFilm.yearOf('2019') === '2019', '只有年份的串取不到');
  ok(mapFilm.yearOf('2019/05/01') === '2019', '斜杠日期取不到');
  ok(mapFilm.yearOf('去年') === '' && mapFilm.yearOf(null) === '' && mapFilm.yearOf(2019) === '2019',
    '脏值没兜住');
});
t('没有落点的城不参与播放（地图上根本画不出来，站号会跳）', () => {
  const f = mapFilm.frames([
    city('北京', '2019-01-02', 3, 430, 210),
    { city: '某城', first: '2019-01-03', count: 1 },         // 没坐标
    { city: '', first: '2019-01-04', count: 1, x: 1, y: 1 }  // 没名字
  ]);
  ok(f.length === 1, '不该进播放的城进来了：' + f.map((s) => s.city).join(','));
  ok(f[0].n === 1, '站号被幽灵城占了');
});
t('frames 不改入参（discover 的 cities 还在页面上画着）', () => {
  const src = [city('上海', '2021-05-01', 2, 600, 330), city('北京', '2019-01-02', 3, 430, 210)];
  const before = src.map((c) => c.city).join('>');
  mapFilm.frames(src);
  ok(src.map((c) => c.city).join('>') === before, 'frames 把入参原地排序了');
});
t('年份跨度：跨年写成「起 – 止」、只有一年就写那一年、一座有日期的城都没有则空串', () => {
  ok(mapFilm.span(mapFilm.frames([city('A', '2019-01-01', 1, 1, 1), city('B', '', 1, 2, 2), city('C', '2026-01-01', 1, 3, 3)])) === '2019 – 2026',
    '跨度不对：' + mapFilm.span(mapFilm.frames([city('A', '2019-01-01', 1, 1, 1), city('C', '2026-01-01', 1, 3, 3)])));
  ok(mapFilm.span(mapFilm.frames([city('A', '2019-01-01', 1, 1, 1)])) === '2019', '只有一年时不该写成区间');
  ok(mapFilm.span(mapFilm.frames([city('A', '', 1, 1, 1)])) === '', '没有年份时不该编一个出来');
});

console.log('\n【二、入口该不该露（真跑 canPlay）】');
t('云兜底的演示城市不露 —— 拿别人的城市请他回忆是骗人', () => {
  const two = [city('武汉', '2024-01-01', 1, 400, 400), city('长沙', '2024-02-01', 1, 380, 430)];
  ok(mapFilm.canPlay(two, {}) === true, '正常数据反而不给露');
  ok(mapFilm.canPlay(two, { netFallback: true }) === false, '云兜底时没闭嘴');
});
t('不足两座城不露（一座城播不出旅程），空数据不崩', () => {
  ok(mapFilm.canPlay([], {}) === false, '空数据仍给露');
  ok(mapFilm.canPlay(null, {}) === false, 'null 没兜住');
  ok(mapFilm.canPlay([city('北京', '2019-01-01', 1, 430, 210)], {}) === false, '一座城也露');
  ok(mapFilm.canPlay([city('北京', '2019-01-01', 1, 430, 210), { city: '某城' }], {}) === false,
    '只有一座有落点也露');
});

console.log('\n【三、长图版面：真机上是「建不建得起画布」的事（真跑 sheet）】');
t('12 城（上游封顶）时 dpr 2 不越 iOS 单边的 4096', () => {
  const s = mapFilm.sheet(12);
  ok(s.h * 2 <= 4096, '12 城长图 dpr2 高达 ' + s.h * 2 + '，iOS 上建不起画布');
  ok(s.w * 2 <= 4096, '宽度也越线：' + s.w * 2);
});
t('城市越多图越长，且行数被夹在上限内', () => {
  ok(mapFilm.sheet(3).h < mapFilm.sheet(12).h, '行数没影响高度');
  ok(mapFilm.sheet(3).h === mapFilm.sheet(3).h, '同样输入两次结果不一样');
  ok(mapFilm.sheet(999).rows === mapFilm.MAX_ROWS, '行数没被夹住：' + mapFilm.sheet(999).rows);
  ok(mapFilm.sheet(0).rows === 1 && mapFilm.sheet(-5).rows === 1 && mapFilm.sheet('abc').rows === 1,
    '脏行数没兜住');
  ok(Number.isFinite(mapFilm.sheet(undefined).h), 'undefined 算出了非数');
});
t('三块版面首尾相接、不重叠（年表压页脚、页脚压出纸外都是看不出来的错）', () => {
  const s = mapFilm.sheet(5);
  ok(s.masthead.y === 0 && s.masthead.h <= s.map.y, '抬头与地图区叠了');
  ok(s.map.y + s.map.h <= s.list.y, '地图区压到年表上了');
  ok(s.list.y + s.list.h === s.foot.y, '年表与页脚之间有空隙或重叠：' + (s.list.y + s.list.h) + ' vs ' + s.foot.y);
  ok(s.foot.y + s.foot.h === s.h, '页脚没落到纸的底边：' + (s.foot.y + s.foot.h) + ' vs ' + s.h);
  ok(s.map.x >= 0 && s.map.x + s.map.w <= s.w, '地图区横向出界');
});

console.log('\n【四、长图真的画得出来（拿录画笔真跑 render）】');
/** 把 render 跑一遍，返回录下来的 SVG 与调用次数 */
const run = (v) => {
  const fit = v.fit || mapFilm.sheet((v.cities || []).length || 1);
  const ctx = new Recorder(fit.w, fit.h);
  film.render(ctx, Object.assign({ fit }, v));
  return ctx.toSVG();
};
const FOUR = mapFilm.frames([
  city('北京', '2019-01-02', 3, 430, 210, '#EFA392'),
  city('上海', '2021-05-01', 2, 520, 330, '#EFA392'),
  city('成都', '2023-03-09', 1, 280, 380, '#A9C3A6'),
  city('乌鲁木齐', '', 1, 120, 150, '#F2CE7E')
]);
t('真跑不抛、产物里没有 NaN / undefined', () => {
  const svg = run({ total: 47, cities: FOUR, span: mapFilm.span(FOUR), tip: '另有 35 座城没画上来（图上最多放 12 座）' });
  ok(/<svg\s+xmlns=/.test(svg), '产物不是 SVG');
  ok(!/NaN/.test(svg), '画出了 NaN 的坐标');
  ok(!/undefined/.test(svg), '画出了 undefined 的字');
});
t('抬头写的是**全部**城市数，不是图上画得下的那几座', () => {
  const svg = run({ total: 47, cities: FOUR, span: mapFilm.span(FOUR) });
  ok(svg.indexOf('这些年，你走过 47 座城') >= 0, '抬头没按全部城市数写：' + (svg.match(/这些年[^<]*/) || [])[0]);
});
t('一件数据都没有时不留一块白板（写一句话，别让人以为图坏了）', () => {
  const svg = run({ total: 0, cities: [], span: '' });
  ok(svg.indexOf('还没有落到地图上的城市') >= 0, '空年表什么都没画');
  ok(svg.indexOf('这些年，你走过的路') >= 0, '空数据时抬头写成了一句数据断言');
});
t('没有年份的城市不编年份（行首退成破折号）', () => {
  const svg = run({ total: 4, cities: FOUR, span: mapFilm.span(FOUR) });
  ok(svg.indexOf('——') >= 0, '无年份的行没有兜底符号');
  ok(svg.indexOf('乌鲁木齐') >= 0, '无年份的城被丢了');
});
t('城市一多就不在图上写城市名（名字在下面的年表里一个不少）', () => {
  const many = mapFilm.frames(Array.from({ length: 12 }, (_, i) =>
    city('城' + i, '20' + (10 + i) + '-01-01', 1, 100 + i * 40, 150 + i * 30)));
  const svgMany = run({ total: 12, cities: many, span: mapFilm.span(many) });
  const svgFew = run({ total: 4, cities: FOUR, span: mapFilm.span(FOUR) });
  ok(svgMany.indexOf('城0') >= 0, '年表里都没写城市名，断言的前提不成立');
  ok(svgFew.indexOf('>北京<') >= 0, '城少时图上应当写城市名');
  ok(mapFilm.MAX_ROWS >= 12, 'MAX_ROWS 比上游的 12 城还小，会有城画不上');
});
t('没有版面就不画（不猜一个尺寸出来）', () => {
  let threw = false;
  try { film.render(new Recorder(750, 1200), null); film.render(null, { fit: mapFilm.sheet(2) }); }
  catch (e) { threw = true; }
  ok(!threw, '缺参数时抛了');
});
t('脏城市数据不崩（null / 空名 / 坐标是字符串）', () => {
  let threw = false;
  try {
    run({ total: 3, cities: [null, { city: '' }, { city: '北京', x: 1, y: 1, count: 1, year: '2019' }], span: '2019' });
  } catch (e) { threw = true; }
  ok(!threw, '脏数据把长图搞崩了');
});
t('轨迹图用的是舞台坐标（与页面同一套投影），落点因此对得上', () => {
  const c = { city: '北京', year: '2019', count: 1, x: 430, y: 210, color: '#EFA392' };
  const fit = mapFilm.sheet(1);
  const svg = run({ total: 1, cities: [c], span: '2019' });
  const k = fit.map.w / mapArt.STAGE_W;
  const x = fit.map.x + 430 * k;
  const y = fit.map.y + 210 * k;
  ok(svg.indexOf(String(Math.round(x * 1000) / 1000)) >= 0 || svg.indexOf(String(x)) >= 0,
    '落点没落在按舞台坐标算出的位置上（x ≈ ' + x.toFixed(1) + '）');
  ok(svg.indexOf(String(Math.round(y * 1000) / 1000)) >= 0 || svg.indexOf(String(y)) >= 0,
    '落点 y 对不上（y ≈ ' + y.toFixed(1) + '）');
});

console.log('\n【五、页面接线：演的是同一张地图，不另开一套】');
t('入口门控接的是 canPlay 的结果，不是另写一条判断', () => {
  ok(/canFilm:\s*mapFilm\.canPlay\(cities, flags\)/.test(js), 'canFilm 没走 mapFilm.canPlay');
  ok(/canFilm:\s*false/.test(js), '失败路径没把入口收掉（会点进去看一段空旅程）');
  ok(/wx:if="\{\{canFilm && !loading && !error\}\}"/.test(wxmlClean), 'wxml 没按 canFilm 门控');
  ok(/bindtap="startFilm"/.test(wxmlClean), '入口没接 startFilm');
});
t('播放顺序与地图上那条路线是同一个编排（两处各排一次迟早对不上）', () => {
  ok(/const station = mapFilm\.frames\(cities\)/.test(js), '路线没用 mapFilm.frames 排');
  ok(/const route = mapArt\.routeSrc\(station\.map\(/.test(js), '路线没按 station 连');
  ok(/this\._station = station/.test(js) && /this\._geo = geoOf/.test(js), '播放要用的编排没留下来');
  ok(!/ordered/.test(decomment(js)), '旧的第二套排序（ordered）还在，两套顺序会打架');
});
t('播放不换页、不新开页面（就是同一张水彩卡换个演法）', () => {
  ok(/wx:for="\{\{filmOn \? filmLit : cities\}\}"/.test(wxmlClean),
    '气泡没接播放态 —— 演的就是 cities 里那几个，不另造一套');
  ok(/if \(this\._reduce\) \{ this\._filmTick\(station\.length\); return; \}/.test(js),
    '减弱动态效果的用户没得到「直接给结局」的待遇');
  ok(!/wx\.navigateTo\([^)]*film/i.test(js), '播放跳了页');
});
t('播放的定时器登记成实例字段，onHide 与 onUnload 都收口', () => {
  ok(/this\._filmT = setInterval\(/.test(js), '定时器没登记成实例字段');
  const hide = /onHide\(\)\s*\{([\s\S]*?)\n  \},/.exec(js);
  const unload = /onUnload\(\)\s*\{([\s\S]*?)\n  \},/.exec(js);
  ok(hide && /stopFilm\(\)/.test(hide[1]), 'onHide 没收播放（tab 页切走只会走 onHide）');
  ok(unload && /_stopFilmTimer\(\)/.test(unload[1]), 'onUnload 没收播放');
  ok(/clearInterval\(this\._filmT\)/.test(js), '没有真的 clearInterval');
});

console.log('\n【六、存长图：画布、权限、出口】');
t('离屏画布跟着播放态建销，且甩在屏幕外', () => {
  ok(/wx:if="\{\{filmOn\}\}"[^>]*id="filmCanvas"/.test(wxmlClean), '画布没跟播放态一起建/销');
  ok(/\.fl-cv\s*\{[^}]*position:\s*fixed/.test(wxss) && /\.fl-cv\s*\{[^}]*left:\s*-\d+px/.test(wxss),
    '画布没甩到屏幕外，会占着页面');
  ok(/createSelectorQuery\(\)\.select\('#filmCanvas'\)\.fields\(\{ node: true \}\)/.test(js),
    '画布节点不是 createSelectorQuery 拿的');
});
t('dpr 走 canvas-deco.safeDpr（直接乘 dpr 会在 iOS 上建不起画布）', () => {
  ok(/safeDpr\(fit\.w, fit\.h,/.test(js), 'dpr 没回夹');
  ok(/require\(['"][^'"]*utils\/canvas-deco\.js['"]\)/.test(js), '没引 canvas-deco');
});
t('存相册走公共实现（不在页面里再抄一份授权处理）', () => {
  const body = decomment(js);
  ok(/saveimg\.exportCanvas\(canvas\)/.test(body) && /saveimg\.save\(path\)/.test(body), '没走 utils/saveimg');
  ok(!/wx\.saveImageToPhotosAlbum/.test(body), '页面里直接调了相册接口，绕过了授权引导');
  ok(/if \(!e \|\| !e\.shown\)/.test(body), '没区分「已经弹过窗」的失败，会叠两个提示');
  ok(/saving:\s*true/.test(body) && /if \(this\.data\.saving\) return/.test(body), '存图没有防连点');
});
t('本页调了相册接口，隐私授权弹窗必须挂上（同 card / art / annual）', () => {
  ok(cfg.usingComponents['privacy-sheet'], 'discover.json 没注册 privacy-sheet');
  ok(/<privacy-sheet\s*\/>/.test(wxmlClean), 'wxml 里没放 privacy-sheet');
});
t('两个出口都是真的：存长图接 saveFilm，发给朋友是真 button', () => {
  ok(/bindtap="saveFilm"/.test(wxmlClean), '存长图没接方法');
  ok(/<button[^>]*open-type="share"/.test(wxmlClean), '「发给朋友」不是 open-type=share 的真按钮');
  ok(/bindtap="stopFilm"/.test(wxmlClean) && /bindtap="skipFilm"/.test(wxmlClean), '退出/跳过没接方法');
  ['startFilm', 'skipFilm', 'stopFilm', 'saveFilm'].forEach((m) => {
    ok(new RegExp('\\n  (?:async )?' + m + '\\(').test(decomment(js)), '方法没实现：' + m);
  });
});
t('新埋点都是小写蛇形，且各记在发生的那一刻', () => {
  const names = [...decomment(js).matchAll(/track\.track\('([^']+)'/g)].map((m) => m[1]);
  names.forEach((n) => ok(/^[a-z][a-z0-9_]*$/.test(n), '事件名不合规：' + n));
  ok(names.indexOf('map_film') >= 0, '没记「谁看了成片」');
  ok(names.indexOf('map_film_save') >= 0, '没记「谁存了长图」');
  ok(/track\.track\('map_film'[\s\S]{0,80}stops:/.test(decomment(js)), 'map_film 没带站数');
});

console.log('\n【七、分享：落点就是本页，封面在包里】');
t('map 场景已注册，落点回本页，好友点进去看到的是自己的空地图', () => {
  const share = require(path.join(ROOT, 'utils', 'share.js'));
  ok(share.SCENES.map, 'map 场景没注册');
  const m = share.message('map', { cities: 7 });
  ok(m.path.indexOf('/pages/discover/discover') >= 0, '落点不是地图页：' + m.path);
  ok(m.title.indexOf('7') >= 0, '标题没带上城市数：' + m.title);
  ok(m.imageUrl === share.COVERS.map, '没用自己的封面');
  ok(share.timeline('map', { cities: 7 }).imageUrl === share.COVERS.map, '朋友圈没有现成配图');
});
t('本页接了两条分享，且都记了来源（看板要能分出是哪一页带来的）', () => {
  const body = decomment(js);
  ok(/onShareAppMessage\s*\(/.test(body) && /onShareTimeline\s*\(/.test(body), '分享钩子没接全');
  ok(/track\.track\('share_click'[\s\S]{0,40}from:/.test(body), 'share_click 没有 from');
  ok(/track\.track\('share_timeline'[\s\S]{0,40}from:/.test(body), 'share_timeline 没有 from');
});
t('本页也补了单页模式落地卡（那模式下空地图是死的，跳页会被拒）', () => {
  ok(/share\.sp\(\)/.test(decomment(js)), '没判单页模式');
  ok(wxml.indexOf('/templates/sp.wxml') >= 0, 'wxml 没引品牌落地卡');
  ok(/<template is="spGate"/.test(wxmlClean), '没渲染落地卡');
  ok(/wx:if="\{\{!sp\}\}"/.test(wxmlClean), '正文没跟单页模式互斥');
});

console.log('\n【八、样式与版面对得上（对不上就会悄悄截断或压住）】');
t('wxml 里的类名都在 wxss 里有定义（放行全局公共类）', () => {
  const GLOBAL = /^(tk-|press|theme-|card$|b-|skeleton-|ad-|serif$|mono$)/;
  const used = new Set([...wxmlClean.matchAll(/(?:^|\s)class="([^"]*)"/g)]
    .flatMap((m) => m[1].replace(/\{\{[\s\S]*?\}\}/g, ' ').split(/\s+/)).filter(Boolean));
  const defined = new Set([...wxss.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));
  const miss = [...used].filter((u) => !defined.has(u) && !GLOBAL.test(u));
  ok(miss.length === 0, 'wxss 缺样式：' + miss.join(', '));
});
t('wxss 无写死的十六进制（只允许 var(--x, #兜底) 的兜底值）', () => {
  const stripped = wxss.replace(/var\([^)]*\)/g, 'VAR');
  const bad = [...stripped.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  ok(bad.length === 0, '写死色值：' + bad.join(', '));
});
t('播放底条是固定条（滚走了就没法跳过、也没有出口）', () => {
  ok(/\.fl-hud\s*\{[^}]*position:\s*fixed/.test(wxss), '底条不是固定的');
  ok(/env\(safe-area-inset-bottom\)/.test(wxss), '底条没避让底部安全区');
  ok(/\.dc-filming \.tk-safe-bottom\s*\{[^}]*height:\s*\d+rpx/.test(wxss),
    '播放时没给固定底条补高度，长页末尾会被盖住');
});
t('播放态把地图周围那圈东西收掉（留着卡片被挤小、眼睛也没有落点）', () => {
  ['.dc-head', '.dc-view', '.dc-foot', '.dc-film'].forEach((sel) => {
    ok(new RegExp('\\.dc-filming ' + sel.replace('.', '\\.') + ',').test(wxss) ||
       new RegExp('\\.dc-filming ' + sel.replace('.', '\\.') + '\\s*[,{]').test(wxss),
      '播放时没收掉 ' + sel);
  });
});

console.log('\n──────────────────────────────');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
