// tests/track_cloud.test.js —— 8.1.3 埋点落云通道
// ============================================================
// 【这套测的是什么】埋点的**第三条通道**：本地环形缓冲被批量送到云端 trackBatch。
//
// 为什么这值得一套测试：
//   ① 它同时握着两个身份 —— 既是「自查兜底」，又是「待发送队列」，而队列的规矩是
//      **服务端认了才删本地**。删早了 = 数据凭空消失（而且没人会发现：埋点本来就静默）；
//      删晚了 = 每次都在重送同一批，事件在库里翻倍。
//   ② 云端那半是**全项目唯一一个「端上想写多少就写多少」的接口**，必须当外部输入校验：
//      单次条数、单日总量、事件名口径、时间戳范围、参数形状 —— 一条放宽都是一个洞。
//   ③ 它绝不能影响业务：云函数挂了、存储满了、参数脏了，用户那边必须毫无感知。
// ============================================================
const path = require('path');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const ROOT = path.resolve(__dirname, '..');
const TRACK_PATH = path.join(ROOT, 'utils/track.js');
const TRACKLOG = require(path.join(ROOT, 'cloudfunctions/saveTicket/tracklog.js'));

// ════════════════════════════════════════════════════════════
// wx 桩（端上那半）
// ════════════════════════════════════════════════════════════
const LS = new Map();
let cloudCalls = [];
let cloudReply = { ok: true, saved: 1 };
let cloudReject = null;
let reported = [];

global.wx = {
  getStorageSync: (k) => (LS.has(k) ? LS.get(k) : ''),
  // 存一份深拷贝：真机的 storage 过一次序列化，测试里也照这个口径来
  setStorageSync: (k, v) => { LS.set(k, JSON.parse(JSON.stringify(v))); },
  removeStorageSync: (k) => { LS.delete(k); },
  reportEvent: (e, d) => { reported.push([e, d]); },
  getAccountInfoSync: () => ({ miniProgram: { version: '8.1.3' } }),
  cloud: {
    callFunction: (o) => {
      cloudCalls.push(o);
      if (cloudReject) return Promise.reject(cloudReject);
      return Promise.resolve({ result: cloudReply });
    }
  }
};

/** 每次取一份**全新的** track 模块：_sending / _lastFlush 是模块级状态，不重载会串味 */
function freshTrack() {
  delete require.cache[require.resolve(TRACK_PATH)];
  return require(TRACK_PATH);
}

function reset() {
  LS.clear();
  cloudCalls = [];
  reported = [];
  cloudReply = { ok: true, saved: 1 };
  cloudReject = null;
}

/** 往本地缓冲里种 n 条事件（模拟用户一路点下来） */
function seed(n, from) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ e: 'share_click', d: { from: 'detail' }, t: Date.now() - (n - i) * 1000 });
  LS.set('sp_track_events', rows);
  return rows;
}
const buffered = () => LS.get('sp_track_events') || [];

/** 云端那个假库：够 tracklog.save 用（prefs 的 where/doc/add + events 的 add） */
function fakeDb(seedDoc) {
  const state = { prefs: seedDoc ? [seedDoc] : [], events: [] };
  const col = (name) => (state[name] || (state[name] = []));
  return {
    _state: state,
    collection(name) {
      const c = col(name);
      return {
        where: (q) => ({
          limit: () => ({
            get: async () => ({ data: c.filter((d) => Object.keys(q).every((k) => d[k] === q[k])) })
          })
        }),
        doc: (id) => ({
          update: async ({ data }) => {
            const d = c.find((x) => x._id === id);
            if (d) Object.assign(d, data);
          }
        }),
        add: async ({ data }) => {
          const rows = Array.isArray(data) ? data : [data];
          rows.forEach((r) => c.push(Object.assign({ _id: 'doc_' + c.length }, r)));
        }
      };
    }
  };
}

// ════════════════════════════════════════════════════════════
console.log('\n【一、队列表现在本地：够一批才送，不是每点一下就发一次云函数】');

