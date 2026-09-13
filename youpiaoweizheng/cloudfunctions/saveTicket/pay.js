// cloudfunctions/saveTicket/pay.js —— 4.20.0 虚拟支付服务端模块
// ============================================================
// 官方链路（developers.weixin.qq.com 虚拟支付文档，2026-09 精读核对）：
//   前端 wx.requestVirtualPayment({ signData, paySig, signature, mode:'short_series_goods' })
//   paySig    = HMAC-SHA256(appKey,      'requestVirtualPayment&' + signData) —— 服务端持有 AppKey
//   signature = HMAC-SHA256(sessionKey,  signData)                            —— session_key 来自 authLogin(code2Session)
//   发货推送 Event = 'xpay_goods_deliver_notify'（消息推送 → 云函数），必须幂等；
//   官方推荐「推送分支 + 主动查单分支」至少实现一个、两者结合更可靠（success 回调可能丢失）
// 凭证来源：云开发控制台 → 数据库 → config 集合 → 文档 _id:'pay_secret'
//   { offerId, appKey, appKeySandbox, appSecret, env }  env: 0=现网 1=沙箱
//   【沙箱与现网是两个不同的 AppKey】env=1 优先取 appKeySandbox（缺省回退 appKey）
//   集合权限设为「仅管理端可读写」；绝不硬编码进代码仓库
// 踩坑备忘：goodsPrice 单位是「分」；道具发布后约 10 分钟才生效；iOS 不支持沙箱、
//   现网有最低金额限制（≥1 元）；-15003=价格不匹配 -15002=道具不存在/未发布 -15011=沙箱未授权
// 服务器 API（/xpay/query_order）不支持云调用：HTTPS + stable_token + pay_sig 上 query；
//   query_order 的 order.status 枚举：2=已支付待发货 3=发货中 4=已发货 5=已退款 8=用户退款完成
// ============================================================
const crypto = require('crypto');
const https = require('https');

const FREE_PER_MONTH = 3; // 与前端 art.js 一致：每自然月免费幅数
const PRODUCTS = {
  ART_PACK_10: { priceFen: 600, quota: 10, name: '图版次数包 · 10 幅' }
};

