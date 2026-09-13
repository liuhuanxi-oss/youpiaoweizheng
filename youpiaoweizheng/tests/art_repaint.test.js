// tests/art_repaint.test.js —— AI 艺术重绘（品牌全案 · 稿屏5）回归测试
// 核心断言：① 图形一律走 <image src="data:image/svg+xml,...">，无内联 svg / emoji / 字符当图标；
//           ② 齿边画框的尺寸在 JS（FRAME_W/H）与 WXSS 里**同源**——两边对不上帧边就会缩在中间；
//           ③ 主/次按钮的文案由 phase 映射表下发，页面能出现的每个 phase 都有对应文案；
//           ④ 额度只在「还会花额度」的阶段露脸，作画中按钮是禁用态。
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

const wxml = read('pages/art/art.wxml');
const wxss = read('pages/art/art.wxss');
const js = read('pages/art/art.js');
const json = read('pages/art/art.json');
const icons = read('utils/icons.js');
const deco = read('utils/deco.js');

const wxmlClean = wxml.replace(/<!--[\s\S]*?-->/g, '');
const wxssClean = wxss.replace(/\/\*[\s\S]*?\*\//g, '');
const jsClean = js.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const ICONS = new Set([...icons.matchAll(/^\s{2}([a-zA-Z][\w]*):/gm)].map((m) => m[1]));
const num = (re, s) => {
  const m = re.exec(s);
  if (!m) throw new Error('取不到数值：' + re);
  return Number(m[1]);
};
/** 取某条规则块（到下一个 } 为止） */
const rule = (sel, s) => {
  const i = s.indexOf(sel + ' {');
  if (i < 0) throw new Error('找不到规则 ' + sel);
  return s.slice(i, s.indexOf('}', i));
};

// 真跑一遍 deco.js：图形是纯函数产物，直接看输出比猜正则可靠
const decoSrc = require('../utils/deco.js');
const META = {
  bg: '#F5F0E6', card: '#FFFFFF', primary: '#2B2420', accent: '#C26B5E',
  soft: '#E9E2D4', text: '#2B2420', text2: '#8A7E6E', border: '#E2D9C7'
};
// 7.4.1：data-uri 从百分号编码改成 base64（真机只认 base64，见 utils/svg.js）
const svgOf = (uri) => Buffer.from(String(uri).replace('data:image/svg+xml;base64,', ''), 'base64').toString('utf8');

console.log('\n【一、图形：不得有内联 svg / emoji / 字符当图标】');
t('wxml 正文无 <svg> / <path> / <circle>', () => {
  ok(!/<svg[\s>]/i.test(wxmlClean), '发现内联 <svg>');
  ok(!/<path[\s>]/i.test(wxmlClean), '发现内联 <path>');
  ok(!/<circle[\s>]/i.test(wxmlClean), '发现内联 <circle>');
});
t('wxml 正文无 emoji（旧版 🎟 / 🖼 / 📷 三处全部换成了线性图标）', () => {
  const m = wxmlClean.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2728}\u{2764}\u{2315}\u{2715}]/u);
  ok(!m, '残留：' + (m && m[0]));
});
t('不再用 ▶ / › / ✦ 这类字符当图标（旧付费墙就用了 ▶ 和 ›）', () => {
  ['✦', '▶', '›', '→', '✓', '★', '☆'].forEach((ch) => {
    ok(!wxmlClean.includes(ch), '残留字符：' + ch);
  });
});
t('所有 image 的 src 都绑到 JS 下发的变量上（不是写死的路径）', () => {
  const srcs = [...wxmlClean.matchAll(/<image[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]);
  ok(srcs.length >= 22, 'image 数量偏少：' + srcs.length);
  const bad = srcs.filter((s) => !/\{\{/.test(s));
  ok(bad.length === 0, '写死的图片路径：' + bad.join(', '));
});
t('本页用到的图标名都在 utils/icons.js 里注册过', () => {
  const used = [...jsClean.matchAll(/iconSrc\(\s*'([\w]+)'/g)].map((m) => m[1]);
  ok(used.length >= 6, 'iconSrc 调用偏少：' + used.length);
  used.forEach((n) => ok(ICONS.has(n), '图标未注册：' + n));
});
t('纯装饰图形都带 aria-hidden（不进无障碍树）', () => {
  const imgs = [...wxmlClean.matchAll(/<image[^>]*>/g)].map((m) => m[0]);
  const bad = imgs.filter((s) => !/aria-hidden="true"/.test(s) &&
    /class="ar-(spark|deco|sep|cap|star|stamp|frame-line|frame-sprig|foot)/.test(s));
  ok(bad.length === 0, '缺 aria-hidden：' + bad.map((b) => b.slice(0, 60)).join(' | '));
});
t('WXSS 里的十六进制只允许出现在 var(--x, #兜底) 里', () => {
  const bad = [...wxssClean.matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
    .filter((m) => !/var\([^)]*#[0-9a-fA-F]{3,8}\s*\)/.test(wxssClean.slice(Math.max(0, m.index - 40), m.index + 20)));
  ok(bad.length === 0, '裸色值：' + bad.map((b) => b[0]).join(', '));
});

console.log('\n【二、稿屏5：两张卡 + 那颗玫瑰胶囊】');
t('导航栏标题留空——标题「AI 艺术重绘」在页面里由星点 + 笔触自己画，重复一次就成了两个标题', () => {
  const title = JSON.parse(json).navigationBarTitleText;
  ok(String(title).trim() === '', '导航栏标题是「' + title + '」，会和页内标题重影');
});
t('两张卡：原票根在上、艺术重绘在下，中间是那颗带金星的分隔圆', () => {
  const iSrc = wxmlClean.indexOf('ar-card-src');
  const iSep = wxmlClean.indexOf('ar-sep');
  const iArt = wxmlClean.indexOf('ar-card-art');
  ok(iSrc > 0 && iSep > iSrc && iArt > iSep, '顺序不对：src/sep/art = ' + [iSrc, iSep, iArt].join(','));
  ok(/class="ar-tab">原票根</.test(wxmlClean), '第一张卡缺「原票根」标签');
  ok(/class="ar-tab">艺术重绘</.test(wxmlClean), '第二张卡缺「艺术重绘」标签');
  ok(/class="ar-sep-ball"/.test(wxmlClean), '分隔圆没了');
  ok(/class="ar-sep-smile"/.test(wxmlClean), '分隔圆里那道笑弧没了');
});
t('两张图都是 contain（aspectFit）——与合成导出口径一致，不裁票根', () => {
  const photo = /<image class="ar-photo-img"[^>]*mode="([\w]+)"/.exec(wxmlClean);
  const art = /<image\s+wx:if="\{\{phase === 'done'\}\}"[\s\S]{0,200}?mode="([\w]+)"/.exec(wxmlClean);
  ok(photo && photo[1] === 'aspectFit', '原票根那张用了 ' + (photo && photo[1]));
  ok(art && art[1] === 'aspectFit', '重绘那张用了 ' + (art && art[1]));
});
t('主按钮是那颗玫瑰胶囊，且随 phase 换图标（保存=托盘，作画=魔法棒）', () => {
  const cta = rule('.ar-cta', wxssClean);
  ok(/border-radius:\s*999rpx/.test(cta), '不是胶囊（圆角不是 999rpx）');
  ok(/background:\s*var\(--stamp/.test(cta), '底色不是品牌玫瑰 --stamp');
  ok(/width:\s*420rpx/.test(cta), '宽度不是 420rpx');
  ok(/ic\.download/.test(wxmlClean) && /ic\.wand/.test(wxmlClean), '主按钮的图标没跟着 phase 换');
});
t('「再画一张」两侧各一道短横（稿里那对装饰线）', () => {
  const lines = [...wxmlClean.matchAll(/class="ar-again-line"/g)].length;
  ok(lines === 2, '装饰线不是两道：' + lines);
  ok(/class="ar-again-t"/.test(wxmlClean), '缺文案节点');
});

console.log('\n【三、齿边画框：尺寸必须 JS / WXSS 同源】');
t('art.js 的 FRAME_W / FRAME_H 与 WXSS 里 .ar-frame 的宽高一致', () => {
  const fw = num(/const FRAME_W = ([\d.]+)/, js);
  const fh = num(/const FRAME_H = ([\d.]+)/, js);
  const box = rule('.ar-frame', wxssClean);
  ok(num(/width:\s*([\d.]+)rpx/, box) === fw, '宽度对不上（JS ' + fw + '）');
  ok(num(/height:\s*([\d.]+)rpx/, box) === fh, '高度对不上（JS ' + fh + '）');
  ok(/deco\.artFrame\(m, FRAME_W, FRAME_H/.test(jsClean), 'artFrame 没有拿到这两个常量');
});
t('真的渲一张框出来：viewBox 与画布同尺寸，齿孔线落在框内', () => {
  const fw = num(/const FRAME_W = ([\d.]+)/, js);
  const fh = num(/const FRAME_H = ([\d.]+)/, js);
  const svg = svgOf(decoSrc.artFrame(META, fw, fh, '#E2B85C'));
  ok(svg.indexOf("viewBox='0 0 " + fw + ' ' + fh + "'") >= 0, 'viewBox 不是 ' + fw + '×' + fh + '：' + svg.slice(0, 120));
  const d = /d="([^"]+)"/.exec(svg);
  ok(d, '齿边 path 没生成');
  const pts = d[1].replace(/^M/, '').replace(/Z$/, '').split('L').map((p) => p.split(' ').map(Number));
  ok(pts.length > 100, '齿太稀：只有 ' + pts.length + ' 个点');
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  ok(Math.min(...xs) >= 0 && Math.min(...ys) >= 0, '齿戳出画布左上：' + Math.min(...xs) + ',' + Math.min(...ys));
  ok(Math.max(...xs) <= fw && Math.max(...ys) <= fh, '齿戳出画布右下：' + Math.max(...xs) + ',' + Math.max(...ys));
});
t('画芯让开齿孔（不压线、也不悬在空格里）', () => {
  const pinkInset = num(/pinkedPath\(w, h, [\d.]+, [\d.]+, ([\d.]+)\)/, deco);
  const box = rule('.ar-art-img', wxssClean);
  const left = num(/left:\s*([\d.]+)rpx/, box);
  const right = num(/width:\s*([\d.]+)rpx/, box);
  const fw = num(/const FRAME_W = ([\d.]+)/, js);
  ok(left >= pinkInset, '画芯左边距 ' + left + 'rpx 压到齿孔（齿内缩 ' + pinkInset + '）');
  ok(left + right <= fw - pinkInset, '画芯右边超出齿孔线');
});
t('花邮票单独出图（48×48 方形，与框同一套走齿逻辑）', () => {
  ok(/flowerStamp/.test(deco), 'deco.js 没导出 flowerStamp');
  ok(/deco\.flowerStamp\(/.test(jsClean), '页面没用上花邮票');
  const svg = svgOf(decoSrc.flowerStamp(Object.assign({}, META, { petal: '#E8AFA8', center: '#E8B85C' })));
  ok(svg.indexOf("viewBox='0 0 48 48'") >= 0, '花邮票 viewBox 不是 48×48');
  ok((svg.match(/<ellipse/g) || []).length === 6, '花瓣不是六瓣（一朵六瓣花 + 各自旋转）');
});

console.log('\n【四、按钮文案：页面能出现的每个 phase 都得有话说】');
t('三个早退状态（lost / empty / loading）各自有独立视图，不该落到主界面上', () => {
  ['lost', 'empty', 'loading'].forEach((p) => {
    ok(new RegExp("phase === '" + p + "'").test(wxmlClean), '缺 ' + p + ' 的早退分支');
  });
});
t('剩下能走到主按钮的每个 phase 都在 ctaText / subText 里有文案', () => {
  const EARLY = ['lost', 'empty', 'loading'];
  const phases = new Set([...js.matchAll(/phase:\s*'([a-z]+)'/g)].map((m) => m[1]));
  [...js.matchAll(/setData\(\{\s*phase:\s*'([a-z]+)'/g)].forEach((m) => phases.add(m[1]));
  const live = [...phases].filter((p) => EARLY.indexOf(p) === -1).sort();
  ok(live.length >= 4, '能走到主按钮的 phase 偏少：' + live.join(','));
  const ctaBlock = /\n    ctaText:\s*\{([\s\S]*?)\n    \}/.exec(js);
  const subBlock = /\n    subText:\s*\{([\s\S]*?)\n    \}/.exec(js);
  ok(ctaBlock && subBlock, '找不到 ctaText / subText 映射表');
  live.forEach((p) => {
    ok(new RegExp('\\b' + p + ':').test(ctaBlock[1]), 'ctaText 缺 phase：' + p);
    ok(new RegExp('\\b' + p + ':').test(subBlock[1]), 'subText 缺 phase：' + p);
  });
});
t('主按钮按 phase 分流：画完 = save，没画 = start，作画中空转', () => {
  const fn = /onCta\(\)\s*\{([\s\S]*?)\n  \}/.exec(jsClean);
  ok(fn, '找不到 onCta');
  ok(/===\s*'done'[\s\S]{0,30}return this\.save\(\)/.test(fn[1]), 'done 没走 save()');
  ok(/'idle'[\s\S]{0,60}return this\.start\(\)/.test(fn[1]), 'idle 没走 start()');
  ok(/failed/.test(fn[1]), 'failed 没接上（失败后主按钮应能重试）');
});
t('作画中主按钮是禁用态（点它不该再发一次生图请求）', () => {
  ok(/ar-cta[\s\S]{0,80}phase === 'running'[^}]*\? 'dis'/.test(wxmlClean), '主按钮没有 dis 禁用态');
  const dis = rule('.ar-cta.dis', wxssClean);
  ok(/opacity/.test(dis), '禁用态没有视觉差异');
});
t('次按钮：画完是「再画一张」，其余是「返回详情」', () => {
  const fn = /onSub\(\)\s*\{([\s\S]*?)\n  \}/.exec(jsClean);
  ok(fn, '找不到 onSub');
  ok(/phase === 'done'[\s\S]{0,40}return this\.again\(\)/.test(fn[1]), 'done 没走 again()');
  ok(/return this\.goBack\(\)/.test(fn[1]), '其余状态没走 goBack()');
});

console.log('\n【五、额度与付费墙】');
t('额度条只在「还会花额度」的阶段露脸，画完就不占位', () => {
  ok(/ar-quota" wx:if="\{\{phase !== 'done'\}\}"/.test(wxmlClean), '额度条的 wx:if 不是「非 done」');
});
t('额度显示仍是三格印章 + 文案（旧版的可视化没丢）', () => {
  ok(/quotaPips/.test(jsClean) && /ar-pip/.test(wxmlClean), '印章格可视化丢了');
  ok(/quotaLabel/.test(wxmlClean), '额度文案丢了');
});
t('付费墙还在（变现链路不是这次改版能省的），且视频/购买两条出路都在', () => {
  ok(/<bottom-sheet/.test(wxmlClean), '付费墙被删了');
  ok(/watchForReward/.test(wxmlClean), '激励视频出路没了');
  ok(/_buyFromWall/.test(wxmlClean), '次数包购买出路没了');
  ok(/privacy-sheet/.test(wxmlClean), '隐私授权弹窗组件没了');
});
t('保存链路没被动过：合成 → canvasToTempFilePath → 存相册 → 埋点', () => {
  ok(/_compose\(\)/.test(jsClean), '_compose 没了');
  ok(/wx\.canvasToTempFilePath/.test(jsClean), '导出没了');
  ok(/wx\.saveImageToPhotosAlbum/.test(jsClean), '存相册没了');
  ok(/track\.track\('art_save'/.test(jsClean), 'art_save 埋点没了');
  ok(/id="art-canvas"/.test(wxmlClean), '合成用的隐藏画布没了');
});
t('画布仍在滚动容器里也点得到（canvas 不能被 wx:if 包住）', () => {
  ok(/<canvas type="2d" id="art-canvas"/.test(wxmlClean), '取不到 canvas 节点');
});

console.log('\n测试套件：art_repaint —— ' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
