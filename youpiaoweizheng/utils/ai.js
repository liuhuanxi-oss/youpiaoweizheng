// utils/ai.js —— M3 AI 能力层（wx.cloud.extend.AI 端上直调，免密钥）
// ============================================================
// 职责：
//   1. parseDraftByAI：OCR 文本行 → 结构化票根草稿（大模型解析，
//      规则引擎结果做兜底——AI 失败不阻塞识别主流程）
//   2. generateCaption：一键生成纪念文案（文艺短句，30 字内）
//
// ⚠️ 2026-09 平台现状（4.9.1 按官方成长计划指南修正）：
//   - hy3-preview 即将下线（官方公告），统一用 hy3
//   - provider hunyuan-v3：专消耗成长计划免费额度（本小程序 10 亿 Token），
//     无需控制台开关、非资源点套餐也可用——主通道
//   - provider cloudbase：优先免费额度、耗尽自动走套餐（需控制台开启 hy3）——兜底
//   若两通道都失败 → 错误信息会引导到云开发控制台「AI+ → 模型管理」
//   核对可用模型名，改 MODEL_CHAIN 即可。
// ============================================================

const MAX_LINES = 40; // 喂给大模型的 OCR 行数上限（控制 token）

// 模型接入链：按序尝试，第一个初始化成功的生效
const MODEL_CHAIN = [
  { provider: 'hunyuan-v3', model: 'hy3', note: '成长计划免费额度' },
  { provider: 'cloudbase', model: 'hy3', note: 'Token 资源包' }
];

let _model = null;
let _modelId = '';
let _modelNote = '';

/** 懒加载模型实例：按 MODEL_CHAIN 逐个尝试，全部失败抛人话错误 */
function getModel() {
  if (_model) return _model;
  if (!wx.cloud || !wx.cloud.extend || !wx.cloud.extend.AI) {
    throw new Error('AI 服务不可用（基础库版本过低，需 3.15.1+），请升级微信后重试');
  }
  const errs = [];
  for (const p of MODEL_CHAIN) {
    try {
      _model = wx.cloud.extend.AI.createModel(p.provider);
      _modelId = p.model;
      _modelNote = p.note;
      return _model;
    } catch (e) {
      errs.push(p.provider + '：' + String(e.message || e).slice(0, 40));
    }
  }
  throw new Error(
    'AI 模型初始化失败（' + errs.join('；') + '）。' +
    '请到云开发控制台「AI+ → 模型管理」确认能力已开通'
  );
}

/**
 * 统一模型调用：generateText
 * 按官方文档签名优先顶层结构 { model, messages }（与 invoke 一致），
 * 失败再按 { data: { model, messages } } 包裹结构重试一次。
 * @returns {Promise<String>} 模型返回文本
 */
async function callModel(messages) {
  getModel();
  let res = null;
  let lastErr = null;
  // 8.0.4：只在「参数结构不对」时才试第二种包裹写法。两种签名是两套调用约定，结构问题
  // 换一种可能就通了；而网络超时 / 额度耗尽 / 模型下线换写法一样失败 —— 无条件重发只是把
  // 用户的每一次点击变成两倍的失败请求（模型额度是真金白银，不是白打的）。
  const RETRYABLE = /invalid|parameter|param|signature|参数/i;
  try {
    res = await _model.generateText({ model: _modelId, messages });
  } catch (e1) {
    lastErr = e1;
    const raw1 = String((e1 && (e1.errMsg || e1.message)) || e1 || '');
    if (RETRYABLE.test(raw1)) {
      try {
        res = await _model.generateText({ data: { model: _modelId, messages } });
      } catch (e2) {
        lastErr = e2;
      }
    }
  }
  if (res == null) {
    const raw = String((lastErr && (lastErr.errMsg || lastErr.message)) || lastErr || 'unknown');
    if (/model not found|not supported|下线/i.test(raw)) {
      throw new Error('模型「' + _modelId + '」在「' + _modelNote + '」通道不可用，请到云开发控制台 AI+ 模型管理核对模型名');
    }
    throw new Error('AI 调用失败：' + raw.slice(0, 90));
  }
  return (res && (res.text || (res.choices && res.choices[0] &&
    res.choices[0].message && res.choices[0].message.content))) || '';
}

