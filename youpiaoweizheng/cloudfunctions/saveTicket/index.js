// saveTicket/index.js —— 入库云函数
// 职责：补齐服务端字段（openid/createdAt/eventKey/weather）→ 写入 tickets 集合。
// 前端传入：{ ticket }（确认页编辑后的字段）
// 返回：{ ok, _id }
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { fetchWeather } = require('./weather.js');
const { lookupCity } = require('./citydict.js'); // 4.18.0 P0：城市静态坐标配对
const { geocodeVenue } = require('./geocode.js'); // 4.18.1：场馆级精化（配 LBS key 启用）
const { generateArt } = require('./artRestyle.js'); // 4.19.0：票根博物志 AI 重绘（GCJ-02 城市中心）
const pay = require('./pay.js'); // 4.20.0：虚拟支付（签名/code2Session/额度/错误码）

/** 规范化场次键：同一场演出 = 同一场馆 + 同一日期（同场偶遇的聚合键） */
function makeEventKey(venue, date) {
  if (!venue || !date) return '';
  const s = `${venue.replace(/\s+/g, '')}|${date}`.toLowerCase();
  return 'evt_' + crypto.createHash('md5').update(s).digest('hex').slice(0, 16);
}

/** 集合不存在时自动创建（免去手动建集合步骤，幂等可重试） */
async function ensureCollection(db, name) {
  try {
    await db.collection(name).count();
  } catch (e) {
    try {
      await db.createCollection(name);
    } catch (e2) {
      // 已存在/权限问题不阻塞，交由后续 add 的真实报错兜底
    }
  }
}

/** 内容安全检测内部实现：pass 通过 / risky 拦截 / error 服务异常（调用方定策略） */
async function secCheck(openid, content) {
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      openid,
      scene: 2,
      version: 2,
      content: String(content || '').slice(0, 2500)
    });
    const suggest = res && res.result && res.result.suggest;
    if (suggest === 'pass') return { result: 'pass', msg: '' };
    return { result: 'risky', msg: suggest === 'risky' ? '内容有违规风险' : '内容未通过安全检查' };
  } catch (e) {
    if (e && (e.errCode === 87014 || /87014/i.test(String(e.errMsg || '')))) {
      return { result: 'risky', msg: '内容含违规风险' };
    }
    return { result: 'error', msg: '安全检查服务异常' };
  }
}

/** 内容安全校验（action 路由复用 secCheck，避免新增云函数的部署成本） */
async function checkTextAction(event, OPENID) {
  const content = String(event.content || '').trim().slice(0, 2500);
  if (!content) return { ok: false, msg: '内容为空' };
  const r = await secCheck(OPENID, content);
  if (r.result === 'pass') return { ok: true };
  if (r.result === 'risky') return { ok: false, msg: r.msg + '，换一句试试' };
  return { ok: false, msg: '安全检查服务异常，请稍后再试' };
}

/**
 * M4.9.6：AI 文案持久化（action 路由）
 * 为什么不前端直连 update：tickets 集合在第一张票入库前并不存在，
 * 前端直连会报 -502005 database collection not exists；
 * 服务端 ensureCollection 自动建集合 + where 校验归属，一步自愈。
 */
