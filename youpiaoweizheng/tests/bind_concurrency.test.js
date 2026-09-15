// tests/bind_concurrency.test.js —— 双人绑定：两个人同时输同一个码（P2-9）
// ============================================================
// 为什么单独钉这一条：
//   旧实现是裸 doc(id).update —— 后写覆盖先写。两个人都收到「绑定成功」，
//   文档里却只留下后一个人：先绑上的那位端上显示已绑定、服务端却查不到他，
//   下一次 query 直接把他打回未绑定态（票根跟着「消失」）。这种错**不报错、
//   不留痕**，只在两个人都以为自己绑上了的时候才显形。
// 所以这里**真跑** bindAction（云函数源码取出来执行 + 内存假库），不扫源码猜。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 从原文取：decomment 会把注释里的正则/边界字符截断，这里一律用原始源码
const raw = fs.readFileSync(path.join(ROOT, 'cloudfunctions/saveTicket/index.js'), 'utf8');
const scan = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const fnOf = (name) => {
  const m = new RegExp('(?:async )?function ' + name + '\\s*\\([\\s\\S]*?\\n\\}').exec(raw);
  if (!m) throw new Error('找不到函数 ' + name);
  return m[0];
};
const constOf = (name) => {
  const m = new RegExp('const ' + name + ' = [^;]+;').exec(raw);
  if (!m) throw new Error('找不到常量 ' + name);
  return m[0];
};

/** 把云函数里的绑定链路整段取出来真跑（cloud 用桩注入） */
function makeBind(cloudStub) {
  const src = [
    constOf('CODE_CHARS'),
    fnOf('ensureCollection'),
    fnOf('failLog'),
    fnOf('makeInviteCode'),
    fnOf('findMyCouple'),
    fnOf('coupleView'),
    fnOf('bindAction')
  ].join('\n') + '\nreturn bindAction;';
  return new Function('cloud', src)(cloudStub);
}

// ════════════════════════════════════════════════════════════
// 内存假库：只实现这条链路用到的查询形态
//   · where 相等匹配（`members: 'openid'` 按 MongoDB 语义 = 数组包含）
//   · 条件更新返回 stats.updated（CAS 的胜负就靠它）
//   · add 撞 _id 报错
// ════════════════════════════════════════════════════════════
//   · 每次读写都让一次路（真 setTimeout）：不同步完成，两个并发请求才会真的交错在
//     「都读到 waiting」和「各自去写」之间 —— 假库要是同步跑完，这条竞态根本撞不上，
//     测试会「绿着骗人」（改回裸写也照样绿）。
const tick = () => new Promise((r) => setTimeout(r, 0));

function fakeDb(seed) {
  const rows = (seed || []).map((r) => Object.assign({}, r));
  let auto = 0;
  const match = (row, where) => Object.keys(where).every((k) => {
    const v = where[k];
    if (Array.isArray(row[k])) return row[k].indexOf(v) >= 0; // members: 数组包含
    return row[k] === v;
  });
  const col = {
    count: async () => { await tick(); return { total: rows.length }; },
    where: (w) => ({
      limit: () => ({
        get: async () => { await tick(); return { data: rows.filter((r) => match(r, w)) }; }
      }),
      update: async ({ data }) => {
        await tick();
        let n = 0;
        rows.forEach((r) => { if (match(r, w)) { Object.assign(r, data); n++; } });
        return { stats: { updated: n } };
      }
    }),
    add: async ({ data }) => {
      await tick();
      const _id = 'c' + (++auto);
      rows.push(Object.assign({ _id }, data));
      return { _id };
    },
    doc: (id) => ({
      get: async () => { await tick(); return { data: rows.find((r) => r._id === id) || null }; },
      update: async ({ data }) => {
        await tick();
        const r = rows.find((x) => x._id === id);
        if (r) Object.assign(r, data);
        return { stats: { updated: r ? 1 : 0 } };
      },
      remove: async () => {
        await tick();
        const i = rows.findIndex((x) => x._id === id);
        if (i >= 0) rows.splice(i, 1);
        return { stats: { removed: 1 } };
      }
    })
  };
  return {
    collection: () => col,
    createCollection: async () => {},
    _rows: () => rows
  };
}
const cloudOf = (db) => ({ database: () => db });

