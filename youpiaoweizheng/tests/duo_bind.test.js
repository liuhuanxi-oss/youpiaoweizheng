// tests/duo_bind.test.js —— 双人回忆绑定（品牌全案 · 稿屏10）回归测试
// 核心断言：① 图形一律走 <image src="data:image/svg+xml;base64,...">，无内联 svg / emoji / 字符当图标；
//           ② 齿边纸片的 viewBox 尺寸与 WXSS 盒子逐个对齐（差一点齿就偏出边框）；
//           ③ WXML 里 bind* 用到的每个处理器，JS 里都必须真的存在（goScan 那种漏挂）；
//           ④ 生成双人卡片必须带共同票根的 id —— 不带会退回"自己一个人的卡片"（修过一次的倒退点）。
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

const wxml = read('pages/duo/duo.wxml');
const wxss = read('pages/duo/duo.wxss');
const js = read('pages/duo/duo.js');
const json = read('pages/duo/duo.json');
const icons = read('utils/icons.js');
const deco = read('utils/deco.js');
const duoData = read('utils/duoData.js');
const cloudFn = read('cloudfunctions/saveTicket/index.js');

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
/** 从 WXSS 规则里取 width / height（rpx 数值） */
const box = (sel) => {
  const r = rule(sel, wxssClean);
  return { w: num(/width:\s*([\d.]+)rpx/, r), h: num(/height:\s*([\d.]+)rpx/, r) };
};
/** 取 JS 里的常量声明值（本页写成 `const A = 1, B = 2;`，逗号后面的也要认得） */
const constant = (name) => num(new RegExp('(?:const\\s+|,\\s*)' + name + '\\s*=\\s*([\\d.]+)'), jsClean);

