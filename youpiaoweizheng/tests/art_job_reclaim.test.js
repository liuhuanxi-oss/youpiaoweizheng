// tests/art_job_reclaim.test.js —— 图版卡死回收（P1-11）
// ============================================================
// 为什么这条必须有守卫：
//   生图在云函数里同步跑，云函数最长 60 秒。执行被杀掉时，写 done / 写 failed /
//   退额度这三步一步都不会发生 —— job 永远停在 running，用户**白扣一次次数**，
//   而且那张票再也画不出来（防重入看到 running 就返回 queued）。
//   这个 bug 不报错、不留痕：只有用户自己发现「次数少了一次、图没有」。
// 这里**真跑** artQueryAction（源码取出来执行 + 内存假库 + 额度桩），
// 验的就是：轮到僵尸 job 时会不会当场收掉、退额度、且**只退一次**。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 从原文取（decomment 会截断正则字面量，见 cloud_hardening 里的同一个坑）
const raw = fs.readFileSync(path.join(ROOT, 'cloudfunctions/saveTicket/index.js'), 'utf8');
const scan = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const paySrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/saveTicket/pay.js'), 'utf8');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const fnOf = (name, src) => {
  const m = new RegExp('(?:async )?function ' + name + '\\s*\\([\\s\\S]*?\\n\\}').exec(src === undefined ? raw : src);
  if (!m) throw new Error('找不到函数 ' + name);
  return m[0];
};
const constOf = (name) => {
  const m = new RegExp('const ' + name + ' = [^;]+;').exec(raw);
  if (!m) throw new Error('找不到常量 ' + name);
  return m[0];
};

// 注意别写成 /(\d+)/ —— 那只会取到 "3"（3 * 60 * 1000 的第一段），
// 于是「僵尸」样本其实才 1 秒大，回收不触发、测试还会绿着骗人
const STALE_MS = new Function('return ' + /const ART_JOB_STALE_MS = ([^;]+);/.exec(raw)[1])();

/** 把轮询链路整段取出来真跑（cloud 与 pay 都用桩注入） */
function makeQuery(cloudStub, payStub) {
  const src = [
    constOf('ART_JOB_STALE_MS'),
    constOf('ART_JOB_STALE_MSG'),
    fnOf('ensureCollection'),
    fnOf('failLog'),
    fnOf('reclaimStaleJob'),
    fnOf('artQueryAction')
  ].join('\n') + '\nreturn { artQueryAction, reclaimStaleJob };';
  return new Function('cloud', 'pay', src)(cloudStub, payStub);
}

// ════════════════════════════════════════════════════════════
// 内存假库：prefs 集合 + 条件更新（stats.updated 就是回收权的胜负）
// 每次读写都让一次路（真 setTimeout）——不然并发轮询在假库里是串行的，
// 「只退一次」会绿着骗人。
const tick = () => new Promise((r) => setTimeout(r, 0));

function fakeDb(jobs) {
  const rows = jobs.map((r) => Object.assign({}, r));
  const cmd = { lt: (n) => ({ __op: 'lt', n }) };
  const match = (row, where) => Object.keys(where).every((k) => {
    const v = where[k];
    if (v && v.__op === 'lt') return Number(row[k] || 0) < v.n;
    return row[k] === v;
  });
  let order = null;
  const col = {
    count: async () => { await tick(); return { total: rows.length }; },
    where: (w) => {
      const api = {
        orderBy: (k, d) => { order = { k, d }; return api; },
        limit: () => ({
          get: async () => {
            await tick();
            let out = rows.filter((r) => match(r, w));
            if (order) {
              const { k, d } = order;
              out = out.slice().sort((a, b) => (d === 'desc' ? (b[k] || 0) - (a[k] || 0) : (a[k] || 0) - (b[k] || 0)));
            }
            return { data: out };
          }
        }),
        update: async ({ data }) => {
          await tick();
          let n = 0;
          rows.forEach((r) => { if (match(r, w)) { Object.assign(r, data); n++; } });
          return { stats: { updated: n } };
        }
      };
      return api;
    }
  };
  return { command: cmd, collection: () => col, createCollection: async () => {}, _rows: () => rows };
}

/** 记下每次退款（退的哪个池） */
function fakePay() {
  const refunds = [];
  return {
    refundQuota: async (db, openid, pool) => { refunds.push({ openid, pool }); },
    _refunds: () => refunds
  };
}

const NOW = Date.now();
const jobOf = (over) => Object.assign({
  _id: 'j1', _openid: 'openid_a', type: 'art_job', ticketId: 't1',
  status: 'running', pool: 'free', createdAt: NOW, updatedAt: NOW
}, over || {});

const setup = (jobs) => {
  const db = fakeDb(jobs);
  const pay = fakePay();
  const api = makeQuery({ database: () => db }, pay);
  return { db, pay, ...api };
};

// ════════════════════════════════════════════════════════════
console.log('\n【一、什么时候算僵尸】');

t('刚起的任务（还没到 3 分钟）→ 照常回 running，不回收、不退额度', async () => {
  const { artQueryAction, pay } = setup([jobOf({ updatedAt: Date.now() })]);
  const r = await artQueryAction({ ticketId: 't1' }, 'openid_a');
  ok(r.status === 'running', '活着的任务被误判成失败：' + JSON.stringify(r));
  ok(pay._refunds().length === 0, '活着的任务被退了额度（会变成白送一次）');
});

