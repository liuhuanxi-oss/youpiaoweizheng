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
t('mock.js 的 13 枚勋章图标名全部存在（v7.0 已从 emoji 换成图标名）', () => {
  const used = [...mock.matchAll(/id: 'b\d+', icon: '([^']+)'/g)].map((m) => m[1]);
  ok(used.length === 13, '勋章数不是 13：' + used.length);
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
    const used = new Set([...w.matchAll(/(?:^|\s)class="([^"]*)"/g)]
      .flatMap((m) => m[1].replace(/\{\{[\s\S]*?\}\}/g, ' ').split(/\s+/)).filter(Boolean));
    const def = new Set([...s.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
    const miss = [...used].filter((u) => !def.has(u) && !GLOBAL.test(u));
    ok(miss.length === 0, '缺：' + miss.join(', '));
  });
  t(name + '.wxss 无写死的颜色（rgba 兜底除外）', () => {
    // 允许：var(--x, #兜底) 里的兜底值、小程序不支持的变量
    const stripped = s.replace(/var\([^)]*\)/g, 'VAR');
    const bad = [...stripped.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    ok(bad.length === 0, '写死色值：' + bad.join(', '));
  });
});

console.log('\n【四、稿屏11 的关键结构】');
t('「我的」页只剩 5 个功能入口', () => {
  // 只看 ENTRIES 字面量到 _route 之间，避免把 _route 里的 key 判断也算进来
  const entries = meJs.slice(meJs.indexOf('const ENTRIES'), meJs.indexOf('/**', meJs.indexOf('const ENTRIES')));
  const n = (entries.match(/key: '(collection|album|discover|annual|setting)'/g) || []).length;
  ok(n === 5, '入口数不是 5：' + n);
});
t('入口顺序与设计稿一致', () => {
  const names = [...meJs.matchAll(/name: '([^']+)'/g)].map((m) => m[1]).slice(0, 5);
  ok(JSON.stringify(names) === JSON.stringify(['我的收藏夹', '时光机', '回忆地图', '数据统计', '设置']), '实际：' + names.join('/'));
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
  const onShow = stJs.slice(stJs.indexOf('onShow()'), stJs.indexOf('refreshBadges()'));
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
  ok(/computeBadges/.test(stJs), 'setting.js 未调用 computeBadges');
  ok(/wx:for="\{\{badges\}\}"/.test(stWxml), 'setting.wxml 未渲染 badges');
  ok(fs.existsSync(path.join(ROOT, 'utils/badges.js')), 'utils/badges.js 不存在');
});
t('me.js 里不再残留勋章计算（已整体迁出）', () => {
  ok(!/computeBadges/.test(meJs), 'me.js 仍在算勋章');
  ok(!/LS_SHARE/.test(meJs), 'me.js 仍读分享计数');
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
