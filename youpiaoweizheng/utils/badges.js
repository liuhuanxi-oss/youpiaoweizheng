// utils/badges.js —— 勋章解锁判定（v7.0 从 pages/me/me.js 迁出）
// ============================================================
// 【为什么要单独成文件】
//   这套判定原本写在 me.js 里，但 v6.0 改版把勋章墙从「我的」页摘掉之后，
//   computeBadges 算了 13 枚徽章却**没有任何界面渲染它** —— 纯空转。
//   现在勋章墙落在设置页，判定逻辑跟着挪到 utils/ 供页面复用，
//   顺带也不再让「我的」页背一份用不上的数据。
//
//   判定所需的输入，前五项是本地/缓存数据：
//     ts         票根列表（store.listTickets）
//     coupleInfo 双人绑定缓存（couple.cachedCouple，未绑定传 null）
//     shareCount 分享计数（本地 sp_share_count，**只认真分享**）
//     mapVisited 是否进过地图页（本地 sp_map_visited，由 pages/discover 打标）
//     inviteSent 是否发起过双人邀请（本地 sp_invite_sent）
//
//   第六项 server 来自云函数，只有连签与积分三枚用它：
//     server = { streak, lifetime }，取不到传 null
//   为什么这三枚非走服务端不可：签到与积分都是服务端结算的（连签判定、积分账本都在云上），
//   端上算意味着「改一下手机时间 / 清一次本地缓存」就能点亮。
// ============================================================
const mock = require('./mock.js');

/**
 * 逐枚判定 16 个勋章，已解锁的保留原文案，未解锁的换成进度提示。
 * @param {object|null} server 服务端数据 { streak, lifetime }；取不到传 null
 * @returns {Array<{id,icon,name,desc,unlocked}>}
 */
function computeBadges(ts, coupleInfo, shareCount, mapVisited, inviteSent, server) {
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

  // 服务端数据（连签 / 积分）。**取不到时不编数字**：
  // 显示「还差 3 天」而用户其实已经签了 5 天，是假的 —— 假的进度比没有进度更伤人。
  // 拿不到就只说门槛（「连续签到 3 天可解锁」），一个字都不猜。
  const sv = server || {};
  const streak = typeof sv.streak === 'number' ? sv.streak : null;
  const life = typeof sv.lifetime === 'number' ? sv.lifetime : null;
  // 积分看**累计获得**而不是余额：攒到 500 分换掉 5 次重绘、余额掉回 0，
  // 用余额判定的话勋章会当场熄灭 —— 已经得到的东西不该因为消费而失去
  const streakDesc = (need) => (streak === null ? `连续签到 ${need} 天可解锁` : `还差 ${need - streak} 天`);
  const lifeDesc = (need) => (life === null ? `累计获得 ${need} 积分可解锁` : `还差 ${need - life} 分`);

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
    // 7.4.0 C 段：口径回到「分享」本身 —— 保存到相册不再计数（详见 pages/card 的 _incrShare）
    def(10, shareCount >= 10, `还差 ${10 - shareCount} 张`),
    def(11, mapVisited && cities.size >= 3, cities.size >= 3 ? '去回忆地图点亮' : `还差 ${3 - cities.size} 座城`),
    // 4.17.0 M2 时光同谋：发起过邀请分享，或已和 TA 绑定（绑定的必然发起过邀请）
    def(12, !!inviteSent || !!coupleInfo, '把双人空间分享给 TA'),
    // 7.4.0 C 段 R3：连签与积分（判定读服务端，理由见文件头）
    def(13, streak !== null && streak >= 3, streakDesc(3)),
    def(14, streak !== null && streak >= 7, streakDesc(7)),
    def(15, life !== null && life >= 500, lifeDesc(500))
  ];
}

module.exports = { computeBadges };
