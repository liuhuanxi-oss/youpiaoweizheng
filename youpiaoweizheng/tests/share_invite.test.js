// tests/share_invite.test.js —— 7.3.0 第二批（拉新包）：分享 / 邀请 / 长按菜单
// ============================================================
// 为什么这批要单独一套：
//   ① 分享文案与归因码被收进了 utils/share.js 与 utils/invite.js —— 收口的代价是
//      「改一处，7 个页面一起变」。这里跑真代码（不是扫源码），把出口钉死；
//   ② R6 是要**发额度**的：多发一次是真金白银，少发一次是白邀请一场。
//      发奖的四道闸（唯一 / 不自邀 / 老用户不发 / 真上传才发）必须逐条有断言。
//   ③ S1 的朋友圈落地面（单页模式）没有身份也读不到库 —— 漏一个页面，
//      好友点开就是一片空白，而编译、测试、真机自查全都不会报错。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

// ════════════════════════════════════════════════════════════
// wx 桩：share.js / invite.js 是要跑真逻辑的，不能只扫源码
// ════════════════════════════════════════════════════════════
const LS = new Map();
let events = [];      // reportEvent 记录（埋点）
let calls = [];       // callFunction 记录（云函数入参）
let cloudReply = {};  // action → 返回值
let launch = {};      // getLaunchOptionsSync

global.wx = {
  getStorageSync: (k) => (LS.has(k) ? LS.get(k) : ''),
  setStorageSync: (k, v) => { LS.set(k, v); },
  removeStorageSync: (k) => { LS.delete(k); },
  reportEvent: (e, d) => { events.push({ e, d }); },
  getLaunchOptionsSync: () => launch,
  cloud: {
    callFunction: (o) => {
      const action = (o && o.data && o.data.action) || '';
      calls.push({ action, data: (o && o.data) || {} });
      return Promise.resolve({ result: cloudReply[action] || {} });
    }
  }
};

function reset(opt) {
  const o = opt || {};
  LS.clear();
  events = [];
  calls = [];
  launch = o.launch || {};
  cloudReply = o.cloud || {};
  if (o.mine) LS.set('sp_ref_code', o.mine);
}

const share = require('../utils/share.js');
const invite = require('../utils/invite.js');

// ════════════════════════════════════════════════════════════
console.log('\n【一、share.js：一套文案，两个出口】');

t('好友分享：带票名、带口号、直达详情，配图是该场景的专属封面', () => {
  reset();
  const m = share.message('ticket', { id: 't1', title: '夜宴' });
  ok(m.title.indexOf('夜宴') >= 0, '标题里没有票名：' + m.title);
  ok(m.title.indexOf(share.SLOGAN) >= 0, '标题没有统一口号：' + m.title);
  ok(m.path === '/pages/detail/detail?id=t1', '落地页不对：' + m.path);
  ok(m.imageUrl === share.COVERS.ticket, '配图不对：' + m.imageUrl);
});

t('没有具体票根时落地收藏册（不是死链）', () => {
  reset();
  const m = share.message('ticket', {});
  ok(m.path === '/pages/album/album', '空票根没落回收藏册：' + m.path);
  ok(m.title.indexOf('票根收藏册') >= 0, '空票根标题不对：' + m.title);
});

t('朋友圈：只出 query、不出 path，配图必须自带（不支持异步取图）', () => {
  reset();
  const tt = share.timeline('ticket', { id: 't1', title: '夜宴' });
  ok(tt.query === 'id=t1', 'query 不对：' + tt.query);
  ok(!('path' in tt), '朋友圈不该有 path —— 它只能落在当前页，给了会被忽略');
  ok(!('promise' in tt), '朋友圈不支持 promise 取图');
  ok(tt.imageUrl === share.COVERS.ticket, '朋友圈没有现成配图，卡片会是白板');
  ok(tt.title.indexOf(share.SLOGAN) >= 0, '朋友圈标题没有口号');
  ok(share.timeline('annual', { total: 3 }).query === '', '年度报告没有 query 语义，不该硬塞');
});

