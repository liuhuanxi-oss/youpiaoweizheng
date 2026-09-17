// tests/points.test.js —— 7.4.0 第三批（留存闭环）B 段：积分体系
// ============================================================
// 为什么这批要单独一套：
//   ① 积分能换成真金白银的 AI 重绘（100 分 = 1 次）。所以「给不给分、给几次」
//      只能在服务端判 —— 端上能报的行为必须收成白名单，否则谁都能循环调用刷分；
//   ② 日上限是成本闸门，写漏一处就等于没有上限，而界面上完全看不出来；
//   ③ 上传票根的加分挂在入库主流程上：记账失败绝不能把「票已入库」判成失败，
//      那会诱使用户重传，凭空多一张票；
//   ④ utils/points.js 的 artHint 是纯函数，可以真跑 —— 攒积分的终点文案用真断言验。
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

const cloud = decomment(read('cloudfunctions/saveTicket/index.js'));
const points = require('../utils/points.js');

const fnOf = (name) => {
  const m = new RegExp('(?:async )?function ' + name + '\\s*\\([\\s\\S]*?\\n}').exec(cloud);
  ok(m, '找不到函数 ' + name);
  return m[0];
};

// ════════════════════════════════════════════════════════════
console.log('\n【一、得分规则表（v8.0 方案 R2 的口径）】');

t('六个行为都有规则，分数与方案一致', () => {
  const table = /const POINTS_RULES = \{[\s\S]*?\n\};/.exec(cloud);
  ok(table, '找不到 POINTS_RULES');
  const want = { sign: 5, video: 3, upload: 10, card: 2, share: 5, invite: 50 };
  Object.keys(want).forEach((k) => {
    const m = new RegExp(k + ':\\s*\\{ points: (\\d+), cap: (\\d+) \\}').exec(table[0]);
    ok(m, k + ' 的规则不见了');
    ok(Number(m[1]) === want[k], k + ' 的分数不是 ' + want[k] + '（方案 R2 表）：' + m[1]);
  });
});

t('每个加分行为都有日上限（除了按人头算的邀请）', () => {
  const table = /const POINTS_RULES = \{[\s\S]*?\n\};/.exec(cloud)[0];
  const caps = {};
  table.replace(/(\w+):\s*\{ points: \d+, cap: (\d+) \}/g, (_, k, c) => { caps[k] = Number(c); return ''; });
  ['sign', 'video', 'upload', 'card', 'share'].forEach((k) => {
    ok(caps[k] > 0, k + ' 没有日上限 —— 上限就是成本闸门，漏一个等于敞开');
  });
  ok(caps.invite === 0, '邀请本来就是一次性奖励，cap 应为 0（不设日上限）');
});

t('兑换门槛是 100 分换 1 次重绘，且云函数与端上同源', () => {
  ok(/const POINTS_PER_ART = 100;/.test(cloud), '云函数里的兑换门槛不是 100');
  ok(points.POINTS_PER_ART === 100, '端上的门槛与云函数不一致');
});

// ════════════════════════════════════════════════════════════
console.log('\n【二、加分只能由服务端说了算】');

t('日上限在 earnPoints 里判，且超限不写库', () => {
  const fn = fnOf('earnPoints');
  ok(/rule\.cap > 0 && used >= rule\.cap/.test(fn), '没有判日上限');
  ok(/granted: false, capped: true/.test(fn), '超限没有短路返回（还会继续发分）');
  const cut = fn.indexOf('capped: true');
  const write = fn.indexOf('balance: _.inc');
  ok(write > cut, '先写库后判上限：上限等于没设');
});

t('余额与累计都走原子自增，不是读-改-写', () => {
  const fn = fnOf('earnPoints');
  ok(/balance: _\.inc\(rule\.points\)/.test(fn), '余额不是原子自增');
  ok(/lifetime: _\.inc\(rule\.points\)/.test(fn), '累计得分没跟着记（兑换门槛的样子货）');
});

t('端上能报的行为收成白名单，只有「生成卡片」', () => {
  const m = /const CLIENT_EARN_REASONS = \[([^\]]*)\]/.exec(cloud);
  ok(m, '没有端上上报白名单');
  const list = m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  ok(list.length === 1 && list[0] === 'card', '白名单不该有除 card 以外的项：' + list.join('/'));
  const fn = fnOf('pointsEarnAction');
  ok(/CLIENT_EARN_REASONS\.indexOf\(reason\) < 0/.test(fn), '白名单没有真正拦住');
});

