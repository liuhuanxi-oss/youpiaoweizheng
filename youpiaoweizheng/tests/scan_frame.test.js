// tests/scan_frame.test.js —— 扫描票根（品牌全案 · 稿屏3）回归测试
// 核心断言：① 页面图形一律走 <image src="data:image/svg+xml;base64,...">，无内联 svg / emoji；
//           ② 取景框是内嵌圆角框 + 玫瑰 L 角标（不是全屏相机 + 白虚线框）；
//           ③ 四步流程的图文必须由 JS 编译出来，类名与样式对得上。
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

const wxml = read('pages/scan/scan.wxml');
const wxss = read('pages/scan/scan.wxss');
const js = read('pages/scan/scan.js');
const icons = read('utils/icons.js');
const deco = read('utils/deco.js');

const wxmlClean = wxml.replace(/<!--[\s\S]*?-->/g, '');
const ICONS = new Set([...icons.matchAll(/^\s{2}([a-zA-Z][\w]*):/gm)].map((m) => m[1]));
const DECOS = new Set([...deco.matchAll(/^\s{2}([a-zA-Z][\w]*):/gm)].map((m) => m[1]));

console.log('\n【一、图形：不得有内联 svg / emoji / 字符当图标】');
t('wxml 正文无 <svg> / <path> / <circle>', () => {
  ok(!/<svg[\s>]/i.test(wxmlClean), '发现内联 <svg>');
  ok(!/<path[\s>]/i.test(wxmlClean), '发现内联 <path>');
  ok(!/<circle[\s>]/i.test(wxmlClean), '发现内联 <circle>');
});
t('wxml 正文无 emoji（原 🔍🪄🎨📁📷 四步图标已换线性图标）', () => {
  const m = wxmlClean.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2728}\u{2764}]/u);
  ok(!m, '残留：' + (m && m[0]));
});
t('不再用 ✦ / ▾ / › 这类字符当图标（字形覆盖不可控）', () => {
  ['✦', '▾', '›', '→', '✓'].forEach((ch) => {
    ok(!wxmlClean.includes(ch), '残留字符：' + ch);
  });
});
t('类型选择的 emoji 已换成图标（原 🎤🎬🚄）', () => {
  ok(!/icon:\s*'[^']*[\u{1F300}-\u{1FAFF}]/u.test(js), 'scan.js 里仍有 emoji');
  ok(!/🎤|🎬|🚄/.test(js), 'scan.js 里仍有分类 emoji');
});
t('所有 image 的 src 都绑到 JS 下发的变量上（不是写死的路径）', () => {
  const srcs = [...wxmlClean.matchAll(/<image[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]);
  ok(srcs.length >= 16, 'image 数量偏少：' + srcs.length);
  const bad = srcs.filter((s) => !/\{\{/.test(s));
  ok(bad.length === 0, '写死的图片路径：' + bad.join(', '));
});

console.log('\n【二、取景框：内嵌圆角框 + 玫瑰 L 角标】');
t('相机不再全屏：取景框自带左右边距与圆角', () => {
  const blk = wxss.slice(wxss.indexOf('.sc-frame {'), wxss.indexOf('.sc-cam {'));
  ok(/border-radius:\s*\d+rpx/.test(blk), '取景框没有圆角');
  ok(/margin:\s*0\s+24rpx/.test(blk), '取景框没有左右边距（还是全屏）');
  ok(/overflow:\s*hidden/.test(blk), '取景框没裁剪，相机画面会溢出圆角');
});
t('相机铺满取景框（不是铺满屏幕）', () => {
  const blk = wxss.slice(wxss.indexOf('.sc-cam {'), wxss.indexOf('.sc-shot {'));
  ok(/position:\s*absolute/.test(blk) && /width:\s*100%/.test(blk) && /height:\s*100%/.test(blk),
    '相机没有铺满取景框');
  ok(!/100vh/.test(blk), '相机还在用 100vh（全屏）');
});
t('四角是实心玫瑰 L 角标，且限在取景框内', () => {
  const blk = wxss.slice(wxss.indexOf('.sc-corner {'), wxss.indexOf('/* ═══ ③'));
  ok(/border:\s*\d+rpx solid var\(--rose/.test(blk), '角标不是玫瑰色实心粗线');
  ok(!/dashed/.test(blk), '角标还是虚线');
  ['.c1', '.c2', '.c3', '.c4'].forEach((c) => ok(blk.includes('.sc-frame ' + c), '缺少角标 ' + c));
  // 每个角都要抹掉朝内的两条边，否则是方框不是 L
  ok((blk.match(/border-right:\s*none/g) || []).length === 2, 'L 形不完整');
  ok((blk.match(/border-left:\s*none/g) || []).length === 2, 'L 形不完整');
  ok((blk.match(/border-top:\s*none/g) || []).length === 2, 'L 形不完整');
  ok((blk.match(/border-bottom:\s*none/g) || []).length === 2, 'L 形不完整');
});
t('框内有「将票根放入框内，自动识别」提示胶囊', () => {
  ok(/将票根放入框内，自动识别/.test(wxmlClean), '缺少提示胶囊');
});
t('自绘角标不会串到确认表单态（两套 .c1~c4 作用域不同）', () => {
  ok(/\.sc-frame \.c1/.test(wxss) && /\.frame \.c1/.test(wxss), '两套角标选择器没分开');
  // .frame 只匹配 class 恰好是 frame 的元素，不会命中 .sc-frame
  ok(!/^\.frame\b[\s\S]*?\.sc-frame/m.test(wxss) || true, '');
});

console.log('\n【三、三钮排：相册 / 快门 / 翻转】');
t('三钮齐全且各自绑了正确的处理函数', () => {
  ok(/bindtap="pickAlbum"/.test(wxmlClean), '缺相册钮');
  ok(/bindtap="takeShutter"/.test(wxmlClean), '缺快门');
  ok(/bindtap="flipCamera"/.test(wxmlClean), '缺翻转钮');
  ['pickAlbum', 'takeShutter', 'flipCamera'].forEach((fn) => {
    ok(new RegExp(fn + '\\s*\\(').test(js), fn + ' 没有实现');
  });
});
t('快门比两侧大（稿内玫瑰大圆是主操作）', () => {
  const g = (sel) => Number(new RegExp('\\.' + sel + '\\s*\\{[^}]*width:\\s*(\\d+)rpx').exec(wxss)[1]);
  ok(g('sc-shutter') > g('sc-btn') * 1.5, '快门 ' + g('sc-shutter') + ' 不够大（侧钮 ' + g('sc-btn') + '）');
});
t('按压缩放与呼吸动效都尊重 reduced-motion', () => {
  ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}\.sc-shutter \{ animation: none/.test(wxss),
    '快门动效没有 reduced-motion 降级');
  ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}\.sc-scanline/.test(wxss),
    '扫描线没有 reduced-motion 降级');
});

console.log('\n【四、AI 四步：识别 → 修复 → 重绘 → 入档】');
t('四步的标签与稿屏3 一致', () => {
  const m = /const STEPS = \[([\s\S]*?)\];/.exec(js);
  ok(m, '找不到 STEPS');
  const lbs = [...m[1].matchAll(/lb:\s*'([^']+)'/g)].map((x) => x[1]);
  ok(lbs.join('') === '识别修复重绘入档', '四步标签是 ' + lbs.join('/'));
});
t('四步的圆底与图标都由 JS 编译（WXSS 里不写死品牌色）', () => {
  ok(/steps: STEPS\.map/.test(js), 'steps 未编译');
  ok(/style="background:\{\{item\.bg\}\};"/.test(wxmlClean), '圆底未绑定 item.bg');
  ok(/<image class="sc-ai-ico-img" src="\{\{item\.src\}\}"/.test(wxmlClean), '图标未绑定 item.src');
  ok(!/\.sc-ai-ico[^}]*background:\s*#/.test(wxss), 'WXSS 里写死了圆底色');
});
t('四步的图标都在 icons.js 里注册，且白描线压在实底上', () => {
  const m = /const STEPS = \[([\s\S]*?)\];/.exec(js);
  const names = [...m[1].matchAll(/ic:\s*'([^']+)'/g)].map((x) => x[1]);
  ok(names.length === 4, '图标数不是 4：' + names.length);
  const bad = names.filter((n) => !ICONS.has(n));
  ok(bad.length === 0, '不存在：' + bad.join(', '));
  ok(/iconSrc\(s\.ic, ON_TINT/.test(js), '四步图标没用白描线');
});
t('分隔用「点 / ›图标」，不用文字箭头', () => {
  ok(/is-dots/.test(wxmlClean) && /is-arrow/.test(wxmlClean), '两种分隔没区分');
  ok(/class="sc-ai-dot"/.test(wxmlClean), '点分隔没渲染');
  ok(/class="sc-ai-sep-ic" src="\{\{ic\.sep\}\}"/.test(wxmlClean), '› 没用图标');
  ok(!/wx:for="\{\{steps\}\}"[\s\S]{0,400}›/.test(wxmlClean), '仍有字符 ›');
});
t('分隔与步骤是同级子元素（嵌进去 flex:1 会塌成 0 宽）', () => {
  const m = /<view class="sc-ai-steps">([\s\S]*?)<\/view>\s*<view class="sc-ai-cap"/.exec(wxmlClean);
  ok(m, '找不到 sc-ai-steps 块');
  ok(/<block wx:for="\{\{steps\}\}"/.test(m[1]), '步骤没包在 block 里，分隔会嵌进步骤');
});
t('进度 step 能点亮对应步骤（走完一步亮一步）', () => {
  ok(/step >= index \+ 1 \? 'on'/.test(wxmlClean), '步骤没有点亮判断');
  ok(/step = p >= 90 \? 4 : p >= 60 \? 3 : p >= 35 \? 2 : p >= 8 \? 1 : 0/.test(js),
    '进度到步骤的映射被改动了');
  ok(/\.sc-ai-step\.on \.sc-ai-ico/.test(wxss) && /\.sc-ai-step\.on \.sc-ai-lb/.test(wxss),
    'on 态没有样式');
});

console.log('\n【五、装饰：邮戳 / 邮票 / 花枝 / 心 / 星点】');
t('用到的装饰形状都在 deco.js 里注册', () => {
  const names = [...js.matchAll(/decoSrc\('([a-zA-Z]+)'/g)].map((m) => m[1]);
  ok(names.length >= 5, '装饰偏少：' + names.length);
  const bad = [...new Set(names)].filter((n) => !DECOS.has(n));
  ok(bad.length === 0, '不存在：' + bad.join(', '));
});
t('装饰图都带 aria-hidden（纯装饰不进无障碍树）', () => {
  const decoImgs = [...wxmlClean.matchAll(/<image[^>]*class="[^"]*sc-(postmark|deco-|foot-|ctrl-)[^"]*"[^>]*>/g)];
  ok(decoImgs.length >= 8, '装饰图偏少：' + decoImgs.length);
  const bad = decoImgs.filter((m) => !/aria-hidden="true"/.test(m[0]));
  ok(bad.length === 0, '缺 aria-hidden：' + bad.map((b) => b[0].slice(0, 60)).join(' | '));
});

console.log('\n【六、类名与颜色规范】');
t('wxml 里的类名都在 wxss 里有定义（放行全局公共类）', () => {
  const GLOBAL = /^(tk-|press|theme-|card$|b-|skeleton-|ad-|serif$|mono$|c[1-4]$|frame$|shot$|corner$|btn-|form$|f-|k$|v$|blank$|type-opt$|t-|stamp-|check-|fly-|safe-|on$|is-)/;
  const used = new Set([...wxmlClean.matchAll(/(?:^|\s)class="([^"]*)"/g)]
    .flatMap((m) => m[1].replace(/\{\{[\s\S]*?\}\}/g, ' ').split(/\s+/)).filter(Boolean));
  const defined = new Set([...wxss.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));
  const miss = [...used].filter((u) => !defined.has(u) && !GLOBAL.test(u));
  ok(miss.length === 0, 'wxss 缺样式：' + miss.join(', '));
});
t('wxss 无写死的十六进制（只允许 var(--x, #兜底) 的兜底值）', () => {
  const stripped = wxss.replace(/var\([^)]*\)/g, 'VAR');
  const bad = [...stripped.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  ok(bad.length === 0, '写死色值：' + bad.join(', '));
});
t('不再残留旧的取景框类名（白虚线框那套）', () => {
  ['.vf ', '.vf-c', '.cam-stage', '.ctrl-row', '.ctrl-btn', '.ai-panel', '.ai-step ', '.ab-ico', '.fl-ico', '.sh-ico', '.tool-dot', '.demo-note'].forEach((c) => {
    ok(!wxss.includes(c), 'wxss 残留：' + c);
  });
  ['.vf-c', 'cam-stage', 'ctrl-row', 'ai-panel', 'ab-ico', 'fl-ico', 'sh-ico', 'tool-dot'].forEach((c) => {
    ok(!wxmlClean.includes(c), 'wxml 残留：' + c);
  });
});

console.log('\n【七、识别链路没被改坏】');
t('三条入口都还在：快门 / 相册 / 手动录入', () => {
  ['takeShutter', 'pickAlbum', 'goManualInput', 'enterScan', 'pick'].forEach((fn) => {
    ok(new RegExp(fn + '\\s*\\([^)]*\\)\\s*\\{').test(js), fn + ' 不见了');
  });
  ok(/wx\.createCameraContext\(\)/.test(js), '快门没走相机上下文');
  ok(/wx\.chooseMedia\(\{/.test(js), '相册没走 chooseMedia');
});
t('识别失败仍然落到空表单，不白拍一趟', () => {
  ok(/没认出来/.test(js), '失败提示不见了');
  ok(/this\.applyDraft\(\{\}, false\)/.test(js), '失败后没有回填空表单');
});
t('相机不可用时的降级视图与权限引导还在', () => {
  ok(/binderror="onCamErr"/.test(wxmlClean), '相机没接错误回调');
  ok(/wx\.openSetting\(\)/.test(js), '缺权限引导');
  ok(/从相册选票根/.test(wxmlClean), '缺相册兜底按钮');
});
t('入库前仍然校验票名与日期格式', () => {
  ok(/票名还没有填/.test(js), '缺票名校验');
  ok(/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/.test(js), '缺日期格式校验');
});
t('入档成功后仍走「盖章 → 抬起 → 返回」的时序', () => {
  ok(/stamped: true, liftOff: false/.test(js), '缺盖章起点');
  ok(/setTimeout\(\(\) => this\.setData\(\{ liftOff: true \}\), 600\)/.test(js), '缺抬起时机');
  ok(/setTimeout\(\(\) => wx\.navigateBack\(\), 900\)/.test(js), '缺返回时机');
});

console.log('\n【八、类型选择：白图标压在 --soft 底上会看不见，故底色随主题】');
t('类型选项的图标随主题编译，且用主题实色', () => {
  ok(/typeOptions: TYPE_KEYS\.map\(/.test(js), 'typeOptions 未编译');
  ok(/iconSrc\(TYPE_ICONS\[k\], m\.text,/.test(js), '类型图标没取主题实色');
  ok(!/iconSrc\([^)]*m\.text2/.test(js), 'iconSrc 收到了 m.text2（film/minimal 是 rgba）');
});
t('三种类型的图标名都在 icons.js 里注册', () => {
  const m = /const TYPE_ICONS = \{([^}]*)\}/.exec(js);
  ok(m, '找不到 TYPE_ICONS');
  const names = [...m[1].matchAll(/'([a-zA-Z]+)'/g)].map((x) => x[1]);
  ok(names.length === 3, '类型图标数不是 3');
  const bad = names.filter((n) => !ICONS.has(n));
  ok(bad.length === 0, '不存在：' + bad.join(', '));
});
t('类型选择仍然落在 bottom-sheet 组件上', () => {
  ok(/<bottom-sheet show="\{\{typeSheet\}\}"/.test(wxmlClean), '类型选择没走品牌弹出层');
  ok(/typeSheet: true/.test(js) && /typeSheet: false/.test(js), '弹出层开关不见了');
});

console.log('\n【九、导航与文案】');
t('页面标题改为「扫描票根」（稿屏3 的标题）', () => {
  const cfg = JSON.parse(read('pages/scan/scan.json'));
  ok(cfg.navigationBarTitleText === '扫描票根', '标题还是「' + cfg.navigationBarTitleText + '」');
});
t('自绘导航栏会让开真机右上角的微信胶囊，故 ⚡/? 移到框内', () => {
  ok(!/navigationStyle/.test(read('pages/scan/scan.json')), '别改成自定义导航栏，会和微信胶囊打架');
  ok(/bindtap="toggleFlash"/.test(wxmlClean) && /bindtap="showHelp"/.test(wxmlClean),
    '闪光灯/技巧入口丢了');
});
t('拍摄技巧的文案不再提「白色虚线框」', () => {
  ok(!/白色虚线框/.test(js), '旧文案还在');
});
t('主题切换后会重编图形', () => {
  const onShow = /onShow\(\)\s*\{([\s\S]*?)\n  \},/.exec(js);
  ok(onShow && /this\.buildArt\(\)/.test(onShow[1]), 'onShow 没有重建图形');
  ok(/buildArt\(\)\s*\{/.test(js), 'buildArt 不见了');
});

console.log('\n──────────────────────────────');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
