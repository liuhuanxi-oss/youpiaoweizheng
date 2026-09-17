// pages/legacy/legacy.js —— 老票根专场（8.1.0 拉新）
// ============================================================
// 【这页是什么】一个静态活动页：请用户翻出抽屉里那些十年前的票来拍。
//
// 【为什么拉新做这个】新用户的空收藏册留不住人 —— 他今天没票可拍，就先走了。
//   老票不一样：那是**已经发生过的事**，不需要他今天再去做点什么。
//   而且一张 2015 年的票上多半有「当年一起去的那个人」，把它发给当年的朋友，
//   比任何广告语都更容易换来一句「我这也有一张」。
//
// 【识别失败率高不要紧】这是当初最犹豫的一点，想通了：拍老票根本来就会认不准
//   （褪色、字迹淡、版式老）。但认不出来用户会自己补填 —— 那是他自己的回忆，
//   他有投入。所以本页把这件事**提前说明白**，别让他以为「没识别出来 = 白拍了」。
//
// 【本页不读任何数据】纯静态：没有票根列表、没有云调用。
//   两个好处：① 不存在「云兜底成演示票根」那种拿别人的数据骗自己的风险；
//             ② 不需要列表状态横幅（横幅是给读列表的页面用的）。
//   唯一的动态信息是主题色与单页模式。
//
// 【单页模式】好友从朋友圈点开时是单页模式：拿不到身份、**不能跳页** ——
//   页面上那条「去拍一张」在那种模式下点了不会有任何反应。照 detail 与那 6 个
//   分享页的做法换成品牌落地卡（见 templates/sp.wxml），而不是摆一个假按钮。
// ============================================================
const themeUtil = require('../../utils/theme.js');
const track = require('../../utils/track.js');
const share = require('../../utils/share.js');
const { iconSrc } = require('../../utils/icons.js');
const haptics = require('../../utils/haptics.js');
const deco = require('../../utils/deco.js');

const STEPS = [
  { n: '一', t: '翻一翻抽屉', s: '找出那些压箱底的票根', ic: 'ticket' },
  { n: '二', t: '拍一张', s: '拍不清、认不出，都不要紧', ic: 'camera' },
  { n: '三', t: '存进收藏册', s: '从今往后，它们都在一处', ic: 'bookmark' }
];

Page({
  onShow() {
    themeUtil.apply(this);
    this.buildArt();
  },

  data: {
    theme: 'a',
    sp: false,     // 朋友圈单页模式：换成品牌落地卡（那模式下跳不了页）
    deco: {},
    steps: []
  },

  onLoad() {
    // 单页模式判定放在 onLoad：它由启动参数决定，全程不变
    this.setData({ sp: share.sp() });
    // 这一页**不单记「访问」埋点**：全局路由钩子已经记了 page_view，谁是分享带来的
    // 由 invite.capture 在启动时归因 —— 再记一条只会多一个要登记的冗余事件名。
    // 有用的两个数在这里：谁从首页入口进来（legacy_enter）、谁真的去拍了（legacy_scan）。
  },

  /** 本页图形随主题编译（SVG 是独立文档，不认页面 CSS 变量，见 utils/icons.js 顶部） */
  buildArt() {
    const m = themeUtil.getThemeMeta(themeUtil.getTheme());
    // 白图标压在玫瑰实底（--stamp）上，六个主题都是同一个色值，所以恒白
    const stepSrc = STEPS.map((s) => iconSrc(s.ic, '#FFFFFF', 1, 1.6));
    this.setData({
      // 没有 ic：本页只有三步那几个图标，它们压在实底上恒白、由 steps 带下去
      deco: {
        postmark: deco.decoSrc('postmark', m),
        sprig: deco.decoSrc('sprig', m),
        wave: deco.decoSrc('wavelines', m)
      },
      steps: STEPS.map((s, i) => ({ n: s.n, t: s.t, s: s.s, src: stepSrc[i] }))
    });
  },

  /** 去拍：带上 from=legacy —— 扫描页据此换一句提示（老票认不出可以直接手填） */
  goScan() {
    haptics.tap();
    track.track('legacy_scan', {});
    wx.navigateTo({ url: '/pages/scan/scan?from=legacy' });
  },

  onShareAppMessage() {
    track.track('share_click', { from: 'legacy' });
    return share.message('legacy', {});
  },

  // 这条分享的落点就是本页（朋友圈只能带 query），单页模式下由 sp 落地卡接住
  onShareTimeline() {
    track.track('share_timeline', { from: 'legacy' });
    return share.timeline('legacy', {});
  }
});
