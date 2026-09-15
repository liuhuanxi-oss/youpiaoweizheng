// tests/cloud_hardening.test.js —— 云端加固（体检报告 P2-1/3/4/6/8/11）
// ============================================================
// 为什么这批要单独一套：
//   ① 这几条全是**用户看不见的防线**：字段白名单被拆掉、安全检测又变回「服务异常即放行」、
//      识别接口不记次数 —— 出事之前没有任何界面表现，出事之后（额度被刷光 / 库里的票读不出来）
//      也已经晚了。所以每条都要留一个「改回去就红」的断言。
//   ② 白名单与安检闸门是纯逻辑，**真跑**（把云函数里的函数源码取出来执行），不扫源码猜；
//      识别配额那条配一个内存假库真跑，验「第 31 次会被拦下」。
//   ③ 剩下的（并行、并发上限、catch 不回传内部细节）是结构性的，用源码断言钉住。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

// 源码提取：**从原文取**（decomment 会把 /^cloud:\/\// 这类正则字面量截断）
const raw = read('cloudfunctions/saveTicket/index.js');
const scan = decomment(raw);
const ocrRaw = read('cloudfunctions/recognizeTicket/index.js');
const ocrScan = decomment(ocrRaw);

const pick = (re, label, src) => {
  const m = re.exec(src === undefined ? raw : src);
  ok(m, '找不到 ' + label);
  return m[0];
};
const fnOf = (name, src) => pick(new RegExp('(?:async )?function ' + name + '\\s*\\([\\s\\S]*?\\n\\}'), '函数 ' + name, src);
const constOf = (name, src) => pick(new RegExp('const ' + name + ' = [^;]+;'), '常量 ' + name, src);

/** 把云函数里的纯函数取出来真跑（依赖用参数注入，取值仍然取自真实源码） */
const evalFn = (name, deps, src) => {
  const body = fnOf(name, src) + '\nreturn ' + name + ';';
  return new Function(Object.keys(deps || {}).join(','), body).apply(null, Object.values(deps || {}));
};
/** 同上一个，但要几个函数互相调用、还要带上它们引用的常量（如 claimDailyQuota 用 bjYmd + OCR_DAILY_LIMIT） */
const evalGroup = (names, src, consts) => new Function(
  (consts || []).map((c) => constOf(c, src)).join('\n') + '\n' +
  names.map((n) => fnOf(n, src)).join('\n') +
  '\nreturn {' + names.join(',') + '};'
)();

// ════════════════════════════════════════════════════════════
console.log('\n【一、P2-1 入库白名单（真跑 sanitizeTicket）】');

const sanitize = new Function(
  constOf('CLOUD_FILEID_RE') + '\n' + constOf('TICKET_TEXT_MAX') + '\n' +
  fnOf('sanitizeTicket') + '\nreturn sanitizeTicket;'
)();

t('只放行会填的字段，其余一概不入库', () => {
  const out = sanitize({
    title: '回春丹巡演 · 武汉站', type: 'show', date: '2025-10-26', time: '20:00',
    venue: 'VOX Livehouse', city: '武汉', seat: 'A区 12排 07座', price: 180, source: '大麦',
    // ↓ 以下都是端上不该写、原实现却会原样入库的东西
    _openid: '别人的openid', eventKey: 'evt_伪造的', weather: { tempC: 25 },
    artVersion: { fileID: 'cloud://x.y/f.png' }, createdAt: 1, sortAt: 999,
    evil: '任意字段', nested: { a: { b: 1 } }
  });
  ['_openid', 'eventKey', 'weather', 'artVersion', 'createdAt', 'sortAt', 'evil', 'nested'].forEach((k) => {
    ok(out[k] === undefined, k + ' 不该入库（它不是端上该填的字段）');
  });
  ok(out.title === '回春丹巡演 · 武汉站' && out.venue === 'VOX Livehouse', '正常字段被误伤');
  ok(out.price === 180, '价格要原样交给主流程夹紧，不该在这里丢');
});

t('图片只收本环境云存储 fileID —— base64 图与外部地址一律丢', () => {
  ok(sanitize({ img: 'cloud://cloud1-x.y/tickets/a.jpg' }).img === 'cloud://cloud1-x.y/tickets/a.jpg',
    '正常的云存储 fileID 被拒了');
  // 一张 base64 图动辄几百 KB，几张就能把单文档顶到 1MB 上限（上限内也读得出来，但从此读不快）
  ok(sanitize({ img: 'data:image/png;base64,iVBORw0KGgo=' }).img === undefined, 'base64 图入库了');
  ok(sanitize({ img: 'https://example.com/a.jpg' }).img === undefined, '外部图片地址入库了');
  ok(sanitize({ img: '' }).img === undefined, '空图不该占字段');
});

