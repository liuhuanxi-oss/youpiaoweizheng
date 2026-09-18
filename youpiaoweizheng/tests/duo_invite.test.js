// tests/duo_invite.test.js —— 双人空间的「邀请侧」（8.1.0 拉新 5/6）
// ============================================================
// 这一套盯的是**从分享卡到绑定成功**那几步，错法同样全都不报错：
//   ① 收卡的人点进来，卡在一个必填弹窗前面 —— 想加入得先打字，可称呼本来就是选填的
//      （云端默认 TA）。这一个弹窗挡掉的是整条拉新链路。
//   ② 绑定成功了，可他没有票根 —— 成功页只有「进入我们的回忆」，进去看见一本空册子
//      就走了。**邀请来的人得先有一张票**，这是拉新真正的终点。
//   ③ 邀请卡的标题报了一个不属于他的数字（云库读失败时 store 兜底成演示票根，
//      拿那批的条数说「我已经存了 8 张」—— 对着演示数据替他吹牛）。
// 所以这三件都**真跑**：share.js 的场景表真调，pages/bind/bind.js 的
// accept / doJoin / checkFirstTicket 拿到假 wx 一起真跑（Page 桩捕获配置对象）。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const bindSrc = read('pages/bind/bind.js');
const bindJs = bindSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const bindWxml = read('pages/bind/bind.wxml').replace(/<!--[\s\S]*?-->/g, '');
const bindWxss = read('pages/bind/bind.wxss').replace(/\/\*[\s\S]*?\*\//g, '');
const duoJs = read('pages/duo/duo.js').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

// ════════════════════════════════════════════════════════════
// wx 桩：分享与绑定都要跑真代码，设置在任何 require 之前
// ════════════════════════════════════════════════════════════
const LS = new Map();
let cloudCalls = [];   // callFunction 入参
let cloudReply = {};   // action → 返回值
let events = [];       // 埋点
let navTo = [];        // navigateTo 的地址

global.wx = {
  getStorageSync: (k) => (LS.has(k) ? LS.get(k) : ''),
  setStorageSync: (k, v) => { LS.set(k, v); },
  removeStorageSync: (k) => { LS.delete(k); },
  reportEvent: (e, d) => { events.push({ e, d }); },
  vibrateShort: () => {},
  showLoading: () => {}, hideLoading: () => {},
  showToast: () => {},
  navigateTo: (o) => { navTo.push(o && o.url); },
  getLaunchOptionsSync: () => ({}),
  cloud: {
    callFunction: (o) => {
      const action = (o && o.data && o.data.action) || '';
      cloudCalls.push((o && o.data) || {});
      const r = cloudReply[action];
      if (r instanceof Error) return Promise.reject(r);
      return Promise.resolve({ result: r || {} });
    }
  }
};

function reset(o) {
  const opt = o || {};
  LS.clear();
  cloudCalls = [];
  events = [];
  navTo = [];
  cloudReply = opt.cloud || {};
}

const share = require(path.join(ROOT, 'utils', 'share.js'));
const store = require(path.join(ROOT, 'utils', 'store.js'));

/** 真跑 pages/bind/bind.js：Page 桩捕获配置对象，require 走真模块（假 wx 已就位） */
function makePage(options) {
  let cfg = null;
  const realRequire = (p) => require(path.join(ROOT, 'pages', 'bind', p));
  new Function('require', 'wx', 'Page', 'module', 'exports', bindSrc)(
    realRequire, global.wx, (o) => { cfg = o; }, {}, {});
  ok(cfg && typeof cfg.accept === 'function', 'bind.js 没有调 Page() 或者没有 accept');
  const data = Object.assign({}, cfg.data);
  const page = Object.assign({}, cfg, { data, setData: (p) => Object.assign(data, p) });
  page.onLoad(options || { code: 'K7MP' });
  return page;
}

/** 真跑 checkFirstTicket 时替换 store 的两只读口（decision 在被测代码里，数据换了而已） */
function withStore(rows, flags, fn) {
  const l = store.listTickets, f = store.listFlags;
  store.listTickets = async () => rows;
  store.listFlags = () => flags;
  return Promise.resolve()
    .then(fn)
    .finally(() => { store.listTickets = l; store.listFlags = f; });
}

// ════════════════════════════════════════════════════════════
console.log('\n【一、邀请卡文案：报的是我自己的张数，报不出来的不编】');

t('没绑定时，标题带上我存了多少张（收卡的人要先判断这人是不是真在用）', () => {
  reset();
  const m = share.message('duo', { code: 'K7MP', mine: 47 });
  ok(m.title.indexOf('47') >= 0, '标题没带上张数：' + m.title);
  ok(m.path === '/pages/bind/bind?code=K7MP', '没直达绑定页：' + m.path);
  ok(m.title.indexOf(share.SLOGAN) >= 0, '没带口号：' + m.title);
});

t('拿不到张数（0 / 缺参）就退回那句通用的话，不写「已经存了 0 张」', () => {
  reset();
  [0, undefined, null].forEach((mine) => {
    const m = share.message('duo', { code: 'K7MP', mine });
    ok(m.title.indexOf('0 张') < 0, '把 0 张报出去了：' + m.title);
    ok(m.title.indexOf('给你留了位置') >= 0, '没退回通用那句：' + m.title);
  });
});

t('已经绑定了就报「我们」的张数（绑过的卡片不该再说「我已经存了」）', () => {
  reset();
  const m = share.message('duo', { total: 12, partnerName: '小满', mine: 47 });
  ok(m.title.indexOf('小满') >= 0 && m.title.indexOf('12') >= 0, '双人那句被抢了：' + m.title);
  ok(m.title.indexOf('47') < 0, '绑定了还报我一个人的张数：' + m.title);
});

t('双人页把张数交下去；云兜底时交 0（演示票根不是他的）', () => {
  ok(/mine: this\._mineCount \|\| 0/.test(duoJs), 'onShareAppMessage 没把张数交给 share.js');
  ok(/this\._mineCount = flags\.netFallback \? 0 : \(raw \|\| \[\]\)\.length/.test(duoJs),
    '兜底那批演示票根被当成他自己的收藏了 —— 邀请卡会替他吹牛');
  ok(/catch \(e\) \{[\s\S]{0,80}this\._mineCount = 0/.test(duoJs), '读票册失败时没把张数归零');
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、落地页：一步就能加入，称呼不是门槛】');

t('「接受邀请」先问称呼，但两个按钮都能往下走', () => {
  reset();
  const page = makePage();
  let modal = null, joinArg = '未调用';
  wx.showModal = (o) => { modal = o; o.success({ confirm: true, content: '小满' }); };
  page.doJoin = (name) => { joinArg = name; };
  page.accept();
  ok(modal && modal.editable, '称呼还是必填弹窗的话，这一步就白做了');
  ok(modal.cancelText === '先不填', '取消按钮没改成「先不填」：用户会以为点了就不加入了');
  ok(joinArg === '小满', '输了称呼却没带下去：' + joinArg);

  // 关键：点「先不填」照样加入
  joinArg = '未调用';
  wx.showModal = (o) => { o.success({ confirm: false, content: '' }); };
  page.accept();
  ok(joinArg === '', '点了「先不填」就中止了 —— 想加入的人被一个选填项挡在门外：' + joinArg);
});

t('真跑绑定：name 原样进云函数，绑定成功落 done 态', async () => {
  reset({ cloud: { bind: { ok: true, bound: true, couple: { partnerName: '小满', boundAt: 1 } } } });
  const page = makePage({ code: 'k7mp' });   // 小写进来的码要归一
  // 跟着一起跑的 checkFirstTicket 会去读票册：这里给一份空的，免得它落进云兜底
  await withStore([], { netFallback: false }, () => page.doJoin(''));
  const call = cloudCalls.find((c) => c.action === 'bind');
  ok(call, '没有调 bind action');
  ok(call.mode === 'join' && call.code === 'K7MP' && call.name === '', '入参不对：' + JSON.stringify(call));
  ok(page.data.state === 'done' && page.data.msg === '小满', '没落成功态：' + JSON.stringify(page.data));
  ok(events.some((e) => e.e === 'invite_bind' && e.d && e.d.via === 'card'),
    'invite_bind（via=card）埋点没了 —— K 因子主路径就看不见了');
});

t('绑定失败落 error 态，说的是人话', async () => {
  reset({ cloud: { bind: { ok: false, msg: '邀请码已过期，让 TA 重新生成' } } });
  const page = makePage();
  await page.doJoin('');
  ok(page.data.state === 'error', '失败却停在确认态');
  ok(page.data.msg.indexOf('过期') >= 0, '失败原因没带给用户：' + page.data.msg);
});

t('链接里没有码：直接说明白，不摆一个点了没反应的按钮', () => {
  reset();
  const page = makePage({});
  ok(page.data.state === 'error', '缺码却进了确认态');
  ok(page.data.msg.indexOf('重新分享') >= 0, '缺码的提示不对：' + page.data.msg);
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、绑定成功之后指哪条路：没有票根的人先收第一张】');

t('一张票根都没有 → 推「去收下第一张票根」', async () => {
  reset();
  const page = makePage();
  await withStore([], { netFallback: false }, () => page.checkFirstTicket());
  ok(page.data.empty === true, '空册子却还让他「进入我们的回忆」—— 进去看一眼就走了');
});

t('本来就有票根 → 照旧进双人空间', async () => {
  reset();
  const page = makePage();
  await withStore([{ id: 't1' }], { netFallback: false }, () => page.checkFirstTicket());
  ok(page.data.empty === false, '有票也被推去拍照了');
});

t('云兜底（那批是演示票根）不算他有票', async () => {
  reset();
  const page = makePage();
  // 兜底 + 空列表：这一格才分得出「有没有认 netFallback」——
  // 兜底时列出的是演示票根（非空），光看 length 两种情况都是「有票」，
  // 那时候断言就是绿着骗人（反向验证时验过）。
  await withStore([], { netFallback: true }, () => page.checkFirstTicket());
  ok(page.data.empty === false, '兜底时按「一张都没有」处理：对着演示数据替他下结论');
});

t('读票册炸了也不把人推错路（按有票处理）', async () => {
  reset();
  const page = makePage();
  const l = store.listTickets;
  store.listTickets = async () => { throw new Error('db down'); };
  try { await page.checkFirstTicket(); } finally { store.listTickets = l; }
  ok(page.data.empty === false, '读不出来还推他去拍照，等于告诉他「你一张都没有」');
});

t('绑定成功之后才问这条路（没绑上就问，问错了人）', () => {
  const done = /this\.setData\(\{ state: 'done'[\s\S]{0,120}this\.checkFirstTicket\(\)/.test(bindJs);
  ok(done, 'checkFirstTicket 没接在绑定成功之后');
  // 数 this. 打头的调用（函数定义那行也叫 checkFirstTicket()，一起数会多数一个）
  ok((bindJs.match(/this\.checkFirstTicket\(\)/g) || []).length === 1, 'checkFirstTicket 有多处调用');
});

// ════════════════════════════════════════════════════════════
console.log('\n【四、版面与接线】');

t('成功页两个分支都在，按钮都是真按钮', () => {
  ok(/wx:if="\{\{empty\}\}"[\s\S]{0,400}bindtap="goScan"/.test(bindWxml), '空册子那条路的按钮没了');
  ok(/bindtap="goScan"[\s\S]{0,200}bindtap="goDuo"/.test(bindWxml), '空册子那条路少了「先看看」的出口');
  ok(/wx:else[\s\S]{0,300}bindtap="goDuo"/.test(bindWxml), '有票那条路的按钮没了');
  ok(/你们的册子还空着/.test(bindWxml), '空册子那句说明没了 —— 光有按钮不知道为什么要拍');
});

t('确认态写清了「绑了能得到什么」（不然收卡的人没有理由点）', () => {
  ok(/共同场次/.test(bindWxml) && /共同城市/.test(bindWxml), '没写绑定的收益');
  ok(/class="tip"/.test(bindWxml), '收益那句没有自己的样式（会和邀请码抢注意力）');
  ok(/\.tip \{/.test(bindWxss), 'WXSS 里没有 .tip 规则');
});

t('WXML 里 bind* 用到的处理器，JS 里都真的存在', () => {
  const handlers = new Set([...bindWxml.matchAll(/\bbind(?:tap|:[\w]+)="([a-zA-Z]\w*)"/g)].map((m) => m[1]));
  ok(handlers.size >= 4, '只找到 ' + handlers.size + ' 个处理器，断言可能失效');
  const missing = [...handlers].filter((h) => !new RegExp('\\b' + h + '\\s*\\(').test(bindJs));
  ok(missing.length === 0, 'WXML 绑了但 JS 里没有：' + missing.join(', '));
});

t('页面仍然不带假数据：字数与颜色都合规', () => {
  const bad = [...bindWxss.matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
    .filter((m) => !/var\([^)]*#[0-9a-fA-F]{3,8}\s*\)/.test(bindWxss.slice(Math.max(0, m.index - 40), m.index + 20)));
  ok(bad.length === 0, 'WXSS 里写死了色值：' + bad.map((b) => b[0]).join(', '));
  const m = bindWxml.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  ok(!m, 'wxml 里出现了 emoji：' + (m && m[0]));
});

// ════════════════════════════════════════════════════════════
(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  PASS  ' + name); pass++; }
    catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); fail++; }
  }
  console.log('\n测试套件：duo_invite —— ' + pass + ' 通过 / ' + fail + ' 失败\n');
  process.exit(fail ? 1 : 0);
})();
