// utils/invite.js —— 7.3.0 R6 邀请归因（分享带码 → 绑定 → 好友首票结算发奖）
// ============================================================
// 【为什么归因要自己记一笔】
//   微信不会告诉小程序「这张分享卡是谁转发的」，分享出去的 path 只能自己带参数。
//   所以邀请人的短码由我们塞进两条通道：
//     ① 好友分享 path 的 ?ref=XXXXXX（share.js 统一注入，7 个分享页全覆盖）
//     ② 小程序码的 scene（r=XXXXXX，扫码进入落在 options.query.scene 里）
//
// 【客户端只管三件事】记下别人的码 / 上报绑定 / 催一次结算。
//   发不发奖、发给谁、发多少 —— 全部由云函数按「被邀请人有没有真的上传过票根」
//   判定（本地标记可被改写，奖不能信本地；这与额度同一套防篡改思路）。
//
// 【演示模式】USE_CLOUD=false 时全部静默空转，不影响任何界面。
// ============================================================
const { USE_CLOUD } = require('./env.js');

const LS_FROM = 'sp_ref_from';   // 别人邀请我：待绑定的邀请人短码
const LS_MINE = 'sp_ref_code';   // 我的短码（分享 path / 码图同步读取，必须能同步拿到）
const LS_WAIT = 'sp_ref_wait';   // 已绑定、等好友上传首票（结算一次后清掉）

/** 云函数调用（失败一律返回 {}，邀请链路绝不抛到业务里） */
function call(data) {
  if (!USE_CLOUD || !wx.cloud) return Promise.resolve({});
  return new Promise((resolve) => {
    wx.cloud.callFunction({ name: 'saveTicket', data })
      .then((r) => resolve((r && r.result) || {}))
      .catch(() => resolve({}));
  });
}

/** 短码统一口径：大写、去空格、最多 8 位（与云函数 refCode 一致） */
function norm(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

/** 我的短码（同步读缓存；没取到就往分享 path 里少带一个参数，不影响分享本身） */
function myCode() {
  try { return norm(wx.getStorageSync(LS_MINE)); } catch (e) { return ''; }
}

/** 把 ?ref= 拼进任意 path/query（已有 query 用 & 接）——分享链路唯一入口 */
function withRef(s) {
  const code = myCode();
  const str = String(s || '');
  if (!code) return str;
  return str + (str.indexOf('?') >= 0 ? '&' : str ? '?' : '') + 'ref=' + code;
}

/**
 * 从启动参数里捞邀请码并记下。
 * @param {object} options App.onLaunch / onShow 的 options（冷启动与热启动都要调：
 *   小程序活着时点别人的分享卡进来，只走 onShow，不调就漏归因）
 * @returns {string} 捞到的码（没捞到为空串）
 */
function capture(options) {
  const q = (options && options.query) || {};
  let code = norm(q.ref);
  if (!code && q.scene) {
    // 小程序码：scene 形如 r=ABC123（URL 编码），decode 失败就当没带码
    try {
      const m = /(?:^|&)r=([A-Za-z0-9]+)/.exec(decodeURIComponent(String(q.scene)));
      if (m) code = norm(m[1]);
    } catch (e) { /* 非本项目的码，忽略 */ }
  }
  if (!code) return '';
  if (code === myCode()) return ''; // 自己点自己的分享卡：不绑自己
  try { wx.setStorageSync(LS_FROM, code); } catch (e) { /* 存储失败只是这次没归因 */ }
  return code;
}

/** 上报绑定（幂等：云函数按被邀请人唯一，重复调无副作用） */
function bind() {
  let code = '';
  try { code = norm(wx.getStorageSync(LS_FROM)); } catch (e) { /* 见下 */ }
  if (!code) return Promise.resolve({});
  return call({ action: 'refBind', code }).then((r) => {
    // 码不存在/是自己/已绑定过 → 都不再重试，免得每次启动都打一次云函数
    try {
      // stale = 我是老用户（绑定时已有票根）：关系记下了，但没有奖励可等
      if (r.ok && r.bound && !r.stale) wx.setStorageSync(LS_WAIT, 1);
      wx.removeStorageSync(LS_FROM);
    } catch (e) { /* 忽略 */ }
    if (r.ok && r.bound) require('./track.js').track('ref_bind', { stale: r.stale ? 1 : 0 });
    return r;
  });
}

/**
 * 催结算：服务端看「我是否已上传过票根」决定发不发奖（双方各 +1 次图版）。
 * 幂等，重复调无副作用 —— 所以启动时补一次、存完第一张票再催一次。
 */
function settle() {
  if (!USE_CLOUD || !wx.cloud) return Promise.resolve({});
  let wait = 0;
  try { wait = wx.getStorageSync(LS_WAIT) ? 1 : 0; } catch (e) { /* 忽略 */ }
  if (!wait) return Promise.resolve({});
  return call({ action: 'refReward' }).then((r) => {
    if (r.ok && r.granted) {
      try { wx.removeStorageSync(LS_WAIT); } catch (e) { /* 忽略 */ }
      require('./track.js').track('ref_reward', { n: 1 });
    }
    return r;
  });
}

/** 启动入口：捞码 → 取我的码 → 绑定 → 催结算（全部静默，失败不影响任何界面） */
function boot(options) {
  if (!USE_CLOUD) return;
  const code = capture(options);
  ensureCode();
  if (code) reportOpen(code);
  bind().then(settle);
}

// 同一张分享卡在一次使用期间只报一次「被打开」。
// 为什么要有这个开关：onShow 每次切回前台都会重跑 boot，同一张卡会被反复上报，
// 服务端虽然封顶 3 次/天，但那 15 分是白送的（不是真的被打开了三次）。
let _openedCode = '';
function reportOpen(code) {
  if (!code || code === _openedCode) return;
  _openedCode = code;
  require('./points.js').shareOpened(code); // 7.4.0 B 段 R2：分享被打开 +5（记给分享人）
}

/** 取（首次时生成）我的短码并缓存到本地 —— 分享 path 同步读它，必须先备好 */
function ensureCode() {
  if (myCode()) return Promise.resolve(myCode());
  return call({ action: 'refCode' }).then((r) => {
    if (r.ok && r.code) {
      try { wx.setStorageSync(LS_MINE, norm(r.code)); } catch (e) { /* 忽略 */ }
      return norm(r.code);
    }
    return '';
  });
}

module.exports = { capture, boot, bind, settle, myCode, ensureCode, withRef, LS_FROM, LS_MINE, LS_WAIT };
