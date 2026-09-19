// tests/wall_img_check.test.js —— 8.1.3 同场票根墙「照片送检」
// ============================================================
// 【补的是什么洞】8.1.0 建墙时，文字从第一版就检了（title + venue 过 secGate），
// **照片一张没检**。而墙是全项目唯一一个陌生人可读的出口 —— 别人传的图，陌生人直接看到。
// 这不是「可以做得更好」，是「本来就该有却没有」。
//
// 【为什么送检的不是原图】imgSecCheck 只吃 ≤1MB 且 ≤750×1334 的图，票根原图长边 1600。
// 所以端上在上墙那一下另压一张长边 750 的小图（约 100KB）送去，**并且墙上展示的就是它**
// （wallImg）—— 展示的与送检的是同一张，才堵得住「送检一张良性的、展示一张违规的」。
//
// 这套钉住四件事：
//   ① 端上真的做了那张小图（横图给宽、竖图给高，两个都给会把图压扁）；
//   ② 图没准备好**就不许上墙**（宁可上不去，不能带一张没检的图上去）；
//   ③ 云端「平台故障 ≠ 放行」：抖动重试一次，两次都异常才拒；违规直接拒、不重试；
//   ④ 展示口取 wallImg（而不是票根原图 img）—— 取错了，这套的所有努力都白做。
// ============================================================
const path = require('path');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const ROOT = path.resolve(__dirname, '..');
const WALLIMG = require(path.join(ROOT, 'cloudfunctions/saveTicket/wallimg.js'));

// ════════════════════════════════════════════════════════════
// wx 桩（端上那半：store.js 要真跑）
// ════════════════════════════════════════════════════════════
const LS = new Map();
let calls = [], downloads = [], uploads = [], compresses = [];
let dlReject = null, upReply = { fileID: 'cloud://env.abc/wall/thumb-1.jpg' }, czReject = null;
let imgInfo = { width: 1600, height: 1200 }; // 一张横图
let cloudReply = { ok: true, on: true };

global.wx = {
  getStorageSync: (k) => (LS.has(k) ? LS.get(k) : ''),
  setStorageSync: (k, v) => { LS.set(k, v); },
  removeStorageSync: (k) => { LS.delete(k); },
  showToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  vibrateShort: () => {},
  getWindowInfo: () => ({ pixelRatio: 2 }),
  getSystemInfoSync: () => ({ platform: 'ios' }),
  getImageInfo: (o) => {
    if (imgInfo) o.success(imgInfo);
    else o.fail(new Error('getImageInfo:fail'));
  },
  compressImage: (o) => {
    compresses.push(o);
    if (czReject) return o.fail(czReject);
    return o.success({ tempFilePath: '/tmp/small.jpg' });
  },
  cloud: {
    downloadFile: (o) => {
      downloads.push(o.fileID);
      if (dlReject) return Promise.reject(dlReject);
      return Promise.resolve({ tempFilePath: '/tmp/ticket.jpg' });
    },
    uploadFile: (o) => { uploads.push(o); return Promise.resolve(upReply); },
    callFunction: (o) => { calls.push(o); return Promise.resolve({ result: cloudReply }); }
  }
};

const store = require(path.join(ROOT, 'utils/store.js'));
const REAL_ID = 'real_ticket_8f21';       // 不能被 isMockTicket 认成演示数据
const TICKET_IMG = 'cloud://env.abc/tickets/1730000000-abc.jpg';

function reset() {
  LS.clear();
  calls = []; downloads = []; uploads = []; compresses = [];
  dlReject = null; czReject = null;
  upReply = { fileID: 'cloud://env.abc/wall/thumb-1.jpg' };
  imgInfo = { width: 1600, height: 1200 };
  cloudReply = { ok: true, on: true };
}

// ════════════════════════════════════════════════════════════
console.log('\n【一、端上：上墙前真的另做了一张小图】');

