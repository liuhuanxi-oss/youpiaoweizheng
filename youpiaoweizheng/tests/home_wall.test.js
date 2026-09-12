// tests/home_wall.test.js —— 票根墙（品牌全案 · 稿屏2）回归测试
// 核心断言：① 图形一律走 <image src="data:image/svg+xml,...">，无内联 svg / emoji / 字符当图标
//            （旧版这里还留着 🎭🎬🚌✈️ ✦ ♥ ♡ 📍 六类字符）；
//          ② 卡片模板只写一遍（旧版左右两列各抄一份，改一处必漏一处）；
//          ③ 收藏心的主键必须是 id —— store.listTickets 把云库 _id 归一成了 id，
//             旧版读写 _id 在演示数据上恒为 undefined，心点了不亮；
//          ④ 等高网格 → 齿边底图只编一张，不许逐卡编。
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

const wxml = read('pages/home/home.wxml');
const wxss = read('pages/home/home.wxss');
const js = read('pages/home/home.js');
const json = read('pages/home/home.json');
const icons = read('utils/icons.js');
const deco = read('utils/deco.js');
const store = read('utils/store.js');

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
const box = (sel) => {
  const r = rule(sel, wxssClean);
  return { w: num(/width:\s*([\d.]+)rpx/, r), h: num(/height:\s*([\d.]+)rpx/, r) };
};
/** 取 JS 里的常量声明值（本页写成 `const A = 1, B = 2;`，逗号后面的也要认得） */
const constant = (name) => num(new RegExp('(?:const\\s+|,\\s*)' + name + '\\s*=\\s*([\\d.]+)'), jsClean);
/** 某个 class 在 wxml 正文里出现几次 */
const countClass = (name) => (wxmlClean.match(new RegExp('class="' + name + '[ "]', 'g')) || []).length;