/** 别人已经生成好的一条邀请码（我自己不在里面） */
const WAITING = { _id: 'c1', code: 'ABCD', members: ['openid_owner'], names: { openid_owner: '发起人' }, status: 'waiting', createdAt: Date.now() };

// ════════════════════════════════════════════════════════════
console.log('\n【一、两个人同时输同一个码】');

t('只有一个人绑得上，另一个人拿到「刚被别人用了」', async () => {
  const db = fakeDb([WAITING]);
  const bind = makeBind(cloudOf(db));
  const [a, b] = await Promise.all([
    bind({ mode: 'join', code: 'ABCD', name: '甲' }, 'openid_a'),
    bind({ mode: 'join', code: 'ABCD', name: '乙' }, 'openid_b')
  ]);
  const wins = [a, b].filter((r) => r.ok && r.bound);
  const loses = [a, b].filter((r) => !r.ok);
  ok(wins.length === 1, `两个人都收到「绑定成功」（实际 ${wins.length} 个）—— 后写覆盖先写`);
  ok(loses.length === 1, '没有人收到失败，另一个人被静默吞了');
  ok(/刚被别人用了/.test(loses[0].msg), '失败文案不是「刚被别人用了」：' + loses[0].msg);
  ok(db._rows().length === 1, '凭空多出一条绑定文档');
  ok(db._rows()[0].members.length === 2, '绑定文档里不是两个人：' + JSON.stringify(db._rows()[0].members));
});