/** 从大模型返回文本中提取 JSON（容忍 ```json 包裹、前后杂文） */
function extractJSON(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI 未返回有效 JSON');
  return JSON.parse(m[0]);
}

/** 字段清洗：类型合法性 / 日期格式 / 价格数字 */
function sanitizeDraft(d) {
  const out = {};
  const TYPE_OK = ['show', 'movie', 'traffic'];
  out.title = String(d.title || '').trim().slice(0, 40);
  out.type = TYPE_OK.includes(d.type) ? d.type : 'show';
  out.date = /^\d{4}-\d{2}-\d{2}$/.test(String(d.date || '')) ? d.date : '';
  out.time = /^\d{1,2}:\d{2}$/.test(String(d.time || ''))
    ? String(d.time).padStart(5, '0') : '';
  out.venue = String(d.venue || '').trim().slice(0, 40);
  out.city = String(d.city || '').trim().slice(0, 20);
  out.seat = String(d.seat || '').trim().slice(0, 30);
  out.price = d.price != null && !isNaN(Number(d.price)) ? Number(d.price) : null;
  out.source = String(d.source || '').trim().slice(0, 20);
  return out;
}

/**
 * 大模型解析 OCR 文本行 → 结构化草稿
 * @param {String[]} lines OCR 文本行
 * @param {Object} fallback 规则引擎草稿（解析失败时兜底返回）
 * @returns {Promise<{draft:Object, byAI:boolean}>}
 */
async function parseDraftByAI(lines, fallback) {
  const ruleDraft = sanitizeDraft(fallback || {});
  try {
    const raw = await callModel([
      { role: 'system', content: '你是票面信息提取助手，只输出 JSON，不输出任何解释。' },
      {
        role: 'user',
        content:
          '从以下 OCR 文本行中提取票根信息，严格输出一个 JSON 对象（不要输出其他文字）：\n' +
          '{"title":"票名","type":"show或movie或traffic","date":"YYYY-MM-DD","time":"HH:mm",' +
          '"venue":"场馆","city":"城市(不带市字)","seat":"座位","price":票价数字或null,"source":"购票平台"}\n' +
          '要求：type 三选一（show=演出/演唱会/livehouse，movie=电影，traffic=火车/飞机/大巴）；' +
          '日期补全年份；无法确定的字段用空字符串或 null。\n' +
          'OCR 文本行：' + JSON.stringify(lines.slice(0, MAX_LINES))
      }
    ]);
    const parsed = sanitizeDraft(extractJSON(raw));
    // AI 结果太空（连标题日期都没有）→ 退回规则引擎
    if (!parsed.title && !parsed.date) return { draft: ruleDraft, byAI: false };
    return { draft: parsed, byAI: true };
  } catch (e) {
    console.warn('[ai] 大模型解析失败，使用规则引擎兜底：', e.message || e);
    return { draft: ruleDraft, byAI: false };
  }
}

/**
 * 生成纪念文案（单句，30 字内）
 * 4.11.0（PRD 差距收口）：3 风格 + N 周年纪念语气
 * @param {Object} t 票根记录 {title,type,date,venue,city,seat,weather}
 * @param {String} style 风格键（CAPTION_STYLES 之一；缺省克制白描）
 * @param {Number} anniv 周年数（>0 时文案带 N 周年纪念语气）
 * @returns {Promise<String>}
 */
const CAPTION_STYLES = {
  restraint: { label: '克制白描', hint: '有画面感、克制不煽情，像日记里的一句批注' },
  lyrical:   { label: '感性抒情', hint: '温柔抒情、有情绪流动，把当晚的感受写进时间里，但收在一句之内' },
  witty:     { label: '幽默俏皮', hint: '轻松幽默、带一点俏皮比喻或自嘲，不油腻、不用网络烂梗' }
};

// 4.22.5（BUG审查⑧）：weather.js 依赖提到模块顶部（原在函数内每次调用都 require，虽 Node 有缓存但属不良实践）
const { weatherHint } = require('./weather.js'); // V1.5：天气感官细节（无存档则不加）

