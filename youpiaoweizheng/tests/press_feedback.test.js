// tests/press_feedback.test.js —— 全站按压反馈一致性（7.2.0 · V2）
// 为什么要有这个：7.2.0 之前全站有 14 处「可点但按下去毫无反应」，
// 其中 2 处是只写了 pressable（过渡）却忘了 hover-class（按下态）的死配置——
// 编译不报错、点击也能用，只有手指头能发现。这类问题只能靠机检兜住。
//
// 三条断言：
//   ① pressable 必须配 hover-class —— 配了过渡却没有按下态，等于没做（零误报，不留白名单）
//   ② 可点的开标签必须有 hover-class —— 白名单只放「遮罩层」这类刻意不加反馈的元素
//   ③ hover-class 指向的类必须真的在某个 wxss 里存在 —— 防手滑拼错，拼错同样是静默失效
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

// —— 收集全仓 wxml / wxss ——
const wxmls = [], wxsss = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.wxml')) wxmls.push(p);
    else if (e.name.endsWith('.wxss')) wxsss.push(p);
  }
})(ROOT);

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

// 全仓已定义的类名（并集）。粗粒度但零误报，足以拦住拼写错误
const definedClasses = new Set();
for (const p of wxsss) {
  const css = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) definedClasses.add(m[1]);
}

// 刻意不加按压反馈：遮罩层（点空白即关闭，给反馈反而像按钮）。
// discover 页原先手写的 dc-mask / dc-sheet 已在 V11 收敛到该组件，条目一并清掉
const NO_FEEDBACK = [
  { file: 'components/bottom-sheet/index.wxml', cls: 'bs-mask' },
];

// 逐个开标签解析（跳过注释），拿到 tag / 属性 / 行号
function eachTag(src) {
  const clean = src.replace(/<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, ' ')); // 保行号
  const re = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  const out = [];
  let m;
  while ((m = re.exec(clean))) {
    out.push({
      tag: m[1],
      attrs: m[2],
      line: clean.slice(0, m.index).split('\n').length,
      cls: (m[2].match(/\bclass\s*=\s*"([^"]*)"/) || [, ''])[1].trim(),
    });
  }
  return out;
}

// class 是 token 列表，且可夹带 {{...}} 模板——比对白名单时只取其中的静态类名
const classTokens = (cls) => cls.replace(/\{\{[\s\S]*?\}\}/g, ' ').split(/\s+/).filter(Boolean);

const allTags = [];
for (const p of wxmls) for (const tag of eachTag(fs.readFileSync(p, 'utf8'))) allTags.push({ ...tag, file: rel(p) });
const hasClass = (x, name) => classTokens(x.cls).includes(name);

t('① pressable 必须配 hover-class：配了过渡却没有按下态，等于没做', () => {
  const bad = allTags
    .filter((x) => /(^|\s)pressable(\s|$)/.test(x.cls) && !/\bhover-class\b/.test(x.attrs))
    .map((x) => `${x.file}:${x.line}  class="${x.cls}"`);
  ok(bad.length === 0, '有 pressable 但无 hover-class（压迫感只写在代码里，手上没感觉）：\n        ' + bad.join('\n        '));
});

t('② 可点的开标签必须有 hover-class（遮罩层等刻意不加的走白名单）', () => {
  const bad = allTags
    .filter((x) => /\b(bind|catch)tap\b/.test(x.attrs) && !/\bhover-class\b/.test(x.attrs))
    .filter((x) => !NO_FEEDBACK.some((e) => e.file === x.file && hasClass(x, e.cls)))
    .map((x) => `${x.file}:${x.line}  class="${x.cls}"`);
  ok(bad.length === 0, '可点但按下去没反应：\n        ' + bad.join('\n        ') +
    '\n        （若确属刻意不加，请连同理由加进本文件的 NO_FEEDBACK 白名单）');
});

t('③ hover-class 指向的类必须真的存在：拼错同样是静默失效', () => {
  const bad = [];
  for (const x of allTags) {
    const m = x.attrs.match(/\bhover-class\s*=\s*"([^"]*)"/);
    if (!m) continue;
    const target = m[1].trim();
    if (!target || target === 'none') continue;               // none = 显式关闭反馈
    if (/\{\{/.test(target)) continue;                        // 动态值，如 dtc-memo 的条件化写法
    if (!definedClasses.has(target)) bad.push(`${x.file}:${x.line}  hover-class="${target}"`);
  }
  ok(bad.length === 0, 'hover-class 指向了不存在的类：\n        ' + bad.join('\n        '));
});

// ── 7.4.0 补：上面那条只查「类在全项目存在」，查不出「在这块里根本不生效」──
// 自定义组件默认**样式隔离**：app.wxss 的类进不到组件内部。
// 隐私弹窗的三个按钮就是这么死的 —— 写了 pressable/press-hover，全项目都有定义，
// 机检绿，手机上按下去毫无反应。所以组件里必须查「在它自己的 wxss 里有没有」。
const ownWxss = new Map();   // 组件目录 → 它自己 wxss 里定义的类
for (const p of wxsss) {
  const dir = path.dirname(p);
  const own = ownWxss.get(dir) || new Set();
  const css = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) own.add(m[1]);
  ownWxss.set(dir, own);
}
const componentTags = allTags.filter((x) => x.file.startsWith('components/'));

