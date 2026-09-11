// utils/auth.js —— 4.20.0 授权登录（会话链路）
// ============================================================
// 背景：全 app 云开发免登录（openid 由 getWXContext 提供），
//   但虚拟支付的 signature 需要 session_key → 必须走 wx.login code →
//   云函数 code2Session（AppSecret 在服务端）→ session_key 只存服务端
//   （prefs type=auth_session），前端绝不落盘。
// 铁律：wx.login 会刷新 session_key 使旧值失效 —— 因此每次 wx.login
//   成功后必须立刻调 authLogin 覆盖服务端，两步绑死不拆开。
// 新鲜度：本地记 sp_auth_time（24h），过期或 force 才重新走链路，
//   减少无谓的 wx.login（频繁调用无大碍但省一点是一点）。
// ============================================================
const { USE_CLOUD } = require('./env.js');

const LS_AUTH_TIME = 'sp_auth_time';
const FRESH_MS = 24 * 3600 * 1000; // 24h 内视为新鲜

let _inflight = null; // 并发去重：多处同时 ensureSession 复用同一次登录

function authTime() {
  try { return Number(wx.getStorageSync(LS_AUTH_TIME)) || 0; } catch (e) { return 0; }
}

function markAuthed() {
  try { wx.setStorageSync(LS_AUTH_TIME, Date.now()); } catch (e) { /* 不阻塞 */ }
}

/** 登录是否新鲜（本地视角，仅供 UI 提示用；真正的判定以 payCreate 返回为准） */
function isFresh() {
  return Date.now() - authTime() < FRESH_MS;
}

/**
 * 确保服务端有可用 session（供支付签名）。
 * @param {boolean} force true=强制重新登录（NEED_LOGIN 时的兜底重试）
 * @returns {Promise<{ok:boolean, code?:string, msg?:string}>}
 *   4.20.1：失败时透传服务端具体原因（NO_CONFIG / WX_ERR / OPENID_MISMATCH /
 *   NETWORK…）——此前只回 boolean，用户端永远只见「登录失败」，排障无门。
 */
function ensureSession(force) {
  if (!USE_CLOUD) return Promise.resolve({ ok: true }); // 演示模式：无支付，恒就绪
  if (!force && isFresh()) return Promise.resolve({ ok: true });
  if (_inflight) return _inflight;
  _inflight = new Promise((resolve) => {
    wx.login({
      success: (lr) => {
        const code = lr && lr.code;
        if (!code) { resolve({ ok: false, code: 'NO_CODE', msg: 'wx.login 未返回 code' }); return; }
        wx.cloud.callFunction({
          name: 'saveTicket',
          data: { action: 'authLogin', code }
        }).then((res) => {
          const r = (res && res.result) || {};
          if (r.ok) markAuthed();
          resolve(r.ok ? { ok: true } : { ok: false, code: r.code || 'AUTH_ERR', msg: r.msg || '登录校验未通过' });
        }).catch((e) => resolve({ ok: false, code: 'NETWORK', msg: '网络异常：' + String((e && e.errMsg) || (e && e.message) || e || '').slice(0, 60) }));
      },
      fail: (e) => resolve({ ok: false, code: 'LOGIN_FAIL', msg: 'wx.login 失败：' + String((e && e.errMsg) || '') })
    });
  }).finally(() => { _inflight = null; });
  return _inflight;
}

module.exports = { ensureSession, isFresh, LS_AUTH_TIME, FRESH_MS };
