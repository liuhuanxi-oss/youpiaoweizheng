// tests/discover_map.test.js —— 回忆地图（品牌全案 · 稿屏7）回归测试
// 核心断言：① 城市气泡的落点必须由真实经纬度算出，不能手摆；
//           ② 气泡互相撞了只允许挪气泡、不许挪落点；
//           ③ 页面里的图形一律走 <image src="data:image/svg+xml,...">，无内联 svg / emoji / var()。
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

const map = require(path.join(ROOT, 'utils', 'mapArt.js'));
const wxml = read('pages/discover/discover.wxml');
const wxss = read('pages/discover/discover.wxss');
const js = read('pages/discover/discover.js');
const icons = read('utils/icons.js');

const wxmlClean = wxml.replace(/<!--[\s\S]*?-->/g, '');
const ICONS = new Set([...icons.matchAll(/^\s{2}([a-zA-Z][\w]*):/gm)].map((m) => m[1]));

// 真实城市坐标（与 utils/mock.js 同源）
const CITY = {
  北京: { lng: 116.40, lat: 39.90 },
  上海: { lng: 121.47, lat: 31.23 },
  成都: { lng: 104.07, lat: 30.66 },
  广州: { lng: 113.26, lat: 23.13 },
  武汉: { lng: 114.30, lat: 30.50 },
  长沙: { lng: 112.98, lat: 28.15 }
};
const stageOf = (n) => map.toStage(CITY[n].lng, CITY[n].lat);

console.log('\n【一、投影：落点必须真的由经纬度算出来】');
t('东边的城 x 更大、北边的城 y 更小', () => {
  ok(stageOf('上海').x > stageOf('成都').x, '上海应在成都以东');
  ok(stageOf('北京').y < stageOf('广州').y, '北京应在广州以北');
});
t('横向按 cos35° 压缩（不压会把中国拉成扁带）', () => {
  ok(Math.abs(map.KX - Math.cos(35 * Math.PI / 180)) < 1e-9, 'KX 不是 cos35°');
  // 陆地长宽比应接近真实中国的 ~1.40，而不是未经压缩的 61.7/35.8 = 1.72
  const ratio = (map.ART_W) / ((map.LAT1 - map.LAT0) * map.S);
  ok(ratio > 1.35 && ratio < 1.46, '陆地长宽比 ' + ratio.toFixed(3) + ' 不像中国');
});
t('六座城市都落在舞台内且不贴边', () => {
  Object.keys(CITY).forEach((n) => {
    const p = stageOf(n);
    ok(p.x > 40 && p.x < map.STAGE_W - 40, n + ' x 出界：' + p.x);
    ok(p.y > 40 && p.y < map.STAGE_H - 40, n + ' y 出界：' + p.y);
  });
});
t('同一座城的多个坐标取平均后仍落在原地附近', () => {
  const a = map.toStage(114.39, 30.508); // 武汉 · mock 第 1 张
  const b = map.toStage(114.42, 30.51);  // 武汉 · mock 第 3 张
  ok(Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1, '同城坐标差被放大：' + a.x + '/' + b.x);
});
t('toStage 收到脏值返回 null 而不是 NaN 落点', () => {
  ok(map.toStage(undefined, 30) === null, '未拦住 undefined');
  ok(map.toStage('116', 39) === null, '未拦住字符串');
});
t('落点必须是数值而非字符串（字符串会让避让的加减变成拼接）', () => {
  Object.keys(CITY).forEach((n) => {
    const p = stageOf(n);
    ['x', 'y', 'cx', 'cy'].forEach((k) => {
      ok(typeof p[k] === 'number', n + ' 的 ' + k + ' 是 ' + typeof p[k] + '：' + JSON.stringify(p[k]));
      ok(Number.isFinite(p[k]), n + ' 的 ' + k + ' 不是有限数：' + p[k]);
    });
  });
});
t('被顶到落点下方的气泡，坐标也是正常的数（不是拼接出来的天文数字）', () => {
  // 构造一座必定被挤到下方去的城：三座同经度的城叠在一起
  const lng = 116.4, lat = 39.9;
  const list = [
    { city: '北京', x: 400, y: 300, push: 0, below: false },
    { city: '北京二', x: 400, y: 300, push: 0, below: false },
    { city: '北京三', x: 400, y: 300, push: 0, below: false },
    { city: '北京四', x: 400, y: 300, push: 0, below: false },
    { city: '北京五', x: 400, y: 300, push: 0, below: false },
    { city: '北京六', x: 400, y: 300, push: 0, below: false }
  ];
  ok(map.STAGE_H === 645 && lng > 0 && lat > 0, '常量漂了，这条断言的前提变了');
  map.layoutBubbles(list);
  const below = list.filter((c) => c.below);
  ok(below.length > 0, '六座城叠一起都没被挤到下方，避让没生效');
  below.forEach((c) => {
    const top = c.y + map.PIN_GAP + c.push;
    ok(typeof c.push === 'number' && Number.isFinite(top) && top < map.STAGE_H,
      c.city + ' 被顶到了 ' + top + '（远离屏幕）');
  });
});

