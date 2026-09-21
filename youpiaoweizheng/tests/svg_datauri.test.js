// tests/svg_datauri.test.js —— 图形 data-uri 必须是真机认的形态（2026-09-13 事故回归）
// ============================================================
// 事故：7.0 起全站图形改成「JS 拼 SVG → data-uri → <image src>」，
//   但拼的是百分号编码（'data:image/svg+xml,' + encodeURIComponent）。
//   **开发者工具正常，真机整片不显示** —— 体验版上「只有文字没有图案」，
//   首页、tab 栏、勋章、水彩地图、协议行全中。
// 为什么单开一套：这不是某一页的 bug，是三个图形工厂共用的底座。
//   只要底座退回百分号编码，整站会再一次在手机上变白板，而工具里看不出来。
// 本套断言全部真跑（三个工厂都是纯函数），另加一条源码扫描防改回去。
// ============================================================
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const svg = require(path.resolve(__dirname, '../utils/svg.js'));
const { iconSrc } = require(path.resolve(__dirname, '../utils/icons.js'));
const deco = require(path.resolve(__dirname, '../utils/deco.js'));
const map = require(path.resolve(__dirname, '../utils/mapArt.js'));

const PREFIX = 'data:image/svg+xml;base64,';
/** 解回 SVG 文本（真机认 base64，解码即原始 SVG） */
const raw = (uri) => Buffer.from(String(uri).slice(PREFIX.length), 'base64').toString('utf8');

const META = {
  bg: '#F5F0E6', card: '#FFFFFF', primary: '#2B2420', accent: '#C26B5E',
  soft: '#E9E2D4', text: '#2B2420', text2: '#8A7E6E', border: '#E2D9C7'
};

console.log('\n【一、底座：base64 编得对、解得回】');

t('toDataUri 前缀是完整的 image/svg+xml;base64（少一段真机就静默不显示）', () => {
  ok(svg.toDataUri('<svg/>').startsWith(PREFIX), '前缀不对：' + svg.toDataUri('<svg/>').slice(0, 40));
});

t('往返一致：解回来的就是原串（一个字符都不能差）', () => {
  const s = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M1 2h3'/></svg>";
  ok(raw(svg.toDataUri(s)) === s, '往返不一致');
});

t('长度补位对：1/2/3 字节的余数各自带对 = 号（差一个字符真机整串报废）', () => {
  ok(raw(svg.toDataUri('a')) === 'a', '余 1 字节错');
  ok(raw(svg.toDataUri('ab')) === 'ab', '余 2 字节错');
  ok(raw(svg.toDataUri('abc')) === 'abc', '整除错');
  ok(svg.toDataUri('a').endsWith('==') && svg.toDataUri('ab').endsWith('='), '补位符号不对');
});

t('非 ASCII 不编坏（中文/emoji 走 UTF-8 字节，不静默污染整串）', () => {
  const s = '票根 🎟 café';
  ok(raw(svg.toDataUri(s)) === s, '中文/emoji 编坏了：' + raw(svg.toDataUri(s)));
});

console.log('\n【二、三个图形工厂都走新底座】');

t('iconSrc：前缀对、解得回、颜色与描边都在', () => {
  const u = iconSrc('mask', '#C26B5E', 0.6, 1.5);
  ok(u.startsWith(PREFIX), '未走 base64');
  const s = raw(u);
  ok(s.startsWith('<svg') && s.endsWith('</svg>'), '解出来不是完整 svg');
  ok(s.includes("#C26B5E"), '颜色丢了');
  ok(s.includes('stroke-opacity'), 'opacity 丢了');
});

t('iconSrc：根节点带 width/height（真机拿不到内在尺寸就不画）', () => {
  const s = raw(iconSrc('clock', '#2B2420'));
  ok(/\bwidth='24'/.test(s) && /\bheight='24'/.test(s), '缺宽高：' + s.slice(0, 120));
});

t('iconSrc：未知图标名仍回落票根（不给出空 src）', () => {
  ok(raw(iconSrc('不存在的图标名', '#2B2420')).length > 20, '未回落');
});

