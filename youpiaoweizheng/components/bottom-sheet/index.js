// components/bottom-sheet/index.js —— M4.5 底部弹出层（P1 交互5）
// 用法：
//   <bottom-sheet show="{{sheetOn}}" title="标题" bind:close="onClose">…内容…</bottom-sheet>
// 行为：
//   遮罩淡入 200ms / 面板底部滑入 300ms cubic-bezier(0.32,0.72,0,1)，退场反向
//   点遮罩 / 拖拽手柄 → 触发 close 事件（由页面控制 show=false）
//   catchtouchmove 阻断滚动穿透；面板最高 85vh，内容超高内部滚动
//   安全区：底部 padding env(safe-area-inset-bottom)
//
// ⚠️ LEAVE_MS 必须与 index.wxss 里 `.bs-panel.out` 的动画时长一模一样。
//    写短了：动画还没播完节点就被 setData 摘掉，面板「啪」地消失；
//    写长了：动画早结束了，用户对着一个空壳等两百毫秒（点遮罩关不掉的感觉就是这么来的）。
//    以前这两处各写各的 250，靠人眼对齐；tests/motion.test.js 现在钉着它们相等。
const LEAVE_MS = 250;

Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
      observer(v) { this.toggle(v); }
    },
    title: { type: String, value: '' }
  },
  data: {
    visible: false, // 节点是否挂载
    leaving: false  // 退场动画中
  },
  methods: {
    toggle(v) {
      if (v) {
        clearTimeout(this._t);
        this.setData({ visible: true, leaving: false });
      } else if (this.data.visible && !this.data.leaving) {
        this.setData({ leaving: true });
        this._t = setTimeout(() => this.setData({ visible: false, leaving: false }), LEAVE_MS);
      }
    },
    close() { this.triggerEvent('close'); },
    noop() {}
  },
  lifetimes: {
    detached() { clearTimeout(this._t); }
  }
});