console.log('\n【一、图形：不得有内联 svg / emoji / 字符当图标】');
t('wxml 正文无 <svg> / <path> / <circle>', () => {
  ok(!/<svg[\s>]/i.test(wxmlClean), '发现内联 <svg>');
  ok(!/<path[\s>]/i.test(wxmlClean), '发现内联 <path>');
  ok(!/<circle[\s>]/i.test(wxmlClean), '发现内联 <circle>');
});
t('wxml 正文无 emoji', () => {
  const m = wxmlClean.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2728}\u{2764}\u{1F4C5}]/u);
  ok(!m, '残留：' + (m && m[0]));
});
t('不再用 ✦ / ★ / ❤ 这类字符当图标（星、心、邮戳全走 SVG）', () => {
  ['✦', '↻', '➤', '▶', '★', '☆', '›', '→', '✓', '❤', '♥', '✿'].forEach((ch) => {
    ok(!wxmlClean.includes(ch), '残留字符：' + ch);
  });
});
t('所有 image 的 src 都走绑定（不得写死路径）', () => {
  const imgTags = [...wxmlClean.matchAll(/<image\b[^>]*>/g)].map((m) => m[0]);
  ok(imgTags.length >= 20, 'image 数量异常，只有 ' + imgTags.length);
  imgTags.forEach((tag) => ok(/src="\{\{/.test(tag), 'src 没绑定：' + tag.slice(0, 70)));
});
t('装饰图形全部 aria-hidden；唯一的例外是票根照片本身', () => {
  const imgTags = [...wxmlClean.matchAll(/<image\b[^>]*>/g)].map((m) => m[0]);
  const bare = imgTags.filter((tag) => !/aria-hidden="true"/.test(tag));
  ok(bare.length === 1, '没带 aria-hidden 的图有 ' + bare.length + ' 张：' + bare.map((b) => b.slice(0, 50)).join(' | '));
  ok(/class="duo-card-img"\s+src="\{\{item\.img\}\}"/.test(bare[0]), '唯一那张裸图必须是票根照片，实际：' + bare[0]);
});
t('用到的图标都在 icons.js 里注册过', () => {
  const names = new Set();
  [...jsClean.matchAll(/iconSrc\(\s*'([a-zA-Z]\w*)'/g)].forEach((m) => names.add(m[1]));
  // TYPE_ICONS 的值是变量，单独取一遍
  const block = /const TYPE_ICONS = \{([^}]*)\}/.exec(jsClean);
  ok(block, '取不到 TYPE_ICONS');
  [...block[1].matchAll(/'([a-zA-Z]\w*)'/g)].forEach((m) => names.add(m[1]));
  ok(names.size >= 6, '图标只用到了 ' + names.size + ' 个，太少，断言可能失效');
  const bad = [...names].filter((n) => !ICONS.has(n));
  ok(bad.length === 0, '未注册的图标：' + bad.join(', '));
});
t('WXSS 里的十六进制只允许出现在 var(--x, #兜底) 里', () => {
  const bad = [...wxssClean.matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
    .filter((m) => !/var\([^)]*#[0-9a-fA-F]{3,8}\s*\)/.test(wxssClean.slice(Math.max(0, m.index - 40), m.index + 20)));
  ok(bad.length === 0, '裸色值：' + bad.map((b) => b[0]).join(', '));
});

console.log('\n【二、稿屏10：邀请卡 / 双头像 / 共同票根网格 / 页脚】');
t('导航栏保留原生标题（栈内页不自绘返回键，稿里那个 ‹ 就是导航栏的）', () => {
  const cfg = JSON.parse(json);
  ok(cfg.navigationBarTitleText, '标题被清空了');
  ok(!/navigationStyle\s*:\s*"custom"/.test(json), '改成了自绘导航栏');
  ok(!/duo-back|nav-back|自绘返回/.test(wxmlClean), '页面里冒出了自绘返回键');
});
t('hero 是齿边纸片：670×530，纸底 + 两枝雏菊 + 邮戳 + 角上爱心', () => {
  const b = box('.duo-hero');
  ok(b.w === 670 && b.h === 530, `.duo-hero 是 ${b.w}×${b.h}，应为 670×530`);
  ok(/class="duo-hero-bg" src="\{\{art\.hero\}\}"/.test(wxmlClean), '纸底没了');
  ok(/duo-hero-daisy is-l/.test(wxmlClean) && /duo-hero-daisy is-bl/.test(wxmlClean), '两枝雏菊少了');
  ok(/duo-hero-pm-ring/.test(wxmlClean) && /duo-hero-pm-wave/.test(wxmlClean), '邮戳的圈/线少了');
  ok(/duo-hero-corner/.test(wxmlClean), '角上的爱心没了');
});
t('双头像 + 中间虚线连着的心（脏区正好落在两个头像之间）', () => {
  ok(/class="duo-av is-me"/.test(wxmlClean) && /class="duo-av is-ta"/.test(wxmlClean), '两个头像少了');
  const av = box('.duo-av');
  const meLeft = num(/left:\s*([\d.]+)rpx/, rule('.duo-av.is-me', wxssClean));
  const taRight = num(/right:\s*([\d.]+)rpx/, rule('.duo-av.is-ta', wxssClean));
  ok(meLeft === taRight, '两个头像左右不对称');
  const tie = rule('.duo-tie', wxssClean);
  const tieL = num(/left:\s*([\d.]+)rpx/, tie), tieR = num(/right:\s*([\d.]+)rpx/, tie);
  ok(tieL === meLeft + av.w && tieR === tieL, `虚线区 ${tieL}~${tieR} 与头像右缘 ${meLeft + av.w} 对不齐`);
  ok(/duo-tie-heart/.test(wxmlClean), '虚线上的心没了');
});
t('未绑定：hero 写邀请文案 + 发起绑定 / 邀请微信好友', () => {
  ok(/和 TA 一起，收藏共同的时光/.test(wxmlClean), '未绑定的标题没了');
  ok(/wx:if="\{\{!bound\}\}"[\s\S]{0,400}startBind/.test(wxmlClean), '发起绑定按钮没了');
  ok(/open-type="share"/.test(wxmlClean), '邀请微信好友（转发按钮）没了');
});
t('已绑定：hero 写昵称与同行天数，两枚按钮换成双人卡片 / 时光报告', () => {
  ok(/\{\{duo\.myName\}\} & \{\{duo\.partnerName\}\}/.test(wxmlClean), '昵称标题没了');
  ok(/已同行 \{\{duo\.days\}\} 天/.test(wxmlClean), '同行天数没了');
  ok(/goCard/.test(wxmlClean) && /goReport/.test(wxmlClean), '两枚已绑定按钮少了');
});
t('「我们的共同票根」分区：虚线 —— 星 —— 标题 —— 星 —— 虚线', () => {
  const sec = /<view class="duo-sec">([\s\S]*?)<\/view>\s*$/m;
  ok(/duo-sec-line/.test(wxmlClean) && (wxmlClean.match(/duo-sec-line/g) || []).length === 2, '两侧虚线不对');
  ok((wxmlClean.match(/duo-sec-star/g) || []).length === 2, '两颗星不对');
  ok(/class="duo-sec-t serif">我们的共同票根</.test(wxmlClean), '分区标题变了');
});
t('6 张票根卡：走 rows 循环、wx:key=id、点进详情', () => {
  ok(/wx:for="\{\{rows\}\}"/.test(wxmlClean), '没走 rows 循环');
  ok(/wx:key="id"/.test(wxmlClean), 'wx:key 不是 id');
  ok(/data-id="\{\{item\.id\}\}"[\s\S]{0,160}bindtap="goDetail"/.test(wxmlClean), '卡片点不进详情');
  ok(constant('GRID_N') === 6, 'GRID_N 不是 6，一行排不满 2×3');
  ok(/\.slice\(0, GRID_N\)/.test(jsClean), '没有截到 6 张');
});
t('卡面四件：齿边底 + 小邮戳 + 照片（没照片退类型图标）+ 右下爱心', () => {
  ok(/class="duo-card-bg" src="\{\{art\.card\}\}"/.test(wxmlClean), '卡底没了');
  ok(/class="duo-card-pm"/.test(wxmlClean), '卡上邮戳没了');
  ok(/wx:if="\{\{item\.img\}\}"[\s\S]{0,120}class="duo-card-img"/.test(wxmlClean), '照片分支没了');
  ok(/wx:else[\s\S]{0,120}class="duo-card-fb"/.test(wxmlClean), '没照片时的图标兜底没了');
  ok(/class="duo-card-heart"/.test(wxmlClean), '卡上爱心没了');
});
t('胶囊：共同场次（玫瑰）/ 共同城市（鼠尾草），都没有就不挂', () => {
  ok(/class="duo-card-tag is-\{\{item\.tag\.kind\}\}"/.test(wxmlClean), '胶囊没接 tag.kind');
  ok(/wx:if="\{\{item\.tag\}\}"/.test(wxmlClean), '胶囊没有"不挂"的分支 —— 稿里有两张是空的');
  ok(/\.duo-card-tag\.is-show \{ background: var\(--rose/.test(wxssClean), '共同场次的底色不对');
  ok(/\.duo-card-tag\.is-city \{ background: var\(--sage/.test(wxssClean), '共同城市的底色不对');
  ok(/kind: 'show', text: '共同场次'/.test(jsClean) && /kind: 'city', text: '共同城市'/.test(jsClean), '两个胶囊文案变了');
  // 都命中优先挂「共同场次」：show 判定必须排在 city 前面
  const iShow = jsClean.indexOf("marks.show.has(duoData.eventKeyOf(t))");
  const iCity = jsClean.indexOf('marks.city.has(t.city)');
  ok(iShow > -1 && iCity > -1 && iShow < iCity, '共同场次与共同城市的优先级倒了');
});
t('分区下那行说明：未绑定说"会换成共同的那几张"，已绑定为空说"还没攒下"', () => {
  ok(/绑定后，这里会换成你们真正共同的那几张/.test(wxmlClean), '未绑定的说明没了');
  ok(/还没攒下共同的票根/.test(wxmlClean), '已绑定空态的说明没了');
});
t('一张票根都没有时空态 + 去收第一张票', () => {
  ok(/wx:if="\{\{!rows\.length\}\}"/.test(wxmlClean), '空态没了');
  ok(/bindtap="goScan"/.test(wxmlClean), '空态按钮没了');
  ok(/goScan\(\)[\s\S]{0,80}\/pages\/scan\/scan/.test(jsClean), 'goScan 没跳扫描页');
});
t('页脚装饰：星形邮戳 + 虚线 + 爱心 + 雏菊，四件齐', () => {
  ok(/duo-foot-stamp-ring/.test(wxmlClean) && /duo-foot-stamp-star/.test(wxmlClean), '页脚星形邮戳缺件');
  ok(/duo-foot-line/.test(wxmlClean), '页脚虚线没了');
  ok(/duo-foot-heart/.test(wxmlClean), '页脚爱心没了');
  ok(/duo-foot-daisy/.test(wxmlClean), '页脚雏菊没了');
});
t('解绑只在已绑定态出现，且带二次确认', () => {
  ok(/wx:if="\{\{bound\}\}"[\s\S]{0,120}bindtap="unbindTap"/.test(wxmlClean), '解绑入口的显隐条件不对');
  ok(/wx\.showModal\(\{[\s\S]{0,200}解除绑定/.test(jsClean), '解绑没有二次确认');
});

console.log('\n【三、尺寸契约：JS 常量 ↔ WXSS 盒子 ↔ viewBox】');
t('HERO_W/HERO_H 与 .duo-hero 盒子一一对应', () => {
  const b = box('.duo-hero');
  ok(constant('HERO_W') === b.w && constant('HERO_H') === b.h, `JS ${constant('HERO_W')}×${constant('HERO_H')} ≠ WXSS ${b.w}×${b.h}`);
});
t('CARD_W/CARD_H 与 .duo-card 盒子一一对应', () => {
  const b = box('.duo-card');
  ok(constant('CARD_W') === b.w && constant('CARD_H') === b.h, `JS ${constant('CARD_W')}×${constant('CARD_H')} ≠ WXSS ${b.w}×${b.h}`);
});
t('两列卡片加中缝正好铺满 750（左右各留 40，中缝 26）', () => {
  const gap = 750 - 40 * 2 - constant('CARD_W') * 2;
  ok(gap === 26, `按 CARD_W 算出来中缝是 ${gap}，与卡面里留的 26 对不上`);
  const g = rule('.duo-grid', wxssClean);
  ok(/justify-content:\s*space-between/.test(g), '.duo-grid 没靠 space-between 撑中缝');
  ok(/margin:\s*26rpx 40rpx 0/.test(g), '.duo-grid 的左右留白不是 40');
});
t('雏菊的盒子比例与 viewBox 80×104 一致（差一点花就扁了）', () => {
  const vb = /daisy:\s*'0 0 (\d+) (\d+)'/.exec(deco);
  ok(vb, 'DECO_VIEWBOX 里没有 daisy');
  const ratio = Number(vb[1]) / Number(vb[2]);
  ['.duo-hero-daisy.is-l', '.duo-hero-daisy.is-bl', '.duo-foot-daisy'].forEach((sel) => {
    const b = box(sel);
    ok(Math.abs(b.w / b.h - ratio) < 0.02, `${sel} 比例 ${(b.w / b.h).toFixed(3)} ≠ viewBox ${ratio.toFixed(3)}`);
  });
});
t('星与心是方/比例正确的（star4 32×24、heartsmall 32×32）', () => {
  const star = box('.duo-sec-star');
  ok(Math.abs(star.w / star.h - 32 / 24) < 0.02, `星的比例不对：${star.w}×${star.h}`);
  ['.duo-hero-corner', '.duo-tie-heart', '.duo-card-heart', '.duo-foot-heart'].forEach((sel) => {
    const b = box(sel);
    ok(b.w === b.h, sel + ' 不是正方形，心会被压扁');
  });
});
t('内容层压在纸底之上（纸底是 absolute，z-index 不给就被盖住）', () => {
  ok(/\.duo-hero-in \{[\s\S]*?z-index:\s*[1-9]/.test(wxssClean), '.duo-hero-in 没抬层');
  ok(/\.duo-card-body \{[\s\S]*?z-index:\s*[1-9]/.test(wxssClean), '.duo-card-body 没抬层');
});
t('两条齿边纸片确实由 deco.pinkedPanel 编译，尺寸取自常量', () => {
  ok(/deco\.pinkedPanel\(HERO_W, HERO_H/.test(jsClean), 'hero 纸片没用常量尺寸');
  ok(/deco\.pinkedPanel\(CARD_W, CARD_H/.test(jsClean), '卡片纸片没用常量尺寸');
  ok((jsClean.match(/pinkedPanel\(/g) || []).length === 2, '纸片数量不是 2 —— 逐卡各编一份会把 setData 撑爆');
});
t('邮戳的圈与线来自 deco.postmarkParts（不能引用不存在的键）', () => {
  ok(/const pm = deco\.postmarkParts\(m\)/.test(jsClean), '没调 postmarkParts');
  ok(/pmRing: pm\.ring/.test(jsClean) && /pmWave: pm\.wave/.test(jsClean), 'ring/wave 没接上');
  ok(/art\.pmRing/.test(wxmlClean) && /art\.pmWave/.test(wxmlClean), 'WXML 没绑这两个图形');
});

console.log('\n【四、行为链路：绑定 / 卡片 / 转发 / 底层数据】');
t('WXML 里 bind* 用到的每个处理器，JS 里都真的存在', () => {
  const handlers = new Set([...wxmlClean.matchAll(/\b(?:bind|catch)[\w:]*="([a-zA-Z]\w*)"/g)].map((m) => m[1]));
  ok(handlers.size >= 8, '只找到 ' + handlers.size + ' 个处理器，断言可能失效');
  const missing = [...handlers].filter((h) => !new RegExp('\\b' + h + '\\s*\\(').test(jsClean));
  ok(missing.length === 0, 'WXML 绑了但 JS 里没有：' + missing.join(', '));
});
t('发起绑定 → 出示码 / 输入码 两条路都在', () => {
  ok(/itemList: \['出示我的邀请码', '输入 TA 的邀请码'\]/.test(jsClean), 'actionSheet 选项变了');
  ok(/showCode\(\)/.test(jsClean) && /joinCode\(\)/.test(jsClean), '两条分支少了一条');
  ok(/couple\.createCode|createCode\(/.test(jsClean), '生成邀请码没了');
  ok(/couple\.joinByCode|joinByCode\(/.test(jsClean), '用码绑定没了');
});
t('生成双人卡片必须带共同票根的 id（不带会退回"自己一个人的卡片"）', () => {
  ok(/const id = this\.data\.stat && this\.data\.stat\.recentId/.test(jsClean), '没读 recentId');
  ok(/if \(id\) \{ wx\.navigateTo\(\{ url: `\/pages\/card\/card\?id=\$\{id\}` \}\); return; \}/.test(jsClean), '带 id 的那条分支变了');
  ok(/recentId: recent \? recent\.id : ''/.test(jsClean), 'recentId 没从合并数据里取');
});
t('共同场次 / 共同城市的口径来自 duoData，本页不自己拼键', () => {
  ok(/duoData\.togetherKeys\(/.test(jsClean), '没调 togetherKeys');
  ok(/duoData\.togetherCities\(/.test(jsClean), '没调 togetherCities');
  ok(/duoData\.eventKeyOf\(/.test(jsClean), '没调 eventKeyOf');
  ok(!/venue\}\|\$\{/.test(jsClean), '本页自己拼了场次键 —— 三处判定必须同源');
  ok(/module\.exports = \{ loadMerged, eventKeyOf, togetherKeys, togetherCities, recentRows \}/.test(duoData), 'duoData 的导出变了');
});
t('合并数据带 img（票根卡的照片），云函数与演示两条路都要有', () => {
  ok((duoData.match(/img: t\.img \|\| ''/g) || []).length === 2, 'duoData 的两条分支没都补 img');
  // 只在 duoStatsAction 内部找，不钉注释位置（7.0.1 把行尾注释挪到了字段上方，钉注释=假报警）
  const duoFn = cloudFn.slice(cloudFn.indexOf('async function duoStatsAction'), cloudFn.indexOf('async function eventStatsAction'));
  ok(/img: t\.img \|\| ''/.test(duoFn), '云函数 duoStats 没补 img');
  ok(/img: t\.img \|\| ''/.test(jsClean), '本页没把 img 传进卡面');
});
t('转发带邀请码直达绑定页（7.3.0 S2：文案与路径改由 share.js 的场景表统一出）', () => {
  // 页面只报「双人场景 + 我的码」；路径（bind?code=）与口号在 utils/share.js 的 SCENES.duo 里，
  // 由 share_invite.test.js 钉住，这里只保证这一页真的把码传下去了
  ok(/onShareAppMessage\(\)/.test(jsClean), '转发回调没了');
  ok(/share\.message\('duo',\s*\{\s*code:\s*this\.data\.myCode\s*\}\)/.test(jsClean), '转发没把邀请码交给 share.js');
});
t('主题与骨架屏：六主题变量化 + sk.start/end', () => {
  ok(/themeUtil\.getThemeMeta\(themeUtil\.getTheme\(\)\)/.test(jsClean), '没走主题元数据');
  ok(/sk\.start\(this\)/.test(jsClean) && /sk\.end\(this\)/.test(jsClean), '骨架屏没起停');
  ok(/class="page-scroll theme-\{\{theme\}\}"/.test(wxmlClean), '根节点没挂主题类');
  ok(/class="cc-wrap theme-\{\{theme\}\}"/.test(wxmlClean), 'bottom-sheet 里没带主题类 —— 面板拿不到变量');
});
t('下拉头只有一行字，没有 emoji 也没有度数仪', () => {
  ok(/class="rf-text"/.test(wxmlClean), '下拉头没了');
  ok(!/pullDeg/.test(jsClean + wxmlClean), '又冒出了 pullDeg');
});
t('json 只挂真正用到的组件', () => {
  const cfg = JSON.parse(json);
  const used = Object.keys(cfg.usingComponents || {});
  ok(used.includes('bottom-sheet'), '没注册 bottom-sheet');
  ok(!/animated-number/.test(json), 'animated-number 已不用却还挂着');
  ok(/<bottom-sheet/.test(wxmlClean), 'WXML 里根本没有 bottom-sheet 节点');
});

console.log('\n【五、双人卡片只认我自己的票（P2-21）】');
t('recent 从「我的票」里挑，不从合并列表里挑', () => {
  ok(/const mineItems = \(merged\.items \|\| \[\]\)\.filter\(\(t\) => t\.mine\)/.test(jsClean),
    '没有按 mine 过滤出我的票');
  ok(/recent = mineItems\.filter\(/.test(jsClean), 'recent 不是从 mineItems 里挑的');
  ok(!/recent\s*=\s*\(?merged\.items/.test(jsClean),
    'recent 又从合并列表取首张了 —— 合并列表按时间倒序，首张可能是 TA 的票：'
    + '点「生成双人卡片」会跳进别人的票根，用户以为自己的数据串了');
});
t('一张我的票都没有时退回时间线，不跳一个空 id', () => {
  const go = /goCard\(\)\s*\{([\s\S]*?)\n  \},/.exec(jsClean);
  ok(go, '找不到 goCard（改了写法就把这条断言一起改）');
  ok(/if \(id\)/.test(go[1]), 'goCard 没有按 id 分流：recentId 为空时会跳到 /pages/card/card?id= 的空页面');
  ok(/timeline/.test(go[1]), 'goCard 的兜底不是时间线');
});

console.log('\n测试套件：duo_bind —— ' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