t('赢的那一方拿到的是真实文档（不是自己拼的视图）', async () => {
  const db = fakeDb([WAITING]);
  const bind = makeBind(cloudOf(db));
  const r = await bind({ mode: 'join', code: 'ABCD', name: '甲' }, 'openid_a');
  ok(r.ok && r.bound, '正常加入失败：' + JSON.stringify(r));
  ok(r.couple.partnerName === '发起人', '对方昵称没带上：' + r.couple.partnerName);
  ok(r.couple.status === 'bound', '状态没翻成 bound');
  ok(db._rows()[0].status === 'bound', '库里没落成 bound');
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、同一个人连点两下（不是两个人）】');

t('第二次是幂等成功，不是「邀请码不存在」', async () => {
  const db = fakeDb([WAITING]);
  const bind = makeBind(cloudOf(db));
  const [a, b] = await Promise.all([
    bind({ mode: 'join', code: 'ABCD', name: '甲' }, 'openid_a'),
    bind({ mode: 'join', code: 'ABCD', name: '甲' }, 'openid_a')
  ]);
  ok(a.ok && b.ok, '同一个人连点两下被判失败：' + JSON.stringify([a, b]));
  ok(db._rows()[0].members.filter((m) => m === 'openid_a').length === 1, '同一个人被写进了两次');
});

t('已经绑好的人再输一次自己的码 → 幂等成功', async () => {
  const db = fakeDb([{ _id: 'c1', code: 'ABCD', members: ['openid_owner', 'openid_a'], names: {}, status: 'bound', createdAt: Date.now() }]);
  const bind = makeBind(cloudOf(db));
  const r = await bind({ mode: 'join', code: 'ABCD', name: '甲' }, 'openid_a');
  ok(r.ok && r.bound, '重进页面再输一次自己的码被判失败：' + JSON.stringify(r));
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、自己那条等人的码：加入别人后必须作废】');

const MINE_WAITING = { _id: 'c0', code: 'MINE', members: ['openid_a'], names: { openid_a: '我' }, status: 'waiting', createdAt: Date.now() };

t('加入成功 → 自己那条 waiting 码被删掉，并明确告诉端上', async () => {
  const db = fakeDb([MINE_WAITING, WAITING]);
  const bind = makeBind(cloudOf(db));
  const r = await bind({ mode: 'join', code: 'ABCD', name: '甲' }, 'openid_a');
  ok(r.ok && r.bound, '正常加入失败：' + JSON.stringify(r));
  ok(db._rows().length === 1, `我还同时躺在 ${db._rows().length} 份关系里 —— 到底和谁绑着变成随机的`);
  ok(db._rows()[0].code === 'ABCD', '留下的不是刚刚加入的那一份');
  ok(r.canceledCode === 'MINE', '没告诉端上「你原来那条码已作废」：' + r.canceledCode);
});

t('加入失败（码不存在）→ 自己那条码必须原样留着', async () => {
  const db = fakeDb([MINE_WAITING]);
  const bind = makeBind(cloudOf(db));
  const r = await bind({ mode: 'join', code: 'ZZZZ', name: '甲' }, 'openid_a');
  ok(!r.ok, '不存在的码居然绑上了');
  ok(db._rows().length === 1 && db._rows()[0].code === 'MINE',
    '加入失败却把自己的码删了 —— 用户两手空空');
});

t('作废在绑定成功之后（顺序反了会有「码没了、也没绑上」的窗口）', () => {
  const iClaim = scan.indexOf("if (!claim || !claim.stats || !claim.stats.updated)");
  const iRemove = scan.indexOf("db.collection('couples').doc(mine._id).remove()");
  ok(iClaim > 0 && iRemove > iClaim, '作废自己那条码发生在抢占成功之前');
});

// ════════════════════════════════════════════════════════════
console.log('\n【四、其余路径没被这次改动带偏】');

t('码不存在 → 原话不变', async () => {
  const db = fakeDb([]);
  const bind = makeBind(cloudOf(db));
  const r = await bind({ mode: 'join', code: 'ZZZZ', name: '甲' }, 'openid_a');
  ok(!r.ok && /邀请码不存在或已被使用/.test(r.msg), '文案变了：' + r.msg);
});

t('自己已经有绑定 → 提示先解绑（不会覆盖成新的）', async () => {
  const db = fakeDb([
    { _id: 'c9', code: 'WXYZ', members: ['openid_a', 'openid_x'], names: {}, status: 'bound', createdAt: Date.now() },
    WAITING
  ]);
  const bind = makeBind(cloudOf(db));
  const r = await bind({ mode: 'join', code: 'ABCD', name: '甲' }, 'openid_a');
  ok(!r.ok && /先解绑/.test(r.msg), '文案或行为变了：' + JSON.stringify(r));
});

t('生成邀请码这条路照旧（我已有 waiting 码就复用，不新开一条）', async () => {
  const db = fakeDb([{ _id: 'c1', code: 'ABCD', members: ['openid_a'], names: {}, status: 'waiting', createdAt: Date.now() }]);
  const bind = makeBind(cloudOf(db));
  const r = await bind({ mode: 'create', name: '甲' }, 'openid_a');
  ok(r.ok && r.code === 'ABCD', '没有复用已有的码：' + JSON.stringify(r));
  ok(db._rows().length === 1, '又多建了一条等待中的码');
});

// ════════════════════════════════════════════════════════════
console.log('\n【五、结构：别再退回裸 doc().update】');

t('绑定写入走条件更新（waiting → bound 只能成一次）', () => {
  ok(/where\(\{ _id: doc\._id, status: 'waiting' \}\)\s*\n?\s*\.update\(\{ data: next \}\)/.test(scan),
    '绑定又变成裸 doc(id).update —— 并发下会后写覆盖先写');
  ok(/const claim = await db\.collection\('couples'\)/.test(scan), '找不到抢占结果，没人判断胜负');
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
