// utils/pay.js —— 4.22.0 虚拟支付端上封装（图版次数包 · 虚拟商品即时到账）
// ============================================================
// 官方链路：payCreate（服务端双签名）→ wx.requestVirtualPayment 拉起 →
//   payConfirm（服务端主动查微信侧状态 → 立即发货，秒级到账）→
//   【兜底】微信发货推送幂等发货 + 前端轮询 payQuery + 掉单自愈（quotaGet 顺带对账）。
// 前端只做「拉起 + 确认」：签名/订单/额度全部服务端权威，本地不记钱。
// 兼容咬合：payCreate 可能返回 NEED_LOGIN（session 过期）→ ensureSession(force)
//   重试一次 —— 登录与支付两条链路在这里咬合。
// 凭证未配置（NO_CONFIG）是用户侧可自检的问题，给出明确指引而不是笼统报错。
// ============================================================
const { USE_CLOUD } = require('./env.js');
const auth = require('./auth.js');
const track = require('./track.js');

const PRODUCT_ID = 'ART_PACK_10';
const PACK_PRICE_LABEL = '¥6 / 10 幅';

/**
 * wx.requestVirtualPayment 失败 → 人话（官方错误码表 2026-09 核对，与云函数 humanizePayErr 同源）。
 * 两层匹配：errno 数字（-15013）优先；errMsg 错误名（GOODS_PRICE_INVALID）兜底——
 * 部分基础库版本 fail 回调只给错误名不给 errno，只按数字映射会漏。
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

async function callAction(data) {
  const res = await wx.cloud.callFunction({ name: 'saveTicket', data });
  return (res && res.result) || {};
}

/** 服务端权威额度视图 → {freeLeft, paid, left, freePerMonth} | null（云失败由调用方兜底） */
async function getQuota() {
  if (!USE_CLOUD) return null;
  try {
    const r = await callAction({ action: 'quotaGet' });
    return r.ok ? r.quota : null;
  } catch (e) {
    return null;
  }
}

/**
 * 购买图版次数包（完整链路）。
 * @param {function=} onStatus 轮询进度回调（文本）
 * @returns {Promise<{ok:boolean, quota?:object, cancelled?:boolean, pending?:boolean, msg?:string, code?:string}>}
 *   约定：不 throw，一律返回 ok 标志，方便调用方单一处理路径。
 */
