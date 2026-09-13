// utils/enter.js —— 切 tab 回来时重播入场动效（7.2.0 V7）
// ============================================================
// 为什么不能只给根节点挂个 class：
//   tab 页在微信里是**常驻内存**的 —— onLoad 只跑一次，来回切只重跑 onShow，
//   节点一直在，CSS 动画就只在第一次渲染时播那一遍。
//   要让动画重来，必须真的把类名从节点上摘掉、隔一次渲染再挂回去。
//
// 用法：
//   const enter = require('../../utils/enter.js');
//   Page({
//     data: { enter: true },              // 初值为真：首次进场不用重挂，避免「先亮一帧再淡入」
//     onShow() { enter.replay(this); },
//   })
//   根节点：<view class="tk-page {{enter ? 'fade-up' : ''}}">
//
// ⚠️ 动效本身定义在 app.wxss 的 .fade-up 里（含 prefers-reduced-motion 降级）；
//    这里只负责「重播」，不负责长什么样。
// ============================================================

const GAP = 20;   // ms：两次 setData 得跨过一次渲染，隔太近会被合并 → 类名等于没摘

/** 让根节点上的 .fade-up 重播一次（首次进场跳过：那时动画本来就还没播过） */
function replay(page) {
  clearTimeout(page._enterT);
  if (!page._enterSeen) {
    page._enterSeen = true;
    return;
  }
  page.setData({ enter: false });
  page._enterT = setTimeout(() => page.setData({ enter: true }), GAP);
}

module.exports = { replay };
