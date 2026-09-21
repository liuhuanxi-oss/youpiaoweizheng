// tests/tabbar_layout.test.js —— 底部菜单栏排版回归（品牌稿屏02）
// 核心断言：尺寸与列宽一律对着**稿子上量的数**，不靠肉眼：
//   稿 1152px = 750rpx，1px = 0.651rpx。
//   栏体通栏　图标 34rpx　文字 18rpx　四个 tab 列宽 128rpx、左右各留 51rpx
//   中央相机钮 直径 75rpx、与栏体上沿齐平、无白描边　选中态没有圆点
//   未选态是实色（原来 40% 透明，压在奶油底上看不清）
// 这些数一旦被改回旧口径（56pt/24pt/10pt 那一套），必须红。
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

// 断言一律在**去掉注释**的源码上做：注释里会提到被删掉的东西
// （「.bar::before，已删」这种），拿原文匹配等于把说明文字当成了代码。
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const wxss = strip(read('custom-tab-bar/index.wxss'));
const wxml = strip(read('custom-tab-bar/index.wxml'));
const js = strip(read('custom-tab-bar/index.js'));

/** 取某条规则块（到下一个 } 为止）；选择器带正则元字符也没关系，按字面找 */
const rule = (sel, s) => {
  const i = s.indexOf(sel + ' {');
  if (i < 0) throw new Error('找不到规则 ' + sel);
  return s.slice(i, s.indexOf('}', i));
};
const num = (re, s) => {
  const m = re.exec(s);
  if (!m) throw new Error('取不到数值：' + re);
  return Number(m[1]);
};

// —— 稿子上量的基准（改设计稿才动这里）——
const D = {
  BAR_H: 112,          // 栏高
  ICON: 34,            // 图标（房 34.5 × 31.3）
  FONT: 18,            // 标签字号（3 字宽 48.8、字高 15.6）
  SIDE: 51,            // 左右页白
  MID: 137,            // 中间给相机钮让出的缝
  PAD_TOP: 15,         // 图标顶距栏体上沿（截图量出来的：图标带中心 35.7、文字带中心 70）
  FAB: 75,             // 相机钮直径（115/1152 屏宽）
  // 四个标签的中心（稿实测，rpx）
  CENTERS: [114.9, 242.5, 509.1, 636.1]
};

console.log('\n【一、栏体：稿上是通栏，不是浮起来的圆角卡】');
t('.bar 左右不留缝（margin: 0）', () => {
  const b = rule('.bar', wxss);
  ok(/margin:\s*0\s*;/.test(b), '.bar 又留了左右外边距 —— 稿上这条栏是满宽的');
});
t('顶部那排虚线已删（稿上没有）', () => {
  ok(!/\.bar::before/.test(wxss), '.bar::before 那条虚线又回来了');
});
t('栏高仍是 112rpx（首屏预算按它算，见 home_wall.test.js）', () => {
  ok(num(/height:\s*([\d.]+)rpx/, rule('.bar', wxss)) === D.BAR_H, '栏高不是 ' + D.BAR_H);
});

console.log('\n【二、列宽：四个标签的中心要落在稿子的位置上】');
t('.row 左右各留 51rpx', () => {
  const r = rule('.row', wxss);
  ok(num(/padding:\s*0\s+([\d.]+)rpx/, r) === D.SIDE, '.row 的左右内边距不是 ' + D.SIDE);
});
t('第 2 项右侧撑出 137rpx 的缝（相机钮的位置）', () => {
  const r = rule('.item:nth-child(2)', wxss);
  ok(num(/margin-right:\s*([\d.]+)rpx/, r) === D.MID, '中缝不是 ' + D.MID);
});
t('算出来的四个中心与稿子相差不超过 3rpx', () => {
  const w = (750 - D.SIDE * 2 - D.MID) / 4;
  const got = [
    D.SIDE + w / 2,
    D.SIDE + w + w / 2,
    D.SIDE + w * 2 + D.MID + w / 2,
    D.SIDE + w * 3 + D.MID + w / 2
  ];
  got.forEach((v, i) => {
    const diff = Math.abs(v - D.CENTERS[i]);
    ok(diff <= 3, `第 ${i + 1} 个标签中心 ${v.toFixed(1)} 与稿子 ${D.CENTERS[i]} 差了 ${diff.toFixed(1)}rpx`);
  });
});

