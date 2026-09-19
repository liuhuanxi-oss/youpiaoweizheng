// app.js —— 小程序入口
const { USE_CLOUD, CLOUD_ENV } = require('./utils/env.js');
const track = require('./utils/track.js'); // 4.17.0：拉新埋点
const invite = require('./utils/invite.js'); // 7.3.0 R6：邀请归因

// 4.19.2 全局异常节流计数：单次会话上限 5 条，防错误循环刷爆上报通道
let _errCount = 0;

App({
  onLaunch(options) {
    // 4.17.0：冷启动来源（场景值）——分入口看拉新质量的地基数据
    if (options && options.scene) track.track('scene_source', { scene: options.scene, cold: 1 });

    // 7.2.0 §3.3：page_view —— 全局路由钩子，一处盖住全部页面（含 tab 切换与返回）。
    // 逐页加一行也行，但新增页面时必漏；这个钩子是基础库 2.19.4 起的能力，
    // 遇到了没有它的老基础库就只是没有 page_view，不影响任何业务（下面的 if 是守卫，不是兼容代码）。
    if (wx.onAppRoute) {
      wx.onAppRoute((res) => track.track('page_view', { p: (res && res.path) || '' }, { local: false }));
    }

    // ===== 云开发初始化（M2 起） =====
    // 开关在 utils/env.js：演示模式下不初始化云，全部走 mock 数据；
    // 开通云开发并在 env.js 打开开关后，这里自动生效。
    if (USE_CLOUD) {
      if (!wx.cloud) {
        console.error('请将基础库升级到 2.2.3 以上以使用云能力');
        return;
      }
      wx.cloud.init({
        env: CLOUD_ENV,
        traceUser: true
      });
    }

    // 7.3.0 R6：冷启动捞邀请码（分享 path 的 ?ref= / 小程序码 scene 的 r=）。
    // 放在 wx.cloud.init 之后：invite 要调云函数，init 前调会失败。
    invite.boot(options);
  },

  // ===== 7.4.2 失效路径兜底 =====
  // pages/wall 与 pages/map 在 7.0 已下线，可老分享卡、老二维码还在这世上流传：
  // 点到失效路径时小程序停在白屏，用户以为坏了 —— 他这一刻本是带着兴趣点进来的，
  // 漏掉的正是最该接住的那批人。回首页，给个出口。
  onPageNotFound(res) {
    // 顺手记一笔：这是「有人在传失效链接」唯一看得见的迹象（后台登记 page_404 后可见）
    try {
      track.track('page_404', { p: String((res && res.path) || '').slice(0, 120) });
    } catch (e) { /* 埋点失败不拦兜底 */ }
    wx.reLaunch({ url: '/pages/home/home' });
  },

  // ===== 4.19.2 全局异常自动上报 =====
  // 背景：真机问题（如卡片页白屏类反馈）无法依赖用户开调试面板——
  // JS 错误直接进 mp 后台自定义分析（js_error/js_rejection）+ 本地环形缓冲，
  // 用户复现一次，后台即可拿到错误堆栈，不再靠猜测定位。
  onError(msg) {
    if (_errCount >= 5) return;
    _errCount += 1;
    try {
      track.track('js_error', { msg: String(msg || '').slice(0, 600), n: _errCount });
    } catch (e) { /* 上报失败不影响 */ }
  },
  onUnhandledRejection(res) {
    if (_errCount >= 5) return;
    _errCount += 1;
    try {
      track.track('js_rejection', { reason: String((res && res.reason) || '').slice(0, 600), n: _errCount });
    } catch (e) { /* 上报失败不影响 */ }
  },

  // ===== 8.1.3 埋点落云 =====
  // 用户离开小程序 = 把本地这批埋点送一次（服务端认了才从本地删，失败留着下次）。
  // 放 onHide 而不是 onLaunch：它在一次使用的最末尾，这一趟的事件最全。
  onHide() {
    try { track.flush(true); } catch (e) { /* 埋点失败不拦任何业务 */ }
  },

  onShow(options) {
    // 4.17.0：热启动来源（分享卡进入/下拉直达/搜一搜等），cold:0 区分于冷启动
    if (options && options.scene) track.track('scene_source', { scene: options.scene, cold: 0 });
    // 7.3.0 R6：热启动也要捞一次邀请码 —— 小程序活着时点别人的分享卡进来只走 onShow，
    // 只在 onLaunch 捞会把这一类归因整批漏掉（boot 内部：捞码 → 绑定 → 催结算，全静默）
    invite.boot(options);
  },

  globalData: {
    // 全局共享数据
  }
});