// 封面是**图片文件**，改错了路径、拷漏了图、导出成了别的比例，代码全都不会报错——
// 只在真机转发时才发现卡片是白的或者被裁掉了半张。这条把盘上的文件钉死。
t('五张封面都在包里，且是 5:4 的 PNG（微信按这个比例显示好友卡片）', () => {
  Object.keys(share.COVERS).forEach((k) => {
    const rel = share.COVERS[k];
    const f = path.join(ROOT, rel.replace(/^\//, ''));
    ok(fs.existsSync(f), k + ' 的封面不在包里：' + rel);
    const b = fs.readFileSync(f);
    ok(b.slice(1, 4).toString() === 'PNG', k + ' 的封面不是 PNG：' + rel);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);  // IHDR 紧跟在 8 字节签名 + 4 字节长度 + 4 字节类型之后
    ok(Math.abs(w / h - 5 / 4) < 0.01, k + ' 的封面不是 5:4：' + w + '×' + h);
    ok(w >= 300 && h >= 240, k + ' 的封面小于微信要求的最小尺寸 300×240：' + w + '×' + h);
  });
});

t('五个场景各用各的专属封面，不再共用那张方形应用图标', () => {
  const covers = Object.keys(share.COVERS).map((k) => share.COVERS[k]);
  ok(new Set(covers).size === covers.length, '有两个场景共用了同一张封面');
  ok(covers.every((p) => p.indexOf('brand-logo') < 0),
    '分享封面又用回了 brand-logo（那是正方形应用图标，5:4 卡片上会被裁）：' + covers.join('、'));
});

t('有画布的场景：交了 promise 就不设 imageUrl（两个同时给的行为各版本不一致）', () => {
  reset();
  const p = Promise.resolve('x');
  const m = share.message('annual', { total: 5 }, { promise: p });
  ok(m.promise === p, 'promise 没交给微信，年报分享会退回默认截图');
  ok(!('imageUrl' in m), 'promise 与 imageUrl 同时给了');
  ok(m.title.indexOf('5') >= 0, '年报标题没带上张数：' + m.title);
});

t('口号只拼一次（各页文案换过几轮，难免有一条自带）', () => {
  ok(share.withSlogan(share.SLOGAN) === share.SLOGAN, '自带口号被拼成了两遍');
  ok(share.withSlogan('') === '有票为证 · ' + share.SLOGAN, '空标题没兜住');
});

t('双人场景：有邀请码直达绑定页，没码落双人空间', () => {
  reset();
  ok(share.message('duo', { code: 'ABC123' }).path === '/pages/bind/bind?code=ABC123', '没直达绑定页');
  ok(share.message('duo', {}).path === '/pages/duo/duo', '没码时落地页不对');
  const s = share.message('duo', { total: 12, partnerName: '小满' });
  ok(s.title.indexOf('小满') >= 0 && s.title.indexOf('12') >= 0, '双人标题没带上 TA 与张数：' + s.title);
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、invite.js：归因只认服务端判定】');

t('?ref= 记下邀请人短码（统一大写，脏字符剔掉）', () => {
  reset();
  ok(invite.capture({ query: { ref: 'ab-c12 3' } }) === 'ABC123', '没捞到码或没归一');
  ok(LS.get('sp_ref_from') === 'ABC123', '没记进本地待绑定');
});

t('小程序码的 scene 也认（r=XXXXXX）', () => {
  reset();
  ok(invite.capture({ query: { scene: 'b%3Dposter%26r%3Dxyz789' } }) === 'XYZ789', 'scene 里的码没解出来');
  reset();
  ok(invite.capture({ query: { scene: 'b=poster' } }) === '', '无码的旧海报码不该解析出东西');
});

t('自己的码不绑自己（少一次无意义的云调用）', () => {
  reset({ mine: 'ME1234' });
  ok(invite.capture({ query: { ref: 'me1234' } }) === '', '自己点自己的分享卡被记成了待绑定');
  ok(!LS.has('sp_ref_from'), '自己的码被写进了待绑定');
});

t('withRef：把码拼进任意 path / query，没有码就原样返回', () => {
  reset({ mine: 'ABC123' });
  ok(invite.withRef('/pages/x') === '/pages/x?ref=ABC123', '无 query 的拼接不对');
  ok(invite.withRef('/pages/x?a=1') === '/pages/x?a=1&ref=ABC123', '已有 query 时应改用 &');
  // 空串是「朋友圈 query」那个位置：那里本来就不带 ?，直接给参数体
  ok(invite.withRef('') === 'ref=ABC123', '空串拼接不对');
  reset();
  ok(invite.withRef('/pages/x') === '/pages/x', '没取到码时不该留下空 ref=');
});

t('绑定成功才等结算；老用户只记归因、不等奖', () => {
  reset({ mine: 'ME1234', cloud: { refBind: { ok: true, bound: true } } });
  LS.set('sp_ref_from', 'FROM12');
  return invite.bind().then(() => {
    ok(LS.get('sp_ref_wait') === 1, '新用户绑定后没标记等待结算');
    ok(!LS.has('sp_ref_from'), '待绑定码没清掉（每次启动都会重打一次云函数）');
    ok(events.some((e) => e.e === 'ref_bind'), '没有 ref_bind 埋点');
  });
});

t('老用户（绑定时已有票根）不发奖，也不留等待标记', () => {
  reset({ mine: 'ME1234', cloud: { refBind: { ok: true, bound: true, stale: true } } });
  LS.set('sp_ref_from', 'FROM12');
  return invite.bind().then(() => {
    ok(!LS.has('sp_ref_wait'), '老用户被塞进了结算队列 —— 会白送一次额度');
    ok(!LS.has('sp_ref_from'), '待绑定码没清掉');
  });
});

t('结算：服务端确认 granted 才清掉等待标记', () => {
  reset({ cloud: { refReward: { ok: true, granted: false, wait: true } } });
  LS.set('sp_ref_wait', 1);
  return invite.settle().then(() => {
    ok(LS.get('sp_ref_wait') === 1, '还没发奖就把等待标记清了 —— 额度永远补不回来');
    reset({ cloud: { refReward: { ok: true, granted: true } } });
    LS.set('sp_ref_wait', 1);
    return invite.settle();
  }).then(() => {
    ok(!LS.has('sp_ref_wait'), '发奖后没清等待标记（每次启动都白打一次云函数）');
  });
});

t('没有等待标记就不打云函数（启动路径上不许有无谓的往返）', () => {
  reset({ cloud: { refReward: { ok: true, granted: true } } });
  return invite.settle().then(() => {
    ok(calls.length === 0, '没有待结算也调了 refReward');
  });
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、R6 端到端：点别人分享卡进来的那一次启动】');

t('一次启动跑通：捞码 → 取自己的码 → 绑定 → 结算发奖', () => {
  reset({
    launch: { query: { ref: 'BBB222' } },
    cloud: {
      refCode: { ok: true, code: 'aaa111' },
      refBind: { ok: true, bound: true, stale: false },
      refReward: { ok: true, granted: true }
    }
  });
  invite.boot(launch);
  return new Promise((r) => setTimeout(r, 0)).then(() => {
    ok(calls[0] && calls[0].action === 'refCode', '没先取自己的码（分享 path 就带不上）');
    const bind = calls.find((c) => c.action === 'refBind');
    ok(bind, '没上报绑定');
    ok(bind.data.code === 'BBB222', '上报的码不对：' + bind.data.code);
    ok(calls.some((c) => c.action === 'refReward'), '绑定后没催结算（用户上传首票前不会自动发）');
    ok(LS.get('sp_ref_code') === 'AAA111', '自己的码没缓存下来（分享时同步读不到）');
    ok(!LS.has('sp_ref_wait'), '结算成功却没清等待标记');
    ok(events.some((e) => e.e === 'ref_reward'), '没有 ref_reward 埋点');
  });
});

t('自己的码：启动时不该产生任何绑定调用', () => {
  reset({ mine: 'ME1234', launch: { query: { ref: 'ME1234' } }, cloud: { refCode: { ok: true, code: 'ME1234' } } });
  invite.boot(launch);
  return new Promise((r) => setTimeout(r, 0)).then(() => {
    ok(!calls.some((c) => c.action === 'refBind'), '点自己的分享卡也上报了绑定');
  });
});

// ════════════════════════════════════════════════════════════
console.log('\n【四、云函数：发奖的四道闸（多发是钱，少发是白邀请）】');
const cloud = decomment(read('cloudfunctions/saveTicket/index.js'));

t('三个 action 都挂在路由上（项目约定：加 action，不新建云函数）', () => {
  ['refCode', 'refBind', 'refReward'].forEach((a) => {
    ok(new RegExp(`event\\.action === '${a}'`).test(cloud), '路由里没有 ' + a);
  });
});

t('闸一：被邀请人唯一 —— 已有关系直接返回，换码也绑不上', () => {
  const fn = /async function refBindAction[\s\S]*?\n}/.exec(cloud);
  ok(fn, '找不到 refBindAction');
  ok(/type: 'ref_link'[\s\S]{0,60}\.limit\(1\)/.test(fn[0]), '绑定前没查我是不是已有关系');
  ok(/if \(mine\.data && mine\.data\[0\]\) return \{ ok: true, bound: false, dup: true \}/.test(fn[0]),
    '已有关系没有直接返回 —— 一个账号能被邀请多次');
});

t('闸二：不能邀请自己', () => {
  const fn = /async function refBindAction[\s\S]*?\n}/.exec(cloud);
  ok(/inviter === OPENID[\s\S]{0,60}不能邀请自己/.test(fn[0]), '自邀没有被挡');
});

t('闸三：老用户（绑定时已有票根）只记归因，不发奖', () => {
  const fn = /async function refBindAction[\s\S]*?\n}/.exec(cloud);
  ok(/collection\('tickets'\)\.where\(\{ _openid: OPENID \}\)\.count\(\)/.test(fn[0]),
    '绑定时没数被邀请人的票根数');
  ok(/status: had > 0 \? 'stale' : 'pending'/.test(fn[0]), '老用户没被标成 stale');
});

t('闸四：真的上传过票根才发奖（前端只是触发器）', () => {
  const fn = /async function refRewardAction[\s\S]*?\n}/.exec(cloud);
  ok(fn, '找不到 refRewardAction');
  ok(/collection\('tickets'\)[\s\S]{0,80}count\(\)/.test(fn[0]), '结算前没数票根');
  ok(/if \(n < 1\) return \{ ok: true, granted: false, wait: true \}/.test(fn[0]),
    '没上传票根也发奖 —— 建个号点一下就能刷额度');
});

t('幂等：靠条件更新抢占结算权，并发与重试只发一次', () => {
  const fn = /async function refRewardAction[\s\S]*?\n}/.exec(cloud);
  ok(/where\(\{ _id: link\._id, status: 'pending' \}\)\s*\n?\s*\.update\(\{ data: \{ status: 'settled'/.test(fn[0]),
    '结算没有用条件更新抢占（并发会发两次奖）');
  ok(/claim\.stats\.updated/.test(fn[0]), '抢没抢到没判定');
});

t('入账：双方各 +1，且并入 paid 池同时记 bonus（退款回退上限不受影响）', () => {
  // 7.4.0 起这个入账函数被连签复用，改名 grantRefBonus → grantBonusArt（口径不变）
  const fn = /async function grantBonusArt[\s\S]*?\n}/.exec(cloud);
  ok(fn, '找不到 grantBonusArt');
  ok(/pay\.loadQuota\(db, openid\)/.test(fn[0]), '没走统一的额度读取（同一个人会开出两条额度记录）');
  ok(/paid: _\.inc\(1\), bonus: _\.inc\(1\)/.test(fn[0]), '入账口径与看视频奖励不一致');
  const reward = /async function refRewardAction[\s\S]*?\n}/.exec(cloud);
  ok(/grantBonusArt\(db, OPENID\)[\s\S]{0,80}grantBonusArt\(db, link\.inviter\)/.test(reward[0]),
    '不是双方各 +1');
});

t('入账失败要把结算权还回去（否则这单奖励永久丢失）', () => {
  const fn = /async function refRewardAction[\s\S]*?\n}/.exec(cloud);
  ok(/update\(\{ data: \{ status: 'pending' \} \}\)/.test(fn[0]), '入账失败没有回滚 status');
});

