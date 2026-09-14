// tests/motion.test.js —— 动效规范（7.2.0 V7 起，后续 A1/A2/A3/A8 都往这里加）
// ============================================================
// 守两件事：
//   ① **切 tab 回来动效要能重播**。tab 页在微信里常驻内存，节点不重建，
//      只给根节点挂个 class 的话，动画一辈子只播第一次 —— 代码看着是对的，效果是没有的。
//   ② **动效必须尊重「减弱动态效果」**。位移类动画对前庭敏感的用户是真的会引发不适，
//      这不是「锦上添花的无障碍」，是系统级设置，用户开了就得听。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** 按花括号配平切出某个选择器（或 at-rule）的规则体，取不到返回 null */
function blockAfter(src, idx) {
  const i = src.indexOf('{', idx);
  if (i < 0) return null;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(i + 1, j); }
  }
  return null;
}

const TABS = JSON.parse(read('app.json')).tabBar.list.map((i) => i.pagePath);
const appWxss = decomment(read('app.wxss'));

console.log('\n【一、四个 tab 页切回来要重播入场动效】');
t('tab 页清单取自 app.json（写死的话，将来加/减 tab 这个套件会静默失效）', () => {
  ok(TABS.length >= 4, 'tabBar 只剩 ' + TABS.length + ' 个，取错了吧');
});

TABS.forEach((p) => {
  const name = p.split('/')[1];
  const wxml = read(`${p}.wxml`).replace(/<!--[\s\S]*?-->/g, '');
  const js = decomment(read(`${p}.js`));

  t(`${name}：根节点挂着 {{enter ? 'fade-up' : ''}}`, () => {
    ok(/\{\{\s*enter\s*\?\s*'fade-up'\s*:\s*''\s*\}\}/.test(wxml),
      '根节点没有可切换的 fade-up —— 动画没有重播的余地');
  });

  t(`${name}：enter 初值为真（初值假会「先亮一帧再淡入」）`, () => {
    ok(/enter:\s*true/.test(js), 'data 里没有 enter: true');
  });

  t(`${name}：onShow 里调了 enter.replay(this)`, () => {
    const m = /onShow\s*\(\s*\)\s*\{([\s\S]*?)\n  \},/.exec(js);
    ok(m, '找不到 onShow 方法体');
    ok(/enter\s*\.\s*replay\s*\(\s*this\s*\)/.test(m[1]), 'onShow 没调 replay —— 等于只播第一次');
  });
});