console.log('\n【三、竖向定位：图标带中心距栏体上沿 35.7rpx，文字带中心 70rpx】');
t('.item 从上往下钉 15rpx，不用居中', () => {
  const it = rule('.item', wxss);
  ok(/justify-content:\s*flex-start/.test(it), '.item 又改回居中 —— 图标位置会跟着字号/图标大小漂');
  ok(num(/padding-top:\s*([\d.]+)rpx/, it) === D.PAD_TOP, '.item 的 padding-top 不是 ' + D.PAD_TOP);
});

console.log('\n【四、图标造型：前两枚照品牌稿屏02 = 房子 / 星形小屋（8.3.0 定的）】');
t('票根墙=house、时光机=starhouse', () => {
  ok(/ico:\s*'house'/.test(js), '票根墙不是房子了 —— 稿屏02 画的是房子');
  ok(/ico:\s*'starhouse'/.test(js), '时光机不是星形小屋了 —— 稿屏02 画的是星形小屋');
});
t('两个新图形真的画在 icons.js 里（不是写了个名字没画）', () => {
  const icons = strip(read('utils/icons.js'));
  ok(/^\s*house:\s*\/\//m.test(icons) || /house:/.test(icons), 'icons.js 里没有 house');
  ok(/starhouse:/.test(icons), 'icons.js 里没有 starhouse');
});
t('票根 / 时钟 仍在（详情页、相册页、年度报告还在用）', () => {
  const icons = strip(read('utils/icons.js'));
  ok(/\bticket:/.test(icons), 'ticket 被删了 —— 详情页/相册页会一起塌');
  ok(/\bclock:/.test(icons), 'clock 被删了 —— 年度报告会一起塌');
});
t('选中态换的是**造型**（细线→实心），不只是换颜色', () => {
  // 两份稿子都写了这条：稿屏02 首页选中的「票根墙」是实心珊瑚房子；
  // 《底部Tab栏组件规范》也单列了「默认态=细线 / 选中态=实心块面」。
  const on = /icoOn:\s*iconSrc\(([^)]*)\)/.exec(js);
  const off = /icoOff:\s*iconSrc\(([^)]*)\)/.exec(js);
  ok(on && off, '找不到 icoOn / icoOff');
  ok(/true/.test(on[1]), 'icoOn 没走实心（iconSrc 第 5 个参数不是 true）');
  ok(!/true/.test(off[1]), 'icoOff 也变成实心 —— 未选态该是细线');
});
t('实心造型另有定义（细线路径直接填出来是一坨）', () => {
  const icons = strip(read('utils/icons.js'));
  ok(/ICON_SOLID/.test(icons), 'icons.js 里没有 ICON_SOLID 表');
  // 实心块面里挖洞必须显式写 evenodd：靠子路径绕向写反了不报错、只是洞不出现，太难查。
  // 先例是 camera 的镜头。
  ok(/fill-rule/.test(icons), '挖洞没有 fill-rule');
});

console.log('\n【五、图标与文字：旧口径是 48 / 20，稿上量到的是 34 / 18】');
t('图标 34rpx，.ico 与 .ico-img 同值', () => {
  const ico = num(/width:\s*([\d.]+)rpx/, rule('.item .ico', wxss));
  const img = num(/width:\s*([\d.]+)rpx/, rule('.item .ico-img', wxss));
  ok(ico === D.ICON, '.item .ico 宽 ' + ico + '，应是 ' + D.ICON);
  ok(img === ico, '.ico-img(' + img + ') 与 .ico(' + ico + ') 不等 —— 图会被盒子裁');
});
t('标签字号 18rpx、字距归零', () => {
  const s = rule('.item .txt', wxss);
  ok(num(/font-size:\s*([\d.]+)rpx/, s) === D.FONT, '字号不是 ' + D.FONT);
  ok(/letter-spacing:\s*0/.test(s), '字距又加回来了 —— 会把标签推得比图标还宽');
});

