// tests/xhs_export.test.js —— 小红书素材「导出到相册」这段逻辑，**真跑一遍**
// ============================================================
// 8.0.3 修的是「iOS 上离屏画布导不出图」：主路径 canvasToTempFilePath 在 iOS 上必失败，
// 得靠 toDataURL 回退；另有「PC 微信上这个 Promise 永不 settle」的说法，所以还得有超时。
// 这段逻辑是整个素材功能能不能用的关键，可它的分支（成功 / 失败 / 挂起 / 全挂）在
// tests/audit_0803.test.js 里只被正则扫过 —— 扫不出「回退分支写反了」这类错。
// 这里改用真跑：从 card.js 抠出 _exportOffscreen 的方法体，配一个假 wx，把四条路都走一遍。
// 跑的是源码里那段真代码（与 card_postcard 跑绘制函数同一手法），不是副本。
// ============================================================
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'pages/card/card.js'), 'utf8');
const jsClean = js.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

/** 抠出一个方法的函数体（大括号配对）—— 注释已去掉，字符串里的括号会被跳过。
 *  要传完整签名（'async _exportOffscreen(off)'）：只传名字的话会先命中别处的调用点，抓到别人的函数体 */
function grabMethod(src, name) {
  const i = src.indexOf(name);
  if (i < 0) throw new Error('card.js 里找不到 ' + name);
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

const BODY = grabMethod(jsClean, 'async _exportOffscreen(off)');
const TIMEOUT = 60; // 真跑用 60ms，别让测试等 3 秒
/** 造一个可直接调用的 _exportOffscreen（喂进假 wx） */
const makeExport = (wxMock) => new Function('wx', 'XHS_W', 'XHS_H', 'EXPORT_TIMEOUT_MS',
  'return async function (off) {' + BODY + '};')(wxMock, 1080, 1440, TIMEOUT);

/** 假的文件系统：记下写盘请求，按需成功或失败 */
function fakeFs(store, failWrite) {
  return {
    writeFile(o) {
      if (failWrite) return o.fail(new Error('磁盘满'));
      store.push(o);
      o.success();
    }
  };
}

/** 假的基础 wx（只有 _exportOffscreen 会碰到的那些） */
const baseWx = (over) => Object.assign({
  env: { USER_DATA_PATH: 'wxfile://usr' },
  getFileSystemManager: () => fakeFs([])
}, over);

const OFF_OK = { toDataURL: () => 'data:image/png;base64,AAAA' };

(async () => {
  // ══════════════════════════════════════════════════════════
  console.log('\n【一、主路径可用：直接用 canvasToTempFilePath 的产物】');
  {
    let seen = null;
    const wxMock = baseWx({
      canvasToTempFilePath: (o) => { seen = o; return Promise.resolve({ tempFilePath: '/tmp/x.png' }); }
    });
    const r = await makeExport(wxMock)({ toDataURL: () => { throw new Error('不该走回退'); } });
    try {
      ok(r.path === '/tmp/x.png' && r.temp === true, '主路径的返回值不对：' + JSON.stringify(r));
      ok(seen.width === 1080 && seen.height === 1440 && seen.destWidth === 1080 && seen.destHeight === 1440,
        '导出尺寸没定死 1080×1440（缺失的话真机会按 dpr 再乘一遍）：' + JSON.stringify(seen));
      ok(seen.x === 0 && seen.y === 0, '没给起点，默认值在不同机型上不一样');
      console.log('  PASS  主路径成功时直接返回，且尺寸四个参数都传了');
      pass++;
    } catch (e) { fail++; console.log('  FAIL  ' + e.message); }
  }

  // ══════════════════════════════════════════════════════════
  console.log('\n【二、主路径失败（iOS 的 invalid viewId）：退到 toDataURL + 写临时文件】');
  {
    const store = [];
    const wxMock = baseWx({
      canvasToTempFilePath: () => Promise.reject(new Error('canvasToTempFilePath:fail invalid viewId')),
      getFileSystemManager: () => fakeFs(store)
    });
    try {
      const r = await makeExport(wxMock)(OFF_OK);
      ok(r.temp === false, '回退路径必须标成 temp=false（调用方靠它决定要不要删临时文件）');
      ok(store.length === 1, '没有写临时文件');
      ok(store[0].encoding === 'base64', '写盘编码不是 base64 —— 二进制的 PNG 会被写坏');
      ok(store[0].data === 'AAAA', 'data-uri 前缀没剥掉：' + store[0].data);
      ok(/^wxfile:\/\/usr\/xhs-\d+\.png$/.test(r.path), '临时文件路径不对：' + r.path);
      console.log('  PASS  iOS 那条路上能拿到图（剥前缀 + base64 落盘）');
      pass++;
    } catch (e) { fail++; console.log('  FAIL  ' + e.message); }
  }

  // ══════════════════════════════════════════════════════════
  console.log('\n【三、主路径挂起（PC 微信上的「永不 settle」）：超时后照样退到回退】');
  {
    const store = [];
    const wxMock = baseWx({
      canvasToTempFilePath: () => new Promise(() => {}), // 永不 settle
      getFileSystemManager: () => fakeFs(store)
    });
    try {
      const r = await makeExport(wxMock)(OFF_OK);
      ok(r.temp === false && store.length === 1, '挂起时没有走回退 —— 这会让 exporting 永远为 true、遮罩盖死整页');
      console.log('  PASS  主路径挂起不会把用户卡在 loading 里');
      pass++;
    } catch (e) { fail++; console.log('  FAIL  ' + e.message); }
  }

  // ══════════════════════════════════════════════════════════
  console.log('\n【四、两条路都拿不到图：抛错，让调用方弹「保存失败」】');
  {
    const wxMock = baseWx({
      canvasToTempFilePath: () => Promise.reject(new Error('fail')),
      getFileSystemManager: () => fakeFs([], true)
    });
    let threw = false;
    try { await makeExport(wxMock)({ toDataURL: () => '' }); } catch (e) { threw = true; }
    try {
      ok(threw, 'toDataURL 也空的时候必须抛错 —— 悄悄返回一个空路径，saveImageToPhotosAlbum 会存进一张坏图');
      console.log('  PASS  全挂时抛错，不静默成功');
      pass++;
    } catch (e) { fail++; console.log('  FAIL  ' + e.message); }
  }

  console.log('\n测试套件：xhs_export —— ' + pass + ' 通过 / ' + fail + ' 失败\n');
  process.exit(fail ? 1 : 0);
})();
