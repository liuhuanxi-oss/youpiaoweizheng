// pages/bind/bind.js —— 邀请中转页：从分享卡片进入，确认后完成绑定
// tab 页不能带参数，所以分享的 code 落在这个普通页上承接。
// ============================================================
// 【这一页是拉新的落地：被邀请的人点进来，一步就该能加入】
//   原来「接受邀请」后面卡着一个必填弹窗（称呼）—— 想加入的人得先打一行字。
//   可称呼**本来就是选填的**（云端默认 TA，见 saveTicket 的 bind join 分支），
//   卡在必填位置上只挡人。现在弹窗还在，但「先不填」也照样往下走。
// 【绑定成功之后指哪条路】
//   被邀请来的人里，很多是「为了 TA 才进来的」，自己一张票根都没有 ——
//   原来的成功页只有「进入我们的回忆」，他进去看见一本空册子，然后就走了。
//   所以这里读一次自己的票册：一张都没有 → 主行动换成「收下我的第一张票根」。
//   云兜底（flags.netFallback）不算数：那是演示票根，不是他的（同 legacy.js 的口径）。
// ============================================================
const themeUtil = require("../../utils/theme.js");
const couple = require('../../utils/couple.js');
const store = require('../../utils/store.js');
const track = require('../../utils/track.js'); // 4.17.0：拉新埋点
const haptics = require('../../utils/haptics.js'); // 7.4.0：触觉三档，别再直接写 vibrateShort

Page({

  onShow() {
    themeUtil.apply(this);
  },
  data: {
    theme: "a", legacyTheme: "a",
    code: '',
    state: 'confirm', // confirm 确认中 / done 已绑定 / error 失败
    msg: '',
    empty: false       // 绑定成功且我一张票根都没有 → 推「收下第一张」
  },

  onLoad(options) {
    const code = String(options.code || '').trim().toUpperCase();
    if (!code) {
      this.setData({ state: 'error', msg: '邀请链接不完整，让 TA 重新分享一次' });
      return;
    }
    this.setData({ code });
  },

  /** 接受邀请：先问称呼（可跳过），再绑定 */
  accept() {
    wx.showModal({
      title: '给自己起个称呼',
      editable: true,
      placeholderText: '选填，让 TA 知道你是谁',
      cancelText: '先不填',
      confirmText: '就这样',
      success: (r) => {
        // 点「先不填」也继续 —— 这是这一步的关键：不填不等于不加入
        this.doJoin(r.confirm ? String(r.content || '').trim() : '');
      }
    });
  },

  async doJoin(name) {
    wx.showLoading({ title: '正在绑定…', mask: true });
    try {
      const res = await couple.joinByCode(this.data.code, name);
      wx.hideLoading();
      haptics.confirm(); // M4.5：关键操作（绑定成功）
      // 4.17.0 invite_bind：分享卡进来的绑定（区分于输码，K 因子主路径）
      track.track('invite_bind', { via: 'card' });
      this.setData({ state: 'done', msg: res.couple.partnerName || 'TA' });
      this.checkFirstTicket();
    } catch (e) {
      wx.hideLoading();
      this.setData({ state: 'error', msg: String((e && e.errMsg) || e.message || e).slice(0, 80) });
    }
  },

  /** 绑定成功之后该指哪条路：没有票根的人，先把第一张收下 */
  async checkFirstTicket() {
    try {
      const rows = await store.listTickets();
      const flags = store.listFlags() || {};
      this.setData({ empty: !flags.netFallback && !(rows || []).length });
    } catch (e) {
      this.setData({ empty: false }); // 读不出来就按有票处理，不把人往拍照推错路
    }
  },

  goScan() {
    haptics.tap();
    wx.navigateTo({ url: '/pages/scan/scan' });
  },

  // v6.6.1 修复：duo 不在 tabBar 里，wx.switchTab 只能跳 tab 页，调用必然失败
  // （fail: can not switch to no-tabBar page），绑定流程到这一步就断了。改走 navigateTo。
  decline() {
    wx.navigateTo({ url: '/pages/duo/duo' });
  },

  goDuo() {
    wx.navigateTo({ url: '/pages/duo/duo' });
  }
});