console.log('\n【六、选中态：不加额外标记（造型与颜色已经说清楚了）】');
t('图标下那枚小圆点已删', () => {
  ok(!/\.item\.on::after/.test(wxss), '.item.on::after 又回来了 —— 稿上没有这个点');
});
t('选中时不再把图标抬高（四个标签共用一条基线）', () => {
  const on = wxss.slice(wxss.indexOf('.item.on {'));
  ok(!/\.item\.on\s+\.ico\s*\{/.test(on), '.item.on .ico 又加了位移 —— 标签会跟着错开');
});
t('未选态是实色，不是 40% 透明', () => {
  const blk = wxss.slice(wxss.indexOf('.theme-collage {'));
  const v = /--text2:\s*([^;]+);/.exec(blk)[1].trim();
  ok(!/rgba\(/.test(v), 'collage 的 --text2 又是半透明的了：' + v);
});

console.log('\n【七、中央相机钮：旧口径 112rpx + 凸起 24rpx，稿上是 75rpx 且与上沿齐平】');
t('钮径 75rpx（±2rpx）', () => {
  const f = rule('.fab', wxss);
  const w = num(/width:\s*([\d.]+)rpx/, f);
  const h = num(/height:\s*([\d.]+)rpx/, f);
  ok(Math.abs(w - D.FAB) <= 2 && w === h, `.fab ${w}×${h}，稿上是 ${D.FAB}rpx 的正圆`);
});
t('钮顶与栏体上沿齐平（top: 0），不再凸起', () => {
  ok(/top:\s*0\s*;/.test(rule('.fab', wxss)), '.fab 又凸出去了 —— 稿上钮顶与栏体上沿齐平');
});
t('外圈没有白色描边', () => {
  ok(!/border:\s*[\d.]+rpx\s+solid/.test(rule('.fab', wxss)), '.fab 又加了白描边');
});
t('相机是实心白（机身有底色），不是描线', () => {
  const cam = rule('.fab-cam', wxss);
  ok(/background:\s*var\(--on-primary/.test(cam), '.fab-cam 没有底色 —— 又变回描线了');
  ok(!/border:\s*[\d.]+rpx\s+solid\s+#FFFFFF/.test(cam), '.fab-cam 又画成描线了');
});

console.log('\n【八、主题令牌：栏的选中色与首页胶囊同色】');
t('collage 的 --primary 是稿上那支珊瑚红 #DE8F8B', () => {
  const blk = wxss.slice(wxss.indexOf('.theme-collage {'));
  const v = /--primary:\s*(#[0-9A-Fa-f]{6})/.exec(blk);
  ok(v && v[1].toUpperCase() === '#DE8F8B', 'collage 的 --primary 不是 #DE8F8B：' + (v && v[1]));
});
t('index.js 里 THEME_INK.collage.on 与 wxss 的 --primary 是同一支色', () => {
  const w = /--primary:\s*(#[0-9A-Fa-f]{6})/.exec(wxss.slice(wxss.indexOf('.theme-collage {')))[1];
  const j = /collage:\s*\{\s*on:\s*'(#[0-9A-Fa-f]{6})'/.exec(js);
  ok(j, '找不到 THEME_INK.collage.on');
  ok(j[1].toUpperCase() === w.toUpperCase(),
    '两处对不上：wxss ' + w + ' / js ' + j[1] + ' —— 图标会跟栏体不是一个色');
});
t('collage 的未选态不透明（op: 1）', () => {
  ok(/collage:\s*\{[^}]*op:\s*1/.test(js), 'collage 没把 op 设成 1 —— 未选态又会淡成灰字');
});

console.log('\n【九、两端装饰：稿上有，得真的编出来】');
t('wxml 挂了左右两组装饰', () => {
  ok(/class="bar-deco bar-deco-l"/.test(wxml) && /class="bar-deco bar-deco-r"/.test(wxml),
    '栏体两端少了波浪装饰');
  ok(/class="bar-star"/.test(wxml), '右端少了那颗四角星');
});
t('装饰的图形来自 deco.decoSrc（wavelines / star4），不是另画一套', () => {
  ok(/decoSrc\('wavelines'/.test(js) && /decoSrc\('star4'/.test(js),
    '两端装饰没走 utils/deco.js —— 页面与栏体会各长各的');
  ok(/require\('\.\.\/utils\/deco\.js'\)/.test(js), '没 require deco.js');
});
t('装饰颜色跟着同一支 on 色', () => {
  const fn = /function buildDeco\(theme\)\s*\{[\s\S]*?\n\}/.exec(js);
  ok(fn, '找不到 buildDeco');
  ok(/primary:\s*ink\.on/.test(fn[0]) && /accent:\s*ink\.on/.test(fn[0]),
    '装饰没跟 THEME_INK 的 on 色走');
});
t('换主题时装饰与图标一起重建', () => {
  const fn = /function buildTheme\(theme\)\s*\{[\s\S]*?\n\}/.exec(js);
  ok(fn && /buildList\(theme\)/.test(fn[0]) && /buildDeco\(theme\)/.test(fn[0]),
    'buildTheme 只重建了其一 —— 换主题后装饰会停在上一套颜色');
});

console.log('\n\n测试套件：tabbar_layout —— ' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
