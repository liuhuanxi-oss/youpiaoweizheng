// tests/subscribe.test.js —— 7.4.0 C2（R5）：订阅消息召回
// ============================================================
// 为什么这批要单独一套：
//   ① 订阅消息是**一次授权、一次下发**。这里没有「开关」可看，用户点没点、授权成没成、
//      明天发不发，端上全看不出来 —— 出错的形态是「什么都没发生」。
//      所以三个关键点必须钉死：模板 ID 没配时**一次都不能请求**、
//      授权成功后**要回报服务端**、授权失败后**不能**回报（否则明早那句
//      「今天的时光签还没收下」就成了假话）。
//   ② 授权弹窗必须在**用户点击那一下**里同步发起。挪到 await 之后会被微信判为非用户点击
//      而静默失败：功能看着有、弹窗永不出现，连报错都没有。这条写成顺序断言。
//   ③ 云端定时发送要能重跑：窗口（别半夜吵人）、幂等（不重发）、终局错误（不无限重试）。
//   跑的是真代码（utils/subscribe.js 与 cloudfunctions/saveTicket/recall.js），不是扫源码猜。
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

// ════════════════════════════════════════════════════════════
// wx 桩：订阅模块要跑真逻辑，不能只扫源码
// ════════════════════════════════════════════════════════════
const LS = new Map();
let dialogs = [];     // requestSubscribeMessage 记录
let calls = [];       // callFunction 记录
let dialogReply = {}; // 弹窗结果：{ tmplId: 'accept' | 'reject' } 或 { fail: errCode }
const TMPL = 'TMPL_TEST_ID';

global.wx = {
  getStorageSync: (k) => (LS.has(k) ? LS.get(k) : ''),
  setStorageSync: (k, v) => { LS.set(k, v); },
  removeStorageSync: (k) => { LS.delete(k); },
  cloud: {
    callFunction: (o) => {
      calls.push({ action: (o && o.data && o.data.action) || '', data: (o && o.data) || {} });
      return Promise.resolve({ result: {} });
    }
  },
  requestSubscribeMessage: (o) => {
    dialogs.push(o);
    if (dialogReply.fail) { o.fail && o.fail({ errCode: dialogReply.fail }); return; }
    o.success && o.success(dialogReply);
  }
};

/** 把「已配置模板 ID」的版本装进内存跑（真源码，只是把那一个常量换掉）——
 *  不去动仓库文件，也不给生产代码留测试专用的口子。 */
function loadWithTmpl(id) {
  const file = path.join(ROOT, 'utils/subscribe.js');
  const src = read('utils/subscribe.js').replace("const TMPL_ID = '';", `const TMPL_ID = '${id}';`);
  ok(src.indexOf(`TMPL_ID = '${id}'`) > 0, '注入失败：subscribe.js 里的 TMPL_ID 声明变了？');
  const m = new Module(file, null);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(src, file);
  return m.exports;
}

function reset(reply) {
  LS.clear();
  dialogs = [];
  calls = [];
  dialogReply = reply || {};
}

const subscribe = require('../utils/subscribe.js'); // 仓库里那份（模板 ID 未配置）

// ════════════════════════════════════════════════════════════
console.log('\n【一、模板 ID 未配置 = 全站静默（不留点了没反应的假入口）】');

t('默认模板 ID 是空的，available() 为 false', () => {
  ok(subscribe.TMPL_ID === '', '仓库里的模板 ID 应该留空等回填：' + subscribe.TMPL_ID);
  ok(subscribe.available() === false, '未配置却说自己可用');
});

t('未配置时连授权弹窗都不拉起（一次都不行）', () => {
  reset();
  ok(subscribe.askIfDue() === null, '未配置时应该直接返回 null');
  ok(dialogs.length === 0, '未配置却弹了授权窗：' + dialogs.length + ' 次');
});

