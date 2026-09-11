// app.js —— 小程序入口
const { USE_CLOUD, CLOUD_ENV } = require('./utils/env.js');
const track = require('./utils/track.js'); // 4.17.0：拉新埋点

// 4.19.2 全局异常节流计数：单次会话上限 5 条，防错误循环刷爆上报通道
let _errCount = 0;

App({
  onLaunch(options) {
    // 4.17.0：冷启动来源（场景值）——分入口看拉新质量的地基数据
    if (options && options.scene) track.track('scene_source', { scene: options.scene, cold: 1 });

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

  onShow(options) {
    // 4.17.0：热启动来源（分享卡进入/下拉直达/搜一搜等），cold:0 区分于冷启动
    if (options && options.scene) track.track('scene_source', { scene: options.scene, cold: 0 });
  },

  globalData: {
    // 全局共享数据
  }
});
