// tests/card_postcard.test.js —— 纪念卡片（品牌全案 · 稿屏6）回归测试
// 核心断言：① 图形一律走 <image src="data:image/svg+xml;base64,...">，无内联 svg / emoji / 字符当图标；
//           ② 画布 600×960rpx 与 card.js 的 W×H 同比（差一点明信片就被拉扁）；
//           ③ 齿边明信片是真在跑的默认风格，且**跑一遍**它：齿边、邮戳、码框都得画出来；
//           ④ 保存 / 分享 / 小红书 / 空态这些既有链路一个都不能少。
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

const wxml = read('pages/card/card.wxml');
const wxss = read('pages/card/card.wxss');
const js = read('pages/card/card.js');
const json = read('pages/card/card.json');
const icons = read('utils/icons.js');

const wxmlClean = wxml.replace(/<!--[\s\S]*?-->/g, '');
const wxssClean = wxss.replace(/\/\*[\s\S]*?\*\//g, '');
const jsClean = js.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const ICONS = new Set([...icons.matchAll(/^\s{2}([a-zA-Z][\w]*):/gm)].map((m) => m[1]));
const num = (re, s) => {
  const m = re.exec(s);
  if (!m) throw new Error('取不到数值：' + re);
  return Number(m[1]);
};
const rule = (sel, s) => {
  const i = s.indexOf(sel + ' {');
  if (i < 0) throw new Error('找不到规则 ' + sel);
  return s.slice(i, s.indexOf('}', i));
};

console.log('\n【一、图形：不得有内联 svg / emoji / 字符当图标】');
t('wxml 正文无 <svg> / <path> / <circle>', () => {
  ok(!/<svg[\s>]/i.test(wxmlClean), '发现内联 <svg>');
  ok(!/<path[\s>]/i.test(wxmlClean), '发现内联 <path>');
});
t('wxml 正文无 emoji（旧空态那颗 🎴 已换成线性图标）', () => {
  const m = wxmlClean.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2728}\u{2764}\u{2315}\u{2715}\u{1F4D5}]/u);
  ok(!m, '残留：' + (m && m[0]));
});
t('不再用 ✓ / ✦ / 📕 这类字符当图标（旧版风格胶囊与小红书按钮都用了）', () => {
  ['✦', '▶', '›', '→', '✓', '★', '☆', '📕'].forEach((ch) => {
    ok(!wxmlClean.includes(ch), '残留字符：' + ch);
  });
});
t('所有 image 的 src 都绑到 JS 下发的变量上（不是写死的路径）', () => {
  const srcs = [...wxmlClean.matchAll(/<image[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]);
  ok(srcs.length >= 7, 'image 数量偏少：' + srcs.length);
  const bad = srcs.filter((s) => !/\{\{/.test(s));
  ok(bad.length === 0, '写死的图片路径：' + bad.join(', '));
});
t('本页用到的图标名都在 utils/icons.js 里注册过', () => {
  const used = [...jsClean.matchAll(/iconSrc\(\s*'([\w]+)'/g)].map((m) => m[1]);
  ok(used.length >= 4, 'iconSrc 调用偏少：' + used.length);
  used.forEach((n) => ok(ICONS.has(n), '图标未注册：' + n));
});
t('纯装饰图形都带 aria-hidden（不进无障碍树）', () => {
  const imgs = [...wxmlClean.matchAll(/<image[^>]*>/g)].map((m) => m[0]);
  const bad = imgs.filter((s) => /class="cd-(deco|behind)/.test(s) && !/aria-hidden="true"/.test(s));
  ok(bad.length === 0, '缺 aria-hidden：' + bad.map((b) => b.slice(0, 60)).join(' | '));
});
t('WXSS 里的十六进制只允许出现在 var(--x, #兜底) 里', () => {
  const bad = [...wxssClean.matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
    .filter((m) => !/var\([^)]*#[0-9a-fA-F]{3,8}\s*\)/.test(wxssClean.slice(Math.max(0, m.index - 40), m.index + 20)));
  ok(bad.length === 0, '裸色值：' + bad.map((b) => b[0]).join(', '));
});

console.log('\n【二、稿屏6：一叠明信片 + 两枚按钮】');
t('导航栏保留原生标题「纪念卡片」——稿里顶栏那行（‹ 标题 ···）走的就是导航栏', () => {
  const cfg = JSON.parse(json);
  ok(cfg.navigationBarTitleText === '纪念卡片', '导航栏标题是「' + cfg.navigationBarTitleText + '」');
  ok(!/cd-back|cd-more/.test(wxmlClean), '页面里又画了一个返回/更多按钮，会和导航栏那对重影');
});
t('卡面舞台：后面垫一张玫瑰卡、前面是画布（稿里那叠明信片的观感）', () => {
  const i = wxmlClean.indexOf('cd-stage');
  ok(i > 0, '没有卡面舞台');
  ok(wxmlClean.indexOf('cd-behind') < wxmlClean.indexOf('cardCanvas'), '玫瑰衬卡应在画布之前（压在下面）');
  ok(/\.cd-behind/.test(wxssClean) && /rotate\(/.test(rule('.cd-behind', wxssClean)), '衬卡没有歪一点');
});
t('画布 600×960rpx 与 card.js 的 W×H 同比（差一点明信片就被拉扁）', () => {
  const W = num(/const W = ([\d]+)/, js);
  const H = num(/,\s*H = ([\d]+)/, js);   // 源码是 const W = 600, H = 960;
  const box = rule('.card-canvas', wxssClean);
  const w = num(/width:\s*([\d.]+)rpx/, box);
  const h = num(/height:\s*([\d.]+)rpx/, box);
  ok(Math.abs(w / h - W / H) < 1e-6, `画布 ${w}×${h} 与绘制 ${W}×${H} 不同比`);
});
t('两枚按钮：保存图片是描边胶囊、分享给好友是玫瑰实底', () => {
  const acts = rule('.cd-acts', wxssClean);
  ok(/display:\s*flex/.test(acts), '两枚按钮不是并排');
  const save = rule('.cd-act.is-save', wxssClean);
  const share = rule('.cd-act.is-share', wxssClean);
  ok(/border:\s*2rpx solid var\(--border/.test(save), '保存不是描边');
  ok(/background:\s*transparent/.test(save), '保存不该有实底');
  ok(/background:\s*var\(--rose/.test(share), '分享不是玫瑰实底');
  ok(/border-radius:\s*999rpx/.test(rule('.cd-act', wxssClean)), '不是胶囊');
});
t('分享按钮必须是 open-type="share"（原生转发，不能是普通 view）', () => {
  ok(/<button[^>]*open-type="share"/.test(wxmlClean), '分享按钮不会触发转发');
  ok(/class="cd-act is-share"/.test(wxmlClean), '分享按钮的样式挂了');
});
t('低频动作在页面里留了文字入口（稿里没有，但藏起来等于砍功能）', () => {
  ['redo', 'onStyle', 'saveXHS'].forEach((fn) => {
    ok(new RegExp('bindtap="' + fn + '"').test(wxmlClean), '少了入口：' + fn);
  });
  ok(/\.cd-link-t \{ font-size: 23rpx/.test(wxssClean), '低频入口没有压到次级层级');
});
t('五套风格走系统 ActionSheet（不自己造浮层）', () => {
  ok(/wx\.showActionSheet\(/.test(jsClean), 'onStyle 没走 ActionSheet');
  ok(!/sheet-|mask|popup/i.test(wxmlClean.replace(/privacy-sheet|bottom-sheet/g, '')), '自己造了浮层');
  ok(/styles:\s*\[/.test(js) && (js.match(/key: '/g) || []).length >= 5, '风格表被删了');
});

console.log('\n【三、真跑一遍齿边明信片】');
const { loadDrawers, render, DEMO } = require('../scripts/dev/preview-card.js');
t('postcard 是默认风格，且真的登记在 DRAWERS 里', () => {
  ok(/style:\s*'postcard'/.test(js), '默认风格不是齿边明信片');
  ok(/const DRAWERS = \{ postcard: drawPostcard/.test(js), 'DRAWERS 里没有 postcard');
  ok(/postcard: drawPostcard/.test(jsClean), 'DRAWERS 没接上 drawPostcard');
});
t('绘制代码能独立求值（页面半段切掉后仍是自包含的）', () => {
  const m = loadDrawers();
  ok(typeof m.DRAWERS.postcard === 'function', '取不到 drawPostcard');
  ok(m.W === 600 && m.H === 960, '画布尺寸变了：' + m.W + '×' + m.H);
});
t('渲出来：齿边明信片该有的都在（编号标签 / 邮戳双圈 / 注销波浪 / 齿边照片框 / 码框）', () => {
  const { svg } = render('postcard');
  ok(/No\./.test(svg), '缺编号标签');
  ok(/2025/.test(svg) && /JUN/.test(svg), '缺邮戳里的日期');
  // 邮戳两个圈：外圈 r=52、内圈 r=42 各一段整圆（整圆要两段 A 才画得出来）
  ok((svg.match(/A52 52/g) || []).length >= 2, '邮戳外圈没画出来');
  ok((svg.match(/A42 42/g) || []).length >= 2, '邮戳内圈没画出来');
  // 齿边：三次曲线把每个齿磨圆，数量足够多才连成一条花边
  const q = (svg.match(/Q/g) || []).length;
  ok(q > 200, '齿边/波浪的曲线太少：' + q);
  ok(/stroke-dasharray/.test(svg), '虚线（分隔线 / 编号标签内框）没了');
});
t('城市·日期、标题、文案都上了卡面', () => {
  const { svg } = render('postcard');
  ok(svg.indexOf('上海') >= 0, '缺城市');
  ok(svg.indexOf('2025.06.21') >= 0, '缺日期');
  ok(svg.indexOf(DEMO.title) >= 0, '缺标题');
  ok(svg.indexOf('有些夜晚值得被留下来') >= 0, 'AI 文案没上卡面（「换一版文案」就成了空转）');
});
t('不带码时（A/B 对照 / 演示模式）不画码，但页面照常出图', () => {
  const { svg } = render('postcard');
  const noQR = svg.replace(/扫码看我的时光档案/, '');
  ok(noQR.length > 0, '取不到对照图');
  const { DRAWERS, W, H } = loadDrawers();
  const { Recorder } = require('../scripts/dev/canvas2svg.js');
  const rec = new Recorder(W, H);
  DRAWERS.postcard(rec, DEMO, '', { width: 1200, height: 900 }, null, 0, null, '');
  ok(rec.toSVG().indexOf('扫码看我的时光档案') < 0, 'qr 为空时不该画码');
});

console.log('\n【四、既有链路一个都不能少】');
t('保存链路没被动过：canvasToTempFilePath → 存相册 → 埋点', () => {
  ok(/wx\.canvasToTempFilePath/.test(jsClean), '导出没了');
  ok(/wx\.saveImageToPhotosAlbum/.test(jsClean), '存相册没了');
  ok(/track\.track\('poster_save'/.test(jsClean), 'poster_save 埋点没了');
});
t('相册权限被拒时的「去设置」引导还在', () => {
  ok(/wx\.openSetting/.test(jsClean), '权限引导没了');
});
t('小红书竖版导出还在（3:4 装裱 + 品牌水印）', () => {
  ok(/XHS_W = 1080, XHS_H = 1440/.test(js), '竖版尺寸被改');
  ok(/WM_TEXT/.test(jsClean), '品牌水印文案没了');
  ok(/createOffscreenCanvas/.test(jsClean), '离屏装裱没了');
});
t('带码海报 A/B 没被动过（wxacode 云函数 + 全局缓存）', () => {
  ok(/action: 'wxacode'/.test(jsClean), '码图云函数调用没了');
  ok(/sp_poster_ab/.test(js), 'A/B 分组没了');
});
t('空态还在：票根未命中给的是「去收第一张票 / 返回看看」，不是白屏', () => {
  ok(/wx:elif="\{\{notFound\}\}"/.test(wxmlClean), '没有 notFound 分支');
  ok(/bindtap="goScan"/.test(wxmlClean) && /bindtap="goBack"/.test(wxmlClean), '空态出路少了');
  ok(/class="empty"/.test(wxmlClean), '没套全局空态样式');
});
t('取票失败不外抛（页面不死透），且不做「回退到自己第一张票」', () => {
  ok(/try \{[\s\S]{0,80}store\.getTicket/.test(js), 'getTicket 没裹 try');
  ok(/notFound: true/.test(jsClean), '未命中没落空态');
});
t('隐私授权弹窗组件还在（saveImageToPhotosAlbum 要用）', () => {
  ok(/<privacy-sheet/.test(wxmlClean), '组件节点没了');
  ok(/privacy-sheet/.test(json), '没在 json 里注册');
});
// 名字原先写成「画布不能被 wx:if 包住」，但正文只查节点存在，名实不符——
// 而「被包住」这件事本身也没被绕开：canvas 确实挂在 wx:if="{{t}}" 下，
// 是靠 _ensureCanvas 的幂等重试自愈的（见 4.22.4 注释与下一条断言）。
// 留着那个错名字，将来有人会照着它去挪 wxml，反而拆掉重试的前提。
t('canvas 节点本身没被删（卡面渲染的前提）', () => {
  ok(/<canvas type="2d" id="cardCanvas"/.test(wxmlClean), '取不到 canvas 节点');
});
t('canvas 初始化仍是幂等 + 重试（修过「卡片区域整块空白」的老 bug）', () => {
  ok(/_ensureCanvas\(tryN\)/.test(jsClean) && /tryN >= 10/.test(jsClean), '幂等重试被删了');
});
t('署名（昵称 → 卡面落款）与换一版文案都还在', () => {
  ok(/_loadSignature\(\)/.test(jsClean), '署名没了');
  ok(/pay\.getProfile\(\)/.test(jsClean), '取昵称没了');
  ok(/ai\.generateCaption\(/.test(jsClean), '换一版文案没了');
});

console.log('\n【七、取票期间不许白屏（7.2.0）】');
t('三分支齐全且串在一条 if/elif 上：loading → t → notFound', () => {
  const order = ['wx:if="{{loading}}"', 'wx:elif="{{t}}"', 'wx:elif="{{notFound}}"'];
  const at = order.map((s) => wxmlClean.indexOf(s));
  ok(at.every((i) => i >= 0), '分支不全：' + order.filter((s, i) => at[i] < 0).join(' / ') + ' 没找到');
  ok(at[0] < at[1] && at[1] < at[2], '分支顺序不对：loading 必须在 t 之前，否则取票期间仍然白屏');
});
t('loading 初值为真（初值不立，t 到货前那一段照样没有任何分支命中）', () => {
  ok(/loading:\s*true/.test(js), 'data 里没有 loading: true');
});
t('两条出口都把 loading 归位（漏一条，骨架就一直转下去）', () => {
  ok(/notFound:\s*true\s*,\s*loading:\s*false/.test(js), '未命中分支没关 loading：会永远停在「正在生成卡片…」');
  const succ = /setData\(\{\s*t,\s*loading:\s*false/.test(js);
  ok(succ, '成功分支没关 loading');
});
t('骨架复用 .card-canvas 的盒子（几何与真卡一致，卡片落位时不跳）', () => {
  const sk = /wx:if="\{\{loading\}\}"[\s\S]*?<\/view>\s*<\/view>/.exec(wxmlClean);
  ok(sk, '找不到 loading 分支内容');
  ok(/class="card-canvas tk-skeleton"/.test(sk[0]), '骨架没有复用 .card-canvas，落位时会跳一下');
});

console.log('\n测试套件：card_postcard —— ' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
