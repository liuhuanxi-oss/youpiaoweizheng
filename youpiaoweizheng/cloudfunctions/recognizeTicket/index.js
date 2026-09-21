// recognizeTicket/index.js —— 识别云函数
// 链路：前端上传图片到云存储 → 本函数下载 → OCR → 规则解析
//      → 返回结构化草稿给前端确认。
// OCR：微信云调用 openapi.ocr.printedText（需服务市场配额）。
//   4.9.0 曾并过一条百度智能云「通用文字识别」通道（每月 1000 次免费），
//   但密钥一直没填、从未启用；2026-09-21 把整条通道删掉，只留微信这一条。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const parser = require('./parser.js');

// ---------- OCR 通道（云调用，免密钥，需服务市场配额） ----------
async function wxOcr(imgBuffer) {
  const ocr = await cloud.openapi.ocr.printedText({
    img: { contentType: 'image/jpeg', value: imgBuffer }
  });
  return (ocr.items || []).map((i) => String(i.text || '').trim()).filter(Boolean);
}

// ============================================================
// P2-11 调用者与频次闸门
// ------------------------------------------------------------
// 这个函数每被调一次就是一次真实开销（微信云调用的服务市场配额是有限量的）。
// 原实现既不校验调用者、也不记次数：一个脚本循环 callFunction 就能把整月额度刷光，
// 之后**正常用户拍照全变成「识别失败」**，而我们连是谁刷的都查不到。
// 两道闸：
//   ① 调用者必须是小程序端用户（OPENID 由 getWXContext 注入，端上伪造不了）；
//      控制台/HTTP 直调没有 OPENID —— 那类调用连对象都不是，直接拒（要联调就临时注释这行）。
//   ② 每人每天 OCR_DAILY_LIMIT 次。正常用户一天用不到 5 次，30 是留给「反复拍不清楚」的余量。
// 注：时限不住「多开微信号」这种刷法，但把敞口从「无限」压到「按人头」，这是当前
// 没有风控体系时能做的最小一步（真要再收紧，得上微信侧的实名/设备维度）。
// ============================================================
const OCR_DAILY_LIMIT = 30;

/** 北京时间日期串（与 saveTicket 的 pay.ymdNow 同口径；两个云函数各自部署，不共享模块） */
function bjYmd() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * 当日额度原子抢占：条件更新「今天还没到上限」才 +1，抢不到即超限。
 * 首次调用没有文档可抢 → 用固定 _id 建一条；并发首调时后来的那个会撞主键，
 * 落进 catch 再抢一次条件更新（用固定 _id 正是为了让这场竞态有个确定的输赢）。
 * @returns {Promise<{ok:true}|{ok:false,msg:string}>}
 */
async function claimDailyQuota(db, openid) {
  const _ = db.command;
  const col = db.collection('prefs');
  const ymd = bjYmd();
  const hit = await col.where({ _openid: openid, type: 'ocr_day', ymd, count: _.lt(OCR_DAILY_LIMIT) })
    .update({ data: { count: _.inc(1), updatedAt: Date.now() } });
  if (hit && hit.stats && hit.stats.updated) return { ok: true };
  const cur = await col.where({ _openid: openid, type: 'ocr_day', ymd }).limit(1).get();
  const doc = cur.data && cur.data[0];
  // 有条件更新却没命中：要么今天到顶了，要么这次更新本身抖动失败（文档里的 count 还没到顶）。
  // 后者宁可放行一次，也不把用户挡在门外 —— 这里是成本闸门，不是风控闸门。
  if (doc) return (doc.count || 0) < OCR_DAILY_LIMIT
    ? { ok: true }
    : { ok: false, msg: '今天的识别次数用完了，明天再来' };
  try {
    await col.add({
      data: {
        _id: 'ocr_' + openid + '_' + ymd, _openid: openid, type: 'ocr_day',
        ymd, count: 1, createdAt: Date.now(), updatedAt: Date.now()
      }
    });
    return { ok: true };
  } catch (e) {
    // add 失败有两种可能：并发首调（文档刚被别人建好）与库本身出问题。
    // 必须分开 —— 一律当成「到顶了」的话，一次数据库抖动就会让所有用户看到
    // 「今天的识别次数用完了」，那是把我们的故障说成用户用超了。
    const retry = await col.where({ _openid: openid, type: 'ocr_day', ymd, count: _.lt(OCR_DAILY_LIMIT) })
      .update({ data: { count: _.inc(1), updatedAt: Date.now() } });
    if (retry && retry.stats && retry.stats.updated) return { ok: true };
    const after = await col.where({ _openid: openid, type: 'ocr_day', ymd }).limit(1).get();
    if (after.data && after.data[0]) return { ok: false, msg: '今天的识别次数用完了，明天再来' };
    throw e; // 读都读不到 = 库的问题 → 交给外层按「服务出了点问题」处理（配额闸门宁可放行）
  }
}

// ---------- 主流程 ----------
exports.main = async (event) => {
  const { fileID } = event;
  if (!fileID) return { ok: false, msg: '缺少 fileID' };
  // 4.18.0 P2：fileID 白名单——downloadFile 只允许读本环境云存储路径，
  // 防伪造 fileID 触发异常下载/探测（云函数端是管理员权限，必须自己限权）。
  if (!/^cloud:\/\/[\w-]+\.[^/]+\//.test(String(fileID))) {
    return { ok: false, msg: 'fileID 格式不合法' };
  }
  // P2-11：调用者闸门（端上调用才带 OPENID）+ 每人每日配额
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, msg: '请在小程序内使用识别功能' };
  try {
    const gate = await claimDailyQuota(cloud.database(), OPENID);
    if (!gate.ok) return gate;
    // 1. 从云存储下载原图
    const dl = await cloud.downloadFile({ fileID });
    const imgBuffer = Buffer.from(dl.fileContent);

    // 2. OCR
    let lines = [];
    const errs = [];
    try {
      lines = await wxOcr(imgBuffer);
    } catch (e) {
      errs.push(e.errMsg || e.message || e);
    }

    // 3. 提取文本行
    if (!lines.length) {
      // 有报错 = 通道问题；无报错 = 图里确实没字
      if (errs.length) {
        return { ok: false, msg: 'OCR 识别失败（' + errs.join('；') + '）' };
      }
      return { ok: false, msg: '没有识别到文字，试试对焦更近、光线更亮？' };
    }

    // 4. 规则解析 → 结构化草稿
    const draft = parser.parse(lines);
    return { ok: true, draft, lines };
  } catch (e) {
    // 细节只进日志（P2-4）：SDK 的 message 里带着云存储路径与内部结构，端上除了吓人没用
    console.error('[ocr] 识别异常', OPENID, (e && (e.errMsg || e.message)) || e);
    return { ok: false, msg: '识别服务出了点问题，稍后再试' };
  }
};
