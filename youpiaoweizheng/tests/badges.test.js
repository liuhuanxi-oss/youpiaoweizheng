// tests/badges.test.js —— 7.4.0 C 段 R3：勋章判定（13 → 16 枚）
// ============================================================
// 守三件事：
//   ① 新增的 3 枚（连签 / 积分）读的是**服务端**数据 —— 签到与积分都是服务端结算的，
//      端上算等于「改一下手机时间就能点亮」。
//   ② **服务端取不到时不编数字**。显示「还差 3 天」而用户其实已经签了 5 天，是假的；
//      假的进度比没有进度更伤人。取不到就只说门槛，不说差多少。
//   ③ b11「时光信使」只认**真分享** —— 旧口径把「保存图片到相册」也算进了分享次数，
//      用户一次没分享过、只是存了 10 张图，勋章就亮了。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const { computeBadges } = require(path.join(ROOT, 'utils', 'badges.js'));
const mock = require(path.join(ROOT, 'utils', 'mock.js'));

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

// 造一张最小票根：只给判定用到的字段
const ticket = (o) => Object.assign({ id: 't', type: 'show', title: 'x', date: '2025-01-01', time: '20:00', city: '北京' }, o);

const badgesOf = (ts, server, opt) => {
  const o = opt || {};
  return computeBadges(ts || [], o.couple || null, o.share == null ? 0 : o.share,
    !!o.mapVisited, !!o.inviteSent, server);
};
const byId = (list, id) => list.find((b) => b.id === id);

console.log('\n【一、勋章清单：13 → 16 枚】');
t('一共 16 枚', () => {
  ok(mock.badges.length === 16, 'mock.badges 里有 ' + mock.badges.length + ' 枚，应该是 16');
  ok(computeBadges([], null, 0, false, false, null).length === 16,
    'computeBadges 返回的不是 16 枚');
});
t('id 不重复，且每枚都有 icon / name / desc', () => {
  const list = computeBadges([], null, 0, false, false, null);
  const ids = list.map((b) => b.id);
  ok(new Set(ids).size === ids.length, 'id 有重复：' + ids.join(','));
  list.forEach((b) => {
    ['icon', 'name', 'desc'].forEach((k) => {
      ok(b[k] && String(b[k]).trim(), b.id + ' 缺 ' + k);
    });
  });
});
t('新增的三枚是连签与积分（b14 / b15 / b16）', () => {
  const list = computeBadges([], null, 0, false, false, null);
  ['b14', 'b15', 'b16'].forEach((id) => ok(byId(list, id), '少了 ' + id));
});

console.log('\n【二、连签勋章读服务端】');
t('连签 2 天：3 天那枚没亮，且说得出还差几天', () => {
  const list = badgesOf([], { streak: 2, lifetime: 0 });
  ok(!byId(list, 'b14').unlocked, '连签 2 天不该点亮 3 天的勋章');
  ok(/还差\s*1\s*天/.test(byId(list, 'b14').desc), '文案没说还差几天，实际：' + byId(list, 'b14').desc);
});
t('连签 3 天：3 天那枚亮，7 天那枚没亮', () => {
  const list = badgesOf([], { streak: 3, lifetime: 0 });
  ok(byId(list, 'b14').unlocked, '连签 3 天该点亮 b14');
  ok(!byId(list, 'b15').unlocked, '连签 3 天不该点亮 7 天的勋章');
  ok(/还差\s*4\s*天/.test(byId(list, 'b15').desc), 'b15 进度不对：' + byId(list, 'b15').desc);
});
t('连签 7 天：两枚都亮', () => {
  const list = badgesOf([], { streak: 7, lifetime: 0 });
  ok(byId(list, 'b14').unlocked && byId(list, 'b15').unlocked, '连签 7 天该点亮 b14 与 b15');
});

