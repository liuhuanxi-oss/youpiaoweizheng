// tests/anniv_remind.test.js —— 8.1.2 拉新 6/6：周年提醒卡片
// ============================================================
// 为什么这批要单独一套：
//   ① 「下一个周年日」算错的形态全是**看不出来**的错法 —— 差一天、跨年算成明年、
//      平年的 2/29 编出个 3 月 1 日、脏日期把「2 月 30 日」当成 3 月 2 日。
//      所以纯函数真跑，边界逐个钉：第 30 天算、第 31 天不算、今天不算（让给彩蛋）。
//   ② 详情页那一行**什么时候出现**。问不出口（模板没配 / 被拒后的静默期 / 今天已经问过）
//      却还摆着一行「提醒我」，点下去什么都不会发生 —— 全项目最忌讳的假入口。
//   ③ 云端发出去的那条消息：字段名与后台模板对不上就是 47003 静默失效；
//      而「今天满 N 周年」这句话只在**那天**发才成立，晚一天补发就是假话。
//   跑的是真代码（utils/anniv.js、utils/subscribe.js、cloudfunctions/saveTicket/recall.js）。
// ============================================================
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

/** 北京时间的某个时刻 → 时间戳（与时区无关：UTC+8 就是减 8 小时） */
const BJ = (y, m, d, h = 12) => Date.UTC(y, m - 1, d, h - 8, 0, 0, 0);
/** 时间戳 → 北京时间的 'YYYY-MM-DD HH:mm'，用来核 sendAt 到底排在哪一刻 */
function bjText(ts) {
  const n = new Date(ts + 8 * 3600 * 1000);
  const p = (x) => String(x).padStart(2, '0');
  return `${n.getUTCFullYear()}-${p(n.getUTCMonth() + 1)}-${p(n.getUTCDate())} ${p(n.getUTCHours())}:${p(n.getUTCMinutes())}`;
}
/** 北京「今天」—— 与 utils/subscribe.js 的 _ymd() 同口径（+8h 后取 UTC 字段，8.1.3 起）。
 *  千万别写成 toISOString().slice(0,10)：那是纯 UTC 日期，北京凌晨 0~8 点比它早一天，
 *  种进去的「今天问过」永远对不上（2026-09-19 凌晨 02:30 就是这么红的）。 */
function localYmd() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// ════════════════════════════════════════════════════════════
console.log('\n【一、下一个周年日（utils/anniv.js，真跑）】');

const AN = require('../utils/anniv.js');
const NOW = BJ(2026, 9, 18); // 今天：北京 2026-09-18

t('命中：票 2022-09-20 → 2026-09-20、4 周年、还差 2 天', () => {
  const n = AN.next('2022-09-20', NOW);
  ok(n, '该命中却没有：' + JSON.stringify(n));
  ok(n.ymd === '2026-09-20', '周年日算错了：' + n.ymd);
  ok(n.years === 4, '年数算错了：' + n.years);
  ok(n.days === 2, '天数算错了：' + n.days);
});

t('窗口边界：第 30 天算、第 31 天不算', () => {
  const d30 = AN.next('2022-10-18', NOW); // 9-18 → 10-18 正好 30 天
  const d31 = AN.next('2022-10-19', NOW);
  ok(d30 && d30.days === 30, '第 30 天应该算：' + JSON.stringify(d30));
  ok(d31 === null, '第 31 天不该问（问了他也记不住）:' + JSON.stringify(d31));
  ok(AN.WINDOW_DAYS === 30, '窗口被改动了？');
});

t('今天正好是周年 → 不算（那一天的彩蛋归详情页的 4.15.0 管）', () => {
  ok(AN.next('2022-09-18', NOW) === null, '今天正是周年还摆一行「提醒我」，是重复，而且今早那条已经排不上了');
});

t('今年这天已过 → 看明年；超出窗口就不问', () => {
  const n = AN.next('2022-09-10', NOW); // 今年 9-10 已过 → 明年 9-10，差 357 天
  ok(n === null, '已经过去的日子不该算成「快到了」:' + JSON.stringify(n));
});

t('今年的票（还没有周年）→ 不算，也不编一个 0 周年出来', () => {
  ok(AN.next('2026-09-30', NOW) === null, '今年的票被算成周年了');
  ok(AN.next('2026-01-05', NOW) === null, '今年的票被算成周年了');
});

