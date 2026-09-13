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

console.log('\n测试套件：motion —— ' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
