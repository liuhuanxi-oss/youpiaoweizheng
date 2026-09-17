// tests/audit_0804.test.js —— 8.0.4 四路体检的修复
// ============================================================
// 这一轮查的不是「代码会不会报错」，而是**代码在说什么**：
//   · 删掉的演示票在云故障兜底里复活（用户会认定「这 App 的删除是假的」）
//   · 第一句甩给用户的英文报错、给开发者看的后台操作口令
//   · 导出的是 AI 图，图上却没有任何 AI 标识（协议里承诺过「展示时已标注」）
//   · 高分相机原图直出（CDN 流量是全项目唯一随用户数线性增长的支出）
// 共同点：这些**全都不报错**。所以断言钉死行为 —— 改回旧写法必须当场红。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const storeRaw = read('utils/store.js');
const storeClean = strip(storeRaw);
const scanRaw = read('pages/scan/scan.js');
const scanClean = strip(scanRaw);

/** 抠出一个方法的函数体（大括号配对）。
 *  ⚠️ 签名要一直写到左大括号（'friendlyOcrError(e) {'）：只写 'friendlyOcrError(e)' 的话，
 *  indexOf 会先命中调用点 `this.friendlyOcrError(e)`，从那里往后找的 `{` 是**下一个**方法的，
 *  抠回来的是别人的函数体 —— 实测就是这么静默失败的（第一版两条用例全绿着骗人）。
 *  这个坑在 xhs_export 那套里也踩过一次。 */
function grabMethod(src, name) {
  const i = src.indexOf(name);
  if (i < 0) throw new Error('找不到 ' + name);
  const start = src.indexOf('{', i);
  let depth = 0;
  for (let k = start; k < src.length; k++) {
    const ch = src[k];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (k++; k < src.length && src[k] !== ch; k++) if (src[k] === '\\') k++;
    } else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) return src.slice(start + 1, k); }
  }
  throw new Error('括号不配对：' + name);
}

/** 取出源码里所有 `wx.showXxx({ ... })` 的实参文本（按花括号配平切）。
 *  ⚠️ 不能开固定长度的窗口往后找关键字：下一个弹窗的内容会串进来，改坏了照样绿。 */
function dialogArgs(js, fnName) {
  const out = [];
  const re = new RegExp('wx\\.' + fnName + '\\(\\s*\\{', 'g');
  let m;
  while ((m = re.exec(js))) {
    const i = js.indexOf('{', m.index);
    let depth = 0, j = i;
    for (; j < js.length; j++) {
      if (js[j] === '{') depth++;
      else if (js[j] === '}') { depth--; if (!depth) break; }
    }
    out.push(js.slice(i, j + 1));
    re.lastIndex = j;
  }
  return out;
}

// ════════════════════════════════════════════════════════════
// 真跑 store.js：假 wx / 假 require 一起注入（手法同 store_cache.test.js）
// ════════════════════════════════════════════════════════════
const MOCK = [
  { id: 'mock_1', title: '演示票一', type: 'show', date: '2025-01-01' },
  { id: 'mock_2', title: '演示票二', type: 'movie', date: '2025-02-02' }
];

function makeStore(opt) {
  const o = opt || {};
  const state = {
    fail: !!o.fail,
    files: [],
    docRemoves: 0,
    storage: Object.assign({}, o.storage)
  };
  const chain = {
    count: async () => { if (state.fail) throw new Error('db down'); return { total: 0 }; },
    orderBy() { return chain; },
    skip() { return chain; },
    limit() { return chain; },
    get: async () => { if (state.fail) throw new Error('db down'); return { data: [] }; },
    doc: () => ({
      get: async () => ({ data: o.doc || {} }),
      remove: async () => { state.docRemoves++; return { stats: { removed: 1 } }; }
    })
  };
  const wx = {
    cloud: {
      database: () => { if (state.fail) throw new Error('db down'); return { collection: () => chain }; },
      callFunction: async () => ({ result: { ok: true } }),
      deleteFile: async (x) => { state.files = state.files.concat(x.fileList || []); return {}; }
    },
    getStorageSync: (k) => state.storage[k],
    setStorageSync: (k, v) => { state.storage[k] = v; }
  };
  const fakeRequire = (p) => {
    if (p === './env.js') return { USE_CLOUD: true };
    if (p === './mock.js') return { tickets: MOCK, MOCK_IDS: MOCK.map((m) => m.id) };
    throw new Error('测试没给这个依赖搭桩：' + p);
  };
  const mod = {};
  new Function('require', 'wx', 'module', storeRaw)(fakeRequire, wx, mod);
  return { store: mod.exports, state };
}

