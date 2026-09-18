// tests/sign_board.test.js —— 线下扫码立牌回归（8.1.0 拉新 4/6）
// ============================================================
// 这一批的错法全都**不报错**，所以全都真跑，不扫源码猜：
//   ① 标题冲出纸边 —— 画布不会拦你，字就那样被裁掉半行，页面上一点异常都没有；
//      而这还是**打印出来才会发现**的东西（打印机一响就晚了）。
//   ② 没拿到小程序码照样出图 —— 印出来是个扫不动的白框，贴在门口也没人告诉你。
//   ③ 立牌码把用户送进拍照页之后退不回去 —— 页面栈里只有 scan 一页，
//      navigateBack 静默失败，用户就卡在「已收进时光档案」的动画上。
// ①②是纯函数（utils/signBoard.js）与画笔（pages/sign/board.js），
//   第三节直接拿一支「录画笔」（scripts/dev/canvas2svg.js，与 preview-card / map_film 同一支）
//   把 render() 真跑一遍，再把录下来的 SVG 拿来断言。
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

const board = require(path.join(ROOT, 'utils', 'signBoard.js'));
const painter = require(path.join(ROOT, 'pages', 'sign', 'board.js'));
const { Recorder } = require(path.join(ROOT, 'scripts', 'dev', 'canvas2svg.js'));

const js = read('pages/sign/sign.js');
const wxml = read('pages/sign/sign.wxml');
const wxss = read('pages/sign/sign.wxss');
const cfg = JSON.parse(read('pages/sign/sign.json'));
const app = JSON.parse(read('app.json'));
const fnJs = read('cloudfunctions/saveTicket/index.js');
const scanJs = read('pages/scan/scan.js');
const settingJs = read('pages/setting/setting.js');

const wxmlClean = wxml.replace(/<!--[\s\S]*?-->/g, '');
/** 去掉注释后的源码：注释里写的例子不该被当成代码 */
const decomment = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

console.log('\n【一、用户填的东西怎么收成能画的东西（真跑 sanitize）】');
t('首尾空白与连续空白都折掉 —— 换行会让「一行标题」的版面假设失效', () => {
  const s = board.sanitize({ title: '  广州\n大剧院  ', sub: '看完  别走' });
  ok(s.title === '广州 大剧院', '标题没折干净：[' + s.title + ']');
  ok(s.sub === '看完 别走', '副标题没折干净：[' + s.sub + ']');
});
t('标题超长截到 16 字、副标题截到 24 字（版面是按这两个数摆的）', () => {
  const long = '一二三四五六七八九十一二三四五六七八九十';
  ok(board.sanitize({ title: long }).title.length === board.TITLE_MAX, '标题没截到上限');
  obj: {
    const s = board.sanitize({ sub: long + long });
    ok(s.sub.length === board.SUB_MAX, '副标题没截到上限：' + s.sub.length);
  }
});
t('没填名字 = 不能出图；副标题留空 = 退回默认那句（不是空着一行）', () => {
  ok(board.sanitize({}).ok === false && board.sanitize({ title: '   ' }).ok === false, '空标题被当成能出图');
  ok(board.sanitize({ title: '广州大剧院' }).ok === true, '有标题反而不给过');
  ok(board.sanitize({ title: '广州大剧院' }).sub === board.SUB_DEFAULT, '副标题没退回默认句');
  ok(board.sanitize({ title: 'A', sub: '   ' }).sub === board.SUB_DEFAULT, '空白副标题没退回默认句');
});
t('默认那句不写「快来分享」这类话（这一版立牌不设任何奖励，写了就是骗）', () => {
  ok(!/奖励|返现|免费领|分享给/.test(board.SUB_DEFAULT), '默认号召语里出现了承诺：' + board.SUB_DEFAULT);
  ok(!/奖励|返现|免费领/.test(board.SCAN_TIP), '扫码说明里出现了承诺：' + board.SCAN_TIP);
});
t('脏值不崩（null / 数字 / undefined / 对象）', () => {
  let threw = false;
  try {
    board.sanitize(null); board.sanitize(undefined); board.sanitize({ title: 123, sub: 456 });
    board.sanitize({ title: {}, sub: [] });
    board.titleSize(null); board.titleSize(undefined);
  } catch (e) { threw = true; }
  ok(!threw, '脏输入把纯函数搞崩了');
  ok(board.sanitize({ title: 123 }).title === '123', '数字标题没被 String 化');
});