// 6.6.3（P2-5）：显式按北京时间（UTC+8）计算——云函数运行环境 TZ 可能是 UTC，
// 旧实现用本地时间会让「自然月免费额度重置」在北京时间早 8 点才翻篇（与产品口径不符）。
// 偏移 8 小时后再取 UTC 年月，即北京时间口径，与运行环境 TZ 解耦。
function bjNow() {
  return new Date(Date.now() + 8 * 3600 * 1000);
}
function ymNow() {
  const d = bjNow();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * 7.4.0：北京时间的日期串 YYYY-MM-DD（与 ymNow 同一口径，供每日签到判重/连签使用）。
 * offsetDays 可偏移：-1 = 昨天（判「昨天签过没」决定连签 +1 还是归 1）。
 */
function ymdNow(offsetDays) {
  const d = new Date(Date.now() + 8 * 3600 * 1000 + (Number(offsetDays) || 0) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function hmacSha256(key, msg) {
  return crypto.createHmac('sha256', String(key)).update(String(msg)).digest('hex');
}

/** 读支付配置（config 集合 pay_secret doc）；未配置/不完整 → null */
async function loadPayConfig(db) {
  try {
    const res = await db.collection('config').doc('pay_secret').get();
    const c = res && res.data;
    if (!c || !c.offerId || !c.appKey || !c.appSecret) return null;
    return c;
  } catch (e) {
    return null;
  }
}

/** 按环境选 AppKey：官方「沙箱 AppKey 与现网 AppKey」是两个不同的值 */
function pickAppKey(cfg, env) {
  const e = Number(env) || 0;
  if (e === 1 && cfg.appKeySandbox) return cfg.appKeySandbox;
  return cfg.appKey;
}

/** 订单微信侧状态 → 是否已支付（2 待发货 / 3 发货中 / 4 已发货 都算已付） */
function isPaidStatus(wxStatus) {
  const s = Number(wxStatus);
  return s >= 2 && s <= 4;
}

/** POST JSON 的最小 HTTPS 实现（5s 超时护栏；微信服务器 API 与 stable_token 共用） */
function httpsPost(url, bodyObj) {
  return new Promise((resolve) => {
    const data = JSON.stringify(bodyObj);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { resolve({ errcode: -1, errmsg: 'bad json' }); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('httpsPost timeout')));
    req.on('error', (e) => resolve({ errcode: -1, errmsg: String((e && e.message) || e) }));
    req.write(data);
    req.end();
  });
}

/**
 * stable_token（官方推荐的稳定版接口调用凭证，与普通 access_token 独立不互相顶替）
 * 6.6.3（P2-10）：加内存缓存 + 在途请求去重。
 * 旧实现每次查单都重新请求 stable_token：单次约 200~900ms，而微信侧 token 有效期通常
 * 7200s。高峰期对账/查询会为同一个 token 反复往返，是支付链路最大的固定延迟来源。
 * 缓存按 appId 分槽（本项目双 AppKey，不能互相覆盖），并预留 10 分钟安全边界；
 * 同一 appId 的并发调用共享同一个在途 Promise，避免「缓存击穿」时同时打多个请求。
 */
const TOKEN_SAFE_MARGIN = 10 * 60 * 1000; // 过期前 10 分钟就刷新，避开边界抖动
const _tokenCache = {};   // appId -> { token, expiresAt }
const _tokenPending = {}; // appId -> Promise（在途请求）

async function getStableToken(appId, appSecret) {
  const now = Date.now();
  const hit = _tokenCache[appId];
  if (hit && hit.token && hit.expiresAt > now) return { token: hit.token, cached: true };
  // 缓存击穿保护：同一 appId 已有在途请求时直接复用
  if (_tokenPending[appId]) return _tokenPending[appId];

  const task = (async () => {
    const r = await httpsPost('https://api.weixin.qq.com/cgi-bin/stable_token', {
      grant_type: 'client_credential', appid: appId, secret: appSecret
    });
    if (r && r.access_token) {
      // expires_in 默认按 7200s 兜底；减去安全边界，最短也保底缓存 60s，避免负数立即过期
      const ttl = Math.max((Number(r.expires_in) || 7200) * 1000 - TOKEN_SAFE_MARGIN, 60 * 1000);
      _tokenCache[appId] = { token: r.access_token, expiresAt: Date.now() + ttl };
      return { token: r.access_token };
    }
    return { err: (r && (r.errmsg || r.errcode)) || 'token failed' };
  })();

  _tokenPending[appId] = task;
  try {
    return await task;
  } finally {
    delete _tokenPending[appId];
  }
}

/**
 * 微信侧查单（/xpay/query_order，对账兜底用）。
 * 签名口径（官方 2.4/2.6）：pay_sig = hmac(appKey, uri + '&' + body)；signature = hmac(sessionKey, body)；
 * 签名与请求必须用同一个 body 字符串（键序一致）。
 * @returns {Promise<{ok:boolean, paid?:boolean, refunded?:boolean, status?:number, paidFee?:number, err?:string}>}
 */
async function queryOrderOnWx(appId, cfg, openid, sessionKey, outTradeNo) {
  try {
    const env = Number(cfg.env) || 0;
    const t = await getStableToken(appId, cfg.appSecret);
    if (!t.token) return { ok: false, err: String(t.err).slice(0, 60) };
    const body = JSON.stringify({ openid, env, order_id: outTradeNo });
    const uri = '/xpay/query_order';
    const paySig = hmacSha256(pickAppKey(cfg, env), uri + '&' + body);
    const sig = hmacSha256(sessionKey, body);
    const url = `https://api.weixin.qq.com${uri}?access_token=${encodeURIComponent(t.token)}&pay_sig=${paySig}&signature=${sig}`;
    const r = await httpsPost(url, JSON.parse(body));
    if (!r || r.errcode) return { ok: false, err: String((r && (r.errmsg || r.errcode)) || 'query failed').slice(0, 60) };
    const o = r.order || {};
    return { ok: true, paid: isPaidStatus(o.status), refunded: Number(o.status) === 5 || Number(o.status) === 8, status: Number(o.status) || 0, paidFee: Number(o.paid_fee) || 0 };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e).slice(0, 60) };
  }
}

/** code2Session：wx.login 的 code → openid + session_key（官方 HTTPS，5s 超时护栏） */
function code2Session(appId, appSecret, code) {
  return new Promise((resolve) => {
    const url =
      'https://api.weixin.qq.com/sns/jscode2session?appid=' + encodeURIComponent(appId) +
      '&secret=' + encodeURIComponent(appSecret) +
      '&js_code=' + encodeURIComponent(code) +
      '&grant_type=authorization_code';
    const req = https.get(url, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { resolve({ errcode: -1, errmsg: 'bad json' }); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('code2Session timeout')));
    req.on('error', (e) => resolve({ errcode: -1, errmsg: String((e && e.message) || e) }));
  });
}

/** 订单号：YP + 时间戳 + 随机段（回调按 outTradeNo 幂等对账） */
function makeOutTradeNo() {
  return 'YP' + Date.now() + Math.random().toString(36).slice(2, 8).toUpperCase();
}

