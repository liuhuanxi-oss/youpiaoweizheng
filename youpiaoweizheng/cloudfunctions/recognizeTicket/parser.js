// recognizeTicket/parser.js —— 规则解析器
// 把 OCR 文本行解析成票根草稿（M2 版本：纯规则、零成本、确定性强）。
// M3 将引入大模型解析升级本模块（规则引擎保留为兜底）。
const CITIES = require('./cities.js');

/** 匹配城市：OCR 全文里找字典中的城市名（长名优先，避免「长沙」抢了「长沙南」无碍） */
function matchCity(flat) {
  const names = Object.keys(CITIES).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (flat.includes(name)) {
      const [province, lat, lng] = CITIES[name];
      return { city: name, province, geo: { lat, lng } };
    }
  }
  return { city: '', province: '', geo: null };
}

/** 推断票根类型 */
function matchType(flat) {
  if (/(大麦|秀动|票务|巡演|演唱会|音乐节|专场|巡回|LIVEHOUSE|livehouse|Livehouse|音乐|乐队|音乐会)/.test(flat)) return 'show';
  if (/(影城|影院|电影|cinema|CINEMA|号厅|3D|IMAX|厅)/.test(flat)) return 'movie';
  if (/(车次|候车|检票口|车厢|座号|航班|航空|机场|\b[GDCKT]\d{2,4}\b|MU\d+|CA\d+|ZH\d+|HU\d+)/.test(flat)) return 'traffic';
  return 'show'; // 主打名义默认演出，让用户改
}

/** 提取标题（启发式）：优先含演出/站点关键词的行，否则取最长中文行 */
function pickTitle(lines) {
  const kw = /(巡演|演唱会|音乐节|专场|巡回|世界巡|演出|首站|站)/;
  const withKw = lines.find((l) => kw.test(l) && l.length >= 4 && l.length <= 40);
  if (withKw) return withKw.replace(/\s+/g, ' ').trim().slice(0, 40);
  const longest = lines
    .filter((l) => /[\u4e00-\u9fa5]/.test(l))
    .sort((a, b) => b.length - a.length)[0];
  return (longest || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/** 提取场馆 */
function pickVenue(lines) {
  const kw = /(影城|影院|剧院|剧场|大剧院|音乐厅|体育馆|体育场|会展中心|文化中心|礼堂|LIVEHOUSE|Livehouse|livehouse|MAO|VOX|\d+号厅)/;
  const hit = lines.find((l) => kw.test(l));
  return hit ? hit.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
}

/** 主解析入口：lines = OCR 文本行数组 */
function parse(lines) {
  const flat = lines.join(' ');
  const draft = {
    title: '',
    type: 'show',
    date: '',       // 'YYYY-MM-DD'
    time: '',       // 'HH:mm'
    venue: '',
    city: '',
    province: '',
    geo: null,      // {lat,lng}
    seat: '',
    price: null,    // 数字
    source: ''
  };

  // —— 日期 ——
  const dFull = flat.match(/(20\d{2})\s*[年\-\/.]\s*(\d{1,2})\s*[月\-\/.]\s*(\d{1,2})/);
  const dShort = flat.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (dFull) {
    draft.date = `${dFull[1]}-${String(dFull[2]).padStart(2, '0')}-${String(dFull[3]).padStart(2, '0')}`;
  } else if (dShort) {
    const y = new Date().getFullYear();
    draft.date = `${y}-${String(dShort[1]).padStart(2, '0')}-${String(dShort[2]).padStart(2, '0')}`;
  }

  // —— 时间 ——
  const tm = flat.match(/(\d{1,2}):(\d{2})/) || flat.match(/(\d{1,2})\s*[点时]\s*(\d{2})?/);
  if (tm) {
    draft.time = `${String(tm[1]).padStart(2, '0')}:${tm[2] ? tm[2] : '00'}`;
  }

  // —— 金额 ——
  const pm = flat.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/) || flat.match(/(\d+(?:\.\d{1,2})?)\s*元/);
  if (pm) draft.price = Number(pm[1]);

  // —— 座位 ——
  const seats = [];
  const s1 = flat.match(/([A-Z]区)?\s*(\d{1,2})排\s*(\d{1,3})[座号]/);
  if (s1) seats.push(`${s1[1] || ''}${s1[2]}排${s1[3]}座`);
  const s2 = flat.match(/(\d{1,2})车\s*(\d{1,3}[A-Z一-九]*号?)/);
  if (s2) seats.push(`${s2[1]}车${s2[2]}`);
  const s3 = flat.match(/(内场|VIP|池区|看台|包厢|楼座|池座)/);
  if (s3 && !seats.length) seats.push(s3[1]);
  draft.seat = seats.join(' ');

  // —— 来源平台 ——
  const src = flat.match(/(大麦|猫眼|秀动|淘票票|票务|12306|纷玩岛|票星球)/);
  if (src) draft.source = src[1];

  // —— 城市/省/坐标 ——
  Object.assign(draft, matchCity(flat));

  // —— 类型 / 标题 / 场馆 ——
  draft.type = matchType(flat);
  draft.title = pickTitle(lines);
  draft.venue = pickVenue(lines);

  return draft;
}

module.exports = { parse };
