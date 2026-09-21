// tests/font_load.test.js —— 品牌字体（8.2.0 起挂载，8.3.2 起真接上）
// ============================================================
// 【为什么值得一套测试】字体挂不上**不会报错、不会白屏、不会卡启动**，
// 它只是悄无声息地变回系统字体 —— 而系统字体在 Windows 开发工具上长得还行，
// 于是这个「没接上」能一路混过 Self 检查、混过上传、混过体验版审核。
//
// 8.2.0 就是这样：代码、字体文件、上传脚本全齐了，但 FONT_BASE 还写着
// `https://example.com/ypwz/fonts/` 这个占位符 —— 半个多月没人发现，
// 直到 8.3.2 真去传文件才看见。这套测试就是拦这个的。
// ============================================================
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const ROOT = path.resolve(__dirname, '..');
const font = require(path.join(ROOT, 'utils/font.js'));

// 字体源文件目录。跟 scripts/ci/upload-fonts.js 用的是同一个路径，改一处得改两处
// —— 这里故意不去 require 那个脚本（它会连带 require miniprogram-ci，测试不该依赖它）
const SRC_DIR = path.join(ROOT, '..', '字体文件-传腾讯云用');

// ════════════════════════════════════════════════════════════
// 一、FONT_BASE 必须是真地址
// ════════════════════════════════════════════════════════════
t('FONT_BASE 是真域名，不是 example.com 之类的占位符', () => {
  const b = font.FONT_BASE;
  ok(/^https:\/\//.test(b), 'FONT_BASE 必须是 https（小程序只认 https）：' + b);
  ok(!/example\.com|localhost|127\.0\.0\.1|你的|xxx/i.test(b), 'FONT_BASE 还是占位符：' + b);
  ok(/\/$/.test(b), 'FONT_BASE 结尾少一个斜杠，拼出来的 URL 会缺分隔符：' + b);
});

t('FONT_BASE 不带端口、不带 query —— 域名要报进微信后台白名单，带了就填不进去', () => {
  const rest = font.FONT_BASE.replace(/^https:\/\//, '');
  ok(!/:\d+/.test(rest), 'FONT_BASE 带了端口号：' + font.FONT_BASE);
  ok(!/[?#]/.test(rest), 'FONT_BASE 带了 ? / # ：' + font.FONT_BASE);
});

// ════════════════════════════════════════════════════════════
// 二、代码里写的文件名，本地必须真有这个文件
// ════════════════════════════════════════════════════════════
t('FACES 里的每个文件都能在字体目录里找到', () => {
  ok(fs.existsSync(SRC_DIR), '找不到字体目录：' + SRC_DIR);
  const have = new Set(fs.readdirSync(SRC_DIR));
  for (const f of font.FACES) {
    ok(have.has(f.file), `FACES 写了 ${f.file}，但字体目录里没有这个文件（改名了没同步代码？）`);
  }
});

t('字体文件都压到 1.2MB 以下 —— 超了就是子集化没跑，别传', () => {
  for (const f of font.FACES) {
    const p = path.join(SRC_DIR, f.file);
    if (!fs.existsSync(p)) continue;
    const kb = fs.statSync(p).size / 1024;
    ok(kb < 1200, `${f.file} 有 ${kb.toFixed(0)}KB，明显是没子集化的全字库`);
  }
});

// ════════════════════════════════════════════════════════════
// 三、挂不上时的兜底：CSS 字体栈里必须留着系统字体
// ════════════════════════════════════════════════════════════
t('app.wxss 的标题字体栈留着系统字体兜底', () => {
  const css = fs.readFileSync(path.join(ROOT, 'app.wxss'), 'utf8');
  const m = css.match(/--font-title-full\s*:\s*([^;]+);/);
  ok(m, 'app.wxss 里没有 --font-title-full —— 自定义字体的兜底栈没了');
  ok(/YPWZTitle/.test(m[1]), '--font-title-full 里没挂自定义字体族名，等于白加载');
  ok(/sans-serif|serif|PingFang|Songti|Heiti/i.test(m[1]),
    '--font-title-full 里只有自定义字体、没有系统字体兜底 —— 加载失败会让标题整片消失');
});

// ════════════════════════════════════════════════════════════
// 三′、画布：导出成图片的那些字，必须也接到品牌字体上
//
// 为什么单列一节：`ctx.font` **不认 CSS 变量、也不走 app.wxss 的字体栈**。
// 页面上写着 `var(--font-title-full)` 生效了，导出图里还是系统字体 ——
// 图片是画布画的，跟 CSS 一点关系没有。8.3.2 之前 28 处画布字体全写着裸 `serif`，
// 所以「页面上换了字体、海报没换」这件事肉眼很难当场发现（要导出一张图才看得见）。
// ════════════════════════════════════════════════════════════
const CANVAS_FILES = [
  'pages/card/card.js',       // 纪念卡片（四套风格 + 小红书三件套）
  'pages/annual/poster.js',   // 年度报告海报
  'pages/discover/film.js',   // 回忆地图一键成片
  'pages/art/art.js'          // AI 图版藏品签
];

t('画布里不许再有裸 serif —— 那就是「页面换了字体、导出图没换」', () => {
  const bad = [];
  for (const rel of CANVAS_FILES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;          // 注释不算
      if (/(^|[^-\w])serif/.test(line) && /px\s+serif/.test(line)) {
        bad.push(rel + ':' + (i + 1) + '  ' + line.trim());
      }
    });
  }
  ok(!bad.length, '这些画布字体还在用系统衬线体，没接品牌字体：\n        ' + bad.join('\n        '));
});

t('画布字体只从 utils/font.js 取，不在页面里手写族名', () => {
  for (const rel of CANVAS_FILES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    ok(/CANVAS_TITLE:\s*FT\s*\}\s*=\s*require\(/.test(src),
      rel + ' 没有从 utils/font.js 引 CANVAS_TITLE —— 画布字体得统一从那儿拿');
    ok(!/"YPWZTitle"/.test(src), rel + ' 直接手写了族名 "YPWZTitle"，该用 FT 常量');
  }
});

t('CANVAS_TITLE 的族名与 FACES 里真正加载的那个对得上', () => {
  ok(font.CANVAS_TITLE.indexOf('"' + font.FACES[0].family + '"') === 0,
    'CANVAS_TITLE 写的族名（' + font.CANVAS_TITLE + '）跟 FACES[0] 挂的（' +
    font.FACES[0].family + '）不是同一个 —— 画布会静默回落到兜底字体');
  ok(/\bserif\b/.test(font.CANVAS_TITLE), 'CANVAS_TITLE 没留系统兜底字体');
});

// ════════════════════════════════════════════════════════════
// 四、boot 的行为：只挂一次、失败不影响任何事
// ════════════════════════════════════════════════════════════
t('boot 里每个字体都开了 global —— 不开的话 App 层调用等于没挂', () => {
  const src = fs.readFileSync(path.join(ROOT, 'utils/font.js'), 'utf8');
  ok(/global:\s*true/.test(src), 'loadFontFace 没开 global：App 层没有页面上下文，不开就一直挂不上');
  ok(/scopes:\s*\[[^\]]*native/.test(src), '没带 native scope：Canvas 导出海报时用不到这个字体');
});

t('挂载失败只上报，不抛错', () => {
  const src = fs.readFileSync(path.join(ROOT, 'utils/font.js'), 'utf8');
  // fail 回调里必须有内容，且不能有 throw
  const m = src.match(/fail:\s*function[^{]*\{([\s\S]*?)\n\s*\}/);
  ok(m, 'font.js 里没有 fail 回调 —— 加载失败会静默到没人知道');
  ok(!/throw/.test(m[1]), 'fail 回调里 throw 了：加载失败会把启动流程整个打断');
});

(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log('  PASS  ' + name);
      pass++;
    } catch (e) {
      console.log('  FAIL  ' + name + '\n        ' + (e && e.message));
      fail++;
    }
  }
  console.log('\n──────────────────────────────');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