t('跨年：12-30 看 01-05 是 6 天后（不是 361 天后）', () => {
  const n = AN.next('2023-01-05', BJ(2026, 12, 30));
  ok(n && n.ymd === '2027-01-05' && n.years === 4 && n.days === 6, '跨年算错了：' + JSON.stringify(n));
});

t('2/29 的票：平年落到 2/28，闰年还是 2/29', () => {
  const flat = AN.next('2020-02-29', BJ(2026, 2, 1)); // 2026 是平年 → 2-28
  ok(flat && flat.ymd === '2026-02-28' && flat.years === 6 && flat.days === 27, '平年该落到 2/28：' + JSON.stringify(flat));
  const leap = AN.next('2020-02-29', BJ(2028, 2, 20)); // 2028 是闰年 → 2-29
  ok(leap && leap.ymd === '2028-02-29' && leap.days === 9, '闰年不该改日子：' + JSON.stringify(leap));
});

t('脏日期一律当成「没有日期」，不崩、也不替用户编一天', () => {
  ['2025-02-30', '2025-13-01', '2025-00-10', '2025-10-32', '', 'abc', '2025/10/01', null, undefined]
    .forEach((s) => ok(AN.next(s, NOW) === null, '这条脏数据被当成了日期：' + s));
  ok(AN.parse('2025-02-30') === null, 'parse 没有挡住不存在的日子');
  ok(AN.parse('2024-02-29') !== null, '闰年的 2/29 是真日子，不该挡');
  ok(AN.cnDay('2026-02-30') === '', '脏数据不该渲染出一个日期字符串');
});

t('口径是北京时间：北京 09-19 凌晨，票面 09-19 的「今天」认得出', () => {
  const early = Date.UTC(2026, 8, 18, 17, 0); // 北京 2026-09-19 01:00
  // 用设备/UTC 时区算的话，这天会被当成 09-18：要么把「今天正是周年」算成 1 天后，要么凭空多一天
  ok(AN.next('2022-09-19', early) === null, '北京时间已经是 09-19 了，今天正是周年，不该出现提醒行');
  const n = AN.next('2022-09-20', early);
  ok(n && n.days === 1, '按设备时区算会得 2 天：' + JSON.stringify(n));
});

