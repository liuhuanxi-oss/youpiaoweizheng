// pages/scan/scan.js —— 上传识别（M3 大模型解析版）
// ============================================================
// 流程：拍照/相册 →（云模式：上传云存储 → recognizeTicket 云函数 OCR 认字
//       → extend.AI 大模型理解成结构化草稿，规则引擎兜底；
//       演示模式：模拟识别 2.2s）→ 表单回填 → 用户逐项确认修改
//       → saveTicket 入库（云）/ 本地 storage（演示）→ 返回票根墙
// 识别失败不白拍：自动进入空表单，让用户手动补填。
// ============================================================
const { USE_CLOUD } = require('../../utils/env.js');
const store = require('../../utils/store.js');
const ai = require('../../utils/ai.js');
const themeUtil = require("../../utils/theme.js");
const { iconSrc } = require('../../utils/icons.js');
const deco = require('../../utils/deco.js');
const track = require('../../utils/track.js'); // 4.17.0：拉新埋点
const invite = require('../../utils/invite.js'); // 7.3.0 R6：邀请奖励结算
const { TYPE_TEXT } = require('../../utils/mock.js');
const haptics = require('../../utils/haptics.js'); // 7.4.0：触觉三档，别再直接写 vibrateShort

const TYPE_KEYS = ['show', 'movie', 'traffic'];
const TYPE_LABELS = TYPE_KEYS.map((k) => TYPE_TEXT[k]);
/** 类型选择用的图标名（蓝色稿屏3 全页无 emoji，图标一律走 utils/icons.js） */
const TYPE_ICONS = { show: 'mask', movie: 'film', traffic: 'train' };

/**
 * AI 四步（稿屏3 的 识别 → 修复 → 重绘 → 入档）。
 * 圆形底色是品牌固定色、六主题不变，白描线图标压在上面；
 * 故和 landSrc 一样由 JS 下发，WXSS 里只留尺寸（详见 utils/icons.js 顶部）。
 */
const STEPS = [
  { lb: '识别', bg: '#D98C8A', ic: 'scanface' },
  { lb: '修复', bg: '#B9A79A', ic: 'wand' },
  { lb: '重绘', bg: '#A9C3A6', ic: 'palette' },
  { lb: '入档', bg: '#B9A79A', ic: 'folder' }
];

/** 压在水彩实底上的字/图标色：恒白，品牌常量，故不走主题变量 */
const ON_TINT = '#FFFFFF';

/** 「票面已入档」这一拍停多久（ms）。见 _settle：太短用户看不见，太长就是白等 */
const SETTLE_MS = 420;

/** 识别最长等多久（ms）。超过就摆一条能走的路（手动填），不让「处理中」永远转下去。
 *  上限比云函数自身的超时宽裕些——云函数先超时会走 catch，那才是更准的报错。 */
const SCAN_TIMEOUT_MS = 25000;

/** 上传前的长边上限（px）。8.0.4 新增：此前只压质量不压分辨率，高分相机原图 0.5~1.5MB
 *  一张，而它会被首页墙 / 详情 / 卡片 / 回忆地图反复加载 —— CDN 流量是全项目唯一
 *  随用户数线性增长的支出。1600 够用：卡片导出画布 1080 宽，详情页全屏也就 1125 物理像素。 */
const UPLOAD_MAX_SIDE = 1600;

/** 取图片实际宽高（本地文件，无需权限）。拿不到就返回 null —— 调用方按「不压」处理，
 *  宁可多花一点流量，也不能因为量不出尺寸就把用户的照片弄丢。 */
function longSideOf(src) {
  return new Promise((resolve) => {
    wx.getImageInfo({
      src,
      success: (info) => resolve({ w: Number(info && info.width) || 0, h: Number(info && info.height) || 0 }),
      fail: () => resolve(null)
    });
  });
}

// 演示模式回填的示例草稿（与云函数 parser 输出同结构，实际数据以用户修改为准）
const DEMO_DRAFT = {
  title: '回春丹巡演 · 武汉站',
  type: 'show',
  date: '2025-10-26',
  time: '20:00',
  venue: 'VOX Livehouse',
  city: '武汉',
  seat: 'A区 12排 07座',
  price: 180,
  source: '大麦'
};