async function generateCaption(t, style, anniv) {
  const typeName = { show: '演出', movie: '电影', traffic: '交通出行' }[t.type] || '活动';
  const s = CAPTION_STYLES[style] || CAPTION_STYLES.restraint;
  const wHint = weatherHint(t.weather);
  const annivHint = Number(anniv) > 0
    ? `今天是这场${typeName}的 ${Number(anniv)} 周年，文案带纪念语气，可自然点出「${Number(anniv)} 周年」。\n`
    : '';
  const raw = await callModel([
    { role: 'system', content: '你是文艺短句写手，只输出一句文案本身，不加引号、不加解释。' },
    {
      role: 'user',
      content:
        `为一张${typeName}票根写一句纪念文案。要求：30 字以内；${s.hint}；` +
        `结合时间地点。\n` +
        annivHint +
        `票名：${t.title}\n日期：${t.date}${t.time ? ' ' + t.time : ''}\n` +
        `场馆：${t.venue || '未知'}\n城市：${t.city || '未知'}\n` +
        (t.seat ? `座位：${t.seat}\n` : '') +
        (wHint ? `天气：${wHint}\n` : '')
    }
  ]);
  // 清洗：去引号/换行/首尾空白，限 40 字符兜底
  return String(raw)
    .replace(/[“”"'「」『』\n\r]/g, '')
    .trim()
    .slice(0, 40);
}

/**
 * 年度结语的本地兜底（AI 不可用 / 返回不合法时用）。
 * 稿屏9 的「AI 年度结语」卡永远不能是空的 —— 空着的结语比写得平更伤。
 * @returns {String[]} 恰好两行
 */
function annualFallback(s) {
  const n = Number((s || {}).total) || 0;
  const c = Number((s || {}).cities) || 0;
  return [
    `这一年，${n} 张票根替你记住 ${c} 座城。`,
    '愿这些票根，继续替你保存温柔。'
  ];
}

// 结语一行最多 18 个汉字 —— 稿屏9 的「AI 年度结语」卡给正文的宽度只够一行 19 字，
// 超了就会折成第二行、把卡片撑破。页面 WXSS 里的 .an-ai-p 守着同一件事。
const ANNUAL_LINE_MAX = 18;

/** 把模型吐的一段话切成「两句」：按句号/问号/叹号/换行断，不足两句或超长则退回兜底 */
function splitAnnual(raw, fallbackLines) {
  const parts = String(raw || '')
    .replace(/[“”"'「」『』]/g, '')
    .split(/[。！？!?\n\r]+/)
    .map((x) => x.replace(/[,，、；;：:]+$/, '').trim())
    .filter(Boolean)
    .slice(0, 2);
  // 超长就整段退回兜底，不做截断 —— 半句话比平实的兜底更伤
  if (parts.length < 2 || parts.some((x) => x.length > ANNUAL_LINE_MAX)) return fallbackLines;
  return parts.map((x) => x + '。');
}

/**
 * 生成年度结语（稿屏9「AI 年度结语」卡：恰好两行）
 * @param {Object} stat 年度聚合 {range,total,cities,shows,cost,firstCity,lastCity}
 * @returns {Promise<String[]>} 两行文案；AI 失败时返回本地兜底，不抛错
 */
async function generateAnnual(stat) {
  const s = stat || {};
  const fallbackLines = annualFallback(s);
  try {
    const raw = await callModel([
      { role: 'system', content: '你是文艺短句写手，只输出两句年度结语本身，不加引号、不加序号、不加解释。' },
      {
        role: 'user',
        content:
          '为一位票根收藏者写年度结语。要求：恰好两句话；每句 16 字以内（含标点，硬限制）；' +
          '第一句回望这一年（可带一两个数字），第二句是对未来的祝愿；' +
          '温柔克制、有画面感，不要网络烂梗，不要出现英文。\n' +
          `年份：${s.range || '这一年'}\n票根：${Number(s.total) || 0} 张\n` +
          `城市：${Number(s.cities) || 0} 座\n演出：${Number(s.shows) || 0} 场\n` +
          (s.firstCity ? `第一张在：${s.firstCity}\n` : '') +
          (s.lastCity ? `最近一张在：${s.lastCity}\n` : '')
      }
    ]);
    return splitAnnual(raw, fallbackLines);
  } catch (e) {
    console.warn('[ai] 年度结语生成失败，使用本地兜底：', e.message || e);
    return fallbackLines;
  }
}

module.exports = { parseDraftByAI, generateCaption, CAPTION_STYLES, generateAnnual, annualFallback };