// ════════════════════════════════════════════════════════════
console.log('\n【一、云故障兜底：删过的演示票不许复活】');

t('隐藏名单在兜底这一支同样生效', async () => {
  const { store } = makeStore({ fail: true, storage: { sp_deleted_ids: ['mock_1'] } });
  const rows = await store.listTickets();
  const ids = rows.map((r) => String(r.id));
  ok(ids.indexOf('mock_1') < 0,
    '删过的演示票又出现在兜底列表里 —— 用户点删除、看到「已删除」，票却原地站着');
  ok(ids.indexOf('mock_2') >= 0, '另一张没删的演示票也不见了（滤过头了）');
});

t('兜底确实走了演示数据这条路（否则上一条等于没测）', async () => {
  const { store } = makeStore({ fail: true });
  const rows = await store.listTickets();
  ok(rows.length >= 2, '云故障时没兜底成演示数据，第一条断言测的是空气：' + rows.length);
  ok(store.listFlags().netFallback === true, '兜底了却没亮标志 —— 页面不会告诉用户这不是他的票');
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、删票：照片与 AI 图版一起删】');

t('img 与 artVersion.fileID 都要进云存储删除清单', async () => {
  const { store, state } = makeStore({
    doc: { _id: 'real_1', img: 'cloud://env.abc/p.jpg', artVersion: { fileID: 'cloud://env.abc/art.png' } }
  });
  await store.removeTicket('real_1');
  ok(state.docRemoves === 1, '记录没删掉');
  ok(state.files.indexOf('cloud://env.abc/p.jpg') >= 0,
    '票根照片没删 —— 用户以为删干净了，隐私政策也是这么写的');
  ok(state.files.indexOf('cloud://env.abc/art.png') >= 0,
    'AI 图版没删：它是这张票的另一份影像，删票后仍留在云存储里（每幅 1~2MB，只增不减）');
});

t('没有图版的老票不许因此报错（artVersion 可能是 undefined）', async () => {
  const { store, state } = makeStore({ doc: { _id: 'real_1', img: 'cloud://env.abc/p.jpg' } });
  await store.removeTicket('real_1');
  ok(state.docRemoves === 1 && state.files.length === 1, '老票的删除路径被带偏了');
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、上传前压分辨率：只给一边，别把竖图压扁】');

t('长边上限常量与压缩参数都在', () => {
  ok(/UPLOAD_MAX_SIDE\s*=\s*\d+/.test(scanClean), '没有长边上限常量');
  ok(/wx\.compressImage\(/.test(scanClean), '上传前根本没压缩');
  ok(/compressedWidth/.test(scanClean) && /compressedHeight/.test(scanClean),
    '只压了质量没压分辨率 —— 高分相机原图 0.5~1.5MB 一张，而它会被反复加载');
});

t('按长边选一边给（两边同时给 = 拉伸变形）', () => {
  ok(/size\.w >= size\.h\s*\?\s*[\s\S]{0,40}compressedWidth/.test(scanClean) ||
     /if \(size\.w >= size\.h\) opt\.compressedWidth = UPLOAD_MAX_SIDE;/.test(scanClean),
    '横竖图没分开处理：竖图会被按宽度压扁');
  ok(!/compressedWidth[^;]*compressedHeight/.test(scanClean) &&
     !/compressedHeight[^;]*compressedWidth/.test(scanClean),
    '两边同时传 —— 那是拉伸目标，不是缩放上限');
});

t('量不出尺寸就退回原图，不能把照片弄丢', () => {
  ok(/longSideOf/.test(scanClean), '没有取尺寸的函数');
  const body = grabMethod(scanClean, 'function longSideOf(src)');
  ok(/fail:\s*\(\)\s*=>\s*resolve\(null\)/.test(body), '取尺寸失败没有兜底 —— 会让整张照片传不上去');
});

// ════════════════════════════════════════════════════════════
console.log('\n【四、导出的 AI 图必须有 AI 标识】');

t('art 页导出的图版：品牌水印还在，且补上了「AI 生成」', () => {
  const art = strip(read('pages/art/art.js'));
  ok(/fillText\([^)]*AI 生成/.test(art),
    '图版上没有任何 AI 标识 —— 一张 AI 图发出去，谁也不知道它是生成的');
  ok(/你的时光档案馆/.test(art), '品牌水印被覆盖式改没了');
});

t('详情页 AI 文案的角标写着「AI 生成」', () => {
  const wxml = read('pages/detail/detail.wxml').replace(/<!--[\s\S]*?-->/g, '');
  ok(/AI 生成/.test(wxml),
    '角标没写「AI 生成」—— 协议 §四 承诺的是「展示时已标注"AI 生成"」，承诺和实物要对得上');
});

// ════════════════════════════════════════════════════════════
console.log('\n【五、对用户可见的字样里不出现平台名】');

t('卡片页的 wxml 不含「小红书」', () => {
  const wxml = read('pages/card/card.wxml').replace(/<!--[\s\S]*?-->/g, '');
  ok(!/小红书/.test(wxml),
    '按钮文案还写着平台名 —— 微信把「明确指向第三方内容平台」的功能当站外导流，而提审描述里自己承诺不点名');
});

t('卡片页的弹窗 / toast / 选项列表不含「小红书」', () => {
  const js = strip(read('pages/card/card.js'));
  const visible = dialogArgs(js, 'showToast').concat(dialogArgs(js, 'showModal'));
  const lists = js.match(/itemList:\s*\[[^\]]*\]/g) || [];
  [].concat(visible, lists).forEach((s) => {
    ok(!/小红书/.test(s), '用户看得见的地方还写着平台名：' + s.replace(/\s+/g, ' ').slice(0, 70));
  });
});

// ════════════════════════════════════════════════════════════
console.log('\n【六、给开发者看的后台操作指引，不许弹给用户】');

t('pay / scan / detail 的弹窗里没有云控制台或公众平台的操作路径', () => {
  const files = ['utils/pay.js', 'pages/scan/scan.js', 'pages/detail/detail.js'];
  files.forEach((p) => {
    const js = strip(read(p));
    const dialogs = dialogArgs(js, 'showModal').concat(dialogArgs(js, 'showToast'));
    dialogs.forEach((s) => {
      ok(!/云开发控制台|mp\.weixin\.qq\.com|数据库\s*→/.test(s),
        p + ' 把后台操作指引弹给了用户（用户看不懂，审核员看到像半成品）：' + s.replace(/\s+/g, ' ').slice(0, 70));
    });
  });
});

t('细节没丢：挪进 console 的信息还得在（否则出事后无从查）', () => {
  ok(/console\.warn\(\[pay\][\s\S]{0,120}云开发控制台/.test(strip(read('utils/pay.js')).replace(/\n/g, ' ')) ||
     /console\.warn\(\s*'\[pay\][\s\S]{0,160}config/.test(read('utils/pay.js')),
    'pay.js 的 NO_CONFIG 细节既没弹给用户、也没记进日志 —— 出事了查不到原因');
});

// ════════════════════════════════════════════════════════════
console.log('\n【七、识别失败：第一句话是人话，不是平台报错】');

t('平台原始报错不再原样甩给用户', () => {
  const fn = new Function('return function (e) {' + grabMethod(scanClean, 'friendlyOcrError(e) {') + '};')();
  const out = fn({ errMsg: 'cloud.callFunction:fail Error: errCode: -404011 cloud function execution error' });
  ok(out && out.length > 0, '返回空串 —— 弹窗里只剩一片空白');
  ok(!/cloud\.|:fail|-404011|errCode/i.test(out), '把平台报错原文给用户看了：' + out);
});

t('两种有明确出路的错误仍然说清了怎么办', () => {
  const fn = new Function('return function (e) {' + grabMethod(scanClean, 'friendlyOcrError(e) {') + '};')();
  ok(/服务市场|额度/.test(fn({ errMsg: 'market quota exceeded' })), '配额不足那条人话没了');
  ok(/未开通|开通/.test(fn({ errMsg: 'no license permission denied' })), '服务未开通那条人话没了');
});

// ════════════════════════════════════════════════════════════
console.log('\n【八、AI 调用失败不许翻倍重发】');

t('只有「参数结构不对」才试第二种调用写法', () => {
  const ai = strip(read('utils/ai.js'));
  ok(/RETRYABLE/.test(ai), '没有区分可重试的错误');
  ok(/if \(RETRYABLE\.test\(raw1\)\)/.test(ai),
    '仍然无条件重试 —— 额度耗尽 / 网络超时时每次点击都变成两倍的失败请求');
  ok(/invalid\|parameter\|param\|signature/.test(ai), '可重试的错误类型没写全（参数类）');
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
  console.log('\n测试套件：audit_0804 —— ' + pass + ' 通过 / ' + fail + ' 失败\n');
  process.exit(fail ? 1 : 0);
})();
