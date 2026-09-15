// utils/sign.js —— 7.4.0 R1 每日时光签（端上只读 + 触发签到）
// ============================================================
// 【为什么这一层这么薄】
//   「今天签过没有 / 连签几天 / 该不该发奖」全部由云函数说了算，这里只干两件事：
//   进页面拉一次状态（check=true，只看不动）、用户点了「收下」才真签。
//   任何把判重挪到端上的改动都是错的 —— 手机时间用户自己说了算，改一下就能天天领。
// 演示模式（USE_CLOUD=false）：一律返回 null，页面整块不渲染，不留点了没反应的假入口。
// ============================================================
const { USE_CLOUD } = require('./env.js');
const subscribe = require('./subscribe.js'); // 7.4.0 C2：签到时顺带换一条次日召回（一次性订阅）

// 7.4.3：删掉端上那份「签到 5 分」。数字只认服务端随状态下发的 base —— 账在服务端，
// 这句话就该由服务端说；两侧各硬编码一个 5，改了一侧就是拿假数字跟用户承诺。

async function call(data) {
  const res = await wx.cloud.callFunction({ name: 'saveTicket', data });
  return (res && res.result) || {};
}

/** 拉状态：只看不动。失败返回 null —— 页面保持「没有这一块」，不摆假数据 */
async function status() {
  if (!USE_CLOUD) return null;
  try {
    const r = await call({ action: 'dailySign', check: true });
    return r && r.ok ? r : null;
  } catch (e) {
    return null;
  }
}

/**
 * 收下今日时光签（用户主动点）。服务端返回值：
 * { ok, already, points, art, milestone, balance, signed, streak, best, total }
 * already=true 表示今天已经签过（重复点/换页面点都会走到这里，不会重复发奖）。
 */
async function checkIn() {
  if (!USE_CLOUD) return { ok: false, msg: '演示模式不支持签到' };
  // 订阅授权必须在这**一次点击**里同步发起，所以它是本函数的第一句（此刻手势还没过期）。
  // 挪到 await 之后就会被微信判为「非用户点击」而静默失败 —— 弹窗永不出现，还查不出原因。
  const subP = subscribe.askIfDue();
  let r;
  try {
    r = await call({ action: 'dailySign' });
  } catch (e) {
    return { ok: false, msg: '签到失败，请再点一次' };
  }
  // 不 await：签到结果该立刻显示，多等一次云函数只会让提示晚一步
  subscribe.afterSign(subP, r);
  return r;
}

/**
 * 横条 / 卡片的文案（首页与我的页共用一套 —— 同一个动作在两处说不一样的话最伤人）。
 * 从没签过的人不提「连签」：那是给已经连着来的人看的。
 */
function bannerText(s) {
  const signed = !!(s && s.signed);
  const streak = (s && s.streak) || 0;
  if (signed) {
    return {
      title: '今天已收下',
      sub: streak > 0 ? `已连签 ${streak} 天 · 明天再来` : '明天再来收一张',
      btn: ''
    };
  }
  // 服务端给了数字才说具体数字，没给就只说「有积分」—— 宁可少说一句，不说错一句
  const base = (s && s.base) || 0;
  return {
    title: '今日时光签',
    sub: streak > 0
      ? (base
        ? `连签 ${streak} 天 · 再收一张得 ${base} 积分`
        : `连签 ${streak} 天 · 再收一张有积分`)
      : '每天来收一张 · 攒积分换 AI 重绘',
    btn: '收下'
  };
}

/** 签到成功的反馈：命中连签阶梯时说得更重一点 —— 那才是用户该记住的一天 */
function rewardText(r) {
  const streak = (r && r.milestone) || 0;
  if (r && r.art) return `连签 ${streak} 天 · 已送你 ${r.art} 次 AI 重绘`;
  if (streak) return `连签 ${streak} 天 · 积分 +${(r && r.points) || 0}`;
  const pts = (r && r.points) || 0;
  return pts ? `积分 +${pts}` : '积分已到账';
}

module.exports = { status, checkIn, bannerText, rewardText };
