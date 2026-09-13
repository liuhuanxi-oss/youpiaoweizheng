// components/ticket-menu/index.js —— 长按票根卡的快捷菜单（7.3.0 A6）
// ============================================================
// 为什么做成组件而不是各页抄一份：
//   「生成卡片 / 分享 / 删除」三件事与页面无关，抄两份就要维护两份删除确认；
//   而删除是会丢数据的动作，最怕两边行为不一致。
//
// 【分享那一项为什么是 button open-type=share】
//   小程序不允许用代码拉起「转发给好友」的弹窗，只能由 button 触发。
//   触发后拿到的是**页面**的 onShareAppMessage —— 所以按钮上带 data-id，
//   页面按 e.target.dataset.id 把标题与落地页换成被长按的那一张票根
//   （各页的 onShareAppMessage 都写了这层判断，见 pages/home/home.js）。
//
// 用法：
//   <ticket-menu show="{{menu}}" id="{{menuId}}" title="{{menuTitle}}"
//                bind:close="closeMenu" bind:deleted="onMenuDeleted" />
// ============================================================
const store = require('../../utils/store.js');
const track = require('../../utils/track.js');

Component({
  properties: {
    show: { type: Boolean, value: false },
    id: { type: String, value: '' },
    title: { type: String, value: '' }
  },
  methods: {
    close() { this.triggerEvent('close'); },

    /** 生成纪念卡片：这一张票根的卡片页（保存图片 / 分享都在那儿） */
    goCard() {
      const id = this.data.id;
      if (!id) return;
      track.track('menu_card', {});
      wx.navigateTo({ url: `/pages/card/card?id=${id}` });
      this.close();
    },

    /**
     * 分享这一项：只记一笔埋点，**不关面板**。
     * 转发面板是原生层，关不关都不影响它弹出来 —— 但万一哪个基础库版本要等按钮
     * 存活到回调，先关就等于把分享掐了。宁可让面板留在后面（点遮罩即可收）。
     */
    onShare() {
      track.track('menu_share', {});
    },

    /**
     * 删除这张票根：二次确认 → store.removeTicket（云 / 演示双模式）→ 通知页面重取列表。
     * 与详情页的删除同一套口径（照片文件留在云存储，列表里立刻消失）。
     */
    onDelete() {
      const id = this.data.id;
      if (!id || this._busy) return;
      wx.showModal({
        title: '删除这张票根？',
        content: '删除后它和它的 AI 文案都不会再出现在册子里。',
        confirmText: '删除',
        confirmColor: '#C26B5E',
        cancelText: '再想想',
        success: async (r) => {
          if (!r.confirm) return;
          this._busy = true;
          this.close();
          wx.showLoading({ title: '删除中', mask: true });
          try {
            await store.removeTicket(id);
            wx.hideLoading();
            track.track('menu_delete', {});
            wx.showToast({ title: '已删除', icon: 'none' });
            this.triggerEvent('deleted', { id });
          } catch (e) {
            wx.hideLoading();
            wx.showToast({ title: '删除失败，请重试', icon: 'none' });
          } finally {
            this._busy = false;
          }
        }
      });
    }
  }
});
