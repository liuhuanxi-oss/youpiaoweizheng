// tests/store_cache.test.js —— 票根列表缓存：切 tab 不再每次重打云库（7.4.2）
// ============================================================
// 为什么单独钉这一条：
//   utils/store.js 的 listTickets 是「1 次 count + 最多 25 次分批 get」，而四个 tab 页
//   （首页 / 时光机 / 回忆地图 / 我的）的 onShow 都无条件调它 —— 来回切 tab 每次重走
//   一遍云往返，等的是同一份数据。
//   加缓存容易，**漏掉一个写路径**才是要命的地方：传完票没置脏 → 切回首页看不见刚传的票，
//   用户会以为票丢了。所以这里真跑 store.js（假 wx / 假 require / 可拨动的时钟一起注入），
//   把三个写操作逐个按一遍「必须重新打云」，再钉住失败路径不吃旧缓存。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 从原文取：decomment 会把注释里的标点截断，行为断言一律跑原文
const raw = fs.readFileSync(path.join(ROOT, 'utils/store.js'), 'utf8');
const scan = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const RealDate = Date;

/**
 * 造一份「真的 store.js」：把 wx / require / Date 全换成假的，真跑里面的函数。
 * clock 可拨动 —— 30 秒 TTL 到期与否，测试里说了算（不用真等半分钟）。
 */
function makeStore(opt) {
  const o = opt || {};
  const state = {
    rows: o.rows || [{ _id: 'real_ticket_1', title: '票A', date: '2024-01-01' }],
    fail: false,
    cloudGets: 0, // 云库 .get() 次数：判断「有没有真的打云」就看它
    // 7.4.3：删除流程要先读一次拿 img、再连照片一起删，桩得记下这两件事
    img: o.img === undefined ? 'cloud://env.abc/real_ticket_1.jpg' : o.img,
    docRemoves: 0,
    deleted: [],
    deleteFail: !!o.deleteFail,
    storage: {}
  };
  const clock = { now: RealDate.now() };
  function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(clock.now); }
  FakeDate.now = () => clock.now;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;

  // 只实现这条链路用到的查询形态：count / orderBy / skip / limit / get / doc().remove
  const chain = {
    count: async () => {
      if (state.fail) throw new Error('db down');
      return { total: state.rows.length };
    },
    orderBy() { return chain; },
    skip() { return chain; },
    limit() { return chain; },
    get: async () => {
      state.cloudGets++;
      if (state.fail) throw new Error('db down');
      return { data: state.rows.map((r) => ({ ...r })) };
    },
    doc: () => ({
      get: async () => ({ data: { _id: 'real_ticket_1', img: state.img } }),
      remove: async () => { state.docRemoves++; return { stats: { removed: 1 } }; }
    })
  };

  const wx = {
    cloud: {
      database: () => ({ collection: () => chain }),
      callFunction: async () => ({ result: { ok: true, _id: 'real_ticket_new' } }),
      deleteFile: async (o) => {
        if (state.deleteFail) throw new Error('storage down');
        state.deleted = state.deleted.concat(o.fileList || []);
        return { fileList: [] };
      }
    },
    getStorageSync: (k) => state.storage[k],
    setStorageSync: (k, v) => { state.storage[k] = v; }
  };
  const fakeRequire = (p) => {
    if (p === './env.js') return { USE_CLOUD: true };
    if (p === './mock.js') return { tickets: [], MOCK_IDS: [] };
    throw new Error('测试没给这个依赖搭桩：' + p);
  };
  const mod = {};
  new Function('require', 'wx', 'module', 'Date', raw)(fakeRequire, wx, mod, FakeDate);
  return { store: mod.exports, state, clock };
}

// ════════════════════════════════════════════════════════════
console.log('\n【一、30 秒内复用，不再重走云往返】');

t('连读两次：第二次不打云', async () => {
  const { store, state } = makeStore();
  await store.listTickets();
  const after1 = state.cloudGets;
  ok(after1 > 0, '第一次就没读到云 —— 桩没搭对');
  await store.listTickets();
  ok(state.cloudGets === after1,
    '30 秒内又打了一次云 —— 缓存没生效，切 tab 还是每次等一遍');
});

t('缓存命中的内容就是刚才那份（不是空数组）', async () => {
  const { store } = makeStore();
  const a = await store.listTickets();
  const b = await store.listTickets();
  ok(a.length === 1, '首次读回的条数不对：' + a.length);
  ok(b.length === 1 && b[0].id === 'real_ticket_1', '缓存命中的内容不对');
});