t('enter.replay 真的做了「摘类名 → 隔一次渲染再挂回」', () => {
  const js = decomment(read('utils/enter.js'));
  ok(/setData\(\{\s*enter:\s*false\s*\}\)/.test(js), '没有先摘掉类名，动画不会重来');
  ok(/setTimeout\([\s\S]*?setData\(\{\s*enter:\s*true\s*\}\)/.test(js),
    '摘掉之后没有隔一次渲染再挂回 —— 两次 setData 会被合并成一次，等于没摘');
  ok(/clearTimeout/.test(js), '没有 clearTimeout：连点 tab 会攒下一串定时器');
  ok(/if\s*\(\s*!\s*page\._enterSeen\s*\)/.test(js),
    '首次进场没跳过重播 —— 会先亮一帧再淡入，比不做动效还难看');
});

console.log('\n【二、动效必须尊重系统的「减弱动态效果」】');
t('app.wxss 里每个 prefers-reduced-motion 块都真的写在媒体查询里', () => {
  const n = (appWxss.match(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/g) || []).length;
  ok(n >= 4, '只剩 ' + n + ' 个减弱动效块，是不是被谁删了');
});

t('.fade-up 的位移在减弱动效下必须去掉（只留淡变）', () => {
  const re = /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/g;
  let m, found = null;
  while ((m = re.exec(appWxss))) {
    const body = blockAfter(appWxss, m.index);
    if (body && /page-fadeup/.test(body)) { found = body; break; }
  }
  ok(found, '.fade-up 没有减弱动效的降级 —— 开了系统设置的用户照样要被位移晃一下');
  ok(!/translate/.test(found), '降级里还留着 translate：位移没去掉，等于没降级');
  ok(/opacity/.test(found), '降级把淡变也一起砍了 —— 该留的是淡变，该去的是位移');
});

t('几处既有的降级没被误删（按压 / 骨架 / 淡入）', () => {
  ['.pressable', '.skeleton-bone', '.fade-in-200', '.tk-skeleton'].forEach((sel) => {
    const re = /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/g;
    let m, hit = false;
    while ((m = re.exec(appWxss))) {
      const body = blockAfter(appWxss, m.index);
      if (body && body.includes(sel)) { hit = true; break; }
    }
    ok(hit, sel + ' 的减弱动效降级没了');
  });
});

console.log('\n【三、全站数字用同一套滚动语言（7.2.0 V8）】');
t('me 页的统计数字接上了 animated-number，不再是裸文本', () => {
  const wxml = read('pages/me/me.wxml').replace(/<!--[\s\S]*?-->/g, '');
  const n = (wxml.match(/<animated-number\b/g) || []).length;
  ok(n >= 3, `只有 ${n} 处接上了数字滚动，me 页三张统计卡的数字都该滚`);
  ok(!/<text class="me-stat-n"/.test(wxml),
    '还有裸 <text class="me-stat-n"> —— report/timeline 的数字在滚，这一页不滚，看着像卡住了');
});

t('me 页的样式挂在组件标签上（组件内部那句 .an 的字号是从宿主继承的）', () => {
  const wxml = read('pages/me/me.wxml').replace(/<!--[\s\S]*?-->/g, '');
  const n = (wxml.match(/<animated-number class="me-stat-n"/g) || []).length;
  ok(n >= 3, `只有 ${n} 处把 me-stat-n 挂上了 —— 没挂的话数字会掉回默认字号`);
});

t('组件在 me 的 usingComponents 里注册过（没注册就是个不渲染的空标签）', () => {
  let cfg;
  try { cfg = JSON.parse(read('pages/me/me.json')); } catch (e) { throw new Error('me.json 解析失败'); }
  const uc = cfg.usingComponents || {};
  const key = Object.keys(uc).find((k) => uc[k] === '/components/animated-number/index');
  ok(key, 'usingComponents 里没有 animated-number');
  const wxml = read('pages/me/me.wxml');
  ok(new RegExp('<' + key + '\\b').test(wxml), `注册成了 <${key}>，但 wxml 里用的是别的名字`);
});

t('用了 animated-number 的页面全都注册过（防「忘了注册」这类静默失效）', () => {
  const pagesDir = path.join(ROOT, 'pages');
  const missing = [];
  fs.readdirSync(pagesDir)
    .filter((d) => fs.statSync(path.join(pagesDir, d)).isDirectory())
    .forEach((d) => {
      const wxmlP = `pages/${d}/${d}.wxml`;
      const jsonP = `pages/${d}/${d}.json`;
      if (!fs.existsSync(path.join(ROOT, wxmlP)) || !fs.existsSync(path.join(ROOT, jsonP))) return;
      if (!/<animated-number\b/.test(read(wxmlP))) return;
      if (!/animated-number/.test(read(jsonP))) missing.push(d);
    });
  ok(missing.length === 0, '这些页面用了却没注册：' + missing.join(', '));
});

console.log('\n【四、A1 票根卡 → 详情：两段式近似共享元素】');
t('首页：被点的那张照片挂得上「飞」类，且 wxml 与 wxss 对得上', () => {
  const wxml = read('pages/home/home.wxml').replace(/<!--[\s\S]*?-->/g, '');
  const wxss = decomment(read('pages/home/home.wxss'));
  ok(/hc-shot-img[^"]*\{\{\s*flyingId\s*===\s*item\.id\s*\?\s*'fly'\s*:\s*''\s*\}\}/.test(wxml),
    '照片没有按 flyingId 挂 .fly —— 动效接不上');
  ok(/\.hc-shot-img\.fly\s*\{[^}]*animation:/.test(wxss), '.fly 没挂动画');
  ok(/@keyframes\s+hc-fly\s*\{/.test(wxss), '没有 hc-fly 关键帧');
  const re = /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/g;
  let m, hit = false;
  while ((m = re.exec(wxss))) {
    const body = blockAfter(wxss, m.index);
    if (body && /hc-shot-img\.fly/.test(body)) { hit = true; break; }
  }
  ok(hit, '.fly 没有减弱动效降级');
});

t('首页：先给动效留时间再跳，且跳完才复位（防连点、防闪回）', () => {
  const js = decomment(read('pages/home/home.js'));
  const fn = /goDetail\s*\(e\)\s*\{([\s\S]*?)\n  \}/.exec(js);
  ok(fn, '找不到 goDetail');
  const body = fn[1];
  ok(/setData\(\{\s*flyingId:\s*id\s*\}\)/.test(body), '没标记飞行的卡片');
  ok(/setTimeout\(/.test(body), '没等动画放完就跳了，照片等于没飞');
  ok(/navigateTo/.test(body), '没跳详情');
  ok(/complete:/.test(body), '没有在跳转结束后复位 flyingId —— 回退时会闪回「飞走」的残影');
  ok(/_flying/.test(body) && /if\s*\([^)]*_flying/.test(body), '没有防连点：动画期间再点会重复入栈');
});

t('详情页：主内容接得住落位（根节点挂 fade-up）', () => {
  const wxml = read('pages/detail/detail.wxml').replace(/<!--[\s\S]*?-->/g, '');
  ok(/class="tk-page theme-\{\{theme\}\} dtc-page fade-up"/.test(wxml),
    '详情页主内容没有 fade-up，第一段（照片淡出）之后会硬切一下');
});

console.log('\n【五、A3 详情页视差与顶栏渐变】');
t('详情页：滚动驱动 + 16ms 节流 + 位移有上限', () => {
  const js = decomment(read('pages/detail/detail.js'));
  ok(/onPageScroll\s*\(e\)\s*\{/.test(js), '没有 onPageScroll，视差无从谈起');
  const fn = /onPageScroll\s*\(e\)\s*\{([\s\S]*?)\n  \},/.exec(js);
  ok(fn, '找不到 onPageScroll 方法体');
  ok(/<\s*16\s*\)/.test(fn[1]), '没有 16ms 节流：滚动里每帧 setData 会把渲染线程压住');
  ok(/Math\.min\(\s*\d+/.test(fn[1]), '位移没有上限，照片会被推出裁剪框');
  ok(/Date\.now\(\)/.test(fn[1]), '节流没走时间戳');
});

t('详情页：位移余量与上限对得上（余量不够就会露出框底）', () => {
  const wxss = decomment(read('pages/detail/detail.wxss'));
  // 余量写在照片（.dtc-img）上：比裁剪框（.dtc-par）高 12%、上缘再抬 12%，
  // 所以切片要横跨这两块，只取其中一块都会漏判
  const par = wxss.slice(wxss.indexOf('.dtc-par {'), wxss.indexOf('.dtc-img.ld'));
  ok(/height:\s*112%/.test(par) && /margin-top:\s*-12%/.test(par),
    '.dtc-par 里的照片没有 12% 的放大余量 —— 上移时会露白');
  const js = read('pages/detail/detail.js');
  const cap = Number((/Math\.min\(\s*(\d+)/.exec(js) || [])[1] || 0);
  // 440rpx 的 12% = 52.8rpx = 26.4px（750 设计宽下 1px = 2rpx），上移上限必须留在余量内
  ok(cap > 0 && cap <= 26, '位移上限 ' + cap + 'px 超过了 12% 的余量（26px），会露出框底');
});

t('详情页：顶栏遮罩挂在根节点之外（根节点的 transform 会让 fixed 跟着滚）', () => {
  const wxml = read('pages/detail/detail.wxml');
  const clean = wxml.replace(/<!--[\s\S]*?-->/g, '');
  const topfx = clean.indexOf('dtc-topfx');
  const root = clean.indexOf('dtc-page fade-up');
  ok(topfx > -1, '没有顶栏遮罩节点');
  ok(topfx < root, '顶栏遮罩被放进了带 .fade-up 的根节点里 —— fixed 会相对它定位，遮罩会跟着页面滚');
  ok(/style="background: \{\{fxTop\}\}; opacity: \{\{psFade\}\};"/.test(clean), '遮罩没接 fxTop / psFade');
});

t('详情页：减弱动效下压掉视差位移（内联 style 上要 !important 才盖得住）', () => {
  const wxss = decomment(read('pages/detail/detail.wxss'));
  const re = /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/g;
  let m, hit = false;
  while ((m = re.exec(wxss))) {
    const body = blockAfter(wxss, m.index);
    if (body && /\.dtc-par/.test(body)) { hit = true; ok(/!important/.test(body), '降级没加 !important，压不过内联的 translateY'); break; }
  }
  ok(hit, '.dtc-par 的视差没有减弱动效降级');
});

console.log('\n【六、A2 保存成功：沿撕票线裂开 + 副券飞入】');
t('撕票的两半都裁同一张照片（不然撕开是两张不同的票）', () => {
  const wxml = read('pages/scan/scan.wxml').replace(/<!--[\s\S]*?-->/g, '');
  const wxss = decomment(read('pages/scan/scan.wxss'));
  ok(/class="tear"[\s\S]*?wx:if="\{\{imgPath\}\}"/.test(wxml), '撕票浮层没绑在当前这张照片上');
  const stubs = (wxml.match(/class="tear-half tear-(stub|coupon)"/g) || []).length;
  ok(stubs === 2, '存根 / 副券两半只找到 ' + stubs + ' 个');
  const imgs = (wxml.match(/class="tear-img"[^>]*src="\{\{imgPath\}\}"/g) || []).length;
  ok(imgs === 2, '两半没有共用同一张 {{imgPath}}，找到 ' + imgs + ' 处');
  ok(/\.tear-half\s*\{[\s\S]*?overflow:\s*hidden/.test(wxss), '两半没裁剪，照片会整张糊在一起');
  ok(/\.tear-coupon \.tear-img\s*\{[^}]*margin-top:\s*-?\d+rpx/.test(wxss),
    '副券没把照片上推，两半会显示同一块画面 —— 撕开就露馅了');
});

t('撕票线压在交界上，且用的是全站同款齿孔', () => {
  const wxss = decomment(read('pages/scan/scan.wxss'));
  const line = /\.tear-line\s*\{([^}]*)\}/.exec(wxss);
  ok(line, '没有撕票线');
  ok(/position:\s*absolute/.test(line[1]) && /top:\s*120rpx/.test(line[1]),
    '撕票线没有压在存根与副券的交界（120rpx）上');
  ok(/margin-top:\s*-\d+rpx/.test(line[1]), '撕票线没有居中骑缝，会整条偏到一边');
  const wxml = read('pages/scan/scan.wxml');
  ok(/class="b-perf tear-line"/.test(wxml), '撕票线没走公共齿孔类 b-perf —— 又画了一套孔');
});

t('撕开是 200ms 的一下，副券随后才飞走', () => {
  const wxss = decomment(read('pages/scan/scan.wxss'));
  const stub = /\.tear-stub\s*\{([^}]*)\}/.exec(wxss);
  ok(stub && /animation:[^;]*200ms/.test(stub[1]), '存根被撕的那一下不是 200ms');
  const off = /\.tear-coupon\s*\{([^}]*)\}/.exec(wxss);
  ok(off && /animation:[^;]*tear-off/.test(off[1]), '副券没接撕离动画');
  const kf = /@keyframes tear-off\s*\{([\s\S]*?)\n\}/.exec(wxss);
  ok(kf, '没有 tear-off 关键帧');
  ok(/rotate\(-?[\d.]+deg\)/.test(kf[1]), '撕开时没有错位/翻转，看着像直接淡出');
  ok(/opacity:\s*0/.test(kf[1]), '副券没飞走（仍停在原地）');
});

t('减弱动效下只剩淡出，不裂不飞', () => {
  const wxss = decomment(read('pages/scan/scan.wxss'));
  const re = /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/g;
  let m, hit = false;
  while ((m = re.exec(wxss))) {
    const body = blockAfter(wxss, m.index);
    if (body && /\.tear-coupon/.test(body)) {
      hit = true;
      ok(/animation:\s*tear-rm/.test(body), '副券的降级没换成淡出');
      const rm = /@keyframes tear-rm\s*\{([\s\S]*?)\n\s*\}/.exec(body);
      ok(rm && !/translate|rotate|scale/.test(rm[1]), '降级里还留着位移/旋转');
      break;
    }
  }
  ok(hit, '.tear 的减弱动效降级没了');
});

console.log('\n【七、A8 新用户三步引导】');
t('引导浮层挂在根节点之外（根节点的 transform 会让 fixed 跟着滚）', () => {
  const clean = read('pages/home/home.wxml').replace(/<!--[\s\S]*?-->/g, '');
  const mask = clean.indexOf('guide-mask');
  const root = clean.indexOf('{{enter ? \'fade-up\' : \'\'}}');
  ok(mask > -1, '没有引导浮层');
  ok(mask < root, '引导浮层被放进了带 .fade-up 的根节点里 —— 滑一下浮层就跟着跑');
});

t('只在「一张票都没有」且没看过时弹，看过就记下', () => {
  const js = decomment(read('pages/home/home.js'));
  const fn = /maybeGuide\s*\(\)\s*\{([\s\S]*?)\n  \},/.exec(js);
  ok(fn, '找不到 maybeGuide');
  const body = fn[1];
  ok(/this\._all\.length\)\s*return/.test(body), '没判「有没有票」——老用户每次都被拦一道');
  ok(/getStorageSync\(GUIDE_KEY\)/.test(body), '没查已读标记 —— 每次都弹');
  ok(/_guideChecked/.test(body) && /if\s*\(\s*this\._guideChecked\s*\)\s*return/.test(body),
    '没做「一次会话只判一次」：refresh 挂在 onShow 上，切 tab 回来会反复读存储');
  const done = /_guideDone\s*\(\)\s*\{([\s\S]*?)\n  \}/.exec(js);
  ok(done, '找不到 _guideDone');
  ok(/setStorageSync\(GUIDE_KEY/.test(done[1]), '关掉/跳过后没写已读 —— 下次进来又弹');
  ok(/setData\(\{\s*guide:\s*0\s*\}\)/.test(done[1]), '没把浮层关掉');
});

t('三步都齐全：拍一张 / AI 认字 / 上墙，且能跳过、末步直达拍照', () => {
  const wxml = read('pages/home/home.wxml').replace(/<!--[\s\S]*?-->/g, '');
  const js = decomment(read('pages/home/home.js'));
  const steps = /const GUIDE = \[([\s\S]*?)\n\];/.exec(js);
  ok(steps, '找不到三步引导的文案表');
  const n = (steps[1].match(/ico:/g) || []).length;
  ok(n === 3, '引导不是三步，是 ' + n + ' 步');
  ['camera', 'wand', 'ticket'].forEach((i) => ok(steps[1].includes("'" + i + "'"), '缺图标 ' + i));
  ok(/bindtap="guideSkip"|bindtap="guideClose"/.test(wxml), '没有跳过入口 —— 引导不可跳过就是把新用户堵在门口');
  ok(/bindtap="guideNext"/.test(wxml), '没有下一步按钮');
  const next = /guideNext\s*\(\)\s*\{([\s\S]*?)\n  \},/.exec(js);
  ok(next, '找不到 guideNext');
  ok(/goScan\(\)/.test(next[1]), '最后一步没有落到「去拍第一张」上');
});

t('减弱动效下引导浮层不弹跳，且图标走统一图形（不用 emoji）', () => {
  const wxss = decomment(read('pages/home/home.wxss'));
  ok(/\.guide-mask\s*\{[^}]*position:\s*fixed/.test(wxss), '引导浮层不是 fixed，盖不住页面');
  ok(/catchtouchmove/.test(read('pages/home/home.wxml')), '没挡滑动穿透：底下的票根墙会被带着滚');
  // catchtouchmove 绑的方法必须在 js 里存在，否则滑动那一刻直接报错
  ok(/noop\s*\(\)\s*\{\s*\}/.test(decomment(read('pages/home/home.js'))), 'catchtouchmove 绑了 noop，js 里却没有这个方法');
  const re = /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/g;
  let m, hit = false;
  while ((m = re.exec(wxss))) {
    const body = blockAfter(wxss, m.index);
    if (body && /guide-card/.test(body)) { hit = true; break; }
  }
  ok(hit, '引导卡片没有减弱动效降级（弹跳缩放对前庭敏感的人不友好）');
  ok(/iconSrc\(g\.ico/.test(decomment(read('pages/home/home.js'))), '引导图标没走 iconSrc');
});

console.log('\n【八、7.4.0 动效标准：错开登场（docs/MOTION.md §2）】');
t('.stagger：260ms + --ease-smooth + 60rpx 位移（比 .fade-up 的 16rpx 看得出来是「浮」）', () => {
  const rule = /\.stagger\s*\{([^}]*)\}/.exec(appWxss);
  ok(rule, 'app.wxss 里没有 .stagger —— 各页又会回去各自手写时长');
  ok(/animation:\s*stagger-up\s+260ms\s+var\(--ease-smooth\)/.test(rule[1]),
    '.stagger 的时长/缓动不对：' + rule[1].trim());
  const kf = /@keyframes\s+stagger-up\s*\{([\s\S]*?)\n\}/.exec(appWxss);
  ok(kf, '没有 stagger-up 关键帧');
  ok(/translateY\(\s*60rpx\s*\)/.test(kf[1]), '位移不是 60rpx —— 16rpx 那点位移肉眼看不出来，等于只做了淡变');
});

t('.stagger 必须用 backwards 填充，不能用 both', () => {
  const rule = /\.stagger\s*\{([^}]*)\}/.exec(appWxss);
  ok(/backwards/.test(rule[1]), '.stagger 没有用 backwards 填充');
  ok(!/\bboth\b/.test(rule[1]),
    '用了 both：动画结束后 transform 会一直挂在卡片上，而动画的优先级高于普通样式 —— ' +
    '票根卡的按下缩放（hover-class）会被它整条压死，手指按下去再没反应');
});

t('.stagger 的减弱动效降级去掉了位移，只留淡变', () => {
  const re = /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/g;
  let m, found = null;
  while ((m = re.exec(appWxss))) {
    const body = blockAfter(appWxss, m.index);
    if (body && /stagger-up/.test(body)) { found = body; break; }
  }
  ok(found, '.stagger 没有减弱动效降级');
  ok(!/translate/.test(found), '降级里还留着 translate');
  ok(/opacity/.test(found), '降级把淡变也砍了');
});

t('错开只给前 6 项：第 7 项起与第 6 项同时，不跟着下标一路排下去', () => {
  const delayOf = (n) => {
    const re = new RegExp('\\.stagger:nth-child\\(' + n + '\\)[^{]*\\{[^}]*animation-delay:\\s*(\\d+)ms');
    const m = re.exec(appWxss);
    return m ? Number(m[1]) : null;
  };
  const d6 = delayOf(6);
  ok(d6 === 425, '第 6 项的延迟不是 425ms（85×5）：' + d6);
  ok(delayOf(5) === 340, '第 5 项的延迟不是 340ms');
  const tail = /\.stagger:nth-child\(n\+7\)[^{]*\{[^}]*animation-delay:\s*(\d+)ms/.exec(appWxss);
  ok(tail, '没有「第 7 项起」的兜底延迟 —— 100 张票会一路排到 8.5 秒，用户以为卡死');
  ok(Number(tail[1]) === d6, '第 7 项起的延迟与第 6 项不一致');
});

t('首页票根墙的卡片挂了 .stagger（只前 6 张错开）', () => {
  const wxml = read('pages/home/home.wxml').replace(/<!--[\s\S]*?-->/g, '');
  ok(/class="hc-card pressable[^"]*\{\{\s*enter\s*\?\s*'stagger'\s*:\s*''\s*\}\}/.test(wxml),
    '票根卡没挂 stagger —— 打开首页还是一片一起亮');
});

console.log('\n【八之二、公共组件：弹层降级与退场时长】');
t('bottom-sheet 的退场时长在 js 与 wxss 里必须相等（差一点就是「点遮罩关不掉」的手感）', () => {
  const js = decomment(read('components/bottom-sheet/index.js'));
  const wxss = decomment(read('components/bottom-sheet/index.wxss'));
  const jm = /const LEAVE_MS = (\d+);/.exec(js);
  ok(jm, 'js 里没有 LEAVE_MS —— 又把时长写回 setTimeout 里了');
  const wm = /\.bs-panel\.out\s*\{[^}]*animation:\s*bs-out\s+(\d+)ms/.exec(wxss);
  ok(wm, '找不到 .bs-panel.out 的退场动画');
  ok(Number(jm[1]) === Number(wm[1]),
    `js 是 ${jm[1]}ms、wxss 是 ${wm[1]}ms：短了面板会「啪」地消失，长了用户对着空壳等`);
  ok(/setTimeout\([\s\S]{0,120},\s*LEAVE_MS\)/.test(js), 'setTimeout 没有用这个常量');
});

t('bottom-sheet（6 个页面在用）有减弱动态效果降级，且降级里没有位移', () => {
  const wxss = decomment(read('components/bottom-sheet/index.wxss'));
  const re = /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/g;
  let m, found = null;
  while ((m = re.exec(wxss))) {
    const body = blockAfter(wxss, m.index);
    if (body && /bs-panel/.test(body)) { found = body; break; }
  }
  ok(found, '弹层没有降级 —— 开着「减弱动态效果」的用户照样要被底部滑入晃一下');
  ok(!/translate/.test(found), '降级里还留着 translate');
  ok(/bs-fade/.test(found), '降级里没有换成淡变');
});

t('数字滚动：视口探测不可用时也要把数字显示出来（不能永远停在 0）', () => {
  const js = decomment(read('components/animated-number/index.js'));
  ok(!/_armed/.test(js), '_armed 只写不读：注释说「回退为可播状态」，其实没有任何地方读它');
  const onValue = /onValue\(\)\s*\{([\s\S]*?)\n    \},/.exec(js);
  ok(onValue, '找不到 onValue');
  ok(/mode === 'viewport' && this\._io/.test(onValue[1]),
    'viewport 模式下 onValue 无条件返回 —— 观察器没建起来的设备上数字永远停在 0（比不动更糟：是错的）');
  const probe = /_probeReduce\(\)\s*\{([\s\S]*?)\n    \},/.exec(js);
  ok(probe, '找不到 _probeReduce');
  ok(/_reduce = false/.test(probe[1]),
    '探测失败时留 undefined 给后人猜 —— 要显式写成「按会播放处理」');
});

console.log('\n【九、7.4.0 触觉反馈收敛到 utils/haptics.js】');
t('三个语义接口各自映射到 light / medium / heavy', () => {
  const calls = [];
  const hadWx = Object.prototype.hasOwnProperty.call(global, 'wx');
  const prevWx = global.wx;
  global.wx = { vibrateShort: (o) => calls.push(o && o.type) };
  try {
    const h = require('../utils/haptics.js');
    ['tap', 'confirm', 'warn'].forEach((k) => ok(typeof h[k] === 'function', '没有 haptics.' + k));
    h.tap(); h.tap();
    h.confirm();
    h.warn();
    ok(JSON.stringify(calls) === JSON.stringify(['light', 'light', 'medium', 'heavy']),
      '三档力度不对：' + JSON.stringify(calls));
  } finally {
    if (hadWx) global.wx = prevWx; else delete global.wx;
  }
});

t('拿不到 wx（演示模式 / 旧基础库）时不炸', () => {
  const hadWx = Object.prototype.hasOwnProperty.call(global, 'wx');
  const prevWx = global.wx;
  delete global.wx;
  try {
    delete require.cache[require.resolve('../utils/haptics.js')];
    const h = require('../utils/haptics.js');
    h.tap(); h.confirm(); h.warn(); // 不抛就算过
  } finally {
    if (hadWx) global.wx = prevWx;
  }
});

t('页面与组件里不再直接调 wx.vibrateShort（只允许 haptics.js 内部调）', () => {
  const off = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) {
        const src = read(rel(p));
        // haptics.js 是唯一的落点；其余文件一律走语义接口
        if (/wx\.vibrateShort/.test(src) && !/utils\/haptics\.js$/.test(p.replace(/\\/g, '/'))) off.push(rel(p));
      }
    }
  })(path.join(ROOT, 'pages'));
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js') && /wx\.vibrateShort/.test(read(rel(p)))) off.push(rel(p));
    }
  })(path.join(ROOT, 'components'));
  ok(off.length === 0, '仍在直接调 vibrateShort（同一个语义在不同页面会变成不同力度）：\n        ' + off.join('\n        '));
});

