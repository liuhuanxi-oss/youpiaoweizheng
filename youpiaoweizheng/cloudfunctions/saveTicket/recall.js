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
//   8.1.2 拉新 6/6 加了**第二种**，同一张表、同一条定时器，靠 type 分开：
//   type='anniv' 文档（一人一条）：{ _openid, type, tmplId, ymd, years, title, ticketId,
//     sendAt, status, tries, err, updatedAt }
//   两处不同，别混：① 它只在 ymd **就是今天**时发（过期就地结案，不补发）；
//   ② 消息字段走 annivData（另一个模板），落页是那张票的详情页。
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
// ── 8.1.2 拉新 6/6：周年提醒（同一条定时器、同一张表，靠 type 区分）──
const ANNIV_HOUR = 9;              // 周年当天几点发（北京时间，与召回同点）
const ANNIV_AHEAD_DAYS = 60;       // 云端只做边界校验：端上窗口 30 天，这里放宽到 60（容忍时钟偏差）
const ANNIV_PAGE = 'pages/detail/detail'; // 点开落在**那张票**的详情页（票没了就是「不在册子」空态）
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

/** 北京时间的「今天」'YYYY-MM-DD' —— 周年提醒靠它判断「是不是就是今天」（与 beijingHour 同一套） */
function bjYmd(now) {
  const n = new Date((Number(now) || Date.now()) + 8 * 3600 * 1000);
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-${String(n.getUTCDate()).padStart(2, '0')}`;
}

/**
 * 'YYYY-MM-DD' → 北京时间那天的 00:00（时间戳）；格式不对、或那一天根本不存在返回 0。
 * 云端**自己再算一遍**，不信端上送来的东西：这一条要拿去排发送时刻，
 * 端上算错（或改包）会让提醒排到明年去，而消息文案说的是「今天满 N 周年」。
 */
function bjDayStart(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return 0;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return 0;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (d > dim) return 0;
  return Date.UTC(y, mo - 1, d) - 8 * 3600 * 1000;
}

/** thing 类型上限 20 个字符：超了微信拒收（47003）且端上毫无提示，所以在服务端裁 */
function clip20(s) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length <= 20 ? t : t.slice(0, 19) + '…';
}

/** '2026-08-12' + 9 → '2026年08月12日 09:00'（time 类型要的格式） */
function cnTime(ymd, hour) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${m[1]}年${m[2]}月${m[3]}日 ${String(hour).padStart(2, '0')}:00` : '';
}

/**
 * 周年提醒的消息内容。字段名与 MP 后台那个「纪念日提醒」模板逐字对应：
 *   thing1 = 纪念日名称 ／ time2 = 日期 ／ thing3 = 备注 ／ thing4 = 提醒对象
 * 对不上同样是 47003 静默失效 —— 改这里必须与后台一起改。
 */
function annivData(row) {
  const years = Math.max(1, Math.min(Number(row && row.years) || 1, 999));
  return {
    thing1: { value: clip20(row && row.title) || '一张票根' },      // 票名（用户自己写的，已在入库时过内容安全）
    time2: { value: cnTime(row && row.ymd, ANNIV_HOUR) },           // 那个周年日
    thing3: { value: clip20(`今天满 ${years} 周年，点开回到这张票`) }, // 备注
    thing4: { value: '你' }                                          // 提醒对象
  };
}

/**
 * 端上授权成功后回报（action: annivSave）——排上「周年日那天早上」的一条。
 * 一人一条，与召回同规矩：重复设置只更新同一条（堆文档不如省一次查询）。
 * 落页带上票 id，点开回到那张票；id 不合规就退回首页（不把一个来路不明的串塞进 page）。
 */
async function annivSave(db, OPENID, event) {
  try {
    const tmplId = String((event && event.tmplId) || '').trim();
    if (!tmplId) return { ok: false, msg: '模板 ID 为空' };
    const ymd = String((event && event.ymd) || '').trim();
    const day0 = bjDayStart(ymd);
    if (!day0) return { ok: false, msg: '日期不合法：' + ymd.slice(0, 12) };
    const days = Math.round((day0 - bjDayStart(bjYmd())) / 86400000);
    if (days < 1 || days > ANNIV_AHEAD_DAYS) {
      return { ok: false, msg: `不在可排范围内（${days} 天）` };
    }
    const id = String((event && event.id) || '').trim();
    const now = Date.now();
    const data = {
      type: 'anniv',
      tmplId: tmplId.slice(0, 128),
      ymd,
      years: Math.max(1, Math.min(Number((event && event.years) || 0) || 1, 999)),
      title: clip20(event && event.title),
      ticketId: /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : '',
      sendAt: day0 + ANNIV_HOUR * 3600 * 1000,
      status: 'pending',
      tries: 0,
      err: '',
      updatedAt: now
    };
    const col = db.collection('prefs');
    const rec = await col.where({ _openid: OPENID, type: 'anniv' }).limit(1).get();
    const d = rec.data && rec.data[0];
    if (d) await col.doc(d._id).update({ data });
    else await col.add({ data: Object.assign({ _openid: OPENID, createdAt: now }, data) });
    return { ok: true, sendAt: data.sendAt, ymd };
  } catch (e) {
    return { ok: false, msg: '排提醒失败：' + String((e && e.message) || e).slice(0, 60) };
  }
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
    .where({ type: _.in(['recall', 'anniv']), status: 'pending', sendAt: _.lte(Date.now()) })
    .limit(RECALL_BATCH)
    .get();
  const rows = (res.data || []).filter((r) => (r.tries || 0) < RECALL_TRIES_MAX);
  out.scanned = rows.length;
  const today = bjYmd();

  for (const r of rows) {
    const isAnniv = r.type === 'anniv';
    if (dryRun) {
      out.list.push({
        openid: String(r._openid || '').slice(0, 8) + '…',
        kind: r.type, sendAt: r.sendAt, streak: r.streak, ymd: r.ymd
      });
      continue;
    }
    // 周年提醒**只在那一天发**：云函数停了一整天再跑起来，补发出去的那句
    // 「今天满 N 周年」就成了假话（召回的「留到下一跳」不一样，那条晚一天也还算实话）。
    // 过期就地结案，不补发、也不重试。
    if (isAnniv && String(r.ymd || '') !== today) {
      await col.doc(r._id).update({ data: { status: 'dead', err: 'expired:' + String(r.ymd || '') } });
      out.dead++;
      continue;
    }
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: r._openid,
        templateId: r.tmplId,
        page: isAnniv ? ANNIV_PAGE + (r.ticketId ? '?id=' + r.ticketId : '') : RECALL_PAGE,
        lang: 'zh_CN',
        miniprogramState: RECALL_MP_STATE,
        data: isAnniv ? annivData(r) : dataOf(r.streak)
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

module.exports = {
  sendAtOf, beijingHour, dataOf, save, run,
  RECALL_HOUR, RECALL_WINDOW, RECALL_TRIES_MAX,
  // 8.1.2 拉新 6/6 周年提醒
  annivSave, annivData, bjYmd, bjDayStart, cnTime, clip20,
  ANNIV_HOUR, ANNIV_AHEAD_DAYS, ANNIV_PAGE
};