t('超过 3 分钟没动静 → 当场判失败，并把额度退回去', async () => {
  const { artQueryAction, pay } = setup([jobOf({ updatedAt: Date.now() - STALE_MS - 1000 })]);
  const r = await artQueryAction({ ticketId: 't1' }, 'openid_a');
  ok(r.status === 'failed', '僵尸任务没被收掉，前端会一直转到 160 秒：' + JSON.stringify(r));
  ok(/次数已退回/.test(r.msg), '没说清次数退回来了：' + r.msg);
  ok(pay._refunds().length === 1, `退款次数不对：${pay._refunds().length}（应该是 1）`);
});

t('退的是当初扣的那个池（这里扣的是次数包，就退次数包）', async () => {
  const { artQueryAction, pay } = setup([jobOf({ pool: 'paid', updatedAt: Date.now() - STALE_MS - 1000 })]);
  await artQueryAction({ ticketId: 't1' }, 'openid_a');
  ok(pay._refunds()[0] && pay._refunds()[0].pool === 'paid',
    '退错池了：' + JSON.stringify(pay._refunds()[0]) + '（免费扣的退免费、次数包扣的退次数包）');
});

t('这次改动之前留下的老任务（没有池的标记）也能退', async () => {
  const j = jobOf({ updatedAt: Date.now() - STALE_MS - 1000 });
  delete j.pool;
  const { artQueryAction, pay } = setup([j]);
  await artQueryAction({ ticketId: 't1' }, 'openid_a');
  ok(pay._refunds().length === 1, '老任务退不了 —— 用户只能自认倒霉');
  ok(pay._refunds()[0].pool === undefined, '老任务不该瞎猜一个池');
});

t('已经画好的任务不会被回收', async () => {
  const { artQueryAction, pay } = setup([jobOf({ status: 'done', fileID: 'cloud://x.y/a.png', updatedAt: Date.now() - 9999999 })]);
  const r = await artQueryAction({ ticketId: 't1' }, 'openid_a');
  ok(r.status === 'done' && r.fileID === 'cloud://x.y/a.png', '画好的图被回收了：' + JSON.stringify(r));
  ok(pay._refunds().length === 0, '画好的任务把额度退了（用户白得一次）');
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、多个入口一起回收时，只能退一次】');

t('两次轮询同时撞上同一个僵尸任务 → 只退一次', async () => {
  const { artQueryAction, pay } = setup([jobOf({ updatedAt: Date.now() - STALE_MS - 1000 })]);
  const rs = await Promise.all([
    artQueryAction({ ticketId: 't1' }, 'openid_a'),
    artQueryAction({ ticketId: 't1' }, 'openid_a')
  ]);
  ok(rs.every((r) => r.status === 'failed'), '有人拿到了别的状态：' + JSON.stringify(rs));
  ok(pay._refunds().length === 1, `退了 ${pay._refunds().length} 次 —— 并发轮询会把额度重复退回`);
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、重绘入口也要放行（这张票不能判无期）】');

t('点「再画一次」时先收僵尸任务，而不是拿 running 挡人', () => {
  ok(/reclaimStaleJob\(db, OPENID, pend\.data\[0\]\)/.test(scan),
    '重绘入口没有回收僵尸任务 —— 卡住的那张票再也画不出来');
  const iReclaim = scan.indexOf('reclaimStaleJob(db, OPENID, pend.data[0])');
  const iQueued = scan.indexOf('queued: true, jobId: pend.data[0]._id', iReclaim - 200);
  ok(iReclaim > 0 && iQueued > iReclaim, '回收结果没被用来决定是否放行');
});

t('轮询入口接的是回收结果（不是自己另写一套判断）', () => {
  ok(/j\.status === 'running' && await reclaimStaleJob\(db, OPENID, j\)/.test(scan),
    '轮询没接回收逻辑');
});

t('生成成功回写走条件更新：已被判定作废的任务，迟到的图不能覆盖成成功', () => {
  ok(/jobs\.where\(\{ _id: job\._id, status: 'running' \}\)\s*\n\s*\.update\(\{ data: \{ status: 'done'/.test(scan),
    '成功回写又变成裸写 —— 用户可能既拿到图、又拿回次数');
  ok(!/jobs\.doc\(job\._id\)\.update\(\{ data: \{ status: 'done'/.test(scan), '还留着裸写的成功回写');
});

t('回收失败要留日志（额度退不回去得有人查）', () => {
  ok(/refundQuota\(db, OPENID, job\.pool\)\.catch/.test(scan), '退款失败被静默吞了');
  ok(/\[artReclaim\] refundQuota 失败/.test(scan), '退款失败没有可检索的日志标记');
});

// ════════════════════════════════════════════════════════════
console.log('\n【四、退款的池口径与 pay.js 对得上】');

t('记档用的池名与 refundQuota 认的池名是同一套', () => {
  // 扣额度时返回的 pool 在 pay.js 里定值，回收时原样透传给 refundQuota ——
  // 两边字面量对不上，退的就不是同一本账（免费扣的退进了次数包）
  const pools = (paySrc.match(/pool: '(free|paid)'/g) || []).map((s) => s.slice(7, -1));
  ok(pools.indexOf('free') >= 0 && pools.indexOf('paid') >= 0, 'pay.js 里的池名变了：' + pools.join(','));
  ok(/if \(pool === 'free' \|\| pool === 'paid'\)/.test(paySrc), 'refundQuota 的池口径与扣额度那边对不上');
  ok(/pool: spend\.pool/.test(scan), 'job 上没有把这次扣的池记下来');
  ok(/refundQuota\(db, OPENID, job\.pool\)/.test(scan), '回收时没有按记下的池退');
});

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