t('未配置时没有任何服务端回报', async () => {
  reset();
  await subscribe.afterSign(null, { ok: true, streak: 3 });
  ok(calls.length === 0, '未配置却回报了服务端：' + JSON.stringify(calls));
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、配置模板 ID 之后：授权 → 回报 → 次日召回】');

const sub = loadWithTmpl(TMPL);
const S = 'sp_sub_state';

t('签到时拉起一次授权，模板就是那一个（不多带、不写错）', async () => {
  reset({ [TMPL]: 'accept' });
  const p = sub.askIfDue();
  ok(!!p, '配置了模板却什么都没弹');
  ok(dialogs.length === 1, '弹窗次数不对：' + dialogs.length);
  ok(JSON.stringify(dialogs[0].tmplIds) === JSON.stringify([TMPL]), '模板 ID 传错了：' + JSON.stringify(dialogs[0].tmplIds));
  const r = await p;
  ok(r.accepted === true, '允许了却不算 accepted');
});

t('同一天不再弹第二次（签到失败重试时不该再弹一遍）', () => {
  reset({ [TMPL]: 'accept' });
  LS.set(S, { ymd: new Date().toISOString().slice(0, 10) });
  ok(sub.askIfDue() === null, '今天已经问过，还是弹了');
  ok(dialogs.length === 0, '今天已经问过，还是弹了');
});

t('用户点了允许 → 回报服务端挂上明天的提醒（带模板 ID 与连签天数）', async () => {
  reset({ [TMPL]: 'accept' });
  const p = sub.askIfDue();
  await sub.afterSign(p, { ok: true, streak: 4 });
  ok(calls.length === 1, '授权成功却没回报服务端：' + calls.length);
  ok(calls[0].action === 'recallSave', '回报的 action 不对：' + calls[0].action);
  ok(calls[0].data.tmplId === TMPL, '回报没带模板 ID');
  ok(calls[0].data.streak === 4, '回报没带连签天数：' + calls[0].data.streak);
});

t('用户拒绝 → 不回报服务端，且 30 天内不再问', async () => {
  reset({ [TMPL]: 'reject' });
  const p = sub.askIfDue();
  const r = await p;
  ok(r.accepted === false, '拒绝了却算 accepted');
  await sub.afterSign(p, { ok: true, streak: 4 });
  ok(calls.length === 0, '用户拒绝了还是回报了服务端');
  // 明天（把「今天问过」的记录清掉）也不该再弹 —— 静默期还没过
  LS.set(S, { ymd: '2000-01-01', denyAt: Date.now() - 5 * 86400000 });
  ok(sub.askIfDue() === null, '被拒 5 天后又开始弹了（静默期是 30 天）');
  ok(dialogs.length === 1, '不该弹却弹了');
});

t('静默期过后可以再问一次（用户可能只是当时点错了）', () => {
  reset({ [TMPL]: 'accept' });
  LS.set(S, { ymd: '2000-01-01', denyAt: Date.now() - 31 * 86400000 });
  ok(!!sub.askIfDue(), '过期后应该能再问');
});

t('弹窗本身失败（如用户关了订阅总开关）→ 不回报，但不当成「拒绝」', async () => {
  reset({ fail: 20004 });
  const p = sub.askIfDue();
  const r = await p;
  ok(r.ok === false && r.accepted === false, '失败却算成功');
  await sub.afterSign(p, { ok: true });
  ok(calls.length === 0, '失败还回报了服务端');
  const st = LS.get(S) || {};
  ok(!st.denyAt, '环境失败被当成用户拒绝，会白静默 30 天');
});

t('签到没成功 → 就算授权了也不挂提醒（不能挂一句明天会变成假话的提醒）', async () => {
  reset({ [TMPL]: 'accept' });
  const p = sub.askIfDue();
  await sub.afterSign(p, { ok: false, msg: '签到失败' });
  ok(calls.length === 0, '签到失败了还挂了明天的提醒');
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、云端：发送时刻 / 窗口 / 消息内容（真跑）】');

const recall = require('../cloudfunctions/saveTicket/recall.js');

t('sendAtOf：授权次日 09:00（北京时间），深夜授权也是次日 09:00', () => {
  // 北京 2026-09-14 23:50 = UTC 2026-09-14 15:50
  const at = recall.sendAtOf(Date.UTC(2026, 8, 14, 15, 50));
  const bj = new Date(at + 8 * 3600 * 1000);
  ok(bj.getUTCFullYear() === 2026 && bj.getUTCMonth() === 8 && bj.getUTCDate() === 15, '不是次日：' + bj.toISOString());
  ok(bj.getUTCHours() === 9 && bj.getUTCMinutes() === 0, '不是 09:00：' + bj.toISOString());
  ok(recall.RECALL_HOUR === 9, '发送时刻常量被改了？');
});

t('sendAtOf：上午授权同样是次日 09:00（不提前、不顺延两天）', () => {
  const at = recall.sendAtOf(Date.UTC(2026, 8, 14, 1, 0)); // 北京 09:00
  const bj = new Date(at + 8 * 3600 * 1000);
  ok(bj.getUTCDate() === 15, '日期不对：' + bj.toISOString());
  ok(bj.getUTCHours() === 9, '时刻不对：' + bj.toISOString());
});

t('beijingHour：UTC+8 口径（定时器按哪个时区触发都不影响判断）', () => {
  ok(recall.beijingHour(Date.UTC(2026, 8, 14, 1, 30)) === 9, '北京 09:30 应算 9 点');
  ok(recall.beijingHour(Date.UTC(2026, 8, 13, 16, 30)) === 0, '北京次日 00:30 应算 0 点');
});

t('消息内容：字段名固定、文案不吹牛（thing 类超 20 字微信会拒收）', () => {
  const d = recall.dataOf(3);
  ok(d.thing1 && typeof d.thing1.value === 'string', 'thing1 缺失');
  ok(d.thing2 && typeof d.thing2.value === 'string', 'thing2 缺失');
  Object.keys(d).forEach((k) => {
    ok(d[k].value.length <= 20, k + ' 的值超过 20 字（thing 类上限）');
  });
  ok(recall.dataOf(3).thing2.value.indexOf('3') >= 0, '连签天数没进文案');
  ok(recall.dataOf(0).thing2.value.indexOf('0') < 0, '没连签却说连签 0 天');
});

// ════════════════════════════════════════════════════════════
console.log('\n【四、云端执行器：窗口 / 幂等 / 不无限重试】');

/** 假 db：只实现 run() 真正用到的那几样 */
function fakeDb(rows) {
  const updates = [];
  const col = {
    where: () => col,
    limit: () => col,
    get: async () => ({ data: rows.map((r) => Object.assign({}, r)) }),
    doc: (id) => ({ update: async (o) => { updates.push({ id, data: o.data }); return { stats: { updated: 1 } }; } })
  };
  return { db: { command: { lte: (v) => ({ __lte: v }) }, collection: () => col }, updates };
}
function fakeCloud(result) {
  const sent = [];
  return {
    sent,
    cloud: {
      openapi: {
        subscribeMessage: {
          send: async (o) => {
            sent.push(o);
            if (result && result.throw) { const e = new Error(result.throw); e.errCode = result.code; throw e; }
            return { errCode: 0 };
          }
        }
      }
    }
  };
}
/** 把「现在」固定到北京的某个小时，好让窗口判断可预期 */
function atBeijingHour(h, fn) {
  const real = Date.now;
  const base = Date.UTC(2026, 8, 14, h - 8, 30); // 北京时间今天 h:30
  Date.now = () => base;
  try { return fn(base); } finally { Date.now = real; }
}

const ROW = { _id: 'r1', _openid: 'o1', tmplId: TMPL, streak: 3, status: 'pending', tries: 0, sendAt: 1 };

t('发送窗口外（北京 03:00）一条都不发 —— 定时器半夜跑起来也不能吵人', async () => {
  await atBeijingHour(3, async () => {
    const { db } = fakeDb([ROW]);
    const c = fakeCloud();
    const out = await recall.run(db, c.cloud, {});
    ok(out.sent === 0, '窗口外还是发了');
    ok(c.sent.length === 0, '窗口外调了发送接口');
    ok(/窗口/.test(out.msg || ''), '没说清为什么没发：' + out.msg);
    ok(out.scanned === 0, '窗口外不该去查待发名单');
  });
});

t('窗口内（北京 09:00）发一条，并把这条置为 sent（幂等：重复跑不再发）', async () => {
  await atBeijingHour(9, async () => {
    const f = fakeDb([ROW]);
    const c = fakeCloud();
    const out = await recall.run(f.db, c.cloud, {});
    ok(out.sent === 1, '该发没发：' + JSON.stringify(out));
    ok(c.sent.length === 1, '发送次数不对');
    ok(c.sent[0].touser === 'o1' && c.sent[0].templateId === TMPL, '发给谁/用哪个模板不对');
    ok(f.updates.length === 1 && f.updates[0].data.status === 'sent', '没置成 sent，下次会重发');
  });
});

t('43101（用户没额度/已拒收）是终局：结案，不无限重试', async () => {
  await atBeijingHour(9, async () => {
    const f = fakeDb([ROW]);
    const c = fakeCloud({ throw: 'no quota', code: 43101 });
    const out = await recall.run(f.db, c.cloud, {});
    ok(out.dead === 1 && out.retry === 0, '终局错误被当成可重试：' + JSON.stringify(out));
    ok(f.updates[0].data.status === 'dead', '没结案：' + JSON.stringify(f.updates[0].data));
    ok(String(f.updates[0].data.err).indexOf('43101') === 0, '错误码没留痕');
  });
});

t('网络类失败留着下一跳再试（不是丢掉这条提醒）', async () => {
  await atBeijingHour(9, async () => {
    const f = fakeDb([ROW]);
    const c = fakeCloud({ throw: 'timeout', code: -1 });
    const out = await recall.run(f.db, c.cloud, {});
    ok(out.retry === 1 && out.dead === 0, '可重试错误被结案了：' + JSON.stringify(out));
    ok(f.updates[0].data.status === 'pending', '状态没保持 pending');
    ok(f.updates[0].data.tries === 1, '重试计数没加');
  });
});

t('重试到上限就停手（云函数不能一辈子每天试同一条）', async () => {
  await atBeijingHour(9, async () => {
    const f = fakeDb([Object.assign({}, ROW, { tries: recall.RECALL_TRIES_MAX })]);
    const c = fakeCloud();
    const out = await recall.run(f.db, c.cloud, {});
    ok(out.scanned === 0 && c.sent.length === 0, '超过重试上限还在发');
  });
});

t('dryRun 只列名单不发（验收定时器建没建、明天会发给谁）', async () => {
  await atBeijingHour(9, async () => {
    const FULL = 'oABCDEFGHIJKLMNOPQRSTUVWXYZ01'; // 真实 openid 28 位
    const f = fakeDb([Object.assign({}, ROW, { _openid: FULL })]);
    const c = fakeCloud();
    const out = await recall.run(f.db, c.cloud, { dryRun: true });
    ok(c.sent.length === 0, 'dryRun 竟然真发了');
    ok(out.list.length === 1, 'dryRun 没列名单');
    ok(out.list[0].openid !== FULL, 'dryRun 把完整 openid 回显了（这份报告会被贴到群里）');
    ok(String(out.list[0].openid).length <= 10, 'openid 前缀太长，露出的身份信息比需要的多');
    ok(f.updates.length === 0, 'dryRun 竟然写了库');
  });
});

// ════════════════════════════════════════════════════════════
console.log('\n【五、接线：入口、门禁与顺序（错了就是静默失效）】');

t('授权弹窗在 await 之前同步发起（否则手势过期 → 静默失败）', () => {
  const src = decomment(read('utils/sign.js'));
  const i = src.indexOf('async function checkIn');
  ok(i > 0, '找不到 checkIn');
  const body = src.slice(i, i + 900);
  const ask = body.indexOf('askIfDue');
  const aw = body.indexOf('await');
  ok(ask > 0, 'checkIn 里没有发起订阅授权');
  ok(aw > 0 && ask < aw, 'askIfDue 排在了第一个 await 之后 —— 点击手势已经过期，弹窗会静默失败');
});

t('页面不自己调订阅接口（只有 utils/subscribe.js 一处出口）', () => {
  const files = [];
  const walk = (dir) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
      if (d.name === 'node_modules' || d.name === 'dist' || d.name === '.git') return;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (/\.(js|wxml)$/.test(d.name)) files.push(p);
    });
  };
  walk(ROOT);
  const hit = files.filter((f) => /requestSubscribeMessage/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'))
    .filter((f) => f !== 'utils/subscribe.js' && !/^tests\//.test(f));
  ok(hit.length === 0, '订阅接口出现了第二处出口：' + hit.join(', '));
});

t('云端：定时事件先于入库主流程拦住，且不认客户端直调', () => {
  const src = decomment(read('cloudfunctions/saveTicket/index.js'));
  const i = src.indexOf('event.Type');
  ok(i > 0, '找不到定时事件分支');
  ok(i < src.indexOf("event.action === 'checkText'"), '定时事件分支排在了入库/action 路由之后，会掉进主流程写脏数据');
  const seg = src.slice(i, i + 400);
  ok(/OPENID/.test(seg), '定时分支没有 OPENID 门禁（小程序端可伪造 Type:Timer 触发）');
  ok(/recall\.run/.test(seg), '定时分支没接召回执行器');
});

t('云端：两个 action 已挂路由，opsRecall 带门禁', () => {
  const src = decomment(read('cloudfunctions/saveTicket/index.js'));
  ok(/event\.action === 'recallSave'/.test(src), 'recallSave 没挂路由');
  ok(/event\.action === 'opsRecall'/.test(src), 'opsRecall 没挂路由');
  ok(/return recall\.save\(rdb, OPENID, event\)/.test(src), 'recallSave 没接实现');
  const i = src.indexOf('async function recallOpsAction');
  ok(i > 0, '找不到 recallOpsAction');
  ok(/checkOpsToken/.test(src.slice(i, i + 300)), 'opsRecall 没有 opsToken 门禁 —— 谁都能手动触发群发');
});

t('云端：config.json 里 template 权限与定时触发器都在（漏一个就是永远不发）', () => {
  const cfg = JSON.parse(read('cloudfunctions/saveTicket/config.json'));
  const perms = (cfg.permissions && cfg.permissions.openapi) || [];
  ok(perms.indexOf('subscribeMessage.send') >= 0, '没申请 subscribeMessage.send 权限，调用会被拒');
  const trg = cfg.triggers || [];
  ok(trg.length === 1, '定时触发器数量不对：' + trg.length);
  ok(trg[0].type === 'timer' && trg[0].name && trg[0].config, '触发器配置不完整：' + JSON.stringify(trg[0]));
  ok(trg[0].config.split(' ').length === 7, '腾讯云 cron 是 7 段（秒 分 时 日 月 周 年）：' + trg[0].config);
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