Page({

  /**
   * 8.1.0 老票根专场：从活动页过来的（?from=legacy）换一句取景提示。
   * 本页原先没有 onLoad，是这次为它加的 —— 没有它就拿不到启动参数。
   * 只做提示，不改任何识别或保存行为：老票认不准是必然的，用户自己会补填
   * （这条路本来就通：识别失败自动进空表单，见文件头）。
   */
  onLoad(options) {
    if (options && options.from === 'legacy') this.setData({ fromLegacy: true });
  },

  onShow() {
    themeUtil.apply(this);
    this.buildArt();
    // v6.6.0：prefers-reduced-motion 探测（减弱动效时入档只画终帧、浮层只做 opacity 过渡）
    this._probeReduce();
  },

  /**
   * 编译本页全部图形。主题一变就得重来 ——
   * SVG 是独立文档，页面 CSS 变量不会继承进去，var() 一律失效（见 utils/icons.js 顶部）。
   */
  buildArt() {
    const m = themeUtil.getThemeMeta(themeUtil.getTheme());
    this.setData({
      ic: {
        back: iconSrc('back', m.text, 0.85),
        spark: iconSrc('sparkle', m.accent),
        sparkSm: iconSrc('sparkle', m.accent, 0.7, 1.3),
        flash: iconSrc('flash', m.text, 0.75),
        help: iconSrc('help', m.text, 0.75),
        album: iconSrc('image', m.text, 0.8),
        camera: iconSrc('camera', ON_TINT, 1, 1, true),
        refresh: iconSrc('refresh', m.text, 0.8),
        sep: iconSrc('chevron', m.text, 0.45),
        empty: iconSrc('ticket', m.text, 0.3),
        check: iconSrc('check', m.accent, 1, 2),
        close: iconSrc('close', m.text, 0.6)
      },
      deco: {
        postmark: deco.decoSrc('postmark', m),
        stamp: deco.decoSrc('stamp', m),
        sprig: deco.decoSrc('sprig', m),
        wave: deco.decoSrc('wavelines', m),
        heart: deco.decoSrc('heartsmall', m)
      },
      // 四步的图标：白描线压在品牌色圆上，宽度统一 1.7
      steps: STEPS.map((s) => ({ lb: s.lb, bg: s.bg, src: iconSrc(s.ic, ON_TINT, 1, 1.7) })),
      // 类型选择：同上，白图标压在 --soft 底上会看不见，故底色随主题、图标随底色
      typeOptions: TYPE_KEYS.map((k) => ({
        key: k,
        label: TYPE_TEXT[k],
        src: iconSrc(TYPE_ICONS[k], m.text, 0.75)
      }))
    });
  },

  /** v6.6.0：reduced-motion 探测（支持则精确降级；API 不可用 fail-open 照常播放） */
  _probeReduce() {
    if (this._reduceProbed) return;
    this._reduceProbed = true;
    try {
      if (typeof this.createMediaQueryObserver !== 'function') return;
      const mq = this.createMediaQueryObserver();
      mq.observe({ query: '(prefers-reduced-motion: reduce)' }, (res) => {
        this._reduceMotion = !!res.matches;
      });
      this._mqo = mq;
    } catch (e) { /* 基础库不支持该 media feature：照常播放 */ }
  },

  onUnload() {
    if (this._mqo) { try { this._mqo.disconnect(); } catch (e) { /* 忽略 */ } }
    this._clearTimers();
    this._scanSeq = (this._scanSeq || 0) + 1; // 页面已走：在途识别结果一律丢弃
  },

  /** 登记本页定时器（onUnload 统一清掉）。
   *  为什么必须统一清：保存成功后有 600ms / 900ms 两个定时器，后一个负责 navigateBack ——
   *  用户在这 900ms 内自己按了返回，定时器还在，于是**再退一层**（一下退回两层）。 */
  _later(fn, ms) {
    this._timers = this._timers || [];
    const id = setTimeout(() => {
      this._timers = (this._timers || []).filter((x) => x !== id);
      fn();
    }, ms);
    this._timers.push(id);
    return id;
  },

  _clearTimers() {
    (this._timers || []).forEach(clearTimeout);
    this._timers = [];
  },

  /** 这次识别还算数吗（页面走了 / 用户取消 / 又开了一次都不是了）。
   *  不复核的话：用户已经手动填好表单，两秒后姗姗来迟的识别结果会把他的输入整个盖掉。 */
  _stale(seq) { return seq !== this._scanSeq; },

  /** 一次只放一条取图链路进来。
   *  真机上连点两下快门，两次 takePhoto 的回调都会回（回调是异步的，mode 还没变成 scanning），
   *  于是并起两条识别：重复上传同一个文件、两次结果互相覆盖，用户看到的是「越点越乱」。 */
  _acquirePick() {
    if (this._picking) return false;
    this._picking = true;
    return true;
  },
  data: {
    theme: "a",
    isDemo: !USE_CLOUD,
    // 8.1.0：从老票根专场过来的（取景提示换成「认不出可以直接填」，见 onLoad）
    fromLegacy: false,
    mode: 'camera',    // camera 取景 / scanning 识别中 / done 确认表单
    imgPath: '',       // 本地临时路径（预览用）
    imgFileID: '',     // 云存储 fileID（入库用）
    statusText: '',
    form: {
      title: '', type: 'show', date: '', time: '',
      venue: '', city: '', seat: '', price: '', source: ''
    },
    typeText: '演出',
    saving: false,
    stamped: false, // 4.13.0 品牌盖章动效
    liftOff: false, // v6.6.0 动效4：入档浮层上移淡出
    saveErr: false, // v6.6.0 动效4：保存失败 → 按钮红色抖动一次
    // —— v5.1 E2 上传中阶段进度（scanning 态进度条）——
    prog: 0,
    progText: '',
    // —— M4.5 类型选择弹出层（内容由 buildArt 编译：Emoji 换成了线性图标）——
    typeSheet: false,
    typeOptions: [],
    // —— 稿屏3「扫描票根」：图形与四步流程（buildArt 编译）——
    ic: {},
    deco: {},
    steps: [],
    // —— 6.4.0 品牌稿第三屏：相机取景态 ——
    devicePos: 'back',  // 翻转摄像头：back / front
    flash: 'off',       // 闪光灯：off / on
    camErr: false,      // 相机不可用（权限拒绝/被占用）→ 降级引导
    step: 0             // AI 四步点亮：0 未开始 / 1 识别 / 2 修复 / 3 重绘 / 4 入档
  },

  /** v5.1 E2：上传/识别状态推进（text=主文案；prog=进度 0-100；cap=进度下方小字）
   *  6.4.0：prog 同步驱动底部面板 AI 四步点亮（识别→修复→重绘→入档） */
  _setStatus(text, prog, cap) {
    const p = prog || 0;
    const step = p >= 90 ? 4 : p >= 60 ? 3 : p >= 35 ? 2 : p >= 8 ? 1 : 0;
    this.setData({ statusText: text, prog: p, progText: cap || '', step });
  },

  /** 收尾一拍：进度推满、第四步「入档」点亮，停一下再交给表单。
   *  为什么非要有这一拍：识别流程的最后一个状态是「AI 正在理解票面」85%，
   *  而第四步的门槛是 90 —— 没有它，四步永远只亮三步，用户看到的是「卡住了」。
   *  推满之后也不能立刻切页：那样进度条刚到头界面就没了，这一拍同样白给。 */
  _settle() {
    this._setStatus('票面已入档', 100, '解析完成');
    return new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  },

  // ============================================================
  // 6.4.0 品牌稿第三屏：相机取景（快门/相册/翻转/闪光/帮助/降级）
  // ============================================================

  /** 快门（灰玫粉大圆）：takePhoto → 与 chooseMedia 同一条识别链路 */
  takeShutter() {
    if (this.data.mode !== 'camera' || this.data.camErr) return;
    if (!this._acquirePick()) return; // 连点快门：只认第一次（见 _acquirePick）
    haptics.tap();
    const ctx = wx.createCameraContext();
    ctx.takePhoto({
      quality: 'high',
      success: (res) => {
        this._picking = false;
        if (res && res.tempImagePath) this.enterScan(res.tempImagePath);
      },
      fail: () => {
        // 快门失败（模拟器无画面/权限波动）→ 相册兜底，不让用户卡死
        this._picking = false;
        wx.showToast({ title: '相机暂不可用，试试相册', icon: 'none' });
        this.pickAlbum();
      }
    });
  },

  /** 相册钮：复用 chooseMedia album 链路 */
  pickAlbum() { this.pick({ currentTarget: { dataset: { source: 'album' } } }); },

  /** 翻转摄像头 */
  flipCamera() {
    haptics.tap();
    this.setData({ devicePos: this.data.devicePos === 'back' ? 'front' : 'back' });
  },

  /** 闪光灯开关（稿内 ⚡） */
  toggleFlash() {
    haptics.tap();
    this.setData({ flash: this.data.flash === 'on' ? 'off' : 'on' });
  },

  /** 拍摄技巧（稿内 ？） */
  showHelp() {
    wx.showModal({
      title: '拍得更清楚的小技巧',
      content: '光线亮一点 · 票根平放、四角对齐取景框 · 日期和座位拍清楚',
      confirmText: '知道了',
      showCancel: false
    });
  },

  /** 相机初始化失败（权限拒绝/被占用）→ 降级引导视图 */
  onCamErr() {
    if (!this.data.camErr) this.setData({ camErr: true });
  },

  /** 降级视图：去开权限 */
  goSetting() { wx.openSetting(); },

  /** 手动录入（稿外保留的最小出口）：跳过识别，直接进入空表单。
   *  它同时是**取消**：seq 一推，在途的识别结果回来时会被丢弃，不会再盖掉用户填的东西。 */
  goManualInput() {
    this._scanSeq = (this._scanSeq || 0) + 1;
    this._clearTimers();
    this.setData({
      mode: 'done',
      imgPath: '',
      imgFileID: '',
      form: { title: '', type: 'show', date: '', time: '', venue: '', city: '', seat: '', price: '', source: '' },
      typeText: TYPE_TEXT.show,
      stampTick: (this.data.stampTick || 0) + 1
    });
  },

  /** 识别链路统一入口：拍照 / 相册都汇到这里（photo tempImagePath 同链路） */
  enterScan(tempFilePath) {
    const seq = (this._scanSeq = (this._scanSeq || 0) + 1);
    this._clearTimers();
    this.setData({
      mode: 'scanning',
      imgPath: tempFilePath
    });
    this._setStatus(USE_CLOUD ? 'AI 正在读取票面信息…' : '演示模式 · 模拟识别中…', 8, '照片已就绪');
    // 兜底：识别一直不回来（弱网 / 云函数卡住）时给一条能走的路，别让「处理中」永远转
    this._later(() => {
      if (!this._stale(seq) && this.data.mode === 'scanning') this._timeoutScan();
    }, SCAN_TIMEOUT_MS);
    USE_CLOUD ? this.cloudRecognize(tempFilePath, seq) : this.demoRecognize(seq);
  },

  /** 识别超时：说清「可以先用」，出路是手动填。
   *  「再等等」不清 seq —— 在途那次请求若稍后真的回来了，照常回填，用户没白等。 */
  _timeoutScan() {
    haptics.warn();
    wx.showModal({
      title: '识别有点慢',
      content: '网络像是卡住了。可以先把票收下、手动补填票面信息，之后随时能改。',
      confirmText: '手动填',
      cancelText: '再等等',
      success: (r) => { if (r.confirm) this.goManualInput(); }
    });
  },

  // —— 第一步：选图（拍照 / 相册）——
  pick(e) {
    const source = e.currentTarget.dataset.source; // 'camera' | 'album'
    if (!this._acquirePick()) return; // 连点相册钮：只认第一次（见 _acquirePick）
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [source],
      sizeType: ['compressed'],
      success: (res) => {
        this._picking = false;
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        this.enterScan(file.tempFilePath);
      },
      // 4.9.4：fail 人话指引——not declared 指向后台隐私指引，其余透出原文
      fail: (err) => {
        this._picking = false;
        const m = String((err && err.errMsg) || '');
        if (/cancel/i.test(m)) return; // 用户主动取消，静默
        if (/not declared in the privacy/i.test(m)) {
          // 8.0.4：这是「后台隐私指引没声明该接口」——开发者的事。原先把 mp.weixin.qq.com
          // 的操作路径整段弹给用户，用户看不懂（也没有后台账号），审核员看到像半成品。
          console.warn('[scan] 后台《用户隐私保护指引》未声明相关接口：需在 mp.weixin.qq.com'
            + '「设置-服务内容声明-用户隐私保护指引」中声明「选中的照片或视频」「摄像头」'
            + '「相册（仅写入）」并提交至已生效，无需发版即刻恢复');
          wx.showModal({
            title: '暂时用不了相册',
            content: '这个入口还没准备好。先手动填一张？',
            confirmText: '知道了',
            showCancel: false
          });
          return;
        }
        // 4.19.3：用户曾拒绝相机/相册授权 → 后续调用直接 fail，光给 errMsg 是死路——
        // 给 openSetting 一键去开（deny 判断覆盖 auth deny / authorize / permission 系列 errMsg）
        if (/auth|deny|authorize|permission/i.test(m)) {
          wx.showModal({
            title: '需要' + (source === 'camera' ? '相机' : '相册') + '权限',
            content: '你之前拒绝过该权限。收票需要' + (source === 'camera' ? '拍照' : '从相册选照片') + '，请在设置中开启「' + (source === 'camera' ? '摄像头' : '添加到相册') + '」。',
            confirmText: '去设置',
            success: (r) => { if (r.confirm) wx.openSetting(); }
          });
          return;
        }
        wx.showModal({
          title: '打不开' + (source === 'camera' ? '相机' : '相册'),
          content: m.slice(0, 120) || '未知错误',
          confirmText: '知道了',
          showCancel: false
        });
      }
    });
  },

  /** 演示模式：给扫描动画 2.2s 舞台时间，然后回填示例草稿（进度条分段推进） */
  demoRecognize(seq) {
    this._setStatus('演示模式 · 模拟识别中…', 20, '正在上传照片');
    this._later(() => { if (!this._stale(seq)) this._setStatus('演示模式 · 模拟识别中…', 55, 'OCR 认字中'); }, 650);
    this._later(() => { if (!this._stale(seq)) this._setStatus('演示模式 · 模拟识别中…', 85, 'AI 理解票面信息'); }, 1350);
    this._later(async () => {
      if (this._stale(seq)) return;
      await this._settle();
      if (this._stale(seq)) return;
      this.applyDraft({ ...DEMO_DRAFT }, true);
    }, 2200);
  },

  /** 云模式：上传云存储 → 调识别云函数。
   *  seq 是「这次识别算不算数」的凭号：中途用户取消 / 重新拍了一张 / 页面走了，
   *  回来的一律丢弃 —— 否则迟到的结果会盖掉用户刚填好的表单。 */
  async cloudRecognize(tempPath, seq) {
    try {
      this._setStatus('上传照片中…', 20, '照片压缩上传中');
      // 4.9.5：OCR 要求图片 <2M——chooseMedia 的 compressed 在高分相机上仍可能超，再压一层
      let filePath = tempPath;
      try {
        // 8.0.4：连分辨率一起压。原先只降质量 —— 高分相机出来的 4000×3000 原图，
        // 质量 60 也还有 0.5~1.5MB，而它会被首页墙、详情、卡片、回忆地图反复加载：
        // 云存储的 CDN 流量是全项目唯一会随用户数线性烧钱的项（1 万用户进一次首页≈3MB×人）。
        // 长边 1600 够用：卡片导出画布 1080 宽、详情页全屏也就 1125 物理像素。
        const opt = { src: tempPath, quality: 60 };
        const size = await longSideOf(tempPath);
        if (size && Math.max(size.w, size.h) > UPLOAD_MAX_SIDE) {
          // 只能给一边：两边同时给会被当成拉伸目标（竖图会被压扁）
          if (size.w >= size.h) opt.compressedWidth = UPLOAD_MAX_SIDE;
          else opt.compressedHeight = UPLOAD_MAX_SIDE;
        }
        const c = await new Promise((resolve, reject) => {
          wx.compressImage(Object.assign({ success: resolve, fail: reject }, opt));
        });
        if (c && c.tempFilePath) filePath = c.tempFilePath;
      } catch (e) { /* 压缩失败用原图，不阻塞 —— 老基础库不认 compressedWidth 也走这一支 */ }
      if (this._stale(seq)) return;
      const up = await wx.cloud.uploadFile({
        cloudPath: `tickets/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`,
        filePath: filePath
      });
      if (this._stale(seq)) return;

      this._setStatus('AI 识别中…', 55, 'OCR 认字中');
      const res = await wx.cloud.callFunction({
        name: 'recognizeTicket',
        data: { fileID: up.fileID }
      });
      const r = res.result || {};
      if (!r.ok) throw new Error(r.msg || '识别失败');
      if (this._stale(seq)) return;

      this.setData({ imgFileID: up.fileID });
      this._setStatus('大模型理解票面中…', 85, 'AI 正在理解票面');
      // M3 升级：OCR 认字 → 大模型理解成结构化草稿（失败自动兜底规则引擎）
      const { draft, byAI } = await ai.parseDraftByAI(r.lines || [], r.draft || {});
      if (this._stale(seq)) return;
      this.setData({ imgFileID: up.fileID });
      await this._settle();
      if (this._stale(seq)) return;
      this.applyDraft(draft, false, byAI);
    } catch (e) {
      if (this._stale(seq)) return; // 已经手动填 / 已经重拍：这条报错与用户当前看到的无关
      // 识别失败 → 空表单手填兜底，不让用户白拍一趟
      wx.showModal({
        title: '没认出来',
        content: `${this.friendlyOcrError(e)}\n可以先收下照片，票面信息手动补填。`,
        confirmText: '手动填',
        showCancel: false,
        success: () => this.applyDraft({}, false)
      });
    }
  },

  /** 4.8.1：OCR 错误人话化——平台原始报错直接露出用户看不懂 */
  friendlyOcrError(e) {
    const raw = String((e && (e.errMsg || e.message)) || e);
    if (/market ?quota/i.test(raw)) {
      return '识别服务额度未配置（服务市场配额不足）。需在微信服务市场领取「通用印刷体识别」免费体验包并绑定本小程序后重试';
    }
    if (/no ?license|not ?open|permission/i.test(raw)) {
      return '识别服务未开通，请在微信公众平台服务市场开通「通用印刷体识别」';
    }
    // 8.0.4：其余一律给人话。原先默认分支返回 raw.slice(0,60) —— 用户第一次拍票（弱网、
    // 超时、-404011）看到的第一行是「cloud.callFunction:fail…」，第一印象就是「这 App 坏了」。
    // 原始串只留给日志，界面上一个字都不露。
    console.warn('[scan] 识别失败（原始报错）：', raw);
    return '这张没能识别出来（照片糊了或网络不稳），可以手动补填票面';
  },

  // —— 第二步：草稿 → 确认表单 ——
  applyDraft(draft, isDemo, byAI) {
    const f = {
      title: draft.title || '',
      type: TYPE_KEYS.includes(draft.type) ? draft.type : 'show',
      date: draft.date || '',
      time: draft.time || '',
      venue: draft.venue || '',
      city: draft.city || '',
      seat: draft.seat || '',
      price: draft.price != null ? String(draft.price) : '',
      source: draft.source || ''
    };
    this.setData({
      mode: 'done',
      form: f,
      typeText: TYPE_TEXT[f.type],
      demoDraft: !!isDemo,
      statusText: '',
      stampTick: (this.data.stampTick || 0) + 1 // 4.10.3：盖戳动画重播
    });
    if (isDemo) {
      wx.showToast({ title: '示例数据已回填，可修改', icon: 'none' });
    } else if (!f.title && !f.date) {
      wx.showToast({ title: '请手动补全票面信息', icon: 'none' });
    } else {
      wx.showToast({ title: byAI ? '大模型识别完成，请核对' : '识别完成，请核对', icon: 'none' });
    }
  },

  // —— 字段编辑（点击哪行改哪行）——
  editField(e) {
    const key = e.currentTarget.dataset.key;
    if (key === 'type') return this.editType();
    if (key === 'price') return this.editPrice();
    const labels = {
      title: '票名', date: '日期（如 2025-10-26）', time: '时间（如 20:00）',
      venue: '场馆', city: '城市', seat: '座位', source: '来源'
    };
    // 8.0.4：editable 弹窗的「当前值」得走 content —— 原来只填了 placeholderText，
    // 那是灰字提示、输入框本身是空的：OCR 把日期认成 2025-1O-26 时，用户想改一个字母，
    // 却必须把整串 2025-10-26 重打一遍。
    wx.showModal({
      title: `修改${labels[key] || ''}`,
      editable: true,
      content: this.data.form[key] || '',
      placeholderText: this.data.form[key] || '请输入',
      success: (res) => {
        if (res.confirm && res.content != null) {
          this.setData({ [`form.${key}`]: res.content.trim() });
        }
      }
    });
  },

  editPrice() {
    wx.showModal({
      title: '修改票价（元）',
      editable: true,
      content: this.data.form.price || '',
      placeholderText: this.data.form.price || '请输入数字',
      success: (res) => {
        if (!res.confirm) return;
        // 4.22.5（BUG审查⑤）：先 trim——空格串 Number(' ')=0 会被误判为有效数字存成「0」
        const trimmed = String(res.content || '').trim();
        const n = Number(trimmed);
        this.setData({ 'form.price': trimmed && !isNaN(n) ? String(n) : '' });
      }
    });
  },

  editType() {
    // M4.5：原生 ActionSheet → 品牌 bottom-sheet（三选一 + 当前项高亮）
    this.setData({ typeSheet: true });
  },

  closeTypeSheet() {
    this.setData({ typeSheet: false });
  },

  pickType(e) {
    const key = e.currentTarget.dataset.key;
    if (!TYPE_KEYS.includes(key)) return;
    this.setData({ 'form.type': key, typeText: TYPE_TEXT[key], typeSheet: false });
    haptics.tap();
  },

  // —— 第三步：保存入库 ——
  async save() {
    const f = this.data.form;
    if (!f.title.trim()) return wx.showToast({ title: '票名还没有填', icon: 'none' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) {
      return wx.showToast({ title: '日期格式应为 2025-10-26', icon: 'none' });
    }
    if (this.data.saving) return;
    this.setData({ saving: true });
    wx.showLoading({ title: '正在收进票根墙…', mask: true });
    try {
      await store.addTicket({ ...f, price: Number(f.price) || null }, this.data.imgFileID);
      // 4.17.0 first_save：只记第一次（本地标记口径，换设备会重置——增长大盘足够用）
      try {
        if (!wx.getStorageSync('sp_first_saved')) {
          wx.setStorageSync('sp_first_saved', Date.now());
          track.track('first_save', { type: f.type || '' });
        }
      } catch (e) { /* 埋点失败不阻塞 */ }
      // 7.3.0 R6：收下第一张票根 → 催一次邀请奖励结算（谁点进来的、发不发奖全在服务端判；
      // 这里只是触发器，失败静默 —— 下次启动 invite.boot 还会补一次）
      invite.settle();
      wx.hideLoading();
      haptics.confirm(); // M4.5：落章瞬间（关键操作）
      // v6.6.0 动效4：对勾圆环描边+粒子（Canvas 2D，400ms）→ 200ms 驻留 → 浮层上移淡出 200ms → 返回
      // A2：同期叠「撕票」（存根留在原地、副券撕下飞进册子，见 scan.wxss 的 .tear-*），时间轴不改
      this.setData({ stamped: true, liftOff: false });
      this._playCheckIn();
      this._later(() => this.setData({ liftOff: true }), 600); // 400ms 绘制 + 200ms 驻留
      // lift-off 200ms 完成后回去（上一页的 onShow 会自动刷新）。
      // 8.1.0：必须有 fail 兜底 —— 立牌上的码直接把用户送进本页（云函数 wxacode 的
      //   kind='sign' 把 page 写死成 pages/scan/scan），这时页面栈里**只有本页**，
      //   navigateBack 必定失败。原来那样写不报错、不弹窗，用户就卡在刚存完的动画上。
      //   退不回去就落收藏册：刚收下的那一张就在那儿，比落首页更接得住他。
      this._later(() => wx.navigateBack({
        delta: 1,
        fail: () => wx.switchTab({ url: '/pages/album/album' })
      }), 900);
    } catch (e) {
      wx.hideLoading();
      // v6.6.0 动效4：失败不播成功动画——保存按钮红色抖动一次（保留原弹窗说明原因）
      this.setData({ saveErr: true });
      this._later(() => this.setData({ saveErr: false }), 380);
      haptics.warn();
      // 8.0.4：微信云 API 失败时抛的是只有 errMsg 的普通对象，`e.message || e` 会把它
      // String() 成「[object Object]」摆给用户看（card / annual 早就用 errMsg 优先的写法了）。
      // 后半句是必须的：表单数据还在，不告诉用户这一点，他不敢再点一次。
      wx.showModal({
        title: '保存失败',
        content: String((e && e.errMsg) || e.message || e || '未知错误') + '\n票面信息还在，连上网再点一次即可。',
        showCancel: false
      });
    } finally {
      this.setData({ saving: false });
    }
  },

  /**
   * v6.6.0 动效4：入档成功 Canvas 2D 绘制（总 400ms，同一条 raf 时间轴）
   *  · 0–55%：圆环 stroke-dashoffset 从整周长画到满（玫粉 #D9A0A6）
   *  · 45%–100%：对勾一笔画出（dashoffset 揭示），与圆环收尾自然衔接
   *  · 全程：8 枚粒子从圆环边缘向外散出（半径 0→26px、alpha 1→0），
   *    玫粉×3 / 鹅黄×3 / 鼠尾草×2，角度均布+随机抖动
   * reduced-motion：跳过动画直接画终帧（圆环+对勾），粒子不播
   */
  _playCheckIn() {
    this.createSelectorQuery()
      .select('#checkCv')
      .fields({ node: true, size: true })
      .exec((res) => {
        const hit = res && res[0];
        if (!hit || !hit.node) return; // canvas 未就绪：浮层仍显示文字，不阻塞返回
        const cv = hit.node;
        const ctx = cv.getContext('2d');
        const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
        const w = hit.width, h = hit.height;
        cv.width = w * dpr; cv.height = h * dpr;
        ctx.scale(dpr, dpr);

        const cx = w / 2, cy = h / 2;
        const R = Math.min(w, h) * 0.32;          // 圆环半径
        const circ = 2 * Math.PI * R;
        const T = 400;                             // 需求口径：总 400ms
        const ROSE = '#D9A0A6', BUTTER = '#F6DFA8', SAGE = '#A9C3A6';
        // 8 枚粒子：玫粉×3 / 鹅黄×3 / 鼠尾草×2，角度均布 + 随机抖动
        const cols = [ROSE, ROSE, ROSE, BUTTER, BUTTER, BUTTER, SAGE, SAGE];
        const parts = cols.map((c, i) => ({
          c,
          a: (Math.PI * 2 * i) / cols.length + (Math.random() - 0.5) * 0.6,
          sz: 2.2 + Math.random() * 1.6
        }));
        // 对勾路径（以圆心为基准的相对坐标，一笔:起笔在左中，折向底部中心，再扬到右上）
        const check = [
          { x: cx - R * 0.46, y: cy + R * 0.02 },
          { x: cx - R * 0.10, y: cy + R * 0.38 },
          { x: cx + R * 0.52, y: cy - R * 0.34 }
        ];

        const drawFinal = () => {
          this._strokeRing(ctx, cx, cy, R, circ, 1);
          this._strokeCheck(ctx, check, 1);
        };

        if (this._reduceMotion) { drawFinal(); return; } // reduced-motion：只画终帧

        let t0 = null;
        const frame = (ts) => {
          if (t0 === null) t0 = ts;
          const p = Math.min(1, (ts - t0) / T);
          ctx.clearRect(0, 0, w, h);

          // 圆环：0–55% 行程画完
          this._strokeRing(ctx, cx, cy, R, circ, Math.min(1, p / 0.55));
          // 对勾：45%–100% 一笔揭示
          this._strokeCheck(ctx, check, Math.max(0, (p - 0.45) / 0.55));
          // 粒子：全程散出（r 0→26px、alpha 1→0），p>=1 自然消失
          if (p < 1) {
            for (const pt of parts) {
              const rr = R + 26 * p;               // 从圆环边缘向外散 26px
              const px = cx + Math.cos(pt.a) * rr;
              const py = cy + Math.sin(pt.a) * rr;
              ctx.globalAlpha = 1 - p;
              ctx.fillStyle = pt.c;
              ctx.beginPath();
              ctx.arc(px, py, pt.sz * (1 - p * 0.4), 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.globalAlpha = 1;
          }
          if (p < 1) cv.requestAnimationFrame(frame);
        };
        cv.requestAnimationFrame(frame);
      });
  },

  /** 圆环描边：k∈[0,1] → stroke-dashoffset 等价的 dash 长度插值 */
  _strokeRing(ctx, cx, cy, R, circ, k) {
    if (k <= 0) return;
    ctx.save();
    ctx.strokeStyle = '#D9A0A6';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
    ctx.stroke();
    ctx.restore();
  },

  /** 对勾一笔：k∈[0,1] → 按 dashoffset 揭示路径 */
  _strokeCheck(ctx, pts, k) {
    if (k <= 0) return;
    const [a, b, c] = pts;
    const seg1 = Math.hypot(b.x - a.x, b.y - a.y);
    const seg2 = Math.hypot(c.x - b.x, c.y - b.y);
    const total = seg1 + seg2;
    const drawn = total * k;
    ctx.save();
    ctx.strokeStyle = '#D9A0A6';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    if (drawn <= seg1) {
      const t = drawn / seg1;
      ctx.lineTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    } else {
      ctx.lineTo(b.x, b.y);
      const t = (drawn - seg1) / seg2;
      ctx.lineTo(b.x + (c.x - b.x) * t, b.y + (c.y - b.y) * t);
    }
    ctx.stroke();
    ctx.restore();
  },

  retake() {
    // 6.4.0：回到品牌稿取景态（相机重新取景）
    this._scanSeq = (this._scanSeq || 0) + 1; // 重拍 = 上一次识别作废
    this._clearTimers();
    this.setData({ mode: 'camera', imgPath: '', imgFileID: '', statusText: '', step: 0 });
  },

  preview() {
    if (this.data.imgPath) wx.previewImage({ urls: [this.data.imgPath] });
  }
});
