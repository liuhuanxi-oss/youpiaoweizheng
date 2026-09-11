// pages/bind/bind.js —— 邀请中转页：从分享卡片进入，确认后完成绑定
// tab 页不能带参数，所以分享的 code 落在这个普通页上承接。
const themeUtil = require("../../utils/theme.js");
const couple = require('../../utils/couple.js');
const track = require('../../utils/track.js'); // 4.17.0：拉新埋点

Page({

  onShow() {
    themeUtil.apply(this);
  },
  data: {
    theme: "a", legacyTheme: "a",
    code: '',
    state: 'confirm', // confirm 确认中 / done 已绑定 / error 失败
    msg: ''
  },

  onLoad(options) {
    const code = String(options.code || '').trim().toUpperCase();
    if (!code) {
      this.setData({ state: 'error', msg: '邀请链接不完整，让 TA 重新分享一次' });
      return;
    }
    this.setData({ code });
  },

  async accept() {
    const code = this.data.code;
    wx.showModal({
      title: '你的称呼',
      editable: true,
      placeholderText: '选填，让 TA 知道你是谁',
      success: async (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: '正在绑定…', mask: true });
        try {
          const res = await couple.joinByCode(code, r.content || '');
          wx.hideLoading();
          wx.vibrateShort({ type: 'medium' }); // M4.5：关键操作（绑定成功）
          // 4.17.0 invite_bind：分享卡进来的绑定（区分于输码，K 因子主路径）
          track.track('invite_bind', { via: 'card' });
          this.setData({ state: 'done', msg: res.couple.partnerName || 'TA' });
        } catch (e) {
          wx.hideLoading();
          this.setData({ state: 'error', msg: String(e.message || e).slice(0, 80) });
        }
      }
    });
  },

  decline() {
    wx.switchTab({ url: '/pages/duo/duo' });
  },

  goDuo() {
    wx.switchTab({ url: '/pages/duo/duo' });
  }
});
