// tests/audit_0803.test.js —— 8.0.3 两路体检的修复（小红书素材真机链路 + 数据一致性）
// ============================================================
// 这些问题的共同点：**开发者工具里看着都对**。要么差异只在真机（iOS 的离屏画布导出、
// 真机按 dpr 再乘一遍尺寸），要么不报错只是结果不对（删票后列表不留旧行、对方解绑后
// 勋章不灭、两个页面的「那年今天」口径不同）。所以断言只能钉结构 —— 改回旧写法必须当场红。
// ============================================================
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const strip = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  PASS  ' + msg); } else { fail++; console.log('  FAIL  ' + msg); }
};

const card = strip(read('pages/card/card.js'));
const timeline = strip(read('pages/timeline/timeline.js'));
const me = strip(read('pages/me/me.js'));
const album = strip(read('pages/album/album.js'));

// ════════════════════════════════════════════════════════════
console.log('\n【一、离屏画布导出：iOS 上 canvasToTempFilePath 不认它】');

ok(/async _exportOffscreen\(off\)/.test(card),
  '导出收进一个 _exportOffscreen —— 两条路（主路径 / 回退）都在这一处，别散在流程里');
ok(/toDataURL\(/.test(card),
  '有 toDataURL 回退：微信 2022 年在开放社区明确回复 iOS 未支持离屏画布调 canvasToTempFilePath（报 invalid viewId）');
ok(/EXPORT_TIMEOUT_MS/.test(card) && /Promise\.race/.test(card),
  '有超时兜底：PC 微信上那个 Promise 可能永不 settle —— 不兜的话 exporting 永远为 true，mask 遮罩把整页焊死');
ok(/encoding: 'base64'/.test(card) && /USER_DATA_PATH/.test(card),
  '回退路径把 base64 写进临时文件再存相册（toDataURL 只给字符串）');
ok(/unlink\(/.test(card),
  '回退写的临时文件用完就删 —— 不然每出一次图就在用户数据目录堆一个几百 KB 的 PNG');
ok(/width: XHS_W, height: XHS_H, destWidth: XHS_W, destHeight: XHS_H/.test(card),
  '导出尺寸显式定死 1080×1440：不传的话真机按 destWidth = width × 屏幕像素密度 再乘一遍 dpr');
ok(/_dropCanvas\(off\)/.test(card),
  '离屏画布用完显式置零 —— 一条笔记要连出三张，位图叠着等 GC 会顶到低端机内存线');
ok(/if \(!ctx\)[\s\S]{0,400}?微信版本过低/.test(card),
  '建不出 2d 离屏画布（基础库 < 2.16.1）时提示「更新微信」，而不是误导人的「保存失败，请重试」');

// ════════════════════════════════════════════════════════════
console.log('\n【二、双人时间线：从详情页删票返回，不留幽灵行】');

// 只取 onShow 自己的函数体：写成 /onShow\(\)<任意 700 字>this.load\(/ 会跨到下面的下拉刷新，
// 把 this.load 删掉也照样绿 —— 那样等于没测（本轮真踩过）
const onShowBody = (/onShow\(\)\s*\{([\s\S]*?)\n {2}\},/.exec(timeline) || [, ''])[1];
ok(/this\.load\(/.test(onShowBody),
  'onShow 里重取：点自己的票进详情 → 删除 → 自动返回，不重取的话那一行会留在原地，点进去是空态');
ok(!/onLoad\(\)\s*\{\s*this\.load\(\)/.test(timeline),
  'onLoad 不再单独取数 —— 与 onShow 两处都写，等于首次进来连拉两次云');
ok(/async load\(silent\)/.test(timeline),
  'load 有静默档：第二次起不闪骨架，旧内容撑到新数据回来');
ok(/if \(!silent\) this\.setData\(\{ error/.test(timeline),
  '静默刷新失败不把已有列表换成错误页（刚看完返回，网络抖一下不该整页变样）');

// ════════════════════════════════════════════════════════════
console.log('\n【三、「我的」勋章：对方解绑后必须灭】');

ok(/couple\.queryCouple\(\)\.catch\(\(\) => couple\.cachedCouple\(\)\)/.test(me),
  '绑定态现查一次、失败退回缓存 —— 解绑发生在**对方手机上**，本地缓存无从作废');
ok(!/const c = couple\.cachedCouple\(\)/.test(me),
  '「我的」页不再只读本地缓存（只读缓存的话勋章会一直亮着，与双人空间页的结论相反）');

// ════════════════════════════════════════════════════════════
console.log('\n【四、首页「那年今天」与时光机「那年今日」同一口径】');

// 真跑：换一个**非东八区**的时区起子进程 —— 在东八区的测试机上跑，写错成设备时区也照样绿，
// 那种断言等于没写。注入的时刻：UTC 2026-09-15 17:30 = 北京 09-16 01:30，纽约还是 15 日。
const T = Date.UTC(2026, 8, 15, 17, 30);
const probe = (tz) => execSync(
  `${JSON.stringify(process.execPath)} -e "` +
  `var d=require('./utils/date.js');var m=d.todayMD(${T}),s=d.todaySign(${T});` +
  `process.stdout.write(m.y+'-'+m.m+'-'+m.d+'|'+s.date)"`,
  { cwd: ROOT, env: Object.assign({}, process.env, { TZ: tz }) }
).toString();

ok(probe('America/New_York') === '2026-9-16|2026.09.16',
  '在纽约时区下也按北京日期算（UTC 15 日 17:30 → 16 日）—— 口径跟着设备走就会与首页对不上');
ok(probe('Pacific/Kiritimati') === '2026-9-16|2026.09.16',
  '在 UTC+14 下同样是北京日期（跨日的那几个小时里，两个页面不再各说各话）');
ok(/const \{ m, d, y \} = todayMD\(\)/.test(album),
  '时光机用的是 todayMD 给的年份 —— 不再拿设备年份去和北京日期比');
ok(!/\bnow\.getFullYear\(\)/.test(album.slice(album.indexOf('buildTimeMachine'), album.indexOf('buildTimeMachine') + 1500)),
  'buildTimeMachine 里不再混用设备时间');

// ════════════════════════════════════════════════════════════
console.log('\n测试套件：audit_0803 —— ' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
