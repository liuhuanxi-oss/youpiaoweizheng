// tests/ocr_channel.test.js —— 识别云函数只走微信这一条通道（2026-09-21 去百度）
// ============================================================
// 【为什么要有这个文件】
//   4.9.0 给 recognizeTicket 并了一条百度智能云「通用文字识别」通道，密钥留在文件顶部
//   两个空串里等运营填。三年里它一次都没启用过（密钥始终为空），却把整条链路撑成了
//   双通道：多一个 https 依赖、多一份 access_token 缓存、多一段只在「密钥被填上那天」
//   才会跑起来的代码。没跑过的代码 = 没验证过的代码，而它偏偏在 OCR 主通路上。
//   2026-09-21 按用户决定删掉：OCR 只用微信云调用。
//
// 【钉的是什么】
//   ① 百度那一整套（常量 / httpsPost / token 缓存 / baiduOcr）不得复活；
//   ② 主流程只剩一次 wxOcr 调用，失败时仍给人话（不是原始 errMsg）；
//   ③ 「谁在调、一天调几次」这两道闸不能被顺手删掉 —— 它们是 OCR 唯一的成本护栏。
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

const src = read('cloudfunctions/recognizeTicket/index.js');
// 去掉注释再查：来历说明（「4.9.0 曾并过一条百度通道…」）要留着，代码里不许有。
const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

console.log('\n【一、百度通道已整体删除】');
t('代码里没有 baidu / BAIDU_OCR / aip.baidubce.com', () => {
  ok(!/baidu/i.test(code), '代码里仍有百度残留');
  ok(!/aip\.baidubce\.com/.test(code), '代码里仍有百度 OCR 的域名');
});
t('不再依赖 https 模块（它只为百度通道存在）', () => {
  ok(!/require\('https'\)/.test(code), '还 require 着 https');
});
t('没有孤零零留下的 access_token 缓存代码', () => {
  ok(!/_bdToken|baiduToken/.test(code), '百度 token 缓存的痕迹还在');
});
t('来历写在注释里（删了功能不等于抹掉历史）', () => {
  ok(/百度/.test(src), '注释里连「为什么删」都没留，下次有人会再加一遍');
});

console.log('\n【二、主流程只剩一条通道，且失败给人话】');
t('恰好调用一次 wxOcr', () => {
  const n = (code.match(/await wxOcr\(/g) || []).length;
  ok(n === 1, 'wxOcr 调用点是 ' + n + ' 个，应当只有 1 个');
});
t('没有 hasBaidu 这类分支残留', () => {
  ok(!/hasBaidu/.test(code), '还留着判断百度密钥的开关');
});
t('通道报错时不把原始 errMsg 直接甩给用户', () => {
  // 8.0.4 的教训：云调用的 errMsg 是 `cloud.callFunction:fail …` 这种，用户看了只会
  // 以为 App 坏了。原始串进日志，端上只给人话。
  ok(/msg: 'OCR 识别失败/.test(code), '识别失败没有兜底文案');
  ok(/没有识别到文字/.test(code), '「图里确实没字」和「通道出错」没有分开说');
});
t('识别异常只进日志，端上回一句人话', () => {
  ok(/console\.error\('\[ocr\] 识别异常'/.test(code), '异常细节没有落日志');
  ok(/msg: '识别服务出了点问题/.test(code), '异常没有给用户兜底文案');
});

console.log('\n【三、成本护栏不能被顺手删掉】');
t('仍然要求调用方是小程序端用户（OPENID 闸门）', () => {
  ok(/cloud\.getWXContext\(\)/.test(code), '没取 OPENID');
  ok(/请在小程序内使用识别功能/.test(code), 'OPENID 闸门没了 —— 脚本可以直接刷');
});
t('仍然有每人每日次数上限', () => {
  ok(/OCR_DAILY_LIMIT/.test(code), '日限额没了');
  ok(/claimDailyQuota/.test(code), '原子抢占没了 —— 并发会把日限额放大成 N 倍');
});
t('fileID 白名单正则还在', () => {
  ok(/fileID 格式不合法/.test(code), 'fileID 白名单没了');
});

console.log('\n──────────────────────────────');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
