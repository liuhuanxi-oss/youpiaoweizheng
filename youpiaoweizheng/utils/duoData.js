// utils/duoData.js —— M4-b 双人合并数据唯一组装层（duo / timeline / report 三页同源）
// 云模式：saveTicket.duoStats(full:true) 返回双方全量精简票根
// 演示模式：mock 票根按 demoStats 口径（排序后 i%2）分配归属，数据不出本机
const mock = require('./mock.js');
const { USE_CLOUD } = require('./env.js');
const { groupLabel } = require('./date.js');

/** 归属名：me → '你'，partner → 对方昵称 */
function ownerNameOf(owner, partnerName) {
  return owner === 'me' ? '你' : partnerName || 'TA';
}

/**
 * 加载合并数据（已绑定前提）
 * @param {Object} c couple.queryCouple() 的绑定信息（含 myName/partnerName）
 * @returns { total, shows, cities, items, myName, partnerName, demo }
 *   items: 按日期倒序的精简票根行 { id,title,type,date,time,city,venue,seat,price,geo,eventKey,owner,ownerName,mine }
 */
async function loadMerged(c) {
  const myName = (c && c.myName) || '我';
  const partnerName = (c && c.partnerName) || 'TA';

  if (!USE_CLOUD) {
    const list = mock.tickets.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const items = list.map((t, i) => {
      const mine = i % 2 === 0;
      const owner = mine ? 'me' : 'partner';
      return {
        id: t.id, title: t.title, type: t.type, date: t.date, time: t.time || '',
        city: t.city || '', venue: t.venue || '', seat: t.seat || '', price: t.price || null,
        geo: t.geo || null, eventKey: t.eventKey || '',
        owner, ownerName: ownerNameOf(owner, partnerName), mine
      };
    });
    return {
      total: items.length,
      shows: items.filter((t) => t.type === 'show').length,
      cities: new Set(items.filter((t) => t.city).map((t) => t.city)).size,
      items,
      myName, partnerName,
      demo: true
    };
  }

  const res = await wx.cloud.callFunction({
    name: 'saveTicket',
    data: { action: 'duoStats', full: true }
  });
  const r = (res && res.result) || {};
  if (!r.ok) throw new Error(r.msg || '合并数据加载失败');
  const items = (r.items || []).map((t) => ({
    id: t.id, title: t.title, type: t.type, date: t.date, time: t.time || '',
    city: t.city || '', venue: t.venue || '', seat: t.seat || '', price: t.price || null,
    geo: t.geo || null, eventKey: t.eventKey || '',
    owner: t.owner, ownerName: ownerNameOf(t.owner, partnerName), mine: t.owner === 'me'
  }));
  return {
    total: r.total,
    shows: r.shows,
    cities: r.cities,
    items,
    myName: r.myName || myName,
    partnerName: r.partnerName || partnerName,
    demo: false
  };
}

/**
 * 同场组判定：组键优先 eventKey（服务端 venue+date 生成），兜底 venue|date / title|date。
 * 返回「双方都收过」的组键 Set —— 命中的行在时间线挂「一起」标记、报告页计"一起看过的场次"。
 */
function togetherKeys(items) {
  const groups = {};
  (items || []).forEach((t) => {
    const k = t.eventKey || `${t.venue}|${t.date}` || `${t.title}|${t.date}`;
    (groups[k] = groups[k] || []).push(t.owner);
  });
  return new Set(
    Object.keys(groups).filter((k) => groups[k].includes('me') && groups[k].includes('partner'))
  );
}

/** duo 页"最近的共同时光"行（向后兼容原 recent 结构） */
function recentRows(merged, n) {
  return (merged.items || []).slice(0, n || 5).map((t) => ({
    id: t.id,
    title: t.title,
    date: t.date,
    groupLabel: groupLabel(t.date),
    mine: t.mine,
    ownerName: t.ownerName
  }));
}

module.exports = { loadMerged, togetherKeys, recentRows };