t('日上限的计数器按北京时间换天（不能跟着运行环境时区走）', () => {
  const fn = fnOf('earnPoints');
  ok(/pay\.ymdNow\(\)/.test(fn), '计数器没有走统一的北京时间口径');
  ok(/p\.earn\.ymd === today/.test(fn), '换天没有重置计数器（昨天用满的额度今天还在挡）');
});

t('分享被打开：记给码的主人，且自己点自己的不加分', () => {
  const fn = fnOf('shareOpenAction');
  ok(/type: 'ref_code', code/.test(fn), '没有按短码找分享人');
  ok(/owner === OPENID[\s\S]{0,60}granted: false/.test(fn), '自己给自己刷分没有被拦');
  ok(/earnPoints\(db, owner, 'share'\)/.test(fn), '分没有记在分享人头上');
});

// ════════════════════════════════════════════════════════════
console.log('\n【三、三处服务端钩子】');

t('上传票根 +10：记账包在 try 里，失败也不能把入库判成失败', () => {
  const at = cloud.indexOf("await earnPoints(db, OPENID, 'upload')");
  ok(at > 0, '入库流程里没有上传加分');
  const seg = cloud.slice(Math.max(0, at - 260), at + 120);
  ok(/try \{ points = await earnPoints/.test(seg), '加分没有兜底：记账一失败，票已经入库却回「入库失败」');
  ok(/return \{ ok: true, _id: res\._id/.test(seg), '入库返回值被改动了');
});

t('激励视频 +3：与广告日限额同源（一个用完另一个不会还剩）', () => {
  const fn = fnOf('artRewardGrantAction');
  ok(/earnPoints\(db, OPENID, 'video'\)/.test(fn), '看视频没有加分');
  ok(/const AD_REWARD_DAILY_LIMIT = 3;/.test(cloud), '广告日限额不是 3 —— 与方案 R2 的「看激励视频 3 次」对不上');
  ok(/POINTS_RULES\.video = \{ points: 3, cap: 3 \}|video: \{ points: 3, cap: 3 \}/.test(cloud),
    '视频积分的日上限没跟广告日限额对齐');
});

t('邀请首传 +50：双方各一份，幂等仍靠「抢结算权」', () => {
  const fn = fnOf('refRewardAction');
  ok(/earnPoints\(db, OPENID, 'invite'\)/.test(fn), '被邀请人没有拿到邀请积分');
  ok(/earnPoints\(db, link\.inviter, 'invite'\)/.test(fn), '邀请人没有拿到邀请积分');
  ok(/status: 'pending'/.test(fn) && /claim\.stats\.updated/.test(fn),
    '结算权抢占不见了 —— 会重复发重绘（真实成本）');
  const seg = cloud.slice(cloud.indexOf("earnPoints(db, link.inviter, 'invite')"), cloud.indexOf("earnPoints(db, link.inviter, 'invite')") + 300);
  ok(/catch \(e2\)/.test(seg), '积分失败没有兜底：结算权已用掉，回滚会把重绘也重发一遍');
});

// ════════════════════════════════════════════════════════════
console.log('\n【四、端上只读：不摆假数字】');

t('artHint：没够 100 分说还差多少，够了说能换几次', () => {
  ok(points.artHint(0).text === '再攒 100 分可换 1 次 AI 重绘', '0 分的文案不对：' + points.artHint(0).text);
  ok(points.artHint(78).text === '再攒 22 分可换 1 次 AI 重绘', '差 22 分的文案不对：' + points.artHint(78).text);
  ok(points.artHint(100).ready === true, '刚好 100 分应该算够');
  ok(points.artHint(250).text === '已够换 2 次 AI 重绘', '250 分能换 2 次：' + points.artHint(250).text);
});

t('artHint 对脏数据不崩、不为负', () => {
  ok(points.artHint(undefined).ready === false, 'undefined 应该当成 0');
  ok(points.artHint(-30).text === '再攒 100 分可换 1 次 AI 重绘', '负数余额文案不对');
  ok(points.artHint('abc').ready === false, '非数字应该当成 0');
});

t('我的页余额只有一个来源：签到那次返回值', () => {
  const me = read('pages/me/me.js');
  const fn = /refreshSign\(\) \{[\s\S]*?\n  \},/.exec(me);
  ok(fn, '找不到 refreshSign');
  ok(/this\._applyPoints\(s\.balance\)/.test(fn[0]), '积分不是从签到那次返回值来的');
  // 7.4.0 C 段起，这一页**会**调 points.status() —— 积分勋章的「累计获得」只有它拿得到。
  // 要防的从来不是「调了这个接口」，而是**余额自己算**：
  // 页面上只允许出现两个余额，且都是服务端刚回的值 ——
  //   s.balance  签到/进页那次连同余额一起回的
  //   r.balance  兑换成功后服务端回的新余额
  // 再多一个来源（比如拿 points.status() 的余额另摆一处），就会出现
  // 「签到卡说 128、别处说 118」，用户只会认为积分丢了。
  const refs = [...new Set([...me.matchAll(/[A-Za-z_$][\w$]*\.balance/g)].map((m) => m[0]))];
  const allowed = ['s.balance', 'r.balance'];
  const others = refs.filter((x) => allowed.indexOf(x) < 0);
  ok(others.length === 0, '出现了第三种余额来源：' + others.join(', ') + '（余额只能来自服务端回值）');
});

t('积分三件套只在一处赋值：三个调用点不会各说各话', () => {
  const me = read('pages/me/me.js');
  const ap = /_applyPoints\(balance\) \{[\s\S]*?\n  \},/.exec(me);
  ok(ap, '找不到 _applyPoints');
  ['signPoints', 'pointsHint', 'pointsReady'].forEach((k) => {
    ok(new RegExp(k + ':').test(ap[0]), k + ' 没在 _applyPoints 里统一赋值');
  });
  // 声明处 + _applyPoints 各一次；再多就是有人在别处又改了一遍
  const sets = (me.match(/signPoints:/g) || []).length;
  ok(sets <= 2, 'signPoints 有 ' + sets + ' 处赋值，迟早出现「这里 128、那里 118」');
});

t('生成卡片上报：不 await、不看返回值（积分不能打断「已存入相册」）', () => {
  const card = read('pages/card/card.js');
  ok(/points\.earnCard\(\);/.test(card), '生成卡片没有上报加分');
  ok(!/await points\.earnCard/.test(card), 'await 了积分上报：记账慢就会卡住保存反馈');
});

t('分享被打开只报一次（onShow 每次回前台都会重跑，不能一路报）', () => {
  const inv = read('utils/invite.js');
  ok(/if \(code\) reportOpen\(code\);/.test(inv), 'boot 里没有上报分享被打开');
  ok(/_openedCode/.test(inv), '没有去重标记：同一张卡切一次前台就报一次');
});

t('演示模式不摆假入口（USE_CLOUD=false 时不调云）', () => {
  const src = read('utils/points.js');
  ok(/if \(!USE_CLOUD\) return null;/.test(src), 'status 在演示模式下没有短路');
  ok(/if \(!USE_CLOUD \|\| !wx\.cloud\) return Promise\.resolve\(\{\}\);/.test(src), 'call 没有云环境守卫');
});

// ════════════════════════════════════════════════════════════
console.log('\n【五、兑换（花分）：100 分 = 1 次 AI 重绘】');

t('路由挂上且把 event 传进去（幂等键 req 在 event 里）', () => {
  ok(/if \(event\.action === 'pointsRedeem'\)/.test(cloud), '路由里没有 pointsRedeem');
  ok(/return pointsRedeemAction\(event, OPENID\)/.test(cloud), '调用点没把 event 传进去');
});

t('幂等：同一笔请求重复到达直接返回，不再扣分', () => {
  const fn = fnOf('pointsRedeemAction');
  ok(/p\.redeemReq === req/.test(fn), '没有认领幂等键（双击会扣两次分）');
  ok(/dup: true/.test(fn), '重复请求没有标明 dup');
  const dupAt = fn.indexOf('p.redeemReq === req');
  const claimAt = fn.indexOf('const claim = await col.where');
  ok(claimAt > dupAt, '先扣分后判幂等，等于没幂等');
});

t('余额不足先短路，不去动库', () => {
  const fn = fnOf('pointsRedeemAction');
  const balAt = fn.indexOf("code: 'NOBAL'");
  const claimAt = fn.indexOf('const claim = await col.where');
  ok(balAt > 0, '没有余额不足的分支');
  ok(claimAt > balAt, '余额不足也要走一遍扣分条件更新（多余的写）');
});

t('不超扣：余额够与今天没兑过写在同一条件更新里', () => {
  const fn = fnOf('pointsRedeemAction');
  const claim = /const claim = await col\.where\(\{[\s\S]*?\}\)\.update\(/.exec(fn);
  ok(claim, '找不到扣分的条件更新');
  ok(/balance: _\.gte\(POINTS_PER_ART\)/.test(claim[0]), '扣分条件里没有「余额够」（可能扣成负数）');
  ok(/redeemYmd: _\.neq\(today\)/.test(claim[0]), '扣分条件里没有「今天没兑过」（并发会兑两次）');
  ok(!/lifetime/.test(claim[0].split('}).update(')[1] || ''),
    '扣分时动了 lifetime（累计得分只增不减，兑换不该把它扣回去）');
});

t('不白扣：发额度失败就把分与今天的名额一起退回', () => {
  const fn = fnOf('pointsRedeemAction');
  const grantAt = fn.indexOf('await grantBonusArt(db, OPENID)');
  ok(grantAt > 0, '兑换没有走统一的额度入账函数');
  const tail = fn.slice(grantAt);
  ok(/catch \(e\)[\s\S]{0,300}balance: _\.inc\(POINTS_PER_ART\)/.test(tail), '发额度失败没有退分');
  ok(/redeemYmd: ''/.test(tail), '失败没把今天的名额还回去（用户今天再也兑不了）');
  ok(/code: 'GRANT'/.test(tail), '退分分支没有告诉端上「已退分」');
});

t('一天只让兑 1 次，常量与端上文案都在', () => {
  ok(/const REDEEM_DAILY_LIMIT = 1;/.test(cloud), '每日兑换上限不是 1');
  ok(/redeemYmd === today[\s\S]{0,80}'LIMIT'|code: 'LIMIT'/.test(cloud), '没有「今天已兑过」的返回码');
  const pts = read('utils/points.js');
  ['LIMIT', 'NOBAL', 'GRANT'].forEach((c) => {
    ok(new RegExp(c + ':').test(pts), '端上没有把 ' + c + ' 翻译成人话');
  });
});

t('老文档（A 段建的）没有兑换字段时先补上再判', () => {
  const fn = fnOf('pointsRedeemAction');
  const fixAt = fn.indexOf("typeof p.redeemYmd !== 'string'");
  const claimAt = fn.indexOf('const claim = await col.where');
  ok(fixAt > 0, '没有给老文档补字段：条件更新里的 neq 会拿不到东西比，兑换可能永远失败');
  ok(claimAt > fixAt, '补字段在扣分之后，来不及');
});

t('端上兑换：演示模式不调云，且带幂等键', () => {
  const pts = read('utils/points.js');
  const fn = /async function redeem\(req\)[\s\S]*?\n}/.exec(pts);
  ok(fn, '找不到 redeem');
  ok(/if \(!USE_CLOUD\) return \{ ok: false, msg: '演示模式不支持兑换' \};/.test(fn[0]), '演示模式没有短路');
  ok(/req: req \|\| makeReq\(\)/.test(fn[0]), '没带幂等键');
});

t('我的页：攒够才出按钮，确认弹层说清花多少/剩多少，成功后刷新额度', () => {
  const wxml = read('pages/me/me.wxml');
  ok(/wx:if="\{\{pointsReady\}\}"/.test(wxml), '兑换按钮没有「攒够才出现」的守卫');
  ok(/<bottom-sheet show="\{\{redeemShow\}\}"/.test(wxml), '没有接入确认弹层');
  ok(/兑换后剩余/.test(wxml), '弹层没告诉用户兑换后还剩多少分');
  const me = read('pages/me/me.js');
  ok(/r\.code[\s\S]{0,40}|REDEEM_MSG/.test(read('utils/points.js')), '失败原因没有按码说人话');
  const confirm = /async onConfirmRedeem\(\)[\s\S]*?\n  \},/.exec(me);
  ok(confirm, '找不到 onConfirmRedeem');
  ok(/if \(this\.data\.redeeming\) return;/.test(confirm[0]), '确认按钮没有防重复点击');
  ok(/this\.refreshQuota\(\)/.test(confirm[0]), '兑换成功后没刷额度卡（会出现「兑了 1 次，可用次数没变」）');
  ok(/track\.track\('points_redeem'/.test(confirm[0]), '兑换没有埋点');
  const close = /onCloseRedeem\(\)[\s\S]*?\n  \},/.exec(me);
  ok(/if \(this\.data\.redeeming\) return;/.test(close[0]), '兑换进行中能关掉弹层：用户会以为没兑上，再点一次');
});

// ════════════════════════════════════════════════════════════
console.log('\n【六、积分怎么来：对外只公布能摆上台面的三条（8.0.5）】');

t('白名单只有签到 / 上传 / 卡片，不含分享与邀请', () => {
  const wl = /const PUBLIC_RULE_KEYS = \[([^\]]*)\]/.exec(cloud);
  ok(wl, '没有 PUBLIC_RULE_KEYS —— 规则整体下发出去，界面就等于在说「分享有奖」');
  const keys = (wl[1].match(/'[a-z]+'/g) || []).map((x) => x.replace(/'/g, ''));
  ok(keys.indexOf('share') < 0 && keys.indexOf('invite') < 0,
    '把分享 / 邀请列进了对外规则：微信把「以利益诱惑诱导分享」判成违规，奖励照发但不该吆喝');
  ['sign', 'upload', 'card'].forEach((k) => {
    ok(keys.indexOf(k) >= 0, '漏了 ' + k + ' —— 用户少知道一条挣分的途径');
  });
});

t('两处下发都走白名单（漏一处 = 全表原样漏给端上）', () => {
  ok(/rules:\s*publicRules\(\)/.test(fnOf('pointsGetAction')), 'pointsGet 把全表原样回了出去');
  ok(/rules:\s*publicRules\(\)/.test(fnOf('dailySignAction')),
    'dailySign 的 check 分支没带规则（或带的是全表）—— 「我的」页那次读才是端上真用的');
});

t('端上真跑：三条规则 + 兑换终点，且一个「分享 / 邀请」都没有', () => {
  const txt = points.rulesText([
    { key: 'sign', points: 5, cap: 1 },
    { key: 'upload', points: 10, cap: 2 },
    { key: 'card', points: 2, cap: 2 }
  ]);
  ok(/每日签到/.test(txt) && /上传一张票根/.test(txt) && /生成卡片或海报/.test(txt),
    '三条规则没摆全：' + JSON.stringify(txt));
  ok(/\+5 分/.test(txt) && /\+10 分/.test(txt) && /\+2 分/.test(txt), '分值没带上 —— 用户得知道一次值多少');
  ok(/每天最多 2 次/.test(txt), '有日上限的行为没写上限：用户做到第 3 次没加分，只会以为积分坏了');
  ok(/100 分可兑换 1 次 AI 重绘/.test(txt), '没写终点 —— 攒分得有个看得见的去处');
  ok(!/分享|邀请/.test(txt), '弹窗里出现了分享 / 邀请：这正是要躲开的那句话');
});

t('服务端将来加了新 key，端上不认识就不显示（不猜、不编）', () => {
  const txt = points.rulesText([{ key: 'sign', points: 5, cap: 1 }, { key: 'mystery', points: 99, cap: 0 }]);
  ok(/每日签到/.test(txt), '认识的 key 被牵连掉了');
  ok(!/99/.test(txt) && !/mystery/.test(txt), '把不认识的 key 硬编了个名字摆出去');
});

t('拿不到规则就返回空串，页面上直说拿不到（不编一套默认规则顶上）', () => {
  ok(points.rulesText(null) === '' && points.rulesText([]) === '' && points.rulesText([{ key: 'x' }]) === '',
    '拿不到规则却还是编了一套出来 —— 编的那套迟早和实物对不上');
  const m = /onPointsRule\(\)[\s\S]*?\n  \},/.exec(read('pages/me/me.js'));
  ok(m, '「积分怎么来」的入口方法不见了');
  ok(/rulesText\(this\.data\.pointsRules\)/.test(m[0]), '入口没拿服务端下发的规则来渲染');
  ok(/wx\.showToast/.test(m[0]), '取不到规则时一声不吭 —— 用户点了没反应，只会以为这功能是坏的');
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