console.log('\n【二、字号与版面（真跑 titleSize / sheet）】');
t('标题字号按字数分三档，短的名字大、长的名字小', () => {
  ok(board.titleSize('广州大剧院') === 66, '6 字以内该是 66');
  ok(board.titleSize('一二三四五六') === 66, '刚好 6 字应该是大号');
  ok(board.titleSize('一二三四五六七') === 52, '第 7 字该降到 52');
  ok(board.titleSize('一二三四五六七八九十') === 52, '刚好 10 字该是 52');
  ok(board.titleSize('一二三四五六七八九十一') === 40, '第 11 字该降到 40');
});
t('纸是 A4 竖版（打印时按比例缩放即可，不必再适配）', () => {
  const r = board.SIZE.w / board.SIZE.h;
  ok(Math.abs(r - 1 / board.A4_RATIO) < 0.002, '纸不是 A4 比例：' + r.toFixed(4));
});
t('每一块都在纸里，横向不出界', () => {
  const s = board.sheet();
  ['brand', 'slogan', 'title', 'sub', 'qr', 'tip', 'foot'].forEach((k) => {
    const b = s[k];
    ok(b.x >= 0 && b.x + b.w <= s.w, k + ' 横向出界：' + b.x + '+' + b.w);
    ok(b.y >= 0 && b.y + b.h <= s.h, k + ' 纵向出界：' + b.y + '+' + b.h);
  });
});
t('块与块不重叠、页脚落在纸的底边（压字看不出来，只会「有点怪」）', () => {
  const s = board.sheet();
  ok(s.brand.y + s.brand.h <= s.slogan.y, '品牌名压到口号上了');
  ok(s.slogan.y + s.slogan.h <= s.title.y, '口号压到标题上了');
  ok(s.title.y + s.title.h <= s.sub.y, '标题压到号召语上了');
  ok(s.sub.y + s.sub.h <= s.qr.y - 16, '号召语压到码的白底上了');
  ok(s.qr.y + s.qr.h <= s.tip.y, '码压到扫码说明上了');
  ok(s.tip.y + s.tip.h <= s.foot.y, '扫码说明压到页脚上了');
  ok(s.foot.y + s.foot.h <= s.h, '页脚冲出纸外了');
  ok(s.frame.x < s.brand.x && s.frame.y < s.brand.y, '齿边纸框没包住内容');
});
t('码占纸宽将近一半（站远一点也得扫得动）', () => {
  const s = board.sheet();
  ok(s.qr.w / s.w > 0.4, '码太小，门口走来的人扫不动：' + (s.qr.w / s.w).toFixed(2));
  ok(s.qr.x === (s.w - board.QR_SIZE) / 2, '码没在纸的中轴上');
});
t('出图 dpr2 离 iOS 单边 4096 那条线还很远', () => {
  const s = board.sheet();
  ok(s.w * 2 <= 4096 && s.h * 2 <= 4096, 'dpr2 高达 ' + (s.h * 2) + '，iOS 上建不起画布');
  ok(s.h * 2 >= 2000, 'A4 出图不到 2000px 高，打印会糊：' + (s.h * 2));
});

console.log('\n【三、这张立牌真的画得出来（拿录画笔真跑 render）】');
/** 把 render 跑一遍，返回录下来的 SVG */
const run = (v) => {
  const fit = v.fit || board.sheet();
  const ctx = new Recorder(fit.w, fit.h);
  painter.render(ctx, Object.assign({ fit }, v));
  return ctx.toSVG();
};
const QR = { width: 430, height: 430 };   // 录画笔只把它当占位（drawImage 记成一个灰矩形）
const FULL = {
  title: '广州大剧院', sub: '看完别走，先把今晚这张收进来', qr: QR
};
/** 取某段文字画出来时的字号（同一句话只画一次，取不到返回 -1） */
const sizeOf = (svg, text) => {
  const m = new RegExp('<text[^>]*font-size="(\\d+(?:\\.\\d+)?)"[^>]*>' + text + '</text>').exec(svg);
  return m ? Number(m[1]) : -1;
};

