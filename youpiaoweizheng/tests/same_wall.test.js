// tests/same_wall.test.js —— 同场票根墙（8.1.0）隐私面回归
// ============================================================
// 为什么这一套必须单独存在、而且必须「真跑」：
//   票根墙是全项目**唯一一个陌生人可读的出口**。别的接口出错用户看得见（页面空、按钮没反应），
//   这里出错是**没有任何界面表现**的：谁也没发现，但某个人的座位号已经躺在别人手机上了。
//   所以隐私面不能靠「我读过代码，field() 里写对了」——要把云函数里的 wallListAction 取出来
//   真跑一遍，给假库塞一张**带全套敏感字段**的票，然后断言出口里一个都不在。
//
// 假库这里**故意不做 field() 投影**（真库会做）：真库替我们挡住了，就测不出代码自己挡没挡。
// 这一层挡住 = 以后谁把 field() 改坏，仍然不会泄露。
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

const raw = read('cloudfunctions/saveTicket/index.js');
const scan = decomment(raw);

const fnOf = (name, src) => {
  const m = new RegExp('(?:async )?function ' + name + '\\s*\\([\\s\\S]*?\\n\\}').exec(src === undefined ? raw : src);
  ok(m, '找不到函数 ' + name);
  return m[0];
};
const constOf = (name) => {
  const m = new RegExp('const ' + name + ' = [^;]+;').exec(raw);
  ok(m, '找不到常量 ' + name);
  return m[0];
};

/** 把两个 action 取出来真跑：cloud / secGate / failLog 全部注入（secGate 记调用） */
function build(opts) {
  const o = opts || {};
  const calls = { sec: [], updated: [] };
  const secGate = async (openid, content, what) => {
    calls.sec.push({ openid, content, what });
    return o.secPass === false ? { ok: false, msg: (what || '内容') + '未通过安全检查' } : { ok: true };
  };
  const cloud = { database: () => fakeDb(o.rows || [], calls, o.project) };
  const failLog = (tag, e, msg) => { calls.failTag = tag; return { ok: false, msg }; };
  const src = constOf('CLOUD_FILEID_RE') + '\n' + constOf('WALL_MAX') + '\n'
    + fnOf('wallJoinAction') + '\n' + fnOf('wallListAction')
    + '\nreturn { wallJoinAction, wallListAction };';
  const fns = new Function('cloud', 'secGate', 'failLog', src)(cloud, secGate, failLog);
  return { fns, calls };
}

/**
 * 内存假库：只实现这两处用到的查询形态。
 * project=false（默认）时**不模拟 field() 投影** —— 见文件头说明。
 */
function fakeDb(rows, calls, project) {
  const match = (row, where) => Object.keys(where).every((k) => row[k] === where[k]);
  const hits = (w) => rows.filter((r) => match(r, w));
  return {
    collection: () => ({
      where: (w) => ({
        get: async () => ({ data: hits(w) }),
        update: async ({ data }) => {
          const hit = hits(w);
          hit.forEach((r) => { Object.assign(r, data); calls.updated.push({ id: r._id, ...data }); });
          return { stats: { updated: hit.length } };
        },
        field: (f) => ({
          limit: (n) => ({
            get: async () => {
              const list = hits(w).slice(0, n);
              // 真库只把 field() 点名的列带回来；假库默认带全字段（故意）
              return { data: project ? list.map((r) => pick(r, f)) : list };
            }
          })
        })
      })
    })
  };
}
const pick = (row, f) => Object.keys(f).reduce((o, k) => (o[k] = row[k], o), {});

/** 一张「什么都有」的票：敏感字段全塞满，用来看出口漏不漏 */
const PRIVATE = {
  _id: 'ticket_abc123',
  _openid: 'openid_of_someone',
  eventKey: 'evt_wuhan_vox_20251026',
  wallPublic: true,
  title: '回春丹巡演 · 武汉站',
  venue: 'VOX Livehouse',
  date: '2025-10-26',
  time: '20:00',
  city: '武汉',
  seat: 'A区 12排 07座',
  price: 380,
  source: '大麦',
  note: '和黄一起去的，她哭了三次',
  geo: { lat: 30.5928, lng: 114.3055 },
  img: 'cloud://cloud1-x.y/tickets/a.jpg',
  aiCaption: '那天武汉下了整夜的雨',
  weather: { tempC: 18 },
  createdAt: 1761480000000,
  sortAt: 9
};

