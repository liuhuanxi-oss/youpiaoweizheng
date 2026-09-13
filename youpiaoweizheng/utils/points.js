// utils/points.js —— 7.4.0 B 段 R2 积分（端上只读 + 两处上报）
// ============================================================
// 【这一层为什么这么薄】
//   给不给分、给多少、今天还能给几次，全在云函数（POINTS_RULES）判定 —— 积分能换成
//   真金白银的 AI 重绘，端上说的话只能当「我做了这件事」的线索，不能当凭据。
//   端上只有两件事要报：① 生成卡片（Canvas 画完存相册，服务端看不见）
//   ② 分享被好友打开（分享卡带的是分享人短码，得有人把它交回服务端）
//   其余得分行为（签到 / 上传 / 看视频 / 邀请）都在服务端自己的流程里记账。
// 演示模式（USE_CLOUD=false）：status 返回 null，页面整块不渲染，不留假入口。
// ============================================================
const { USE_CLOUD } = require('./env.js');

const POINTS_PER_ART = 100; // 与云函数 POINTS_PER_ART 同源：这里只用于「说」，账在服务端

function call(data) {
  if (!USE_CLOUD || !wx.cloud) return Promise.resolve({});
  return new Promise((resolve) => {
    wx.cloud.callFunction({ name: 'saveTicket', data })
      .then((r) => resolve((r && r.result) || {}))
      .catch(() => resolve({}));
  });
}

/** 积分状态：{ ok, balance, lifetime, cost }；取不到返回 null —— 页面不摆假数字 */
async function status() {
  if (!USE_CLOUD) return null;
  const r = await call({ action: 'pointsGet' });
  return r && r.ok ? r : null;
}

/** 生成卡片/海报 +2（服务端白名单只认 card，日上限 2 次）。失败静默：积分不该打断保存 */
function earnCard() {
  return call({ action: 'pointsEarn', reason: 'card' });
}

/**
 * 分享被好友打开 +5（记给分享人）。传的是**分享人的短码**，不是我的。
 * 服务端会先按码找到分享人再记账；自己点自己的分享卡不加分。
 */
function shareOpened(code) {
  if (!code) return Promise.resolve({});
  return call({ action: 'shareOpen', code });
}

/**
 * 兑换 1 次 AI 重绘（100 分，一天最多 1 次）。
 * req 是幂等键：一次点击生成一个，重试时带同一个 —— 服务端认它，
 * 双击或断网重发都只会扣一次分、发一次重绘。
 * 失败按 code 说人话：LIMIT 今天兑过了 / NOBAL 分不够 / GRANT 入账失败已退分。
 */
function makeReq() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const REDEEM_MSG = {
  LIMIT: '今天已经兑换过了，明天再来',
  NOBAL: '积分还不够',
  GRANT: '兑换失败，分数已退回，请再点一次'
};

async function redeem(req) {
  if (!USE_CLOUD) return { ok: false, msg: '演示模式不支持兑换' };
  const r = await call({ action: 'pointsRedeem', req: req || makeReq() });
  if (r && r.ok) return r;
  return {
    ok: false,
    code: (r && r.code) || '',
    msg: REDEEM_MSG[(r && r.code) || ''] || (r && r.msg) || '兑换失败，请稍后再试'
  };
}

/**
 * 「还差多少分能换 1 次 AI 重绘」—— 攒积分得有个看得见的终点，
 * 否则数字涨到 100 也不会有人知道它能干嘛。
 */
function artHint(balance) {
  const b = Math.max(Number(balance) || 0, 0);
  if (b >= POINTS_PER_ART) {
    return { ready: true, text: `已够换 ${Math.floor(b / POINTS_PER_ART)} 次 AI 重绘` };
  }
  return { ready: false, text: `再攒 ${POINTS_PER_ART - b} 分可换 1 次 AI 重绘` };
}

module.exports = { status, earnCard, shareOpened, artHint, redeem, makeReq, POINTS_PER_ART };