console.log('\n【二、气泡避让：只推气泡，绝不动落点】');
const build = (names) => names.map((n) => {
  const p = stageOf(n);
  return { city: n, x: p.x, y: p.y, push: 0, below: false };
});
// 与 mapArt.layoutBubbles 内部同一套算法：气泡 translateX(-50%) 居中，横向占位是半宽之和
const boxOf = (c) => {
  const top = c.below ? c.y + map.PIN_GAP + c.push : c.y - map.PIN_GAP - c.push - map.BUBBLE_H;
  return { x: c.x, half: map.bubbleWidth(c.city) / 2, top, bottom: top + map.BUBBLE_H };
};
const overlap = (a, b) =>
  Math.abs(a.x - b.x) < a.half + b.half && a.top < b.bottom && b.top < a.bottom;
t('东部密集六城排完互不重叠', () => {
  const list = map.layoutBubbles(build(['北京', '上海', '成都', '广州', '武汉', '长沙']));
  const bad = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (overlap(boxOf(list[i]), boxOf(list[j]))) bad.push(list[i].city + '×' + list[j].city);
    }
  }
  ok(bad.length === 0, '仍然重叠：' + bad.join(', '));
});
t('避让只改 push/below，x/y 一个都没动', () => {
  const list = map.layoutBubbles(build(['北京', '上海', '武汉', '长沙']));
  list.forEach((c) => {
    const p = stageOf(c.city);
    ok(c.x === p.x && c.y === p.y, c.city + ' 的落点被挪了');
  });
});
t('被顶开的气泡都留在舞台内', () => {
  const list = map.layoutBubbles(build(['北京', '上海', '成都', '广州', '武汉', '长沙']));
  list.forEach((c) => {
    const b = boxOf(c);
    ok(b.top >= 0 && b.bottom <= map.STAGE_H, c.city + ' 的气泡跑出舞台：' + b.top + '~' + b.bottom);
  });
});
t('只有一座城时不产生多余的 push', () => {
  const list = map.layoutBubbles(build(['北京']));
  ok(list[0].push === 0 && list[0].below === false, '单城被顶开：' + list[0].push);
});
t('气泡配色按城市名定，不随票数变', () => {
  ok(map.bubbleColor('北京') === map.bubbleColor('北京'), '同名不同色');
  ok(map.bubbleColor('constructor') === map.bubbleColor('constructor'), '原型链上的名字不稳定');
});

