// utils/couple.js —— M4 双人绑定的端上封装
// ============================================================
// 云模式：调 saveTicket 云函数的 bind action（生成/加入/查询/解绑）
// 演示模式：本地造一对演示绑定（走通 UI 流程，数据不出本机）
// 绑定状态会缓存到 storage（sp_couple_cache），me 页勋章免二次查询。
// ============================================================
const { USE_CLOUD } = require('./env.js');

const LS_COUPLE = 'sp_couple_cache';

function readCache() {
  try { return wx.getStorageSync(LS_COUPLE) || null; } catch (e) { return null; }
}

function writeCache(couple) {
  try {
    if (couple) wx.setStorageSync(LS_COUPLE, couple);
    else wx.removeStorageSync(LS_COUPLE);
  } catch (e) { /* 存储失败不阻塞 */ }
}

async function bindCall(data) {
  const res = await wx.cloud.callFunction({
    name: 'saveTicket',
    data: { action: 'bind', ...data }
  });
  const r = (res && res.result) || {};
  if (!r.ok) throw new Error(r.msg || '操作失败，请稍后再试');
  return r;
}

/** 查询我的绑定态 → couple | null（顺带刷新缓存） */
async function queryCouple() {
  if (!USE_CLOUD) return readCache(); // 演示模式：缓存即真身
  const r = await bindCall({ mode: 'query' });
  const couple = r.bound ? r.couple : null;
  writeCache(couple);
  return couple;
}

/** 免网络读缓存（勋章/海报用） */
function cachedCouple() {
  return readCache();
}

/** 生成我的邀请码 → { code, bound?, couple? } */
async function createCode(name) {
  if (!USE_CLOUD) {
    const c = readCache();
    if (c) return { bound: true, couple: c };
    const demo = {
      code: 'DEMO',
      myName: name || '我',
      partnerName: '',
      partnerOpenid: '',
      boundAt: 0,
      demo: true
    };
    writeCache(demo);
    return { code: 'DEMO' };
  }
  return bindCall({ mode: 'create', name });
}

/** 输 TA 的邀请码加入 → { couple } */
async function joinByCode(code, name) {
  if (!USE_CLOUD) {
    const demo = {
      code: String(code || 'DEMO').toUpperCase(),
      myName: name || '我',
      partnerName: '演示搭档',
      partnerOpenid: 'demo_partner',
      boundAt: Date.now(),
      demo: true
    };
    writeCache(demo);
    return { couple: demo };
  }
  const r = await bindCall({ mode: 'join', code, name });
  writeCache(r.couple || null);
  return r;
}

/** 解绑（清缓存） */
async function unbind() {
  if (!USE_CLOUD) { writeCache(null); return; }
  await bindCall({ mode: 'unbind' });
  writeCache(null);
}

module.exports = { queryCouple, cachedCouple, createCode, joinByCode, unbind };