t('真跑不抛、产物里没有 NaN / undefined', () => {
  const svg = run(FULL);
  ok(/<svg\s+xmlns=/.test(svg), '产物不是 SVG');
  ok(!/NaN/.test(svg), '画出了 NaN 的坐标');
  ok(!/undefined/.test(svg), '画出了 undefined 的字');
});
t('该有的字一个都不少：品牌、口号、标题、号召语、扫码说明、页脚', () => {
  const svg = run(FULL);
  [board.BRAND, board.SLOGAN, FULL.title, FULL.sub, board.SCAN_TIP].forEach((s) => {
    ok(svg.indexOf(s) >= 0, '没画上：' + s);
  });
  // 页脚那句是「品牌名 · 口号」，与顶部那条口号不是同一段文字
  ok(svg.indexOf('>' + board.BRAND + ' · ' + board.SLOGAN + '<') >= 0, '页脚没落品牌名');
});
t('标题**收进纸宽**：16 个汉字不许冲出纸边', () => {
  const width = board.sheet().title.w;
  const cjk = '一二三四五六七八九十一二三四五六';   // 16 个字，顶着 TITLE_MAX
  ok(cjk.length === board.TITLE_MAX, '断言前提不成立：这串不是 16 字');
  const svg = run({ title: cjk });
  const size = sizeOf(svg, cjk);
  ok(size > 0, '标题根本没画出来');
  ok(size * cjk.length <= width, '标题溢出：' + size + 'px × ' + cjk.length + ' 字 = ' +
    size * cjk.length + ' > 可用 ' + width);
  ok(size >= 26, '标题收得太小了，门口看不清：' + size);
});
t('窄的标题不收（全角 16 字要收、半角 16 位不用 —— 按字数分档会误伤）', () => {
  const digits = '1234567890123456';
  const svg = run({ title: digits });
  ok(sizeOf(svg, digits) === board.titleSize(digits),
    '半角标题被无谓地收小了：' + sizeOf(svg, digits));
});
t('号召语折行画，一个字都不丢（超了会静默截断）', () => {
  const sub = '一二三四五六七八九十一二三四五六七八九十一二三四';   // 24 字，顶着 SUB_MAX
  ok(sub.length === board.SUB_MAX, '断言前提不成立：这串不是 24 字');
  const svg = run({ title: 'A', sub: sub });
  let hit = 0;
  for (const ch of sub) if (svg.indexOf('>' + ch + '<') >= 0 || svg.indexOf(ch) >= 0) hit++;
  ok(hit === sub.length, '号召语被截断了，只画出来 ' + hit + ' / ' + sub.length + ' 个字');
});
t('码最宽也只画到纸里，且**没码就不画**（不留一个扫不动的白框）', () => {
  const q = board.sheet().qr;
  const withQR = run(FULL);
  const box = new RegExp('<rect x="' + q.x + '" y="' + q.y + '" width="' + q.w + '" height="' + q.h + '"');
  ok(box.test(withQR), '有码时没在版面算出的坐标上画码：' + q.x + ',' + q.y);
  const none = run({ title: FULL.title, sub: FULL.sub, qr: null });
  ok(!box.test(none), '没码时还是画了一块东西出来 —— 印出来就是个扫不动的黑框');
  ok(none.indexOf(board.SCAN_TIP) >= 0, '没码时连说明都不画了（用户不知道该等还是该重进）');
});
t('标题空着时画的是浅色占位，与真标题一眼能分开', () => {
  const dim = run({ title: '场馆 / 活动名', dim: true });
  const real = run({ title: '场馆 / 活动名' });
  const fillOf = (svg) => ((svg.match(/<text[^>]*fill="(#[0-9A-Fa-f]{6})"[^>]*>场馆 \/ 活动名<\/text>/) || [])[1] || '');
  ok(fillOf(dim) && fillOf(real), '标题没画出来');
  ok(fillOf(dim) !== fillOf(real), '占位色与真标题同色，用户会把占位当成填好的内容直接存走');
});
t('缺参数 / 脏数据不崩（没有版面就不画，不猜一个尺寸出来）', () => {
  let threw = false;
  try {
    painter.render(new Recorder(750, 1060), null);
    painter.render(null, { fit: board.sheet() });
    run({});
    run({ title: null, sub: null, qr: {} });
    run({ title: 123, sub: [], qr: null });
  } catch (e) { threw = true; }
  ok(!threw, '脏数据把立牌画崩了');
});

