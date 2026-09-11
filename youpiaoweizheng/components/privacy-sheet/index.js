// components/privacy-sheet/index.js —— M5 隐私授权弹窗
// 微信要求：调用隐私接口（chooseMedia / saveImageToPhotosAlbum 等）前需用户同意《隐私保护指引》。
// 平台在需要授权时回调 wx.onNeedPrivacyAuthorization → 我们弹品牌化 bottom-sheet：
//   同意 → resolve({ event: 'agree' })（继续原接口调用）
//   拒绝/点遮罩 → resolve({ event: 'disagree' })（接口 fail，页面自行提示）
// 使用：在用到隐私接口的页面 json 注册本组件，wxml 放一个自闭合标签即可（scan / card）。
// 兜底：低版本基础库无该 API 时组件静默，平台默认弹窗接管。
Component({
  data: { show: false },

  lifetimes: {
    attached() {
      if (!wx.onNeedPrivacyAuthorization) return;
      this._handler = (resolve) => {
        this._resolve = resolve;
        this.setData({ show: true });
      };
      wx.onNeedPrivacyAuthorization(this._handler);
    },
    detached() {
      if (wx.offNeedPrivacyAuthorization && this._handler) {
        wx.offNeedPrivacyAuthorization(this._handler);
      }
    }
  },

  methods: {
    // 修复：由 open-type="agreePrivacyAuthorization" button 的授权事件触发（bindagreeprivacyauthorization）。
    // 该事件仅在微信侧接受本次同意后触发——此时带 buttonId resolve 才是合法授权。
    onAgreePrivacy() {
      wx.vibrateShort({ type: 'light' });
      this.setData({ show: false });
      if (this._resolve) { this._resolve({ event: 'agree', buttonId: 'agree-btn' }); this._resolve = null; }
    },
    deny() {
      this.setData({ show: false });
      if (this._resolve) { this._resolve({ event: 'disagree' }); this._resolve = null; }
      wx.showToast({ title: '已拒绝，本次操作未完成', icon: 'none' });
    },
    onClose() { this.deny(); }, // 点遮罩/手柄关闭 = 不授权，避免授权请求悬空
    goProtocol() {
      wx.navigateTo({ url: '/pages/protocol/protocol?type=privacy' });
    },
    noop() {}
  }
});