async function buyArtPack(onStatus) {
  if (!USE_CLOUD) {
    return { ok: false, msg: '演示模式不支持支付，部署云环境后可用' };
  }
  // 1) 会话就绪（支付签名需要 session_key）——4.20.1：透传服务端登录失败原因
  const ready = await auth.ensureSession(false);
  if (!ready || !ready.ok) {
    return { ok: false, code: 'NEED_LOGIN', msg: '登录失败：' + ((ready && ready.msg) || '请稍后重试') };
  }

  // 2) 下单取签名
  let r = await callAction({ action: 'payCreate', productId: PRODUCT_ID });
  if (!r.ok && r.code === 'NEED_LOGIN') {
    // wx.login 刷新过 session / 服务端 session 过期 → 强制重登一次再试
    const re = await auth.ensureSession(true);
    if (!re || !re.ok) return { ok: false, code: 'NEED_LOGIN', msg: '登录态刷新失败：' + ((re && re.msg) || '请稍后重试') };
    r = await callAction({ action: 'payCreate', productId: PRODUCT_ID });
  }
  if (!r.ok) {
    const hint = r.code === 'NO_CONFIG'
      ? '支付尚未配置：请在微信开发者工具云开发控制台 → 数据库 → config 集合新建 _id=pay_secret 文档（offerId/appKey/appSecret/env）'
      : (r.msg || '下单失败，请稍后再试');
    return { ok: false, code: r.code, msg: hint };
  }

  // 3) 拉起收银台
  // 7.2.0 §3.3 埋点：pay_start 记在「真的要拉起收银台」这一刻 ——
  // 前面还有登录/下单两步，早记会把「登录失败」也算成用户不想买。
  track.track('pay_start', { productId: PRODUCT_ID });
  const payRes = await new Promise((resolve) => {
    wx.requestVirtualPayment({
      mode: 'short_series_goods',
      signData: r.signData,
      paySig: r.paySig,
      signature: r.signature,
      success: () => resolve({ done: true }),
      fail: (e) => resolve({ done: false, errno: e && e.errno, errMsg: (e && e.errMsg) || '' })
    });
  });
  if (!payRes.done) {
    // 用户主动取消：静默（不弹错），调用方无需提示
    if (/cancel/i.test(payRes.errMsg)) {
      track.track('pay_cancel', { productId: PRODUCT_ID });
      return { ok: false, cancelled: true };
    }
    const hint = humanizePayErr(payRes.errno, payRes.errMsg);
    return { ok: false, errno: payRes.errno, msg: hint || ('支付未完成：' + (payRes.errMsg || '未知错误')) };
  }

  // 支付成功（= 收银台放行）。到账是另一件事：下面 payConfirm 失败还会走轮询兜底，
  // 所以这里记的是「付了」，不是「拿到了」——拿没拿到看 art_reward_grant / 额度变更。
  track.track('pay_success', { productId: PRODUCT_ID });

  // 4) 4.22.0 主动确认订单（即时到账）：支付 success 后不等微信发货推送，
  //    立即让服务端查微信侧真实状态并发货——秒级到账，无「物流/发货」等待语义。
  //    确认失败/未支付/网络异常 → 落回 5) 轮询兜底（推送最终也会幂等补发）。
  const outTradeNo = r.outTradeNo;
  if (onStatus) onStatus('正在确认到账…');
  try {
    const cf = await callAction({ action: 'payConfirm', outTradeNo });
    if (cf.ok) return { ok: true, quota: cf.quota || null }; // 已到账（幂等）
    if (cf.code === 'REFUNDED') {
      return { ok: false, code: 'REFUNDED', msg: '订单已退款，如有疑问请联系开发者' };
    }
    // NOT_PAID（状态同步延迟）/ CHECK_FAIL / NEED_LOGIN / EXPIRED → 交给轮询兜底
  } catch (e) { /* 确认异常不致命，走轮询 */ }

  // 5) 轮询确认到账（发货推送/微信状态有秒级同步窗口；1.5s × 15 ≈ 22s 上限。
  //    4.22.5（BUG审查⑥）：8 次≈12s 在推送高峰可能不够，放宽到 15 次；超窗仍有云函数幂等发货兜底）
  let quota = null;
  let delivered = false;
  let badStatus = '';
  for (let i = 0; i < 15; i++) {
    if (onStatus && i > 0) onStatus('确认到账中…');
    await new Promise((res) => setTimeout(res, i === 0 ? 600 : 1500));
    try {
      const q = await callAction({ action: 'payQuery', outTradeNo });
      if (q.ok) {
        quota = q.quota || quota;
        if (q.order && q.order.status === 'delivered') { delivered = true; break; }
        // 订单进入异常终态（价格/归属校验失败，微信侧重试也不会成功）→ 立刻明确报错
        if (q.order && (q.order.status === 'price_mismatch' || q.order.status === 'attach_mismatch')) {
          badStatus = q.order.status;
          break;
        }
      }
    } catch (e) { /* 单次查询失败继续轮询 */ }
  }
  if (delivered) return { ok: true, quota };
  if (badStatus) {
    return { ok: false, code: badStatus, msg: '订单状态异常（价格校验未通过），本次支付不会到账；如有扣款请联系开发者核实处理' };
  }
  // 推送延迟超过轮询窗口：钱已扣，发货推送最终会到（云函数幂等兜底）——不吓用户
  return { ok: false, pending: true, quota, msg: '支付成功，次数到账稍有延迟，稍后回来刷新即可' };
}

/** 授权资料（me 页授权卡） */
async function getProfile() {
  if (!USE_CLOUD) return { nickname: '', avatar: '' };
  try {
    const r = await callAction({ action: 'profileGet' });
    return r.ok ? (r.profile || { nickname: '', avatar: '' }) : { nickname: '', avatar: '' };
  } catch (e) {
    return { nickname: '', avatar: '' };
  }
}

async function saveProfile(nickname, avatar) {
  const r = await callAction({ action: 'profileSave', nickname, avatar });
  if (!r.ok) throw new Error(r.msg || '保存失败');
  return true;
}

/** 4.20.3 清除署名资料（昵称+头像）：PIPL 删除权呼应；失败 throw 由调用方决定是否本地先行 */
async function clearProfile() {
  const r = await callAction({ action: 'profileClear' });
  if (!r.ok) throw new Error(r.msg || '清除失败');
  return true;
}

/** 服务端额度视图 → 展示文案（art 页与 me 页共用口径） */
function quotaLabel(quota, freePerMonth) {
  if (!quota || typeof quota.left !== 'number') return '';
  const paid = quota.paid || 0;
  const freeLeft = typeof quota.freeLeft === 'number' ? quota.freeLeft : quota.left;
  const fpm = freePerMonth || quota.freePerMonth || 3;
  return paid > 0
    ? `图版次数 · 剩 ${quota.left} 幅（免费 ${freeLeft} + 次数包 ${paid}）`
    : `本月免费额度 · 剩 ${freeLeft}/${fpm} 幅`;
}

module.exports = {
  PRODUCT_ID, PACK_PRICE_LABEL, humanizePayErr,
  getQuota, buyArtPack, getProfile, saveProfile, clearProfile, quotaLabel
};
