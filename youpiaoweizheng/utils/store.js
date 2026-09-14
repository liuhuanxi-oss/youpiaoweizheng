// utils/store.js —— M2 统一数据层（读写票根的唯一入口）
// ============================================================
// 云开没开由 env.js 决定，页面代码完全不感知：
//   演示模式（USE_CLOUD=false）：新票根存本地 storage，和演示数据合并展示，
//                               拍照 → 识别 → 保存 → 上墙全流程可体验
//   云模式   （USE_CLOUD=true) ：读云数据库 tickets 集合，保存走 saveTicket
//                               云函数（服务端补天气/场次键）；查询异常时
//                               自动兜底演示数据，界面永远不空白
// 字段结构 = 未来 tickets 集合的数据模型，与 cloudfunctions/saveTicket 对齐。
// ============================================================
const { USE_CLOUD } = require('./env.js');
const mock = require('./mock.js');

const LS_KEY = 'sp_local_tickets'; // 演示模式的本地票根库

/** 云库记录 _id → 统一叫 id，下游页面无感知 */
function normalize(t) {
  return { ...t, id: t.id || t._id };
}

/** 票面日期倒序，同日按时间倒序 */
function byDate(a, b) {
  return (
    String(b.date || '').localeCompare(String(a.date || '')) ||
    String(b.time || '').localeCompare(String(a.time || ''))
  );
}

/** 演示模式生成场次键（格式对齐云函数，值无需一致——数据不出本机） */
function demoEventKey(venue, date) {
  if (!venue || !date) return '';
  const s = `${venue}|${date}`.toLowerCase();
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
  return 'evt_demo' + h.toString(16).padStart(8, '0');
}

function readLocal() {
  try {
    return wx.getStorageSync(LS_KEY) || [];
  } catch (e) {
    return [];
  }
}

function writeLocal(list) {
  try {
    wx.setStorageSync(LS_KEY, list);
  } catch (e) {
    console.warn('[store] 本地存储写入失败：', e);
  }
}

// —— 演示模式：AI 文案覆盖层（mock 记录只读，用 overrides 模拟更新） ——
const LS_CAPTIONS = 'sp_caption_overrides';

// —— M4.5 删除：演示模式下 mock 演示票只读，用「隐藏名单」模拟删除 ——
const LS_DELETED = 'sp_deleted_ids';

function readDeleted() {
  try {
    return wx.getStorageSync(LS_DELETED) || [];
  } catch (e) {
    return [];
  }
}

function writeDeleted(arr) {
  try {
    wx.setStorageSync(LS_DELETED, arr);
  } catch (e) {
    console.warn('[store] 删除名单写入失败：', e);
  }
}

function readCaptions() {
  try {
    return wx.getStorageSync(LS_CAPTIONS) || {};
  } catch (e) {
    return {};
  }
}

function writeCaptions(map) {
  try {
    wx.setStorageSync(LS_CAPTIONS, map);
  } catch (e) {
    console.warn('[store] 文案存储写入失败：', e);
  }
}

/** 演示模式：把 overrides 应用到票根列表 */
function applyCaptionOverrides(list) {
  const map = readCaptions();
  if (!Object.keys(map).length) return list;
  return list.map((t) => (map[t.id] ? { ...t, aiCaption: map[t.id] } : t));
}

/** 演示票判定（M4.9.6）：云模式兜底展示的 mock 票，禁止对云库做「写」操作 */
function isMockTicket(id) {
  return mock.MOCK_IDS.includes(String(id));
}

// —— 4.11.0 同场印记 opt-out ——
// 4.11 的「设置页开关」随 me→setting 改版下线过一段时间：协议里对外承诺了
// 「可随时退出参与」，而退出入口没了。7.4.0 把开关补回设置页（P2-26）。
const LS_SAME_OPTOUT = 'sp_same_optout';

/** 是否退出同场印记（true = 我的票不参与「同场 N 人」匿名聚合） */
function getSameOptOut() {
  try { return !!wx.getStorageSync(LS_SAME_OPTOUT); } catch (e) { return false; }
}

/** 退出 / 参与同场印记（设置页那颗开关；传 true = 退出）。
 *  只影响**之后**入库的票根 —— 协议里就是这么承诺的（「退出后新收藏的票根
 *  不再计入该统计」）。已入库的场次键不回头清：那是一次没告知用户的历史改写，
 *  而且会让「同场 N 人」的数字在别人那里凭空变小。 */