console.log('\n【十、7.4.0 详情页：退场 / 失败红抖 / 兜底交叉 / 彩蛋】（docs/MOTION.md §3.1）');
const detailJs = decomment(read('pages/detail/detail.js'));
const detailWxml = read('pages/detail/detail.wxml');
const detailWxss = decomment(read('pages/detail/detail.wxss'));

/** 一个文件里所有 reduced-motion 块的正文拼在一起（可能不止一块） */
function allReduceBlocks(src) {
  const out = [];
  let i = 0;
  const tag = '@media (prefers-reduced-motion: reduce)';
  while ((i = src.indexOf(tag, i)) >= 0) {
    const b = blockAfter(src, i);
    if (b) out.push(b);
    i += tag.length;
  }
  return out;
}
const detailReduce = allReduceBlocks(detailWxss).join('\n');

t('删除票根：卡片先收拢淡出，跳页等动画播完', () => {
  const ms = +((/const LEAVE_MS = (\d+)/.exec(detailJs) || [])[1]);
  ok(ms > 0, '找不到 LEAVE_MS');
  const leave = /\.dtc-card\.leaving\s*\{([^}]*)\}/.exec(detailWxss);
  ok(leave, '详情页没有 .dtc-card.leaving 规则');
  const dur = +((/(\d+)ms/.exec(leave[1]) || [])[1]);
  ok(dur === ms, '退场时长对不上：js ' + ms + 'ms / wxss ' + dur + 'ms（短了没播完就跳，长了播完干等）');
  ok(/setData\(\{\s*leaving:\s*true\s*\}\)/.test(detailJs), '删完没有先把卡片置为退场态');
  ok(/setTimeout\(\(\) => this\.goBack\(\), LEAVE_MS\)/.test(detailJs), '跳页没有等退场播完');
  ok(!/goBack\(\), 700\)/.test(detailJs), '还留着 700ms 硬返回');
  ok(/dtc-card \{\{leaving \? 'leaving' : ''\}\}/.test(detailWxml), 'wxml 上没挂退场类');
  ok(/@keyframes dtc-leave/.test(detailReduce), '退场动画没有降级（位移收拢对前庭敏感的用户不适）');
});

