// tests/page_timers.test.js —— 页面退出后还在跑的定时器（用户看得见，日志里没有）
// ============================================================
// 这类问题的共同点：wx.navigateBack / navigateTo / switchTab / showModal / openSetting
// 都是**应用级 API、不认页面**。页面已经出栈，定时器到点照样执行 —— 于是出现
// 「自己按了返回，系统又替你退一层」「弹窗盖在上一页上」，而且不抛错、不留日志。
//
// 这个坑项目里踩过三次：detail 的 _leaveTimer、scan 的 _later（当时都修了），
// 以及 theme 的返回、card 的署名弹窗、detail 的失败弹窗（8.0.1 这轮补的）。
// 所以立一条规则扫全项目，而不是只钉那三个文件：
//   **回调里碰页面栈或弹窗的定时器，必须登记成实例字段，并在 onUnload / onHide 里清掉。**
//   （tab 页切走只触发 onHide，永远不会 onUnload —— 所以两者都算「清理机会」）
// ============================================================
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  PASS  ' + msg); } else { fail++; console.log('  FAIL  ' + msg); }
};
const bad = (msg) => { fail++; console.log('  FAIL  ' + msg); };

/** 危险 API：不绑页面、页面卸载后照样生效 */
const RISKY = /wx\.(navigateBack|navigateTo|redirectTo|reLaunch|switchTab|showModal|openSetting)\s*\(/;

/** 从 src[i]（必须是 { 或 (）起找配对的右括号，找不到返回 -1。字符串会被跳过 */
function matchPair(src, i) {
  const open = src[i];
  const close = open === '{' ? '}' : ')';
  let depth = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (c === open) depth++;
    else if (c === close) { depth--; if (!depth) return k; }
    else if (c === '"' || c === "'" || c === '`') {
      for (k++; k < src.length && src[k] !== c; k++) if (src[k] === '\\') k++;
    }
  }
  return -1;
}

/** 去掉注释后的源码（注释里写的例子不该被当成代码） */
const strip = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** 扫一个页面：返回「回调里碰了页面栈/弹窗」的定时器清单 */
function riskyTimers(file) {
  const src = strip(fs.readFileSync(file, 'utf8'));
  const out = [];
  const re = /(this\.(_\w+)\s*=\s*)?set(Timeout|Interval)\(/g;
  let m;
  while ((m = re.exec(src))) {
    const brace = src.indexOf('{', re.lastIndex);
    if (brace < 0) continue;
    const end = matchPair(src, brace);
    if (end < 0) continue;
    const body = src.slice(brace, end);
    if (RISKY.test(body)) out.push({ field: m[2] || '', body });
  }
  return out;
}

/** 取某个生命周期钩子的函数体（没有就返回空串） */
function hookBody(src, name) {
  const i = src.indexOf(name + '(');
  if (i < 0) return '';
  const brace = src.indexOf('{', i);
  if (brace < 0) return '';
  const end = matchPair(src, brace);
  return end < 0 ? '' : src.slice(brace, end);
}

/** 清理机会 = onUnload ∪ onHide：普通页退出走 onUnload，tab 页切走只触发 onHide */
const cleanupBody = (src) => hookBody(src, 'onUnload') + hookBody(src, 'onHide');

// 全项目的页面文件
const pagesDir = path.join(ROOT, 'pages');
const files = fs.readdirSync(pagesDir)
  .map((d) => path.join(pagesDir, d, d + '.js'))
  .filter((f) => fs.existsSync(f));
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

console.log('\n【一、危险的定时器必须登记成实例字段】');
files.forEach((f) => {
  const naked = riskyTimers(f).filter((h) => !h.field);
  ok(naked.length === 0, rel(f) + (naked.length ? ' 有 ' + naked.length + ' 个裸定时器在操作页面栈/弹窗' : ' 干净'));
});

console.log('\n【二、登记了就必须在 onUnload / onHide 里清掉】');
files.forEach((f) => {
  const named = riskyTimers(f).filter((h) => h.field);
  if (!named.length) return;
  const cleanup = cleanupBody(strip(fs.readFileSync(f, 'utf8')));
  const missing = named.filter((h) =>
    !cleanup.includes('clearTimeout(this.' + h.field + ')') &&
    !cleanup.includes('clearInterval(this.' + h.field + ')'));
  if (missing.length) bad(rel(f) + ' 的 ' + missing.map((h) => h.field).join(' / ') + ' 没清掉');
  else ok(true, rel(f) + ' 的 ' + named.map((h) => h.field).join(' / ') + ' 都清了');
});

console.log('\n【三、四处已知的坑，字段名钉住（改回裸 setTimeout 就会重演）】');
const KNOWN = [
  ['pages/theme/theme.js', '_backTimer', '应用主题后自己返回 → 被它再退一层'],
  ['pages/card/card.js', '_sigTimer', '存完卡立刻返回 → 署名弹窗盖在详情页上'],
  ['pages/detail/detail.js', '_failTimer', '生成失败瞬间返回 → 弹窗落到上一页'],
  ['pages/home/home.js', '_flyTimer', '点卡片后切走 → 详情页从隐藏的 tab 上冒出来']
];
KNOWN.forEach(([f, field, what]) => {
  const src = strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  ok(src.includes('this.' + field + ' = setTimeout('), f + ' 的 ' + field + ' 登记着 —— ' + what);
  ok(cleanupBody(src).includes('clearTimeout(this.' + field + ')'), f + ' 的 ' + field + ' 在 onUnload/onHide 里清了');
});

console.log('\n测试套件：page_timers —— ' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
