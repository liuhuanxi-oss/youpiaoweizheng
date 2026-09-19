// saveTicket/tracklog.js —— 8.1.3 埋点落云通道（端上的第二条命）
// ============================================================
// 【为什么要有它】8.1.3 之前，端上 49 个事件只走 wx.reportEvent 一条路，
//   而那条路**必须先有人在 mp 后台把同名事件建出来**，否则静默丢弃（见 utils/track.js 顶部）。
//   后台一个都没建 → 上线至今的埋点数据全是空的，且丢了的补不回来。
//   这里落一份到自己的库里：**不依赖后台配置**，事件发出来就存得下。
//
// 【与官方自定义分析的分工】不是替代关系：
//   官方那条有留存/漏斗看板、有平台口径的 UV，留着；这条用于「想按任意维度查一下」，
//   以及后台漏配某个事件时不至于两眼一抹黑。
//
// 【端上传来的东西一律不可信】这是全项目唯一一个「端上想写多少就写多少」的入口
//   （别的 action 都是一张票、一条提醒这种有明确归属的写）。所以这里把它当**外部输入**：
//   事件名、参数、时间戳逐条校验，单次条数封顶，单用户单日总量封顶。
//   校验不过的行**丢弃而不是报错** —— 埋点出问题不该让用户看见任何东西。
//
//   文档形态（events 集合）：{ _openid, e 事件名, d 参数, t 端上时间, at 入库时间, ver 版本 }
//   计数文档（prefs，一人一条）：{ _openid, type:'track', ymd, n, updatedAt }
// ============================================================

const TRACK_MAX_ROWS = 50;          // 单次最多收多少条（端上按这个数切批）
const TRACK_MAX_PER_DAY = 2000;     // 单用户单日上限。正常用户一天几十条，刷不到这个数；
                                    // 恶意端想拿它当归档接口，超了就是丢，不是拒。
const TRACK_AGE_MAX = 7 * 86400000; // 只收 7 天以内的（端上本地缓冲最长也就这些）
const TRACK_AHEAD = 3600000;        // 允许 1 小时的时钟偏差
const NAME_RE = /^[a-z][a-z0-9_]{1,39}$/; // 事件名口径：小写蛇形（铁律 6）
const MAX_KEYS = 6;                 // 单个事件的参数个数上限
const MAX_VAL = 60;                 // 单个参数值上限（与端上 track.js 的裁剪一致）

/** 北京时间的「今天」'YYYY-MM-DD' —— 与 recall.bjYmd 同一套 UTC+8 口径（3 行，不值得跨模块依赖） */
function bjYmd(now) {
  const n = new Date((Number(now) || Date.now()) + 8 * 3600 * 1000);
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-${String(n.getUTCDate()).padStart(2, '0')}`;
}

/**
 * 逐条清洗端上送来的行：形状不对的直接丢。
 * 丢的时候**不告诉端上哪条错了**（也没法告诉 —— 客户端只收一个 saved 计数），
 * 所以这里的原则是「宁可少收，不可放宽」：一个字段存进来容易，事后清理难。
 * @param {Array} rows 端上送来的原始数组
 * @returns {Array<{e:string,d:object,t:number}>}
 */
function cleanRows(rows) {
  const now = Date.now();
  const out = [];
  const list = Array.isArray(rows) ? rows.slice(0, TRACK_MAX_ROWS) : [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const e = String(r.e || '');
    if (!NAME_RE.test(e)) continue;
    const t = Number(r.t) || 0;
    if (!t || t > now + TRACK_AHEAD || t < now - TRACK_AGE_MAX) continue; // 时间戳越界 = 改过表，丢
    const src = (r.d && typeof r.d === 'object') ? r.d : {};
    const d = {};
    Object.keys(src).slice(0, MAX_KEYS).forEach((k) => {
      const v = src[k];
      d[String(k).slice(0, 24)] = (typeof v === 'number' && isFinite(v))
        ? v
        : String(v == null ? '' : v).slice(0, MAX_VAL);
    });
    out.push({ e, d, t });
  }
  return out;
}

/**
 * 落库（action: trackBatch）。端上在离开小程序、或本地攒够一批时调用。
 * 返回体只给计数：端上按「ok 就把送出去的那批从本地缓冲删掉」处理，
 * 被丢的行（脏数据、超配额）同样算「送出去过」，不留在本地反复重试。
 * @param {object} db 云数据库实例
 * @param {string} OPENID
 * @param {object} event { rows, ver }
 */
async function save(db, OPENID, event) {
  try {
    if (!OPENID) return { ok: false, msg: '请先登录' };
    const rows = cleanRows(event && event.rows);
    if (!rows.length) return { ok: true, saved: 0 }; // 整批无效 = 正常情况，不是错误

    const now = Date.now();
    const ymd = bjYmd(now);
    const prefs = db.collection('prefs');
    const rec = await prefs.where({ _openid: OPENID, type: 'track' }).limit(1).get();
    const c = rec.data && rec.data[0];
    const used = (c && c.ymd === ymd) ? Math.max(0, Number(c.n) || 0) : 0; // 跨天自动归零
    const allow = TRACK_MAX_PER_DAY - used;
    if (allow <= 0) return { ok: true, saved: 0, over: 1 }; // 超了就静默丢：埋点不该给端上任何反馈

    const take = rows.slice(0, allow);
    const docs = take.map((r) => ({
      _openid: OPENID,
      e: r.e,
      d: r.d,
      t: r.t,
      at: now,
      ver: String((event && event.ver) || '').slice(0, 16)
    }));
    await db.collection('events').add({ data: docs });
    // 计数写在入库之后：宁可少数一次（多放几条进来），也不要计数涨了而数据没落库
    const counter = { ymd, n: used + take.length, updatedAt: now };
    if (c) await prefs.doc(c._id).update({ data: counter });
    else await prefs.add({ data: Object.assign({ _openid: OPENID, type: 'track', createdAt: now }, counter) });
    return { ok: true, saved: take.length, dropped: rows.length - take.length };
  } catch (e) {
    return { ok: false, msg: '埋点落库失败：' + String((e && e.message) || e).slice(0, 60) };
  }
}

module.exports = { save, cleanRows, bjYmd, TRACK_MAX_ROWS, TRACK_MAX_PER_DAY, TRACK_AGE_MAX };