t('生成失败：手记卡红抖一次，且下一次失败还能再抖', () => {
  const ms = +((/const SHAKE_MS = (\d+)/.exec(detailJs) || [])[1]);
  ok(ms > 0, '找不到 SHAKE_MS');
  const rule = /\.dtc-memo\.shake-err\s*\{([^}]*)\}/.exec(detailWxss);
  ok(rule, '详情页没有 .dtc-memo.shake-err 规则');
  const dur = +((/(\d+)ms/.exec(rule[1]) || [])[1]);
  ok(dur === ms, '抖动时长对不上：js ' + ms + 'ms / wxss ' + dur + 'ms');
  ok(/@keyframes shake-err/.test(appWxss), 'app.wxss 里没有 shake-err 关键帧');
  ok(/memoErr \? 'shake-err' : ''/.test(detailWxml), 'wxml 上没挂抖动类');
  ok(/setData\(\{\s*memoErr:\s*false\s*\}\)/.test(detailJs),
    '抖完没有摘掉类名 —— 类名不变，第二次同样的失败不会再抖');
  ok(/var\(--stamp/.test(rule[1]),
    '失败只抖不变色：降级下抖动被压掉，就一点反馈都不剩了');
  ok(/shake-err/.test(detailReduce) || /@keyframes shake-err/.test(appWxss), '抖动没有降级路径');
});