t('④ 组件里用到的反馈类，必须定义在该组件自己的 wxss 里（样式隔离）', () => {
  const bad = [];
  for (const x of componentTags) {
    const own = ownWxss.get(path.dirname(path.join(ROOT, x.file)));
    ok(own, '取不到 ' + x.file + ' 同目录的 wxss');
    const targets = [];
    const h = x.attrs.match(/\bhover-class\s*=\s*"([^"]*)"/);
    if (h) targets.push(h[1].trim());
    classTokens(x.cls).filter((c) => /^press(able)?$|^press-.*hover$/.test(c)).forEach((c) => targets.push(c));
    targets.filter((t) => t && t !== 'none' && !/\{\{/.test(t)).forEach((t) => {
      if (!own.has(t)) bad.push(`${x.file}:${x.line}  ${t}`);
    });
  }
  ok(bad.length === 0, '组件里引用了但本组件 wxss 没有的反馈类（样式隔离，手机上没反应）：\n        ' +
    bad.join('\n        '));
});

t('⑤ 组件里不使用只定义在 app.wxss 的类（隔离，等于没写）', () => {
  const appOnly = new Set();
  const appCss = fs.readFileSync(path.join(ROOT, 'app.wxss'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of appCss.matchAll(/\.([a-zA-Z][\w-]*)/g)) appOnly.add(m[1]);
  const bad = [];
  for (const x of componentTags) {
    const own = ownWxss.get(path.dirname(path.join(ROOT, x.file)));
    classTokens(x.cls).forEach((c) => {
      if (appOnly.has(c) && !own.has(c)) bad.push(`${x.file}:${x.line}  ${c}`);
    });
  }
  ok(bad.length === 0, '组件在 className 里写了 app.wxss 的类，但组件内引用不到（样式隔离）：\n        ' +
    bad.join('\n        ') + '\n        （把这几行样式补进组件自己的 wxss）');
});

// ── 7.4.0 补：按下态的 transform 会把元素自己的 transform 整个盖掉 ──
// hover-class 生效时，那条规则的 transform 是**替换**而不是叠加。所以元素自己要是
// 靠 transform 定位的（最典型的就是 translateX(-50%) 居中），按下态只写 scale 的话，
// 手一按它就横跳半个身位再跳回来。全站扫一遍，只认「同一文件里能找到规则」的类。
const cssOf = new Map();   // 相对路径 → 去注释后的 wxss
for (const p of wxsss) cssOf.set(rel(p), fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));
const appCssClean = fs.readFileSync(path.join(ROOT, 'app.wxss'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** 取「.cls { ... }」的声明块（要求类名后紧跟 {，避开 .a.b / .a::after 这类复合选择器） */
function ruleDecl(css, cls) {
  if (!css) return null;
  const m = new RegExp('\\.' + cls.replace(/[-]/g, '\\-') + '\\s*\\{([^}]*)\\}').exec(css);
  return m ? m[1] : null;
}
const hasTranslate = (s) => !!s && /transform\s*:[^;}]*translate/.test(s);

t('⑥ 元素自身带 translate 时，按下态必须保留它（否则手一按就横跳）', () => {
  const bad = [];
  for (const x of allTags) {
    const h = x.attrs.match(/\bhover-class\s*=\s*"([^"]*)"/);
    if (!h) continue;
    const target = h[1].trim();
    if (!target || target === 'none' || /\{\{/.test(target)) continue;
    const css = cssOf.get(x.file.replace(/\.wxml$/, '.wxss'));
    for (const c of classTokens(x.cls)) {
      if (!hasTranslate(ruleDecl(css, c))) continue;
      // 元素基准 transform 带位移 → 按下态也得带，否则位移被冲掉
      const hd = ruleDecl(css, target) || ruleDecl(appCssClean, target);
      if (!hasTranslate(hd)) {
        bad.push(`${x.file}:${x.line}  .${c} 的 transform 带位移，hover-class="${target}" 却没有`);
      }
    }
  }
  ok(bad.length === 0, '按下态的 transform 会盖掉元素自身的位移（按下去会横跳）：\n        ' +
    bad.join('\n        ') + '\n        （给这个元素写一个本组件的 hover 类，把位移带上）');
});

// —— 白名单防腐：条目对不上说明对应元素已改，别让它悄悄失效 ——
t('白名单没有腐烂：每条 NO_FEEDBACK 仍能在对应文件里命中', () => {
  const stale = NO_FEEDBACK.filter((e) =>
    !allTags.some((x) => x.file === e.file && hasClass(x, e.cls) && /\b(bind|catch)tap\b/.test(x.attrs)));
  ok(stale.length === 0, '白名单条目已失效（元素改了名或加了反馈），请同步清理：\n        ' +
    stale.map((e) => `${e.file}|${e.cls}`).join('\n        '));
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
