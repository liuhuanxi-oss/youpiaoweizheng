// tests/audit_812.test.js —— 《8.1.2 现状审查与用户研究方案》修复批（8.1.3）
// ============================================================
// 那份审查审的是线上 8.1.2（commit 62cf854），逐条核过之后本批动了六处。
// 这里钉的是**每处「改回去就会红」的那一句**，不是复述实现：
//   D-PAY-1  支付轮询 22 秒无法中止（用户切走了还在白发 payQuery）
//   D-GAP-1  相册授权 6 处各抄一份（拒授权后旧入口只剩「重试」= 假按钮）
//   D-DEMO-1 详情页「✦ 修复」点了只弹「即将上线」（唯一一处空承诺）
//   D-DUP-1  签到基础分只在云端，端上信服务端——「信任」本身没有测试兜底
//   D-TZ-1   订阅闸门用设备时区，与全项目 UTC+8 口径不一致
//   P-5      CI 打印包体积 + 20 KB 增幅红线（见 scripts/ci/upload.js）
// 前四节真跑模块（假 wx 注入），后两节是源码结构断言。
// ============================================================
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/** 去注释版：结构断言跑它 —— 注释里解释「为什么摘掉那颗假按钮」是应该的，
 *  但断言要钉的是**代码里还剩没剩**（audit_fixes.test.js 同一套做法） */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/[^\n]*/g, '');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ════════════════════════════════════════════════════════════
console.log('\n【一、D-PAY-1 支付轮询：用户走了就收手（真跑）】');

/** 假 wx：登录态新鲜（跳过 wx.login）、收银台放行、payConfirm 未到账（好落进轮询） */
function loadPay() {
  const calls = { payQuery: 0, payConfirm: 0 };
  global.wx = {
    getStorageSync: () => Date.now(), // sp_auth_time 是个「刚刚」的时间戳 → ensureSession 短路
    setStorageSync: () => {},
    cloud: {
      callFunction: (o) => {
        const action = (o.data || {}).action;
        if (action === 'payCreate') return Promise.resolve({ result: { ok: true, outTradeNo: 'T1', signData: 'sd', paySig: 'ps', signature: 'sg' } });
        if (action === 'payConfirm') { calls.payConfirm++; return Promise.resolve({ result: { ok: false } }); }
        if (action === 'payQuery') {
          calls.payQuery++;
          return Promise.resolve({ result: { ok: true, order: { status: 'pending' } } });
        }
        return Promise.resolve({ result: { ok: false } });
      }
    },
    requestVirtualPayment: (o) => { o.success && o.success(); }
  };
  delete require.cache[require.resolve('../utils/pay.js')];
  return { pay: require('../utils/pay.js'), calls };
}

t('页面走了（abort）之后不再发 payQuery，并如实返回 aborted', async () => {
  const { pay, calls } = loadPay();
  const t0 = Date.now();
  const p = pay.buyArtPack(null);
  await sleep(80);              // 第 0 轮正在等那 600ms
  pay.abort();                  // 用户切走页面（art 页 onUnload 就调这个）
  const r = await p;
  const ms = Date.now() - t0;
  ok(r.aborted === true, '中止后没给 aborted 标志，调用方会当成「没买成」弹窗');
  ok(calls.payQuery === 1, '中止后还在发 payQuery：' + calls.payQuery + ' 次（应当停在当轮）');
  ok(ms < 1500, '中止太慢：' + ms + 'ms —— 中止号要每轮开头查，不能等整圈跑完');
});

t('没中止时照常走到「已到账」（中止不能把正常链路掐死）', async () => {
  const { pay, calls } = loadPay();
  // 让第一次 payQuery 就返回 delivered：正常路径必须能拿到 ok
  global.wx.cloud.callFunction = (o) => {
    const action = (o.data || {}).action;
    if (action === 'payCreate') return Promise.resolve({ result: { ok: true, outTradeNo: 'T2', signData: 'sd', paySig: 'ps', signature: 'sg' } });
    if (action === 'payQuery') { calls.payQuery++; return Promise.resolve({ result: { ok: true, order: { status: 'delivered' }, quota: { left: 9 } } }); }
    return Promise.resolve({ result: { ok: false } });
  };
  const r = await pay.buyArtPack(null);
  ok(r.ok === true && r.quota && r.quota.left === 9, '正常落到 delivered 的路径坏了：' + JSON.stringify(r));
});

