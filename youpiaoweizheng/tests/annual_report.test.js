// tests/annual_report.test.js —— 年度回忆报告（品牌全案 · 稿屏9）回归测试
// 核心断言：① 图形一律走 <image src="data:image/svg+xml;base64,...">，无内联 svg / emoji / 字符当图标；
//           ② 齿边面板的 viewBox 尺寸与 WXSS 盒子逐个对齐（差一点齿就偏出边框）；
//           ③ 海报**跑一遍**：品牌行、大标题、统计卡、拼贴、邮戳、结语、水印都得画出来；
//           ④ 保存 / 转发 / 署名 / 空态这些既有链路一个都不能少。
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

const wxml = read('pages/annual/annual.wxml');
const wxss = read('pages/annual/annual.wxss');
const js = read('pages/annual/annual.js');
const posterJs = read('pages/annual/poster.js');
const json = read('pages/annual/annual.json');
const icons = read('utils/icons.js');
const aiJs = read('utils/ai.js');

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
/** 从一条 WXSS 规则里取 width / height（rpx） */
const box = (sel) => {
  const r = rule(sel, wxssClean);
  return { w: num(/width:\s*([\d.]+)rpx/, r), h: num(/height:\s*([\d.]+)rpx/, r) };
};

console.log('\n【一、图形：不得有内联 svg / emoji / 字符当图标】');
t('wxml 正文无 <svg> / <path> / <circle>', () => {
  ok(!/<svg[\s>]/i.test(wxmlClean), '发现内联 <svg>');
  ok(!/<path[\s>]/i.test(wxmlClean), '发现内联 <path>');
});
t('wxml 正文无 emoji', () => {
  const m = wxmlClean.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2728}\u{2764}\u{1F4C5}\u{2601}]/u);
  ok(!m, '残留：' + (m && m[0]));
});
t('不再用 ✦ / ↻ / ➤ 这类字符当图标（稿里的星与按钮图标全走 SVG）', () => {
  ['✦', '↻', '➤', '▶', '★', '☆', '›', '→', '✓'].forEach((ch) => {
    ok(!wxmlClean.includes(ch), '残留字符：' + ch);
  });
});
t('所有 image 的 src 都绑到 JS 下发的变量上（不是写死的路径）', () => {
  const srcs = [...wxmlClean.matchAll(/<image[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]);
  ok(srcs.length >= 24, 'image 数量偏少：' + srcs.length);
  const bad = srcs.filter((s) => !/\{\{/.test(s));
  ok(bad.length === 0, '写死的图片路径：' + bad.join(', '));
});
t('本页用到的图标名都在 utils/icons.js 里注册过（含类型兜底图标）', () => {
  const used = [...jsClean.matchAll(/iconSrc\(\s*'([\w]+)'/g)].map((m) => m[1]);
  ok(used.length >= 8, 'iconSrc 调用偏少：' + used.length);
  const kinds = [...jsClean.matchAll(/TYPE_ICONS = \{([^}]*)\}/g)]
    .flatMap((m) => [...m[1].matchAll(/'([\w]+)'/g)].map((x) => x[1]));
  // 8.1.6 加了「旅行」这一类。断言名单不数个 —— 同 scan_frame 那条的道理。
  ok(kinds.join(',') === 'mask,film,train,plane', '类型兜底图标表被改：' + kinds.join(','));
  used.concat(kinds).forEach((n) => ok(ICONS.has(n), '图标未注册：' + n));
});
t('纯装饰图形都带 aria-hidden；唯一不带的是那张真的票根照片', () => {
  const imgs = [...wxmlClean.matchAll(/<image[^>]*>/g)].map((m) => m[0]);
  const bare = imgs.filter((s) => !/aria-hidden="true"/.test(s));
  ok(bare.length === 1, '不带 aria-hidden 的图片应只有票根照片本身，实际 ' + bare.length + ' 张');
  ok(/class="an-frame-img" src="\{\{p\.img\}\}"/.test(bare[0]), '那张唯一的例外不是票根照片：' + bare[0].slice(0, 60));
});
t('WXSS 里的十六进制只允许出现在 var(--x, #兜底) 里', () => {
  const bad = [...wxssClean.matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
    .filter((m) => !/var\([^)]*#[0-9a-fA-F]{3,8}\s*\)/.test(wxssClean.slice(Math.max(0, m.index - 40), m.index + 20)));
  ok(bad.length === 0, '裸色值：' + bad.map((b) => b[0]).join(', '));
});

console.log('\n【二、稿屏9：品牌行 / 大标题 / 两张水彩卡 / 精选拼贴 / AI 结语 / 两枚按钮】');
t('导航栏保留原生标题「年度回忆报告」——稿里顶栏那行（‹ 标题 ···）走的就是导航栏', () => {
  const cfg = JSON.parse(json);
  ok(cfg.navigationBarTitleText === '年度回忆报告', '导航栏标题是「' + cfg.navigationBarTitleText + '」');
  ok(!/an-back|an-more/.test(wxmlClean), '页面里又画了一个返回/更多按钮，会和导航栏那对重影');
});
t('品牌行：玫瑰标 + 有票为证 + No.年份 标签 + 注销波浪', () => {
  ok(/class="an-brand"/.test(wxmlClean) && /class="an-logo"/.test(wxmlClean), '品牌行或标识没了');
  ok(/No\.\{\{y\}\}/.test(wxmlClean), '编号标签没有绑年份');
  ok(/class="an-cancel"/.test(wxmlClean), '缺少标签右边那三道注销波浪');
});
t('大标题是「我的 {年份} 时光档案」，底下压一道玫瑰笔触', () => {
  ok(/我的 \{\{y\}\} 时光档案/.test(wxmlClean), '大标题文案/年份绑定被改');
  ok(/class="an-tt-brush"/.test(wxmlClean), '玫瑰笔触没了');
  ok(/background:\s*var\(--rose/.test(rule('.an-tt-brush', wxssClean)), '笔触不是玫瑰色');
});
t('两张水彩统计卡：左珍藏票根、右走过城市，都是齿边底 + 巨大数字 + 单位', () => {
  const stats = rule('.an-stats', wxssClean);
  ok(/display:\s*flex/.test(stats), '两张卡不是并排');
  ok(/珍藏票根/.test(wxmlClean) && /走过城市/.test(wxmlClean), '卡面文案被改');
  ok(/\{\{s\.total\}\}/.test(wxmlClean) && /\{\{s\.cities\}\}/.test(wxmlClean), '数字没绑到年度指标上');
  ok(/panRose/.test(wxmlClean) && /panSage/.test(wxmlClean), '两张卡没有各自的齿边水彩底');
  ok(num(/font-size:\s*([\d.]+)rpx/, rule('.an-stat-v', wxssClean)) >= 100, '数字不够「巨大」');
});
t('年度精选：玫瑰标签 + 2×2 齿边照片框（四张各歪一点）', () => {
  ok(/年度精选/.test(wxmlClean), '少了年度精选标签');
  ok(/background:\s*var\(--rose/.test(rule('.an-sec-tag', wxssClean)), '标签不是玫瑰底');
  ok(/wx:for="\{\{picks\}\}"/.test(wxmlClean), '拼贴没走 picks 循环');
  ok(/style="transform:rotate\(\{\{p\.tilt\}\}deg\);"/.test(wxmlClean), '四张照片没有各自的倾角');
  ok(/class="an-frame-tape"/.test(wxmlClean), '照片框上没贴和纸胶带');
  ok(/an-frame-bg/.test(wxmlClean), '照片框缺齿边白框底');
});
t('拼贴上有两枚邮戳与编号标签；邮戳的城市与日期是真文本（不塞进 SVG）', () => {
  ok(/wx:for="\{\{pm\}\}"/.test(wxmlClean), '邮戳没走 pm 循环');
  // 圈与注销线由 deco.postmarkParts 编译（与时光机页同源）——漏了这行 src 就是 undefined，戳会整个消失
  ok(/pm: deco\.postmarkParts\(m\)/.test(js), '没调 postmarkParts，邮戳图形没编译');
  ok(/class="an-pm-ring" src="\{\{art\.pm\.ring\}\}"/.test(wxmlClean), '圆环没绑 art.pm.ring');
  ok(/class="an-pm-wave" src="\{\{art\.pm\.wave\}\}"/.test(wxmlClean), '注销线没绑 art.pm.wave');
  ok(/\{\{k\.city\}\}/.test(wxmlClean) && /\{\{k\.dd\}\}/.test(wxmlClean), '邮戳文字没绑数据');
  // 两枚戳可能落在同一座城市，wx:key="city" 会撞 key
  ok(/wx:key="index"[\s\S]{0,80}class="an-pm/.test(wxmlClean), '邮戳循环的 key 不能拿城市名');
  ok(/No\. \{\{no\}\}/.test(wxmlClean), '编号标签没绑票根编号');
});
t('AI 年度结语：玫瑰色带 + 标题下划线 + 两行正文 + 右上角邮票', () => {
  ok(/AI 年度结语/.test(wxmlClean), '结语卡标题没了');
  ok(/wx:for="\{\{ai\}\}"/.test(wxmlClean), '结语没走 ai 循环（重新生成会无处落笔）');
  ok(/class="an-ai-band"/.test(wxmlClean), '左侧玫瑰色带没了');
  ok(/an-ai-stamp/.test(wxmlClean), '右上角那枚邮票没了');
});
t('两枚按钮：重新生成是描边胶囊、生成分享海报是玫瑰实底（并带两侧强调撇）', () => {
  const redo = rule('.an-act.is-redo', wxssClean);
  const post = rule('.an-act.is-poster', wxssClean);
  ok(/background:\s*transparent/.test(redo) && /border:\s*2rpx solid var\(--border/.test(redo), '重新生成不是描边');
  ok(/background:\s*var\(--rose/.test(post), '生成分享海报不是玫瑰实底');
  ok(/border-radius:\s*999rpx/.test(rule('.an-act', wxssClean)), '不是胶囊');
  ok(/bindtap="redoAi"/.test(wxmlClean) && /bindtap="save"/.test(wxmlClean), '两枚按钮的动作绑丢了');
  ok(/class="an-spark"/.test(wxmlClean), '实底按钮两侧的强调撇没了');
});
t('空态 / 错误态都有出路，不是白屏', () => {
  ok(/wx:elif="\{\{empty\}\}"/.test(wxmlClean) && /wx:elif="\{\{error\}\}"/.test(wxmlClean), '缺空态或错误态分支');
  ok(/bindtap="goScan"/.test(wxmlClean) && /bindtap="reload"/.test(wxmlClean), '空态出路少了');
  ok(/class="empty"/.test(wxmlClean), '没套全局空态样式');
});

console.log('\n【三、齿边面板：viewBox 尺寸必须与 WXSS 盒子逐一对齐】');
t('两张统计卡：320×250rpx（.an-stat 与 annual.js 的 PA_W/PA_H 同源）', () => {
  const b = box('.an-stat');
  ok(b.w === num(/PA_W = ([\d]+)/, js) && b.h === num(/PA_H = ([\d]+)/, js),
    `.an-stat ${b.w}×${b.h} 与绘制不同尺寸`);
  ok(/pinkedPanel\(PA_W, PA_H/.test(jsClean), '统计卡底没走 pinkedPanel');
});
t('照片框：322×268rpx（.an-frame 与 FW/FH 同源）', () => {
  const b = box('.an-frame');
  ok(b.w === num(/FW = ([\d]+)/, js) && b.h === num(/FH = ([\d]+)/, js),
    `.an-frame ${b.w}×${b.h} 与绘制不同尺寸`);
  ok(/pinkedPanel\(FW, FH/.test(jsClean), '照片框底没走 pinkedPanel');
});
t('AI 结语卡：670×290rpx（.an-ai 与 AI_W/AI_H 同源）', () => {
  const b = box('.an-ai');
  ok(b.w === num(/AI_W = ([\d]+)/, js) && b.h === num(/AI_H = ([\d]+)/, js),
    `.an-ai ${b.w}×${b.h} 与绘制不同尺寸`);
  ok(/pinkedPanel\(AI_W, AI_H/.test(jsClean), '结语卡底没走 pinkedPanel');
});
t('照片内缩量：WXSS 的 20rpx 与海报里的 fw-40 是同一个数', () => {
  ok(/left:\s*20rpx/.test(rule('.an-frame-in', wxssClean)), '照片内缩改了 WXSS 一侧');
  ok(/const iw = fw - 40, ih = fh - 40;/.test(posterJs), '照片内缩改了海报一侧');
});
t('AI 正文一行只放得下 18 字：WXSS 与 utils/ai.js 守着同一个上限', () => {
  ok(/ANNUAL_LINE_MAX = 18;/.test(aiJs), '结语长度上限被改');
  ok(/font-size:\s*28rpx/.test(rule('.an-ai-p', wxssClean)), '结语正文的字号变了，18 字就不成立');
});

console.log('\n【四、真跑一遍海报】');
const { render, DEMO } = require('../scripts/dev/preview-annual.js');
t('海报尺寸 1080×1920，绘制代码能独立求值', () => {
  const r = render();
  ok(r.W === 1080 && r.H === 1920, '海报尺寸变了：' + r.W + '×' + r.H);
  ok(/viewBox="0 0 1080 1920"/.test(r.svg), 'SVG 画布对不上');
});
t('品牌行 / 大标题 / 两张统计卡 / 年度精选 都上了海报', () => {
  const { svg } = render();
  ok(svg.includes('有票为证'), '缺品牌名');
  ok(svg.includes('No.2025'), '缺编号标签');
  ok(svg.includes('我的 2025 时光档案'), '缺大标题');
  ok(svg.includes('珍藏票根') && svg.includes('走过城市'), '缺统计卡标签');
  ok(svg.includes('>36<') && svg.includes('>8<'), '缺统计数字');
  ok(svg.includes('年度精选'), '缺年度精选标签');
});
t('拼贴与邮戳：齿边曲线够多、邮戳双圈画得出来', () => {
  const { svg } = render();
  const q = (svg.match(/Q/g) || []).length;
  ok(q > 400, '齿边曲线太少：' + q);
  // 邮戳两个整圆（整圆要两段 A 才画得出来）
  ok((svg.match(/A62 62/g) || []).length >= 2, '邮戳外圈没画出来');
  ok((svg.match(/A38\.44 38\.44/g) || []).length >= 2, '邮戳内圈没画出来');
  ok(svg.includes('上海') && svg.includes('JUN'), '邮戳缺城市或日期');
});
t('AI 结语与品牌水印上了海报', () => {
  const { svg } = render();
  ok(svg.includes('AI 年度结语'), '缺结语标题');
  ok(svg.includes('保存温柔'), '结语正文没上海报（重新生成就成了空转）');
  ok(svg.includes('让时光有票为证'), '缺 slogan');
  ok(svg.includes('@有票为证 · 你的时光档案馆'), '缺品牌水印');
  ok(svg.includes('阿茶'), '署名没上海报');
});
t('没有照片时画素色底不报错，有照片才 drawImage', () => {
  const { render: r } = require('../scripts/dev/preview-annual.js');
  const noPic = r(Object.assign({}, DEMO, { picks: [] }));
  ok(noPic.svg.length > 0, '没有精选照片就画不出来了');
  // 传一个假 Image：drawImage 在录制里落成灰占位框
  const withPic = r(Object.assign({}, DEMO, {
    picks: [{ im: { width: 1200, height: 900 }, typeText: '演出' }]
  }));
  ok(/#D8CFBE/.test(withPic.svg), '给了照片却没走 drawImage');
});

console.log('\n【五、既有链路一个都不能少】');
t('保存链路没被动过：canvasToTempFilePath → 存相册 → 埋点', () => {
  ok(/wx\.canvasToTempFilePath/.test(jsClean), '导出没了');
  ok(/saveimg\.save\(/.test(jsClean), '存相册没了');
  ok(/track\.track\('annual_save'/.test(jsClean), 'annual_save 埋点没了');
});
t('相册权限被拒时的「去设置」引导还在', () => {
  // 8.1.3：引导与分流统一挪进 utils/saveimg.js 了 —— 本页只负责别把它的提示再叠一遍
  ok(/require\('\.\.\/\.\.\/utils\/saveimg\.js'\)/.test(jsClean), '没接上统一的存相册模块');
  ok(/e\.shown/.test(jsClean), '不看 shown，会把「去设置」弹窗和 toast 叠着弹两个');
  ok(/wx\.openSetting/.test(read('utils/saveimg.js')), '权限引导没了');
});
t('导出前等绘制真的落图（draw 返回 Promise，有照片/署名晚到也不会导出旧图）', () => {
  ok(/await this\.draw\(\)/.test(jsClean), '保存前没等重绘');
  ok(/return this\._ensurePhotos\(\)\.then/.test(jsClean), 'draw 不返回可等待的 Promise');
});
t('画布吃不下的 cloud:// 文件 ID 先换临时链接（否则四张照片全是素色底）', () => {
  ok(/getTempFileURL/.test(jsClean), '没有把 cloud:// 换成 https');
  ok(/_ensurePhotos/.test(jsClean), '缺照片加载步骤');
});
t('转发：onShareAppMessage 仍在，且带上海报图（稿里没有转发按钮，走右上角胶囊菜单）', () => {
  ok(/onShareAppMessage\(\)/.test(jsClean), '转发没了');
  ok(/track\.track\('annual_share'/.test(jsClean), 'annual_share 埋点没了');
  // 7.3.0 S2：文案改由 share.js 出，但海报图仍是本页画布导出后以 promise 交过去
  ok(/canvasToTempFilePath/.test(jsClean), '没有从画布导出海报图');
  ok(/share\.message\('annual'[\s\S]{0,80}\{\s*promise\s*\}/.test(jsClean), '画布导出的图没交给 share.js');
});
t('署名（昵称 → 海报落款）与「重新生成」都还在', () => {
  ok(/_loadSignature\(\)/.test(jsClean), '署名没了');
  ok(/pay\.getProfile\(\)/.test(jsClean), '取昵称没了');
  ok(/ai\.generateAnnual\(/.test(jsClean), 'AI 结语没接上');
  ok(/ai\.annualFallback\(/.test(jsClean), '缺本地兜底——AI 挂了结语卡会空着');
  ok(/bindtap="redoAi"/.test(wxmlClean) && /redoAi\(\)/.test(jsClean), '重新生成没了');
});
t('画布不能被 wx:if 包住（包住就取不到 canvas 节点，海报永远空白）', () => {
  ok(/<canvas type="2d" id="annualCanvas"/.test(wxmlClean), '取不到 canvas 节点');
  const i = wxmlClean.indexOf('id="annualCanvas"');
  ok(i > wxmlClean.indexOf('</block>'), '画布被 wx:if/wx:else 分支包住了');
});
t('canvas 初始化仍是幂等 + 重试（补画模式同 card 4.22.4）', () => {
  ok(/_ensureCanvas\(\)/.test(jsClean) && /if \(this\._canvas\) return Promise\.resolve\(true\)/.test(jsClean), '幂等初始化被删了');
  ok(/this\._ensureCanvas\(\)\.then\(\(ok\) => \(ok \? this\.draw\(\) : false\)\)/.test(jsClean), '画布未就绪时不会自愈补画');
});
t('隐私授权弹窗组件还在（saveImageToPhotosAlbum 要用）', () => {
  ok(/<privacy-sheet/.test(wxmlClean), '组件节点没了');
  ok(/privacy-sheet/.test(json), '没在 json 里注册');
});
t('数字滚动：json 里挂着就得真用上，两张统计卡都要接', () => {
  // 7.4.0 之前本页把数字滚动摘了（那时年报里没有需要「滚」的大数字），
  // 现在两张水彩统计卡就是全页最大的两个数字，装回来 ——
  // 但「挂着不用」这条老规矩反向也成立：注册了就必须在 wxml 里真的有。
  ok(/animated-number/.test(json), 'json 里没注册 —— 统计卡接不上数字滚动');
  const n = (wxmlClean.match(/<animated-number\b/g) || []).length;
  ok(n >= 2, '年报里只找到 ' + n + ' 处数字滚动，两张统计卡（票根 / 城市）都要接');
  ok(/mode="viewport"/.test(wxmlClean),
    '没用 viewport 模式 —— 年报是一整屏往下滚的长页，数字在屏幕外就滚完了，滚到眼前只剩个静态数');
});

console.log('\n测试套件：annual_report —— ' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