t('AI 文案落定时不「啪」地出现', () => {
  ok(/class="dtc-memo-txt fade-in-200"/.test(detailWxml), '打字机正文没有淡入过渡');
});

t('照片兜底与原图交叉淡入，尺寸不跳', () => {
  const fb = /\.dtc-img-fb\s*\{([^}]*)\}/.exec(detailWxss);
  ok(fb, '找不到 .dtc-img-fb');
  ok(/position:\s*absolute/.test(fb[1]),
    '兜底卡还在文档流里 —— 换图那一下会跳（旧版 400rpx 与 440rpx 不同高）');
  ok(/left:\s*16rpx;\s*top:\s*16rpx;\s*right:\s*16rpx;\s*bottom:\s*16rpx/.test(fb[1]),
    '兜底卡没有贴住邮票白框的 16rpx 内边');
  ok(/dtc-img-fb fade-in-200/.test(detailWxml), '兜底卡没有淡入');
  ok(/<view class="dtc-par" style=/.test(detailWxml),
    '.dtc-par 被绑了 wx:if —— 没有照片时绝对定位的兜底卡就没有定位盒了');
  ok(!/class="dtc-img-fb[^"]*"\s+wx:else/.test(detailWxml), '兜底卡还是 wx:else 硬切');
});

t('彩蛋三条动画都有降级，且压掉动画后还在原位', () => {
  [['\\.confetti', '纸屑'], ['\\.anniv-ring', '圆环']].forEach(([sel, cn]) => {
    ok(new RegExp(sel + '\\s*\\{[^}]*animation:\\s*none').test(detailReduce), cn + '没有 reduced-motion 降级');
  });
  const badge = /\.anniv-badge\s*\{([^}]*)\}/.exec(detailReduce);
  ok(badge, '印章没有 reduced-motion 降级');
  ok(/animation:\s*none/.test(badge[1]), '印章动画没被压掉');
  ok(/transform:\s*translate\(-50%,\s*-50%\)/.test(badge[1]),
    '印章的居中位移写在关键帧里：只压掉动画不补回来，徽章会偏到右下角');
});