t('art 页确实把中止号接上了（走人 = onUnload，不是 onHide）', () => {
  const art = read('pages/art/art.js');
  ok(/onUnload\(\)[^\n]*pay\.abort\(\)/.test(art), 'onUnload 没调 pay.abort —— 切走后照样白发 20 秒');
  ok(/r\.aborted\) return/.test(art), 'aborted 没被挡住：会往一个已销毁的页面弹窗');
  const pay = read('utils/pay.js');
  ok(/function abort\(\)/.test(pay) && /abort,/.test(pay), 'pay.js 没导出 abort');
  ok(/pollId !== _pollId/.test(pay), '轮询里没有中止号比对');
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、D-GAP-1 存相册只有一份实现（真跑 saveimg + 结构）】');

t('全项目 pages/ 里不再有人直接调 wx.saveImageToPhotosAlbum', () => {
  const dir = path.join(ROOT, 'pages');
  const hit = [];
  const walk = (d) => fs.readdirSync(d).forEach((f) => {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) return walk(p);
    if (!f.endsWith('.js')) return;
    if (/wx\.saveImageToPhotosAlbum/.test(fs.readFileSync(p, 'utf8'))) hit.push(path.relative(ROOT, p));
  });
  walk(dir);
  ok(hit.length === 0, '又有人自己抄了一份（应当统一走 utils/saveimg.js）：' + hit.join(', '));
});