function setSameOptOut(v) {
  try { wx.setStorageSync(LS_SAME_OPTOUT, !!v); } catch (e) { /* 存储失败按「仍参与」处理，与 get 的兜底一致 */ }
}

// —— 4.14.0 组内排序 ——
// 云库里排过序的票带 sortAt，列表输出统一走 byOrder（拖拽入口随 wall 页一并下线）

/** 组内排序：有 sortAt 的按其降序浮前（整组已排过序），无 sortAt 的按日期兜底 */
function byOrder(a, b) {
  const sa = a.sortAt || 0;
  const sb = b.sortAt || 0;
  if (sa !== sb) return sb - sa;
  return byDate(a, b);
}

/**
 * 更新票根的 AI 文案（M4.9.6 修复 -502005）
 * - 云模式 + 演示票：写本地 overrides（演示票不在云库里，直连必报集合不存在）
 * - 云模式 + 真票：走 saveTicket 云函数 setCaption action（服务端校验归属 + 自动建集合）
 * - 演示模式：写 overrides 覆盖层
 */
async function setCaption(id, caption) {
  if (USE_CLOUD) {
    if (isMockTicket(id)) {
      const map = readCaptions();
      map[id] = caption;
      writeCaptions(map);
      return;
    }
    const res = await wx.cloud.callFunction({
      name: 'saveTicket',
      data: { action: 'setCaption', id, caption }
    });
    const r = (res && res.result) || {};
    if (!r.ok) throw new Error(r.msg || '文案保存失败');
    return;
  }
  const map = readCaptions();
  map[id] = caption;
  writeCaptions(map);
}

// —— 4.18.0 列表状态标志（wall 页横幅用；每次 listTickets 后刷新） ——
let _listFallback = false;  // true = 云库读取失败，本帧兜底成了演示数据
let _listTruncated = false; // true = 云库票数超过单次可拉上限，本帧只显示了最近的 LIST_MAX 张

/** 页面读取列表状态：渲染完列表后调用一次，决定是否亮横幅 */
function listFlags() {
  return { netFallback: _listFallback, truncated: _listTruncated, cap: LIST_MAX };
}

// —— 5.0.0 修 P0：小程序端单次 get 的 limit 有硬上限 ——
// 官方规定：小程序端 limit 最大 20 条（云函数端才是 100 条）。原先写 .limit(200)
// 跑在小程序端，会被截断成 20 条 —— 用户从第 21 张票根起，旧票在 App 内彻底消失
// 且永不提示；连带 rows.length >= 200 的触顶判断也永远为假，横幅从不出现。
// 现改为 skip 分批拉取；上限触顶时才亮横幅说明「只显示了最近的 N 张」。
const PAGE_SIZE = 20;   // 小程序端单次上限
const LIST_MAX = 500;   // 单次列表最多拉取张数（25 批），防止无限翻页拖垮首屏

/**
 * 分批拉全量票根。
 * skip 翻页必须配「稳定排序」，否则 date 相同的票在各页之间次序会漂移 → 漏票/重票，
 * 故在 date 之外补 _id 兜底排序（最终展示顺序仍由 JS 侧 byOrder 决定）。
 * @returns {Promise<{rows:Array, truncated:boolean}>}
 */
async function fetchCloudTickets(db) {
  const col = db.collection('tickets');
  let total = 0;
  try {
    const c = await col.count();
    total = (c && c.total) || 0;
  } catch (e) { /* count 失败不拦路：退化成「翻到不满一页为止」 */ }
  const want = total ? Math.min(total, LIST_MAX) : LIST_MAX;
  const rows = [];
  for (let skip = 0; skip < want; skip += PAGE_SIZE) {
    const res = await col
      .orderBy('date', 'desc')
      .orderBy('_id', 'desc')
      .skip(skip)
      .limit(Math.min(PAGE_SIZE, want - skip))
      .get();
    const page = (res && res.data) || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break; // 不满一页 = 已到底
  }
  return { rows, truncated: total ? total > rows.length : rows.length >= LIST_MAX };
}