t('海报码升级为带邀请人短码的 scene 码，且缓存按码分开', () => {
  ok(/const scene = ref \? `b=poster&r=\$\{ref\}` : 'b=poster'/.test(cloud), 'scene 没带上邀请人短码');
  ok(/const type = ref \? 'wxacode_ref' : 'wxacode_poster'/.test(cloud), '带码的图没单独一类（会命中旧缓存）');
});

t('云函数路由不吞参数：要 event 的处理函数，调用点必须把 event 传进去', () => {
  // 卡页调 wxacode 时带着 ref（我的邀请短码）上来换「带码海报」。路由要是写成
  // wxacodeAction()，ref 就被静默丢掉：海报照常能分享、能扫码，只是归因永远
  // 算不到邀请人头上 —— 不报错、不失败，只是这个功能白做。参数一对不上就跑这条。
  const wants = new Set([...cloud.matchAll(/async function (\w+)\(\s*event\b/g)].map((m) => m[1]));
  const bad = [];
  for (const m of cloud.matchAll(/return (\w+)\(([^)]*)\)/g)) {
    const [, fn, args] = m;
    if (wants.has(fn) && !/\bevent\b/.test(args)) bad.push(`${fn}(${args})`);
  }
  ok(bad.length === 0, '这些处理函数拿不到 event，参数会被静默丢弃：' + bad.join('、'));
});

