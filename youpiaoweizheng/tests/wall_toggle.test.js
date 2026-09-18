// tests/wall_toggle.test.js —— 8.1.1：同场票根墙「把我的这张放上去」那个开关
// ============================================================
// 【为什么单独一套】8.1.0 的这一处栽在一个**没人测的接缝**上：
//   云函数 wallJoin 返回 { ok, on } —— 出口脱敏那条链 same_wall.test.js 测得挺全；
//   store.setWallPublic 接过云函数，把它**转成了布尔**（失败则抛错）—— 全项目没人测；
//   详情页 onWallToggle 又按 { ok, msg } 去读这个布尔 —— 于是**成功也走失败分支**：
//   开关弹回、弹「没能保存，请重试」，而票其实已经上墙了。
//   （失败时更糟：抛出的异常没人接，开关停在「开」的样子，一声不吭。）
//   教训：**中间那一转没人看着，两头各自都是对的**。所以这套测的就是那一转 ——
//   真 require 页面对象、真调 onWallToggle、真跑 store，不扫源码猜。
//
// 【顺手挖出来的第二个】那个布尔本身就含混：云端撤下成功时回的是 { ok:true, on:false }，
//   转成布尔就是 false ——「撤下成功」和「失败」长得一模一样。于是修完第一个 bug 后，
//   「撤下」这条反而坏了（开关弹回「开」，票撤了界面说没撤）。本套的「撤下成功」那条
//   就是当场逮住它的。最终把 store 的返回改成「成功不回值」，含混从根上没了。
// ============================================================
const path = require('path');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

// ════════════════════════════════════════════════════════════
// wx 桩：store 与详情页都要跑真逻辑
// ════════════════════════════════════════════════════════════
const ROOT = path.resolve(__dirname, '..');
const LS = new Map();
let cloudReply = { ok: true, on: true };
let cloudReject = null;   // 非 null 时 callFunction 直接失败（模拟网络/云函数崩）
let calls = [];
let toasts = [];

global.wx = {
  getStorageSync: (k) => (LS.has(k) ? LS.get(k) : ''),
  setStorageSync: (k, v) => { LS.set(k, v); },
  removeStorageSync: (k) => { LS.delete(k); },
  showToast: (o) => toasts.push((o && o.title) || ''),
  showLoading: () => {},
  hideLoading: () => {},
  vibrateShort: () => {},
  getWindowInfo: () => ({ pixelRatio: 2 }),
  getSystemInfoSync: () => ({ platform: 'ios' }),
  cloud: {
    callFunction: (o) => {
      calls.push(o);
      if (cloudReject) return Promise.reject(cloudReject);
      return Promise.resolve({ result: cloudReply });
    }
  }
};

let page = null;
global.Page = (o) => { page = o; };
require(path.join(ROOT, 'pages/detail/detail.js'));
const store = require(path.join(ROOT, 'utils/store.js'));

/** 真票：不能被 isMockTicket 认成演示数据（那样会绕开云端分支，测了个寂寞） */
const REAL_ID = 'real_ticket_8f21';

function reset() {
  LS.clear();
  calls = [];
  toasts = [];
  cloudReply = { ok: true, on: true };
  cloudReject = null;
}

/** 一个够用的页面实例：只给 onWallToggle 用到的 data / setData */
function ctx(ticket, wallOn) {
  return {
    data: { t: ticket, wallOn: !!wallOn },
    setData(patch) { Object.assign(this.data, patch); }
  };
}

const ticket = { id: REAL_ID, eventKey: 'evt_demo_venue_20260101' };

// ════════════════════════════════════════════════════════════
console.log('\n【一、先钉住 store 的契约（两头各自没错，错在这一转）】');

