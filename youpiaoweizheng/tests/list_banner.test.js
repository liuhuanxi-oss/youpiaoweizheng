// tests/list_banner.test.js —— 列表状态横幅（7.2.0 V6）
// ============================================================
// 为什么要单独守这一条：
//   utils/store.js 在云库读取失败时**不抛异常**，而是兜底成演示票根并把 netFallback 置真。
//   于是页面照常渲染、一个错都不报，只是画的全是别人的票。用户看到的是：
//     · 票根墙「凭空多出来一堆没见过的票」
//     · 回忆地图「走去过没去过的城市」
//     · 年报「总张数 / 城市数 / 花了多少钱」整份都是编的，还配一段 AI 结语
//   横幅是这套兜底链唯一的对外出口。少挂一页，那一页就在无声地说假话。
//
// 所以这里守两件事：
//   ① 每一页「渲染票根列表」的页面都必须消费 store.listFlags()（白名单要带理由）；
//   ② 每一处横幅都能点着重试（截断提示除外——它重试也没用）。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

/** 去掉注释再断言：注释里写「netBar」不算数（否则注释就能把测试骗过） */
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const pages = fs.readdirSync(path.join(ROOT, 'pages'))
  .filter((d) => fs.statSync(path.join(ROOT, 'pages', d)).isDirectory())
  .filter((d) => exists(`pages/${d}/${d}.js`))
  .sort();

const src = {};
pages.forEach((p) => { src[p] = decomment(read(`pages/${p}/${p}.js`)); });