t('deco：装饰元素都是 base64', () => {
  for (const u of [deco.decoSrc('sprig', META), deco.decoSrc('postmark', META)]) {
    ok(String(u).startsWith(PREFIX), 'deco 未走 base64：' + String(u).slice(0, 30));
    ok(raw(u).endsWith('</svg>'), 'deco 解出来不是完整 svg');
  }
});

t('mapArt：水彩陆地 / 时光路线 / 邮票都是 base64', () => {
  const land = map.landSrc(META);
  const route = map.routeSrc([{ lng: 116, lat: 39 }, { lng: 121, lat: 31 }]);
  const stamp = map.stampSrc('#C26B5E');
  for (const u of [land, route, stamp]) {
    ok(String(u).startsWith(PREFIX), 'mapArt 未走 base64：' + String(u).slice(0, 30));
  }
  ok(raw(land).includes('<clipPath'), '水彩陆地丢了裁剪（会画到国土外面）');
  ok(raw(land).includes('#E9E2D4'), '水彩陆地丢了主题纸浆色');
});

t('routeSrc 单点仍返回空串（别为了改编码把这条改了）', () => {
  ok(map.routeSrc([{ lng: 116, lat: 39 }]) === '', '单点仍出线');
});

console.log('\n【三、真机口径：这几条踩过坑，钉住】');

t('解出来的 svg 都带 xmlns 命名空间（少了真机不认）', () => {
  for (const u of [iconSrc('pin', '#2B2420'), deco.decoSrc('sprig', META), map.landSrc(META)]) {
    ok(raw(u).includes("xmlns='http://www.w3.org/2000/svg'") ||
       raw(u).includes('xmlns="http://www.w3.org/2000/svg"'), '缺 xmlns');
  }
});

t('data-uri 里不出现裸尖括号与双引号（真机对未编码的 < > " 会静默失败）', () => {
  for (const u of [iconSrc('user', '#2B2420'), deco.decoSrc('postmark', META), map.landSrc(META)]) {
    const s = String(u);
    ok(!/[<>"']/.test(s.slice(PREFIX.length)), 'base64 段里混进了 XML 特殊字符');
  }
});

console.log('\n【四、防回归：源码里不许再出现百分号编码的写法】');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

t('utils/*.js 不得再有 data:image/svg+xml, + encodeURIComponent 的旧写法', () => {
  // 只扫代码，不扫注释 —— utils/svg.js 的文件头正是在讲这个旧写法（那段是文档）
  const code = (f) => read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const dir = path.resolve(__dirname, '../utils');
  const bad = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => /data:image\/svg\+xml,\s*'\s*\+/.test(code('utils/' + f)));
  ok(bad.length === 0, '这些文件还在拼百分号编码：' + bad.join(', '));
});

t('WXSS 的背景图（纸纹 / 波浪线）也必须是 base64 的 data-uri', () => {
  // 同一场事故的第二现场：app.wxss 里的 background-image 也是百分号编码，
  // 真机同样静默不显示（纸纹没了、主题卡的波浪线也没了）
  const dir = path.resolve(__dirname, '..');
  const files = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { if (!/node_modules|dist|\.git/.test(p)) walk(p); }
      else if (f.endsWith('.wxss')) files.push(p);
    }
  })(dir);
  const bad = files.filter((p) => /url\(["']?data:image\/svg\+xml,/.test(fs.readFileSync(p, 'utf8')));
  ok(bad.length === 0, '这些 WXSS 还在用百分号编码：' + bad.map((p) => path.relative(dir, p)).join(', '));
  ok(/url\("data:image\/svg\+xml;base64,/.test(read('app.wxss')), 'app.wxss 的纸纹背景没了');
});

t('三个工厂确实 require 了新底座（删掉这行就会退回旧写法）', () => {
  for (const f of ['utils/icons.js', 'utils/deco.js', 'utils/mapArt.js']) {
    ok(/require\('\.\/svg\.js'\)/.test(read(f)), f + ' 没有 require svg.js');
  }
});

// ════════════════════════════════════════════════════════════
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
