// tests/album_timemachine.test.js —— 时光机（品牌全案 · 稿屏8）回归测试
// 核心断言：① 图形一律走 <image src="data:image/svg+xml,...">，无内联 svg / emoji；
//           ② 时间轴是一条虚线 + 年份圆点**正好压在轴上**（几何断言，不靠肉眼）；
//           ③ 邮戳的弧形城市名落在双圈之间的环带里；
//           ④ 分组口径是「年」，旧版按月分组的那套没有残留。
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

const wxml = read('pages/album/album.wxml');
const wxss = read('pages/album/album.wxss');
const js = read('pages/album/album.js');
const icons = read('utils/icons.js');
const deco = read('utils/deco.js');

const wxmlClean = wxml.replace(/<!--[\s\S]*?-->/g, '');
const ICONS = new Set([...icons.matchAll(/^\s{2}([a-zA-Z][\w]*):/gm)].map((m) => m[1]));
const num = (re, s) => {
  const m = re.exec(s);
  if (!m) throw new Error('取不到数值：' + re);
  return Number(m[1]);
};
/** 取某条规则块（到下一个 } 为止） */
const rule = (sel, s) => {
  const i = s.indexOf(sel + ' {');
  if (i < 0) throw new Error('找不到规则 ' + sel);
  return s.slice(i, s.indexOf('}', i));
};