t('彩蛋层挂在根节点外（fixed 会被 .fade-up 的 transform 拽着走）', () => {
  const egg = detailWxml.indexOf('class="egg-layer"');
  const root = detailWxml.indexOf('class="tk-page theme-{{theme}} dtc-page fade-up"');
  ok(egg >= 0 && root >= 0, '找不到彩蛋层或根节点');
  ok(egg < root, '彩蛋层又跑回根节点里了 —— 纸屑会跟着页面滚、还被根节点裁掉');
  // wx:elif 必须紧跟链上的上一个节点，塞进链中间会把整条链打断
  ok(!/egg-layer[\s\S]{0,900}?wx:elif/.test(detailWxml.slice(0, 600)),
    '彩蛋层被塞进了 wx:if/wx:elif 链中间');
});

console.log('\n【十一、7.4.0 第二批：年报 / 回忆地图 / 时光机 / 我的】（docs/MOTION.md §3）');

/** 取容器（按 class 认第一个标签）的直接子元素，附带各自开标签上的 class 属性。
    WXML 没有现成解析器，这个够用：属性值整体走引号分支（值里的 > 不会提前收尾），
    自闭标签不压栈，注释不是标签不会被数进来。 */
function directChildren(wxml, cls) {
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|[^>"])*?)(\/?)>/g;
  const out = [];
  let m;
  let depth = 0;
  let base = -1;
  while ((m = re.exec(wxml))) {
    if (m[1] === '/') {
      depth--;
      if (base >= 0 && depth === base) return out;
      continue;
    }
    if (base < 0) {
      const c = /class="([^"]*)"/.exec(m[3]);
      if (c && c[1].split(/\s+/).indexOf(cls) >= 0) base = depth;
    } else if (depth === base + 1) {
      const c = /class="([^"]*)"/.exec(m[3]);
      out.push({ tag: m[2], cls: c ? c[1] : '' });
    }
    if (m[4] !== '/') depth++;
  }
  return out;
}

/** 某处声明所属规则的**选择器**。
    找 idx 前面最近的那个 `{`（那就是本规则的开头），再取它前面的选择器文本。
    ⚠️ 不能「往前找最近的 { 或 } 再砍掉兄弟声明」——一条规则里声明不止一行时，
    那样切出来的往往是一串空白（选择器丢失），断言会静默地永远成立。 */
function ownerSelector(src, idx) {
  const open = src.lastIndexOf('{', idx);
  if (open < 0) return '';
  // ⚠️ 三个 lastIndexOf 都要从 open **前一位**往回找：fromIndex 是含端点的，
  // 从 open 找会把 open 自己撞上，切出来是空串（选择器又丢了）。
  const at = open - 1;
  const prev = Math.max(src.lastIndexOf('}', at), src.lastIndexOf('{', at), src.lastIndexOf(';', at));
  return src.slice(prev + 1, open).trim().replace(/\s+/g, ' ');
}

t('错开登场的容器里，直接子节点必须**全部**带 .stagger', () => {
  // .stagger 的延迟靠 :nth-child 数同胞位次 —— 混进一个不参与的兄弟，
  // 后面的位次全体后移一档；那个兄弟要是 wx:if，延迟还会随它有无而飘。
  [['pages/annual/annual.wxml', 'an-flow'], ['pages/me/me.wxml', 'me-flow']].forEach(([p, cls]) => {
    const kids = directChildren(read(p).replace(/<!--[\s\S]*?-->/g, ''), cls);
    ok(kids.length >= 3, p + ' 的 .' + cls + ' 只数到 ' + kids.length + ' 个直接子节点，取错了吧');
    const naked = kids.filter((k) => !/\bstagger\b/.test(k.cls));
    ok(naked.length === 0,
      p + ' 的 .' + cls + ' 里混进了不参与错开的兄弟（' +
      naked.map((k) => k.tag + '.' + (k.cls || '无类名')).join('、') +
      '）—— 它会把后面每个元素的延迟整体顶后一档');
    ok(/\bstagger\b/.test(kids[0].cls),
      p + ' 的第一张卡没挂 .stagger —— 首屏第一眼的元素延迟 85ms 起，页面像是「空了一下才出来」');
  });
});

t('涨条只许 backwards：both/forwards 会把行内宽度盖死，之后再换数据就不涨了', () => {
  [['pages/report/report.wxss', 'bar-fill', 'pages/report/report.wxml'],
   ['pages/me/me.wxss', 'me-quota-fill', 'pages/me/me.wxml']].forEach(([p, sel, w]) => {
    const wxss = decomment(read(p));
    const rule = new RegExp('\\.' + sel + '\\s*\\{([^}]*)\\}').exec(wxss);
    ok(rule, p + ' 里找不到 .' + sel);
    ok(/backwards/.test(rule[1]), '.' + sel + ' 没写 backwards：动画终值会留在元素上');
    ok(!/\b(both|forwards)\b/.test(rule[1]),
      '.' + sel + ' 用了 both/forwards —— 它把行内 width 盖住，签到/重绘之后再换数据就永远不涨了');
    const name = (/animation\s*:\s*([\w-]+)/.exec(rule[1]) || [])[1];
    ok(name, '.' + sel + ' 没有 animation');
    const kf = blockAfter(wxss, wxss.indexOf('@keyframes ' + name));
    ok(kf, p + ' 里找不到 @keyframes ' + name);
    ok(!/\bto\b/.test(kf),
      name + ' 的关键帧写了 to —— 目标宽度必须留给行内 style（写在关键帧里就是写死的）');
    ok(new RegExp('class="' + sel + '[^"]*"[^>]*style="width: \\{\\{[^}]+\\}\\}%').test(read(w)),
      w + ' 里 .' + sel + ' 不再吃行内宽度了 —— 那样关键帧就没有终点可涨');
  });
});

