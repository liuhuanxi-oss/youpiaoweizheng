// utils/badges.js —— 勋章解锁判定（v7.0 从 pages/me/me.js 迁出）
// ============================================================
// 【为什么要单独成文件】
//   这套判定原本写在 me.js 里，但 v6.0 改版把勋章墙从「我的」页摘掉之后，
//   computeBadges 算了 13 枚徽章却**没有任何界面渲染它** —— 纯空转。
//   现在勋章墙落在设置页，判定逻辑跟着挪到 utils/ 供页面复用，
//   顺带也不再让「我的」页背一份用不上的数据。
//
//   判定所需的输入全是本地/缓存数据，不额外发网络请求：
//     ts         票根列表（store.listTickets）
//     coupleInfo 双人绑定缓存（couple.cachedCouple，未绑定传 null）
//     shareCount 分享计数（本地 sp_share_count）
//     mapVisited 是否进过足迹地图（本地 sp_map_visited）
//     inviteSent 是否发起过双人邀请（本地 sp_invite_sent）
// ============================================================
const mock = require('./mock.js');

/**
 * 逐枚判定 13 个勋章，已解锁的保留原文案，未解锁的换成进度提示。
 * @returns {Array<{id,icon,name,desc,unlocked}>}
 */
function computeBadges(ts, coupleInfo, shareCount, mapVisited, inviteSent) {
  const total = ts.length;
  const shows = ts.filter((t) => t.type === 'show');
  const movies = ts.filter((t) => t.type === 'movie');
  const traffic = ts.filter((t) => t.type === 'traffic');
  const cities = new Set(ts.filter((t) => t.city).map((t) => t.city));
  const showCities = new Set(shows.filter((t) => t.city).map((t) => t.city));

  const crossNY = ts.some((t) => {
    const md = String(t.date || '').slice(5);
    return t.type === 'show' && (md === '12-31' || md === '01-01');
  });
  const lateNight = ts.some((t) => {
    const time = String(t.time || '');
    return time >= '23:00' || (!!time && time <= '05:59');
  });
  const repeat = {};
  shows.forEach((t) => { repeat[t.title] = (repeat[t.title] || 0) + 1; });
  const hasRepeat3 = Object.values(repeat).some((n) => n >= 3);

  const B = mock.badges;
  const def = (i, unlocked, progress) => ({ ...B[i], unlocked, desc: unlocked ? B[i].desc : progress });

  return [
    def(0, total >= 1, '收下第一张票根'),
    def(1, shows.length >= 10, `还差 ${10 - shows.length} 场`),
    def(2, crossNY, '在 12.31 或 01.01 看一场'),
    def(3, !!coupleInfo, '绑定最重要的人'),
    def(4, movies.length >= 100, `还差 ${100 - movies.length} 部`),
    def(5, cities.size >= 10, `还差 ${10 - cities.size} 座`),
    def(6, lateNight, '看一场 23 点后的场次'),
    def(7, traffic.length >= 10, `还差 ${10 - traffic.length} 次`),
    def(8, hasRepeat3, '同一乐队看满三场'),
    def(9, showCities.size >= 5, `还差 ${5 - showCities.size} 城`),
    def(10, shareCount >= 10, `还差 ${10 - shareCount} 张`),
    def(11, mapVisited && cities.size >= 3, cities.size >= 3 ? '去足迹地图点亮' : `还差 ${3 - cities.size} 座城`),
    // 4.17.0 M2 时光同谋：发起过邀请分享，或已和 TA 绑定（绑定的必然发起过邀请）
    def(12, !!inviteSent || !!coupleInfo, '把双人空间分享给 TA')
  ];
}

module.exports = { computeBadges };
