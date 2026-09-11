// utils/track.js —— 4.17.0 拉新埋点（零依赖 · 零成本 · 绝不阻塞业务）
// ============================================================
// 双通道设计：
//   ① wx.reportEvent —— 官方「自定义分析」（mp 后台可配看板）；
//      未在后台配置同名事件时仅 fail 不报错，静默吞掉。
//   ② 本地环形缓冲 sp_track_events（500 条）—— 自查兜底：
//      后台看板缺位/延迟时，导出本地记录也能对齐增长口径。
// 铁律：埋点失败不能影响任何业务流程，所以全程 try-catch 静默。
// ============================================================

const LS_KEY = 'sp_track_events';
const MAX_ROWS = 500; // 环形缓冲上限（超出丢最老的）

/**
 * 记录一个事件
 * @param {string} event 事件名（如 scene_source / first_save / poster_save）
 * @param {object} data  参数（值自动转为 string/number，满足 reportEvent 限制）
 */
function track(event, data) {
  const d = data || {};
  const safe = {};
  Object.keys(d).forEach((k) => {
    const v = d[k];
    safe[k] = typeof v === 'number' ? v : String(v == null ? '' : v).slice(0, 60);
  });

  // 通道一：官方自定义分析
  try { wx.reportEvent(event, safe); } catch (e) { /* 未配置/基础库不支持，静默 */ }

  // 通道二：本地环形缓冲
  try {
    const list = wx.getStorageSync(LS_KEY) || [];
    list.push({ e: event, d: safe, t: Date.now() });
    if (list.length > MAX_ROWS) list.splice(0, list.length - MAX_ROWS);
    wx.setStorageSync(LS_KEY, list);
  } catch (e) { /* 存储异常不影响业务 */ }
}

/** 读本地缓冲（调试/自查用） */
function dump() {
  try { return wx.getStorageSync(LS_KEY) || []; } catch (e) { return []; }
}

module.exports = { track, dump };