t('回忆地图：换层是两段式，时长 JS 与 CSS 必须一致', () => {
  const js = decomment(read('pages/discover/discover.js'));
  const wxss = decomment(read('pages/discover/discover.wxss'));
  const ms = +((/const SWAP_MS = (\d+)/.exec(js) || [])[1]);
  ok(ms > 0, '找不到 SWAP_MS');
  const stage = /\.dc-stage\s*\{([^}]*)\}/.exec(wxss);
  ok(stage, '找不到 .dc-stage');
  const dur = +((/(\d+)ms/.exec(stage[1]) || [])[1]);
  ok(dur === ms, '换层时长对不上：js ' + ms + 'ms / wxss ' + dur + 'ms（短了淡出没完就切，长了切完还空着）');
  ok(/\.dc-stage\.is-swapping/.test(wxss) && /swapping \? 'is-swapping' : ''/.test(read('pages/discover/discover.wxml')),
    '淡出态没接上（wxss 或 wxml 缺一半）');
  const setView = /setView\(e\)\s*\{([\s\S]*?)\n  \},/.exec(js);
  ok(setView, '找不到 setView');
  ok(/if \(this\._reduce\) \{ this\.setData\(\{ view: v \}\)/.test(setView[1]),
    'setView 没在减弱动效时跳过等待 —— CSS 撤了过渡、JS 还等 180ms，就成了「点了没反应，然后突然换掉」');
});

