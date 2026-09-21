// custom-tab-bar/index.js —— 自定义 tabBar（v7.0 建，8.2.0 按品牌稿屏02 重排）
// ============================================================
// 结构：票根墙 / 时光机 /〔中央相机〕/ 回忆地图 / 我的
//   —— 8.2.0 一律改成**从稿子上量的**数（量法：稿 1152px = 750rpx，1px = 0.651rpx）：
//      栏体 通栏满宽（不是浮起来的圆角卡）　栏高 112rpx
//      图标 34rpx（34.5 × 31.3 实测）　文字 18rpx　四个 tab 列宽 128rpx、左右各留 51rpx
//      选中态 珊瑚红 #DE8F8B，**没有**圆点、也不把图标抬高（四个标签共用一条基线）
//      未选态 实色暖棕（原来 40% 透明，压在奶油底上看不清）
//      中央相机钮 直径 75rpx（115/1152 屏宽）、钮顶与栏体上沿齐平、无白描边、实心白相机
//   —— 旧的一版是照《精修》规范图做的（56pt/24pt/10pt 那一套），两套口径对不上；
//      首页按品牌稿复刻，所以这里也按品牌稿走。
//
// ⚠️ 本文件的两处关键修正（v7.0）：
//   1. 图标由「内联 <svg> 标签」改为「<image> + data-uri SVG」。
//      微信小程序 WXML **不支持内联 svg 标签**（小程序没有 SVG 原生渲染树，
//      <svg> 会被当作普通自定义组件容器，子元素 path/circle 全部丢弃），
//      结果是 4 个 tab 图标**一个都不显示**、只剩文字。本仓库
//      components/svg-icon 与 CHANGELOG 4.10.7 都记录过这个坑，
//      这里改走官方 image 组件（image 原生支持 SVG），颜色在拼 SVG 字符串时
//      直接写进 stroke —— 不依赖 mask、不依赖 currentColor。
//   2. 图标造型按规范图更正：时光机=时钟（原误用票根）、回忆地图=折页地图
//      （原误用罗盘）、票根墙=票根、我的=人像。
//
// ⚠️ 自定义组件独立渲染树，不继承 app.wxss 挂在 page 上的 CSS 变量，
//    故 index.wxss 内按主题类重新声明一份令牌；此处只额外需要「图标描边色」，
//    单独用 THEME_INK 表镜像一份（改色时与 index.wxss / theme.js 同步）。
const themeUtil = require('../utils/theme.js');
const { iconSrc } = require('../utils/icons.js');
const deco = require('../utils/deco.js');

// —— 描边色（十六进制实色：SVG 属性不认 var() / rgba()）——
// on = 选中态主色；off = 未选色（#6B5B50 基准，按各主题正文色调配）
// op = 未选态透明度，缺省 0.4（规范图的旧口径）
const THEME_INK = {
  paper:   { on: '#2B2420', off: '#2B2420' },
  glass:   { on: '#D9A0A6', off: '#6B5B50' },
  // 8.2.0 collage 两项照品牌稿改：
  //   on：#D9A0A6 → #DE8F8B（稿实测选中态是珊瑚红，与首页胶囊的 --chip-on 同色）
  //   op：0.4 → 1（稿上的未选态是**实色**暖棕，40% 透明压在奶油底上淡到几乎看不见）
  collage: { on: '#DE8F8B', off: '#6B5B50', op: 1 },
  film:    { on: '#C26B5E', off: '#EDE3D6' },
  literary:{ on: '#A9C3A6', off: '#6B5B50' },
  minimal: { on: '#1A1A1A', off: '#1A1A1A' }
};
const OFF_OPACITY = 0.4;

/** 4 个 tab 的文案与图标名（顺序即 app.json tabBar.list 顺序）
 *  8.3.0：前两枚照品牌稿屏02 换成「房子」「星形小屋」（原为票根/时钟）。
 *  造型分两套：未选=细线，选中=实心（见下面 buildList 里的说明）。 */
const TABS = [
  { text: '票根墙', ico: 'house' },
  { text: '时光机', ico: 'starhouse' },
  { text: '回忆地图', ico: 'map' },
  { text: '我的', ico: 'user' }
];

/** 按主题算出 4 个 tab 的选中/未选图标地址
 *  线宽 1.9（默认 1.6）：**只给未选态**用 —— 稿上这条栏的线条比正文图标粗一档。
 *  只在菜单栏加粗，别处（列表、详情）保持 1.6 —— 那些地方图标旁边有正文，加粗会抢。 */
const TAB_STROKE = 1.9;
function buildList(theme) {
  const ink = THEME_INK[theme] || THEME_INK.glass;
  const op = typeof ink.op === 'number' ? ink.op : OFF_OPACITY;
  return TABS.map((t, idx) => ({
    idx,
    text: t.text,
    ico: t.ico,
    // 选中态走**实心**造型（iconSrc 第 5 个参数）：两份稿子都写明了这条 ——
    // 稿屏02 首页选中的「票根墙」是实心珊瑚房子，《底部Tab栏组件规范》也单列了
    // 「默认态=细线 / 选中态=实心块面」。以前只换了颜色，造型没换。
    icoOn: iconSrc(t.ico, ink.on, 1, TAB_STROKE, true),
    icoOff: iconSrc(t.ico, ink.off, op, TAB_STROKE)
  }));
}

/** 栏体两端的装饰（稿屏02 上：左端三道波浪、右端一颗四角星拖着波浪）。
 *  颜色跟着**选中色**走，和 tab 选中态同一支色，整条栏才像一个整体。 */
function buildDeco(theme) {
  const ink = THEME_INK[theme] || THEME_INK.glass;
  return {
    wave: deco.decoSrc('wavelines', { primary: ink.on }),
    star: deco.decoSrc('star4', { accent: ink.on })
  };
}

/** 换主题要重建的两件东西：图标是位图 src，装饰是编好色的 SVG —— 都得整套重算 */
function buildTheme(theme) {
  return { list: buildList(theme), deco: buildDeco(theme) };
}

Component({
  data: Object.assign({ selected: 0, theme: 'glass' }, buildTheme('glass')),

  // 各 tab 页 onShow 会 setData({ theme }) 同步主题；图标是位图 src，
  // 换主题必须重建 list（不能靠 CSS 变量），故用 observer 兜住所有入口
  observers: {
    theme(t) {
      const k = themeUtil.THEMES.indexOf(t) !== -1 ? t : themeUtil.DEFAULT_THEME;
      const next = buildTheme(k);
      // 只在真的换了主题时写回，避免无谓的 setData
      if (!this.data.list || this.data.list[0].icoOn !== next.list[0].icoOn) {
        this.setData(next);
      }
    }
  },

  lifetimes: {
    attached() {
      const t = themeUtil.getTheme();
      this.setData(Object.assign({ theme: t }, buildTheme(t)));
    }
  },

  methods: {

    switchTab(e) {
      wx.vibrateShort({ type: 'light' });
      const idx = e.currentTarget.dataset.idx;
      if (idx == null) return;
      const map = ['/pages/home/home', '/pages/album/album', '/pages/discover/discover', '/pages/me/me'];
      wx.switchTab({ url: map[idx] });
    },

    goFab() {
      wx.vibrateShort({ type: 'medium' });
      wx.navigateTo({ url: '/pages/scan/scan' });
    }
  }
});