// ════════════════════════════════════════════════════════════
console.log('\n【一、出口脱敏：陌生人可读的每一行只能是四个字段（真跑）】');

t('一张「什么都有」的票 → 出口里找不到 openid / 座位 / 票价 / 坐标 / 手记', async () => {
  const { fns } = build({ rows: [Object.assign({}, PRIVATE)] });
  const r = await fns.wallListAction({ eventKey: PRIVATE.eventKey });
  ok(r.ok === true, '拉取失败：' + r.msg);
  ok(r.items.length === 1, '这场公开的票没被取出来');
  const row = r.items[0];
  ['_openid', '_id', 'seat', 'price', 'geo', 'note', 'source', 'city', 'time',
    'aiCaption', 'weather', 'createdAt', 'sortAt', 'eventKey', 'wallPublic', 'wallAt']
    .forEach((k) => ok(row[k] === undefined, '出口漏了 ' + k + ' —— 陌生人能看到这一项'));
  const keys = Object.keys(row).sort().join(',');
  ok(keys === 'date,img,title,venue', '出口字段多出来了：' + keys + '（只许 票名/场馆/日期/图）');
});

t('没有 _id —— card 页支持按 id 取票，漏 id 等于白送一条读别人整张票的旁路', async () => {
  const { fns } = build({ rows: [Object.assign({}, PRIVATE)] });
  const r = await fns.wallListAction({ eventKey: PRIVATE.eventKey });
  ok(JSON.stringify(r).indexOf('ticket_abc123') < 0, '返回体里出现了票根 _id');
  ok(JSON.stringify(r).indexOf('openid_of_someone') < 0, '返回体里出现了 openid');
});

t('就算 field() 被人改坏，出口照样只剩四个字段（假库故意不做投影也拦得住）', async () => {
  const wide = Object.assign({}, PRIVATE, { evilExtra: '不该出现', _openid: 'o2' });
  const { fns } = build({ rows: [wide], project: false });
  const r = await fns.wallListAction({ eventKey: PRIVATE.eventKey });
  ok(r.items[0].evilExtra === undefined, 'field() 之外多取的字段被原样回出去了');
});

t('非本环境云存储的图片地址 → 回空串（外链不能经我们的出口发出去）', async () => {
  const rows = [
    Object.assign({}, PRIVATE, { _id: 'a', img: 'https://evil.example.com/a.jpg' }),
    Object.assign({}, PRIVATE, { _id: 'b', img: 'data:image/png;base64,iVBORw0KGgo=' }),
    Object.assign({}, PRIVATE, { _id: 'c', img: 'cloud://cloud1-x.y/tickets/ok.jpg' })
  ];
  const { fns } = build({ rows });
  const r = await fns.wallListAction({ eventKey: PRIVATE.eventKey });
  ok(r.items[0].img === '' && r.items[1].img === '', '外部图地址被放出去了');
  ok(r.items[2].img === 'cloud://cloud1-x.y/tickets/ok.jpg', '正常云存储图被误伤');
});

t('只出「本人点过公开」的票：别人私藏的票不会被顺手带出去', async () => {
  const rows = [
    Object.assign({}, PRIVATE, { _id: 'a', wallPublic: true, title: '公开的' }),
    Object.assign({}, PRIVATE, { _id: 'b', wallPublic: false, title: '没公开的' }),
    Object.assign({}, PRIVATE, { _id: 'c', wallPublic: undefined, title: '从没选过的' }),
    Object.assign({}, PRIVATE, { _id: 'd', wallPublic: true, title: '别的场次', eventKey: 'evt_other' })
  ];
  const { fns } = build({ rows });
  const r = await fns.wallListAction({ eventKey: PRIVATE.eventKey });
  ok(r.items.length === 1 && r.items[0].title === '公开的',
    '这场返回了 ' + r.items.length + ' 张：' + r.items.map((x) => x.title).join('、'));
});

t('没有场次键 → 直接拒绝，不能变成「把全库公开票都给我」的旁路', async () => {
  const { fns } = build({ rows: [Object.assign({}, PRIVATE)] });
  for (const bad of ['', undefined, null]) {
    const r = await fns.wallListAction({ eventKey: bad });
    ok(r.ok === false, '空场次键居然返回了数据');
    ok(!r.items, '拒绝时还带回了票根');
  }
});

t('单面墙有上限（再多没人翻，也省流量）', async () => {
  const rows = [];
  for (let i = 0; i < 200; i++) rows.push(Object.assign({}, PRIVATE, { _id: 'x' + i }));
  const { fns } = build({ rows });
  const r = await fns.wallListAction({ eventKey: PRIVATE.eventKey });
  ok(r.items.length === r.max && r.max <= 100, '上限不对：' + r.items.length + '/' + r.max);
});

