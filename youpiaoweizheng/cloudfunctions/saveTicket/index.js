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
 *            user_profile（测试署名，如「流浪唱片」）/ art_quota（测试额度）/ art_job（生图任务）/ wxacode_poster（码缓存）
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
  const TYPES = ['pay_order', 'auth_session', 'user_profile', 'art_quota', 'art_job', 'wxacode_poster'];
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
  const TYPES = ['pay_order', 'auth_session', 'user_profile', 'art_quota', 'art_job', 'wxacode_poster'];
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
    return wxacodeAction();
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