t('回忆地图：气泡升起的关键帧必须带上居中量（transform 是整体替换的）', () => {
  const js = decomment(read('pages/discover/discover.js'));
  const wxss = decomment(read('pages/discover/discover.wxss'));
  const kf = blockAfter(wxss, wxss.indexOf('@keyframes dc-rise'));
  ok(kf, '找不到 dc-rise 关键帧');
  ok(/from\s*\{[^}]*translate\(-50%/.test(kf) && /to\s*\{[^}]*translate\(-50%/.test(kf),
    '关键帧两侧都没写 translate(-50%) —— 气泡靠它居中，只写 translateY 会跳到落点右边半个身位');
  ok(/animation:\s*dc-rise[^;]*backwards/.test(wxss),
    '升起动画不是 backwards：终值会留在元素上，按下态（.dc-bubble-hover）的 transform 被盖住');
  ok(/animation-delay:\{\{item\.d\}\}ms/.test(read('pages/discover/discover.wxml')),
    '错开延迟没下发到 wxml');
  ok(/const RISE_STEP = (\d+)/.test(js) && /d:\s*Math\.min\(i, RISE_MAX\) \* RISE_STEP/.test(js),
    'JS 没有按下标下发延迟 —— 满城气泡会同时弹上来，像闪一下');
});

t('各页新加的动画全部有降级路径（第一批 4 页 + 第三批 6 页）', () => {
  // 「新加的动效有降级」这条规矩，之前只靠人肉检查 —— 写进机器里，第三批也不会漏。
  // 两种降级方式任选：在降级块里重定义同名关键帧（去掉位移），
  // 或给这条规则加一条 `选择器 { animation: none }`（逗号列表里写也算）。
  const miss = [];
  ['annual', 'report', 'discover', 'me', 'card', 'art', 'duo', 'setting', 'theme', 'scan'].forEach((n) => {
    const p = 'pages/' + n + '/' + n + '.wxss';
    const src = decomment(read(p));
    const red = allReduceBlocks(src).join('\n');
    const re = /animation\s*:\s*([A-Za-z][\w-]*)/g;
    let m;
    while ((m = re.exec(src))) {
      const name = m[1];
      if (name === 'none') continue;
      if (new RegExp('@keyframes\\s+' + name + '\\b').test(red)) continue;
      // 降级块里的两种写法都算：
      //   ① 同一选择器（可能是逗号列表里的一员）把 animation 关掉 —— `.tear, .tear-stub { animation: none }`
      //   ② 换成另一条动画（不带位移的那条）—— `.tear-coupon { animation: tear-rm … }`
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const hit = ownerSelector(src, m.index).split(',')
        .map((s) => s.trim()).filter(Boolean)
        .some((s) => {
          const ruleRe = new RegExp('(?:^|[,\\s])' + esc(s) + '\\s*(?:,[^{}]*)?\\{([^}]*)\\}', 'g');
          let r;
          while ((r = ruleRe.exec(red))) {
            if (/animation(?:-name)?\s*:\s*[\w-]+/.test(r[1])) return true;
          }
          return false;
        });
      if (hit) continue;
      miss.push(p + ' → ' + name);
    }
  });
  ok(miss.length === 0, '这些动画开着「减弱动态效果」照样会播：\n        ' + miss.join('\n        '));
});

t('数字滚动的宿主节点必须自带字号（组件内部是 font: inherit）', () => {
  const comp = decomment(read('components/animated-number/index.wxss'));
  ok(/font:\s*inherit/.test(comp) && /color:\s*inherit/.test(comp),
    '组件不再从宿主继承字号了 —— 下面这三条断言的前提变了，回来看一眼');
  // 字号可以挂在组件自己身上（年报的 an-stat-v / 我的的 me-stat-n），
  // 也可以挂在包着它的那层文字容器上（回忆地图的 dc-foot-txt 是一句「共 N 座城」）
  [['pages/annual/annual.wxml', 'pages/annual/annual.wxss', 'an-stat-v'],
   ['pages/me/me.wxml', 'pages/me/me.wxss', 'me-stat-n'],
   ['pages/discover/discover.wxml', 'pages/discover/discover.wxss', 'dc-foot-txt']].forEach(([w, s, cls]) => {
    const wxml = read(w).replace(/<!--[\s\S]*?-->/g, '');
    const onSelf = new RegExp('<animated-number class="' + cls + '"').test(wxml);
    const wraps = directChildren(wxml, cls).some((k) => k.tag === 'animated-number');
    ok(onSelf || wraps, w + ' 里没有挂 .' + cls + ' 的 animated-number（也没有哪个 .' + cls + ' 包着它）');
    const rule = new RegExp('\\.' + cls + '\\s*\\{([^}]*)\\}').exec(decomment(read(s)));
    ok(rule && /font-size/.test(rule[1]),
      '.' + cls + ' 没写 font-size —— 数字会以默认字号出现（88rpx 的大数字变成一行小字）');
  });
});

t('<text> 里不许包自定义组件（text 只渲染文本，组件会被整个丢掉）', () => {
  [['pages/annual/annual.wxml', 'an-stat-n'], ['pages/me/me.wxml', 'me-stat-figure'],
   ['pages/discover/discover.wxml', 'dc-foot-txt']].forEach(([p, hint]) => {
    const wxml = read(p).replace(/<!--[\s\S]*?-->/g, '');
    const m = /<text\b[^>]*>(?:(?!<\/text>)[\s\S])*?<animated-number/.exec(wxml);
    ok(!m, p + '（' + hint + ' 附近）把 <animated-number> 塞进了 <text> —— ' +
      '微信的 text 只渲染文本节点，组件会被丢掉，那个数字根本不会出现');
  });
});

console.log('\n【十二、7.4.0 第三批：其余页面入场 + 画布兜底】（docs/MOTION.md §3.2）');

/** 根节点（按 class 认）的闭合标签位置：用来断言「某个 fixed 元素挂在了根节点之外」 */
function rootCloseIndex(wxml, cls) {
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|[^>"])*?)(\/?)>/g;
  let m, depth = 0, base = -1;
  while ((m = re.exec(wxml))) {
    const closing = m[1] === '/';
    if (base < 0) {
      const c = !closing && /class="([^"]*)"/.exec(m[3]);
      if (c && c[1].split(/\s+/).indexOf(cls) >= 0) { base = depth; depth++; continue; }
      if (!closing && m[4] !== '/') depth++;
      continue;
    }
    if (closing) { depth--; if (depth === base) return m.index; continue; }
    if (m[4] !== '/') depth++;
  }
  return -1;
}

t('第三批四页挂上了入场浮入（复用现成的 .fade-up，不另起一套动画）', () => {
  [['pages/art/art.wxml', /<view class="tk-page[^"]*\bar-page\b[^"]*\bfade-up\b/],
   ['pages/setting/setting.wxml', /<scroll-view class="tk-page[^"]*\bst-page\b[^"]*\bfade-up\b/],
   ['pages/theme/theme.wxml', /<view class="tk-page[^"]*\bfade-up\b/]].forEach(([p, re]) => {
    ok(re.test(read(p)), p + ' 的根节点没有挂 .fade-up —— 整页还是「唰」地出现');
  });
  // duo 是「骨架 → 内容」二级页：浮入要挂在内容那一层（骨架本身不参与），
  // 且不能再留着 .fade-in —— 两套淡入并存，谁生效看渲染顺序，改的人无从判断。
  const duo = read('pages/duo/duo.wxml').replace(/<!--[\s\S]*?-->/g, '');
  ok(/class="fade-up"/.test(duo), 'duo 的内容层还是纯淡入 —— 只有亮度变化，看不出「上来」');
  ok(!/class="fade-in"/.test(duo), 'duo 里 .fade-in 与 .fade-up 并存，删掉没用的那个');
});

t('.fade-up 的根节点里不许有指屏幕的 fixed 后代（transform 会把它变成包含块）', () => {
  // .fade-up 的 fill 是 both：动画播完 transform 也不撤，后代的 fixed 会以根节点为包含块 ——
  // 条子不贴屏幕，而是跟着页面滚走。theme 的底部操作条就是为此**故意**挂在根节点之外。
  const theme = read('pages/theme/theme.wxml').replace(/<!--[\s\S]*?-->/g, '');
  const rootEnd = rootCloseIndex(theme, 'tk-page');
  ok(rootEnd > 0, '找不到 theme 的根节点（class 里没有 tk-page？改了这里也要跟着改）');
  ok(theme.indexOf('th-bar theme-') > rootEnd,
    '底部操作条 .th-bar 又回到根节点里了 —— 根节点挂着 .fade-up，条子会跟着页面滚走');
  // 同理：挂在根节点里的弹层（fixed 面板）会被根节点的 transform 拽住
  [['pages/art/art.wxml', 'tk-page', 'bottom-sheet'], ['pages/art/art.wxml', 'tk-page', 'privacy-sheet']]
    .forEach(([p, cls, tag]) => {
      const wxml = read(p).replace(/<!--[\s\S]*?-->/g, '');
      ok(wxml.indexOf('<' + tag) > rootCloseIndex(wxml, cls),
        p + ' 的 <' + tag + '> 挂进了根节点 —— 根节点的 transform 会让它的 fixed 面板跟着页面滚');
    });
});

t('card 的卡面 / 按钮 / 入口依 85ms 错开浮入，且 .cd-flow 里没有不参与错开的兄弟', () => {
  const wxml = read('pages/card/card.wxml').replace(/<!--[\s\S]*?-->/g, '');
  const kids = directChildren(wxml, 'cd-flow');
  ok(kids.length === 3, 'card 的 .cd-flow 只数到 ' + kids.length + ' 个直接子节点，取错了吧');
  const naked = kids.filter((k) => !/\bstagger\b/.test(k.cls));
  ok(naked.length === 0,
    '.cd-flow 里混进了不参与错开的兄弟（' + naked.map((k) => k.tag + '.' + (k.cls || '无类名')).join('、') +
    '）—— 它会把后面每个元素的延迟整体顶后一档');
  ok(/\bcd-stage\b/.test(kids[0].cls), '第一层不是卡面 —— 卡面要等 85ms 才出来，第一眼是空框');
});

t('画布起不来时，卡位上要有能点的兜底（原先只打 console，用户对着空框干等）', () => {
  const js = decomment(read('pages/card/card.js'));
  const wxml = read('pages/card/card.wxml').replace(/<!--[\s\S]*?-->/g, '');
  ok(/canvasFail:\s*false/.test(js), 'card.js 的 data 里没有 canvasFail');
  ok(/setData\(\{\s*canvasFail:\s*true\s*\}\)/.test(js),
    '重试耗尽时没有把提示亮出来 —— 用户看到的还是那个「像是还在生成」的空框');
  ok(/wx:if="\{\{canvasFail\}\}"[\s\S]{0,220}bindtap="retryCanvas"/.test(wxml),
    'wxml 里没有挂在 canvasFail 上的可点兜底提示');
  ok(/class="cd-fail pressable"[^>]*hover-class=/.test(wxml), '兜底提示没有按下态（可点就得有回执）');
  const retry = /retryCanvas\(\)\s*\{([\s\S]*?)\n  \},/.exec(js);
  ok(retry, '找不到 retryCanvas');
  ok(/_ctx = null/.test(retry[1]),
    'retryCanvas 没清 _ctx —— _ensureCanvas 第一行就返回 true，点了等于没点');
  ok(/_ensureCanvas\(\)/.test(retry[1]) && /draw\(\)/.test(retry[1]),
    'retryCanvas 没有「重新初始化 + 重画」两件事都做');
});

console.log('\n测试套件：motion —— ' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
