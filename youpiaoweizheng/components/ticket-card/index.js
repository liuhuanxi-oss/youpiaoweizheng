// components/ticket-card/index.js —— 票根卡片组件
// 产品核心母题：撕票线 + 副券 + 条形码。
// M4.5 起支持左滑：露出「生成卡片 / 删除」快捷动作（touch + transform 自实现，
// 不用 movable-view——嵌套在月分组列表里滑动冲突更可控）。
// 手势规则：
//   横向位移 > 8px 且大于纵向 → 判定为左滑（纵向则放行页面滚动）
//   左滑 < 60rpx 回弹；≥ 60rpx 吸附展开（总宽 280rpx）
//   全局同时只允许一张展开（getApp()._swipeOpen 协调）
//   滑动过的卡片不响应 tap（防误触进详情）
const { stubDate } = require('../../utils/date.js');

const MAX = 140;   // 展开宽度 280rpx = 140px
const TH = -30;    // 吸附阈值 60rpx = 30px

Component({
  properties: {
    ticket: { type: Object, value: {} },
    swipe: { type: Boolean, value: true }, // peek 半张预览等场景可关闭左滑
    stagger: { type: String, value: '0ms' }, // M4.8：列表入场动画的错峰延迟
    tape: { type: Boolean, value: false }, // 4.10：首卡顶部胶带装饰（A/C 显示，B 透明）
    theme: { type: String, value: 'a' }, // 4.10：tilt 错落幅度随主题（B 直边整齐 0°）
    // —— 4.14.0 整理模式（wall 拖拽排序） ——
    reorder: { type: Boolean, value: false },  // 模式内：禁 tap/长按/左滑，手势转纵向拖拽
    lifted: { type: Boolean, value: false },   // 正被拖起（浮起态）
    offset: { type: Number, value: 0 }         // 让位偏移 px（被交换卡上下挪）
  },
  data: {
    stubDate: '',
    swipeX: 0,
    dragging: false,
    tilt: 0,
    dragDy: 0 // 4.14.0 拖拽跟手位移（组件内部，不经页面）
  },
  observers: {
    ticket(t) {
      if (t && t.date) this.setData({ stubDate: stubDate(t.date) });
    },
    // 4.10：票卡轻微错落旋转（A ±1.5° 手贴感 / C ±2° 贴纸感 / B 0° 舞台整齐）
    'ticket.id, theme'() {
      const k = this.data.theme;
      const span = k === 'c' ? 2 : k === 'b' ? 0 : 1.5;
      let h = 0;
      const id = String((this.data.ticket && this.data.ticket.id) || 'x');
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
      const r = span === 0 ? 0 : (((h % 10) / 10) * 2 - 1) * span;
      this.setData({ tilt: Math.round(r * 10) / 10 });
    }
  },
  lifetimes: {
    detached() {
      const app = getApp();
      if (app && app._swipeOpen === this) app._swipeOpen = null;
    }
  },
  methods: {
    // —— 4.14.0 整理模式：纵向拖拽（与左滑共用触点，模式互斥） ——
    onTS(e) {
      if (this.data.reorder) {
        const t0 = e.touches[0];
        this._ry0 = t0.clientY;
        this._rActive = false;
        return;
      }
      if (!this.data.swipe) return;
      const t0 = e.touches[0];
      this._sx = t0.clientX;
      this._sy = t0.clientY;
      this._bx = this.data.swipeX;
      this._moved = false;
      this._dir = null;
      const app = getApp();
      if (app && app._swipeOpen && app._swipeOpen !== this) app._swipeOpen.collapse();
    },
    onTM(e) {
      // 4.14.0 整理模式：纵向拖拽，节流跟手 + 抛事件给页面编排交换
      if (this.data.reorder) {
        if (!e.touches || !e.touches.length) return;
        const dy = e.touches[0].clientY - this._ry0;
        if (!this._rActive && Math.abs(dy) < 6) return; // 位移阈值，防误触
        if (!this._rActive) {
          this._rActive = true;
          this.triggerEvent('dragstart', { id: this.data.ticket.id });
          wx.vibrateShort({ type: 'light' });
        }
        const now = Date.now();
        if (!this._rTick || now - this._rTick >= 16) {
          this._rTick = now;
          this.setData({ dragDy: dy });
          this.triggerEvent('dragmove', { id: this.data.ticket.id, dy });
        }
        return;
      }
      if (!this.data.swipe) return;
      const t0 = e.touches[0];
      const dx = t0.clientX - this._sx;
      const dy = t0.clientY - this._sy;
      if (!this._dir) {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) this._dir = 'h';
        else if (Math.abs(dy) > 8) this._dir = 'v';
        if (this._dir === 'v') return; // 纵向：交给页面滚动
      } else if (this._dir === 'v') return;
      this._moved = true;
      if (!this.data.dragging) this.setData({ dragging: true });
      const x = Math.max(-MAX, Math.min(0, this._bx + dx));
      if (x !== this.data.swipeX) this.setData({ swipeX: x });
    },
    onTE() {
      // 4.14.0 整理模式：抛 dragend（页面决定重排），自身位移复位
      if (this.data.reorder) {
        if (this._rActive) {
          this._rActive = false;
          this.triggerEvent('dragend', { id: this.data.ticket.id, dy: this.data.dragDy });
        }
        if (this.data.dragDy !== 0) this.setData({ dragDy: 0 });
        return;
      }
      if (!this.data.dragging) return;
      const app = getApp();
      const x = this.data.swipeX;
      const next = x < TH ? -MAX : 0;
      this.setData({ dragging: false, swipeX: next });
      if (next !== 0) {
        if (app) app._swipeOpen = this;
      } else if (app && app._swipeOpen === this) {
        app._swipeOpen = null;
      }
    },
    collapse() {
      if (this.data.swipeX !== 0 || this.data.dragging) {
        this.setData({ swipeX: 0, dragging: false });
      }
      const app = getApp();
      if (app && app._swipeOpen === this) app._swipeOpen = null;
    },

    // —— 点击与快捷动作 ——
    onTap() {
      if (this.data.reorder) return; // 4.14.0 整理模式内禁点（防误触进详情）
      if (this._moved || this.data.swipeX !== 0) { // 滑动过不误触
        this._moved = false;
        return;
      }
      this.triggerEvent('tap', { id: this.data.ticket.id });
    },
    onCardAct() {
      this.collapse();
      this.triggerEvent('card', { id: this.data.ticket.id });
    },
    onDelAct() {
      this.collapse();
      this.triggerEvent('del', { id: this.data.ticket.id });
    },
    // —— M4.8 微手势：长按预览票根原图（与左滑天然互斥：滑动即取消长按） ——
    onLongPress() {
      if (this.data.reorder) return; // 4.14.0 整理模式内禁预览（长按即拖拽手势域）
      const img = this.data.ticket && this.data.ticket.img;
      if (!img) return;
      wx.vibrateShort({ type: 'light' });
      if (/^cloud:/.test(img)) {
        // 云 fileID → 换临时链接再预览（失败静默，不打断浏览）
        wx.cloud.getTempFileURL({ fileList: [img] }).then((r) => {
          const url = r.fileList && r.fileList[0] && r.fileList[0].tempFileURL;
          if (url) wx.previewImage({ urls: [url] });
        }).catch(() => {});
      } else {
        wx.previewImage({ urls: [img] });
      }
    }
  }
});
