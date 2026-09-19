// utils/track.js —— 4.17.0 拉新埋点（零依赖 · 零成本 · 绝不阻塞业务）
// ============================================================
// 三条通道：
//   ① wx.reportEvent —— 官方「自定义分析」（mp 后台可配看板）；
//      未在后台配置同名事件时仅 fail 不报错，静默吞掉。
//   ② 本地环形缓冲 sp_track_events（500 条）—— 同一条缓冲现在有两个身份：
//      既是自查兜底，也是**待落云的队列**（见 8.1.3 的 flush）。
//   ③ 8.1.3 落云通道 —— 批量把缓冲送到云端的 trackBatch，落进自己的 events 集合。
//      加它的原因很直白：① 得先有人在后台把事件建出来，而**后台一个都没建**，
//      于是上线至今的埋点数据全被静默吞掉、且丢了的补不回来。② 那 500 条原本只是
//      躺在用户手机上（没有任何回收通道），等于死数据 —— 现在它有了出口。
// 铁律：埋点失败不能影响任何业务流程，所以全程 try-catch 静默。
// ============================================================

const { USE_CLOUD } = require('./env.js'); // 8.1.3：落云跟着环境开关走（演示模式不外发）

const LS_KEY = 'sp_track_events';
const MAX_ROWS = 500; // 环形缓冲上限（超出丢最老的）
// ── 8.1.3 落云参数 ──
const FLUSH_MIN = 30;        // 本地攒够这么多条，就顺手送一批
const FLUSH_GAP = 60 * 1000;  // 两次送之间至少隔 60 秒（频繁切前后台时别刷云函数）
const FLUSH_MAX = 50;        // 单次最多送多少条（与云端 tracklog.TRACK_MAX_ROWS 对齐）

let _sending = false; // 正在送的过程中不再发第二次
let _lastFlush = 0;

/**
 * 记录一个事件
 * @param {string} event 事件名（如 scene_source / first_save / poster_save）
 * @param {object} data  参数（值自动转为 string/number，满足 reportEvent 限制）
 * @param {object} [opts]
 * @param {boolean} [opts.local=true] 是否写本地环形缓冲（= 是否进落云队列）。
 *   page_view 这类「每次路由变化都发」的事件要关掉：setStorageSync 是同步的，
 *   每次切页都把 500 条事件整个序列化重写一遍，掉帧掉在页面切换上最明显；
 *   而它本来就是给后台看板看的（官方那条有平台口径的页面分析），落云对账用不上。
 */
function track(event, data, opts) {
  const d = data || {};
  const safe = {};
  Object.keys(d).forEach((k) => {
    const v = d[k];
    safe[k] = typeof v === 'number' ? v : String(v == null ? '' : v).slice(0, 60);
  });

  // 通道一：官方自定义分析
  try { wx.reportEvent(event, safe); } catch (e) { /* 未配置/基础库不支持，静默 */ }

  if (opts && opts.local === false) return;

  // 通道二：本地环形缓冲（同时是落云队列）
  try {
    const list = wx.getStorageSync(LS_KEY) || [];
    list.push({ e: event, d: safe, t: Date.now() });
    if (list.length > MAX_ROWS) list.splice(0, list.length - MAX_ROWS);
    wx.setStorageSync(LS_KEY, list);
    if (list.length >= FLUSH_MIN) flush(false); // 够一批就送；60 秒内不会重复送
  } catch (e) { /* 存储异常不影响业务 */ }
}

/** 小程序版本号（开发者工具里是空串）—— 存进库里才能按版本看数据 */
function _ver() {
  try {
    const a = wx.getAccountInfoSync && wx.getAccountInfoSync();
    return (a && a.miniProgram && a.miniProgram.version) || '';
  } catch (e) { return ''; }
}

/**
 * 通道三：把本地缓冲里最老的一批送到云端（action: trackBatch）。
 *
 * **服务端认了（ok:true）才从本地删。** 它丢掉的脏行同样算「送出去过」——
 * 那些行重送一百次也还是被丢，留在本地只会把后面的真事件挤在队列里发不出去。
 * 反过来，网络失败/云函数挂了一律留着，下次再送（重复几条比丢强）。
 *
 * @param {boolean} [force] true = 忽略 60 秒间隔（用户离开小程序时用）
 * @returns {Promise<number>} 送出去的条数（0 = 什么都没送）
 */
function flush(force) {
  if (!USE_CLOUD || _sending) return Promise.resolve(0);
  if (!wx.cloud || !wx.cloud.callFunction) return Promise.resolve(0);
  const now = Date.now();
  if (!force && now - _lastFlush < FLUSH_GAP) return Promise.resolve(0);
  let rows = [];
  try { rows = wx.getStorageSync(LS_KEY) || []; } catch (e) { return Promise.resolve(0); }
  if (!rows.length) return Promise.resolve(0);

  const batch = rows.slice(0, FLUSH_MAX);
  _sending = true;
  _lastFlush = now;
  return wx.cloud.callFunction({
    name: 'saveTicket',
    data: { action: 'trackBatch', rows: batch, ver: _ver() }
  }).then((res) => {
    try {
      const r = (res && res.result) || {};
      if (!r.ok) return 0;
      // 重新读一次再按条数从头切：这中间新写进来的事件在尾部，切不到它们
      const fresh = wx.getStorageSync(LS_KEY) || [];
      fresh.splice(0, Math.min(batch.length, fresh.length));
      wx.setStorageSync(LS_KEY, fresh);
      return batch.length;
    } catch (e) { return 0; }
  }, () => 0).then((n) => { _sending = false; return n; });
}

/** 读本地缓冲（调试/自查用） */
function dump() {
  try { return wx.getStorageSync(LS_KEY) || []; } catch (e) { return []; }
}

module.exports = { track, dump, flush };