async function setCaptionAction(event, OPENID) {
  const id = String(event.id || '').trim();
  const caption = String(event.caption || '').trim().slice(0, 500);
  if (!id || !caption) return { ok: false, msg: '参数缺失' };
  try {
    const db = cloud.database();
    await ensureCollection(db, 'tickets');
    // _openid 双保险：只能改自己的票（云函数端是管理员权限，必须自己限权）
    const res = await db.collection('tickets')
      .where({ _id: id, _openid: OPENID })
      .update({ data: { aiCaption: caption } });
    if (!res.stats || res.stats.updated === 0) {
      return { ok: false, msg: '票根不存在或不属于你' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: '文案保存失败：' + (e.message || 'unknown') };
  }
}

/**
 * 4.14.0：组内拖拽排序（action 路由）
 * 前端整理模式下整组重排后调用；orders = [{id, sortAt}]（同组全量，组内严格有序）。
 * 复用 setCaptionAction 的自愈模式：ensureCollection + _openid 归属校验。
 */
async function reorderAction(event, OPENID) {
  const orders = Array.isArray(event.orders) ? event.orders.slice(0, 200) : [];
  if (!orders.length) return { ok: false, msg: '缺少排序数据' };
  try {
    const db = cloud.database();
    await ensureCollection(db, 'tickets');
    let updated = 0;
    for (const o of orders) {
      const id = String(o.id || '').trim();
      const sortAt = Number(o.sortAt) || 0;
      if (!id || !sortAt) continue;
      const res = await db.collection('tickets')
        .where({ _id: id, _openid: OPENID })
        .update({ data: { sortAt } });
      updated += (res.stats && res.stats.updated) || 0;
    }
    return { ok: true, updated };
  } catch (e) {
    return { ok: false, msg: '排序保存失败：' + (e.message || 'unknown') };
  }
}

// ============================================================
// 4.16.0 组间排序（月份章节顺序）：prefs 集合按用户 upsert
// 文档结构：{ _openid, type:'groupOrder', labels:[月份label有序数组], updatedAt }
// ============================================================
async function reorderGroupsAction(event, OPENID) {
  const labels = (Array.isArray(event.labels) ? event.labels : [])
    .map((s) => String(s || '').trim().slice(0, 24))
    .filter(Boolean)
    .slice(0, 60);
  if (!labels.length) return { ok: false, msg: '缺少章节顺序数据' };
  try {
    const db = cloud.database();
    await ensureCollection(db, 'prefs');
    const col = db.collection('prefs');
    const found = await col.where({ _openid: OPENID, type: 'groupOrder' }).limit(1).get();
    const updatedAt = Date.now();
    if (found.data && found.data.length) {
      await col.doc(found.data[0]._id).update({ data: { labels, updatedAt } });
    } else {
      await col.add({ data: { _openid: OPENID, type: 'groupOrder', labels, updatedAt } });
    }
    return { ok: true, count: labels.length };
  } catch (e) {
    return { ok: false, msg: '章节顺序保存失败：' + (e.message || 'unknown') };
  }
}

/** 读取章节顺序：失败/未设置返回空数组（默认日期序），不阻塞首页 */
async function getGroupOrderAction(OPENID) {
  try {
    const db = cloud.database();
    const res = await db.collection('prefs')
      .where({ _openid: OPENID, type: 'groupOrder' })
      .limit(1)
      .get();
    return { ok: true, labels: (res.data && res.data[0] && res.data[0].labels) || [] };
  } catch (e) {
    return { ok: true, labels: [] };
  }
}

// ============================================================
// 4.17.0 M1 海报带码：生成小程序码（云存储 + prefs 缓存 fileID）
// scene='b=poster'：扫码进入后 app.js 场景埋点可见，可区分海报带来的回流。
// getUnlimited 不传 envVersion → 默认 release 码：上线后扫码直达；
// 上线前（体验/开发版）扫 release 码会提示版本不存在——属预期，不处理。
// 7.3.0 R6：海报上的码升级为**带邀请人短码**的 scene 码（scene='b=poster&r=XXXXXX'，
//   扫码进入落在 options.query.scene → utils/invite.js 解出 ref 完成归因）。
//   不传 ref 时仍走原来的全局码（一次生成全员复用）；带 ref 的按码各缓存一份。
// ============================================================
async function wxacodeAction(event) {
  const ref = String((event && event.ref) || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const scene = ref ? `b=poster&r=${ref}` : 'b=poster';
  const type = ref ? 'wxacode_ref' : 'wxacode_poster';
  try {
    const db = cloud.database();
    // 缓存：全局码一份（与用户无关、永久有效，任何人生成过一次即全员复用）；
    // 带邀请码的按 code 各一份（同一个人反复进卡片页只生成一次）。
    try {
      const hit = await db.collection('prefs').where(ref ? { type, code: ref } : { type }).limit(1).get();
      if (hit.data && hit.data[0] && hit.data[0].fileID) {
        return { ok: true, fileID: hit.data[0].fileID, cached: true };
      }
    } catch (e) { /* 缓存读取失败 → 走生成 */ }

    const wxa = await cloud.openapi.wxacode.getUnlimited({
      scene,
      width: 430
    });
    // openapi 返回 { buffer } 对象；兜底兼容直接返回 Buffer 的形态
    const buf = wxa && wxa.buffer ? wxa.buffer : (Buffer.isBuffer(wxa) ? wxa : null);
    if (!buf || !buf.length) return { ok: false, msg: '码生成失败' };

    const up = await cloud.uploadFile({
      cloudPath: `wxacode/poster-${ref || 'all'}-${Date.now()}.png`,
      fileContent: buf
    });
    if (!up || !up.fileID) return { ok: false, msg: '码上传失败' };

    try {
      await ensureCollection(db, 'prefs');
      await db.collection('prefs').add({
        data: { type, code: ref || '', fileID: up.fileID, createdAt: Date.now() }
      });
    } catch (e) { /* 缓存写失败不阻塞（下次重生成，可接受） */ }
    return { ok: true, fileID: up.fileID };
  } catch (e) {
    return { ok: false, msg: '小程序码服务异常：' + String((e && (e.errMsg || e.message)) || e).slice(0, 60) };
  }
}

// ============================================================
// 4.18.0 P0 geo 存量回填：老票根只有 city 文本、geo 为 null → 城市字典补坐标。
// 4.18.1 升级：回填时优先场馆级精化（geocodeVenue），失败落城市中心；
// where 条件改为「geoSource != 'venue'」——城市中心票/无 geo 票都会重刷升级，
// 已是场馆级的跳过。只回填 geo 不回填天气（避免逐票 HTTP 超时风险）。
// limit 200 分批：多次调用直到返回 filled=0 即回填完毕。
// ============================================================
async function backfillGeoAction(OPENID) {
  try {
    const db = cloud.database();
    const _ = db.command;
    const res = await db.collection('tickets')
      .where({ _openid: OPENID, geoSource: _.neq('venue'), city: _.neq('').and(_.neq(null)) })
      .limit(200)
      .get();
    let filled = 0;
    for (const doc of res.data || []) {
      if (!doc.city) continue; // 双保险：不依赖 where 语义差异
      let g = null;
      let src = 'city';
      if (doc.venue) {
        const p = await geocodeVenue(doc.city, doc.venue); // 场馆级优先（未配 key 返回 null）
        if (p) { g = p; src = 'venue'; }
      }
      if (!g) g = lookupCity(doc.city);
      if (g) {
        await db.collection('tickets').doc(doc._id).update({ data: { geo: g, geoSource: src } });
        filled++;
      }
    }
    return { ok: true, scanned: (res.data || []).length, filled };
  } catch (e) {
    return { ok: false, msg: 'geo 回填失败：' + (e.message || 'unknown') };
  }
}

// ============================================================
// 4.19.0 票根博物志：AI 艺术重绘（复古图版）
// 异步「启动 + 轮询」模式——生图 10-60s+，前端 callFunction 约 15s 必超时：
//   ① artRestyle：建 job(prefs 集合 status=running) → 同步跑生图全程
//     （前端会超时断开，但云函数继续执行到完成并回写 job）→ 返回 jobId
//   ② artQuery：前端每 4s 轮询 job 状态 → done 拿 fileID / failed 拿 msg
// 额度控制在本端（sp_art_quota，每月 3 张免费）；tickets.artVersion 记录最新图版。
// ============================================================
async function artRestyleAction(event, OPENID) {
  const ticketId = String(event.ticketId || '').trim();
  if (!ticketId) return { ok: false, msg: '缺少票根 id' };
  try {
    const db = cloud.database();
    const _ = db.command; // 6.6.5：artRestyle 原子抢占需要 _.neq
    await ensureCollection(db, 'prefs');
    const col = db.collection('tickets');
    // 归属校验 + 必须有照片（重绘主体）
    const got = await col.where({ _id: ticketId, _openid: OPENID }).limit(1).get();
    const t = got.data && got.data[0];
    if (!t) return { ok: false, msg: '票根不存在或不属于你' };
    if (!t.img) return { ok: false, msg: '这张票根没有照片，先补一张票根照片' };

    // 防重复：同票已有 running 的 job → 直接返回（前端转轮询）
    const jobs = db.collection('prefs');
    const pend = await jobs.where({ _openid: OPENID, type: 'art_job', ticketId, status: 'running' }).limit(1).get();
    if (pend.data && pend.data.length) return { ok: true, queued: true, jobId: pend.data[0]._id };

    // 6.6.5（P0）：原子抢占 job 槽，再扣额度。旧实现「查 running → 扣额度 → add job」存在 TOCTOU：
    // 并发双击/网络重试时两次都查不到 running → 各扣一次额度、各起一个生图任务（真实产生 AI 成本）。
    // 改法：先 add 一条 status='reserving' 占位，再用 CAS 把 reserving → running 抢占；
    // 抢不到（status 已变）说明被并发抢先，删掉自己的占位并返回已有 job。
    const reserve = await jobs.add({
      data: { _openid: OPENID, type: 'art_job', ticketId, status: 'reserving', createdAt: Date.now(), updatedAt: Date.now() }
    });
    const revId = reserve._id;
    const claim = await jobs.where({ _id: revId, status: 'reserving' }).update({
      data: { status: 'running', updatedAt: Date.now() }
    });
    if (!claim || !claim.stats || claim.stats.updated === 0) {
      await jobs.doc(revId).remove().catch(() => {}); // 未抢到 → 清占位
      const again = await jobs.where({ _openid: OPENID, type: 'art_job', ticketId, status: 'running' }).limit(1).get();
      const exist = again.data && again.data[0];
      if (exist) return { ok: true, queued: true, jobId: exist._id };
      return { ok: false, msg: '这张票正在生成，请稍后再试' };
    }
    // 抢占成功 → 仍要再查一次是否已有更早的 running（双保险：reserving 竞态窗口外）
    const dup = await jobs.where({ _openid: OPENID, type: 'art_job', ticketId, status: 'running', _id: _.neq(revId) }).limit(1).get();
    if (dup.data && dup.data.length) {
      await jobs.doc(revId).remove().catch(() => {});
      return { ok: true, queued: true, jobId: dup.data[0]._id };
    }

    // 4.20.0 服务端额度校验（权威记账：免费优先 → 付费兜底；前端仅展示）
    const spend = await pay.consumeQuota(db, OPENID);
    if (!spend.allowed) {
      // 额度不足 → 释放刚占的 job 槽，避免留下永远 running 的幽灵任务
      await jobs.doc(revId).remove().catch(() => {});
      return { ok: false, quota: spend.quota, code: 'NO_QUOTA', msg: '本月免费额度已用完，可购买图版次数包' };
    }
    const job = { _id: revId };

    // 同步跑完生图全程（前端已不等）；任何失败回写 job，轮询侧可见
    try {
      const r = await generateArt(cloud, t.img);
      await jobs.doc(job._id).update({ data: { status: 'done', fileID: r.fileID, updatedAt: Date.now() } });
      // 6.6.5：回写 artVersion 必须带 _openid 自限权（云函数是管理员权限，裸 doc(id) 写是越权模式）
      await col.where({ _id: ticketId, _openid: OPENID })
        .update({ data: { artVersion: { fileID: r.fileID, createdAt: Date.now() } } })
        .catch(() => { /* 记录失败不影响交付 */ });
    } catch (e) {
      const raw = String((e && e.message) || e);
      const msg = /model|not\s*found|permission|ai/i.test(raw)
        ? '生成服务暂不可用（需在云开发控制台「AI+」开通生图模型并核对资源包）'
        : raw.slice(0, 80);
      await jobs.doc(job._id).update({ data: { status: 'failed', msg, updatedAt: Date.now() } }).catch(() => {});
      // 6.6.5：返还失败不能再静默吞掉（旧实现 catch(()=>{}) → 用户白扣且无日志），至少落日志
      await pay.refundQuota(db, OPENID, spend.pool).catch((e2) => {
        console.error('[artRestyle] refundQuota 失败', OPENID, revId, (e2 && e2.message) || e2);
      }); // 4.20.0 失败返还；PAY-3：按消费所扣池精确回退
    }
    // 4.20.0：返回扣减后的额度视图（前端直接刷新显示）
    const q = await pay.loadQuota(db, OPENID);
    return { ok: true, jobId: job._id, async: true, quota: pay.quotaView(q) };
  } catch (e) {
    return { ok: false, msg: '图版服务异常：' + String((e && e.message) || e).slice(0, 60) };
  }
}

/** 前端轮询：查该票最新 job 状态（none/running/done/failed） */
async function artQueryAction(event, OPENID) {
  const ticketId = String(event.ticketId || '').trim();
  if (!ticketId) return { ok: false, msg: '缺少票根 id' };
  try {
    const db = cloud.database();
    await ensureCollection(db, 'prefs');
    const res = await db.collection('prefs')
      .where({ _openid: OPENID, type: 'art_job', ticketId })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    const j = res.data && res.data[0];
    if (!j) return { ok: true, status: 'none' };
    return { ok: true, status: j.status, fileID: j.fileID || '', msg: j.msg || '' };
  } catch (e) {
    return { ok: false, msg: '查询失败' };
  }
}

// ============================================================
// 4.20.0 授权登录 + 虚拟支付
// ------------------------------------------------------------
// 登录（拉新推广的用户身份基座 + 支付签名前置）：
//   前端 wx.login() 拿 code → authLogin → 服务端 code2Session 换 openid + session_key。
//   云开发下 openid 本就由 getWXContext 提供（免登录标识），这里换 session_key 的
//   唯一目的：虚拟支付 signature = HMAC-SHA256(sessionKey, signData)。
//   session_key 属敏感凭证：只存服务端（prefs type=auth_session），绝不下发前端；
//   泄露单独不构成支付伪造风险（paySig 需要服务端 AppKey）。
// 支付（wx.requestVirtualPayment，官方文档 2026-09 核对）：
//   payCreate → 双签名（paySig=AppKey / signature=sessionKey）→ 前端拉起 →
//   微信发货推送 xpay_goods_deliver_notify（消息推送 → 本函数）→ 幂等发货 → 额度到账。
// 凭证：config 集合 pay_secret doc（offerId/appKey/appSecret/env），不入代码仓库。
// ============================================================

/** 授权登录：code → session_key 落库（同时校验 code 归属当前用户，防串号） */
async function authLoginAction(event, OPENID) {
  const code = String(event.code || '').trim();
  if (!code) return { ok: false, msg: '缺少登录 code' };
  try {
    const db = cloud.database();
    const cfg = await pay.loadPayConfig(db);
    if (!cfg || !cfg.appSecret) return { ok: false, code: 'NO_CONFIG', msg: '登录服务尚未配置（config 集合缺 pay_secret.appSecret）' };
    const r = await pay.code2Session(cloud.getWXContext().APPID, cfg.appSecret, code);
    if (!r || r.errcode || !r.openid) {
      return { ok: false, msg: '登录校验失败：' + String((r && (r.errmsg || r.errcode)) || '未知'), code: 'WX_ERR' };
    }
    if (r.openid !== OPENID) return { ok: false, code: 'OPENID_MISMATCH', msg: '登录凭证与当前用户不一致' };
    await ensureCollection(db, 'prefs');
    const col = db.collection('prefs');
    const found = await col.where({ _openid: OPENID, type: 'auth_session' }).limit(1).get();
    const data = { sessionKey: r.session_key || '', updatedAt: Date.now() };
    if (found.data && found.data[0]) {
      await col.doc(found.data[0]._id).update({ data });
    } else {
      await col.add({ data: { _openid: OPENID, type: 'auth_session', ...data } });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: '登录异常：' + String((e && e.message) || e).slice(0, 60) };
  }
}

/** 读当前用户 session（支付签名用）；缺失/超 7 天视为过期 → 前端应先重新登录 */
async function getSession(db, OPENID) {
  try {
    const res = await db.collection('prefs').where({ _openid: OPENID, type: 'auth_session' }).limit(1).get();
    const s = res.data && res.data[0];
    if (!s || !s.sessionKey) return null;
    if (Date.now() - (s.updatedAt || 0) > 7 * 24 * 3600 * 1000) return null;
    return s;
  } catch (e) {
    return null;
  }
}

/** 下单：组 signData + 双签名（paySig=AppKey / signature=sessionKey）+ 订单入库 */
async function payCreateAction(event, OPENID) {
  const productId = String(event.productId || '').trim();
  const product = pay.PRODUCTS[productId];
  if (!product) return { ok: false, msg: '未知的商品' };
  try {
    const db = cloud.database();
    const cfg = await pay.loadPayConfig(db);
    if (!cfg) return { ok: false, code: 'NO_CONFIG', msg: '支付尚未配置（config 集合缺 pay_secret：offerId/appKey）' };
    const session = await getSession(db, OPENID);
    if (!session) return { ok: false, code: 'NEED_LOGIN', msg: '登录态过期，请重新授权登录' };

    const signData = JSON.stringify({
      offerId: cfg.offerId,
      buyQuantity: 1,
      env: Number(cfg.env) === 1 ? 1 : 0, // 0 现网 1 沙箱（iOS 不支持沙箱）
      currencyType: 'CNY',
      productId: productId,
      goodsPrice: product.priceFen, // 单位：分（-15003 高发坑）
      outTradeNo: pay.makeOutTradeNo(),
      attach: JSON.stringify({ openid: OPENID, productId })
    });
    const outTradeNo = JSON.parse(signData).outTradeNo;
    // 官方：沙箱(env=1)与现网(env=0)是两把不同的 AppKey，按下单 env 选对应 key 签 paySig
    const paySig = pay.hmacSha256(pay.pickAppKey(cfg, Number(cfg.env) === 1 ? 1 : 0), 'requestVirtualPayment&' + signData);
    const signature = pay.hmacSha256(session.sessionKey, signData);
    await ensureCollection(db, 'prefs');
    await db.collection('prefs').add({
      data: {
        _openid: OPENID, type: 'pay_order', outTradeNo, productId,
        priceFen: product.priceFen, status: 'created', createdAt: Date.now(), updatedAt: Date.now()
      }
    });
    return { ok: true, mode: 'short_series_goods', signData, paySig, signature, outTradeNo };
  } catch (e) {
    return { ok: false, msg: '下单失败：' + String((e && e.message) || e).slice(0, 60) };
  }
}

/** 查单 + 额度视图（前端支付后轮询确认到账；created 超 60s 触发对账兜底） */
async function payQueryAction(event, OPENID) {
  try {
    const db = cloud.database();
    await ensureCollection(db, 'prefs');
    let order = null;
    const no = String(event.outTradeNo || '').trim();
    if (no) {
      const res = await db.collection('prefs').where({ _openid: OPENID, type: 'pay_order', outTradeNo: no }).limit(1).get();
      order = (res.data && res.data[0]) || null;
    }
    // —— 4.20.0 对账兜底（官方推荐推送+查单两分支结合，success 回调可能丢失）——
    // 本地仍 created、下单超 60s、距上次对账 ≥10s（限频护栏）→ 主动查微信侧真实状态：
    //   paid(2/3/4) → 补发货；refunded(5/8) → 标记不发货；查单失败 → 维持 created 不动
    if (order && order.status === 'created'
      && Date.now() - (order.createdAt || 0) > 60 * 1000
      && Date.now() - (order.lastCheckAt || 0) >= 10 * 1000) {
      const rec = await reconcileOrder(db, OPENID, order);
      if (rec && rec.order) order = rec.order;
    }
    const q = await pay.loadQuota(db, OPENID);
    return { ok: true, order: order ? { outTradeNo: order.outTradeNo, status: order.status } : null, quota: pay.quotaView(q) };
  } catch (e) {
    return { ok: false, msg: '查询失败' };
  }
}

/**
 * 4.22.0 支付后主动确认（「即时到账」核心分支）：
 * 收银台 success 后前端立即调用——不再干等微信发货推送，服务端当场查微信侧
 * 真实支付状态，paid → 立即发货（幂等）。查单失败/未支付 → 返回 pending，
 * 前端落回轮询兜底（发货推送最终也会幂等补发，双保险）。
 * 虚拟商品语义：无任何物流环节，确认=发货=次数即时入账。
 */
async function payConfirmAction(event, OPENID) {
  const db = cloud.database();
  try {
    await ensureCollection(db, 'prefs');
    const no = String(event.outTradeNo || '').trim();
    if (!no) return { ok: false, msg: '缺订单号' };
    const col = db.collection('prefs');
    const found = await col.where({ _openid: OPENID, type: 'pay_order', outTradeNo: no }).limit(1).get();
    const order = found.data && found.data[0];
    if (!order) return { ok: false, code: 'NO_ORDER', msg: '订单不存在' };
    if (order.status === 'delivered') { // 幂等：早已到账 → 直接回当前额度（重进/重复确认场景）
      const q = await pay.loadQuota(db, OPENID);
      return { ok: true, quota: pay.quotaView(q), order: { status: 'delivered' }, delivered: false };
    }
    if (order.status === 'refunded') return { ok: false, code: 'REFUNDED', msg: '订单已退款' };
    if (order.status !== 'created') { // price_mismatch / attach_mismatch / expired 等异常终态
      return { ok: false, code: order.status, msg: '订单状态异常，本次不会到账；如有扣款请联系开发者核实' };
    }
    const cfg = await pay.loadPayConfig(db);
    const session = await getSession(db, OPENID);
    if (!cfg || !session) return { ok: false, code: 'NEED_LOGIN', msg: '登录态过期' };
    // 服务端权威核对：只有微信侧确认 paid 才发货——绝不轻信前端「已支付」声明
    const r = await pay.queryOrderOnWx(cloud.getWXContext().APPID, cfg, OPENID, session.sessionKey, no);
    if (!r.ok) return { ok: false, code: 'CHECK_FAIL', pending: true, msg: '支付状态确认失败，稍后自动到账' };
    if (r.paid) {
      const d = await deliverOrder(db, OPENID, no, order.productId, 1, r.paidFee);
      const q = await pay.loadQuota(db, OPENID);
      return { ok: true, quota: pay.quotaView(q), order: { status: 'delivered' }, delivered: d.delivered };
    }
    if (r.refunded) {
      await col.doc(order._id).update({ data: { status: 'refunded', updatedAt: Date.now() } });
      return { ok: false, code: 'REFUNDED', msg: '订单已退款' };
    }
    // 微信侧明确未支付：下单超 15 分钟 → 关单清理（expired，不影响任何额度）；
    // 未超时 → 维持 created（可能仍在支付流程中），由前端轮询继续等待
    if (Date.now() - (order.createdAt || 0) > 15 * 60 * 1000) {
      await col.doc(order._id).update({ data: { status: 'expired', updatedAt: Date.now() } });
      return { ok: false, code: 'EXPIRED', msg: '订单超时未支付已关闭，请重新购买' };
    }
    return { ok: false, code: 'NOT_PAID', pending: true, msg: '微信侧尚未确认到账' };
  } catch (e) {
    // 兜底：一切确认异常都不把用户挡在门外——落 pending，让轮询/推送自愈
    return { ok: false, code: 'CHECK_FAIL', pending: true, msg: '确认失败，稍后自动到账' };
  }
}

/** 额度视图（art/me 页加载时刷新服务端权威额度）
 *  4.22.0 掉单自愈：读额度时顺带对账本人滞留 created 订单（下单>60s 且距上次
 *  对账 ≥10s 限频）——支付成功但前端断链/推送延迟的「掉单」，用户下次进入页面
 *  静默补发到账，无需任何手动操作。
 */
async function quotaGetAction(OPENID) {
  try {
    const db = cloud.database();
    await ensureCollection(db, 'prefs');
    try {
      const pend = await db.collection('prefs')
        .where({ _openid: OPENID, type: 'pay_order', status: 'created' })
        .limit(3).get();
      for (const o of (pend.data || [])) {
        if (Date.now() - (o.createdAt || 0) > 60 * 1000
          && Date.now() - (o.lastCheckAt || 0) >= 10 * 1000) {
          await reconcileOrder(db, OPENID, o); // 内部兜底，不抛；补发/过期都静默落地
        }
      }
    } catch (e) { /* 对账失败不影响额度读取 */ }
    const q = await pay.loadQuota(db, OPENID);
    return { ok: true, quota: pay.quotaView(q) };
  } catch (e) {
    return { ok: false, msg: '额度查询失败' };
  }
}

// ============================================================
// 4.21.0 激励视频奖励入账（流量主变现：art 付费墙「看视频免费补 1 幅」）
// 入账口径：奖励并入 paid 池（consume/refund/quotaView 零改动，扣减顺序免费→付费不变）。
// 防刷三道闸：
//   ① 每用户每日上限 AD_REWARD_DAILY_LIMIT 次（prefs type='ad_reward' 计数器，北京时间口径）；
//   ② 仅登录用户（OPENID 由 getWXContext 注入，前端不可伪造归属）；
//   ③ 流量主开通后可升级为微信服务端激励回调（带签名校验），当前为客户端上报 + 日限额兜底，
//      单日最大敞口 = 3 幅生图成本，风险可控。
// ============================================================
const AD_REWARD_DAILY_LIMIT = 3;

async function artRewardGrantAction(event, OPENID) {
  try {
    const db = cloud.database();
    const _ = db.command; // 6.6.5：奖励入账原子自增需要 _.inc
    await ensureCollection(db, 'prefs');
    const col = db.collection('prefs');
    const d = new Date();
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const rec = await col.where({ _openid: OPENID, type: 'ad_reward', ymd }).limit(1).get();
    const cur = rec.data && rec.data[0];
    const count = (cur && cur.count) || 0;
    // 预检模式（check=true）：只读「今天还能看几次」，不扣不奖——付费墙展示用
    if (event.check) {
      const q0 = await pay.loadQuota(db, OPENID);
      return { ok: true, left: Math.max(AD_REWARD_DAILY_LIMIT - count, 0), quota: pay.quotaView(q0) };
    }
    if (count >= AD_REWARD_DAILY_LIMIT) {
      const q = await pay.loadQuota(db, OPENID);
      return { ok: false, code: 'LIMIT', msg: '今天看视频补画的机会已经用完，明天再来', quota: pay.quotaView(q), left: 0 };
    }
    if (cur) {
      await col.doc(cur._id).update({ data: { count: count + 1, updatedAt: Date.now() } });
    } else {
      await col.add({ data: { _openid: OPENID, type: 'ad_reward', ymd, count: 1, updatedAt: Date.now() } });
    }
    const q = await pay.loadQuota(db, OPENID);
    // 6.6.5（P1）：奖励入账原子自增并同步记 bonus——退款回退上限 = paid - bonus，
    // 奖励次数（看视频等）不属于付费资产，退款时不应被一并回退（旧实现混入 paid 且读-改-写会丢更新）
    await col.doc(q._id).update({ data: { paid: _.inc(1), bonus: _.inc(1), updatedAt: Date.now() } });
    const after = await pay.loadQuota(db, OPENID);
    return { ok: true, quota: pay.quotaView(after), left: AD_REWARD_DAILY_LIMIT - (count + 1) };
  } catch (e) {
    return { ok: false, msg: '奖励入账失败：' + String((e && e.message) || e).slice(0, 60) };
  }
}

/**
 * 公共发货（4.20.0 官方文档精读对照）：payNotify 推送分支与 payQuery 对账分支共用。
 * 幂等：订单已 delivered / refunded 直接返回不重复加额度。
 * 官方推荐「推送 + 主动查单」两分支至少实现一个、结合更可靠——success 回调可能丢失。
 * @returns {{delivered:boolean, reason?:string}}
 */
const MAX_ORDER_QTY = 1; // 单笔订单可发货的最大件数：payCreate 服务端写死 buyQuantity:1，多件不可信

async function deliverOrder(db, openid, outTradeNo, productId, quantity, priceFen) {
  const product = pay.PRODUCTS[productId];
  const col = db.collection('prefs');
  const _ = db.command; // 6.6.5：发货 CAS 与原子自增需要 _.in/_.inc
  const found = await col.where({ _openid: openid, type: 'pay_order', outTradeNo }).limit(1).get();
  const order = found.data && found.data[0];
  if (order && order.status === 'delivered') return { delivered: false, reason: 'dup' };
  if (order && order.status === 'refunded') return { delivered: false, reason: 'refunded' };
  // 5.0.0 修 P0-3：件数夹紧（原实现按 产品幅数 × Quantity 加额度，Quantity 客户端可控且无上限）
  const qty = Math.min(Math.max(Number(quantity) || 1, 1), MAX_ORDER_QTY);
  const addQuota = (product ? product.quota : 0) * qty;
  if (order) {
    // PAY-1（支付审查）原子抢占发货权：条件更新看 updated 数，抢到的那支才加额度。
    // 此前 read-then-write 无原子性——payConfirm 查单分支与微信推送分支并发到达时
    // 双双通过幂等检查 → 付费额度凭空翻倍（资损）。
    // 6.6.5（P0）：改用状态白名单 in(['created','expired']) 取代「先查后改」。
    // 先查后改（TOCTOU）会放行 price_mismatch/attach_mismatch 等异常终态单；
    // expired 保留：payConfirm 15 分钟关单与推送到达存在「压线支付」时序，用户确实已付款。
    const claim = await col.where({ _id: order._id, status: _.in(['created', 'expired']) }).update({
      data: { status: 'delivered', deliveredAt: Date.now(), lastCheckAt: Date.now(), quantity: qty, updatedAt: Date.now() }
    });
    if (!claim.stats || !claim.stats.updated) return { delivered: false, reason: 'dup' };
  } else {
    // 兜底：推送先于订单可见（极端时序）→ 落一笔 delivered 记录防丢单
    //（能走到这里说明上方微信侧查单复核已确认 paid，伪造推送到不了这个分支）
    await col.add({
      data: {
        _openid: openid, type: 'pay_order', outTradeNo, productId,
        priceFen: Number(priceFen) || 0, quantity: qty,
        status: 'delivered', deliveredAt: Date.now(), updatedAt: Date.now()
      }
    });
  }
  const q = await pay.loadQuota(db, openid);
  // 6.6.3：原子自增（旧实现 paid:(q.paid||0)+addQuota 在并发发货/奖励入账时有丢失更新）。
  await col.where({ _id: q._id }).update({ data: { paid: _.inc(addQuota), updatedAt: Date.now() } });
  return { delivered: true };
}

/**
 * 单笔订单对账（查单兜底分支）：本地仍 created 的订单查微信侧真实状态并落地。
 * paid（status 2/3/4）→ deliverOrder 补发货；refunded（5/8）→ 标记不发货；
 * 查单失败（签名/session_key 过期 268490009/网络）→ 只更新 lastCheckAt 维持限频，不动状态。
 */
async function reconcileOrder(db, openid, order) {
  try {
    const cfg = await pay.loadPayConfig(db);
    const session = await getSession(db, openid);
    if (!cfg || !session) {
      await db.collection('prefs').doc(order._id).update({ data: { lastCheckAt: Date.now() } }).catch(() => {});
      return { order };
    }
    const r = await pay.queryOrderOnWx(cloud.getWXContext().APPID, cfg, openid, session.sessionKey, order.outTradeNo);
    if (r.ok && r.paid) {
      await deliverOrder(db, openid, order.outTradeNo, order.productId, 1, r.paidFee);
      return { order: { ...order, status: 'delivered' }, delivered: true };
    }
    if (r.ok && r.refunded) {
      await db.collection('prefs').doc(order._id).update({ data: { status: 'refunded', updatedAt: Date.now() } });
      return { order: { ...order, status: 'refunded' } };
    }
    // 4.22.0：查单成功但微信侧未支付——下单超 15 分钟 → 关单清理（expired，
    // 不留无限滞留的垃圾单）；未超时维持 created（支付流程中）仅刷新限频时间戳。
    if (r.ok && !r.paid) {
      if (Date.now() - (order.createdAt || 0) > 15 * 60 * 1000) {
        await db.collection('prefs').doc(order._id).update({ data: { status: 'expired', updatedAt: Date.now() } });
        return { order: { ...order, status: 'expired' } };
      }
    }
    await db.collection('prefs').doc(order._id).update({ data: { lastCheckAt: Date.now() } }).catch(() => {});
    return { order };
  } catch (e) {
    return { order };
  }
}

/**
 * 支付订单审计留痕（5.0.0 修 P0-3）：一切「不发货」的异常分支都落一条带明确 status 的
 * 记录，便于事后人工排查与对账。已有订单就地改状态，没有则新建一条。
 * ⚠️ 已 delivered / refunded 的订单不覆盖 —— 审计绝不能把发货结果改回去。
 */
async function auditPayOrder(db, openid, outTradeNo, productId, status, extra) {
  try {
    const col = db.collection('prefs');
    const data = Object.assign({ status, updatedAt: Date.now() }, extra || {});
    const found = await col.where({ _openid: openid, type: 'pay_order', outTradeNo }).limit(1).get();
    const order = found.data && found.data[0];
    if (order) {
      if (order.status === 'delivered' || order.status === 'refunded') return;
      await col.doc(order._id).update({ data });
      return;
    }
    await col.add({
      data: Object.assign({
        _openid: openid, type: 'pay_order', outTradeNo, productId: productId || '',
        priceFen: 0, createdAt: Date.now()
      }, data)
    });
  } catch (e) { /* 审计落库失败不拦路：留痕是尽力而为，不能反过来阻断主流程 */ }
}

/** 微信发货推送（消息推送 → 本函数；Event=xpay_goods_deliver_notify）。必须幂等。 */
async function payNotifyAction(event) {
  // 官方字段语义（2026-09 文档核对）：FromUserName 在道具发货场景固定为微信官方的 openid，
  // 用户 openid 在 event.OpenId —— 取错字段会把额度发到错误归属（P0）
  const openid = String(event.OpenId || event.FromUserName || '');
  const outTradeNo = String(event.OutTradeNo || '');
  const goods = event.GoodsInfo || {};
  const productId = String(goods.ProductId || '');
  const product = pay.PRODUCTS[productId];
  if (!openid || !outTradeNo) return { ErrCode: -1, ErrMsg: 'missing openid/outTradeNo' };
  try {
    const db = cloud.database();
    await ensureCollection(db, 'prefs');
    const col = db.collection('prefs');
    // 幂等对账：订单已发货/已退款 → 直接成功回执（微信重试周期 15s~6h，最多 15 次）
    const found = await col.where({ _openid: openid, type: 'pay_order', outTradeNo }).limit(1).get();
    const order = found.data && found.data[0];
    if (order && order.status === 'delivered') return { ErrCode: 0, ErrMsg: 'ok(dup)' };
    if (order && order.status === 'refunded') return { ErrCode: 0, ErrMsg: 'ok(refunded)' };
    if (!product) {
      // 未知道具不发货（原代码只做价格比对，商品未知时 priceFen 为 undefined → 比对恒不等
      // 虽然也会拦下，但语义含糊；这里显式拒绝并留痕）
      await auditPayOrder(db, openid, outTradeNo, productId, 'unknown_product', { priceFen: Number(goods.ActualPrice) || 0 });
      return { ErrCode: 0, ErrMsg: 'ok(unknown product)' };
    }
    // 归属校验：下单时 attach 带 openid，推送回带 GoodsInfo.Attach —— 防串单
    // （客户端可自填，故只当线索不当证据；真正的归属由下方微信侧查单确定）
    let attachOk = true;
    try {
      const at = typeof goods.Attach === 'string' ? JSON.parse(goods.Attach) : (goods.Attach || null);
      if (at && at.openid && at.openid !== openid) attachOk = false;
    } catch (e) { /* attach 非本系统格式时不拦截 */ }
    if (!attachOk) {
      await auditPayOrder(db, openid, outTradeNo, productId, 'attach_mismatch', { priceFen: Number(goods.ActualPrice) || 0 });
      return { ErrCode: 0, ErrMsg: 'ok(attach mismatch)' };
    }

    // ============ 5.0.0 修 P0-3 · 资金敞口：微信侧查单复核（唯一的发货依据）============
    // 本函数收到的字段里，没有一个可以当作「已付款」的证据：
    //   Event / OpenId   —— 客户端可自填（虽然已在 exports.main 拦掉客户端直调，但不依赖它）
    //   GoodsInfo.ActualPrice —— 商品价是公开信息，填对即可
    //   GoodsInfo.Attach —— 客户端传的，填自己 openid 就过
    //   GoodsInfo.Quantity —— 无上限，且 deliverOrder 按 产品幅数 × Quantity 加额度
    // 唯一可信的是拿 sessionKey 签名、向微信查回来的真实订单状态。
    // 查单不可用（未登录/网络/签名）时既不发货也不改额度，只留痕并回 ErrCode:0 结束重推；
    // 到账由 payConfirm（客户端支付后主动确认，走的是同一套查单逻辑）与
    // quotaGet（进页面顺带对账滞留单）自愈，用户不会因这里失败而丢单。
    const cfg = await pay.loadPayConfig(db);
    const session = cfg ? await getSession(db, openid) : null;
    if (!cfg || !session) {
      await auditPayOrder(db, openid, outTradeNo, productId, 'verify_unavailable', { priceFen: product.priceFen });
      return { ErrCode: 0, ErrMsg: 'ok(pending-verify)' };
    }
    const v = await pay.queryOrderOnWx(cloud.getWXContext().APPID, cfg, openid, session.sessionKey, outTradeNo);
    if (!v.ok) {
      // 查单请求本身失败 ≠ 用户没付钱：不能据此判负，留痕待重查
      await auditPayOrder(db, openid, outTradeNo, productId, 'verify_failed', { priceFen: product.priceFen });
      return { ErrCode: 0, ErrMsg: 'ok(check-failed)' };
    }
    if (v.refunded) {
      if (order) await col.doc(order._id).update({ data: { status: 'refunded', updatedAt: Date.now() } });
      return { ErrCode: 0, ErrMsg: 'ok(refunded)' };
    }
    if (!v.paid) {
      // 微信侧明确未支付 —— 伪造推送的典型落点，绝不发货
      await auditPayOrder(db, openid, outTradeNo, productId, 'verify_unpaid', { priceFen: Number(goods.ActualPrice) || 0 });
      return { ErrCode: 0, ErrMsg: 'ok(not-paid)' };
    }
    // 金额复核：以微信侧实付为准（推送里的 ActualPrice 客户端可改）
    if (v.paidFee && v.paidFee !== product.priceFen) {
      await auditPayOrder(db, openid, outTradeNo, productId, 'price_mismatch', { priceFen: v.paidFee });
      return { ErrCode: 0, ErrMsg: 'ok(price mismatch)' };
    }
    // 发货（公共函数，payQuery 对账分支复用）：订单置 delivered + 付费额度 += 单件幅数
    // 数量恒为 1：payCreate 服务端写死 buyQuantity:1，推送里的 Quantity 一概不采信
    const r = await deliverOrder(db, openid, outTradeNo, productId, 1, v.paidFee || product.priceFen);
    if (!r.delivered) return { ErrCode: 0, ErrMsg: 'ok(' + r.reason + ')' };
    return { ErrCode: 0, ErrMsg: 'ok' };
  } catch (e) {
    console.error('[payNotify] 发货异常：', e);
    return { ErrCode: -2, ErrMsg: String((e && e.message) || e).slice(0, 80) }; // 非 0 → 微信重试
  }
}

/** 退款落地公共函数：置 refunded + 已发货单回退次数（下探 0 不负数）。退款推送与对账兜底共用 */
async function applyRefundToOrder(db, openid, order, refundFee) {
  const col = db.collection('prefs');
  const _ = db.command;
  if (!order) return;
  // 6.6.5（P0）：退款幂等改为「原子 CAS 抢占 + 子标记补做」，修两个资损面：
  //   ① 旧实现只凭调用方传入的 order 快照判断 status==='refunded' → 退款推送重试（最长 6h/15 次）
  //      与对账兜底并发时，两侧都持「非 refunded」快照 → 双双通过 → 额度重复回退。
  //   ② 旧实现先置 refunded 再回退额度：若置位后崩溃，后续重试在开头直接 return → 额度永久不回退。
  // 改法：用 refundApplied 子标记做「额度回退」的幂等闸门；CAS 抢占该标记（原子），
  // 谁抢到谁做回退；无论回退是否已完成，最后都把 status 幂等置为 refunded。
  const cas = await col.where({ _id: order._id, refundApplied: _.neq(true) }).update({
    data: { refundApplied: true, refundedAt: Date.now(), refundFee: Number(refundFee) || 0, updatedAt: Date.now() }
  });
  const claimed = !!(cas && cas.stats && cas.stats.updated);
  if (!claimed) {
    // 已被并发分支处理（或历史单无该字段）→ 仍需保证 status=refunded，但不重复回退
    await col.where({ _id: order._id, status: _.neq('refunded') }).update({
      data: { status: 'refunded', refundedAt: Date.now(), updatedAt: Date.now() }
    });
    return;
  }
  if (order.status === 'delivered' || order.status === 'refund_pending') {
    const product = pay.PRODUCTS[order.productId];
    const wantBack = ((product && product.quota) || 0) * (Number(order.quantity) || 1);
    const q = await pay.loadQuota(db, openid);
    // 6.6.5：回退上限 = paid - bonus。bonus 是看视频等奖励带来的次数（非付费），
    // 退款不应把奖励次数也回退掉（否则「买 10 送 1 奖励」退款会退走 11 幅中的奖励额）。
    const refundable = Math.max((q.paid || 0) - (q.bonus || 0), 0);
    const back = Math.min(wantBack, refundable);
    if (back > 0) {
      // 6.6.3：原子自减且不下探负数——条件 paid >= back 才 inc(-back)。
      const r = await col.where({ _id: q._id, paid: _.gte(back) })
        .update({ data: { paid: _.inc(-back), updatedAt: Date.now() } });
      // 条件未命中（并发已扣空）→ 不再强制归零整个 paid（会把奖励次数一起清零）
      void r;
    }
  }
  await col.where({ _id: order._id, status: _.neq('refunded') }).update({
    data: { status: 'refunded', updatedAt: Date.now() }
  });
}

/**
 * 退款推送（Event=xpay_refund_notify）：用户退款成功后回退次数额度。
 * 官方字段（2026-09 核对）：OpenId（用户）/ MchOrderId（=原单 outTradeNo）/
 * RefundFee（分）/ RetCode（SUCCESS=退款成功）。
 * 额度回退：paid -= 单件幅数 × quantity，下探到 0 为止（不产生负数欠账）；
 * 只有已发货（delivered）订单才回退——created/mismatch 单从未发出过额度。
 */
async function payRefundAction(event) {
  const openid = String(event.OpenId || '');
  const outTradeNo = String(event.MchOrderId || '');
  if (!openid || !outTradeNo) return { ErrCode: -1, ErrMsg: 'missing openid/MchOrderId' };
  // 退款失败的回调不改变任何状态，回执成功防无意义重推
  if (String(event.RetCode || '') !== 'SUCCESS') return { ErrCode: 0, ErrMsg: 'refund not success, ignored' };
  try {
    const db = cloud.database();
    await ensureCollection(db, 'prefs');
    const col = db.collection('prefs');
    const found = await col.where({ _openid: openid, type: 'pay_order', outTradeNo }).limit(1).get();
    const order = found.data && found.data[0];
    if (!order) {
      // 退款成功是既成事实：本地无单也回执成功防重推，但落审计记录留排查线索
      await col.add({
        data: { _openid: openid, type: 'pay_order', outTradeNo, productId: '', priceFen: 0, status: 'refund_unknown_order', createdAt: Date.now(), updatedAt: Date.now() }
      }).catch(() => {});
      return { ErrCode: 0, ErrMsg: 'ok(no order)' };
    }
    if (order.status === 'refunded') return { ErrCode: 0, ErrMsg: 'ok(dup)' }; // 幂等
    // 6.6.5（P0）：回退逻辑收敛到 applyRefundToOrder——refundApplied CAS 幂等抢占
    //（防推送重试 6h/15 次与对账并发重复回退）+ 回退上限 paid-bonus（奖励不退）+ 原子自减
    await applyRefundToOrder(db, openid, order, event.RefundFee);
    return { ErrCode: 0, ErrMsg: 'ok' };
  } catch (e) {
    console.error('[payRefund] 退款处理异常：', e);
    return { ErrCode: -2, ErrMsg: String((e && e.message) || e).slice(0, 80) };
  }
}

/**
 * iOS 退款问询推送（Event=xpay_subscribe_ios_refund_query_notify，Apple 消费争议问询）：
 * Apple 向用户发起退款问询、微信转发给开发者，3 秒内必须应答（超时=不确定，Apple 自行裁决）。
 * 应答体（非 ErrCode 格式）：{ result_code: 0=放过(不反对退款) | 1=拦截(建议不退),
 *   result_info: 文字说明, evidence: 证据（必填）}。
 * 策略：订单已发货（次数已到账）→ 拦截并附证据；未发货/未知/查询异常 → 放过
 *（宁可误放不可误拦——拦错直接影响用户资金与投诉升级）。
 */
async function payIosRefundQueryAction(event) {
  const openid = String(event.OpenId || '');
  const outTradeNo = String(event.OutTradeNo || event.MchOrderId || event.pay_order_id || '');
  let blocked = false;
  let reason = 'deliver not confirmed on our side';
  try {
    if (openid && outTradeNo) {
      const db = cloud.database();
      const res = await db.collection('prefs').where({ _openid: openid, type: 'pay_order', outTradeNo }).limit(1).get();
      const order = res.data && res.data[0];
      if (order && order.status === 'delivered') {
        blocked = true;
        const at = order.deliveredAt ? new Date(order.deliveredAt).toISOString() : '';
        reason = `virtual goods delivered${at ? ' at ' + at : ''}, quota credited to user; order ${order.outTradeNo}`;
      }
    }
  } catch (e) { /* 查询异常按放过处理 */ }
  return {
    result_code: blocked ? 1 : 0,
    result_info: reason,
    evidence: JSON.stringify({ openid, outTradeNo, blocked, ts: Date.now() })
  };
}

/** 授权资料读取（拉新推广展示用：昵称 + 头像，均为用户主动授权后写入） */
async function profileGetAction(OPENID) {
  try {
    const db = cloud.database();
    await ensureCollection(db, 'prefs');
    const res = await db.collection('prefs').where({ _openid: OPENID, type: 'user_profile' }).limit(1).get();
    const p = res.data && res.data[0];
    return { ok: true, profile: p ? { nickname: p.nickname || '', avatar: p.avatar || '' } : { nickname: '', avatar: '' } };
  } catch (e) {
    return { ok: false, msg: '资料读取失败' };
  }
}

/** 授权资料保存（昵称走内容安全——后续拉新场景会公开展示） */
async function profileSaveAction(event, OPENID) {
  const nickname = String(event.nickname || '').trim().slice(0, 24);
  const avatar = String(event.avatar || '').trim();
  // 4.20.0 头像必须是本环境云存储 fileID（防任意字符串写进展示位）；演示模式前端不持久化
  if (avatar && !/^cloud:\/\/[\w-]+\.[\w-]+\//.test(avatar)) {
    return { ok: false, msg: '头像地址不合法' };
  }
  if (!nickname && !avatar) return { ok: false, msg: '没有可保存的资料' };
  try {
    if (nickname) {
      const sc = await secCheck(OPENID, nickname);
      if (sc.result === 'risky') return { ok: false, msg: '昵称未通过安全检查：' + sc.msg };
    }
    const db = cloud.database();
    await ensureCollection(db, 'prefs');
    const col = db.collection('prefs');
    // 4.20.0 只 patch 非空字段：单独改头像不能把昵称清掉（反之亦然）
    const patch = { updatedAt: Date.now() };
    if (nickname) patch.nickname = nickname;
    if (avatar) patch.avatar = avatar;
    const found = await col.where({ _openid: OPENID, type: 'user_profile' }).limit(1).get();
    if (found.data && found.data[0]) {
      await col.doc(found.data[0]._id).update({ data: patch });
    } else {
      await col.add({ data: { _openid: OPENID, type: 'user_profile', nickname, avatar, ...patch } });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: '资料保存失败：' + String((e && e.message) || e).slice(0, 60) };
  }
}

/** 4.20.3 清除署名资料（profileClear）：删 user_profile 文档——PIPL 删除权呼应。
 *  只删昵称+头像展示位，不动票根/额度/订单；幂等（文档不存在也算成功）。 */
async function profileClearAction(OPENID) {
  try {
    const db = cloud.database();
    await ensureCollection(db, 'prefs');
    const found = await db.collection('prefs').where({ _openid: OPENID, type: 'user_profile' }).limit(1).get();
    if (found.data && found.data[0]) {
      await db.collection('prefs').doc(found.data[0]._id).remove();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: '资料清除失败：' + String((e && e.message) || e).slice(0, 60) };
  }
}

/** 4.20.4 上线前数据清理（opsCleanup）：清除测试期残留，让库回到「真实、干净」状态。
 *  清理范围：tickets 全部（测试票根）· couples 全部（测试绑定）
 *            prefs 按 type 清：pay_order（测试订单）/ auth_session（测试会话）/
 *            user_profile（测试署名，如「流浪唱片」）/ art_quota（测试额度）/ art_job（生图任务）/
 *            wxacode_poster（码缓存）/ wxacode_ref、ref_code、ref_link（7.3.0 邀请归因）
 *  保留：config 集合（支付凭证，绝不动）· prefs 其余 type（未知用途不碰）。
 *  防滥用：必须携带 opsToken = config.pay_secret.appKey（MP 后台虚拟支付页可查），比对一致才执行。
 *  触发：开发者工具 → 云开发控制台 → 云函数 saveTicket → 云端测试 → 事件 {"action":"opsCleanup","opsToken":"<appKey>"}
 *  幂等：可重复执行，第二遍全 0 即清理干净。 */
async function opsCleanupAction(event) {
  const db = cloud.database();
  // 1. opsToken 校验（复用 pay_secret 的 appKey，不引入新凭据）
  let appKey = '';
  try {
    const res = await db.collection('config').doc('pay_secret').get();
    appKey = String((res && res.data && res.data.appKey) || '');
  } catch (e) {
    return { ok: false, msg: 'config.pay_secret 读取失败（支付凭证未配置？）' };
  }
  if (!appKey || String(event.opsToken || '') !== appKey) {
    return { ok: false, msg: 'opsToken 校验失败：需传 config.pay_secret 的 appKey 字段值' };
  }
  // 2. 逐范围清理（服务端 where().remove() 为批量删除）
  const report = {};
  const rm = async (name, where, label) => {
    try {
      const r = await db.collection(name).where(where).remove();
      report[label] = (r.stats && r.stats.removed) || 0;
    } catch (e) {
      report[label] = 'err: ' + String((e && (e.errMsg || e.message)) || e).slice(0, 80);
    }
  };
  await ensureCollection(db, 'tickets');
  await rm('tickets', {}, 'tickets_测试票根');
  await rm('couples', {}, 'couples_测试绑定');
  const TYPES = ['pay_order', 'auth_session', 'user_profile', 'art_quota', 'art_job',
    'wxacode_poster', 'wxacode_ref', 'ref_code', 'ref_link'];
  for (const ty of TYPES) {
    await rm('prefs', { type: ty }, 'prefs_' + ty);
  }
  return {
    ok: true,
    msg: '清理完成。可再跑一遍核对全部为 0；微信侧 xpay 订单记录无法由此清除（沙箱订单不影响现网）',
    removed: report,
    kept: ['config（支付凭证）', 'prefs 其余类型']
  };
}

/** 4.20.6 上线前只读巡检（opsAudit）：opsCleanup 的配套验收工具——只查不删。
 *  返回各集合计数 + config 就绪状态（offerId 掩码、密钥不回显），用于「清理前后对比」验收：
 *  清理前跑一次看残留清单 → opsCleanup 清理 → 再跑一次全 0 即验收通过。
 *  防滥用：同 opsCleanup（opsToken = config.pay_secret.appKey）。 */
async function opsAuditAction(event) {
  const db = cloud.database();
  let appKey = '';
  let offerIdMasked = '(空)';
  try {
    const res = await db.collection('config').doc('pay_secret').get();
    appKey = String((res && res.data && res.data.appKey) || '');
    const oid = String((res && res.data && res.data.offerId) || '');
    if (oid) offerIdMasked = oid.slice(0, 4) + '****' + (oid.length > 8 ? oid.slice(-4) : '');
  } catch (e) {
    return { ok: false, msg: 'config.pay_secret 读取失败（支付凭证未配置？）' };
  }
  if (!appKey || String(event.opsToken || '') !== appKey) {
    return { ok: false, msg: 'opsToken 校验失败：需传 config.pay_secret 的 appKey 字段值' };
  }
  const count = async (name, where) => {
    try {
      const r = where ? await db.collection(name).where(where).count() : await db.collection(name).count();
      return r.total;
    } catch (e) {
      return 'err';
    }
  };
  const TYPES = ['pay_order', 'auth_session', 'user_profile', 'art_quota', 'art_job',
    'wxacode_poster', 'wxacode_ref', 'ref_code', 'ref_link'];
  const prefsCounts = {};
  for (const ty of TYPES) prefsCounts[ty] = await count('prefs', { type: ty });
  return {
    ok: true,
    msg: '巡检完成（只读不删）。tickets/couples/prefs 各 type 全 0 = 库已干净；pay_secret 就绪 = 支付凭证在位',
    config: { pay_secret: '就绪', offerId: offerIdMasked, appKey: '已配置(不回显)', env: '见配置值(0现网/1沙箱)' },
    counts: {
      tickets: await count('tickets'),
      couples: await count('couples'),
      prefs_by_type: prefsCounts
    },
    note: '微信侧 xpay 订单不在此巡检范围；权限设置/真机验收/支付单见《隐私合规与上线就绪排查报告》待确认清单'
  };
}

/**
 * 4.20.0 一次性管理 action：把虚拟支付道具图上传到云存储并返回公网下载直链。
 * 用途：/xpay/start_upload_goods 的 item_url（必填道具图片公网地址）。
 * 调用方：HTTP API /tcb/invokecloudfunction（服务器侧），前端页面不使用。
 * imgBase64 传图时执行上传；不传时只返回已存文件的下载直链（幂等复跑）。
 * 4.20.4 合规加固：加 opsToken 校验（= config.pay_secret.appKey，与 opsCleanup 同一密令）——
 *   遗留管理入口收敛最小暴露面；cloudPath 固定 goods/brand-logo.png，可写范围本就仅此一个文件。
 */
async function goodsImgSetupAction(event) {
  const FIXED_FILEID = 'cloud://cloud1-d5gpnyzjw64a60ac7.636c-cloud1-d5gpnyzjw64a60ac7-1481239884/goods/brand-logo.png';
  try {
    // opsToken 校验（防滥用：该 action 不面向前端，只有持 appKey 的服务器侧调用应通过）
    const db = cloud.database();
    const cfgRes = await db.collection('config').doc('pay_secret').get();
    const appKey = String((cfgRes && cfgRes.data && cfgRes.data.appKey) || '');
    if (!appKey || String(event.opsToken || '') !== appKey) {
      return { ok: false, msg: 'opsToken 校验失败' };
    }
    let fileID = FIXED_FILEID;
    if (event.imgBase64) {
      const up = await cloud.uploadFile({
        cloudPath: 'goods/brand-logo.png',
        fileContent: Buffer.from(String(event.imgBase64), 'base64')
      });
      if (up && up.fileID) fileID = up.fileID;
    }
    const got = await cloud.getTempFileURL({ fileList: [fileID] });
    const f = got && got.fileList && got.fileList[0];
    return { ok: true, fileID: fileID, url: (f && f.tempFileURL) || '', status: (f && f.status) };
  } catch (e) {
    return { ok: false, msg: String((e && e.message) || e).slice(0, 100) };
  }
}

// ============================================================
// M4 双人绑定：couples 集合（action 路由，免新增云函数）
// 文档结构：{ code, members:[openid], names:{openid:称呼},
//            status:'waiting'|'bound', createdAt, boundAt }
// ============================================================
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉 0O1IL 等易混淆字符

function makeInviteCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

/** 我所在的绑定文档（waiting / bound 都算） */
async function findMyCouple(db, OPENID) {
  const res = await db.collection('couples').where({ members: OPENID }).limit(1).get();
  return (res.data && res.data[0]) || null;
}

/** 绑定文档 → 前端视图（不暴露对方 openid 明文亦可，这里保留以便双人查询） */
function coupleView(doc, OPENID) {
  const partner = (doc.members || []).find((m) => m !== OPENID) || '';
  return {
    code: doc.code,
    status: doc.status,
    myName: (doc.names || {})[OPENID] || '我',
    partnerOpenid: partner,
    partnerName: (doc.names || {})[partner] || 'TA',
    createdAt: doc.createdAt || 0,
    boundAt: doc.boundAt || 0
  };
}

async function bindAction(event, OPENID) {
  const db = cloud.database();
  try {
    await ensureCollection(db, 'couples');
    const mode = event.mode;

    // —— 生成我的邀请码 ——
    if (mode === 'create') {
      const mine = await findMyCouple(db, OPENID);
      if (mine) {
        if (mine.status === 'bound') return { ok: true, bound: true, couple: coupleView(mine, OPENID) };
        return { ok: true, code: mine.code }; // 还在等人 → 复用同一码
      }
      const name = String(event.name || '').trim().slice(0, 12) || '我';
      for (let i = 0; i < 3; i++) {
        const code = makeInviteCode();
        try {
          await db.collection('couples').add({
            data: {
              code,
              members: [OPENID],
              names: { [OPENID]: name },
              status: 'waiting',
              createdAt: Date.now()
            }
          });
          return { ok: true, code };
        } catch (e) {
          // 码撞车重试；其他错误直接抛
        }
      }
      return { ok: false, msg: '邀请码生成失败，请重试' };
    }

    // —— 输码加入 ——
    if (mode === 'join') {
      const code = String(event.code || '').trim().toUpperCase();
      if (code.length !== 4) return { ok: false, msg: '邀请码是 4 位字符' };
      const mine = await findMyCouple(db, OPENID);
      if (mine && mine.status === 'bound') return { ok: false, msg: '你已和 TA 绑定，先解绑才能换人' };
      const res = await db.collection('couples').where({ code, status: 'waiting' }).limit(1).get();
      const doc = (res.data && res.data[0]) || null;
      if (!doc) return { ok: false, msg: '邀请码不存在或已被使用' };
      if ((doc.members || []).includes(OPENID)) {
        return { ok: true, bound: true, couple: coupleView(doc, OPENID) };
      }
      if ((doc.members || []).length !== 1) return { ok: false, msg: '这个邀请码刚被别人用了' };
      if (Date.now() - (doc.createdAt || 0) > 7 * 24 * 3600 * 1000) {
        await db.collection('couples').doc(doc._id).remove();
        return { ok: false, msg: '邀请码已过期，让 TA 重新生成' };
      }
      const name = String(event.name || '').trim().slice(0, 12) || 'TA';
      const next = {
        members: [...doc.members, OPENID],
        names: { ...(doc.names || {}), [OPENID]: name },
        status: 'bound',
        boundAt: Date.now()
      };
      await db.collection('couples').doc(doc._id).update({ data: next });
      return { ok: true, bound: true, couple: coupleView({ ...doc, ...next }, OPENID) };
    }

    // —— 查询我的绑定态 ——
    if (mode === 'query') {
      const mine = await findMyCouple(db, OPENID);
      if (!mine || mine.status !== 'bound') return { ok: true, bound: false };
      return { ok: true, bound: true, couple: coupleView(mine, OPENID) };
    }

    // —— 解绑 ——
    if (mode === 'unbind') {
      const mine = await findMyCouple(db, OPENID);
      if (mine) await db.collection('couples').doc(mine._id).remove();
      return { ok: true };
    }

    return { ok: false, msg: '未知的绑定操作' };
  } catch (e) {
    return { ok: false, msg: '绑定服务异常：' + (e.message || 'unknown') };
  }
}

// ============================================================
// 7.3.0 R6 邀请有礼（裂变）：短码 → 绑定关系 → 好友首票结算，双方各 +1 次图版
// 存储仍走 prefs（项目约定：不新增云函数，也不为单点功能新增集合）：
//   type='ref_code'  { _openid, code }                        我的邀请短码（每人一条，幂等）
//   type='ref_link'  { _openid, code, inviter, status, ... }  邀请关系（_openid = 被邀请人，
//                                                             每人一条 → 一个账号最多被邀请一次）
// 防刷四道闸：
//   ① 被邀请人唯一 —— 同一个账号反复点同一个码只算一次，奖励不会重复发；
//   ② 不能邀请自己 —— refBind 里直接挡；
//   ③ **老用户不发奖** —— 绑定时已有票根的人不算「被邀请来的新用户」，
//      关系照记（归因/K 因子仍可看），但不入账；
//   ④ 结算以「被邀请人真的有 ≥1 张票根」为前提 + 条件更新抢占结算权
//      （并发/重试只有一支能改到 pending → settled）。
// 入账口径与看视频奖励一致：并入 paid 池 + 同步记 bonus（退款回退上限 = paid - bonus）。
// ============================================================
const REF_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 与双人邀请码同表：去掉 0O1IL 等易混字符

function makeRefCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += REF_CODE_CHARS[Math.floor(Math.random() * REF_CODE_CHARS.length)];
  return s;
}

/** 我的邀请短码：没有就生成一条（分享 path 与小程序码都读它） */
async function refCodeAction(OPENID) {
  try {
    const db = cloud.database();
    await ensureCollection(db, 'prefs');
    const col = db.collection('prefs');
    const mine = await col.where({ _openid: OPENID, type: 'ref_code' }).limit(1).get();
    if (mine.data && mine.data[0]) return { ok: true, code: mine.data[0].code };
    for (let i = 0; i < 3; i++) {
      const code = makeRefCode();
      try {
        await col.add({ data: { _openid: OPENID, type: 'ref_code', code, createdAt: Date.now() } });
        return { ok: true, code };
      } catch (e) { /* 撞码重试 */ }
    }
    return { ok: false, msg: '邀请码生成失败' };
  } catch (e) {
    return { ok: false, msg: '邀请码服务异常' };
  }
}

/** 绑定邀请关系（幂等：我已有关系就直接返回，换码也绑不上） */
async function refBindAction(event, OPENID) {
  try {
    const code = String(event.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (code.length < 4) return { ok: false, msg: '邀请码无效' };
    const db = cloud.database();
    await ensureCollection(db, 'prefs');
    const col = db.collection('prefs');

    const mine = await col.where({ _openid: OPENID, type: 'ref_link' }).limit(1).get();
    if (mine.data && mine.data[0]) return { ok: true, bound: false, dup: true };

    const from = await col.where({ type: 'ref_code', code }).limit(1).get();
    const inviter = (from.data && from.data[0] && from.data[0]._openid) || '';
    if (!inviter) return { ok: false, msg: '邀请码不存在' };
    if (inviter === OPENID) return { ok: false, msg: '不能邀请自己' };

    // 老用户判定：绑定时已有票根 = 不是被邀请来的新用户 → 只记归因，不发奖
    let had = 0;
    try {
      const c = await db.collection('tickets').where({ _openid: OPENID }).count();
      had = (c && c.total) || 0;
    } catch (e) { had = 0; }

    await col.add({
      data: {
        _openid: OPENID,
        type: 'ref_link',
        code,
        inviter,
        status: had > 0 ? 'stale' : 'pending',
        hadTickets: had,
        createdAt: Date.now()
      }
    });
    return { ok: true, bound: true, stale: had > 0 };
  } catch (e) {
    return { ok: false, msg: '邀请绑定失败' };
  }
}

/** 奖励入账 +1 幅（并入 paid 池并记 bonus：奖励次数不算付费资产，退款不退还）
 *  7.4.0 起邀请有礼与每日连签共用同一入账口径，故不再叫 Ref。 */
async function grantBonusArt(db, openid) {
  const _ = db.command;
  const q = await pay.loadQuota(db, openid);
  await db.collection('prefs').doc(q._id).update({
    data: { paid: _.inc(1), bonus: _.inc(1), updatedAt: Date.now() }
  });
}

/** 结算邀请奖励：被邀请人（我）已上传过票根 → 双方各 +1 次图版。幂等，前端可反复催。 */
async function refRewardAction(OPENID) {
  try {
    const db = cloud.database();
    await ensureCollection(db, 'prefs');
    const col = db.collection('prefs');
    const rec = await col.where({ _openid: OPENID, type: 'ref_link', status: 'pending' }).limit(1).get();
    const link = rec.data && rec.data[0];
    if (!link) return { ok: true, granted: false };

    // 前提：被邀请人真的收下了自己的第一张票根（前端只是触发器，判定在服务端）
    let n = 0;
    try {
      const c = await db.collection('tickets').where({ _openid: OPENID }).count();
      n = (c && c.total) || 0;
    } catch (e) { n = 0; }
    if (n < 1) return { ok: true, granted: false, wait: true };

    // 抢占结算权：条件更新只有一支能改到 → 并发与重试都不会发第二次奖
    const claim = await col.where({ _id: link._id, status: 'pending' })
      .update({ data: { status: 'settled', settledAt: Date.now() } });
    if (!claim.stats || !claim.stats.updated) return { ok: true, granted: false };

    try {
      await grantBonusArt(db, OPENID);
      await grantBonusArt(db, link.inviter);
    } catch (e) {
      // 入账失败：把结算权还回去，下次启动自动补发（与掉单自愈同一思路）
      try { await col.doc(link._id).update({ data: { status: 'pending' } }); } catch (e2) { /* 下次再说 */ }
      return { ok: false, granted: false, msg: '奖励入账失败，稍后自动补发' };
    }
    return { ok: true, granted: true };
  } catch (e) {
    return { ok: false, msg: '邀请奖励结算异常' };
  }
}

// ============================================================
// 7.4.0 R1/R2 每日时光签 + 积分账本
// 为什么签到必须落在服务端：这里是**发东西**的地方（积分能换真金白银的 AI 重绘）。
//   若把「今天签过没有」交给客户端，改一下手机日期就能天天领；
//   所以日期口径、是否已签、连签几天、发不发奖，全部在这里判定，客户端只读。
// 存储（仍走 prefs，沿用项目约定：不新建云函数，也不为单点功能新建集合）：
//   type='daily_sign' { _openid, ymd, lastYmd, streak, best, total }
//   type='points'     { _openid, balance, lifetime, log[] }   ← 流水只留最近 50 条
// 连签阶梯的发放口径：streak 恰好等于键名时发一次。断签后 streak 归 1，下个周期可再拿
//   —— 想再拿就得再连着来 7 天，天数本身就是成本闸门（重绘是真实成本）。
// ============================================================
const SIGN_BASE_POINTS = 5; // 每日签到基础分（R2 表：每日签到 +5）
const SIGN_MILESTONES = {
  3: { points: 10 },  // 连签 3 天：+10 分
  7: { art: 1 },      // 连签 7 天：+1 次 AI 重绘（真实成本，只给 1 次）
  14: { points: 50 }  // 连签 14 天：+50 分
  // 原方案第 30 天档是「1 次高清导出」——当前卡片导出本来就没有水印，等口径定了再补
};

/** 积分账本：读一份（没有就建一条）；余额与服务端记账同源，客户端只读 */
async function loadPoints(db, openid) {
  const col = db.collection('prefs');
  const res = await col.where({ _openid: openid, type: 'points' }).limit(1).get();
  if (res.data && res.data[0]) return res.data[0];
  const added = await col.add({
    data: { _openid: openid, type: 'points', balance: 0, lifetime: 0, log: [], updatedAt: Date.now() }
  });
  return { _id: added._id, balance: 0, lifetime: 0, log: [] };
}

/**
 * 记账：余额用原子自增（并发不丢更新），流水单独写一条。
 * 两笔写分开是刻意的——流水那笔即便失败（如运行环境不支持 push.slice），
 * 余额也已经入账：账目优先，明细其次。流水只留最近 50 条。
 */
async function addPoints(db, openid, delta, reason) {
  const d = Number(delta) || 0;
  if (!d) return;
  const _ = db.command;
  const p = await loadPoints(db, openid);
  const col = db.collection('prefs');
  await col.doc(p._id).update({
    data: { balance: _.inc(d), lifetime: d > 0 ? _.inc(d) : _.inc(0), updatedAt: Date.now() }
  });
  await col.doc(p._id).update({
    data: { log: _.push({ each: [{ at: Date.now(), delta: d, reason: String(reason || '') }], slice: -50 }) }
  }).catch(() => {});
}

/**
 * 签到状态视图（前端展示用）。streak 的「活着」判定：
 *   只有今天签了、或昨天签过（今天还没签）才算连签还在 —— 前天签的就已经断了，
 *   若还显示「连续 5 天」就是骗人，用户明天发现归零反而更受伤。
 */
function signView(d, today, yesterday) {
  const signed = !!d && d.ymd === today;
  const alive = !!d && (signed || d.ymd === yesterday);
  return {
    signed,
    streak: alive ? (d.streak || 0) : 0,
    best: (d && d.best) || 0,
    total: (d && d.total) || 0,
    today
  };
}

/**
 * 每日时光签：签到 / 查状态（event.check=true 只看不动）。
 * 幂等三道闸：① 今天签过直接返回；② 并发用条件更新抢签发权（只有一支能改到）；
 * ③ 发奖失败把今天退回「未签」，用户再点一次即可补上（与邀请奖励还回结算权同一思路）。
 */
async function dailySignAction(event, OPENID) {
  try {
    const db = cloud.database();
    const _ = db.command;
    await ensureCollection(db, 'prefs');
    const col = db.collection('prefs');
    const today = pay.ymdNow();
    const yesterday = pay.ymdNow(-1);
    const rec = await col.where({ _openid: OPENID, type: 'daily_sign' }).limit(1).get();
    const d = rec.data && rec.data[0];

    // 只看不动：首页横条与我的页进页面时拉状态，不签发（用户没点就不算签到）
    if (event.check) {
      const p = await loadPoints(db, OPENID);
      return Object.assign({ ok: true, balance: p.balance || 0 }, signView(d, today, yesterday));
    }

    if (d && d.ymd === today) {
      const p = await loadPoints(db, OPENID);
      return Object.assign({ ok: true, already: true, balance: p.balance || 0 }, signView(d, today, yesterday));
    }

    const streak = d && d.ymd === yesterday ? (d.streak || 0) + 1 : 1;
    const next = {
      ymd: today,
      lastYmd: today,
      streak,
      best: Math.max(streak, (d && d.best) || 0),
      total: ((d && d.total) || 0) + 1,
      updatedAt: Date.now()
    };

    let addedId = '';
    if (d) {
      // 抢签发权：条件更新只有一支能改到，并发/重试不会发第二次奖
      const claim = await col.where({ _id: d._id, ymd: _.neq(today) }).update({ data: next });
      if (!claim.stats || !claim.stats.updated) {
        const p0 = await loadPoints(db, OPENID);
        return Object.assign({ ok: true, already: true, balance: p0.balance || 0 }, signView(d, today, yesterday));
      }
    } else {
      // 首次签到没有旧文档可抢：同一毫秒双击理论上能落两条，概率可忽略，不做额外去重
      // ponytail: 首次签到无并发闸；真有人刷再加唯一键（自定义 _id）
      const added = await col.add({ data: Object.assign({ _openid: OPENID, type: 'daily_sign' }, next) });
      addedId = added._id;
    }

    let points = SIGN_BASE_POINTS;
    let art = 0;
    const ms = SIGN_MILESTONES[streak];
    if (ms) { points += ms.points || 0; art += ms.art || 0; }
    try {
      await addPoints(db, OPENID, points, ms ? ('sign_d' + streak) : 'sign');
      if (art) await grantBonusArt(db, OPENID);
    } catch (e) {
      // 发奖失败 → 把今天退回未签：否则这一天的签到被吃掉，用户连点也补不回来
      try {
        if (d) await col.doc(d._id).update({ data: { ymd: d.ymd || '', streak: d.streak || 0, best: d.best || 0, total: d.total || 0, updatedAt: Date.now() } });
        else if (addedId) await col.doc(addedId).remove();
      } catch (e2) { /* 回滚失败不阻塞：返回失败让用户重试，最坏是这天的奖没发 */ }
      return { ok: false, msg: '签到奖励入账失败，请再点一次' };
    }

    const p = await loadPoints(db, OPENID);
    const out = Object.assign({
      ok: true,
      already: false,
      points,
      art,
      milestone: ms ? streak : 0,
      balance: p.balance || 0
    }, signView(next, today, yesterday));
    if (art) out.quota = pay.quotaView(await pay.loadQuota(db, OPENID));
    return out;
  } catch (e) {
    return { ok: false, msg: '签到失败：' + String((e && e.message) || e).slice(0, 60) };
  }
}

/** 双人合并统计（端上读不到别人的票根，必须在云函数里查） */
async function duoStatsAction(OPENID, full) {
  const db = cloud.database();
  try {
    const mine = await findMyCouple(db, OPENID);
    if (!mine || mine.status !== 'bound') return { ok: false, msg: '尚未绑定' };
    const partner = (mine.members || []).find((m) => m !== OPENID) || '';
    const _ = db.command;
    // 6.6.3（P2-7）：云函数端单次上限 100 条，limit(500) 会被静默截断到 100 →
    // total/shows/cities 全部少算且无任何提示。改为 count() 取真实总数 + 分批拉取。
    const baseWhere = { _openid: _.in([OPENID, partner]) };
    const col = db.collection('tickets');
    let grandTotal = 0;
    let countOk = true;
    try { const c = await col.where(baseWhere).count(); grandTotal = (c && c.total) || 0; } catch (e) { countOk = false; }
    const PAGE = 100, MAXP = 20; // 最多拉 2000 张，防极端数据量拖死云函数
    const pages = Math.min(Math.ceil(grandTotal / PAGE) || 1, MAXP);
    // 6.6.5：改用 allSettled——旧实现任一页 reject 会让整个统计失败；count 失败又静默当 0 →
    // total/truncated 双双失真。现在失败页跳过、失败计数计入 truncated，保证尽量出结果。
    const batches = await Promise.allSettled(
      Array.from({ length: pages }, (_, i) =>
        col.where(baseWhere).orderBy('date', 'desc').skip(i * PAGE).limit(PAGE).get()
      )
    );
    let list = [];
    let pageFailed = 0;
    batches.forEach((r) => {
      if (r && r.status === 'fulfilled' && r.value && r.value.data) list = list.concat(r.value.data);
      else pageFailed += 1;
    });
    // 仍触顶（超 MAXP×PAGE / count 失败 / 有失败页）→ 在返回值里明示截断，前端可提示
    const truncated = !countOk || grandTotal > list.length || pageFailed > 0;
    const cities = new Set(list.filter((t) => t.city).map((t) => t.city));
    // 6.6.3（P2-21）：按日期倒序后，优先排「我的」票根——duo 页「生成双人纪念卡片」取 recent[0]
    // 直接跳 card?id=，若最近一张是 TA 的票，card 页归属校验会落 notFound 空态。
    // 服务端已保证 recent[0] 是我的票，前端无需再猜。
    const recent = list
      .slice()
      .sort((a, b) => {
        const am = a._openid === OPENID ? 0 : 1;
        const bm = b._openid === OPENID ? 0 : 1;
        if (am !== bm) return am - bm; // 我的票整体排前
        return String(b.date || '').localeCompare(String(a.date || ''));
      })
      .slice(0, 5)
      .map((t) => ({
        id: t._id,
        title: t.title,
        date: t.date,
        type: t.type,
        owner: t._openid === OPENID ? 'me' : 'partner'
      }));
    // M4-b：full 模式返回双方全量精简票根（timeline/report 页同源数据）
    // 7.0.0（稿屏10）：items 保留 img——双人票根卡的缩略图（云存储 fileID），无图卡退类型图标
    const items = full
      ? list.map((t) => ({
          id: t._id,
          title: t.title,
          type: t.type,
          date: t.date,
          time: t.time || '',
          img: t.img || '',
          city: t.city || '',
          venue: t.venue || '',
          seat: t.seat || '',
          price: t.price || null,
          geo: t.geo || null,
          eventKey: t.eventKey || '',
          owner: t._openid === OPENID ? 'me' : 'partner'
        }))
      : undefined;
    return {
      ok: true,
      total: list.length,
      truncated, // 6.6.3（P2-7）：true = 数据量超分批上限，统计不完整（前端可提示）
      shows: list.filter((t) => t.type === 'show').length,
      cities: cities.size,
      recent,
      items,
      myName: (mine.names || {})[OPENID] || '我',
      partnerName: (mine.names || {})[partner] || 'TA',
      boundAt: mine.boundAt || 0
    };
  } catch (e) {
    return { ok: false, msg: '统计失败：' + (e.message || 'unknown') };
  }
}

/** 同场收藏计数（同场偶遇的地基；只返回 count，无隐私面） */
async function eventStatsAction(event) {
  const eventKey = String(event.eventKey || '');
  if (!eventKey) return { ok: false, msg: '缺少场次键' };
  try {
    const db = cloud.database();
    const res = await db.collection('tickets').where({ eventKey }).count();
    return { ok: true, count: res.total || 0 };
  } catch (e) {
    return { ok: false, msg: '查询失败' };
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  // —— 4.20.0 虚拟支付消息推送（Event 分发，无 action 字段）——
  // 所有 xpay_* 事件必须在此消化（回 {ErrCode:0} 或 iOS 问询应答体）：
  // 掉进入库主流程会返回 {ok:false,...}，微信视为应答失败 → 最多重推 15 次
  //（含对账无关事件：complaint 投诉 / wxpay_callback 支付回调等，收到即成功）。
  if (/^xpay_/.test(String(event.Event || ''))) {
    // ⚠️ 安全门禁（5.0.0 修 P0-3 · 资金敞口）：
    // 微信发货/退款推送是「服务端 → 云函数」的投递，消息体里没有小程序用户上下文，
    // 因此 getWXContext().OPENID 必为空。若这里能取到 OPENID，说明这次调用来自
    // 小程序端 wx.cloud.callFunction 的伪造（用户可自填 Event / OpenId / Quantity）。
    // 一律拒绝：回 ErrCode:0 是刻意的 —— 回 -1 会让微信重推 15 次，等于给伪造者
    // 15 次尝试机会；回 0 直接终结。
    // 注意：这只是第一道闸。真正的发货依据是 payNotifyAction 里的微信侧查单复核，
    // 即便本闸被绕过，查单也会挡下（双重保险）。
    if (cloud.getWXContext().OPENID) {
      console.warn('[xpay] 拒绝客户端直调伪造的推送事件：', String(event.Event));
      return { ErrCode: 0, ErrMsg: 'rejected(client-origin)' };
    }
    switch (event.Event) {
      case 'xpay_goods_deliver_notify':
        return payNotifyAction(event);
      case 'xpay_refund_notify':
        return payRefundAction(event);
      case 'xpay_subscribe_ios_refund_query_notify':
        return payIosRefundQueryAction(event);
      default:
        return { ErrCode: 0, ErrMsg: 'ignored' };
    }
  }
  // —— action 路由：内容安全 / 双人绑定 / 双人统计 / 同场计数 / AI 文案 / 登录 / 支付 ——
  if (event.action === 'checkText') {
    return checkTextAction(event, OPENID);
  }
  if (event.action === 'setCaption') {
    return setCaptionAction(event, OPENID);
  }
  if (event.action === 'reorder') {
    return reorderAction(event, OPENID);
  }
  if (event.action === 'reorderGroups') {
    return reorderGroupsAction(event, OPENID);
  }
  if (event.action === 'getGroupOrder') {
    return getGroupOrderAction(OPENID);
  }
  if (event.action === 'wxacode') {
    // ⚠️ 必须把 event 传进去：卡页会带 ref（我的邀请短码）来换「带邀请码的海报码」，
    // 漏传就恒为全局码 —— 分享链路照样能走通，只是归因永远算不到邀请人头上。
    return wxacodeAction(event);
  }
  if (event.action === 'backfillGeo') {
    return backfillGeoAction(OPENID);
  }
  if (event.action === 'artRestyle') {
    return artRestyleAction(event, OPENID);
  }
  if (event.action === 'artQuery') {
    return artQueryAction(event, OPENID);
  }
  // 4.20.0 授权登录 + 虚拟支付
  if (event.action === 'authLogin') {
    return authLoginAction(event, OPENID);
  }
  if (event.action === 'payCreate') {
    return payCreateAction(event, OPENID);
  }
  if (event.action === 'payQuery') {
    return payQueryAction(event, OPENID);
  }
  // 4.22.0 支付后主动确认（即时到账核心分支：查微信侧状态 → 立即发货）
  if (event.action === 'payConfirm') {
    return payConfirmAction(event, OPENID);
  }
  if (event.action === 'quotaGet') {
    return quotaGetAction(OPENID);
  }
  // 4.21.0 激励视频奖励入账（流量主变现：看视频免费补 1 幅）
  if (event.action === 'artRewardGrant') {
    return artRewardGrantAction(event, OPENID);
  }
  if (event.action === 'profileGet') {
    return profileGetAction(OPENID);
  }
  if (event.action === 'profileSave') {
    return profileSaveAction(event, OPENID);
  }
  if (event.action === 'profileClear') {
    return profileClearAction(OPENID);
  }
  // 4.20.0 一次性管理 action：上传虚拟支付道具图到云存储并返回公网下载直链
  //（供 start_upload_goods 的 item_url 使用；经 HTTP API /tcb/invokecloudfunction 调用，前端不使用）
  if (event.action === 'goodsImgSetup') {
    return goodsImgSetupAction(event);
  }
  // 4.20.4 上线前数据清理（仅云端测试/HTTP API 调用，前端不使用；opsToken 防滥用）
  if (event.action === 'opsCleanup') {
    return opsCleanupAction(event);
  }
  // 4.20.6 上线前只读巡检（opsCleanup 配套验收工具；opsToken 防滥用）
  if (event.action === 'opsAudit') {
    return opsAuditAction(event);
  }
  if (event.action === 'bind') {
    return bindAction(event, OPENID);
  }
  if (event.action === 'duoStats') {
    return duoStatsAction(OPENID, !!event.full);
  }
  // 7.3.0 R6 邀请有礼：短码 / 绑定 / 结算（见文件上方 R6 段落）
  if (event.action === 'refCode') {
    return refCodeAction(OPENID);
  }
  if (event.action === 'refBind') {
    return refBindAction(event, OPENID);
  }
  if (event.action === 'refReward') {
    return refRewardAction(OPENID);
  }
  // 7.4.0 R1 每日时光签：签到 / 查状态（前端只读，判定与发奖都在服务端）
  if (event.action === 'dailySign') {
    return dailySignAction(event, OPENID);
  }
  if (event.action === 'eventStats') {
    return eventStatsAction(event);
  }
  const t = event.ticket || {};

  // —— 必填兜底 ——
  if (!t.title) t.title = '未命名票根';
  if (!t.date) return { ok: false, msg: '缺少日期（请回确认页补全）' };

  // —— 服务端补齐（不可信任客户端的字段都在这补） ——
  t._openid = OPENID;
  t.createdAt = Date.now();
  // 4.11.0 同场印记 opt-out：用户退出参与时不下发场次键（eventStats 聚合自然排除）
  const sameOptOut = !!t.sameOptOut;
  delete t.sameOptOut; // 偏好不入库，只在当次入库生效并写进隐私协议口径
  t.eventKey = sameOptOut ? '' : makeEventKey(t.venue, t.date);
  t.type = ['show', 'movie', 'traffic'].includes(t.type) ? t.type : 'show';
  // 6.6.5（P1）：price 拒绝负数/Infinity/NaN（typeof NaN === 'number'，Number('-100') 原实现直接入库污染报表）
  const _pv = Number(t.price);
  t.price = Number.isFinite(_pv) && _pv >= 0 ? Math.min(_pv, 1e7) : null;
  // 6.6.5（P1）：rating 夹到 [0,5]，防负数/超大值溢出前端星级渲染
  if (t.rating !== undefined && t.rating !== null) {
    const _rv = Number(t.rating);
    t.rating = Number.isFinite(_rv) ? Math.min(Math.max(_rv, 0), 5) : 0;
  }
  // 6.6.5（P1）：geo 加 lng + isFinite + 范围校验——NaN 的 typeof 也是 'number'，
  // 旧校验只查 lat 类型会放 NaN 坐标/缺 lng 的脏数据入库，污染地图与 haversine 里程累加
  t.geo = (t.geo && typeof t.geo.lat === 'number' && isFinite(t.geo.lat) &&
    typeof t.geo.lng === 'number' && isFinite(t.geo.lng) &&
    t.geo.lat >= -90 && t.geo.lat <= 90 && t.geo.lng >= -180 && t.geo.lng <= 180) ? t.geo : null;
  // 4.18.0 P0 geo 断链修复：OCR/手填通常只有 city 文本、没有坐标，导致天气/足迹/勋章
  // 全链路拿不到 geo。此处用城市静态字典按 city 配中心坐标（查不到保持 null，不猜）。
  // 4.18.1 场馆级精化：配了腾讯位置服务 key 且场馆名可解析 → 精确到 POI 坐标
  // （如「南京奥体中心」），失败/未配 key 保持城市中心；geoSource 标记坐标来源。
  if (!t.geo && t.city) {
    let src = '';
    const g = lookupCity(t.city);
    if (g) { t.geo = g; src = 'city'; }
    if (t.geo && t.venue) {
      const p = await geocodeVenue(t.city, t.venue);
      if (p) { t.geo = p; src = 'venue'; }
    }
    if (src) t.geoSource = src;
  }

  // —— M5+：用户可改写的文本字段入库前统一过安全检测（合规口径：文字先审后显） ——
  // title/note 为自由输入字段，入库前必检；venue/seat/city 以票面 OCR 转录+字典配对为主，不作强制检测。
  // 服务异常（微信平台级故障）时放行入库：内容仅用户私有、无公开场景，不阻塞核心收藏流程。
  const userText = [t.title, t.note].filter(Boolean).join('\n').trim();
  if (userText) {
    const sc = await secCheck(OPENID, userText);
    if (sc.result === 'risky') return { ok: false, msg: '票面文字未通过安全检查：' + sc.msg };
  }

  // —— 天气静默存档（V1.5 起 UI 使用；失败不阻塞） ——
  t.weather = null;
  if (t.geo && t.date) {
    t.weather = await fetchWeather(t.geo.lat, t.geo.lng, t.date);
  }

  try {
    const db = cloud.database();
    await ensureCollection(db, 'tickets');
    const res = await db.collection('tickets').add({ data: t });
    return { ok: true, _id: res._id, weather: t.weather };
  } catch (e) {
    return { ok: false, msg: '入库失败：' + (e.message || 'unknown') };
  }
};