const usesList = (js) => /store\s*\.\s*listTickets\s*\(/.test(js);
const usesFlags = (js) => /store\s*\.\s*listFlags\s*\(/.test(js);

// —— 已挂横幅的四页（基准：album 最早有这套；7.2.0 铺到 home / discover / annual） ——
const COVERED = ['album', 'annual', 'discover', 'home'];

// —— 读了列表但**故意不挂**横幅的页面，逐条写清为什么 ——
const ALLOW = {
  duo: 'renderFree 只把票根当「绑定后长这样」的示意，页面上并没有断言这些是用户的真实记录',
  me: '只拿列表算总数与勋章，云故障时这些数会偏——但偏的是「张数」不是「内容」，等有了真实点数再补'
};

/**
 * 取出一段源码里所有 setData({...}) 的实参文本。
 * ⚠️ 不能开「固定长度的窗口」向后找关键字：refresh() 顶上那句 setData({ loading: true })
 *    在窗口里就能扫到下面 `const netBar = ...` 的声明 —— 于是把 setData 里的 netBar
 *    整行删掉，断言照样通过（验牙时被这个假阳性咬了一口）。
 *    必须按花括号配平把实参真的切出来。
 */
function setDataArgs(js) {
  const out = [];
  const re = /setData\(\s*\{/g;
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

/** 把 catch 块整个挖空，只留成功路径（否则兜底里那句 netBar: null 会冒充「横幅挂上了」） */
function stripCatchBlocks(js) {
  let out = js;
  for (let guard = 0; guard < 50; guard++) {
    const m = /catch\s*\([^)]*\)\s*\{/.exec(out);
    if (!m) break;
    const i = out.indexOf('{', m.index);
    let depth = 0, j = i;
    for (; j < out.length; j++) {
      if (out[j] === '{') depth++;
      else if (out[j] === '}') { depth--; if (!depth) break; }
    }
    out = out.slice(0, m.index) + 'catch (_) {}' + out.slice(j + 1);
  }
  return out;
}

/**
 * 成功路径上有没有真的把 netBar 交给视图。
 * 两条排除，缺一不可：
 *   ① catch 块挖掉 —— 兜底里的 netBar:null 不是横幅；
 *   ② `netBar: null` 不算数 —— refresh 开头那句「先把横幅收回去」是复位，不是点亮。
 */
const hasNetBarInSetData = (js) => setDataArgs(stripCatchBlocks(js))
  .some((a) => /\bnetBar\b/.test(a.replace(/netBar\s*:\s*null/g, '')));

console.log('\n【一、每一页渲染票根列表的页面都必须亮出「这不是你的数据」】');
t('铺开了：album / annual / discover / home 四页都读了 listFlags', () => {
  COVERED.forEach((p) => {
    ok(usesList(src[p]), `${p} 已经不读列表了，这条断言该改`);
    ok(usesFlags(src[p]), `${p} 读了 store.listTickets 却没读 store.listFlags —— 云故障时它会在无声地说假话`);
  });
});
t('没有漏网之鱼：每个读列表的页面要么挂了横幅，要么在白名单里写明理由', () => {
  const missing = pages.filter((p) => usesList(src[p]) && !usesFlags(src[p]) && !ALLOW[p]);
  ok(missing.length === 0,
    '漏了：' + missing.join(', ') + '。要么补 listFlags，要么进 ALLOW 并写清为什么不用挂');
});
t('白名单不许长毛：里面的页面必须还在读列表', () => {
  Object.keys(ALLOW).forEach((p) => {
    ok(usesList(src[p]), `${p} 已经不读列表了，请把它从 ALLOW 里删掉（白名单条目会掩盖真问题）`);
  });
});

console.log('\n【二、横幅本身：能显示、能点、能收回】');
COVERED.forEach((p) => {
  const js = src[p];
  const wxml = read(`pages/${p}/${p}.wxml`).replace(/<!--[\s\S]*?-->/g, '');
  const wxss = read(`pages/${p}/${p}.wxss`).replace(/\/\*[\s\S]*?\*\//g, '');

  t(`${p}：横幅节点挂在 wx:if 上，点了走 onNetBarTap`, () => {
    ok(/wx:if="\{\{netBar\}\}"/.test(wxml), '没有 wx:if="{{netBar}}" 的节点');
    ok(/bindtap="onNetBarTap"/.test(wxml), '横幅不可点（云故障时要能原地重试）');
    ok(/class="[^"]*pressable[^"]*"[\s\S]{0,200}bindtap="onNetBarTap"/.test(wxml)
       || /bindtap="onNetBarTap"[\s\S]{0,200}class="[^"]*pressable/.test(wxml),
       '横幅少了 pressable（全站点得动的东西都该有按压反馈）');
  });

  t(`${p}：netBar 真的落进了 setData（只在 refresh 里算出来不算数）`, () => {
    ok(/\bnetBar\b/.test(js), 'js 里根本没有 netBar');
    ok(hasNetBarInSetData(js), '算了 netBar 却没写进 setData —— 横幅永远不会出现');
  });

  t(`${p}：onNetBarTap 只认 retry（截断提示不可点）`, () => {
    const m = /onNetBarTap\s*\(\s*\)\s*\{([\s\S]*?)\n  \},/.exec(js);
    ok(m, '找不到 onNetBarTap 方法体');
    ok(/\.retry\b/.test(m[1]), '没有判 netBar.retry —— 点「票根超过 N 张」会白跑一次刷新');
  });

  t(`${p}：横幅类不自己声明 transition（页面级同名属性会盖掉全局 .pressable）`, () => {
    const m = /\.(\w+-net)\s*\{([^}]*)\}/.exec(wxss);
    ok(m, '找不到横幅样式规则');
    ok(!/(^|[\s;])transition\s*:/.test(m[2]),
      `.${m[1]} 自己声明了 transition —— 全局 .pressable 的回弹会被它静默盖掉，压下去没有反馈`);
  });
});

console.log('\n【三、三类状态各说各的话，别串味】');
t('失败（netFallback）与截断（truncated）不是同一句话', () => {
  COVERED.forEach((p) => {
    const js = src[p];
    ok(/netFallback/.test(js), `${p} 没有区分 netFallback`);
    ok(/truncated/.test(js), `${p} 没有区分 truncated —— 两种情况的处理办法完全不同`);
  });
});
t('云故障的文案里必须有「重试」，且 retry 为真', () => {
  COVERED.forEach((p) => {
    const m = /netFallback\s*\?([\s\S]*?):\s*\(/.exec(src[p]);
    ok(m, `${p} 的 netFallback 分支取不到`);
    ok(/retry:\s*true/.test(m[1]), `${p} 的云故障横幅没有 retry: true（用户没有出路）`);
    ok(/重试/.test(m[1]), `${p} 的云故障文案没提「重试」，用户不知道该点`);
  });
});
t('截断提示 retry 为假（票根超过上限时重试多少次都一样）', () => {
  COVERED.forEach((p) => {
    // ⚠️ 收尾锚点只能用 `: null`，不能用 `}`——文案是模板字符串，
    //    `${flags.cap}` 里自带一个 `}`，按 `}` 截会提前断在 `${flags.cap` 处。
    const m = /truncated\s*\?([\s\S]*?):\s*null/.exec(src[p]);
    ok(m, `${p} 的 truncated 分支取不到`);
    ok(/retry:\s*false/.test(m[1]), `${p} 的截断提示 retry 不为 false`);
  });
});
t('discover 的云故障文案点破了「地图上是演示城市」', () => {
  ok(/演示城市|演示/.test(/netFallback\s*\?([\s\S]*?):\s*\(/.exec(src.discover)[1]),
    '只说「网络开小差」不够——这一页画的是城市的点，必须说清点也是假的');
});
t('annual 的云故障文案点破了「这份年报用的是演示票根」', () => {
  ok(/演示票根/.test(/netFallback\s*\?([\s\S]*?):\s*\(/.exec(src.annual)[1]),
    '年报上每个数字都来自票根，必须说清数字是假的');
});

console.log('\n测试套件：list_banner —— ' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