(async () => {
t('横图：压到长边 750（只给宽，两个都给会把图压扁）', async () => {
  reset();
  await store.setWallPublic(REAL_ID, true, TICKET_IMG);
  ok(downloads.length === 1 && downloads[0] === TICKET_IMG, '没下载票根原图（端上手上没有它的本地副本）');
  ok(compresses.length === 1, '没压缩');
  ok(compresses[0].compressedWidth === 750 && compresses[0].compressedHeight === undefined,
    '压缩参数不对：' + JSON.stringify({ w: compresses[0].compressedWidth, h: compresses[0].compressedHeight }));
  ok(uploads.length === 1 && /^wall\//.test(uploads[0].cloudPath), '小图没传到 wall/ 目录下：' + (uploads[0] || {}).cloudPath);
  const d = calls[0].data;
  ok(d.action === 'wallJoin' && d.thumb === 'cloud://env.abc/wall/thumb-1.jpg', 'wallJoin 没带上送检小图的 fileID：' + JSON.stringify(d));
});

t('竖图：只给高（给宽等于按宽拉伸，竖图会扁）', async () => {
  reset();
  imgInfo = { width: 1200, height: 1600 };
  await store.setWallPublic(REAL_ID, true, TICKET_IMG);
  ok(compresses[0].compressedHeight === 750 && compresses[0].compressedWidth === undefined,
    '竖图压缩参数不对：' + JSON.stringify({ w: compresses[0].compressedWidth, h: compresses[0].compressedHeight }));
});

t('原图下载不到 → 抛错，且**根本没调上墙接口**', async () => {
  reset();
  dlReject = new Error('downloadFile:fail');
  let thrown = null;
  try { await store.setWallPublic(REAL_ID, true, TICKET_IMG); } catch (e) { thrown = e; }
  ok(!!thrown, '图没拿到却静默成功了');
  ok(calls.length === 0, '图没准备好就把票放上墙了 —— 墙上会挂一张谁都没检过的图');
});

t('小图没传上（没回 fileID）→ 同样抛错、不上墙', async () => {
  reset();
  upReply = {};
  let thrown = null;
  try { await store.setWallPublic(REAL_ID, true, TICKET_IMG); } catch (e) { thrown = e; }
  ok(!!thrown, '上传失败却静默成功了');
  ok(calls.length === 0, '上传失败还是把票放上墙了');
});

t('本机压不动（老基础库）→ 用原图继续，不挡着用户上墙', async () => {
  reset();
  czReject = new Error('compressImage:fail:not supported');
  await store.setWallPublic(REAL_ID, true, TICKET_IMG);
  ok(uploads.length === 1 && uploads[0].filePath === '/tmp/ticket.jpg', '压缩失败后没退回原图');
  ok(calls.length === 1 && calls[0].data.thumb, '没把（原图的）fileID 送上去 —— 服务端还有一道体积闸，超了它会给话');
});

t('没有照片的票：不下载、不上传，thumb 传空串', async () => {
  reset();
  await store.setWallPublic(REAL_ID, true, '');
  ok(downloads.length === 0 && uploads.length === 0, '没图还去下载/上传了');
  ok(calls.length === 1 && calls[0].data.thumb === '', 'thumb 不是空串');
});

t('撤下：不碰图（墙上那张由服务端一并删）', async () => {
  reset();
  await store.setWallPublic(REAL_ID, false, TICKET_IMG);
  ok(downloads.length === 0 && uploads.length === 0 && compresses.length === 0, '撤下还去折腾了一遍图');
  ok(calls[0].data.thumb === '', '撤下带了 thumb');
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、云端 wallimg：平台故障不等于放行】');

/** 假的 wx-server-sdk：只给 wallimg 用到的那三样 */
function fakeCloud(o) {
  const c = {
    _checks: 0, _dropped: [],
    downloadFile: async () => {
      if (o.dlFail) throw new Error('downloadFile:fail');
      return { fileContent: o.buf === undefined ? Buffer.alloc(1000) : o.buf };
    },
    deleteFile: async ({ fileList }) => {
      if (o.delFail) throw new Error('deleteFile:fail');
      c._dropped = c._dropped.concat(fileList);
    },
    openapi: { security: { imgSecCheck: async (args) => {
      c._checks++;
      c._last = args;
      if (o.secFail) throw o.secFail;
      return { errCode: 0 };
    } } }
  };
  return c;
}

t('合规图：过检，且送检的确实是图片二进制', async () => {
  const cloud = fakeCloud({});
  const r = await WALLIMG.gate(cloud, 'cloud://env.abc/wall/thumb-1.jpg');
  ok(r.ok, '合规图被拒了：' + JSON.stringify(r));
  ok(cloud._checks === 1, '调了 ' + cloud._checks + ' 次（正常 1 次）');
  ok(Buffer.isBuffer(cloud._last.media.value), 'media.value 不是 Buffer —— 云调用要求二进制');
  ok(cloud._last.media.contentType === 'image/jpeg', 'contentType 不对：' + cloud._last.media.contentType);
});

t('87014（内容违规）→ 拒，且不重试（重试还是同一张图）', async () => {
  const cloud = fakeCloud({ secFail: { errCode: 87014, errMsg: 'risky content' } });
  const r = await WALLIMG.gate(cloud, 'cloud://env.abc/wall/thumb-1.jpg');
  ok(r.ok === false && /未通过安全检查/.test(r.msg), '违规图没被挡住：' + JSON.stringify(r));
  ok(cloud._checks === 1, '违规还重试了 ' + cloud._checks + ' 次');
});

t('超过 1MB 的图：不送检，直接拒（送过去也是报错）', async () => {
  const cloud = fakeCloud({ buf: Buffer.alloc(WALLIMG.IMG_MAX + 1) });
  const r = await WALLIMG.gate(cloud, 'cloud://env.abc/wall/thumb-1.jpg');
  ok(r.ok === false && /太大/.test(r.msg), '超大图没被挡住：' + JSON.stringify(r));
  ok(cloud._checks === 0, '还是把它送去检了');
});

t('接口抖动（errCode -1）→ 重试一次，两次都异常才拒', async () => {
  const cloud = fakeCloud({ secFail: { errCode: -1, errMsg: 'system error' } });
  const r = await WALLIMG.gate(cloud, 'cloud://env.abc/wall/thumb-1.jpg');
  ok(r.ok === false, '两次都异常却放行了 —— 这就是「挑腾讯抖动的时候提交」那条旁路');
  ok(cloud._checks === 2, '抖动没重试：调了 ' + cloud._checks + ' 次');
  ok(/暂时不可用/.test(r.msg), '给用户的不是人话：' + r.msg);
});

t('抖一下就好了：第二次成功 → 放行', async () => {
  let n = 0;
  const cloud = fakeCloud({});
  const orig = cloud.openapi.security.imgSecCheck;
  cloud.openapi.security.imgSecCheck = async (a) => { n++; if (n === 1) throw { errCode: -1 }; return orig(a); };
  const r = await WALLIMG.gate(cloud, 'cloud://env.abc/wall/thumb-1.jpg');
  ok(r.ok, '第一次抖动就判了死刑 —— 重试等于白写');
  ok(n === 2, '调了 ' + n + ' 次');
});

t('删图：只删本环境的 fileID；删不掉不往外抛', async () => {
  const a = fakeCloud({});
  await WALLIMG.drop(a, 'cloud://env.abc/wall/thumb-1.jpg');
  ok(a._dropped.length === 1, '没删掉小图（它会一直占着存储）');
  const b = fakeCloud({});
  await WALLIMG.drop(b, 'https://evil.example.com/x.jpg');
  ok(b._dropped.length === 0, '把非云存储地址也送进 deleteFile 了');
  const c = fakeCloud({ delFail: true });
  let thrown = null;
  try { await WALLIMG.drop(c, 'cloud://env.abc/wall/thumb-1.jpg'); } catch (e) { thrown = e; }
  ok(!thrown, '删图失败抛出来了 —— 它挂在上墙主流程上，一抛就是「用户点一下看到报错」');
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、接线（漏一处，上面全部白做）】');

t('config.json 里声明了 security.imgSecCheck 权限', () => {
  const cfg = JSON.parse(require('fs').readFileSync(path.join(ROOT, 'cloudfunctions/saveTicket/config.json'), 'utf8'));
  const list = (cfg.permissions && cfg.permissions.openapi) || [];
  ok(list.indexOf('security.imgSecCheck') >= 0,
    '没声明权限 —— 云调用会直接失败，而且端上只会看到「图片安检暂时不可用」这种含糊话');
  ok(list.indexOf('security.msgSecCheck') >= 0, '顺手把原来的文字安检权限弄丢了');
});

t('展示口取 wallImg（送检过的那张），不取票根原图 img', () => {
  const src = require('fs').readFileSync(path.join(ROOT, 'cloudfunctions/saveTicket/index.js'), 'utf8');
  const body = src.slice(src.indexOf('async function wallListAction'), src.indexOf('P2-1 入库白名单'));
  ok(/wallImg: true/.test(body), 'field() 没取 wallImg');
  ok(!/img: CLOUD_FILEID_RE\.test\(String\(t\.img/.test(body),
    '展示口又回去取票根原图了 —— 那张图没送检过，等于把洞挖回来');
  ok(/img: CLOUD_FILEID_RE\.test\(String\(t\.wallImg/.test(body), '回给端上的 img 不是 wallImg');
});

t('wallJoin：图没过检就 return（不许先落库再检）', () => {
  const src = require('fs').readFileSync(path.join(ROOT, 'cloudfunctions/saveTicket/index.js'), 'utf8');
  const body = src.slice(src.indexOf('async function wallJoinAction'), src.indexOf('async function wallListAction'));
  const gateAt = body.indexOf('wallimg.gate(cloud, img)');
  const upAt = body.indexOf('.update({ data: { wallPublic: on');
  ok(gateAt > 0, 'wallJoin 里没调图片闸门');
  ok(upAt > gateAt, '先落库后检图 —— 检不过也已经在墙上了');
  ok(/if \(!ig\.ok\)[\s\S]{0,200}return \{ ok: false/.test(body), '检不过没有挡下来');
  ok(/wallimg\.gate/.test(body) && !/imgSecCheck/.test(body), '图片安检被内联回 index.js 了（那样就测不到了）');
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
