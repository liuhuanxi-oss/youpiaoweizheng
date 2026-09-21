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
