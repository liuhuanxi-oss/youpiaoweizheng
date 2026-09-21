// utils/font.js —— 自定义字体加载（8.2.0 起）
// ============================================================
// 品牌稿用的是「圆润手写感标题 + 清爽黑体正文」，系统字体给不了这个味道：
//   · Songti SC 只有 iOS 有，安卓不预装，安卓用户看到的永远是默认黑体
//   · 开发工具在 Windows 上回落到 SimSun（中易宋体），又细又糙，离稿子最远
// 所以必须自带字体文件，靠 wx.loadFontFace 挂上去。
//
// 【字体从哪来】两个文件都放在服务器上，改域名只需要动下面 FONT_BASE 一行。
//   ypwz-title.woff2  霞鹜文楷 Screen  子集化到 4034 字   约 1003 KB
//   ypwz-body.woff2   思源黑体 SC      子集化到 5948 字   约  807 KB
// 子集化范围 = GB2312 全部汉字 + 源码里出现的全部汉字 + 标点/全角/ASCII。
// 票名、昵称这类用户输入的字基本都在里面；偶有生僻字会自然回落系统字体，
// 所以 CSS 里的字体栈必须留系统字体兜底（见 app.wxss 的 --font-title-full）。
//
// 【为什么正文体默认不开】见 ENABLE_BODY 那段注释。
//
// 【失败会怎样】加载失败什么都不影响 —— wx.loadFontFace 只是把字体挂进渲染层，
// 挂不上就继续用 CSS 字体栈里的系统字体。绝不会白屏，绝不会卡住启动。
// ============================================================

// ⚠️ 换服务器只改这一行（结尾必须有斜杠）
// 这里指向**云开发自带的静态网站托管**（腾讯云，跟云函数同一个环境 cloud1-d5gpnyzjw64a60ac7）。
// 文件是 scripts/ci/upload-fonts.js 传上去的，重传/换域名都跑那个脚本，它会把这行该写什么打出来。
// 这个域名还必须加进微信后台的「downloadFile 合法域名」，否则真机上加载会被拦掉
//   —— 拦掉的表现就是**悄无声息地回落系统字体**，不报错、不白屏，很难发现。
const FONT_BASE = 'https://cloud1-d5gpnyzjw64a60ac7-1481239884.tcloudbaseapp.com/ypwz/fonts/';

// 正文体开关。默认关：
//   正文体 807 KB，而它要替换的苹方（PingFang SC）本身就是人文风无衬线，
//   两者在 28rpx 的正文字号下肉眼几乎分不出来 —— 花 807 KB 换这点差别不划算，
//   而且每次冷启动都要把字重刷一遍（先系统字体、后自定义，会看到一次字形跳变）。
//   真要开，把下面改成 true 即可，其余什么都不用动。
//   注意：设计稿大概率就是在 Mac 上用苹方排的正文，所以苹果设备上"不换"反而更接近稿子。
const ENABLE_BODY = false;

const FACES = [
  {
    family: 'YPWZTitle',
    file: 'ypwz-title.woff2',
    on: true
  },
  {
    family: 'YPWZBody',
    file: 'ypwz-body.woff2',
    on: ENABLE_BODY
  }
];

let _booted = false;

// ============================================================
// 画布用的字体串 —— 海报 / 卡片 / 年报 / 藏品图版这些**导出成图片**的东西，
// 全靠这一个常量接到品牌字体上。
//
// 为什么必须单独来一份：`ctx.font` **不认 CSS 变量**，也**不走 app.wxss 的字体栈**，
// 只能把族名当字符串拼进去。页面上 `var(--font-title-full)` 生效、导出图里却是系统字体，
// 根子就在这儿 —— 图片是画布画的，跟 CSS 一点关系没有。
//
// 兜底不能省：真机要是没挂上（域名白名单没配 / 加载慢了一步），
// 后面那个 serif 就是最后一道防线，至少不会整片字消失。
//
// 用法：`ctx.font = '700 46px ' + CANVAS_TITLE`
//      `` ctx.font = `700 ${n}px ${CANVAS_TITLE}` ``
// ============================================================
const CANVAS_TITLE = '"YPWZTitle", serif';

/**
 * 启动时调一次。App.onLaunch 里调最合适 —— 那时还没有页面，
 * 配上 global: true 就是全局生效，不用每个页面自己加载。
 */
function boot(track) {
  if (_booted) return;
  _booted = true;

  // 老基础库没有这个 API：静默跳过，CSS 字体栈里的系统字体接着兜底
  if (typeof wx.loadFontFace !== 'function') return;

  FACES.forEach(function (face) {
    if (!face.on) return;
    wx.loadFontFace({
      family: face.family,
      source: 'url("' + FONT_BASE + face.file + '")',
      // global 必须为真：这个调用发生在 App 层，没有页面上下文，
      // 不开全局的话字体只对「调用时所在的那个页面」生效（而我们根本没有那个页面）
      global: true,
      // native 让 Canvas 2D 也能用上 —— 海报导出（card/annual）走的就是 canvas
      scopes: ['webview', 'native'],
      success: function () {
        _report(track, face.family, true);
      },
      fail: function (err) {
        // 常见原因：域名没配 downloadFile 白名单 / 证书过期 / 文件被删
        _report(track, face.family, false, (err && err.errMsg) || '');
      }
    });
  });
}

/** 上报一次成败，便于在后台看出「字体到底有没有加载上」——埋点失败不拦任何事 */
function _report(track, family, ok, msg) {
  if (!track || typeof track.track !== 'function') return;
  try {
    track.track('font_load', { f: family, ok: ok ? 1 : 0, msg: String(msg || '').slice(0, 120) });
  } catch (e) { /* 忽略 */ }
}

module.exports = { boot, FONT_BASE, FACES, CANVAS_TITLE };
