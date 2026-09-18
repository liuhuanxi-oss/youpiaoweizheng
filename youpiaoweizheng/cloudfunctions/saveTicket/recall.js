// saveTicket/recall.js —— 7.4.0 C2 订阅消息召回（R5）
// ============================================================
// 【为什么是「次日召回」而不是「每日推送」】
//   小程序订阅消息（服务类目不够格申请长期订阅）是**一次授权、一次下发**：
//   用户在签到时点一次「允许」，只换来一条消息的额度。所以做不到天天自动推 ——
//   真做成了「每日提醒」的开关，第二天它不会来，第三天线就断了。
//   真实闭环：签到时授权 → 次日 09:00 发一条「今天的时光签还没收下」→ 用户回来再授权。
//
//   type='recall' 文档（一人一条，重复授权复用同一条）：
//     { _openid, type, tmplId, streak, sendAt, status, tries, err, updatedAt }
//     status: 'pending' 待发 / 'sent' 已送达 / 'dead' 终局失败（重试也不会成）
//
// 【三道闸门】
//   ① 模板 ID 由端上带来；端上没配置就连授权弹窗都不弹，这里自然不会有记录；
//   ② 发送窗口限定北京时间 07:00–22:00 —— 定时器万一半夜才跑起来，不能把人吵醒。
//      不在窗口内是**留着**（下一跳再发），不是丢弃；
//   ③ 失败最多重试 3 次；43101（无授权额度）/ 47003（模板字段对不上）是终局错误，
//      直接结案 —— 这两种重试一百次也是同一个结果，只会把日志刷满。
//
// 【为什么定时器是「每小时」而不是「每天 9 点」】
//   腾讯云定时触发器的 cron 时区口径没有明写在文档里，赌它等于北京时间是没必要的风险：
//   每小时跑一次 + 代码里按北京时间判断窗口，「哪个时区」就只影响在第几分钟跑，
//   而 9 点那条消息最多晚一小时，用户感知不到。
// ============================================================

const RECALL_HOUR = 9;             // 次日几点发（北京时间）
const RECALL_WINDOW = [7, 22];     // 允许发送的北京时间小时区间（含 7，不含 22）
const RECALL_TRIES_MAX = 3;        // 单条最多尝试几次
const RECALL_BATCH = 100;          // 单轮最多处理多少条（云函数端单次查询上限 100）
/** 消息点开进哪个版本：'formal' 正式版 / 'trial' 体验版 / 'developer' 开发版。
 *  7.4.1 尚未发布时联调请改成 'trial'，否则点开的是线上那个更旧的版本。 */
const RECALL_MP_STATE = 'formal';
/** 消息点开的页面（时光签横条在首页顶部） */
const RECALL_PAGE = 'pages/home/home';

/** 北京时间的整点小时（0–23）——与 pay.ymdNow 同一套 UTC+8 口径 */
function beijingHour(now) {
  return new Date((Number(now) || Date.now()) + 8 * 3600 * 1000).getUTCHours();
}

/**
 * 这条提醒该在什么时候发：授权次日 09:00（北京时间）对应的时间戳。
 * 深夜 23:50 授权也是次日 09:00 —— 不做「不足 N 小时就顺延一天」，
 * 那种规则用户看不懂，而且「明天早上提醒你」本来就是他要的。
 */
function sendAtOf(now) {
  const d = new Date((Number(now) || Date.now()) + 8 * 3600 * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, RECALL_HOUR - 8, 0, 0, 0);
}

/**
 * 消息内容。字段名与 MP 后台那个模板逐字对应：
 *   phrase1 = 签到状态 ／ number2 = 连续签到天数
 *
 * ⚠️ 两条写错就静默失效、端上完全看不出来的硬规矩：
 *   ① 字段名与类型**必须与后台模板逐字一致**，对不上 send 返回 47003。
 *   ② **phrase 类型上限 5 个汉字**。这条提醒只会在「今天还没签」时发出，
 *      所以状态恒为「还未签到」（4 字）；当初那句 10 字的文案放不进去。
 *   ③ number 类型只吃数字字符串，位数上限 32。
 */
function dataOf(streak) {
  const n = Number(streak) || 0;
  return {
    phrase1: { value: '还未签到' },
    number2: { value: String(n) }
  };
}