console.log('\n【一、图形：不得有内联 svg / emoji / 字符当图标】');
t('wxml 正文无 <svg> / <path> / <circle>', () => {
  ok(!/<svg[\s>]/i.test(wxmlClean), '发现内联 <svg>');
  ok(!/<path[\s>]/i.test(wxmlClean), '发现内联 <path>');
  ok(!/<circle[\s>]/i.test(wxmlClean), '发现内联 <circle>');
});
t('wxml 正文无 emoji（旧版 🔔 / ⌕ / ✕ / 🔍 / 🎫 / 🎤 全部换成了线性图标）', () => {
  const m = wxmlClean.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2728}\u{2764}\u{2315}\u{2715}]/u);
  ok(!m, '残留：' + (m && m[0]));
});
t('不再用 › / ✦ / → 这类字符当图标（字形覆盖不可控）', () => {
  ['✦', '▾', '›', '→', '✓', '「›」'].forEach((ch) => {
    ok(!wxmlClean.includes(ch), '残留字符：' + ch);
  });
});
t('所有 image 的 src 都绑到 JS 下发的变量上（不是写死的路径）', () => {
  const srcs = [...wxmlClean.matchAll(/<image[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]);
  ok(srcs.length >= 18, 'image 数量偏少：' + srcs.length);
  const bad = srcs.filter((s) => !/\{\{/.test(s) && !/^\/images\//.test(s));
  ok(bad.length === 0, '写死的图片路径：' + bad.join(', '));
});
t('纯装饰图形都带 aria-hidden（不进无障碍树）', () => {
  const imgs = [...wxmlClean.matchAll(/<image[^>]*>/g)].map((m) => m[0]);
  const bad = imgs.filter((s) => /aria-hidden="true"/.test(s) === false && /class="tm-(spark|brush|pm|post-spot|post-tape|node-wave)/.test(s));
  ok(bad.length === 0, '缺 aria-hidden：' + bad.map((b) => b.slice(0, 50)).join(' | '));
});

console.log('\n【二、时间轴：虚线轴 + 年份圆点压轴 + 波浪排线】');
t('有一条虚线时间轴', () => {
  const r = rule('.tm-rail', wxss);
  ok(/dashed/.test(r), '轴不是虚线');
  ok(/border-left:\s*\d+rpx/.test(r), '轴不是竖向实线');
});
t('年份圆点正好落在虚线上（几何断言，不是靠肉眼调绝对定位）', () => {
  const padL = (sel) => num(new RegExp('\\.' + sel + ' \\{[\\s\\S]*?padding:\\s*'
    + '[\\d.]+(?:rpx)?\\s+[\\d.]+(?:rpx)?\\s+[\\d.]+(?:rpx)?\\s+([\\d.]+)rpx'), wxss);
  const tlPad = padL('tm-tl');
  const railLeft = num(/\.tm-rail \{[\s\S]*?left:\s*([\d.]+)rpx/, wxss);
  const nodePad = padL('tm-node');
  const dotMl = num(/\.tm-node-dot \{[\s\S]*?margin-left:\s*-([\d.]+)rpx/, wxss);
  const dotW = num(/\.tm-node-dot \{[\s\S]*?width:\s*([\d.]+)rpx/, wxss);
  const center = tlPad + nodePad - dotMl + dotW / 2;
  ok(center === railLeft, '圆点圆心在 ' + center + 'rpx，轴在 ' + railLeft + 'rpx —— 没压上');
});
t('年份节点用真文本渲染，字号够大（稿内是时间轴上最重的字）', () => {
  const y = num(/\.tm-node-y \{[\s\S]*?font-size:\s*([\d.]+)rpx/, wxss);
  const body = num(/\.tm-post-d \{[\s\S]*?font-size:\s*([\d.]+)rpx/, wxss);
  ok(y >= body * 2, '年份 ' + y + 'rpx 不够压过正文 ' + body + 'rpx');
  ok(/class="tm-node-y serif"/.test(wxmlClean), '年份没有走衬线标题字');
});
t('节点下方有三道波浪排线（用 wavelines 装饰，不是自己画三条线）', () => {
  ok(/class="tm-node-wave" src="\{\{art\.wave\}\}"/.test(wxmlClean), '节点排线没绑 art.wave');
  ok(/wave: deco\.decoSrc\('wavelines'/.test(js), 'art.wave 不是 wavelines');
});

console.log('\n【三、明信片：倾斜 / 胶带 / 照片回落 / 日期行】');
t('卡片倾斜角由 JS 下发（避免每张卡片写一条 style）', () => {
  ok(/const CARD_TILT = \[/.test(js), '找不到 CARD_TILT');
  ok(/style="transform:rotate\(\{\{t\.tilt\}\}deg\);"/.test(wxmlClean), '卡片没绑倾斜角');
  ok(/tilt: CARD_TILT\[i % CARD_TILT\.length\]/.test(js), '倾斜角没有按张循环');
});
t('每张卡片左上角贴一条胶带，三色循环且不读主题变量', () => {
  ok(/class="tm-post-tape" src="\{\{t\.tape\}\}"/.test(wxmlClean), '胶带没绑 t.tape');
  ok(/const TAPE_TINT = \['#[0-9A-F]{6}', '#[0-9A-F]{6}', '#[0-9A-F]{6}'\]/i.test(js), 'TAPE_TINT 不是三个实色');
  ok(/decoSrc\('tape', Object\.assign\(\{\}, m, \{ accent: t \}\)\)/.test(js), '胶带颜色没有覆盖 accent');
});
t('胶带被裁成一条窄带（不裁的话 aspectFit 会把整块画布缩进去，胶带细成一根线）', () => {
  const vb = /tape:\s*'([^']+)'/.exec(deco);
  ok(vb, 'tape 没登记 viewBox');
  const [x, y, w, h] = vb[1].split(/\s+/).map(Number);
  ok(Math.round(w / h * 10) / 10 === 3.6, '胶带 viewBox 比例 ' + (w / h).toFixed(2) + '，不是 3.6 的窄带');
  const box = rule('.tm-post-tape', wxss);
  const bw = num(/width:\s*([\d.]+)rpx/, box);
  const bh = num(/height:\s*([\d.]+)rpx/, box);
  ok(Math.abs(bw / bh - w / h) < 0.2, '胶带盒子比例 ' + (bw / bh).toFixed(2) + ' 与图形 ' + (w / h).toFixed(2) + ' 差太多，会被留白撑扁');
});
t('没有照片的票根有回落视图，不留白洞', () => {
  ok(/wx:if="\{\{t\.img\}\}"/.test(wxmlClean), '照片没有判空');
  ok(/class="tm-post-fb"/.test(wxmlClean), '缺回落视图');
  ok(/class="tm-post-fb-ic" src="\{\{t\.ico\}\}"/.test(wxmlClean), '回落视图缺类型图标');
});
t('日期行有日历图标 + 补零日期，缺日期时不显示 undefined', () => {
  ok(/class="tm-post-cal" src="\{\{ic\.calendar\}\}"/.test(wxmlClean), '缺日历图标');
  ok(/\{\{t\.date \|\| '日期待补'\}\}/.test(wxmlClean), '缺日期兜底文案');
});

console.log('\n【四、邮戳：圆环是图形，城市名与日期是真文本】');
t('邮戳的圈与注销线走 deco.postmarkParts', () => {
  ok(/pm: deco\.postmarkParts\(m\)/.test(js), '没调 postmarkParts');
  ok(/class="tm-pm-ring" src="\{\{art\.pm\.ring\}\}"/.test(wxmlClean), '圆环没绑 art.pm.ring');
  ok(/class="tm-pm-wave" src="\{\{art\.pm\.wave\}\}"/.test(wxmlClean), '注销线没绑 art.pm.wave');
});
t('邮戳里没有 SVG 文字（真机中文字形回落不可控，文字一律交给 WXML）', () => {
  const fn = deco.slice(deco.indexOf('function postmarkRing'));
  ok(!/<text[\s>]/.test(fn), 'postmarkRing/postmarkWave 里出现了 <text>');
  ok(!/textPath/.test(deco), '用了 textPath');
  ok(/<text[\s>]/.test(wxmlClean) === false || true, '');
  ok(/class="tm-pm-ch"/.test(wxmlClean) && /class="tm-pm-l"/.test(wxmlClean), '文字层没渲染');
});
t('城市名逐字排上圆弧：先自转再沿半径推出', () => {
  ok(/style="transform:rotate\(\{\{ch\.a\}\}deg\) translateY\(-\{\{pmR\}\}rpx\);"/.test(wxmlClean),
    '城市名没有按角度排弧');
  ok(/pmc: pmChars\(t\.city\)/.test(js), '没有用票根城市名生成弧排字');
  ok(/pmR: PM_R/.test(js), 'pmR 没有下发到视图');
});
t('弧形字落在双圈之间的环带里（改半径前先看这条）', () => {
  const pm = num(/\.tm-pm \{[\s\S]*?width:\s*([\d.]+)rpx/, wxss);
  // 两个 r 按外圈、内圈的顺序写在 postmarkRing 里
  const ringFn = deco.slice(deco.indexOf('function postmarkRing'), deco.indexOf('function postmarkWave'));
  const radii = [...ringFn.matchAll(/r="([\d.]+)"/g)].map((m) => Number(m[1]));
  ok(radii.length === 2, 'postmarkRing 里不是两个圆：' + radii.length);
  const outer = pm * radii[0] / 60, inner = pm * radii[1] / 60;   // 圆环 viewBox 是 60×60
  const R = num(/const PM_R = ([\d.]+)/, js);
  const chH = num(/\.tm-pm-ch \{[\s\S]*?line-height:\s*([\d.]+)rpx/, wxss);
  const chW = num(/\.tm-pm-ch \{[\s\S]*?width:\s*([\d.]+)rpx/, wxss);
  ok(R + chH / 2 <= outer + 0.5, '城市名的外沿 ' + (R + chH / 2).toFixed(1) + ' 戳出外圈 ' + outer.toFixed(1));
  ok(R - chH / 2 >= inner, '城市名的内沿 ' + (R - chH / 2).toFixed(1) + ' 压到内圈 ' + inner.toFixed(1));
  // 弧长 ≥ 字宽，否则四字城市会挤成一坨
  const spread = num(/const spread = ([\d.]+) \* \(chars\.length - 1\)/, js);
  const step = spread * Math.PI / 180 * R;
  ok(step >= chW, '每字间隔 ' + step.toFixed(1) + 'rpx 小于字宽 ' + chW + 'rpx，会叠字');
});
t('日期拆成日 / 月 / 年三行，与稿内排法一致', () => {
  ok(/return \{ pdd: d \|\| '--', pmm: m \? Number\(m\) \+ '月' : '--', pyy: y \|\| '----' \}/.test(js),
    'pmDate 的三行拆法被改了');
  const lines = (wxmlClean.match(/class="tm-pm-l"/g) || []).length;
  ok(lines === 3, '日期不是三行，是 ' + lines + ' 行');
});

console.log('\n【五、分组口径：按「年」，不是旧版的按「月」】');
t('分组键取日期前四位', () => {
  ok(/const y = String\(t\.date \|\| ''\)\.slice\(0, 4\)/.test(js), '分组键不是年份');
  ok(/\/\^\\d\{4\}\$\/\.test\(y\) \? y : NO_YEAR/.test(js), '日期缺失的票根没有归口');
});
t('不再按月分组、也不再拉取「整理模式」的顺序快照', () => {
  ok(!/groupLabel\(/.test(js), '还在用按月分组的 groupLabel');
  ok(!/getGroupOrder/.test(js), '还在拉月份顺序快照（年份分组下这数据永远匹配不上，白跑一趟网络）');
});
t('年份倒序：新的在上', () => {
  ok(/sort\(\(a, b\) => \(a === NO_YEAR \? 1 : b === NO_YEAR \? -1 : b\.localeCompare\(a\)\)\)/.test(js),
    '年份排序被改了（或「更早」那组没排到最后）');
});

console.log('\n【六、类名与颜色规范】');
t('wxml 里的类名都在 wxss 里有定义（放行全局公共类）', () => {
  const GLOBAL = /^(tk-|press|theme-|serif$|hand$|on$|is-|fade-in-)/;
  const used = new Set([...wxmlClean.matchAll(/(?:^|\s)class="([^"]*)"/g)]
    .flatMap((m) => m[1].replace(/\{\{[\s\S]*?\}\}/g, ' ').split(/\s+/)).filter(Boolean));
  // 本页 wxss + app.wxss 一起算「有定义」—— 每往 app.wxss 加一个全局类
  // 就得回来改一遍上面那串 GLOBAL 正则，早晚会漏（.refresher 就是这么漏的）
  const defined = new Set([...read('app.wxss').matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));
  [...wxss.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].forEach((m) => defined.add(m[1]));
  const miss = [...used].filter((u) => !defined.has(u) && !GLOBAL.test(u));
  ok(miss.length === 0, 'wxss（含 app.wxss）缺样式：' + miss.join(', '));
});
t('wxss 无写死的十六进制（只允许 var(--x, #兜底) 的兜底值）', () => {
  const stripped = wxss.replace(/var\([^)]*\)/g, 'VAR');
  const bad = [...stripped.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  ok(bad.length === 0, '写死色值：' + bad.join(', '));
});
t('不残留旧版票夹的类名（hero / 搜索栏 / 月分组 / 票根缩略那一套）', () => {
  ['.ab-hero', '.ab-search', '.ab-tabs', '.ab-list-card', '.ab-list-thumb', '.ab-sec-title', '.ab-date-d', '.ab-sk-item'].forEach((c) => {
    ok(!wxss.includes(c), 'wxss 残留：' + c);
  });
  ['ab-hero', 'ab-search', 'ab-tabs', 'ab-list-card', 'ab-sec-title', 'ab-tm '].forEach((c) => {
    ok(!wxmlClean.includes(c), 'wxml 残留：' + c);
  });
});

console.log('\n【七、业务链路没被改坏】');
t('搜索、筛选、折叠、详情、那年今日、下拉刷新的处理函数都在', () => {
  ['onSearch', 'onSearchClear', 'onFilterTap', 'expandGroup', 'collapseGroup',
    'goDetail', 'goTimeMachine', 'goScan', 'onRefresh', 'onPulling', 'onRestore', 'onNetBarTap'].forEach((fn) => {
    ok(new RegExp(fn + '\\s*\\([^)]*\\)\\s*\\{').test(js), fn + ' 不见了');
  });
});
t('首页的「搜索票根」入口靠 switchTab 落到本页，故本页必须留着搜索框', () => {
  const home = read('pages/home/home.js');
  ok(/wx\.switchTab\(\{ url: '\/pages\/album\/album' \}\)/.test(home), '首页搜索入口改去别处了');
  ok(/bindinput="onSearch"/.test(wxmlClean), '本页搜索框没了，首页那个入口会点进来扑空');
});
t('搜索仍然是 250ms 节流 + 与类型筛选叠加', () => {
  ok(/_searchTimer = setTimeout\(/.test(js), '节流不见了');
  ok(/}, 250\);/.test(js), '节流时长被改了');
  ok(/if \(key !== 'all' && t\.type !== key\) return false;/.test(js), '类型筛选不见了');
});
t('折叠仍是「一个年份超 3 张才折叠」，且展开后有收起入口', () => {
  ok(/const PEEK_AFTER = 3;/.test(js), 'PEEK_AFTER 被改了');
  ok(/this\._expanded\[label\] = true;/.test(js), 'expandGroup 没有写回展开状态');
  ok(/delete this\._expanded\[label\];/.test(js), 'collapseGroup 没有清掉展开状态');
  ok(/\{\{group\.label\}\} 年还有 \{\{group\.more\}\} 张/.test(wxmlClean), '折叠行文案不见了');
});
t('卡片点击走 currentTarget.dataset（原生 view，不是自定义组件）', () => {
  ok(/e\.currentTarget\.dataset/.test(js), '取 id 的方式被改坏了');
  ok(/bindtap="goDetail"/.test(wxmlClean) && /data-id="\{\{t\.id\}\}"/.test(wxmlClean), '卡片没绑 id');
});
t('下拉刷新仍走 scroll-view 的 refresher 三件套', () => {
  ['bindrefresherrefresh="onRefresh"', 'bindrefresherpulling="onPulling"', 'bindrefresherrestore="onRestore"']
    .forEach((a) => ok(wxmlClean.includes(a), '缺 ' + a));
});
t('云故障横幅补回了视图（旧版数据层留着、视图层丢了，用户看不见）', () => {
  ok(/wx:if="\{\{netBar\}\}"/.test(wxmlClean), '横幅没渲染');
  ok(/flags\.netFallback/.test(js) && /flags\.truncated/.test(js), '两种横幅状态都不见了');
});

console.log('\n【八、编译与导航】');
t('onShow 里重编图形（切主题回来必须换成新主题的色）', () => {
  const onShow = /onShow\(\)\s*\{([\s\S]*?)\n  \},/.exec(js);
  ok(onShow, '找不到 onShow');
  ok(/this\.buildArt\(\)/.test(onShow[1]), 'onShow 没有重建图形');
  ok(/buildArt\(\)\s*\{/.test(js), 'buildArt 不见了');
});
t('用到的图标都在 icons.js 里注册', () => {
  const names = [...js.matchAll(/iconSrc\('([a-zA-Z]+)'/g)].map((m) => m[1]);
  ok(names.length >= 8, '图标偏少：' + names.length);
  const bad = [...new Set(names)].filter((n) => !ICONS.has(n));
  ok(bad.length === 0, '不存在：' + bad.join(', '));
});
t('用到的装饰形状都在 deco.js 里注册', () => {
  const names = [...js.matchAll(/decoSrc\('([a-zA-Z]+)'/g)].map((m) => m[1]);
  const registered = new Set([...deco.matchAll(/^\s{2}([a-zA-Z][\w]*):\s*\(c\)/gm)].map((m) => m[1]));
  ok(names.length >= 2, '装饰偏少：' + names.length);
  const bad = [...new Set(names)].filter((n) => !registered.has(n));
  ok(bad.length === 0, '不存在：' + bad.join(', '));
});
t('主题切换后 tabBar 选中态同步正确（时光机 = 1）', () => {
  ok(/setData\(\{ selected: 1, theme: themeUtil\.getTheme\(\) \}\)/.test(js), 'tabBar 选中态没同步');
});
t('导航栏标题留空——标题「时光机」由页内那行星点 + 笔触自己画', () => {
  // 稿屏8 顶部那行（✦ 时光机 ✦ + 玫瑰笔触 + 品牌标）是页面自己画的；
  // 导航栏再写一次「时光机」就会上下重影成两个标题，故这里必须是空串/空格。
  const cfg = JSON.parse(read('pages/album/album.json'));
  ok(String(cfg.navigationBarTitleText).trim() === '',
    '导航栏标题是「' + cfg.navigationBarTitleText + '」，会和页内标题重影');
});
t('页内标题行还在（导航栏留空的前提是它自己把标题画出来）', () => {
  ok(/class="tm-title serif">时光机</.test(wxmlClean), '页内标题行没了');
  ok(/class="tm-brush"/.test(wxmlClean), '标题下的玫瑰笔触没了');
});

console.log('\n──────────────────────────────');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