t('库出问题 → 人话 + 只落日志（不把 SDK 报错回给用户）', async () => {
  const { fns, calls } = build({ rows: [] });
  const r = await fns.wallListAction({ eventKey: 'k' });
  ok(r.ok === true, '空墙不是错误态');
  const boom = new Function('cloud', 'secGate', 'failLog',
    constOf('CLOUD_FILEID_RE') + '\n' + constOf('WALL_MAX') + '\n' + fnOf('wallListAction')
    + '\nreturn wallListAction;')(
    { database: () => { throw new Error('db down: tickets collection'); } },
    async () => ({ ok: true }),
    (tag, e, msg) => { calls.failTag = tag; return { ok: false, msg }; }
  );
  const bad = await boom({ eventKey: 'k' });
  ok(bad.ok === false && /[^a-z]/.test(bad.msg), '没回人话');
  ok(!/db down|collection|Error/i.test(bad.msg), '把内部报错回给前端了：' + bad.msg);
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、上墙只能改自己的票，且必须过安检（真跑）】');

t('别人的票改不动：归属写进 where，命中 0 条就报错', async () => {
  const rows = [Object.assign({}, PRIVATE, { _openid: 'openid_of_someone', wallPublic: false })];
  const { fns, calls } = build({ rows });
  const r = await fns.wallJoinAction({ id: PRIVATE._id, on: true }, 'openid_me');
  ok(r.ok === false, '把别人的票挂上墙了');
  ok(calls.updated.length === 0, '别人的文档被写了一次');
});

t('自己没有的票 id → 报错，不泄露「这张票存不存在」以外的信息', async () => {
  const { fns } = build({ rows: [] });
  const r = await fns.wallJoinAction({ id: 'nothing_here', on: true }, 'openid_me');
  ok(r.ok === false && !!r.msg, '不存在的票居然成功了');
});

t('没登录（没有 OPENID）→ 拒绝', async () => {
  const { fns, calls } = build({ rows: [Object.assign({}, PRIVATE, { _openid: 'me' })] });
  const r = await fns.wallJoinAction({ id: PRIVATE._id, on: true }, '');
  ok(r.ok === false, '没身份也能上墙');
  ok(calls.updated.length === 0, '没身份却写了库');
});

t('上墙前重新过一遍内容安全：票面文字被判违规 → 上不了墙，也不写库', async () => {
  const rows = [Object.assign({}, PRIVATE, { _openid: 'me', wallPublic: false })];
  const { fns, calls } = build({ rows, secPass: false });
  const r = await fns.wallJoinAction({ id: PRIVATE._id, on: true }, 'me');
  ok(r.ok === false && /安全检查/.test(r.msg), '违规票面被挂了上去：' + r.msg);
  ok(calls.sec.length === 1, '上墙没有走安检 —— 入库那次可能很久以前，甚至当年是服务异常放行的');
  ok(calls.updated.length === 0, '安检没过却写了库');
});

t('撤下永远能成功：安检挡的是「给陌生人看」，不是「不给人看」', async () => {
  const rows = [Object.assign({}, PRIVATE, { _openid: 'me', wallPublic: true })];
  const { fns, calls } = build({ rows, secPass: false });
  const r = await fns.wallJoinAction({ id: PRIVATE._id, on: false }, 'me');
  ok(r.ok === true, '想撤下却撤不掉 —— 内容后来被判违规的用户就被永久钉在墙上了');
  ok(calls.sec.length === 0, '撤下还去调了安检（平白多一次失败机会）');
  ok(calls.updated[0] && calls.updated[0].wallPublic === false, '没真的写下去');
});

t('退出过同场印记的票（没有场次键）→ 上不了墙，并说清原因', async () => {
  const rows = [Object.assign({}, PRIVATE, { _openid: 'me', eventKey: '', wallPublic: false })];
  const { fns, calls } = build({ rows });
  const r = await fns.wallJoinAction({ id: PRIVATE._id, on: true }, 'me');
  ok(r.ok === false && !!r.msg, '没有场次的票被挂上墙了');
  ok(calls.updated.length === 0, '不该写库');
});

t('上墙/撤下都记了时间（撤下清零，便于后台核对「什么时候放上去的」）', async () => {
  const rows = [Object.assign({}, PRIVATE, { _openid: 'me', wallPublic: false })];
  const { fns, calls } = build({ rows });
  await fns.wallJoinAction({ id: PRIVATE._id, on: true }, 'me');
  ok(calls.updated[0].wallAt > 0, '上墙没记时间');
  await fns.wallJoinAction({ id: PRIVATE._id, on: false }, 'me');
  ok(calls.updated[1].wallAt === 0, '撤下没清时间');
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、端上塞不进墙（真跑 sanitizeTicket）】');

const sanitize = new Function(
  constOf('CLOUD_FILEID_RE') + '\n' + constOf('TICKET_TEXT_MAX') + '\n' + fnOf('sanitizeTicket')
  + '\nreturn sanitizeTicket;'
)();

t('wallPublic / wallAt 不在入库白名单里 —— 唯一上墙的路是 wallJoin', () => {
  const out = sanitize({ title: '票', wallPublic: true, wallAt: Date.now(), eventKey: 'evt_伪造' });
  ok(out.wallPublic === undefined, '端上能在入库时把票偷偷塞上墙');
  ok(out.wallAt === undefined, '端上能自己写墙上的时间');
  ok(out.eventKey === undefined, '场次键也必须是服务端算的（否则可以伪造别人的场次）');
});

t('两个 action 走在入库主流程之前（不会先被 sanitize/配额挡一道）', () => {
  const iJoin = scan.indexOf("event.action === 'wallJoin'");
  const iList = scan.indexOf("event.action === 'wallList'");
  const iSan = scan.indexOf('const t = sanitizeTicket(event.ticket);');
  ok(iJoin > 0 && iList > 0 && iSan > 0, '找不到路由');
  ok(iJoin < iSan && iList < iSan, '两个 action 排在入库之后了');
  ok(/return wallJoinAction\(event, OPENID\);/.test(scan), 'wallJoin 没把调用者身份传下去');
  ok(!/wallJoinAction\(event\)/.test(scan), 'wallJoin 丢了 OPENID —— 归属校验就没了');
});

t('拉取不要求登录（分享出去的人没登录也要能看见这面墙）', () => {
  ok(/if \(event\.action === 'wallList'\)/.test(scan), '找不到 wallList 路由');
  ok(/function wallListAction\(event\)/.test(scan), 'wallListAction 不该依赖 OPENID');
});

// ════════════════════════════════════════════════════════════
console.log('\n【四、页面侧：默认关、随时能撤、别把身份画出来】');

t('详情页开关初值取票根本身，没有这个字段 = 关（老票根一张都不会自己上墙）', () => {
  const js = read('pages/detail/detail.js');
  ok(/wallOn: !!raw\.wallPublic/.test(js), '开关没了初值 —— 老票根可能被判成已公开');
  ok(/wallOn: false/.test(js), 'data 里没有默认值');
});

t('开关失败要退回去：界面上的状态不能和服务端不一致', () => {
  const js = read('pages/detail/detail.js');
  ok(/this\.setData\(\{ wallOn: !on \}\)/.test(js), '保存失败后开关还停在用户拨过去的位置');
});

t('墙页不画身份：模板里没有 _id / _openid / 座位 / 票价', () => {
  const wxml = read('pages/wall/wall.wxml');
  ['_id', '_openid', 'openid', 'seat', 'price', 'geo', 'note'].forEach((k) => {
    ok(wxml.indexOf(k) < 0, '墙页模板里出现了 ' + k);
  });
  ok(/wx:key="k"/.test(wxml), 'wx:key 用了行里的字段 —— 服务端刻意不给 id，只能用自增键');
});

t('墙页有下拉刷新（这是一面会变的墙，不是静态页）', () => {
  const json = JSON.parse(read('pages/wall/wall.json'));
  ok(json.enablePullDownRefresh === true, 'json 没开下拉');
  const js = read('pages/wall/wall.js');
  ok(/onPullDownRefresh\(\)/.test(js) && /stopPullDownRefresh/.test(js), '没写 onPullDownRefresh 或忘了收');
});

t('分享出去的路径带着场次（收到的人看到的是同一面墙，不是首页）', () => {
  const js = read('pages/wall/wall.js');
  ok(/path: '\/pages\/wall\/wall\?eventKey='/.test(js), '分享路径丢了场次参数');
});

t('墙页有入口（孤立页 = 死页）', () => {
  const js = read('pages/detail/detail.js');
  ok(/\/pages\/wall\/wall\?eventKey=/.test(js), '详情页没有进墙的入口');
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
