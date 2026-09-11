// components/animated-number/index.js —— v6.6.0 数字滚动升级
// ============================================================
// 两种模式（mode property）：
//  · instant（默认，兼容历史）：value 变更即播（时长随目标值 400/600/800ms，easeOutCubic）
//  · viewport（年报三/四格大数字专用）：
//      - 元素滚入视口 30% 才启动（IntersectionObserver，播一次即 disconnect）
//      - 固定 1200ms 分段缓动：前 80% 时间 easeOutCubic 快跑（走完 88% 行程），
//        后 20% 时间 easeOutQuad 减速缓停——禁止线性匀速或中途急停
// reduced-motion：createMediaQueryObserver 探测 (prefers-reduced-motion: reduce)，
//  命中则跳过滚动直接显示终值，仅由 wxss 的 an-in（opacity 淡入）完成过渡；
//  探测 API 不支持（老基础库）时按正常动效播放（fail-open，注释见下）。
// 技术注记：setData 跨线程，33ms（≈30fps）节流，仅显示文本变化才推送。
// ============================================================
const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
const easeOutQuad = (p) => 1 - (1 - p) * (1 - p);

/** v6.6.0 分段缓动：前 80% 快跑 + 后 20% 缓停（总行程 1） */
function easeScroll(p) {
  if (p < 0.8) {
    return 0.88 * easeOutCubic(p / 0.8);
  }
  return 0.88 + 0.12 * easeOutQuad((p - 0.8) / 0.2);
}

// 4.10.3：节奏随主题（A 从容 / B 迅捷 / C 轻柔），legacy 轨道读 storage 一次即可
function themeMul() {
  try {
    const k = wx.getStorageSync('sp_theme');
    if (k === 'b') return 0.5;
    if (k === 'c') return 0.75;
  } catch (e) { /* 忽略 */ }
  return 1;
}
const _mul = themeMul();

function fmt(v) {
  v = Math.round(v);
  if (Math.abs(v) >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  return String(v);
}

Component({
  properties: {
    value: { type: Number, value: 0, observer: 'onValue' },
    // instant：value 即播（历史行为）；viewport：滚入视口 30% 才播（v6.6.0）
    mode: { type: String, value: 'instant' },
    // viewport 模式固定 1200ms（需求口径）；instant 模式仍按目标值动态
    dur: { type: Number, value: 1200 }
  },
  data: { display: '0' },
  lifetimes: {
    attached() {
      this._armed = this.data.mode !== 'viewport'; // viewport 模式等视口触发
      if (this.data.mode === 'viewport') this._setupViewport();
      this._probeReduce();
    },
    detached() { this._teardown(); }
  },
  methods: {
    /** value 变化：instant 模式照旧即播；viewport 模式只记录目标值（未武装不播） */
    onValue() {
      if (this.data.mode === 'viewport') return; // 视口触发统一走 start()
      this.play();
    },

    /** 滚入视口 30% → 播放一次（外部也可直接调 start() 手动触发） */
    start() {
      if (this._played) return;          // 只播一次
      this._played = true;
      if (this._io) { try { this._io.disconnect(); } catch (e) { /* 忽略 */ } this._io = null; }
      this.play(true);
    },

    play(fromViewport) {
      const to = Number(this.data.value) || 0;
      const from = typeof this._cur === 'number' ? this._cur : 0;
      this._cur = to;
      if (to === from) { this.setData({ display: fmt(to) }); return; }
      // reduced-motion：跳过滚动，直接终值（.an 的 an-in opacity 淡入仍在）
      if (this._reduce) { this.setData({ display: fmt(to) }); return; }

      const dur = fromViewport
        ? this.data.dur
        : Math.round((Math.abs(to) >= 1000 ? 800 : Math.abs(to) >= 100 ? 600 : 400) * _mul);
      const ease = fromViewport ? easeScroll : easeOutCubic;
      const t0 = Date.now();
      this._stop();
      this._timer = setInterval(() => {
        const p = Math.min(1, (Date.now() - t0) / dur);
        const v = from + (to - from) * ease(p);
        const d = fmt(v);
        if (d !== this.data.display) this.setData({ display: d });
        if (p >= 1) this._stop();
      }, 33);
    },

    /** viewport 模式：观察自身 30% 进入视口（相对视口底边，向上滚动场景） */
    _setupViewport() {
      try {
        this._io = this.createIntersectionObserver({ thresholds: [0.3] });
        this._io.relativeToViewport({ bottom: 0 }).observe('.an', () => this.start());
      } catch (e) {
        // observer 不可用（老基础库）：回退为「可播」状态，等数据到位直接播
        this._armed = true;
      }
    },

    /** prefers-reduced-motion 探测：支持则精确降级，不支持 fail-open（正常播放） */
    _probeReduce() {
      try {
        if (typeof this.createMediaQueryObserver !== 'function') return;
        const mq = this.createMediaQueryObserver();
        mq.observe({ query: '(prefers-reduced-motion: reduce)' }, (res) => {
          this._reduce = !!res.matches;
          if (this._reduce) this._stop();
        });
        this._mqo = mq;
      } catch (e) { /* 该基础库不支持 prefers-reduced-motion：照常播放 */ }
    },

    _stop() {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
    },
    _teardown() {
      this._stop();
      if (this._io) { try { this._io.disconnect(); } catch (e) { /* 忽略 */ } this._io = null; }
      if (this._mqo) { try { this._mqo.disconnect(); } catch (e) { /* 忽略 */ } this._mqo = null; }
    }
  }
});
