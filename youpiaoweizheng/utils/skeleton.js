// utils/skeleton.js —— M4.5 骨架屏公共时序（P0 交互2）
// 规则：
//   1. 加载开始后 300ms 未完成才显示骨架（防止快加载闪烁）
//   2. 数据到达后骨架立即隐藏，页面内容由骨架容器让位后的 fade-in 过渡承接
// 页面接入方式：
//   data 里加 skeleton: false；refresh() 开头 sk.start(this)，结束 sk.end(this)
//   wxml 结构：<view class="brand">…常驻头部…</view>
//             <view class="sk" wx:if="{{skeleton}}">…骨架…</view>
//             <view class="fade-in" wx:else>…真实内容…</view>
const DELAY = 300;

function start(page) {
  page._skLoading = true;
  clearTimeout(page._skTimer);
  page._skTimer = setTimeout(() => {
    if (page._skLoading) page.setData({ skeleton: true });
  }, DELAY);
}

function end(page) {
  page._skLoading = false;
  clearTimeout(page._skTimer);
  if (page.data.skeleton) page.setData({ skeleton: false });
}

module.exports = { start, end };