/** 额度文档（prefs 集合 type='art_quota'，每用户一份；服务端权威记账） */
async function loadQuota(db, openid) {
  const col = db.collection('prefs');
  try {
    const res = await col.where({ _openid: openid, type: 'art_quota' }).limit(1).get();
    const d = res.data && res.data[0];
    if (d) {
      if (d.ym !== ymNow()) {
        // 跨月：免费额度重置（付费次数不清零）
        await col.doc(d._id).update({ data: { ym: ymNow(), freeUsed: 0, updatedAt: Date.now() } });
        d.ym = ymNow();
        d.freeUsed = 0;
      }
      return d;
    }
  } catch (e) { /* 落新建 */ }
  const ym = ymNow();
  const added = await col.add({
    data: { _openid: openid, type: 'art_quota', ym: ym, freeUsed: 0, paid: 0, bonus: 0, updatedAt: Date.now() }
  });
  // 6.6.5：并发首次调用可能各自 add 出一条额度文档（同一用户两份额度）→ 后续 limit(1) 随机取一份，
  // 出现「扣 A 读 B」的额度错乱。插入后再查一次全部候选，取 _id 最小者为准，删掉多余的自己。
  try {
    const dup = await col.where({ _openid: openid, type: 'art_quota' }).limit(20).get();
    const rows = ((dup && dup.data) || []).slice().sort((a, b) => String(a._id).localeCompare(String(b._id)));
    if (rows.length > 1) {
      const keep = rows[0];
      if (String(keep._id) !== String(added._id)) {
        await col.doc(added._id).remove().catch(() => {});
        return Object.assign({ ym: ym, freeUsed: 0, paid: 0, bonus: 0 }, keep);
      }
      // 自己就是最小者 → 清理其余兄弟文档（并发残留），保证全局只剩一份
      for (let i = 1; i < rows.length; i++) {
        await col.doc(rows[i]._id).remove().catch(() => {});
      }
    }
  } catch (e) { /* 去重失败不影响主链路 */ }
  return { _id: added._id, ym: ym, freeUsed: 0, paid: 0, bonus: 0 };
}

/**
 * 消费一幅额度：免费优先，付费兜底；返回 { allowed, pool, quota, reason } —— pool 供失败返还精确回退。
 * 6.6.3 原子化：改用条件更新 + inc 抢占，杜绝「读-改-写」并发丢失/超发。
 *  - 免费池：条件 freeUsed < FREE_PER_MONTH 才 inc，抢不到说明已被并发抢空 → 落到付费池
 *  - 付费池：条件 paid > 0 才 inc(-1)，抢不到说明余额已被并发扣空 → 拒绝
 */
async function consumeQuota(db, openid) {
  const col = db.collection('prefs');
  const _ = db.command;
  const q = await loadQuota(db, openid);
  if ((q.freeUsed || 0) < FREE_PER_MONTH) {
    const r = await col.where({ _id: q._id, freeUsed: _.lt(FREE_PER_MONTH) })
      .update({ data: { freeUsed: _.inc(1), updatedAt: Date.now() } });
    if (r.stats && r.stats.updated) {
      return { allowed: true, pool: 'free', quota: quotaView({ ...q, freeUsed: (q.freeUsed || 0) + 1 }) };
    }
    // 并发把免费池抢空 → 重新读一次走付费池
    const q2 = await loadQuota(db, openid);
    return consumePaidOrDeny(col, _, q2);
  }
  return consumePaidOrDeny(col, _, q);
}

/** 付费池原子扣减；余额不足 → 拒绝（内部函数，供 consumeQuota 复用） */
async function consumePaidOrDeny(col, _, q) {
  if ((q.paid || 0) > 0) {
    const r = await col.where({ _id: q._id, paid: _.gt(0) })
      .update({ data: { paid: _.inc(-1), updatedAt: Date.now() } });
    if (r.stats && r.stats.updated) {
      return { allowed: true, pool: 'paid', quota: quotaView({ ...q, paid: (q.paid || 0) - 1 }) };
    }
  }
  return { allowed: false, quota: quotaView(q), reason: '免费额度已用完且没有次数包' };
}

/**
 * 生成失败返还一幅。
 * PAY-3（支付审查）：优先按消费时记录的池精确返还。此前「免费未满 → 上次必扣免费」的
 * 反推在边界失效：freeUsed=2 时扣免费 → freeUsed=3 → 返还时读到 3 误判为扣过付费，
 * 错退付费池（本月免费白扣 1 幅、付费凭空 +1）。
 * 未带 pool 的旧调用保留反推逻辑兜底（兼容）。
 */