t('五个存相册入口都 require 了 saveimg 并调 save()', () => {
  const need = ['pages/card/card.js', 'pages/art/art.js', 'pages/annual/annual.js', 'pages/discover/discover.js', 'pages/sign/sign.js'];
  const bad = need.filter((f) => {
    const s = read(f);
    return !/require\('\.\.\/\.\.\/utils\/saveimg\.js'\)/.test(s) || !/saveimg\.save\(/.test(s);
  });
  ok(bad.length === 0, '没接上 saveimg：' + bad.join(', '));
  // 接了就得按它的约定处理失败：弹过的（shown）不再叠一个 toast
  const loose = need.filter((f) => !/e\.shown/.test(read(f)));
  ok(loose.length === 0, 'catch 里没看 e.shown（会出现引导弹窗 + 「保存失败」两个提示叠着）：' + loose.join(', '));
});

t('saveimg 的四种失败真的分得开（拒授权 / 取消 / 真失败）', () => {
  let modal = null, toast = 0;
  global.wx = {
    showModal: (o) => { modal = o; },
    openSetting: () => {},
    saveImageToPhotosAlbum: (o) => o.fail({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' })
  };
  delete require.cache[require.resolve('../utils/saveimg.js')];
  const saveimg = require('../utils/saveimg.js');
  return saveimg.save('/tmp/x.png').then(
    () => { throw new Error('拒授权居然当成功了'); },
    (e) => {
      ok(e.shown === true, '拒授权之后 shown 应为 true（调用方靠它决定弹不弹）');
      ok(modal && modal.confirmText === '去设置', '拒授权没引导去设置页 —— 光说「重试」用户会一直点一直失败');
    }
  ).then(() => {
    // 取消：静默，什么都不弹
    global.wx.saveImageToPhotosAlbum = (o) => o.fail({ errMsg: 'saveImageToPhotosAlbum:fail cancel' });
    modal = null;
    return saveimg.save('/tmp/x.png').then(
      () => { throw new Error('取消居然当成功了'); },
      (e) => {
        ok(e.shown === true && e.msg === '' && !modal, '用户自己取消不该弹任何东西');
      }
    );
  }).then(() => {
    // 真失败：給人话，且没弹过（调用方负责 toast）
    global.wx.saveImageToPhotosAlbum = (o) => o.fail({ errMsg: 'saveImageToPhotosAlbum:fail system error' });
    toast++;
    return saveimg.save('/tmp/x.png').then(
      () => { throw new Error('真失败居然当成功了'); },
      (e) => { ok(e.shown === false && /请重试/.test(e.msg), '真失败要给人话且 shown=false'); }
    );
  });
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、D-DEMO-1 假按钮已摘干净（结构）】');

t('详情页不再有「修复」胶囊与那句空承诺', () => {
  const js = strip(read('pages/detail/detail.js'));
  const wxml = strip(read('pages/detail/detail.wxml'));
  const wxss = strip(read('pages/detail/detail.wxss'));
  ok(!/goRepair/.test(js), 'detail.js 里还有 goRepair');
  ok(!/goRepair/.test(wxml), 'wxml 里还挂着 bindtap="goRepair"');
  ok(!/iFix/.test(js), 'iFix 图标没人用了，留着就是死代码');
  ok(!/dtc-btn\.ghost/.test(wxss), '.dtc-btn.ghost 成了死样式（7.4.1 那批刚清过死 CSS）');
  ok(!/detail_repair/.test(js), 'detail_repair 埋点还在发 —— 入口没了就没有可发的时刻');
});

t('全项目不再有「即将上线」类空承诺（红线④：不做假按钮）', () => {
  const words = /即将上线|敬请期待|暂未开放|正在开发/;
  const hit = [];
  const walk = (d) => fs.readdirSync(d).forEach((f) => {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'node_modules') walk(p); return; }
    if (!/\.(js|wxml)$/.test(f)) return;
    if (words.test(strip(fs.readFileSync(p, 'utf8')))) hit.push(path.relative(ROOT, p));
  });
  ['pages', 'components', 'utils'].forEach((d) => walk(path.join(ROOT, d)));
  ok(hit.length === 0, '又出现了空承诺话术：' + hit.join(', '));
});

// ════════════════════════════════════════════════════════════
console.log('\n【四、D-DUP-1 签到基础分：产品规则钉成测试（结构）】');

t('云端 SIGN_BASE_POINTS = 5，且只此一处下发', () => {
  const src = read('cloudfunctions/saveTicket/index.js');
  const m = src.match(/const SIGN_BASE_POINTS = (\d+)/);
  ok(m, '云端找不到 SIGN_BASE_POINTS —— 常量改名了就该来改这条断言');
  ok(Number(m[1]) === 5, '签到基础分被改成 ' + m[1] + ' 了。这是产品规则（R2 表：每日签到 +5），'
    + '改它必须是有意的：改完同步 docs/PRD.md 与这条断言');
  ok(/base:\s*SIGN_BASE_POINTS/.test(src), '下发里没带 base，端上会显示 0 分');
  ok(/let points = SIGN_BASE_POINTS/.test(src), '结算没用这个常量（可能是另写了一个字面量）');
});

t('端上不存「5 分」这份副账，只认服务端下发的 base', () => {
  const src = read('utils/sign.js');
  ok(!/SIGN_BASE|BASE_POINTS\s*=\s*5/.test(src), '端上又出现了基础分常量 —— 两份数字早晚说两套话');
  ok(/s\s*&&\s*s\.base/.test(src) || /\.base\b/.test(src), '端上没读服务端的 base');
});

// ════════════════════════════════════════════════════════════
console.log('\n【五、D-TZ-1 订阅闸门用北京时间（真跑 + 换时区复测）】');

global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {},
  requestSubscribeMessage: () => {},
  cloud: { callFunction: () => Promise.resolve({ result: { ok: true } }) }
};
delete require.cache[require.resolve('../utils/subscribe.js')];
const subscribe = require('../utils/subscribe.js');

t('北京「今天」问过 → 不再弹；北京「昨天」问过 → 还能弹', () => {
  const LS = new Map();
  global.wx = {
    getStorageSync: (k) => (LS.has(k) ? LS.get(k) : ''),
    setStorageSync: (k, v) => { LS.set(k, v); },
    requestSubscribeMessage: () => {}, // 没有它 annivAskable 直接 false（假入口守卫），测的就不是日期了
    cloud: { callFunction: () => Promise.resolve({ result: { ok: true } }) }
  };
  const bjToday = (() => {
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  })();
  LS.set('sp_sub_anniv', { ymd: bjToday });
  ok(subscribe.annivAskable() === false, '北京今天已经问过，还允许再弹（= 会连着骚扰两次）');
  LS.set('sp_sub_anniv', { ymd: '2000-01-01' });
  ok(subscribe.annivAskable() === true, '昨天问过的，今天应当还能问');
});

t('换个时区（纽约）复测：闸门仍按北京日期走', () => {
  // 这一条必须起子进程：Node 的 TZ 只在进程启动时读一次。
  // 挑的instant 是「北京已是 9-20 凌晨 00:30、纽约还是 9-19 中午」——
  // 用设备时区的实现会拿 9-19 去比，种进去的北京「今天」（9-20）就对不上，闸门漏开。
  const script = `
    const R = Date.UTC(2026, 8, 19, 16, 30); // 北京 2026-09-20 00:30 / 纽约 2026-09-19 12:30
    Date.now = () => R;
    const LS = { sp_sub_anniv: { ymd: '2026-09-20' } };   // 北京今天
    global.wx = {
      getStorageSync: (k) => (LS[k] === undefined ? '' : LS[k]),
      setStorageSync: () => {}, requestSubscribeMessage: () => {},
      cloud: { callFunction: () => Promise.resolve({ result: { ok: true } }) }
    };
    const s = require(${JSON.stringify(path.join(ROOT, 'utils', 'subscribe.js'))});
    process.stdout.write(String(s.annivAskable(R)));
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    env: Object.assign({}, process.env, { TZ: 'America/New_York' })
  }).toString().trim();
  ok(out === 'false', '换到纽约时区就漏开了（' + out + '）—— 说明闸门还在用设备本地日期，'
    + '不是 UTC+8 口径：跨零点那两小时会重弹或漏弹');
});

// ════════════════════════════════════════════════════════════
console.log('\n【六、P-5 包体积台账（结构）】');

t('上传脚本会打印主包体积并记台账，超红线要喊一声', () => {
  const src = read('scripts/ci/upload.js');
  ok(/subPackageInfo/.test(src), '没读上传返回里的包体积');
  ok(/SIZE_LIMIT_KB\s*=\s*2048/.test(src), '主包上限 2 MB 没写死成常量');
  ok(/SIZE_DELTA_KB\s*=\s*20/.test(src), '「每版本增幅 ≤ 20 KB」红线丢了');
  ok(/pkg-size\.json/.test(src), '没有台账文件，就没法算「比上一版涨了多少」');
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