// ════════════════════════════════════════════════════════════
console.log('\n【五、A6 长按快捷菜单】');
const menuJs = decomment(read('components/ticket-menu/index.js'));
const menuWxml = read('components/ticket-menu/index.wxml');
const menuJson = JSON.parse(read('components/ticket-menu/index.json'));

t('菜单三行：生成纪念卡片 / 分享给好友 / 删除', () => {
  ok(/生成纪念卡片/.test(menuWxml), '少了「生成纪念卡片」');
  ok(/分享给好友/.test(menuWxml), '少了「分享」');
  ok(/is-danger[\s\S]{0,200}>删除</.test(menuWxml), '少了「删除」或没标成危险项');
  ok(/pages\/card\/card\?id=/.test(menuJs), '「生成卡片」没跳到卡片页');
});

t('分享那一行必须是 button open-type=share（小程序不允许代码拉起转发面板）', () => {
  ok(/<button[^>]*open-type="share"/.test(menuWxml), '分享不是开放能力按钮，点了不会有反应');
  ok(/open-type="share"[^>]*data-id="\{\{id\}\}"/.test(menuWxml),
    '分享按钮没带 id —— 页面分不清转的是哪一张');
});

t('删除：二次确认 → 走统一的删除入口 → 通知页面重取', () => {
  ok(/wx\.showModal/.test(menuJs), '删除没有二次确认');
  ok(/store\.removeTicket\(id\)/.test(menuJs), '删除没走 store.removeTicket（云/演示两套口径会分叉）');
  ok(/triggerEvent\('deleted'/.test(menuJs), '删完没通知页面刷新（列表里还留着那张）');
});

t('首页与时光机的票卡都挂上了长按', () => {
  ok(/bindlongpress="onCardLong"/.test(read('pages/home/home.wxml')), '首页票卡没有长按');
  ok(/bindlongpress="onCardLong"/.test(read('pages/album/album.wxml')), '时光机明信片没有长按');
  ok(/onCardLong\s*\(e\)/.test(decomment(read('pages/home/home.js'))), '首页没有 onCardLong');
  ok(/onCardLong\s*\(e\)/.test(decomment(read('pages/album/album.js'))), '时光机没有 onCardLong');
});

t('两个页面都注册了组件，也都有 onShareAppMessage（少了它，转发按钮点了没反应）', () => {
  ['pages/home/home.json', 'pages/album/album.json'].forEach((p) => {
    const j = JSON.parse(read(p));
    ok(j.usingComponents && j.usingComponents['ticket-menu'] === '/components/ticket-menu/index',
      p + ' 没注册 ticket-menu');
  });
  ['pages/home/home.js', 'pages/album/album.js'].forEach((p) => {
    const src = decomment(read(p));
    ok(/onShareAppMessage\s*\(res\)/.test(src), p + ' 没有 onShareAppMessage');
    ok(/res\.target\.dataset/.test(src), p + ' 没读被长按的那一张 —— 转出去的会是无 id 的默认文案');
  });
  ok(menuJson.usingComponents['bottom-sheet'] === '/components/bottom-sheet/index',
    '菜单没复用 bottom-sheet 半屏面板');
});

t('组件自带 hover 类（自定义组件默认样式隔离，app.wxss 的类进不来）', () => {
  const css = read('components/ticket-menu/index.wxss');
  ok(/\.tm-hover/.test(css), 'hover-class 指向的类没定义 —— 按下去毫无反应');
  const bare = css.replace(/var\([^)]*\)/g, '').match(/#[0-9A-Fa-f]{3,8}\b/g);
  ok(!bare, '组件 wxss 有裸十六进制（只允许 var(--x, #兜底)）：' + (bare || []).join(','));
});

// ════════════════════════════════════════════════════════════
console.log('\n【六、S1 朋友圈：8 个分享页，一个都不能漏】');
// 走品牌落地卡的那八个。discover 是 8.1.0 拉新 3/6 加的 —— 回忆地图开始对外分享后，
// 好友在朋友圈点进来就是单页模式，那里读不到云库、地图必然是一座空城。
const SP_PAGES = ['card', 'art', 'annual', 'duo', 'report', 'me', 'legacy', 'discover'];
const SP_JSON = 'templates/sp.wxml';

t('八个分享页都接了 onShareTimeline，且都有单页模式落地卡', () => {
  SP_PAGES.forEach((n) => {
    ok(/onShareTimeline\s*\(/.test(decomment(read(`pages/${n}/${n}.js`))), n + ' 没接朋友圈分享');
    ok(read(`pages/${n}/${n}.wxml`).indexOf(SP_JSON) >= 0, n + '.wxml 没引品牌落地卡');
    ok(/share\.sp\(\)/.test(decomment(read(`pages/${n}/${n}.js`))), n + ' 没判单页模式');
  });
});

t('详情页是特例：它有自己的兜底空态（去拍第一张的按钮在单页模式点了会被拒）', () => {
  const src = decomment(read('pages/detail/detail.js'));
  ok(/onShareTimeline\s*\(/.test(src), '详情页没接朋友圈分享');
  ok(/if \(share\.sp\(\)\)/.test(src), '详情页没判单页模式');
  ok(/wx:if="\{\{sp\}\}"/.test(read('pages/detail/detail.wxml')), '详情页没给单页模式换指路文案');
});

t('朋友圈分享都记了来源（否则看板只有一个总数，分不出哪一页带来的）', () => {
  ['card', 'art', 'annual', 'detail', 'duo', 'report', 'me', 'legacy', 'discover'].forEach((n) => {
    const src = decomment(read(`pages/${n}/${n}.js`));
    ok(/track\.track\('share_timeline'[\s\S]{0,40}from:/.test(src), n + ' 的 share_timeline 没有 from');
  });
});

// ════════════════════════════════════════════════════════════
(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log('  PASS  ' + name);
      pass++;
    } catch (e) {
      console.log('  FAIL  ' + name + '\n        ' + (e && e.message));
      fail++;
    }
  }
  console.log('\n──────────────────────────────');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