console.log('\n【三、舞台尺寸与插画比例必须锁死】');
t('STAGE 宽高比 === 插画 viewBox 宽高比', () => {
  const a = map.STAGE_W / map.STAGE_H;
  const b = map.ART_W / map.ART_H;
  ok(Math.abs(a - b) < 0.002, '舞台 ' + a.toFixed(4) + ' vs 插画 ' + b.toFixed(4) + '，气泡会飘出色块');
});
t('stageW/stageH 由 JS 下发（不在 WXSS 里写死）', () => {
  ok(/style="width:\{\{stageW\}\}rpx; height:\{\{stageH\}\}rpx;"/.test(wxmlClean), 'wxml 未绑定舞台尺寸');
  ok(!/\.dc-stage\s*\{[^}]*width:\s*\d+rpx/.test(wxss), 'wxss 又写死了舞台宽度');
});

console.log('\n【四、图形一律走 data-uri，不得有内联 svg / emoji】');
t('wxml 正文无 <svg> / <path> / <circle>', () => {
  ok(!/<svg[\s>]/i.test(wxmlClean), '发现内联 <svg>');
  ok(!/<path[\s>]/i.test(wxmlClean), '发现内联 <path>');
  ok(!/<circle[\s>]/i.test(wxmlClean), '发现内联 <circle>');
});
t('wxml 正文无 emoji（时间轴的 🎤🎬🚄🎫🗺 必须换成图标）', () => {
  const m = wxmlClean.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2728}\u{2764}]/u);
  ok(!m, '残留：' + (m && m[0]));
});
t('时间轴列表已整体删除（按用户拍板改成点气泡看票）', () => {
  ['dc-time-head', 'dc-time-grp', 'dc-time-card', 'dc-time-more', 'dc-timeline'].forEach((c) => {
    ok(!wxmlClean.includes(c) && !wxss.includes('.' + c), '残留：' + c);
  });
  ok(!/timeline|toggleShowAll|showAll/.test(js), 'js 里仍有时间轴逻辑');
  ok(!/goMapFull|pages\/map\/map/.test(js), '旧「查看完整地图」入口仍在');
});

