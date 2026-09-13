// utils/share.js —— 7.3.0 S1/S2：分享文案与封面（一处定义，各页只报场景名）
// ============================================================
// 【为什么收在一处】
//   S1 要给 7 个分享页加 onShareTimeline、S2 要按场景出文案、R6 要往每条
//   分享 path 里塞邀请码 —— 三件事落在同一批字上。散在各页 = 改一次口号要改
//   14 处，加归因必漏几个页面（这正是 S2 里 card.js 文案兜底要收口的原因）。
//
// 【朋友圈(onShareTimeline) 与好友(onShareAppMessage) 的差别 —— 踩过的坑】
//   ① 朋友圈**只能带 query**，落地页固定是当前页，不能跳到别的页面；
//   ② 朋友圈**不支持 promise 异步取图**，只能是现成的图片路径（用 1:1 方图）；
//   ③ 朋友圈打开是「单页模式」：拿不到用户身份、不能跳页、不能用部分 API
//      —— 票根分享给好友也读不到（云库仅创建者可读写），两处都靠详情页的
//      notFound 空态接住（见 pages/detail/detail.js）。
// ============================================================
const invite = require('./invite.js'); // 每条分享 path / query 都要带邀请码（R6）
const COVER = '/images/brand-logo.png'; // 1:1 方图：朋友圈卡片图与「无画布」场景共用
const SLOGAN = '让时光有票为证';

/** 统一口号：已有口号的不重复拼（各页文案换过几轮，难免有一条自带） */
function withSlogan(title) {
  const t = String(title || '').trim() || '有票为证';
  return t.indexOf(SLOGAN) >= 0 ? t : t + ' · ' + SLOGAN;
}

// 场景表：一个场景 = 一套标题 + 落地页（path 给好友分享，query 给朋友圈）。
// 配图只区分「有画布」与「没画布」：卡片页/年度报告自带画布导出（内容即配图），
// 其余场景先共用 1:1 品牌图 —— 要换专属方图时只改这里的 cover 一个值。
const SCENES = {
  // 票根：详情页 / 纪念卡片 / 图版
  ticket: {
    title: (d) => (d && d.title ? `我在有票为证收藏了「${d.title}」` : '我的票根收藏册'),
    path: (d) => (d && d.id ? `/pages/detail/detail?id=${d.id}` : '/pages/album/album'),
    query: (d) => (d && d.id ? `id=${d.id}` : ''),
    cover: COVER
  },
  // 年度回忆报告
  annual: {
    title: (d) => (d && d.total
      ? `我的年度回忆报告：${d.total} 张票 · ${d.cities || 0} 座城`
      : '我的年度回忆报告'),
    path: () => '/pages/annual/annual',
    query: () => '',
    cover: COVER
  },
  // 双人空间 / 双人报告（沿用 v5.1 那句「我们」钩子：比功能描述更能唤起绑定）
  duo: {
    title: (d) => (d && d.total
      ? `我和${(d && d.partnerName) || 'TA'}一起收藏了 ${d.total} 张票根`
      : '我把咱俩看过的时光收成了收藏册，给你留了位置，来一起翻'),
    path: (d) => (d && d.code ? `/pages/bind/bind?code=${d.code}` : '/pages/duo/duo'),
    query: () => '',
    cover: COVER
  }
};

function scene(key) {
  return SCENES[key] || SCENES.ticket;
}

/**
 * 好友分享（onShareAppMessage）
 * @param {string} key 场景名（ticket / annual / duo）
 * @param {object} d   场景数据（title / id / total / cities / code…）
 * @param {object} [extra] { promise } 有画布的场景传画布导出 promise。
 *   有 promise 时**不设 imageUrl**：两者同时给的行为各版本不一致，宁可只留 promise。
 */
function message(key, d, extra) {
  const s = scene(key);
  const data = d || {};
  const out = {
    title: withSlogan(s.title(data)),
    path: invite.withRef(s.path(data))
  };
  if (extra && extra.promise) out.promise = extra.promise;
  else out.imageUrl = s.cover;
  return out;
}

/** 朋友圈分享（onShareTimeline）：只能带 query，落地页固定当前页 */
function timeline(key, d) {
  const s = scene(key);
  return {
    title: withSlogan(s.title(d || {})),
    query: invite.withRef(s.query(d || {})),
    imageUrl: s.cover
  };
}

/**
 * 是不是朋友圈打开的「单页模式」（S1 的落地兜底，6 个分享页共用）。
 * 该模式下拿不到用户身份（云库读不出票根/报告）、也不能跳页（redirectTo 会被拒），
 * 所以要换成品牌卡 + 指路微信自带的「前往小程序」，而不是摆一个点了没反应的按钮。
 * scene 1154 是官方给单页模式的场景值；mode 字段只有较新基础库才有，两个都认。
 */
function sp() {
  try {
    const o = (wx.getLaunchOptionsSync && wx.getLaunchOptionsSync()) || {};
    return o.scene === 1154 || o.mode === 'singlePage';
  } catch (e) {
    return false;
  }
}

module.exports = { message, timeline, sp, withSlogan, SCENES, COVER, SLOGAN };