/**
 * 端上授权成功后回报（action: recallSave）。
 * 一人一条：重复授权只更新同一条（堆文档不如省一次查询）。
 * 这里只记「明天要发」，**不校验真假**——授权结果只有微信知道，
 * 端上说「用户点了允许」就信它：记错的代价是发的时候返回 43101，
 * 而为此加一道校验反而会挡住真实用户。
 */
async function save(db, OPENID, event) {
  try {
    const tmplId = String((event && event.tmplId) || '').trim();
    if (!tmplId) return { ok: false, msg: '模板 ID 为空' };
    const now = Date.now();
    const data = {
      type: 'recall',
      tmplId: tmplId.slice(0, 128),
      streak: Math.max(0, Math.min(Number(event && event.streak) || 0, 9999)),
      sendAt: sendAtOf(now),
      status: 'pending',
      tries: 0,
      err: '',
      updatedAt: now
    };
    const col = db.collection('prefs');
    const rec = await col.where({ _openid: OPENID, type: 'recall' }).limit(1).get();
    const d = rec.data && rec.data[0];
    if (d) await col.doc(d._id).update({ data });
    else await col.add({ data: Object.assign({ _openid: OPENID, createdAt: now }, data) });
    return { ok: true, sendAt: data.sendAt };
  } catch (e) {
    return { ok: false, msg: '记录提醒失败：' + String((e && e.message) || e).slice(0, 60) };
  }
}

/**
 * 发一轮召回。定时触发器与 opsRecall 共用这一份逻辑（两处各写一遍必然走样）。
 * @param {object} db 云数据库实例
 * @param {object} cloud wx-server-sdk（用它的 openapi）
 * @param {object} [opts] { dryRun: true } 只列将发送的名单、不真发（联调与验收用）
 */
async function run(db, cloud, opts) {
  const dryRun = !!(opts && opts.dryRun);
  const out = {
    ok: true, dryRun, hour: beijingHour(), scanned: 0,
    sent: 0, dead: 0, retry: 0, list: [], errors: []
  };
  const hour = out.hour;
  if (hour < RECALL_WINDOW[0] || hour >= RECALL_WINDOW[1]) {
    out.msg = `北京时间 ${hour} 点不在发送窗口（${RECALL_WINDOW[0]}–${RECALL_WINDOW[1]}），留到下一跳`;
    return out;
  }
  const _ = db.command;
  const col = db.collection('prefs');
  const res = await col
    .where({ type: 'recall', status: 'pending', sendAt: _.lte(Date.now()) })
    .limit(RECALL_BATCH)
    .get();
  const rows = (res.data || []).filter((r) => (r.tries || 0) < RECALL_TRIES_MAX);
  out.scanned = rows.length;

  for (const r of rows) {
    if (dryRun) {
      out.list.push({ openid: String(r._openid || '').slice(0, 8) + '…', sendAt: r.sendAt, streak: r.streak });
      continue;
    }
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: r._openid,
        templateId: r.tmplId,
        page: RECALL_PAGE,
        lang: 'zh_CN',
        miniprogramState: RECALL_MP_STATE,
        data: dataOf(r.streak)
      });
      await col.doc(r._id).update({ data: { status: 'sent', sentAt: Date.now(), err: '' } });
      out.sent++;
    } catch (e) {
      const code = (e && (e.errCode || e.errcode)) || 0;
      const msg = String((e && (e.errMsg || e.message)) || e).slice(0, 120);
      // 43101 用户没有授权额度（拒绝过 / 额度已用完）；47003 模板字段对不上 ——
      // 这两个重试没有意义，结案留痕即可；其它（网络抖动等）留着下一跳再试。
      const dead = code === 43101 || code === 47003 || (r.tries || 0) + 1 >= RECALL_TRIES_MAX;
      await col.doc(r._id).update({
        data: { status: dead ? 'dead' : 'pending', tries: (r.tries || 0) + 1, err: code + ':' + msg }
      });
      if (dead) out.dead++; else out.retry++;
      if (out.errors.length < 5) out.errors.push(code + ':' + msg);
    }
  }
  return out;
}

module.exports = { sendAtOf, beijingHour, dataOf, save, run, RECALL_HOUR, RECALL_WINDOW, RECALL_TRIES_MAX };
