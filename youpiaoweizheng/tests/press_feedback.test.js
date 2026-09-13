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

// —— 白名单防腐：条目对不上说明对应元素已改，别让它悄悄失效 ——
t('白名单没有腐烂：每条 NO_FEEDBACK 仍能在对应文件里命中', () => {
  const stale = NO_FEEDBACK.filter((e) =>
    !allTags.some((x) => x.file === e.file && hasClass(x, e.cls) && /\b(bind|catch)tap\b/.test(x.attrs)));
  ok(stale.length === 0, '白名单条目已失效（元素改了名或加了反馈），请同步清理：\n        ' +
    stale.map((e) => `${e.file}|${e.cls}`).join('\n        '));
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