t('超长文本按展示位截断，不是无限存', () => {
  const long = '票'.repeat(9999);
  const out = sanitize({ title: long, note: long, seat: long });
  ok(out.title.length === 60 && out.note.length === 500 && out.seat.length === 40,
    `截断长度不对：${out.title.length}/${out.note.length}/${out.seat.length}`);
  ok(sanitize({ title: 123 }).title === '123', '数字字段没转成字符串');
});

t('同场印记偏好不进库（它只在当次入库生效）', () => {
  ok(sanitize({ sameOptOut: true }).sameOptOut === undefined, '偏好被写进票根文档了');
  ok(/const sameOptOut = !!\(event\.ticket && event\.ticket\.sameOptOut\);/.test(scan),
    '偏好没在 sanitize 之外单独读取 —— 白名单一过滤，退出参与就失效了');
});

t('白名单真的接在入库主流程上（不是写了个函数没人用）', () => {
  ok(/const t = sanitizeTicket\(event\.ticket\);/.test(scan), '主流程没有过白名单');
  const iSan = scan.indexOf('const t = sanitizeTicket(event.ticket)');
  const iAdd = scan.indexOf("db.collection('tickets').add({ data: t })");
  ok(iAdd > iSan, '先入库后过滤：等于没过滤');
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、P2-3 安全检测（真跑 secGate）】');

function stubSec(seq) {
  let i = 0;
  const calls = [];
  const f = async (openid, content) => {
    calls.push(content);
    const r = seq[Math.min(i, seq.length - 1)];
    i++;
    return typeof r === 'function' ? r() : r;
  };
  f.calls = calls;
  return f;
}
const gateOf = (stub) => evalFn('secGate', { secCheck: stub });

t('通过 → 放行', async () => {
  const g = await gateOf(stubSec([{ result: 'pass', msg: '' }]))('o', '正常文案', '票面文字');
  ok(g.ok === true, '正常内容被拦了');
});

t('违规 → 拦下，并把原因说清楚', async () => {
  const g = await gateOf(stubSec([{ result: 'risky', msg: '内容有违规风险' }]))('o', '转发抽奖', '票面文字');
  ok(g.ok === false, '违规内容放行了');
  ok(/票面文字未通过安全检查/.test(g.msg), '拦截原因没说清：' + g.msg);
});

t('平台故障 → 重试一次，第二次过了就放行（抖动不该拦用户）', async () => {
  const stub = stubSec([{ result: 'error', msg: '' }, { result: 'pass', msg: '' }]);
  const g = await gateOf(stub)('o', '正常文案', '票面文字');
  ok(g.ok === true, '重试成功却被拒了');
  ok(stub.calls.length === 2, '没有重试（抖动一次就把用户挡在门外）');
});

t('两次都故障 → 拒绝，不再「服务异常即放行」', async () => {
  const stub = stubSec([{ result: 'error', msg: '' }]);
  const g = await gateOf(stub)('o', '违规内容', '票面文字');
  ok(g.ok === false, '平台故障时又放行了 —— 这等于给违规文本留了一条旁路');
  ok(stub.calls.length === 2, '没有重试就去拦用户');
  ok(!/error|exception|timeout/i.test(g.msg), '把内部故障词回给前端了：' + g.msg);
});

t('三处展示文本都走这道闸门（入库 / 文案 / 昵称）', () => {
  ok(/secGate\(OPENID, userText, '票面文字'\)/.test(scan), '入库文字没过闸门');
  ok(/secGate\(OPENID, caption, '文案'\)/.test(scan), 'AI 文案没过闸门');
  ok(/secGate\(OPENID, nickname, '昵称'\)/.test(scan), '昵称没过闸门');
  ok(!/sc\.result === 'risky'/.test(scan), '还有地方只拦 risky、error 照放');
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、P2-4 错误细节只进日志（不回传前端）】');

t('没有任何一处把 e.message / errMsg 拼进回前端的文案', () => {
  const leaks = scan.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /msg:\s*[^\n]*(e\.message|e\.errMsg|errMsg \|\| e|'unknown')/.test(line));
  ok(leaks.length === 0, '仍在回传内部细节：\n        ' + leaks.map(([n, l]) => n + ': ' + l.trim()).join('\n        '));
});

t('catch 统一走 failLog（细节进 console，人话回前端）', () => {
  ok(/function failLog\(tag, e, msg\)/.test(scan), '找不到 failLog');
  ok(/console\.error\('\+ \[tag\]/.test(scan) || /console\.error\('\[/.test(scan), 'failLog 没有落日志');
  const tags = (scan.match(/failLog\('(\w+)'/g) || []).map((s) => s.slice(9, -1));
  ['setCaption', 'reorder', 'reorderGroups', 'wxacode', 'backfillGeo', 'artRestyle',
    'authLogin', 'payCreate', 'artRewardGrant', 'profileSave', 'profileClear',
    'goodsImgSetup', 'bind', 'pointsRedeem', 'dailySign', 'duoStats', 'addTicket']
    .forEach((tag) => ok(tags.indexOf(tag) >= 0, '这条链路还在把原始报错回给前端：' + tag));
});

// ════════════════════════════════════════════════════════════
console.log('\n【四、P2-6 / P2-8 入库与回填不再串行等 HTTP】');

t('三件外部调用并行（安全检测 / 场馆精化 / 天气）', () => {
  ok(/await Promise\.all\(\[gateP, geoP, weatherP\]\)/.test(scan), '三路没有并行');
  // 认准入库主路径的调用形态：t.xxx 是这一处独有的（存量回填里那份是批内并发，见第四节）
  ok(!/await geocodeVenue\(t\./.test(scan), '入库还在串行 await geocodeVenue');
  ok(!/await fetchWeather\(t\./.test(scan), '入库还在串行 await fetchWeather');
  ok(/secGate\(OPENID, userText, '票面文字'\) : Promise\.resolve/.test(scan), '安全检测没进并行组');
});

t('场馆精化失败只落回城市中心，不拖垮入库', () => {
  ok(/geocodeVenue\(t\.city, t\.venue\)\.catch\(\(\) => null\)/.test(scan), 'geocode 抛错会掀翻整次入库');
  ok(/fetchWeather\(t\.geo\.lat, t\.geo\.lng, t\.date\)\.catch\(\(\) => null\)/.test(scan), '天气失败会拖垮入库');
});

t('存量回填：单批收紧 + 并发 + 同场馆共用一次坐标', () => {
  const batch = /const BACKFILL_GEO_BATCH = (\d+);/.exec(scan);
  ok(batch, '没有单批上限');
  ok(Number(batch[1]) <= 60, '单批 ' + batch[1] + ' 票：并发下仍可能顶到云函数 60s 超时');
  ok(/const BACKFILL_GEO_CONCURRENCY = \d+;/.test(scan), '没有并发度常量（还是逐条串行）');
  ok(/cache\.has\(key\)/.test(scan), '同一场馆重复 geocode（同一场演出的票往往成串）');
  ok(/more: docs\.length >= BACKFILL_GEO_BATCH/.test(scan), '没告诉调用方「还有没回填完的票」');
});

// ════════════════════════════════════════════════════════════
console.log('\n【五、P2-11 识别云函数的调用者与频次闸门（真跑配额）】');

t('端上调用才认（控制台 / 脚本直调没有 OPENID）', () => {
  ok(/const \{ OPENID \} = cloud\.getWXContext\(\);/.test(ocrScan), '没有取调用者身份');
  ok(/if \(!OPENID\) return \{ ok: false/.test(ocrScan), '没有拦下无身份的调用');
  const iGate = ocrScan.indexOf('if (!OPENID)');
  const iDl = ocrScan.indexOf('cloud.downloadFile({ fileID })');
  ok(iGate > 0 && iGate < iDl, '先下载图片再查身份 —— 拒绝之前已经白付了一次下载');
});

t('每人每日配额：第 31 次被拦下（真跑，内存假库）', async () => {
  const limit = Number(/const OCR_DAILY_LIMIT = (\d+);/.exec(ocrScan)[1]);
  ok(limit > 0 && limit <= 50, '日配额不合理：' + limit + ' 次/天');
  const db = fakeDb();
  const { claimDailyQuota: claim, bjYmd } = evalGroup(['bjYmd', 'claimDailyQuota'], ocrRaw, ['OCR_DAILY_LIMIT']);
  for (let i = 0; i < limit; i++) {
    const r = await claim(db, 'openid_a');
    ok(r.ok === true, `第 ${i + 1} 次就被拦了，配额没生效在正确的次数上`);
  }
  const over = await claim(db, 'openid_a');
  ok(over.ok === false, `第 ${limit + 1} 次没被拦下 —— 配额等于没有`);
  ok(!/err|error|undefined/i.test(over.msg), '拦截文案里有内部细节：' + over.msg);
  // 别人的额度不受影响
  ok((await claim(db, 'openid_b')).ok === true, '一个人的额度被另一个人用掉了');
  // 换一天自动恢复
  const rows = db._rows();
  ok(rows.filter((r) => r.ymd === bjYmd()).length === 2, '配额文档数不对：' + rows.length);
});

t('并发首调只落一条配额文档（不会凭空翻倍）', async () => {
  const db = fakeDb();
  const { claimDailyQuota: claim } = evalGroup(['bjYmd', 'claimDailyQuota'], ocrRaw, ['OCR_DAILY_LIMIT']);
  const rs = await Promise.all([claim(db, 'openid_c'), claim(db, 'openid_c'), claim(db, 'openid_c')]);
  rs.forEach((r, i) => ok(r.ok === true, `并发第 ${i + 1} 次被误拦`));
  const rows = db._rows();
  ok(rows.length === 1, '并发首调落了 ' + rows.length + ' 条文档（配额会按文档数翻倍）');
  ok(rows[0].count === 3, '计数没累加：' + rows[0].count);
});

t('库自己出问题 → 别把「次数用完了」扣给用户', async () => {
  // 假库：条件更新全失败、也读不到文档、add 直接炸 = 数据库不可用（不是「用超了」）
  const db = fakeDb();
  db.collection = () => ({
    where: () => ({
      update: async () => ({ stats: { updated: 0 } }),
      limit: () => ({ get: async () => ({ data: [] }) })
    }),
    add: async () => { throw new Error('db down'); }
  });
  const { claimDailyQuota: claim } = evalGroup(['bjYmd', 'claimDailyQuota'], ocrRaw, ['OCR_DAILY_LIMIT']);
  let threw = false;
  try { await claim(db, 'openid_d'); } catch (e) { threw = true; }
  ok(threw, '一次库抖动就让用户看到「今天的识别次数用完了」—— 那是把自己的故障说成用户用超了');
});

t('日期口径是北京时间（与签到/额度同一把尺）', () => {
  const { bjYmd } = evalGroup(['bjYmd'], ocrRaw);
  const s = bjYmd();
  ok(/^\d{4}-\d{2}-\d{2}$/.test(s), '日期格式不对：' + s);
  ok(/Date\.now\(\) \+ 8 \* 3600 \* 1000/.test(ocrRaw), '用了运行环境的本地时间（TZ=UTC 时日限额在北京早 8 点才翻篇）');
});

t('识别失败的内部报错也不回传（只留日志）', () => {
  ok(/console\.error\('\[ocr\]/.test(ocrScan), '异常没落日志');
  ok(!/msg: '识别异常：'/.test(ocrScan), '还在把 SDK 报错拼给用户');
});

// ════════════════════════════════════════════════════════════
// 内存假库：只实现这两处用到的查询形态（条件相等 + _.lt / _.inc）
function fakeDb() {
  const rows = [];
  const cmd = { lt: (n) => ({ __op: 'lt', n }), inc: (n) => ({ __op: 'inc', n }) };
  const match = (row, where) => Object.keys(where).every((k) => {
    const v = where[k];
    if (v && v.__op === 'lt') return Number(row[k] || 0) < v.n;
    return row[k] === v;
  });
  const apply = (row, data) => Object.keys(data).forEach((k) => {
    const v = data[k];
    row[k] = (v && v.__op === 'inc') ? Number(row[k] || 0) + v.n : v;
  });
  const col = {
    where: (w) => ({
      update: async ({ data }) => {
        let n = 0;
        rows.forEach((r) => { if (match(r, w)) { apply(r, data); n++; } });
        return { stats: { updated: n } };
      },
      limit: () => ({ get: async () => ({ data: rows.filter((r) => match(r, w)) }) })
    }),
    add: async ({ data }) => {
      if (rows.some((r) => r._id === data._id)) throw new Error('duplicate _id');
      rows.push(Object.assign({}, data));
      return { _id: data._id };
    }
  };
  return { command: cmd, collection: () => col, _rows: () => rows };
}

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
