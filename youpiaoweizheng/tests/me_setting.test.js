// test_me_setting.js —— 个人中心（稿屏11）+ 设置页（v7.0 新建）回归测试
// 重点抓 iconSrc 的静默回落：图标名拼错不会报错，会悄悄画成票根图标。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m || '断言失败'); };

const meWxml = read('pages/me/me.wxml').replace(/<!--[\s\S]*?-->/g, '');
const meWxss = read('pages/me/me.wxss');
const meJs = read('pages/me/me.js');
const stWxml = read('pages/setting/setting.wxml').replace(/<!--[\s\S]*?-->/g, '');
const stWxss = read('pages/setting/setting.wxss');
const stJs = read('pages/setting/setting.js');
const icons = read('utils/icons.js');
const mock = read('utils/mock.js');

// 取出 icons.js 里真实注册的图标名
const ICONS = new Set([...icons.matchAll(/^\s{2}([a-zA-Z][\w]*):/gm)].map((m) => m[1]));

console.log('\n【一、图标名必须真实存在（拼错会静默画成票根）】');
t('icons.js 里注册的图标名 >= 25 个', () => ok(ICONS.size >= 25, '只有 ' + ICONS.size + ' 个'));
t('me.js 里写死的图标名全部存在', () => {
  const used = [...meJs.matchAll(/icon:\s*'(?!none'|success')([a-zA-Z]+)'/g)].map((m) => m[1])
    .concat([...meJs.matchAll(/iconSrc\('([a-zA-Z]+)'/g)].map((m) => m[1]));
  const bad = [...new Set(used)].filter((u) => !ICONS.has(u));
  ok(bad.length === 0, '不存在：' + bad.join(', '));
});
t('setting.js 里写死的图标名全部存在', () => {
  const used = [...stJs.matchAll(/icon:\s*'(?!none'|success')([a-zA-Z]+)'/g)].map((m) => m[1])
    .concat([...stJs.matchAll(/iconSrc\('([a-zA-Z]+)'/g)].map((m) => m[1]));
  const bad = [...new Set(used)].filter((u) => !ICONS.has(u));
  ok(bad.length === 0, '不存在：' + bad.join(', '));
});
t('mock.js 的勋章图标名全部存在（v7.0 已从 emoji 换成图标名）', () => {
  const used = [...mock.matchAll(/id: 'b\d+', icon: '([^']+)'/g)].map((m) => m[1]);
  // 数量归 tests/badges.test.js 管（那边连判定一起钉）；这里只防「正则没匹配上」的静默失效
  ok(used.length >= 16, '只扫到 ' + used.length + ' 枚勋章图标，7.4.0 起应该是 16 枚');
  const bad = used.filter((u) => !ICONS.has(u));
  ok(bad.length === 0, '不存在：' + bad.join(', '));
});
t('mock.js 的勋章图标里不再有 emoji', () => {
  const seg = mock.slice(mock.indexOf('const badges'), mock.indexOf('M9.6：') > 0 ? mock.indexOf('const MOCK_IDS') : undefined);
  ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(seg), '仍有 emoji');
});

console.log('\n【二、两个页面都不得有 emoji / 内联 svg】');
[['me', meWxml], ['setting', stWxml]].forEach(([name, w]) => {
  t(name + '.wxml 无内联 <svg>/<path>/<circle>', () => {
    ok(!/<svg[\s>]/i.test(w) && !/<path[\s>]/i.test(w) && !/<circle[\s>]/i.test(w), '发现内联 svg 标签');
  });
  t(name + '.wxml 无 emoji', () => {
    const m = w.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2728}\u{2764}]/u);
    ok(!m, '残留：' + (m && m[0]));
  });
});