console.log('\n【三、积分勋章读服务端，且认「累计」不认「余额」】');
t('累计 499 分没亮，500 分亮了', () => {
  ok(!byId(badgesOf([], { streak: 0, lifetime: 499 }), 'b16').unlocked, '499 分不该亮');
  ok(byId(badgesOf([], { streak: 0, lifetime: 500 }), 'b16').unlocked, '500 分该亮');
});
t('兑换花掉积分后，勋章不会退回去（认累计，不认余额）', () => {
  // 这是最容易写错的一处：用 balance 判定的话，用户攒到 500 换了 5 次重绘、
  // 余额掉回 0，勋章会当场熄灭 —— 已经得到的东西不该因为消费而失去
  const list = badgesOf([], { streak: 0, lifetime: 500, balance: 0 });
  ok(byId(list, 'b16').unlocked, '余额清零后勋章熄灭了 —— 判定用错成 balance 了');
});

console.log('\n【四、服务端取不到时不编数字】');
t('server 为 null：三枚都没亮，且文案里不出现「还差」', () => {
  const list = badgesOf([], null);
  ['b14', 'b15', 'b16'].forEach((id) => {
    const b = byId(list, id);
    ok(!b.unlocked, id + ' 在拿不到服务端数据时亮了');
    ok(!/还差/.test(b.desc), id + ' 编了一个假进度：' + b.desc);
  });
});
t('server 字段缺失/类型不对，同样按「拿不到」处理', () => {
  [{}, { streak: 'x', lifetime: null }, undefined].forEach((s) => {
    const list = badgesOf([], s);
    ok(!byId(list, 'b14').unlocked, '脏数据 ' + JSON.stringify(s) + ' 被当成了有效连签');
    ok(!/还差/.test(byId(list, 'b14').desc), '脏数据下编了假进度');
  });
});
t('服务端拿不到，不影响原本 13 枚的判定', () => {
  const list = badgesOf([ticket({ type: 'movie' })], null, { share: 5 });
  ok(byId(list, 'b1').unlocked, '有票根却点亮不了「第一张票」');
  ok(!byId(list, 'b11').unlocked, '分享 5 张不该亮 10 张的勋章');
  ok(/还差\s*5\s*张/.test(byId(list, 'b11').desc), 'b11 进度不对：' + byId(list, 'b11').desc);
});

console.log('\n【五、b11「时光信使」只认真分享，保存图片不算】');
/** 取页面对象里某个方法的函数体（按花括号配平） */
function methodBody(src, name) {
  const re = new RegExp('\\n  (?:async\\s+)?' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) return null;
  let depth = 0;
  const start = src.indexOf('{', m.index);
  for (let j = start; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(start + 1, j); }
  }
  return null;
}

const cardJs = read('pages/card/card.js');

t('保存到相册不再增加分享计数', () => {
  const body = methodBody(cardJs, 'save');
  ok(body, '找不到 save 方法');
  ok(!/_incrShare|sp_share_count|LS_SHARE/.test(body),
    'save（保存到相册）里还在动分享计数 —— 用户存 10 张图就白拿「分享 10 张」勋章');
});
t('小红书导出不再增加分享计数', () => {
  const body = methodBody(cardJs, 'saveXHS');
  // 不留「找不到就跳过」的兜底 —— 函数改了名，这条断言会静默失效，比没有更糟
  ok(body, '找不到 saveXHS 方法（改名了就把这条测试一起改）');
  ok(!/_incrShare|LS_SHARE/.test(body), '小红书导出里还在动分享计数');
});
t('真分享才增加分享计数', () => {
  const body = methodBody(cardJs, 'onShareAppMessage');
  ok(body, '找不到 onShareAppMessage');
  ok(/_incrShare/.test(body), 'onShareAppMessage 里没有记分享次数 —— 真分享反而不算');
});
t('分享计数的写入只出现在 _incrShare 一个地方', () => {
  const hits = (cardJs.match(/setStorageSync\(\s*LS_SHARE/g) || []).length;
  ok(hits === 1, '有 ' + hits + ' 处直接写分享计数，应该只有 _incrShare 一处');
  const body = methodBody(cardJs, '_incrShare');
  ok(body && /setStorageSync\(\s*LS_SHARE/.test(body), '写分享计数的不是 _incrShare');
});

console.log('\n测试套件：badges —— ' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