t('纯函数不读设备时区（源码里不许出现 getDate() / getMonth()）', () => {
  const src = decomment(read('utils/anniv.js'));
  ok(!/\.getDate\(\)|\.getMonth\(\)|\.getFullYear\(\)/.test(src),
    '用了设备时区的取日方法 —— 出境或时区设错时，这一页会和「那年今天」各说各话');
  ok(/getUTCDate|getUTCMonth|getUTCFullYear/.test(src), '连 UTC 取日都没有，口径是哪儿来的？');
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、端上：什么时候问得出口、授权后回报什么（真跑）】');

const LS = new Map();
let dialogs = [], calls = [], dialogReply = {};
const ANNIV = 'ANNIV_TEST_ID_0123456789';

global.wx = {
  getStorageSync: (k) => (LS.has(k) ? LS.get(k) : ''),
  setStorageSync: (k, v) => { LS.set(k, v); },
  removeStorageSync: (k) => { LS.delete(k); },
  cloud: { callFunction: (o) => { calls.push({ action: (o.data || {}).action, data: o.data || {} }); return Promise.resolve({ result: { ok: true } }); } },
  requestSubscribeMessage: (o) => {
    dialogs.push(o);
    if (dialogReply.fail) { o.fail && o.fail({ errCode: dialogReply.fail }); return; }
    o.success && o.success(dialogReply);
  }
};
function reset(reply) { LS.clear(); dialogs = []; calls = []; dialogReply = reply || {}; }

/** 把某个常量换成给定值装进内存跑（真源码，只是那一个常量不同）—— 不去动仓库文件 */
function loadWith(replacements) {
  const file = path.join(ROOT, 'utils/subscribe.js');
  let src = read('utils/subscribe.js');
  replacements.forEach(([re, rep, probe]) => {
    src = src.replace(re, rep);
    ok(src.indexOf(probe) > 0, '注入失败：subscribe.js 里的声明变了？' + probe);
  });
  const m = new Module(file, null);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(src, file);
  return m.exports;
}

const repo = require('../utils/subscribe.js');            // 仓库里那份（两个模板都已回填）
const noAnniv = loadWith([[/const ANNIV_TMPL = '[^']*';/, "const ANNIV_TMPL = '';", "ANNIV_TMPL = ''"]]);
const sub = loadWith([[/const ANNIV_TMPL = '[^']*';/, `const ANNIV_TMPL = '${ANNIV}';`, `ANNIV_TMPL = '${ANNIV}'`]]);
const S_ANNIV = 'sp_sub_anniv', S_SIGN = 'sp_sub_state';

t('仓库里的周年模板 ID 已回填，而且像个真 ID', () => {
  ok(repo.ANNIV_TMPL !== '', '模板 ID 还空着 —— 周年提醒一次都不会通电');
  ok(/^[A-Za-z0-9_-]{20,}$/.test(repo.ANNIV_TMPL), '模板 ID 格式不像话：' + repo.ANNIV_TMPL);
  ok(repo.annivAvailable() === true, 'ID 已填，annivAvailable() 却还是 false');
  // 两个模板必须是两个不同的 ID：写重了就是拿签到模板发周年消息（文案对不上，47003）
  ok(repo.ANNIV_TMPL !== repo.TMPL_ID, '周年模板与签到模板是同一个 ID');
});

t('模板没配 → 那一行不出现、一次授权都不弹（不留假入口）', () => {
  reset({ [ANNIV]: 'accept' });
  ok(noAnniv.annivAvailable() === false, '没配却说可用');
  ok(noAnniv.annivAskable(NOW) === false, '没配却说问得出口 —— 详情页会摆出一行点了没反应的「提醒我」');
  ok(noAnniv.askAnniv() === null, '没配却拉起弹窗');
  ok(dialogs.length === 0, '没配却弹了：' + dialogs.length + ' 次');
});

t('配好之后：弹一次、模板就是那一个（不多带）', async () => {
  reset({ [ANNIV]: 'accept' });
  ok(sub.annivAskable(NOW) === true, '配好了却说问不出口');
  const p = sub.askAnniv();
  ok(!!p, '配好了却什么都没弹');
  ok(dialogs.length === 1 && JSON.stringify(dialogs[0].tmplIds) === JSON.stringify([ANNIV]), '模板传错：' + JSON.stringify(dialogs[0].tmplIds));
  const r = await p;
  ok(r.accepted === true, '允许了却不算 accepted');
});

t('今天已经问过 → 同一天不再弹第二遍', () => {
  reset({ [ANNIV]: 'accept' });
  LS.set(S_ANNIV, { ymd: localYmd() });
  ok(sub.annivAskable(NOW) === false, '今天已经问过了还问得出口');
  ok(sub.askAnniv() === null && dialogs.length === 0, '今天已经问过，还是弹了');
});

t('被拒 → 30 天静默（那一行也跟着收起来）', async () => {
  reset({ [ANNIV]: 'reject' });
  const p = sub.askAnniv();
  ok((await p).accepted === false, '拒绝了却算接受');
  LS.set(S_ANNIV, { ymd: '2000-01-01', denyAt: Date.now() - 5 * 86400000 });
  ok(sub.annivAskable() === false, '被拒 5 天后那一行又出现了 —— 点开还是弹不出窗，就是个假按钮');
  LS.set(S_ANNIV, { ymd: '2000-01-01', denyAt: Date.now() - 31 * 86400000 });
  ok(sub.annivAskable() === true, '静默期过了该能再问一次（用户可能只是当时点错了）');
});

t('两个模板互不连坐：签到被拒不影响周年，周年被拒也不影响签到', () => {
  reset({ [ANNIV]: 'accept' });
  LS.set(S_SIGN, { ymd: '2000-01-01', denyAt: Date.now() }); // 刚拒过签到召回
  ok(sub.annivAskable(Date.now()) === true, '拒了签到召回，连周年提醒也问不出口了 —— 两件事被绑在一起了');
  LS.set(S_ANNIV, { ymd: '2000-01-01', denyAt: Date.now() }); // 反过来
  LS.set(S_SIGN, { ymd: '2000-01-01' });
  ok(!!sub.askIfDue(), '拒了周年提醒，连签到的召回授权也不弹了');
});

t('授权允许 → 回报服务端排提醒（action / 哪天 / 几周年 / 哪张票）', async () => {
  reset({ [ANNIV]: 'accept' });
  const p = sub.askAnniv();
  const done = await sub.afterAnniv(p, { ymd: '2026-09-20', years: 4, id: 'tk_1', title: '五月天 诺亚方舟' });
  ok(done === true, '排上了却报失败');
  ok(calls.length === 1 && calls[0].action === 'annivSave', '回报的 action 不对：' + JSON.stringify(calls));
  ok(calls[0].data.tmplId === ANNIV, '回报没带模板 ID');
  ok(calls[0].data.ymd === '2026-09-20' && calls[0].data.years === 4, '回报没带日期或年数');
  ok(calls[0].data.id === 'tk_1' && calls[0].data.title === '五月天 诺亚方舟', '回报没带那张票（落页就回不到这张票）');
  ok(sub.annivSaved() === '2026-09-20', '排上了却没记下 —— 下次进这一页还会再问一遍');
});

t('用户拒绝 / 弹窗失败 → 不回报、也不记「已排上」（不能撒谎）', async () => {
  reset({ [ANNIV]: 'reject' });
  const done = await sub.afterAnniv(sub.askAnniv(), { ymd: '2026-09-20', years: 4, id: 'tk_1', title: 'x' });
  ok(done === false && calls.length === 0, '拒绝了还是回报了服务端');
  ok(sub.annivSaved() === '', '没排上却记成「已排上」—— 用户以为会有提醒，那天什么都不会来');
  reset({ fail: 20004 });
  ok(await sub.afterAnniv(sub.askAnniv(), { ymd: '2026-09-20', years: 4 }) === false, '弹窗失败却报成功');
  ok(calls.length === 0, '弹窗失败还是回报了服务端');
});

t('云端说没排上（ok:false）→ 端上不记「已排上」', async () => {
  reset({ [ANNIV]: 'accept' });
  global.wx.cloud.callFunction = (o) => { calls.push({ action: (o.data || {}).action, data: o.data || {} }); return Promise.resolve({ result: { ok: false, msg: '不在可排范围内' } }); };
  const done = await sub.afterAnniv(sub.askAnniv(), { ymd: '2026-09-20', years: 4 });
  ok(done === false && sub.annivSaved() === '', '云端拒了，端上却显示「已排上」');
  global.wx.cloud.callFunction = (o) => { calls.push({ action: (o.data || {}).action, data: o.data || {} }); return Promise.resolve({ result: { ok: true } }); };
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、云端：排提醒 / 发消息（真跑）】');

const recall = require('../cloudfunctions/saveTicket/recall.js');

/** 假 db：只实现用到的那几样；where 不真过滤，喂什么就返回什么 */
function fakeDb(rows) {
  const updates = [], added = [];
  const col = {
    where: () => col, limit: () => col,
    get: async () => ({ data: (rows || []).map((r) => Object.assign({}, r)) }),
    doc: (id) => ({ update: async (o) => { updates.push({ id, data: o.data }); return { stats: { updated: 1 } }; } }),
    add: async (o) => { added.push(o.data); return { _id: 'new1' }; }
  };
  return {
    db: { command: { lte: (v) => ({ __lte: v }), in: (v) => ({ __in: v }) }, collection: () => col },
    updates, added
  };
}
function fakeCloud(result) {
  const sent = [];
  return {
    sent,
    cloud: { openapi: { subscribeMessage: { send: async (o) => {
      sent.push(o);
      if (result && result.throw) { const e = new Error(result.throw); e.errCode = result.code; throw e; }
      return { errCode: 0 };
    } } } }
  };
}

t('bjYmd / bjDayStart：北京时间口径，脏数据返回 0', () => {
  ok(recall.bjYmd(Date.UTC(2026, 8, 18, 17, 0)) === '2026-09-19', '北京时间已经是 19 号了');
  ok(bjText(recall.bjDayStart('2026-09-20')) === '2026-09-20 00:00', '北京那天的零点算错了');
  ok(recall.bjDayStart('2026-02-30') === 0, '不存在的日子被当成了日期');
  ok(recall.bjDayStart('') === 0 && recall.bjDayStart('hack') === 0, '脏数据没挡住');
});

t('排提醒：合法的排得上，发送时刻是**那天早上 9 点**（北京时间）', async () => {
  const f = fakeDb([]);
  const at = Date.now();
  const out = await recall.annivSave(f.db, 'o1', { tmplId: 'T', ymd: '2026-09-20', years: 4, id: 'tk_1', title: '五月天' });
  ok(out.ok === true, '没排上：' + JSON.stringify(out));
  ok(bjText(out.sendAt) === '2026-09-20 09:00', '发送时刻不对：' + bjText(out.sendAt));
  ok(f.added.length === 1 && f.added[0].type === 'anniv' && f.added[0].status === 'pending', '没写进待发表');
  ok(f.added[0]._openid === 'o1', '没记是谁的提醒');
  ok(f.added[0].updatedAt >= at, '没记时间');
});

t('排提醒：一人一条 —— 已经有记录就更新那一条，不堆文档', async () => {
  const f = fakeDb([{ _id: 'd1', _openid: 'o1', type: 'anniv' }]);
  const out = await recall.annivSave(f.db, 'o1', { tmplId: 'T', ymd: '2026-09-20', years: 4 });
  ok(out.ok === true && f.added.length === 0 && f.updates.length === 1, '又新增了一条：' + JSON.stringify({ added: f.added.length, upd: f.updates.length }));
  ok(f.updates[0].data.ymd === '2026-09-20', '更新的不是新日期');
});

t('排提醒：模板空 / 日期非法 / 太近太远，一律拒（文案说的是「今天满 N 周年」）', async () => {
  const cases = [
    [{ tmplId: '', ymd: '2026-09-20' }, '模板空'],
    [{ tmplId: 'T', ymd: '2026-02-30' }, '不存在的日子'],
    [{ tmplId: 'T', ymd: '' }, '空日期'],
    [{ tmplId: 'T', ymd: recall.bjYmd() }, '今天（今天那条排不上，彩蛋在管）'],
    [{ tmplId: 'T', ymd: recall.bjYmd(Date.now() + 90 * 86400000) }, '90 天后（端上窗口只有 30 天）']
  ];
  for (const [ev, why] of cases) {
    const f = fakeDb([]);
    const out = await recall.annivSave(f.db, 'o1', ev);
    ok(out.ok === false, '本该拒掉：' + why);
    ok(f.added.length === 0 && f.updates.length === 0, '拒掉了却写了库：' + why);
  }
  ok(recall.ANNIV_AHEAD_DAYS === 60, '云端边界被改动了？端上 30 天 + 时钟偏差，这里放宽到 60');
});

t('排提醒：票 id 与票名都要洗过（一个要塞进消息落页，一个要塞进消息体）', async () => {
  const f = fakeDb([]);
  await recall.annivSave(f.db, 'o1', { tmplId: 'T', ymd: '2026-09-20', years: 2, id: 'https://evil/x?y=1', title: '很长很长很长很长很长很长很长很长很长很长的票名\n带换行' });
  const d = f.added[0];
  ok(d.ticketId === '', '来路不明的串被塞进了消息落页：' + d.ticketId);
  ok(recall.clip20(d.title).length <= 20, 'thing 类型上限 20 字，超了就是 47003：' + d.title.length);
  ok(d.title.indexOf('\n') < 0, '票名里的换行没洗掉');
  ok(d.years === 2, '年数丢了');
});

t('消息内容：四个字段名与后台模板逐字一致、且不越各类型额度', () => {
  const d = recall.annivData({ ymd: '2026-08-12', years: 4, title: '五月天 诺亚方舟' });
  // 后台模板：纪念日名称 {{thing1.DATA}} / 日期 {{time2.DATA}} / 备注 {{thing3.DATA}} / 提醒对象 {{thing4.DATA}}
  ok(d.thing1 && d.time2 && d.thing3 && d.thing4, '字段名与后台对不上：' + Object.keys(d).join(','));
  ok(Object.keys(d).length === 4, '多出模板里没有的字段，微信按未填处理：' + Object.keys(d).join(','));
  ok(d.time2.value === '2026年08月12日 09:00', 'time 类型的格式不对：' + d.time2.value);
  ok(d.thing1.value === '五月天 诺亚方舟', '纪念日名称不是票名');
  ok(d.thing1.value.length <= 20 && d.thing3.value.length <= 20, 'thing 类型超长：' + d.thing1.value + ' / ' + d.thing3.value);
  ok(d.thing3.value.indexOf('4') >= 0, '备注里没有年数：' + d.thing3.value);
  ok(d.thing4.value === '你', '提醒对象不是「你」');
  ok(recall.annivData({}).thing1.value === '一张票根', '票名缺失时该给个不撒谎的兜底（空字段会被微信拒收）');
});

t('消息内容：一次性订阅，不许承诺「每天」', () => {
  const d = recall.annivData({ ymd: '2026-08-12', years: 4, title: 'x' });
  ['每天', '每日', '天天'].forEach((w) => {
    ok(String(d.thing3.value).indexOf(w) < 0, '这条只发一次，文案却承诺天天推：' + d.thing3.value);
  });
});

t('发送：周年提醒只在**那一天**发，各用自己的模板与落页', async () => {
  const real = Date.now;
  const day = '2026-08-12';
  Date.now = () => BJ(2026, 8, 12, 9, 30);
  try {
    const rows = [
      { _id: 'r1', _openid: 'o1', type: 'recall', tmplId: 'T_SIGN', streak: 3, status: 'pending', tries: 0, sendAt: 1 },
      { _id: 'a1', _openid: 'o2', type: 'anniv', tmplId: 'T_ANNIV', ymd: day, years: 4, title: '五月天', ticketId: 'tk_1', status: 'pending', tries: 0, sendAt: 1 }
    ];
    const f = fakeDb(rows);
    const c = fakeCloud();
    const out = await recall.run(f.db, c.cloud, {});
    ok(out.sent === 2, '该发两条：' + JSON.stringify(out));
    const sign = c.sent.find((s) => s.templateId === 'T_SIGN');
    const ann = c.sent.find((s) => s.templateId === 'T_ANNIV');
    ok(sign && sign.page === 'pages/home/home', '签到召回落页不对：' + (sign && sign.page));
    ok(ann && ann.page === 'pages/detail/detail?id=tk_1', '周年提醒没落回那张票：' + (ann && ann.page));
    ok(ann && ann.data.thing1.value === '五月天' && ann.data.time2.value === '2026年08月12日 09:00', '周年消息内容不对');
    ok(sign && sign.data.phrase1 && !sign.data.thing1, '签到召回被换成了周年模板，两条串了');
  } finally { Date.now = real; }
});

t('发送：过期的周年提醒就地结案，不补发（晚一天那句「今天满 N 周年」就是假话）', async () => {
  const real = Date.now;
  Date.now = () => BJ(2026, 8, 15, 9, 30); // 云函数停了三天才跑起来
  try {
    const rows = [
      { _id: 'a1', _openid: 'o1', type: 'anniv', tmplId: 'T_ANNIV', ymd: '2026-08-12', years: 4, title: 'x', status: 'pending', tries: 0, sendAt: 1 },
      { _id: 'r1', _openid: 'o2', type: 'recall', tmplId: 'T_SIGN', streak: 3, status: 'pending', tries: 0, sendAt: 1 }
    ];
    const f = fakeDb(rows);
    const c = fakeCloud();
    const out = await recall.run(f.db, c.cloud, {});
    ok(c.sent.length === 1 && c.sent[0].templateId === 'T_SIGN', '过期的也发了 / 或者把没过期的也连坐了');
    const dead = f.updates.find((u) => u.id === 'a1');
    ok(dead && dead.data.status === 'dead' && /^expired/.test(dead.data.err), '过期那条没结案：' + JSON.stringify(dead));
    ok(out.dead === 1, 'dead 计数不对：' + JSON.stringify(out));
  } finally { Date.now = real; }
});

t('发送：43101（没额度）两条都是终局，不无限重试', async () => {
  const real = Date.now;
  Date.now = () => BJ(2026, 8, 12, 9, 30);
  try {
    const rows = [{ _id: 'a1', _openid: 'o1', type: 'anniv', tmplId: 'T', ymd: '2026-08-12', years: 4, title: 'x', status: 'pending', tries: 0, sendAt: 1 }];
    const f = fakeDb(rows);
    const c = fakeCloud({ throw: 'no quota', code: 43101 });
    const out = await recall.run(f.db, c.cloud, {});
    ok(out.dead === 1 && out.retry === 0, '终局错误被当成可重试：' + JSON.stringify(out));
    ok(f.updates[0].data.status === 'dead', '没结案');
  } finally { Date.now = real; }
});

t('dryRun：名单里看得出这是哪一类（验收定时器时要知道明天会发什么）', async () => {
  const real = Date.now;
  Date.now = () => BJ(2026, 8, 12, 9, 30);
  try {
    const rows = [{ _id: 'a1', _openid: 'oABCDEFGHIJKLMNOPQRSTUVWXYZ01', type: 'anniv', tmplId: 'T', ymd: '2026-08-12', years: 4, title: 'x', status: 'pending', tries: 0, sendAt: 1 }];
    const f = fakeDb(rows);
    const c = fakeCloud();
    const out = await recall.run(f.db, c.cloud, { dryRun: true });
    ok(c.sent.length === 0 && f.updates.length === 0, 'dryRun 竟然真动了手');
    ok(out.list.length === 1 && out.list[0].kind === 'anniv' && out.list[0].ymd === '2026-08-12', '名单看不出是哪一类：' + JSON.stringify(out.list));
    ok(String(out.list[0].openid).length <= 10, 'dryRun 把完整 openid 回显了');
  } finally { Date.now = real; }
});

// ════════════════════════════════════════════════════════════
console.log('\n【四、接线：入口、顺序与路由（错了就是静默失效）】');

t('详情页：一路径判定、一路径授权（都在真代码里）', () => {
  const src = decomment(read('pages/detail/detail.js'));
  ok(/setupAnniv\(raw\)/.test(src), 'onLoad 里没接上——那一行永远不会出现');
  ok(/anniv\.next\(/.test(src), '没有算「下一个周年日」');
  const i = src.indexOf('onAnnivTap');
  ok(i > 0, '找不到 onAnnivTap');
  const body = src.slice(i, i + 600);
  const ask = body.indexOf('askAnniv');
  const aw = body.indexOf('await');
  ok(ask > 0, '「提醒我」没有发起订阅授权');
  ok(aw < 0 || ask < aw, 'askAnniv 排在了 await 之后 —— 点击手势已过期，弹窗会静默失败');
});

t('详情页：演示票根不许摆这一行（样例日期不能换用户的一次授权）', () => {
  const src = decomment(read('pages/detail/detail.js'));
  const i = src.indexOf('setupAnniv(t)');
  ok(i > 0, '找不到 setupAnniv');
  const body = src.slice(i, i + 400);
  ok(/isMockTicket\(t\.id\)/.test(body), '演示票根（云兜底那批，日期是样例数据）也会摆出「提醒我」—— 按下去烧掉用户一次授权，那天还会推一条关于一张他从没有过的票的消息');
});

t('详情页：那一行是条件渲染，不是常驻', () => {
  const wxml = read('pages/detail/detail.wxml');
  ok(/wx:if="\{\{arState\}\}"/.test(wxml), '那一行没有跟着状态走，会常驻在页面上');
  ok(/bindtap="\{\{arState === 'ask' \? 'onAnnivTap' : ''\}\}"/.test(wxml), '「已排上」的状态还能点，会出现点了没反应的按钮');
});

t('订阅接口仍然只有 utils/subscribe.js 一处出口', () => {
  ok(!/requestSubscribeMessage/.test(read('pages/detail/detail.js')), '详情页自己调了订阅接口');
});

t('云端：annivSave 已挂路由、接了实现（铁律：加 action，不新建云函数）', () => {
  const src = decomment(read('cloudfunctions/saveTicket/index.js'));
  ok(/event\.action === 'annivSave'/.test(src), 'annivSave 没挂路由');
  ok(/return recall\.annivSave\(adb, OPENID, event\)/.test(src), 'annivSave 没接实现');
  ok(/ensureCollection\(adb, 'prefs'\)/.test(src), '没保证 prefs 集合存在（首次用的用户会写失败）');
});

t('云端：定时器与权限不需要新增（复用 7.4.0 那一条）', () => {
  const cfg = JSON.parse(read('cloudfunctions/saveTicket/config.json'));
  ok((cfg.triggers || []).length === 1, '又多建了定时器？周年提醒应该复用现有那一趟每小时');
  ok(((cfg.permissions || {}).openapi || []).indexOf('subscribeMessage.send') >= 0, '没申请发送权限');
});

t('协议：周年提醒这条披露必须在站内协议里（说了才做）', () => {
  const p = read('pages/protocol/protocol.js');
  ok(/周年提醒（8\.1\.2）/.test(p), '站内协议一个字都没提会给你发周年提醒 —— 功能先发了、话没说，正是要堵的口径漏洞');
  ok(/一次性订阅消息/.test(p) && /一次授权只换一条/.test(p),
    '协议没写清这是微信的一次性订阅（一次授权只换一条），用户会以为它是个可以退订、能天天推的东西');
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