console.log('\n【一、图形：不得有内联 svg / emoji / 字符当图标】');
t('wxml 正文无 <svg> / <path> / <circle>', () => {
  ok(!/<svg[\s>]/i.test(wxmlClean), '发现内联 <svg>');
  ok(!/<path[\s>]/i.test(wxmlClean), '发现内联 <path>');
  ok(!/<circle[\s>]/i.test(wxmlClean), '发现内联 <circle>');
});
t('wxml 正文无 emoji（旧版这里是 🎭🎬🚌✈️🎫 当分类图标）', () => {
  const m = wxmlClean.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2728}\u{2764}\u{1F4C5}]/u);
  ok(!m, '残留：' + (m && m[0]));
  ok(!/TYPE_ICON\s*=/.test(jsClean), 'JS 里还留着 emoji 的 TYPE_ICON 表');
});
t('不再用 ✦ / ♥ / ♡ / 📍 这类字符当图标', () => {
  ['✦', '↻', '➤', '▶', '★', '☆', '›', '→', '✓', '❤', '♥', '♡', '✿', '🎭', '🎬', '🚌', '✈️', '🎫'].forEach((ch) => {
    ok(!wxmlClean.includes(ch), '残留字符：' + ch);
  });
});
t('所有 image 的 src 都走绑定（品牌 logo 除外，那是打包进来的静态资源）', () => {
  const imgTags = [...wxmlClean.matchAll(/<image\b[^>]*>/g)].map((m) => m[0]);
  ok(imgTags.length >= 15, 'image 数量异常，只有 ' + imgTags.length);
  const bad = imgTags.filter((tag) => !/src="(\{\{|\/images\/)/.test(tag));
  ok(bad.length === 0, 'src 写死了：' + bad.map((b) => b.slice(0, 60)).join(' | '));
});
t('装饰图形全部 aria-hidden；唯一的例外是票根照片本身', () => {
  const imgTags = [...wxmlClean.matchAll(/<image\b[^>]*>/g)].map((m) => m[0]);
  const bare = imgTags.filter((tag) => !/aria-hidden="true"/.test(tag));
  ok(bare.length === 1, '没带 aria-hidden 的图有 ' + bare.length + ' 张：' + bare.map((b) => b.slice(0, 50)).join(' | '));
  ok(/class="hc-shot-img"\s+src="\{\{item\.img\}\}"/.test(bare[0]), '唯一那张裸图必须是票根照片，实际：' + bare[0]);
});
t('用到的图标都在 icons.js 里注册过', () => {
  const names = new Set();
  [...jsClean.matchAll(/iconSrc\(\s*'([a-zA-Z]\w*)'/g)].forEach((m) => names.add(m[1]));
  const block = /const TYPE_ICONS = \{([^}]*)\}/.exec(jsClean);
  ok(block, '取不到 TYPE_ICONS');
  [...block[1].matchAll(/'([a-zA-Z]\w*)'/g)].forEach((m) => names.add(m[1]));
  const filters = /const FILTERS = \[([\s\S]*?)\];/.exec(jsClean);
  ok(filters, '取不到 FILTERS');
  [...filters[1].matchAll(/ico:\s*'([a-zA-Z]\w*)'/g)].forEach((m) => names.add(m[1]));
  ok(names.size >= 8, '图标只用到了 ' + names.size + ' 个，太少，断言可能失效');
  const bad = [...names].filter((n) => !ICONS.has(n));
  ok(bad.length === 0, '未注册的图标：' + bad.join(', '));
});
t('WXSS 里的十六进制只允许出现在 var(--x, #兜底) 里', () => {
  const bad = [...wxssClean.matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
    .filter((m) => !/var\([^)]*#[0-9a-fA-F]{3,8}\s*\)/.test(wxssClean.slice(Math.max(0, m.index - 40), m.index + 20)));
  ok(bad.length === 0, '裸色值：' + bad.map((b) => b[0]).join(', '));
});

console.log('\n【二、稿屏2：品牌行 / 问候语 / 搜索 / 分类 / 票根墙】');
t('导航栏标题留空 —— 稿里那行「有票为证」是页面自己画的品牌行，别再顶一条原生标题', () => {
  const cfg = JSON.parse(json);
  ok(cfg.navigationBarTitleText !== undefined, '标题被整个删了，会和全局默认的「有票为证」撞车');
  ok(!String(cfg.navigationBarTitleText).trim(), '标题还留着内容：' + JSON.stringify(cfg.navigationBarTitleText));
});
t('开了下拉刷新开关 —— 否则 onPullDownRefresh 是死代码', () => {
  const cfg = JSON.parse(json);
  ok(cfg.enablePullDownRefresh === true, '没开 enablePullDownRefresh');
  ok(/onPullDownRefresh\(\)/.test(jsClean), '开了开关却没有处理器');
  ok(/wx\.stopPullDownRefresh\(\)/.test(jsClean), '拉完没关掉刷新态');
});
t('品牌行：logo + 有票为证 + 人像入口', () => {
  ok(/class="hc-logo-img"\s+src="\/images\/brand-logo\.png"/.test(wxmlClean), 'logo 没了');
  ok(/class="hc-brand serif">有票为证</.test(wxmlClean), '品牌名没了');
  ok(/class="hc-user"[\s\S]{0,160}bindtap="goProfile"/.test(wxmlClean), '人像入口没了');
});
t('问候语两行 + 句尾金星 + 左侧花枝 + 右侧波浪', () => {
  ok(/愿这些票根，/.test(wxmlClean), '第一行变了');
  ok(/都是你热爱生活的证据/.test(wxmlClean), '第二行变了');
  ok(/class="hc-greet-star"/.test(wxmlClean), '句尾的星没了');
  ok(/class="hc-greet-daisy"/.test(wxmlClean), '左侧花枝没了');
  ok(/class="hc-greet-wave"/.test(wxmlClean), '右侧波浪没了');
});
t('搜索框：放大镜 + 占位文案，点了去票夹页', () => {
  ok(/class="hc-search-ic"/.test(wxmlClean), '放大镜没了');
  ok(/搜索演出、电影、城市\.\.\./.test(wxmlClean), '占位文案变了');
  ok(/bindtap="goSearch"/.test(wxmlClean), '搜索框不可点');
});
t('四个分类胶囊：演出 / 电影 / 交通 / 旅行，选中态换图标地址', () => {
  ['show', 'movie', 'traffic', 'travel'].forEach((k) => {
    ok(new RegExp("key: '" + k + "'").test(jsClean), '少了分类 ' + k);
  });
  ['演出', '电影', '交通', '旅行'].forEach((n) => ok(jsClean.includes(n), '少了分类名 ' + n));
  ok(/wx:for="\{\{filters\}\}"[\s\S]{0,80}wx:key="key"/.test(wxmlClean), '胶囊没走 filters 循环');
  ok(/src="\{\{active === item\.key \? item\.srcOn : item\.srcOff\}\}"/.test(wxmlClean), '没做选中/未选两套图标');
  ok(/srcOn: iconSrc\(f\.ico/.test(jsClean) && /srcOff: iconSrc\(f\.ico/.test(jsClean), '两套图标没编');
  ok(/\.hc-chip\.on \{ background: var\(--rose/.test(wxssClean), '选中态不是玫瑰实底');
});
t('票根墙两列走 colA / colB，卡片模板只写一遍', () => {
  ok(/wx:for="\{\{colA\}\}"/.test(wxmlClean) && /wx:for="\{\{colB\}\}"/.test(wxmlClean), '两列循环少了');
  ok(/<template name="hcTicket">/.test(wxmlClean), '没有卡片模板');
  ok((wxmlClean.match(/<template is="hcTicket"/g) || []).length === 2, '模板没被两列各引用一次');
  ok(countClass('hc-card') === 1, 'hc-card 正文出现了 ' + countClass('hc-card') + ' 次 —— 又被抄成两份了');
});
t('一张卡该有的都有：齿边底 / 邮戳 / 圆点 / 照片 / 花与叶 / 标题 / 地点 / 心', () => {
  ok(/class="hc-card-bg" src="\{\{art\.card\}\}"/.test(wxmlClean), '齿边底没了');
  ok(/class="hc-pm-ring"/.test(wxmlClean) && /class="hc-pm-wave"/.test(wxmlClean), '邮戳的圈/线少了');
  ok(/class="hc-pm-city"/.test(wxmlClean) && /class="hc-pm-year"/.test(wxmlClean), '邮戳里的城市/年月没了');
  ok(/class="hc-card-dots"/.test(wxmlClean), '卡顶圆点没了');
  ok(/class="hc-shot-frame"/.test(wxmlClean), '照片框没了（裁圆角的必须是内层，花叶要探出去）');
  ok(/class="hc-shot-bloom"/.test(wxmlClean) && /class="hc-shot-sprig"/.test(wxmlClean), '照片角上的花与叶少了');
  ok(/class="hc-meta-ic"/.test(wxmlClean), '地点图标没了');
});
t('收藏心：实心 / 空心两个地址，点了有反馈', () => {
  ok(/src="\{\{item\.fav \? ic\.heartOn : ic\.heartOff\}\}"/.test(wxmlClean), '心没做两种状态');
  ok(/'取消收藏' : '收藏这张票根'/.test(wxmlClean), '心的无障碍标签没跟着状态走');
  ok(/heartOn: iconSrc\('heart'[\s\S]{0,60}true\)/.test(jsClean), 'heartOn 不是实心');
  ok(/\.hc-fav \{[\s\S]{0,80}width: 44rpx/.test(wxssClean), '心的热区不到 44rpx');
});
t('分类筛选：同键不重复计算，换键才重分组', () => {
  ok(/if \(key === this\.data\.active\) return;/.test(jsClean), '重复点同一个胶囊会重算');
  ok(/filter\(\(t\) => t\.type === key\)/.test(jsClean), '筛选口径变了');
});
t('空态 + 去拍一张', () => {
  ok(/wx:if="\{\{!loading && !colA\.length && !colB\.length\}\}"/.test(wxmlClean), '空态条件不对');
  ok(/bindtap="goScan"/.test(wxmlClean), '空态按钮没了');
  ok(/goScan\(\)[\s\S]{0,160}\/pages\/scan\/scan/.test(jsClean), 'goScan 没跳扫描页');
});
t('加载中走骨架屏，而不是空白', () => {
  ok(/wx:if="\{\{loading\}\}"/.test(wxmlClean) && /hc-sk-card/.test(wxmlClean), '骨架屏没了');
  ok(/tk-skeleton/.test(wxmlClean), '骨架块没用全局的骨架样式');
});

t('传给 decoSrc 的颜色键，形状自己都真的读（传错键会静默落回默认色，颜色就不对了）', () => {
  const body = (name) => {
    const i = deco.indexOf('\n  ' + name + ': (c)');
    if (i < 0) throw new Error('deco 里没有形状 ' + name);
    const j = deco.indexOf('\n\n', i);
    return deco.slice(i, j < 0 ? deco.length : j);
  };
  const calls = [...jsClean.matchAll(/decoSrc\('(\w+)',\s*Object\.assign\(\{\},\s*m,\s*\{([^}]*)\}\)/g)];
  ok(calls.length >= 5, '只找到 ' + calls.length + ' 处 decoSrc 调用，断言可能失效');
  calls.forEach(([, name, kv]) => {
    const keys = [...kv.matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
    ok(keys.length > 0, name + ' 没传任何颜色');
    const unused = keys.filter((k) => !new RegExp('c\\.' + k + '\\b').test(body(name)));
    ok(unused.length === 0, name + ' 不读这些键：' + unused.join(', '));
  });
});

console.log('\n【三、尺寸契约：JS 常量 ↔ WXSS 盒子 ↔ viewBox】');
t('CARD_W/CARD_H 与 .hc-card 盒子一一对应', () => {
  const b = box('.hc-card');
  ok(constant('CARD_W') === b.w && constant('CARD_H') === b.h, `JS ${constant('CARD_W')}×${constant('CARD_H')} ≠ WXSS ${b.w}×${b.h}`);
});
t('两列卡片加中缝正好铺满 750（左右各留 48，中缝 34）', () => {
  const gap = 750 - 48 * 2 - constant('CARD_W') * 2;
  ok(gap === 34, `按 CARD_W 算出来中缝是 ${gap}，与设计稿的 34 对不上`);
  const g = rule('.hc-grid', wxssClean);
  ok(/justify-content:\s*space-between/.test(g), '.hc-grid 没靠 space-between 撑中缝');
  ok(/margin:\s*30rpx 48rpx 0/.test(g), '.hc-grid 的左右留白不是 48');
});
t('卡内纵向相加正好等于卡高（多一分少一分都会顶出齿边）', () => {
  const c = rule('.hc-card', wxssClean);
  const pad = /padding:\s*([\d.]+)rpx\s+([\d.]+)rpx\s+([\d.]+)rpx/.exec(c);
  ok(pad, '取不到 .hc-card 的 padding');
  const top = Number(pad[1]), bottom = Number(pad[3]);
  // 标题与地点行是撑满卡宽的，没有自己的 width，只取 height
  const h = (sel) => num(/height:\s*([\d.]+)rpx/, rule(sel, wxssClean));
  const shot = box('.hc-shot');
  const titleH = h('.hc-title'), metaH = h('.hc-meta');
  const mt = num(/\.hc-title \{[\s\S]*?margin-top:\s*([\d.]+)rpx/, wxssClean);
  const mm = num(/\.hc-meta \{[\s\S]*?margin-top:\s*([\d.]+)rpx/, wxssClean);
  const sum = top + shot.h + mt + titleH + mm + metaH + bottom;
  ok(sum === constant('CARD_H'), `纵向合计 ${sum} ≠ CARD_H ${constant('CARD_H')}`);
  ok(shot.w + 2 * Number(pad[2]) === constant('CARD_W'), `照片宽 ${shot.w} + 左右留白 ≠ 卡宽`);
});
t('邮戳直径与 PM_R 对得上（半径写进 JS 就得被盒子认领）', () => {
  const b = box('.hc-pm');
  ok(b.w === constant('PM_R') * 2 && b.h === b.w, `.hc-pm ${b.w}×${b.h} ≠ PM_R×2 = ${constant('PM_R') * 2}`);
});
t('每件装饰的盒子比例都与自己的 viewBox 一致', () => {
  const cases = [
    ['.hc-greet-daisy', 'daisy'],
    ['.hc-shot-bloom', 'bloom'],
    ['.hc-shot-sprig', 'sprig'],
    ['.hc-greet-wave', 'wavelines'],
    ['.hc-greet-star', 'star4']
  ];
  cases.forEach(([sel, name]) => {
    const vb = new RegExp(name + ":\\s*'([\\d.]+) ([\\d.]+) ([\\d.]+) ([\\d.]+)'").exec(deco);
    ok(vb, 'DECO_VIEWBOX 里没有 ' + name);
    const ratio = Number(vb[3]) / Number(vb[4]);
    const b = box(sel);
    ok(Math.abs(b.w / b.h - ratio) < 0.03, `${sel} 比例 ${(b.w / b.h).toFixed(3)} ≠ viewBox ${ratio.toFixed(3)}`);
  });
});
t('齿边底图只编一张，由六张卡共用（逐卡编会把 setData 撑爆）', () => {
  ok((jsClean.match(/pinkedPanel\(/g) || []).length === 1, 'pinkedPanel 被调了不止一次');
  ok(/deco\.pinkedPanel\(CARD_W, CARD_H/.test(jsClean), '底图没用常量尺寸');
  ok(/art\.card/.test(wxmlClean), 'WXML 没引用这张底图');
});
t('邮戳的圈与线来自 deco.postmarkParts', () => {
  ok(/const pm = deco\.postmarkParts\(m\)/.test(jsClean), '没调 postmarkParts');
  ok(/pmRing: pm\.ring/.test(jsClean) && /pmWave: pm\.wave/.test(jsClean), 'ring/wave 没接上');
});
t('z 序：底图在下、照片居中、邮戳在最上', () => {
  const z = (sel) => num(/z-index:\s*([\d.]+)/, rule(sel, wxssClean));
  const bg = num(/z-index:\s*([\d.]+)/, rule('.hc-card-bg', wxssClean));
  ok(bg === 0, '.hc-card-bg 的 z-index 不是 0');
  ok(z('.hc-shot') > bg && z('.hc-pm') > z('.hc-shot'), '邮戳没压在照片上');
  ok(z('.hc-card-dots') > bg, '圆点被底图盖住了');
});

console.log('\n【四、行为链路：收藏 / 跳转 / 主题】');
t('WXML 里 bind* 用到的每个处理器，JS 里都真的存在', () => {
  const handlers = new Set([...wxmlClean.matchAll(/\b(?:bind|catch)[\w:]*="([a-zA-Z]\w*)"/g)].map((m) => m[1]));
  ok(handlers.size >= 5, '只找到 ' + handlers.size + ' 个处理器，断言可能失效');
  const missing = [...handlers].filter((h) => !new RegExp('\\b' + h + '\\s*\\(').test(jsClean));
  ok(missing.length === 0, 'WXML 绑了但 JS 里没有：' + missing.join(', '));
});
t('收藏心的主键是 id，不是 _id（旧版读写 _id，演示数据上心永远点不亮）', () => {
  // \b 是必要的：'fav_ids' 这个 storage 键里也含 _id 三个字母
  ok(!/\b_id\b/.test(jsClean), 'JS 里还有 _id，store 已经把云库主键归一成 id 了');
  ok(/favIds\.indexOf\(t\.id\)/.test(jsClean), '读收藏态用的不是 id');
  ok(/col\.map\(\(t\) => \(t\.id === id/.test(jsClean), '写收藏态用的不是 id');
  ok(/catchtap="toggleFav"[\s\S]{0,80}data-id="\{\{item\.id\}\}"/.test(wxmlClean), '心上传的 id 不对');
  ok(/return \{ \.\.\.t, id: t\.id \|\| t\._id \}/.test(store), 'store 的归一约定变了 —— 上面几条要重看');
});
t('收藏落本地 storage，异常不打断浏览', () => {
  ok(/wx\.getStorageSync\(FAV_KEY\)/.test(jsClean) && /wx\.setStorageSync\(FAV_KEY/.test(jsClean), '收藏没落 storage');
  ok(/catch \(e\) \{ return \[\]; \}/.test(jsClean), '读 storage 失败没兜底');
});
t('三个跳转都还在：详情 / 票夹 / 个人中心', () => {
  ok(/\/pages\/detail\/detail\?id=/.test(jsClean), '详情跳转没了');
  ok(/wx\.switchTab\(\{ url: '\/pages\/album\/album' \}\)/.test(jsClean), '搜索落点变了');
  ok(/wx\.switchTab\(\{ url: '\/pages\/me\/me' \}\)/.test(jsClean), '人像落点变了');
});
t('主题切换会重编图形与两套胶囊图标（data-uri 里的颜色是编译时写死的）', () => {
  ok(/themeUtil\.getThemeMeta\(themeUtil\.getTheme\(\)\)/.test(jsClean), '没走主题元数据');
  ok(/class="tk-page theme-\{\{theme\}\}"/.test(wxmlClean), '根节点没挂主题类');
  ok(/this\._ink === m\.text/.test(jsClean), '没有"主题没变就不重编"的短路，每次 onShow 都会重拼 data-uri');
  ok(/buildChips\(m/.test(jsClean), '胶囊图标没跟着主题重编');
});
t('tab 页身份：点亮第一个 tab', () => {
  ok(/getTabBar[\s\S]{0,60}selected: 0/.test(jsClean), '没点亮自己这一格');
});
t('埋点还在（筛选 / 搜索 / 拍照三处）', () => {
  ok(/track\('home_filter'/.test(jsClean), '筛选埋点没了');
  ok(/track\('home_search'/.test(jsClean), '搜索埋点没了');
  ok(/track\('home_cta_scan'/.test(jsClean), '拍照埋点没了');
});

console.log('\n测试套件：home_wall —— ' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
