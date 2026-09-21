// tests/checkin_layout.test.js —— 「我的」页时光签卡的排版（8.3.0 重做）
// 这次改的起因不是「不好看」，是**同一句话说好几遍**：
//   改前一张卡里「今天已收下」出现两次（标题 + 状态）、「连签 9 天」出现三次
//   （标题旁 + 副词 + 状态行），而「积分怎么来」左对齐孤零零占一行，像没写完。
// 结构定成四行：标题行 / 积分主行 / 操作行 / 页脚。下面每条都在守这个结构，
// 谁再往里塞第五行、或者把状态文案又抄一份回标题，必须红。
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
const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const wxml = strip(read('pages/me/me.wxml'));
const wxss = strip(read('pages/me/me.wxss'));
const sign = strip(read('utils/sign.js'));

const rule = (sel, s) => {
  const i = s.indexOf(sel + ' {');
  if (i < 0) throw new Error('找不到规则 ' + sel);
  return s.slice(i, s.indexOf('}', i));
};
const block = (sel) => {
  const i = wxml.indexOf('class="' + sel);
  if (i < 0) throw new Error('wxml 里找不到 .' + sel);
  return wxml.slice(i, wxml.indexOf('</view>', wxml.lastIndexOf('</view>', i + 1200)));
};

console.log('\n【一、每件事只说一遍：状态文案不再重复】');
t('标题固定写「时光签」，不再由 signText.title 决定', () => {
  const head = block('me-sign-head');
  ok(/时光签/.test(head), '标题不是「时光签」了');
  ok(!/signText\.title/.test(wxml), 'signText.title 又回来了 —— 它是状态文案（今天已收下），会和操作行的状态撞车');
});
t('卡片里「今天已收下」只出现一次', () => {
  const n = (wxml.match(/今天已收下/g) || []).length;
  ok(n === 1, '「今天已收下」出现了 ' + n + ' 次 —— 一处就够');
});
t('bannerText 的 sub 里不再带「连签 N 天」', () => {
  const fn = /function bannerText\(s\)\s*\{[\s\S]*?\n\}/.exec(sign);
  ok(fn, '找不到 bannerText');
  ok(!/连签 \$\{streak\} 天/.test(fn[0]) && !/已连签/.test(fn[0]),
    'sub 又在说连签天数了 —— 卡片标题旁那枚胶囊已经在说，同一屏说两遍就是啰嗦');
});
t('连签天数只由 sign.streak 给（文案里不夹带一份）', () => {
  ok(/signText\.sub/.test(wxml) || /signText\.btn/.test(wxml), '卡片没用 signText —— 文案该由 utils/sign.js 统一给');
  const sub = /sub:\s*(['"`])([^'"`]*)\1/.exec(sign.replace(/sub:\s*base[\s\S]*?积分`,/g, "sub: ''"));
  ok(!sub || !/\d/.test(sub[2]), 'sub 里写死了数字：' + (sub && sub[2]));
});

console.log('\n【二、四行结构：标题 / 积分 / 操作 / 页脚】');
t('四行都在，且只有这四行', () => {
  ['me-sign-head', 'me-sign-main', 'me-sign-foot', 'me-sign-rule'].forEach((c) => {
    ok(new RegExp('class="' + c + ' ').test(wxml) || new RegExp('class="' + c + '"').test(wxml), '少了 ' + c);
  });
  const n = (wxml.match(/class="me-sign-(head|main|foot|rule)[ "]/g) || []).length;
  ok(n === 4, '行数变成 ' + n + ' 了 —— 结构定的是四行');
});
t('积分是主行，数字比标题大', () => {
  const num = Number(/font-size:\s*([\d.]+)rpx/.exec(rule('.me-sign-num', wxss))[1]);
  const title = Number(/font-size:\s*([\d.]+)rpx/.exec(rule('.me-sign-t', wxss))[1]);
  ok(num > title * 1.5, `积分数字 ${num}rpx 没有明显大过标题 ${title}rpx —— 主次就没了`);
});
t('「这分能干嘛」一句话右对齐，不再单占半行', () => {
  const h = rule('.me-sign-hint', wxss);
  ok(/text-align:\s*right/.test(h), '提示文字没有右对齐');
  ok(/flex:\s*1/.test(h), '提示文字没有吃掉剩余宽度 —— 会挤在数字旁边');
});
t('未签到时提示说「今天能得多少」，签过了说「还差多少」', () => {
  ok(/\{\{signText\.btn \? signText\.sub : pointsHint\}\}/.test(wxml.replace(/\s+/g, ' ')),
    '主行没有按「今天收不收」切换文案 —— 签到的人看到「再收一张得几分」是句废话（今天已经收不了了）');
});

console.log('\n【三、操作行：一张卡里只留一个实心按钮】');
t('兑换是描边次要按钮，不是第二个实心按钮', () => {
  const ex = rule('.me-sign-exchange', wxss);
  ok(/border:\s*1rpx solid/.test(ex), '兑换没有描边 —— 两个实心按钮会互相抢');
  ok(/background:\s*transparent/.test(ex), '兑换还是实心底 —— 主按钮就不突出了');
});
t('主按钮（收下）仍是实心', () => {
  ok(/background:\s*var\(--stamp/.test(rule('.me-sign-btn', wxss)), '主按钮丢了实心底');
});
t('已收下不是按钮，是「已完成」标签 + 明天再来', () => {
  ok(/me-sign-done-t/.test(wxml) && /me-sign-done-s/.test(wxml), '已收下少了标签或副句');
  ok(!/class="me-sign-done pressable"/.test(wxml), '已收下又变成可点的了 —— 今天点不动，别做成按钮');
});

console.log('\n【四、页脚：右对齐 + 箭头】');
t('「积分怎么来」靠右，并带一个箭头', () => {
  ok(/justify-content:\s*flex-end/.test(rule('.me-sign-rule', wxss)), '页脚没有右对齐 —— 左对齐孤零零一行像没写完');
  ok(/me-sign-rule-a/.test(wxml), '页脚少了箭头');
  // 箭头必须是 icons.js 的图形，不能写字符 ›（真机字形覆盖不可控，icon_purity 会拦）
  ok(/ic\.chevron/.test(wxml), '页脚箭头没走 utils/icons.js 的 chevron');
  ok(!/›/.test(wxml), '页脚又写成字符 › 了 —— icon_purity.test.js 会把关失败');
});

console.log('\n【五、样子：连签是胶囊，不是一行灰字】');
t('连签有软底和圆角', () => {
  const s = rule('.me-sign-streak', wxss);
  ok(/background:\s*var\(--soft/.test(s), '连签没有软底');
  ok(/border-radius/.test(s), '连签没有圆角');
  ok(/me-sign-streak-n/.test(wxml), '连签数字没有单独包一层 —— 数字该比「连签/天」大一号');
});

console.log('\n\n测试套件：checkin_layout —— ' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