(async () => {
t('上墙成功**不回值** —— 成没成功只看抛没抛错', async () => {
  reset();
  const r = await store.setWallPublic(REAL_ID, true);
  ok(r === undefined, 'store 回了 ' + JSON.stringify(r)
    + '。只要它回一个布尔，调用方就会拿它当成功标志 —— 而那个布尔在撤下成功时是 false，'
    + '一眼分不清「撤下成功」和「失败」（8.1.0 的开关正是栽在这里）');
});

t('撤下成功同样不回值 —— 尤其不能回 false', async () => {
  reset();
  cloudReply = { ok: true, on: false }; // 云端撤下成功：ok 为真、on 为假
  const r = await store.setWallPublic(REAL_ID, false);
  ok(r === undefined, '撤下成功回了 ' + JSON.stringify(r)
    + '，调用方 `if (!r)` 会把它当成失败，把开关弹回「开」—— 票撤了，界面说没撤');
});

t('setWallPublic 失败是**抛错**，不是回 { ok:false }', async () => {
  reset();
  cloudReply = { ok: false, msg: '这张票没有场次信息，放不进去' };
  let thrown = null;
  try { await store.setWallPublic(REAL_ID, true); } catch (e) { thrown = e; }
  ok(!!thrown, '失败却静默返回了 —— 调用方不 try/catch 就永远发现不了');
  ok(thrown.message === '这张票没有场次信息，放不进去', '云函数给的理由被吞了：' + thrown.message);
});

t('云函数整个挂掉时同样抛错，不假装成功', async () => {
  reset();
  cloudReject = new Error('cloud.callFunction:fail timeout');
  let thrown = null;
  try { await store.setWallPublic(REAL_ID, false); } catch (e) { thrown = e; }
  ok(!!thrown, '云函数都挂了还说成功，用户的票会在墙上显示成没放上去');
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、真跑 onWallToggle：成功别回滚，失败要回滚】');

t('服务端认了 → 开关停在「开」，提示「已放进票根墙」', async () => {
  reset();
  const c = ctx(ticket, false);
  await page.onWallToggle.call(c, { detail: { value: true } });
  ok(c.data.wallOn === true, '成功之后开关反而弹回去了（8.1.0 的原症状）');
  ok(toasts[0] === '已放进票根墙', '提示不对：' + JSON.stringify(toasts));
  ok(calls.length === 1 && calls[0].data.action === 'wallJoin', '没真的调上墙接口');
});

t('服务端说不行 → 开关弹回，并把云函数给的理由说出来', async () => {
  reset();
  cloudReply = { ok: false, msg: '这张票没有场次信息，放不进去' };
  const c = ctx(ticket, false);
  await page.onWallToggle.call(c, { detail: { value: true } });
  ok(c.data.wallOn === false, '失败了开关却停在「开」，下一秒用户刷新就发现被骗');
  ok(toasts[0] === '这张票没有场次信息，放不进去', '没把真实原因告诉用户：' + JSON.stringify(toasts));
});

t('云函数挂了 → 也要回滚 + 给话，不能一声不吭', async () => {
  reset();
  cloudReject = new Error('cloud.callFunction:fail timeout');
  const c = ctx(ticket, true);
  await page.onWallToggle.call(c, { detail: { value: false } }); // 用户想撤下
  ok(c.data.wallOn === true, '撤下失败了，开关却停在「关」—— 票还在墙上，界面却说撤了');
  ok(toasts.length === 1, '失败了一声不吭，用户只能自己猜：' + JSON.stringify(toasts));
});

t('撤下成功 → 开关停在「关」', async () => {
  reset();
  cloudReply = { ok: true, on: false };
  const c = ctx(ticket, true);
  await page.onWallToggle.call(c, { detail: { value: false } });
  ok(c.data.wallOn === false, '撤下成功却把开关弹回「开」');
  ok(toasts[0] === '已从墙上撤下', '提示不对：' + JSON.stringify(toasts));
});

t('页面还没加载出票根时点开关：不炸、不发请求', async () => {
  reset();
  const c = ctx(null, false);
  await page.onWallToggle.call(c, { detail: { value: true } });
  ok(calls.length === 0, '没有票却发了请求');
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、onWallToggle 里不许再有「按对象接」的写法】');

t('不出现 r.ok / r.msg 这类对象式读取（改回去就该红）', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'pages/detail/detail.js'), 'utf8');
  const body = src.slice(src.indexOf('async onWallToggle'), src.indexOf('goWall()'));
  ok(body.indexOf('setWallPublic') > 0, '定位不到 onWallToggle 了，这条断言得跟着改');
  ok(!/\br\.ok\b|\br\.msg\b/.test(body),
    '又按 { ok, msg } 接 setWallPublic 了 —— 它的契约是「失败抛错、成功不回值」');
  ok(!/(=|return)\s*await\s+store\.setWallPublic/.test(body),
    '又把 setWallPublic 的返回值接下来用了 —— 它成功时什么都不回，'
    + '接下来只会是 undefined，一 `if` 就必然是失败');
  ok(/try\s*\{/.test(body) && /catch\s*\(/.test(body),
    'onWallToggle 没接住异常：云函数一挂就静默失效，开关停在错误的位置上');
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