async function refundQuota(db, openid, pool) {
  const col = db.collection('prefs');
  const _ = db.command;
  const q = await loadQuota(db, openid);
  if (pool === 'free' || pool === 'paid') {
    // 6.6.3 原子化：free 用条件 gte(1) 再 inc(-1) 防下探负数；paid 直接 inc(1)
    if (pool === 'free') {
      await col.where({ _id: q._id, freeUsed: _.gte(1) })
        .update({ data: { freeUsed: _.inc(-1), updatedAt: Date.now() } });
    } else {
      await col.where({ _id: q._id }).update({ data: { paid: _.inc(1), updatedAt: Date.now() } });
    }
    return;
  }
  const freeUsed = q.freeUsed || 0;
  if (freeUsed < FREE_PER_MONTH) {
    await col.where({ _id: q._id, freeUsed: _.gte(1) })
      .update({ data: { freeUsed: _.inc(-1), updatedAt: Date.now() } });
  } else {
    await col.where({ _id: q._id }).update({ data: { paid: _.inc(1), updatedAt: Date.now() } });
  }
}

/** 前端展示视图：免费剩余 + 付费剩余 + 合计 */
function quotaView(q) {
  const freeLeft = Math.max(FREE_PER_MONTH - (q.freeUsed || 0), 0);
  const paid = Math.max(q.paid || 0, 0);
  return { freeLeft, paid, left: freeLeft + paid, freePerMonth: FREE_PER_MONTH };
}

/**
 * 支付错误码 → 人话（官方错误码表 2026-09 核对，与前端 utils/pay.js humanizePayErr 同源）。
 * 两层匹配：errno 数字优先；errMsg 错误名（GOODS_PRICE_INVALID 等）兜底。
 */
function humanizePayErr(errno, errMsg) {
  const byCode = {
    '-15001': '支付参数不完整，请升级微信后重试',
    '-15002': '订单号被重复使用，请返回重试（系统会自动换新单号）',
    '-15003': '支付系统繁忙，请稍后重试',
    '-15004': '币种配置错误（仅支持 CNY），请联系开发者',
    '-15005': '登录签名已失效，请退出重新进入后再试',
    '-15006': '支付签名错误，请联系开发者核对 AppKey 配置',
    '-15007': '登录态已过期，请重新授权登录后再试',
    '-15008': '商户进件未完成，请联系开发者确认商户状态',
    '-15009': '代币尚未发布（后台发布后约 10-30 分钟生效）',
    '-15010': '道具尚未发布：请到 MP 后台虚拟支付-道具管理，将该道具发布至现网',
    '-15011': '现网环境不能使用沙箱（env 必须为 0），请联系开发者',
    '-15012': '支付通道繁忙导致关单，请稍后重试',
    '-15013': '道具价格校验未通过：① 核对 MP 后台虚拟支付-基础配置的 OfferId 与 config.pay_secret 是否逐字符一致；② 核对道具管理里现网道具价格（单位分）；③ iOS 需开启「苹果 IAP 支付」开关并配置小程序简称',
    '-15014': '道具发布未生效，禁止下单——发布后约 10-30 分钟生效，稍后再试',
    '-15016': '支付参数格式有问题，请联系开发者',
    '-15017': '商家收款功能受限，暂无法支付（商户平台可查看原因）'
  };
  let hint = byCode[String(errno)];
  if (!hint && errMsg) {
    const em = String(errMsg);
    const nameMap = [
      [/GOODS_PRICE_INVALID/i, '-15013'],
      [/GOODS_NOT_EXIST|PRODUCT_NOT_EXIST|PRODUCTID/i, '-15010'],
      [/COIN_OR_PRODUCT|RECENTLY|NOT_EFFECTIVE|NOT_PUBLISH/i, '-15014'],
      [/OUT_TRADE_NO/i, '-15002'],
      [/SIGNATURE_INVALID|SESSION/i, '-15005'],
      [/PAY_SIG|PAYSIG|SIGN_INVALID/i, '-15006'],
      [/INVALID_PLATFORM/i, '-15011'],
      [/CURRENCY/i, '-15004']
    ];
    for (let i = 0; i < nameMap.length; i++) {
      if (nameMap[i][0].test(em)) { hint = byCode[nameMap[i][1]]; break; }
    }
  }
  return hint || '';
}

module.exports = {
  FREE_PER_MONTH, PRODUCTS, ymNow, ymdNow, hmacSha256, loadPayConfig, code2Session,
  pickAppKey, isPaidStatus, getStableToken, queryOrderOnWx,
  makeOutTradeNo, loadQuota, consumeQuota, refundQuota, quotaView, humanizePayErr
};
