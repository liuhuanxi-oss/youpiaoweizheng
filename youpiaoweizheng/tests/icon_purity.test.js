// tests/icon_purity.test.js —— 全仓「图标只走 icons.js」的兜底机检
// 为什么要有这个：7.0.0 定下「wxml 里不出现 emoji 与字符图标」，但当时是**逐页**写断言，
// 只覆盖了那一轮重做的 10 屏。trello 教训：没被重做的老页（timeline / report / privacy-sheet）
// 一直到 7.2.0 还留着 🗓️ 🔗 🔐 —— 编译不报错、点击也正常，只有真机上字形回落才看得出来。
// 这份测试按「全仓」而不是「按页」扫，新加页面自动纳管，不必每页抄一遍断言。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

// —— 全仓 wxml ——
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.wxml')) files.push(p);
  }
})(ROOT);

// 彩色 emoji（\p{Emoji_Presentation} 只认「默认就是彩色的」那些，不会误伤中文与普通符号）
// + 项目 CHANGELOG 7.0.0 点名的字符图标（系统字体里长得像图标、但字形覆盖不可控）
const BANNED = /\p{Emoji_Presentation}|[✦▾▸›⟶→✓✔★☆↻➤▶❤♥♡✿📍]/u;

/** 去掉注释再查：注释里写「原先是 🔔」是正常的考古记录，不该报错 */
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

t('全仓 wxml 正文无 emoji / 字符图标（图形一律走 utils/icons.js 的 data-uri）', () => {
  const bad = [];
  for (const p of files) {
    stripComments(fs.readFileSync(p, 'utf8')).split('\n').forEach((line, i) => {
      const m = line.match(BANNED);
      if (m) bad.push(`${path.relative(ROOT, p).replace(/\\/g, '/')}:${i + 1}  「${m[0]}」  ${line.trim().slice(0, 60)}`);
    });
  }
  ok(bad.length === 0, '真机字形覆盖不可控，请换成 icons.js 里的线性图标：\n        ' + bad.join('\n        '));
});

t('图标名都在 utils/icons.js 里注册过（拼错等于整块空白）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'icons.js'), 'utf8');
  const names = new Set([...src.matchAll(/^\s{2}([a-zA-Z][\w]*):/gm)].map((m) => m[1]));
  const bad = [];
  for (const p of files) {
    const body = stripComments(fs.readFileSync(p, 'utf8'));
    for (const m of body.matchAll(/iconSrc\(\s*'([\w]+)'/g)) {
      if (!names.has(m[1])) bad.push(`${path.relative(ROOT, p)}  图标名 ${m[1]}`);
    }
    // js 里编译的图标（页面级 buildIc）不在这里查，见各页测试套件
  }
  ok(bad.length === 0, 'icons.js 里没有这些名字：\n        ' + bad.join('\n        '));
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
