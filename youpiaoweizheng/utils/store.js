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
  bustList(); // 7.4.2：文案改了 → 缓存作废（票根墙上的摘要是从列表里来的）
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

// —— 7.4.2 列表缓存 ——
// 四个 tab 页（首页 / 时光机 / 回忆地图 / 我的）的 onShow 都无条件全量拉一次，而
// fetchCloudTickets 是 1 次 count + 最多 25 次分批 get。来回切 tab 等的是同一份数据，
// 用户却每次都把这段云往返重走一遍。
// 只缓存**成功**结果：失败时兜底的演示票不能进缓存，否则网络恢复了还继续给人看别人的票。
// 三个写操作入口一律置脏 —— 传完票切回首页必须看得见，这条是底线。
const LIST_TTL = 30 * 1000;
let _listCache = null; // { at: Number, rows: Array }

/** 写操作入口调用：让下一次 listTickets 重新问云。
 *  放在函数**入口**而不是成功之后：写操作分支多，逐个 return 前补一句迟早会漏一个，
 *  而漏掉的那个分支就是「传完票看不到新票」。多拉一次云只是浪费一次请求，漏掉是 bug。 */
function bustList() { _listCache = null; }

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
    // 7.4.2：30 秒内复用上一次的成功结果（切 tab 不再重走一遍云往返）。
    // 能命中缓存 ⇒ 上一次走的是成功路径（失败会 bustList），所以 _listTruncated
    // 保持原值就与缓存里那份数据一致，不必另存一份。
    if (_listCache && Date.now() - _listCache.at < LIST_TTL) return _listCache.rows.slice();
    _listFallback = false;
    _listTruncated = false;
    try {
      const db = wx.cloud.database();
      // 新用户云库为空 → rows 为空数组，走首页空态引导（真实产品该有的样子）
      // 4.14.0：byOrder = sortAt 降序优先（云端排过序的组），其余 byDate 兜底
      // 5.0.0：分批拉取（原 .limit(200) 被小程序端硬上限截断）→ 见 fetchCloudTickets
      const { rows, truncated } = await fetchCloudTickets(db);
      _listTruncated = truncated;
      const out = rows.map(normalize).sort(byOrder);
      _listCache = { at: Date.now(), rows: out };
      return out.slice(); // 给副本：调用方排序/裁剪不会污染缓存
    } catch (e) {
      console.warn('[store] 云库读取失败，兜底演示数据：', e);
      bustList(); // 失败不留缓存 —— 下次调用必须重新问云
      // M4.9.6：兜底也要套文案覆盖层——演示票上保存过 AI 文案的重进不能丢
      // 4.19.1：兜底链自身防抛（覆盖层读 storage 的 JSON 若损坏会抛 → 页面白屏死透）
      _listFallback = true; // 4.18.0：亮「网络开小差」横幅，说明当前不是真实数据
      // 8.0.4：兜底这一支同样要过隐藏名单 —— 云故障时删一张演示票，removeTicket 走的是
      // 「非云库记录」那条路，只往 sp_deleted_ids 里记一笔（见 removeTicket 末尾）。
      // 名单在这里不生效的话：用户点删除 → toast「已删除」→ 列表刷新 → 票原地复活，
      // 结论只会是「这 App 的删除是假的」。（演示模式分支 4.18.0 就滤了，云兜底漏了）
      try {
        const hidden = readDeleted();
        return applyCaptionOverrides(
          mock.tickets.filter((t) => !hidden.includes(String(t.id))).map(normalize)
        ).sort(byOrder);
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
  bustList(); // 7.4.2：新票入库 → 缓存作废，否则切回首页看不见刚传的这张
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
/** 删云存储里的照片。失败只记一笔：删票本身已经成功了，不该让收尾动作把结果变成报错
 *  （留下的是张孤儿图，代价远小于「用户点了删除却弹报错」）。 */
async function deleteCloudFile(fileID) {
  try {
    await wx.cloud.deleteFile({ fileList: [fileID] });
  } catch (e) {
    console.warn('[store] 云存储照片没删掉（留作孤儿，不影响删票）：', e);
  }
}

async function removeTicket(id) {
  bustList(); // 7.4.2：删票 → 缓存作废
  if (USE_CLOUD && !isMockTicket(id)) {
    const db = wx.cloud.database();
    const ref = db.collection('tickets').doc(id);
    // 7.4.3：连照片一起删。原先只删记录，照片永远留在云存储里 —— 用户以为删干净了，
    // 隐私政策也是这么写的：这不是省一次请求的事，是承诺。
    // 先读一次拿 img（记录删掉后就取不到了）；读不到也照样往下删记录。
    // 8.0.4：AI 图版也一起删。图版是这张票的另一份影像（art 页存相册那支用的就是它），
    // 7.4.3 只补了 img —— 删完票图版仍留在云存储里。用户删票时想的是「这张票没了」，
    // 隐私政策也是这么承诺的；顺带每幅图版 1~2MB，只增不减是白掏存储。
    let imgs = [];
    try {
      const r = await ref.get();
      const d = (r && r.data) || {};
      imgs = [d.img, d.artVersion && d.artVersion.fileID]
        .filter((x) => /^cloud:\/\//.test(String(x)));
    } catch (e) { /* 读不到（权限 / 已经被删）就继续 */ }
    await ref.remove();
    for (const f of imgs) await deleteCloudFile(f);
    return;
  }
  writeLocal(readLocal().filter((t) => String(t.id) !== String(id)));
  const hidden = readDeleted();
  if (!hidden.includes(String(id))) {
    hidden.push(String(id));
    writeDeleted(hidden);
  }
}

// —— 8.1.0 同场票根墙 ——
// 默认关：协议承诺过「匿名场次键只做聚合计数，不展示、不共享任何身份信息」，
// 所以「公开给陌生人看」必须是用户一张票一次的选择，不能沿用「同场印记」那个开关。
// 上墙只有 wallJoin 一条路，且服务端会按 openid 验归属 + 当场重过一次内容安全。

/** 8.1.3：上墙用的小图长边 —— 落在图片安检接口的尺寸框内（750×1334），约 100KB */
const WALL_THUMB_SIDE = 750;

/**
 * 8.1.3：为「上墙」另做一张小图（送检 + 展示都用它）。
 *
 * 【为什么不在原图上送检】`security.imgSecCheck` 只吃 ≤1MB 且 ≤750×1334 的图，
 * 而票根原图是长边 1600 压出来的 —— 尺寸超框，送检结果不可靠。
 * 【为什么走「下载 → 压缩 → 上传」这一趟】端上手上没有原图的本地副本（票可能是很久
 * 以前存的，本机只剩一个云文件 ID），而图片安检**只有服务端能调**。上墙是一次性的
 * 用户动作，这几跳的代价可以接受；换来的是一张必然过得了接口限制、且**展示的就是
 * 送检的那张**的图（堵掉「送检一张良性的、展示一张违规的」）。
 *
 * @returns {Promise<string>} 小图的云文件 ID；失败抛错（调用方据此回滚开关）
 */
async function wallThumb(fileID) {
  const dl = await wx.cloud.downloadFile({ fileID });
  const src = dl && dl.tempFilePath;
  if (!src) throw new Error('照片读取失败，请重试');
  let path = src;
  try {
    const info = await new Promise((resolve, reject) => {
      wx.getImageInfo({ src, success: resolve, fail: reject });
    });
    const opt = { src, quality: 70 };
    // 只给一边：两边同时给会被当成拉伸目标（竖图会压扁）—— 与 scan 页同一处坑
    if (info && info.width && info.height) {
      if (info.width >= info.height) opt.compressedWidth = WALL_THUMB_SIDE;
      else opt.compressedHeight = WALL_THUMB_SIDE;
    }
    const c = await new Promise((resolve, reject) => {
      wx.compressImage(Object.assign({ success: resolve, fail: reject }, opt));
    });
    if (c && c.tempFilePath) path = c.tempFilePath;
  } catch (e) {
    // 压不动就用原图：服务端还有一道体积闸，超了它会给用户一句人话
  }
  const up = await wx.cloud.uploadFile({
    cloudPath: `wall/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`,
    filePath: path
  });
  if (!up || !up.fileID) throw new Error('照片准备失败，请重试');
  return up.fileID;
}

/**
 * 把这张票放进同场票根墙 / 从墙上撤下。
 *
 * **失败抛错；成功不回任何值** —— 成没成功只由「有没有抛错」表达，与 setCaption /
 * addTicket 同一条规矩。特意**不返回「操作后的状态」**：那个布尔里 false 既可能是
 * 「撤下成功」也可能是「失败」，调用方一眼看过去 `if (r)` 就分不清 ——
 * 8.1.0 那个开关正是栽在这种含混上（见 tests/wall_toggle.test.js）。
 *
 * @param {string} id 票根 id（必须是自己名下的）
 * @param {boolean} on true=放进墙 false=撤下
 * @param {string} [img] 这张票的云文件 ID（上墙时用来现做一张送检小图；撤下不用）
 */
async function setWallPublic(id, on, img) {
  if (USE_CLOUD && !isMockTicket(id)) {
    // 只有「上墙」需要小图；撤下时墙上那张由服务端一并删掉
    const thumb = (on && img) ? await wallThumb(img) : '';
    const res = await wx.cloud.callFunction({
      name: 'saveTicket',
      data: { action: 'wallJoin', id, on: !!on, thumb }
    });
    const r = (res && res.result) || {};
    if (!r.ok) throw new Error(r.msg || '操作失败，请稍后再试');
    return;
  }
  // 演示模式：只改本机记录（数据不出本机，但行为与云端保持一致）
  writeLocal(readLocal().map((t) => (
    String(t.id) === String(id) ? { ...t, wallPublic: !!on } : t
  )));
}

/**
 * 拉某场次里**别人自愿公开**的票根。返回的是服务端逐字段重建过的脱敏行
 * （只有 票名/场馆/日期/图）—— 没有身份、座位、票价、坐标，也没有 _id。
 * @param {string} eventKey 场次键（场馆+日期生成）
 * @returns {Promise<Array<{title:string,venue:string,date:string,img:string}>>}
 */
async function listWallTickets(eventKey) {
  const key = String(eventKey || '');
  if (!key) return [];
  if (USE_CLOUD) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'saveTicket',
        data: { action: 'wallList', eventKey: key }
      });
      const r = (res && res.result) || {};
      return r.ok ? (r.items || []) : [];
    } catch (e) {
      console.warn('[store] 票根墙拉取失败：', e);
      return [];
    }
  }
  // 演示模式：拿本机标了公开的票当墙（只有自己那几张，够把页面跑通）
  return readLocal()
    .filter((t) => t.wallPublic && demoEventKey(t.venue, t.date) === key)
    .map((t) => ({ title: t.title || '', venue: t.venue || '', date: t.date || '', img: '' }));
}

module.exports = { USE_CLOUD, listTickets, getTicket, addTicket, setCaption, removeTicket, isMockTicket, getSameOptOut, setSameOptOut, setWallPublic, listWallTickets, listFlags };