(async () => {
t('攒够 30 条自动送一次（不是每点一下就发一次云函数）', async () => {
  reset();
  const track = freshTrack();
  seed(29);
  track.track('share_click', { from: 'detail' }); // 第 30 条 → 触发
  await new Promise((r) => setTimeout(r, 10)); // flush 是 fire-and-forget，给它一拍
  ok(cloudCalls.length === 1, '攒够 30 条没自动送：发了 ' + cloudCalls.length + ' 次');
  ok(cloudCalls[0].data.rows.length === 30, '送的条数不对：' + cloudCalls[0].data.rows.length);
});

t('flush 的 payload：action / rows / ver 三样齐全', async () => {
  reset();
  const track = freshTrack();
  seed(30);
  const n = await track.flush(false);
  ok(cloudCalls.length === 1, '发了 ' + cloudCalls.length + ' 次云函数调用（应该正好 1 次）');
  const d = cloudCalls[0].data;
  ok(d.action === 'trackBatch', 'action 不对：' + d.action);
  ok(Array.isArray(d.rows) && d.rows.length === 30, '送的条数不对：' + (d.rows && d.rows.length));
  ok(d.rows[0].e === 'share_click' && typeof d.rows[0].t === 'number', '行里没有 e/t 这两个必需字段');
  ok(d.ver === '8.1.3', '没带小程序版本号（库里分不了版本）：' + d.ver);
  ok(n === 30, '返回的送出条数不对：' + n);
});

t('服务端认了 → 把送出去的那批从本地删掉，剩下的留着', async () => {
  reset();
  const track = freshTrack();
  seed(80);
  await track.flush(false);
  ok(buffered().length === 30, '送完本地还剩 ' + buffered().length + ' 条（应为 80-50=30）');
  ok(buffered()[0].t > (cloudCalls[0].data.rows[49] || {}).t, '留下的应该是较新的那批（删反了）');
});

t('服务端说没认（ok:false）→ 本地一条都不删，下次重送', async () => {
  reset();
  const track = freshTrack();
  seed(40);
  cloudReply = { ok: false, msg: '埋点落库失败' };
  await track.flush(false);
  ok(buffered().length === 40, '服务端没认却把本地删了 = 数据凭空消失（本地只剩 ' + buffered().length + ' 条）');
});

t('云函数整个挂掉 → 本地不删，而且**不抛错**给调用方', async () => {
  reset();
  const track = freshTrack();
  seed(40);
  cloudReject = new Error('cloud.callFunction:fail timeout');
  let thrown = null;
  try { await track.flush(false); } catch (e) { thrown = e; }
  ok(!thrown, '埋点把异常抛出来了 —— 它在 app.onHide 里跑，一抛就是「用户切个后台报个错」');
  ok(buffered().length === 40, '云函数挂了却把本地删了');
});

t('60 秒内不重复送；force（离开小程序）不受这个限制', async () => {
  reset();
  const track = freshTrack();
  seed(10);
  await track.flush(true);
  ok(cloudCalls.length === 1, 'force 那次没发出去');
  seed(10);
  const n = await track.flush(false); // 刚送过，间隔没到
  ok(n === 0 && cloudCalls.length === 1, '60 秒内又送了一次（频繁切前后台会刷爆云函数）');
  await track.flush(true);
  ok(cloudCalls.length === 2, 'force 没能穿透间隔限制');
});

t('page_view 这类「每次路由都发」的事件不进队列（不落云）', async () => {
  reset();
  const track = freshTrack();
  track.track('page_view', { p: 'pages/home/home' }, { local: false });
  ok(buffered().length === 0, 'page_view 进了本地队列：它一次会话几十条，会把真事件挤出缓冲');
  ok(reported.length === 1, 'reportEvent 那条官方通道反而没发（两条通道是并存不是替换）');
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、云端：端上传来的东西一律当外部输入校验】');

t('事件名口径：不合规的整行丢（大写/连字符/超长/数字开头）', () => {
  const rows = [
    { e: 'share_click', d: {}, t: Date.now() },
    { e: 'ShareClick', d: {}, t: Date.now() },
    { e: 'share-click', d: {}, t: Date.now() },
    { e: 'a', d: {}, t: Date.now() },
    { e: '9bad', d: {}, t: Date.now() },
    { e: 'x'.repeat(60), d: {}, t: Date.now() }
  ];
  const out = TRACKLOG.cleanRows(rows);
  ok(out.length === 1 && out[0].e === 'share_click', '放行了不合规的事件名：' + JSON.stringify(out.map((r) => r.e)));
});

t('时间戳越界的丢：7 天前、1 小时后的都不要', () => {
  const now = Date.now();
  const out = TRACKLOG.cleanRows([
    { e: 'share_click', d: {}, t: now },
    { e: 'share_click', d: {}, t: now - 8 * 86400000 },
    { e: 'share_click', d: {}, t: now + 7200000 },
    { e: 'share_click', d: {}, t: 0 }
  ]);
  ok(out.length === 1, '越界的时间戳被放行了：' + out.length + ' 条');
});

t('参数：最多 6 个键，值截到 60 字符，不是对象就当空', () => {
  const d = { a: 1, b: 'x'.repeat(200), c: 3, d: 4, e: 5, f: 6, g: '第七个' };
  const out = TRACKLOG.cleanRows([{ e: 'share_click', d, t: Date.now() }, { e: 'share_click', d: 'not-an-object', t: Date.now() }]);
  ok(Object.keys(out[0].d).length === 6, '参数个数没封顶：' + Object.keys(out[0].d).length);
  ok(out[0].d.b.length === 60, '长值没截断：' + out[0].d.b.length);
  ok(typeof out[0].d.a === 'number', '数字被转成字符串了（库里的数值查询会因此失效）');
  ok(out[1] && Object.keys(out[1].d).length === 0, 'd 不是对象时没兜住');
});

t('单次超过 50 条只取前 50 —— 端上按同一条数切批', () => {
  const rows = [];
  for (let i = 0; i < 80; i++) rows.push({ e: 'share_click', d: {}, t: Date.now() });
  ok(TRACKLOG.cleanRows(rows).length === 50, '没封顶');
});

t('落库：写进 events 集合 + 记一条当日计数', async () => {
  const db = fakeDb();
  const r = await TRACKLOG.save(db, 'openid_a', { rows: [{ e: 'share_click', d: { from: 'detail' }, t: Date.now() }], ver: '8.1.3' });
  ok(r.ok && r.saved === 1, '没写成功：' + JSON.stringify(r));
  const doc = db._state.events[0];
  ok(doc && doc._openid === 'openid_a' && doc.e === 'share_click' && doc.ver === '8.1.3', '入库的文档字段不对');
  ok(typeof doc.at === 'number', '没记入库时间（端上那个 t 可能被改过，服务端要留自己的那份）');
  ok(db._state.prefs.length === 1 && db._state.prefs[0].n === 1, '没记当日计数');
});

t('单日上限：到了就不再写（丢，不是拒 —— 埋点不该给端上任何反馈）', async () => {
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const db = fakeDb({ _id: 'p1', _openid: 'openid_a', type: 'track', ymd: today, n: TRACKLOG.TRACK_MAX_PER_DAY });
  const r = await TRACKLOG.save(db, 'openid_a', { rows: [{ e: 'share_click', d: {}, t: Date.now() }] });
  ok(r.ok === true && r.saved === 0, '超上限时应该静默丢：' + JSON.stringify(r));
  ok(db._state.events.length === 0, '超上限还是写进去了');
});

t('跨天计数自动归零（昨天写满了不影响今天）', async () => {
  const db = fakeDb({ _id: 'p1', _openid: 'openid_a', type: 'track', ymd: '2020-01-01', n: TRACKLOG.TRACK_MAX_PER_DAY });
  const r = await TRACKLOG.save(db, 'openid_a', { rows: [{ e: 'share_click', d: {}, t: Date.now() }] });
  ok(r.saved === 1, '跨天没归零：今天一条都写不进去了');
  ok(db._state.prefs[0].n === 1, '计数没重置成 1，而是 ' + db._state.prefs[0].n);
});

t('没有 openid（无登录态）不收', async () => {
  const db = fakeDb();
  const r = await TRACKLOG.save(db, '', { rows: [{ e: 'share_click', d: {}, t: Date.now() }] });
  ok(r.ok === false, '没有 openid 也收了：这些行会失去归属，永远说不清是谁发的');
});

t('全批次都是脏数据 = 正常情况，回 ok 而不是报错', async () => {
  const db = fakeDb();
  const r = await TRACKLOG.save(db, 'openid_a', { rows: [{ e: 'BAD NAME', d: {} }, 'not-an-object'] });
  ok(r.ok === true && r.saved === 0, '脏数据回了错误 —— 端上会把它当成「发送失败」反复重送同一批脏行');
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、触发点钉死在源码里（谁删了当场红）】');

t('app.onHide 里挂着 flush(true)', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const at = src.indexOf('onHide');
  ok(at > 0, 'app.js 里没有 onHide —— 落云通道就只剩「攒够 30 条」这一半，用得少的用户永远不落库');
  ok(/track\.flush\(true\)/.test(src.slice(at, at + 400)), 'onHide 里没有 flush(true)');
});

t('云端路由里有 trackBatch，且先建集合再用', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'cloudfunctions/saveTicket/index.js'), 'utf8');
  ok(/event\.action === 'trackBatch'/.test(src), '路由里没有 trackBatch');
  ok(/ensureCollection\(tdb, 'events'\)/.test(src), '没建 events 集合就写 —— 首写会报 -502005 collection not exists');
});

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