console.log('\n【四、页面接线：取码 → 画 → 存】');
t('码走的是云函数 wxacode 的 kind=sign（与分享那张码不是同一条路）', () => {
  const body = decomment(js);
  ok(/name:\s*'saveTicket'/.test(body), '云函数名不是 saveTicket');
  ok(/action:\s*'wxacode'/.test(body) && /kind:\s*'sign'/.test(body), '没带 kind=sign');
  ok(/fileID/.test(body) && /getTempFileURL/.test(body), '拿到 fileID 后没换临时链接');
  ok(/createImage\(\)/.test(body), '没建 canvas Image');
});
t('取不到码就不给存（宁可让他等一下，也不能印出一张扫不动的图）', () => {
  const body = decomment(js);
  ok(/if \(!this\._qrImg\)/.test(body), '没判「码还没到位」');
  ok(/qrFail/.test(body) && /setData\(\{ qrFail: true \}\)/.test(body), '取码失败没留下可见的状态');
  ok(/isDemo/.test(body), '演示模式没被挡住');
});
t('重画前复位变换（scale 是叠加的，不复位第二次就画到纸外面去了）', () => {
  const body = decomment(js);
  const m = /draw\(\)\s*\{([\s\S]*?)\n  \},/.exec(body);
  ok(m, '找不到 draw()');
  ok(/setTransform\(1, 0, 0, 1, 0, 0\)/.test(m[1]), 'draw 里没复位变换');
  ok(m[1].indexOf('setTransform') < m[1].indexOf('scale('), '先 scale 后 setTransform，等于没复位');
});
t('输入重画的定时器登记成实例字段，onHide 与 onUnload 都收口', () => {
  const body = decomment(js);
  ok(/this\._drawT = setTimeout\(/.test(body), '定时器没登记成实例字段');
  // 钩子可能写成一行（`onHide() { this._clearDrawT(); },`）也可能多行，两种都得认
  const hide = /onHide\(\)\s*\{\s*([^}]*)\}/.exec(body);
  const unload = /onUnload\(\)\s*\{\s*([^}]*)\}/.exec(body);
  ok(hide && /_clearDrawT\(\)/.test(hide[1]), 'onHide 没收定时器');
  ok(unload && /_clearDrawT\(\)/.test(unload[1]), 'onUnload 没收定时器');
  ok(/clearTimeout\(this\._drawT\)/.test(body), '没有真的 clearTimeout');
});
t('存相册走公共实现（不在页面里再抄一份授权处理）', () => {
  const body = decomment(js);
  ok(/await saveimg\.exportCanvas\([^)]*\)/.test(body) && /await saveimg\.save\([^)]*\)/.test(body),
    '没走 utils/saveimg');
  ok(!/wx\.saveImageToPhotosAlbum/.test(body), '页面里直接调了相册接口，绕过了授权引导');
  ok(/if \(!e \|\| !e\.shown\)/.test(body), '没区分「已经弹过窗」的失败，会叠两个提示');
  ok(/saving:\s*true/.test(body) && /if \(this\.data\.saving\) return/.test(body), '存图没有防连点');
  ok(/safeDpr\(/.test(body), 'dpr 没回夹');
});
t('本页调了相册接口，隐私授权弹窗必须挂上（同 card / art / annual / discover）', () => {
  ok(cfg.usingComponents['privacy-sheet'], 'sign.json 没注册 privacy-sheet');
  ok(/<privacy-sheet\s*\/>/.test(wxmlClean), 'wxml 里没放 privacy-sheet');
});
t('存图的按钮是真的（不是个点不动的假按钮）', () => {
  ok(/bindtap="save"/.test(wxmlClean), '主按钮没接 save');
  ok(/\n  async save\(\)\s*\{/.test(decomment(js)), 'save 没实现');
});
t('出图这一次才记埋点，且事件名是小写蛇形', () => {
  const names = [...decomment(js).matchAll(/track\.track\('([^']+)'/g)].map((m) => m[1]);
  names.forEach((n) => ok(/^[a-z][a-z0-9_]*$/.test(n), '事件名不合规：' + n));
  ok(names.indexOf('sign_save') >= 0, '没记「谁印了立牌」');
  // 扫码来源由 app.js 的 scene_source 覆盖（scene='b=sign'），本页不另造一个
  ok(names.length === 1, '本页多记了事件（来源已在 app.js 的 scene_source 里）：' + names.join(', '));
});

console.log('\n【五、立牌上的码（云函数 wxacode 的 kind=sign 分支）】');
t('落地页写死在云函数里，端上指定不了任意页面', () => {
  const m = /async function wxacodeAction\(event\)\s*\{([\s\S]*?)\n\}/.exec(fnJs);
  ok(m, '找不到 wxacodeAction');
  ok(/page:\s*'pages\/scan\/scan'/.test(m[1]), '落地页没写死成拍照页');
  ok(!/event\.page/.test(m[1]) && !/event\.path/.test(m[1]), '落地页能被端上传进来 —— 谁都能做出跳到任意页面的码');
});
t('立牌码：scene=b=sign，且不带邀请码（站在场馆里扫码的人与「谁邀请的」无关）', () => {
  const m = /async function wxacodeAction\(event\)\s*\{([\s\S]*?)\n\}/.exec(fnJs);
  ok(/isSign \? 'b=sign'/.test(m[1]), 'scene 没按 kind 分岔');
  ok(/isSign \? '' : String\(\(event && event\.ref\)/.test(m[1]), '立牌码没把 ref 收掉');
  ok(/wxacode_sign/.test(m[1]), '缓存 type 没区分，会与海报码互相顶掉');
});
t('不传 kind 时行为一字不变（线上卡片页正在用这个 action）', () => {
  const m = /async function wxacodeAction\(event\)\s*\{([\s\S]*?)\n\}/.exec(fnJs);
  ok(/isSign \? 'b=sign' : \(ref \? `b=poster&r=\$\{ref\}` : 'b=poster'\)/.test(m[1]),
    '海报码的 scene 被改动了');
  ok(/isSign \? 'wxacode_sign' : \(ref \? 'wxacode_ref' : 'wxacode_poster'\)/.test(m[1]),
    '海报码的缓存 type 被改动了');
  ok(/cloudPath: `\$\{path\}\$\{Date\.now\(\)\}\.png`/.test(m[1]), '云存储路径没走同一处拼接');
});
t('扫码直达拍照页后退得回去（页面栈里只有 scan 一页，navigateBack 必然失败）', () => {
  ok(/wx\.navigateBack\(\{\s*\n?\s*delta:\s*1,\s*\n?\s*fail:/.test(scanJs),
    'scan 的返回还是没有 fail 兜底 —— 立牌码进来的用户会卡在入档动画上');
  ok(/fail:\s*\(\)\s*=>\s*wx\.switchTab\(\{\s*url:\s*'\/pages\/album\/album'\s*\}\)/.test(scanJs),
    '兜底没落收藏册（刚收下的那一张就在那儿）');
});
t('scene=b=sign 不会被当成邀请码（否则立牌带来的用户会被错算成某个人的下线）', () => {
  const invite = read('utils/invite.js');
  const m = /\/\(\?:\^\|&\)r=\(\[A-Za-z0-9\]\+\)\//.exec(invite);
  ok(m, '找不到邀请码的解析正则，断言前提不成立');
  ok(!new RegExp(m[0].slice(1, -1)).test('b=sign'), 'scene=b=sign 被解析成了邀请码');
});

console.log('\n【六、入口与样式（进不去 / 对不上都会悄悄出问题）】');
t('页面已注册，且从设置页进得去', () => {
  ok(app.pages.indexOf('pages/sign/sign') >= 0, 'app.json 没注册 pages/sign/sign');
  ok(/sign:\s*'\/pages\/sign\/sign'/.test(decomment(settingJs)), '设置页没有通向立牌页的入口');
  ok(/\{ key:\s*'sign'/.test(settingJs), '设置页没加那一行');
  ok(/合作场馆立牌/.test(settingJs), '设置页那一行没名字');
});
t('设置页里 clear 仍排在最后（破坏性操作垫底）', () => {
  const rows = /const ROWS = \[([\s\S]*?)\];/.exec(settingJs)[1];
  const keys = [...rows.matchAll(/key:\s*'(\w+)'/g)].map((m) => m[1]);
  ok(keys[keys.length - 1] === 'clear', 'clear 不在最后：' + keys.join(','));
});
t('wxml 里的类名都在 wxss 里有定义（放行全局公共类）', () => {
  const GLOBAL = /^(tk-|press|theme-|btn-|card$|b-|skeleton-|ad-|serif$|mono$)/;
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
t('画布的 CSS 盒子与 750×1060 等比（拉伸的画布看起来只是「有点怪」，不报错）', () => {
  const m = /\.sg-cv\s*\{[^}]*width:\s*(\d+)rpx[^}]*height:\s*(\d+)rpx/.exec(wxss);
  ok(m, '找不到 .sg-cv 的尺寸');
  const ratio = Number(m[2]) / Number(m[1]);
  const want = board.SIZE.h / board.SIZE.w;
  ok(Math.abs(ratio - want) < 0.002, '预览盒子被拉扁了：' + ratio.toFixed(4) + ' vs ' + want.toFixed(4));
  ok(/<canvas[^>]*type="2d"[^>]*id="sgCanvas"/.test(wxmlClean), 'wxml 里的画布不是 canvas 2d');
});
t('演示模式明说「印出来扫不了」，不藏在灰字里', () => {
  ok(/wx:if="\{\{isDemo\}\}"/.test(wxmlClean), '演示模式没有可见提示');
  ok(/扫不了/.test(wxml), '提示里没说清后果');
});

console.log('\n──────────────────────────────');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