t('过了 30 秒：必须重新打云', async () => {
  const { store, state, clock } = makeStore();
  await store.listTickets();
  const after1 = state.cloudGets;
  clock.now += 31 * 1000;
  await store.listTickets();
  ok(state.cloudGets > after1,
    '过了 30 秒还吃缓存 —— 用户看到的会一直是好几轮之前的那份列表');
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、写操作必须置脏（漏一个 = 用户看不见自己的改动）】');

t('传了新票 → 再读必须重新打云', async () => {
  const { store, state } = makeStore();
  await store.listTickets();
  const after1 = state.cloudGets;
  await store.addTicket({ title: '新票', type: 'movie', date: '2024-02-02' }, 'cloud://x');
  await store.listTickets();
  ok(state.cloudGets > after1,
    '传完票仍吃缓存 —— 切回首页看不见刚传的这张，用户会以为票丢了');
});

t('删了票 → 再读必须重新打云', async () => {
  const { store, state } = makeStore();
  await store.listTickets();
  const after1 = state.cloudGets;
  await store.removeTicket('real_ticket_1');
  await store.listTickets();
  ok(state.cloudGets > after1,
    '删完票仍吃缓存 —— 被删的票还留在墙上，用户以为没删掉');
});

t('改了 AI 文案 → 再读必须重新打云', async () => {
  const { store, state } = makeStore();
  await store.listTickets();
  const after1 = state.cloudGets;
  await store.setCaption('real_ticket_1', '新的文案');
  await store.listTickets();
  ok(state.cloudGets > after1,
    '改完文案仍吃缓存 —— 墙上的摘要是旧的，用户以为没保存上');
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、失败过就不许再吃旧缓存】');

t('云库失败兜底后，下次读必须重新问云', async () => {
  const { store, state, clock } = makeStore();
  await store.listTickets();      // 成功 → 写缓存
  clock.now += 31 * 1000;         // 拨到过期之外，下一次才会真的走到失败路径
  state.fail = true;
  await store.listTickets();      // 失败 → 兜底演示票
  state.fail = false;
  // 把时钟拨回去：要是失败路径没清缓存，这份「31 秒前」的缓存相对现在的时钟又是新鲜的了 ——
  // 被清掉才会重新打云。这一拨是故意让时间倒流来验行为，不是笔误。
  clock.now -= 31 * 1000;
  const before = state.cloudGets;
  await store.listTickets();
  ok(state.cloudGets > before,
    '失败之后还在吃旧缓存 —— 网络已经好了，却继续给人看演示票');
});

// ════════════════════════════════════════════════════════════
console.log('\n【四、删票要连照片一起删（这是承诺，不是优化）】');

t('删票时把记录里的 img 一并从云存储删掉', async () => {
  const { store, state } = makeStore();
  await store.removeTicket('real_ticket_1');
  ok(state.docRemoves === 1, '记录没删掉');
  ok(state.deleted.length === 1 && /real_ticket_1\.jpg$/.test(state.deleted[0]),
    '删票没删照片 —— 用户以为删干净了，照片其实永久留在云存储里（隐私政策写着「删除」）');
});

t('img 不是云文件（空串）时不去删文件', async () => {
  const { store, state } = makeStore({ img: '' });
  await store.removeTicket('real_ticket_1');
  ok(state.docRemoves === 1, '记录没删掉');
  ok(state.deleted.length === 0, '没有云文件却调了删除 —— 拿空 fileID 去删是危险的');
});

t('删文件失败不拖垮删票（孤儿图好过「点了删除弹报错」）', async () => {
  const { store, state } = makeStore({ deleteFail: true });
  let threw = null;
  try { await store.removeTicket('real_ticket_1'); } catch (e) { threw = e; }
  ok(!threw, '删云存储失败把删票也带崩了：' + (threw && threw.message));
  ok(state.docRemoves === 1, '记录没删掉');
});

// ════════════════════════════════════════════════════════════
console.log('\n【五、调用方改返回值，不许污染缓存】');

t('页面若原地改读回的数组，下一次读到的不受影响', async () => {
  const { store } = makeStore();
  const a = await store.listTickets();
  a.push({ id: '被别人塞进来的' });
  const b = await store.listTickets();
  ok(b.length === 1,
    '缓存被调用方改坏了（返回的是同一个数组引用）—— 下一次读到的列表被污染');
});

// ════════════════════════════════════════════════════════════
console.log('\n【六、结构：常量与置脏点写在明面上】');

t('TTL 就是 30 秒', () => {
  const m = /const LIST_TTL = ([^;]+);/.exec(scan);
  ok(m, '找不到 LIST_TTL');
  const v = new Function('return ' + m[1])();
  ok(v === 30000, 'TTL 应为 30000ms，实际 ' + v + '（改它等于改用户看到的东西有多旧）');
});

t('三个写操作入口都调了 bustList', () => {
  ['setCaption', 'addTicket', 'removeTicket'].forEach((f) => {
    const m = new RegExp('function ' + f + '\\s*\\([^)]*\\)\\s*\\{[^}]*?bustList\\(\\)').exec(scan);
    ok(m, f + ' 没置脏 —— 这条写路径之后，用户看不到自己刚做的改动');
  });
});

t('缓存只在成功路径写入，失败路径清空', () => {
  ok(/_listCache = \{ at: Date\.now\(\), rows: out \}/.test(scan), '成功路径没写缓存');
  // 先按标志句把「失败兜底」那个 catch 块切出来，再找里面的 bustList ——
  // 不在整份源码里搜 bustList：写操作入口也有它，那样搜等于什么都没验。
  const m = /catch \(e\) \{[\s\S]{0,300}?_listFallback = true;/.exec(scan);
  ok(m, '找不到失败兜底分支（_listFallback = true），这段结构被改过');
  ok(/bustList\(\)/.test(m[0]), '失败路径没有清缓存 —— 下次会拿旧数据盖过「网络开小差」');
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
