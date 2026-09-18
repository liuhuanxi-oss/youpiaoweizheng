// utils/subscribe.js —— 7.4.0 C2 订阅消息召回（端上只请求授权，发送全在云端）
// ============================================================
// 【一次性订阅是什么，为什么这里长得不像「推送开关」】
//   小程序订阅消息是**一次授权、一次下发**：用户点一次「允许」只能换一条消息。
//   所以这里不做「开启每日提醒」那种开关 —— 那是在骗人（第二天它不会来）。
//   真实形态是：用户主动签到时弹一次授权 → 换次日一条召回 → 他回来了再换下一条。
// 【两条硬约束】
//   ① 授权弹窗必须由**用户点击**触发：requestSubscribeMessage 要在点击回调里
//      **同步**发起。放到 await 之后再调会因手势过期而 fail —— 而且用户什么也看不到，
//      功能看着有、实际永远不弹窗（7.4.1 那类「静默失效」的同一副面孔）。
//      所以 askIfDue() 只负责「发起」，返回 Promise 给调用方稍后再收结果。
//   ② 模板 ID 为空时整块隐藏（与 utils/ads.js 同一套铁律）：不留点了没反应的假入口。
// 【节流】签到本身一天一次，天然限频；额外只在**被拒后的 30 天内不再问** ——
//   用户已经说了「不」，隔天再弹就是骚扰。
// ============================================================
const { USE_CLOUD } = require('./env.js');

/** 订阅消息模板 ID（MP 后台 → 订阅消息 →「每日时光签」提醒模板）。
 *  空字符串 = 未配置 = 全站不出现任何相关请求（连授权弹窗都不会弹）。 */
const TMPL_ID = 'LoBUuHkTvYuHw1Q2Nt-MlqKLwwXQgNLg33LA62jxYB8';

const LS_KEY = 'sp_sub_state';  // { ymd: 哪天问过, denyAt: 被拒的时间戳 }
const DENY_QUIET_DAYS = 30;     // 被拒后的静默期
const DAY_MS = 86400000;

/** 模板 ID 是否已配置 —— 页面若要显示「明天提醒我」之类的入口，先问这里 */
function available() { return USE_CLOUD && !!TMPL_ID; }

function _state() {
  try { return wx.getStorageSync(LS_KEY) || {}; } catch (e) { return {}; }
}
function _save(patch) {
  try { wx.setStorageSync(LS_KEY, Object.assign(_state(), patch)); } catch (e) { /* 存储异常不影响签到 */ }
}
/** 端上只用来判断「今天问过没有」，不参与任何发奖判定（发奖一律服务端按北京时间算） */
function _ymd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 发起一次订阅授权请求。**必须在用户点击回调里同步调用**（见文件头约束①）。
 * @returns {Promise<{ok:boolean, accepted:boolean, reason:string}>|null}
 *   null = 未配置模板 ID / 演示模式 / 低版本基础库 / 今天问过 / 静默期内 —— 调用方什么都不用做
 */
function askIfDue() {
  if (!available()) return null;
  if (!wx.requestSubscribeMessage) return null; // 低版本基础库：静默跳过，不报错
  const st = _state();
  if (st.ymd === _ymd()) return null; // 今天已经问过（签到失败再点一次时不再弹）
  if (st.denyAt && Date.now() - st.denyAt < DENY_QUIET_DAYS * DAY_MS) return null;
  return new Promise((resolve) => {
    try {
      wx.requestSubscribeMessage({
        tmplIds: [TMPL_ID],
        success: (res) => {
          const accepted = !!(res && res[TMPL_ID] === 'accept');
          // 只有用户明确拒绝才进静默期；其它取值（ban/filter）与失败同样是「不发」，一并静默
          const patch = { ymd: _ymd() };
          if (!accepted) patch.denyAt = Date.now();
          _save(patch);
          resolve({ ok: true, accepted, reason: String((res && res[TMPL_ID]) || 'other') });
        },
        fail: (err) => {
          // fail 多为环境问题（如 20004 用户关了订阅总开关）而不是「用户拒绝」：
          // 记下今天问过即可，**不进静默期** —— 明天还可以再试一次
          _save({ ymd: _ymd() });
          resolve({ ok: false, accepted: false, reason: String((err && err.errCode) || 'fail') });
        }
      });
    } catch (e) {
      resolve({ ok: false, accepted: false, reason: 'throw' });
    }
  });
}

/**
 * 授权成功后回报服务端，让云端次日发一条召回。
 * **失败一律静默**：这是「加一条提醒」，任何失败都不该影响用户已经拿到的签到奖励，
 * 也不该弹一个他看不懂的错误。
 * @param {Promise|null} p askIfDue() 的返回值（同步发起时就拿到了）
 * @param {object} r 签到结果（服务端的返回值）
 */
async function afterSign(p, r) {
  if (!p || !USE_CLOUD) return;
  try {
    const res = await p;
    if (!res || !res.accepted) return;
    if (!r || !r.ok) return; // 没签上就别挂提醒：明早那句「今天的时光签还没收下」会变成假话
    await wx.cloud.callFunction({
      name: 'saveTicket',
      data: { action: 'recallSave', tmplId: TMPL_ID, streak: r.streak || 0 }
    });
  } catch (e) { /* 静默：提醒没挂上，签到本身已经完成 */ }
}

module.exports = { TMPL_ID, available, askIfDue, afterSign };