console.log('\n【五、所有图形绑定都在 buildArt 里编译出来】');
t('wxml 用到的每个 ic.X / deco.X / rowIc.X 都有定义', () => {
  const body = js.slice(js.indexOf('buildArt()'), js.indexOf('/** 拉票根'));
  const hit = (re) => new Set([...wxmlClean.matchAll(re)].map((m) => m[1]));
  // route 不在此列：它随票根走（refresh 里算），不随主题走
  ['ic', 'deco', 'rowIc', 'stampL', 'stampR', 'land'].forEach((grp) => {
    if (['stampL', 'stampR', 'land'].includes(grp)) {
      ok(new RegExp(grp + ':').test(body), grp + ' 未在 buildArt 里编译');
      return;
    }
    const used = hit(new RegExp(grp + '\\.([A-Za-z0-9_]+)', 'g'));
    const defined = new Set([...body.matchAll(new RegExp('^\\s{6,8}([A-Za-z0-9_]+):', 'gm'))].map((m) => m[1]));
    [...used].forEach((u) => ok(defined.has(u), grp + '.' + u + ' 未定义'));
  });
});
t('iconSrc 不喂 meta.text2（film/minimal 是 rgba 字面量）', () => {
  ok(!/iconSrc\([^)]*m\.text2/.test(js), 'iconSrc 收到 m.text2');
});
t('用到的图标名都在 icons.js 里注册', () => {
  const used = [...js.matchAll(/iconSrc\('([a-zA-Z]+)'/g)].map((m) => m[1]);
  ok(used.length >= 8, '调用点偏少：' + used.length);
  const bad = [...new Set(used)].filter((u) => !ICONS.has(u));
  ok(bad.length === 0, '不存在：' + bad.join(', '));
});
t('新增的 close 图标已注册', () => ok(ICONS.has('close'), '缺少 close'));

console.log('\n【六、WXSS 与 WXML 类名对得上、无写死颜色】');
t('wxml 里的类名都在 wxss 里有定义（放行全局公共类）', () => {
  const GLOBAL = /^(tk-|press|theme-|card$|b-|skeleton-|ad-|serif$|mono$)/;
  const used = new Set([...wxmlClean.matchAll(/(?:^|\s)class="([^"]*)"/g)]
    .flatMap((m) => m[1].replace(/\{\{[\s\S]*?\}\}/g, ' ').split(/\s+/)).filter(Boolean));
  const defined = new Set([...wxss.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));
  const miss = [...used].filter((u) => !defined.has(u) && !GLOBAL.test(u));
  ok(miss.length === 0, 'wxss 缺样式：' + miss.join(', '));
});
t('wxss 无写死的十六进制（只允许 var(--x, #兜底) 的兜底值）', () => {
  const stripped = wxss.replace(/var\([^)]*\)/g, 'VAR');
  const bad = [...stripped.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  ok(bad.length === 0, '写死色值：' + bad.join(', '));
});
t('避让算法用的气泡尺寸 = WXSS 里的实际尺寸（对不上就会互相压住）', () => {
  const blk = (sel) => {
    const i = wxss.indexOf(sel);
    ok(i >= 0, 'wxss 里找不到 ' + sel);
    return wxss.slice(i, wxss.indexOf('}', i));
  };
  const bub = blk('.dc-bubble {');
  const n = blk('.dc-bubble-n');
  const c = blk('.dc-bubble-c');

  const minW = Number(/min-width:\s*(\d+)rpx/.exec(bub)[1]);
  const pad = /padding:\s*(\d+)rpx\s+(\d+)rpx\s+(\d+)rpx/.exec(bub);
  const fsN = Number(/font-size:\s*(\d+)rpx/.exec(n)[1]);
  const lhN = Number(/line-height:\s*([\d.]+)/.exec(n)[1]);
  const fsC = Number(/font-size:\s*(\d+)rpx/.exec(c)[1]);
  const lhC = Number(/line-height:\s*([\d.]+)/.exec(c)[1]);

  ok(minW === map.BUBBLE_W, 'min-width ' + minW + ' ≠ 算法用的 BUBBLE_W ' + map.BUBBLE_W);
  ok(fsN === map.BUBBLE_FS, '城市名字号 ' + fsN + ' ≠ 算法用的 BUBBLE_FS ' + map.BUBBLE_FS);
  ok(Number(pad[2]) * 2 === map.BUBBLE_PAD,
    '左右内边距 ' + Number(pad[2]) * 2 + ' ≠ 算法用的 BUBBLE_PAD ' + map.BUBBLE_PAD);

  // 最长的城市名（四字，如「乌鲁木齐」）也不能撑破算法给它的预留宽度
  const WIDEST = '乌鲁木齐';
  const painted = fsN * WIDEST.length + Number(pad[2]) * 2;
  ok(painted <= map.bubbleWidth(WIDEST),
    WIDEST + ' 实宽 ' + painted + 'rpx 超过预留的 ' + map.bubbleWidth(WIDEST) + 'rpx，会压到隔壁');
  ok(map.bubbleWidth('北京') === minW, '两字名应收敛到 min-width');

  const h = fsN * lhN + fsC * lhC + Number(pad[1]) + Number(pad[3]);
  ok(h <= map.BUBBLE_H, '气泡实高约 ' + h.toFixed(0) + 'rpx 超过算法用的 BUBBLE_H ' + map.BUBBLE_H);
  ok(map.BUBBLE_H - h < 12, 'BUBBLE_H 比实际高太多（' + (map.BUBBLE_H - h).toFixed(0) + 'rpx），气泡会被白白顶开');
});

console.log('\n【七、城市票根面板：点气泡看票的主链路】');
t('点气泡 → 升起面板 → 点票根进详情', () => {
  ok(/bindtap="onCityTap"/.test(wxmlClean), '气泡未绑 onCityTap');
  ok(/data-city="\{\{item\.city\}\}"/.test(wxmlClean), '气泡未带城市名');
  ok(/onCityTap\(e\)/.test(js) && /picked: name/.test(js), 'onCityTap 未设置 picked');
  ok(/bindtap="goDetail"[\s\S]*?data-id="\{\{item\.id\}\}"/.test(wxmlClean), '面板未绑 goDetail');
  ok(/pages\/detail\/detail\?id=/.test(js), '未跳详情');
});
t('面板可关闭，且遮罩点一下就收', () => {
  ok(/closeSheet/.test(wxmlClean) && /closeSheet\(\)/.test(js), '未实现关闭');
  ok(/class="dc-mask"[^>]*bindtap="closeSheet"/.test(wxmlClean), '遮罩未绑关闭');
  ok(/dc-sheet \{\{picked \? 'on' : ''\}\}/.test(wxmlClean), '面板无升起态');
});
t('城市票根按日期倒序（最近的在最上面）', () => {
  ok(/list:\s*e\.list\.slice\(\)\.sort\(\(a, b\) => String\(b\.date/.test(js), '未倒序');
});
t('票根行的类型色块从 JS 下发，不在 wxss 里写死', () => {
  ok(/style="background:\{\{item\.tint\}\};"/.test(wxmlClean), '未绑定 tint');
  ok(/ROW_TINT/.test(js) && /tint: ROW_TINT\[/.test(js), '未从 ROW_TINT 取色');
});

console.log('\n【八、mapArt 产物本身是合法的 data-uri】');
const dec = (u) => decodeURIComponent(u.replace(/^data:image\/svg\+xml,/, ''));
t('landSrc 随主题换纸浆色（深色主题不能烧出亮边）', () => {
  const light = dec(map.landSrc({ soft: '#E9E2D4' }));
  const dark = dec(map.landSrc({ soft: '#3A302A' }));
  ok(light.includes('#E9E2D4') && !light.includes('#3A302A'), '浅色主题未用自身 soft');
  ok(dark.includes('#3A302A') && !dark.includes('#E9E2D4'), '深色主题未用自身 soft');
  ok(light.includes('<clipPath'), '色块未被国界裁剪，会画到国土外面');
});
t('landSrc 缺参数不崩，回落暖米白', () => {
  ok(dec(map.landSrc()).includes('#F7E9D2'), '未回落');
  ok(dec(map.landSrc({ soft: 'var(--x)' })).includes('#F7E9D2'), '未拦住 var() 注入');
});
t('routeSrc 少于两点返回空串（一个城市连不成线）', () => {
  ok(map.routeSrc([{ lng: 116, lat: 39 }]) === '', '单点仍出线');
  ok(map.routeSrc([]) === '' && map.routeSrc(null) === '', '空输入未拦住');
  ok(map.routeSrc([{ lng: 116, lat: 39 }, { lng: 121, lat: 31 }]).startsWith('data:image/svg+xml,'), '两点未出线');
});
t('routeSrc 丢掉脏点后不足两点就不画线（不能连到 (0,0) 去）', () => {
  ok(map.routeSrc([{ lng: 116, lat: 39 }, { lng: null, lat: 31 }]) === '', 'null 经度被当成了有效点');
  ok(map.routeSrc([{ lng: 116, lat: 39 }, {}]) === '', '空对象被当成了有效点');
  ok(map.routeSrc([{ lng: 116, lat: 39 }, { lng: '121', lat: 31 }]) === '', '字符串经度被当成了有效点');
  // 三个点里丢一个，仍应出线，且线里不能出现 NaN
  const s = dec(map.routeSrc([
    { lng: 116, lat: 39 }, { lng: 121, lat: 31 }, { lng: undefined, lat: 23 }
  ]));
  ok(s.startsWith('<svg'), '产物不合法');
  ok(!/NaN/.test(s), '线里画出了 NaN');
});
t('stampSrc 的齿孔骑在白边线上（圆心落在边线上才是咬口）', () => {
  const s = dec(map.stampSrc('#F5F0E6'));
  ok(/cy='0'/.test(s), '上边缘的孔心不在边线上，会变成一排圆点');
  ok(s.includes('#F5F0E6'), '齿孔未用传入的卡片色');
});

console.log('\n──────────────────────────────');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