/** 读取全部票根（组内自定义序 sortAt 优先，其余按票面日期倒序） */
async function listTickets() {
  if (USE_CLOUD) {
    _listFallback = false;
    _listTruncated = false;
    try {
      const db = wx.cloud.database();
      // 新用户云库为空 → rows 为空数组，走首页空态引导（真实产品该有的样子）
      // 4.14.0：byOrder = sortAt 降序优先（云端排过序的组），其余 byDate 兜底
      // 5.0.0：分批拉取（原 .limit(200) 被小程序端硬上限截断）→ 见 fetchCloudTickets
      const { rows, truncated } = await fetchCloudTickets(db);
      _listTruncated = truncated;
      return rows.map(normalize).sort(byOrder);
    } catch (e) {
      console.warn('[store] 云库读取失败，兜底演示数据：', e);
      // M4.9.6：兜底也要套文案覆盖层——演示票上保存过 AI 文案的重进不能丢
      // 4.19.1：兜底链自身防抛（覆盖层读 storage 的 JSON 若损坏会抛 → 页面白屏死透）
      _listFallback = true; // 4.18.0：亮「网络开小差」横幅，说明当前不是真实数据
      try {
        return applyCaptionOverrides(mock.tickets.map(normalize)).sort(byOrder);
      } catch (e2) {
        console.warn('[store] 兜底覆盖层异常，返回裸演示数据：', e2);
        return mock.tickets.map(normalize);
      }
    }
  }
  // 4.18.0：readDeleted() 外提——原先在 filter 内每票重读 storage（N 次 IO → 1 次）
  const deleted = readDeleted();
  return applyCaptionOverrides(
    [...readLocal(), ...mock.tickets]
      .filter((t) => !deleted.includes(String(t.id)))
      .map(normalize)
  ).sort(byOrder);
}

/** 按 id 取单张（找不到返回 null）
 * 4.18.0：云模式优先 doc(id) 直查——分享落地等单票场景不必全量拉 200 条再 find。
 * 直查异常（文档不存在/网络抖动/权限）→ 回退全量链路，行为与旧版一致。
 */
async function getTicket(id) {
  const sid = String(id || '');
  if (USE_CLOUD && sid && !isMockTicket(sid)) {
    try {
      const res = await wx.cloud.database().collection('tickets').doc(sid).get();
      if (res && res.data) return normalize(res.data);
    } catch (e) {
      console.warn('[store] doc 直查失败，回退全量查询：', e);
    }
  }
  const all = await listTickets();
  return all.find((x) => String(x.id) === sid) || null;
}

/**
 * 新增票根
 * @param {Object} payload 确认页表单字段 {title,type,date,time,venue,city,seat,price,source}
 * @param {String} fileID  云存储图片（云模式由 scan 页上传后传入）
 * @returns 补齐后的完整记录
 */
async function addTicket(payload, fileID) {
  // 4.11.0：同场印记 opt-out 随票入库（云函数据此决定是否生成场次键）
  const sameOptOut = getSameOptOut();
  if (USE_CLOUD) {
    const res = await wx.cloud.callFunction({
      name: 'saveTicket',
      data: { ticket: { ...payload, img: fileID || '', sameOptOut } }
    });
    const r = res.result || {};
    if (!r.ok) throw new Error(r.msg || '保存失败，请稍后再试');
    return normalize({
      ...payload,
      img: fileID || '',
      _id: r._id,
      weather: r.weather || null,
      eventKey: '', // 详情页不必现算，云库记录里已带
      createdAt: Date.now()
    });
  }
  // 演示模式：本地入库，把云函数将来要补的字段一并在本地补齐
  // （opt-out 时不生成场次键——数据不出本机，但保持行为与云端一致）
  const rec = {
    ...payload,
    img: '',
    id: 'local_' + Date.now(),
    createdAt: Date.now(),
    eventKey: sameOptOut ? '' : demoEventKey(payload.venue, payload.date),
    weather: null
  };
  writeLocal([rec, ...readLocal()]);
  return rec;
}

/**
 * 删除票根（M4.5 左滑删除）
 * 云模式：tickets 权限「仅创建者可读写」→ 创建者端上直接删，无需 action；
 *        M4.9.6 起：演示票走本地隐藏名单（演示票不在云库，直连会报 -502005）
 *        照片文件保留在云存储（不阻塞，控制台可清理）
 * 演示模式：本地记录直接删；mock 演示票写入隐藏名单模拟删除
 */
async function removeTicket(id) {
  if (USE_CLOUD && !isMockTicket(id)) {
    const db = wx.cloud.database();
    await db.collection('tickets').doc(id).remove();
    return;
  }
  writeLocal(readLocal().filter((t) => String(t.id) !== String(id)));
  const hidden = readDeleted();
  if (!hidden.includes(String(id))) {
    hidden.push(String(id));
    writeDeleted(hidden);
  }
}

module.exports = { USE_CLOUD, listTickets, getTicket, addTicket, setCaption, removeTicket, isMockTicket, getSameOptOut, setSameOptOut, listFlags };
