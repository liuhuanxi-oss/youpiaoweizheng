// utils/share.js —— 7.3.0 S1/S2：分享文案与封面（一处定义，各页只报场景名）
// ============================================================
// 【为什么收在一处】
//   S1 要给 7 个分享页加 onShareTimeline、S2 要按场景出文案、R6 要往每条
//   分享 path 里塞邀请码 —— 三件事落在同一批字上。散在各页 = 改一次口号要改
//   14 处，加归因必漏几个页面（这正是 S2 里 card.js 文案兜底要收口的原因）。
//
// 【朋友圈(onShareTimeline) 与好友(onShareAppMessage) 的差别 —— 踩过的坑】
//   ① 朋友圈**只能带 query**，落地页固定是当前页，不能跳到别的页面；
//   ② 朋友圈**不支持 promise 异步取图**，只能是现成的图片路径；
//   ③ 朋友圈打开是「单页模式」：拿不到用户身份、不能跳页、不能用部分 API
//      —— 票根分享给好友也读不到（云库仅创建者可读写），两处都靠详情页的
//      notFound 空态接住（见 pages/detail/detail.js）。
//
// 【配图为什么一张能用两处（7.4.4）】
//   好友卡片按 5:4 显示、朋友圈按 1:1 显示 —— 同一个 cover 落到朋友圈会被居中裁掉
//   左右各 1/10。所以画封面时把内容全收在中间 600×600 里（出图脚本里的「安全区」，
//   见 scripts/dev/gen-share-covers.js），一张 5:4 的图两边都不丢内容，不必出两套。
// ============================================================
const invite = require('./invite.js'); // 每条分享 path / query 都要带邀请码（R6）

// 场景封面（5:4，内容在中间安全区里，好友卡片与朋友圈共用）
const COVERS = {
  ticket: '/images/share/cover-ticket.png',   // 一张微倾的票根 + 邮戳
  annual: '/images/share/cover-annual.png',   // 一叠票根扇形摊开
  duo:    '/images/share/cover-duo.png',      // 两张竖票根对倾 + 一颗星
  legacy: '/images/share/cover-legacy.png',   // 一张泛黄褪色、边角磨损的老票（8.1.0）
  map:    '/images/share/cover-map.png'       // 水彩中国 + 一条虚线足迹（8.1.0）
};
const SLOGAN = '让时光有票为证';

/** 统一口号：已有口号的不重复拼（各页文案换过几轮，难免有一条自带） */
function withSlogan(title) {
  const t = String(title || '').trim() || '有票为证';
  return t.indexOf(SLOGAN) >= 0 ? t : t + ' · ' + SLOGAN;
}

// 场景表：一个场景 = 一套标题 + 落地页（path 给好友分享，query 给朋友圈）＋ 一张专属封面。
// 例外：卡片页/年度报告在**有画布**时传 promise 自取配图（内容即配图），用不到封面。
const SCENES = {
  // 票根：详情页 / 纪念卡片 / 图版
  ticket: {
    title: (d) => (d && d.title ? `我在有票为证收藏了「${d.title}」` : '我的票根收藏册'),
    path: (d) => (d && d.id ? `/pages/detail/detail?id=${d.id}` : '/pages/album/album'),
    query: (d) => (d && d.id ? `id=${d.id}` : ''),
    cover: COVERS.ticket
  },
  // 年度回忆报告
  annual: {
    title: (d) => (d && d.total
      ? `我的年度回忆报告：${d.total} 张票 · ${d.cities || 0} 座城`
      : '我的年度回忆报告'),
    path: () => '/pages/annual/annual',
    query: () => '',
    cover: COVERS.annual
  },
  // 老票根专场（8.1.0）：这条分享的落点是**活动页本身**，不是某张票根 ——
  // 一个人翻出 2015 年的票，多半会发给当年一起去的那个人：他点开看到的必须是
  // 「你也翻翻抽屉」，而不是一张跟他无关的票。
  legacy: {
    // 不写「我翻出了 XX 年那张」——活动页是静态的，拿不到用户翻的是哪一张；
    // 编一个年份出来，好友点开发现和他朋友无关，比一句朴素的话更糟。
    title: () => '抽屉里那些老票根，也值得留下来',
    path: () => '/pages/legacy/legacy',
    query: () => '',
    cover: COVERS.legacy
  },
  // 回忆地图（8.1.0 拉新 3/6）：落点就是地图页本身。
  // 好友（不是票根的主人）点进去看到的是一座**空地图** —— 这正是我们要的：
  // 「他走过这么多地方，我这儿还空着」，读得懂这句话的人会去收第一张。
  map: {
    // 不写具体城市名与年份：这是**分享者**的地图，好友看到的是自己的空地图，
    // 文案里编一个别人的数字，点进去对不上。张数是分享者自己的，那没问题。
    title: (d) => (d && d.cities ? `我走过了 ${d.cities} 座城，地图上一站站亮起来` : '我的回忆地图'),
    path: () => '/pages/discover/discover',
    query: () => '',
    cover: COVERS.map
  },
  // 双人空间 / 双人报告（沿用 v5.1 那句「我们」钩子：比功能描述更能唤起绑定）
  duo: {
    title: (d) => (d && d.total
      ? `我和${(d && d.partnerName) || 'TA'}一起收藏了 ${d.total} 张票根`
      : '我把咱俩看过的时光收成了收藏册，给你留了位置，来一起翻'),
    path: (d) => (d && d.code ? `/pages/bind/bind?code=${d.code}` : '/pages/duo/duo'),
    query: () => '',
    cover: COVERS.duo
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

module.exports = { message, timeline, sp, withSlogan, SCENES, COVERS, SLOGAN };