console.log('\n【三、类名与样式对得上】');
[['me', meWxml, meWxss], ['setting', stWxml, stWxss]].forEach(([name, w, s]) => {
  t(name + '：wxml 的类名 wxss 都有（放行全局公共类）', () => {
    const GLOBAL = /^(tk-|press|card$|b-|theme-|skeleton-|ad-)/;
    // 纯结构包裹层：只为把几张卡圈成一组（.stagger 的延迟靠 :nth-child 数位次，
    // 得有个固定的父节点），本身**不该**有样式 —— 所以 wxss 里找不到它们是正常的。
    const STRUCT = ['me-flow'];
    const used = new Set([...w.matchAll(/(?:^|\s)class="([^"]*)"/g)]
      .flatMap((m) => m[1].replace(/\{\{[\s\S]*?\}\}/g, ' ').split(/\s+/)).filter(Boolean));
    // 本页 wxss + app.wxss 一起算「有定义」—— 每往 app.wxss 加一个全局类
    // 就得回来改一遍上面那串 GLOBAL 正则，早晚会漏（.refresher 就是这么漏的）
    const def = new Set([...read('app.wxss').matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
    [...s.matchAll(/\.([a-zA-Z][\w-]*)/g)].forEach((m) => def.add(m[1]));
    const miss = [...used].filter((u) => !def.has(u) && !GLOBAL.test(u) && !STRUCT.includes(u));
    ok(miss.length === 0, '缺：' + miss.join(', '));
  });
  t(name + '.wxss 无写死的颜色（rgba 兜底除外）', () => {
    // 允许：var(--x, #兜底) 里的兜底值、小程序不支持的变量
    const stripped = s.replace(/var\([^)]*\)/g, 'VAR');
    const bad = [...stripped.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    ok(bad.length === 0, '写死色值：' + bad.join(', '));
  });
});

console.log('\n【四、我的页：留存中心（7.2.0 L1 重整后的版面）】');
t('功能入口只剩 2 个，且都是没有别的入口的二级页', () => {
  // 只看 ENTRIES 字面量到 _route 之间，避免把 _route 里的 key 判断也算进来
  const entries = meJs.slice(meJs.indexOf('const ENTRIES'), meJs.indexOf('/**', meJs.indexOf('const ENTRIES')));
  const n = (entries.match(/key: '(duo|annual)'/g) || []).length;
  ok(n === 2, '入口数不是 2：' + n);
  // 收藏夹/时光机/回忆地图 是底部 tab，在「我的」里再摆一遍等于占着最贵的位置给零信息
  ['collection', 'album', 'discover'].forEach((k) => {
    ok(!new RegExp("key: '" + k + "'").test(entries), `「${k}」是 tab 页，不该再占一个功能卡`);
  });
});
t('入口顺序与文案', () => {
  const names = [...meJs.matchAll(/name: '([^']+)'/g)].map((m) => m[1]).slice(0, 2);
  ok(JSON.stringify(names) === JSON.stringify(['双人空间', '年度报告']), '实际：' + names.join('/'));
});
t('勋章与额度已从设置页搬到「我的」（荣誉摆在前面才看得见）', () => {
  ok(/wx:for="\{\{badges\}\}"/.test(meWxml), '「我的」没有渲染 badges');
  ok(/wx:if="\{\{quotaLeftNum >= 0\}\}"/.test(meWxml), '「我的」没有额度卡');
  ok(/refreshQuota/.test(meJs), 'me.js 没有取额度');
  ok(!/computeBadges|refreshQuota|quotaLeftNum/.test(stJs), '设置页仍留着勋章/额度 —— 两头各一份，改一处必漏一处');
});
t('统计卡三列标签与设计稿一致', () => {
  const labels = [...meWxml.matchAll(/class="me-stat-l">([^<]+)</g)].map((m) => m[1]);
  ok(JSON.stringify(labels) === JSON.stringify(['已收藏', '城市足迹', '美好回忆']), '实际：' + labels.join('/'));
});
t('统计卡第二列单位是「座」、第三列是「段」', () => {
  const units = [...meWxml.matchAll(/class="me-stat-u">([^<]+)</g)].map((m) => m[1]);
  ok(JSON.stringify(units) === JSON.stringify(['张', '座', '段']), '实际：' + units.join('/'));
});
t('hero 副标题是 slogan，不再是「收藏天数·署名」', () => {
  ok(meWxml.includes('时光不回头，票根存温柔'), '未找到 slogan');
  ok(!/collectDays|signature/.test(meWxml), '旧字段仍在新 wxml 里');
});
t('默认头像走品牌 LOGO，且图真的在包里（8.3.3）', () => {
  // 必须是 wx:else 那一支：授权过微信头像的用户仍然优先，LOGO 只做兜底
  ok(/<image\s+wx:else\s+class="me-avatar"\s+src="\/images\/brand-logo\.png"/.test(meWxml),
    '默认头像没接品牌 LOGO（或没挂在 wx:else 分支上，会盖掉用户自己设的头像）');
  ok(fs.existsSync(path.join(ROOT, 'images/brand-logo.png')), 'images/brand-logo.png 不在包里，真机上是空白');
  // 旧的 SVG 头像已连同 utils/deco.js 里的 avatarBody 一起删掉，别再被引回来
  ok(!/avatarSrc|ic\.avatar/.test(meWxml + meJs), 'me 页仍引用已删除的 SVG 头像');
});
t('Lv 徽章与旧页脚已移除', () => {
  ok(!/me-lv|Lv\./.test(meWxml), 'Lv 徽章仍在');
  ok(!/me-foot/.test(meWxml), '旧页脚仍在');
});

console.log('\n【五、主题切换后图形必须重编】');
t('me.js 在 onShow 里重建图标与装饰', () => {
  // 边界必须取「定义处」而不是「调用处」——indexOf('buildView()') 命中的是 this.buildView()
  const onShow = meJs.slice(meJs.indexOf('onShow()'), meJs.indexOf('\n  buildView()'));
  ok(/this\.buildView\(\)/.test(onShow), 'onShow 未调 buildView');
  ok(/themeUtil\.apply\(this\)/.test(onShow), 'onShow 未 apply 主题');
});
t('setting.js 在 onShow 里重建图标', () => {
  // 边界取「下一个方法定义」而不是某个具体方法名：那个方法名一改，切片就退化成整个文件，断言白写
  const start = stJs.indexOf('onShow()');
  const next = stJs.indexOf('\n  goTheme()');
  ok(start > -1 && next > start, '找不到 onShow 的边界');
  const onShow = stJs.slice(start, next);
  ok(/iconSrc\('chevron'/.test(onShow), 'onShow 未重编 chevron');
  ok(/themeUtil\.apply\(this\)/.test(onShow), 'onShow 未 apply 主题');
});
t('图标色一律取主题实色，不喂 meta.text2（film/minimal 是 rgba）', () => {
  [meJs, stJs].forEach((j) => ok(!/iconSrc\([^)]*\.text2/.test(j), 'iconSrc 收到 .text2'));
});

console.log('\n【六、设置页必须真的能落地，不能是空壳】');
t('设置页已注册进 app.json', () => {
  const app = JSON.parse(read('app.json'));
  ok(app.pages.includes('pages/setting/setting'), '未注册');
});
t('setting.wxml/js/wxss/json 四件套齐全', () => {
  ['wxml', 'js', 'wxss', 'json'].forEach((ext) => {
    ok(fs.existsSync(path.join(ROOT, 'pages/setting/setting.' + ext)), '缺 setting.' + ext);
  });
});
t('旧「我的」页的死 toast 入口已迁走（goSetting 现在是真跳转）', () => {
  ok(!/设置项开发中/.test(meJs), 'me.js 仍有设置死 toast');
  ok(/pages\/setting\/setting/.test(meJs), 'me.js 未跳设置页');
});
t('勋章墙真正渲染（computeBadges 不再只算不用）', () => {
  ok(/computeBadges/.test(meJs), 'me.js 未调用 computeBadges');
  ok(/wx:for="\{\{badges\}\}"/.test(meWxml), 'me.wxml 未渲染 badges');
  ok(fs.existsSync(path.join(ROOT, 'utils/badges.js')), 'utils/badges.js 不存在');
});
t('隐私政策承诺的「我的-清除昵称与头像」真的点得到', () => {
  const protocol = read('pages/protocol/protocol.js');
  // 7.4.1：按钮文案由「清除署名资料」改成「清除昵称与头像」（前者是内部叫法，用户看不懂）
  ok(/我的-清除昵称与头像/.test(protocol), '协议里这句话没了，这条断言要跟着改');
  ok(/bindtap="clearProfile"/.test(meWxml), '「我的」页没有这个入口 —— 协议承诺了做不到的事');
  ok(/pay\.clearProfile\(\)/.test(meJs), '按钮没接到数据层（云函数 profileClear 早就写好了）');
});

t('勋章只在「我的」算一次（设置页不再残留）', () => {
  ok(!/computeBadges/.test(stJs), 'setting.js 仍在算勋章');
  ok(!/LS_SHARE/.test(stJs), 'setting.js 仍读分享计数');
});
t('设置页只留「不常点、但找得到」的东西：协议 / 关于 / 立牌 / 清除', () => {
  ok(!/listTickets/.test(stJs), 'setting.js 还在拉票根列表 —— 那说明有内容没迁走');
  const rows = /const ROWS = \[([\s\S]*?)\n\];/.exec(stJs);
  ok(rows, '找不到 ROWS');
  const keys = [...rows[1].matchAll(/key: '(\w+)'/g)].map((m) => m[1]);
  // 8.1.0 加了一行 sign（合作场馆立牌）：它是**运营工具**，只有作者本人用，
  // 放进「我的」那两个常驻入口会白占一格 —— 但 7.2.0 那条原则的精神没变：
  // 这里放的是「不需要被看见」的东西，额度与勋章那种要先被看见的仍然不许回来。
  ok(JSON.stringify(keys) === JSON.stringify(['privacy', 'terms', 'about', 'sign', 'clear']),
    '实际：' + keys.join('/'));
  ok(keys[keys.length - 1] === 'clear', '清除不在最后（破坏性操作要垫底）：' + keys.join('/'));
  // 这两个曾经是「点了一直弹『开发中』」的死入口，已随 L1/L2 清掉
  ok(!/回收站/.test(stJs), '回收站入口仍在（功能没做，只留一句「开发中」）');
});

console.log('\n【六·补、同场印记开关：协议承诺过的「可随时退出参与」】');
// P2-26：这一条对外承诺在协议里，入口却随 me→setting 改版丢了两年。
// 承诺了做不到，比不写更糟 —— 所以这里既钉开关本身，也钉「承诺 ↔ 入口」对得上。
t('真跑一遍：写得进、读得出，落的还是老键 sp_same_optout', () => {
  const mem = {};
  const prev = global.wx;
  global.wx = {
    getStorageSync: (k) => mem[k],
    setStorageSync: (k, v) => { mem[k] = v; }
  };
  try {
    const s = require('../utils/store.js');
    ok(typeof s.setSameOptOut === 'function',
      'store 只有读没有写 —— 开关做出来也只能读，等于还是退不出去');
    s.setSameOptOut(true);
    ok(s.getSameOptOut() === true, '写进去 true 读出来不是 true');
    ok(mem.sp_same_optout === true, '落的键不是 sp_same_optout：老用户存过的值会读不到，退出状态凭空复位');
    s.setSameOptOut(false);
    ok(s.getSameOptOut() === false, '关回去没生效');
    s.setSameOptOut('随便一个真值');
    ok(s.getSameOptOut() === true, '非布尔值没归一：存了个字符串，读出来该是 true');
  } finally {
    if (prev === undefined) delete global.wx; else global.wx = prev;
  }
});
t('开关说的是「参与」、存的是「退出」，取反只在 handler 里做一次', () => {
  ok(/checked="\{\{!sameOptOut\}\}"/.test(stWxml), '开关没有取反：打开开关等于「退出同场」，方向是反的');
  ok(!/checked="\{\{sameOptOut\}\}"/.test(stWxml), 'wxml 直接拿 sameOptOut 当开关状态 —— 用户打开它，实际是退出');
  ok(/setSameOptOut\(!participate\)/.test(stJs), 'handler 里没把「参与」翻成「退出」');
  ok(/sameOptOut: store\.getSameOptOut\(\)/.test(stJs), 'onShow 没回读：别处改过它，页面显示的还是旧的');
});
t('「清除本地数据」不得把用户说过的「退出」清回「参与」', () => {
  const list = /const LS_CLEAR = \[([\s\S]*?)\n\];/.exec(stJs);
  ok(list, '找不到 LS_CLEAR（改了写法就把这条断言一起改）');
  ok(!/sp_same_optout/.test(list[1]),
    'sp_same_optout 进了清除清单：一次清缓存就把用户的隐私选择撤销了，而且是悄悄的');
});
t('协议写的退出路径真的点得到，且整条链子接得上', () => {
  const protocol = read('pages/protocol/protocol.js');
  const m = /你可以在「([^」]*同场印记)」中随时退出参与/.exec(protocol);
  ok(m, '协议里这句承诺没了（这条断言要跟着改）');
  ok(m[1] === '我的-设置-同场印记', '协议写的路径是「' + m[1] + '」，与实际入口对不上');
  ok(/bindchange="onSameMark"/.test(stWxml), '设置页没有这个开关 —— 协议又变成承诺了做不到的事');
  ok(/onSameMark\s*\(/.test(stJs), '开关绑了不存在的处理器（点了没反应）');
  // 端上存偏好 → 入库带上 → 云端据此清空场次键，三段缺一段就等于没退出
  ok(/sameOptOut/.test(read('utils/store.js')), '入库时没把偏好带给云端');
  ok(/sameOptOut/.test(read('cloudfunctions/saveTicket/index.js')), '云端不再认这个开关：退出后新票根照样计入');
});

console.log('\n【七、全仓库：JS 里引用的图标名必须都存在】');
t('扫描全部 pages/ 的 iconSrc/icon: 调用', () => {
  const files = [];
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    });
  })(path.join(ROOT, 'pages'));
  const bad = [];
  files.forEach((f) => {
    const src = fs.readFileSync(f, 'utf8');
    const names = [...src.matchAll(/iconSrc\('([a-zA-Z]+)'/g)].map((m) => m[1])
      .concat([...src.matchAll(/\bicon:\s*'(?!none'|success')([a-zA-Z]+)'/g)].map((m) => m[1]));
    names.forEach((n) => { if (!ICONS.has(n)) bad.push(path.relative(ROOT, f) + ':' + n); });
  });
  ok(bad.length === 0, '引用了不存在的图标：' + bad.join(', '));
});

console.log('\n──────────────────────────────');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
