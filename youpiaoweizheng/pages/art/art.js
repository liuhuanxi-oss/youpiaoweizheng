// pages/art/art.js —— 4.19.0 票根博物志：把票根照片重绘成 vintage 藏品图版
// 链路：详情页 FAB「图版」→ 本页 → 云函数 artRestyle（建 job 后同步生图，前端必超时）→
//       4s 轮询 artQuery → done 拿 fileID →「图归图、字归 Canvas」：
//       AI 图负责画面，藏品签（演出名·日期 + Plate No.）由前端 Canvas 精确叠加，
//       避免生图模型画中文乱码。
// 额度：4.20.0 起云端权威记账（prefs type=art_quota，免费优先扣、付费兜底），
//   本地 sp_art_quota 仅作演示模式与离线兜底显示；次数包走虚拟支付（utils/pay.js）。
//   藏品编号 sp_art_total 仍为前端本地累加（仅藏品签展示用，跳号不回收）。
// 架构红线：不新建云函数——全部走 saveTicket 的 action 路由。
const store = require('../../utils/store.js');
const themeUtil = require('../../utils/theme.js');
const track = require('../../utils/track.js'); // 4.19.0：图版埋点（art_generate/art_save）
const { USE_CLOUD } = require('../../utils/env.js');
const pay = require('../../utils/pay.js'); // 4.20.0：额度查询 + 次数包购买
const ads = require('../../utils/ads.js'); // 4.21.0：激励视频（流量主变现：看视频免费补 1 幅）

const LS_QUOTA = 'sp_art_quota'; // { ym: 'YYYY-MM', used: n }
const LS_TOTAL = 'sp_art_total'; // 藏品编号（全局第几幅，跳号不回收）
const FREE_PER_MONTH = 3;
const POLL_MS = 4000;            // 轮询间隔
const POLL_MAX = 40;             // 40 × 4s ≈ 160s 上限（生图 10-60s，余量充足）

function ymNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

Page({
  data: {
    theme: 'a', legacyTheme: 'a',
    phase: 'loading', // loading | lost | empty | idle | running | done | failed
    t: null,
    quotaLeft: FREE_PER_MONTH,
    quotaPaid: 0,                 // 次数包剩余（云模式服务端下发；演示模式恒 0）
    quotaLabel: `本月免费额度 · 剩 ${FREE_PER_MONTH}/${FREE_PER_MONTH} 幅`,
    quotaPips: [],                // 4.21.0 免费额度印章格可视化（3 格，used=已用）
    // —— 4.21.0 品牌化付费墙（替代 wx.showModal）——
    paywall: false,
    rewardReady: false,           // 激励视频广告位已配置（未配置流量主时按钮整块隐藏）
    rewardLeft: 0,                // 今天还能看视频补几次（服务端日限额预检）
    payPackLabel: pay.PACK_PRICE_LABEL,
    freePerMonth: FREE_PER_MONTH,
    plateNo: 0,
    msg: '',
    imgUrl: '',       // 生成图临时 URL（展示 + Canvas 合成共用，24h 有效）
    saving: false,
    waiting: false    // artRestyle 已发出（防重复点击）
  },

  onShow() { themeUtil.apply(this); },

  async onLoad(options) {
    const id = (options && options.id) || '';
    let t = null;
    try { t = await store.getTicket(id); } catch (e) { /* 走 lost */ }
    if (!t) { this.setData({ phase: 'lost' }); return; }
    this.setData({ t: { ...t, isDemo: store.isMockTicket(t.id) } });
    this._refreshQuota();
    if (!t.img) { this.setData({ phase: 'empty' }); return; }

    // 恢复场景 A：票根已挂图版 → 直接展示
    const av = t.artVersion;
    if (av && av.fileID) {
      const url = await this._toTempUrl(av.fileID);
      if (url) {
        this.setData({ phase: 'done', imgUrl: url, plateNo: this._plateNo(false) });
        return;
      }
    }
    // 恢复场景 B：有未完成的 job（异常退出后回来）→ 续轮询
    this.setData({ phase: 'idle' });
    try {
      const r = await this._call('artQuery', { ticketId: t.id });
      if (r && r.ok && r.status === 'running') {
        this.setData({ phase: 'running' });
        this._poll(t.id);
      } else if (r && r.ok && r.status === 'done' && r.fileID) {
        this._showDone(r.fileID);
      }
    } catch (e) { /* 查询失败停在 idle，用户可手动开始 */ }
  },

  onUnload() { this._stopPoll(); },

  // ===== 基础设施 =====

  _call(action, data) {
    return wx.cloud.callFunction({
      name: 'saveTicket',
      data: { action, ...data }
    }).then((res) => (res && res.result) || {})
      .catch((e) => ({ ok: false, msg: String((e && e.message) || e) }));
  },

  /** cloud:// → https 临时链接（image 展示与 canvas createImage 都需要） */
  _toTempUrl(fileID) {
    if (!fileID) return Promise.resolve('');
    if (/^https?:/.test(fileID)) return Promise.resolve(fileID);
    return wx.cloud.getTempFileURL({ fileList: [fileID] }).then((res) => {
      const f = res && res.fileList && res.fileList[0];
      return (f && f.tempFileURL) || '';
    }).catch(() => '');
  },

  /** 统一额度视图落位：pips（免费 3 格印章）+ 总剩余 + 文案（本地/云两口径共用） */
  _setQuotaView(freeLeft, paid, label) {
    const pips = [];
    for (let i = 0; i < FREE_PER_MONTH; i++) pips.push({ used: i >= freeLeft });
    this.setData({
      quotaLeft: freeLeft + (paid || 0),
      quotaPaid: paid || 0,
      quotaLabel: label,
      quotaPips: pips
    });
  },

  _refreshQuota() {
    // 本地先显示（演示模式/离线兜底），云端就绪后覆盖为服务端权威值
    try {
      const q = wx.getStorageSync(LS_QUOTA) || {};
      const used = q.ym === ymNow() ? (q.used || 0) : 0;
      const freeLeft = Math.max(FREE_PER_MONTH - used, 0);
      this._setQuotaView(freeLeft, 0, `本月免费额度 · 剩 ${freeLeft}/${FREE_PER_MONTH} 幅`);
    } catch (e) { /* 保持 data 默认值 */ }
    if (!USE_CLOUD) return;
    pay.getQuota().then((quota) => { if (quota) this._applyQuota(quota); });
  },

  /** 服务端额度视图 → 页面显示（云模式唯一记账口径） */
  _applyQuota(quota) {
    if (!quota || typeof quota.left !== 'number') return;
    const freeLeft = typeof quota.freeLeft === 'number' ? quota.freeLeft : quota.left;
    this._setQuotaView(freeLeft, quota.paid || 0, pay.quotaLabel(quota, FREE_PER_MONTH));
  },

  /** 云模式下用最新服务端额度刷新显示（失败静默，不影响主流程） */
  _syncQuota() {
    if (!USE_CLOUD) return;
    pay.getQuota().then((quota) => { if (quota) this._applyQuota(quota); });
  },

  /** 藏品编号：take=true 全局累加并占号；否则读当前号 */
  _plateNo(take) {
    try {
      let n = wx.getStorageSync(LS_TOTAL) || 0;
      if (take) { n += 1; wx.setStorageSync(LS_TOTAL, n); }
      return n;
    } catch (e) { return 0; }
  },

  _showDone(fileID) {
    return this._toTempUrl(fileID).then((url) => {
      if (url) {
        // 恢复场景（onLoad/轮询续上）本地编号可能是 0：读全局编号兜底；
        // 4.22.5（BUG审查④）：全局也未累加（storage 异常/首次中断）时 clamp≥1，杜绝「Plate No.00」
        const no = Math.max(1, this.data.plateNo || this._plateNo(false));
        this.setData({ phase: 'done', imgUrl: url, plateNo: no });
        wx.vibrateShort({ type: 'medium' }); // 出画时刻（与收票/保存同级）
      } else {
        this.setData({ phase: 'failed', msg: '图版已生成但加载失败，重新进入页面看看，或再画一幅' });
      }
      return url;
    });
  },

  // ===== 作画流程 =====

  /** 生成入口：额度检查 → fire artRestyle → 轮询 artQuery */
  async start() {
    if (this.data.phase === 'running' || this.data.waiting || this.data.saving) return;
    const t = this.data.t;
    if (!t) return;
    if (!t.img) { this.setData({ phase: 'empty' }); return; }
    if (t.isDemo) {
      // 演示票不在云库（仅创建者可读写），生图 job 挂不上——引导收真票
      wx.showToast({ title: '演示票不能入馆，收藏你自己的票试试', icon: 'none' });
      return;
    }
    if (this.data.quotaLeft <= 0) { this._offerBuy(); return; }
    wx.vibrateShort({ type: 'medium' });
    this.setData({ phase: 'running', waiting: true, msg: '' });
    this._plate = this._plateNo(true);       // 预占藏品编号
    this.setData({ plateNo: this._plate });

    const r = await this._call('artRestyle', { ticketId: t.id });
    if (r && r.ok) {
      // 请求被接住（生图在云函数里继续跑，前端不等它）
      this.setData({ waiting: false });
      this._applyQuota(r.quota); // 4.20.0 服务端已扣减，返回权威额度视图
      // 4.19.0 art_generate：图版生成启动（口径：fire 成功，含复用 running job）
      track.track('art_generate', { tid: String(t.id || '').slice(-6), quotaLeft: this.data.quotaLeft });
      this._poll(t.id);
      return;
    }
    // 4.20.0 服务端判额度不足（免费尽 + 无次数包）：弹购买引导
    if (r && r.code === 'NO_QUOTA') {
      this.setData({ waiting: false, phase: 'idle' });
      this._applyQuota(r.quota);
      this._offerBuy();
      return;
    }
    // fire 失败：可能是前端 callFunction 超时（云函数仍在跑），查一次 job 再定
    const q = await this._call('artQuery', { ticketId: t.id });
    if (q && q.ok && q.status === 'running') {
      this.setData({ waiting: false });
      this._poll(t.id);
      return;
    }
    if (q && q.ok && q.status === 'done' && q.fileID) {
      this.setData({ waiting: false });
      this._showDone(q.fileID);
      return;
    }
    // 真失败：额度由服务端在失败路径自动返还（4.20.0），这里只同步显示
    this._syncQuota();
    this.setData({ phase: 'failed', waiting: false, msg: (r && r.msg) || '作画请求没有发出去，请稍后再试' });
  },

  // ===== 4.20.0 次数包购买（额度不足的出路） =====
  // 4.21.0 改造：云模式走品牌化付费墙（bottom-sheet，版画预览 + 次数包/激励视频双轨），
  //   替代原 wx.showModal 系统弹窗——变现关键时刻不再用系统默认 UI；
  //   演示模式无购买/广告链路，保留轻提示。

  /** 额度不足 → 打开品牌化付费墙（云模式），演示模式仅提示 */
  _offerBuy() {
    if (!USE_CLOUD) {
      wx.showModal({
        title: '图版次数用完啦',
        content: `每个自然月有 ${FREE_PER_MONTH} 幅免费图版，下个月 1 日恢复。已画好的作品会一直留在票根上。`,
        showCancel: false,
        confirmText: '知道啦'
      });
      return;
    }
    this.setData({ paywall: true });
    this._checkReward();
  },

  closePaywall() { this.setData({ paywall: false }); },

  /** 付费墙打开时预检：今天还能看视频补几次（广告位未配置 → 视频按钮整块隐藏） */
  async _checkReward() {
    if (!ads.hasRewarded()) { this.setData({ rewardReady: false }); return; }
    const r = await this._call('artRewardGrant', { check: true });
    this.setData({
      rewardReady: true,
      rewardLeft: (r && r.ok && typeof r.left === 'number') ? r.left : 0
    });
  },

  /** 看激励视频 → 完整看完 → 云端入账 +1 幅（4.21.0 流量主变现主链路） */
  async watchForReward() {
    if (this._rewarding) return;
    this._rewarding = true;
    const r = await ads.showRewarded();
    this._rewarding = false;
    if (!r.ok) {
      wx.showToast({ title: '视频没能打开，稍后再试试', icon: 'none' });
      return;
    }
    if (!r.ended) {
      wx.showToast({ title: '看完整段视频才能补画哦', icon: 'none' });
      return;
    }
    await this._grantReward();
  },

  /** 服务端入账：paid +1（并入次数池，扣减顺序免费→付费不变） */
  async _grantReward() {
    wx.showLoading({ title: '补画入账中…', mask: true });
    const r = await this._call('artRewardGrant', {});
    wx.hideLoading();
    if (r && r.ok) {
      this._applyQuota(r.quota);
      if (typeof r.left === 'number') this.setData({ rewardLeft: r.left });
      wx.vibrateShort({ type: 'medium' });
      wx.showToast({ title: '+1 幅已到账', icon: 'success' });
      track.track('art_reward_grant', { left: this.data.quotaLeft });
      if (this.data.quotaLeft > 0) this.setData({ paywall: false, phase: 'idle', msg: '' });
    } else {
      if (r && r.code === 'LIMIT') this.setData({ rewardLeft: 0 });
      wx.showToast({ title: (r && r.msg) || '入账失败，请稍后再试', icon: 'none' });
    }
  },

  /** 付费墙内购买次数包：先收墙再走标准购买链路（成功后自动回 idle 可画） */
  async _buyFromWall() {
    this.setData({ paywall: false });
    await this._buy();
  },

  /** 拉起虚拟支付购买图版次数包（链路见 utils/pay.js） */
  async _buy() {
    if (this._buying) return;
    this._buying = true;
    wx.showLoading({ title: '正在拉起支付…', mask: true });
    const r = await pay.buyArtPack((s) => { wx.showLoading({ title: s, mask: true }); });
    wx.hideLoading();
    this._buying = false;
    if (r.ok) {
      this._applyQuota(r.quota);
      wx.vibrateShort({ type: 'medium' });
      wx.showToast({ title: '次数包已到账', icon: 'success' });
      this.setData({ phase: 'idle', msg: '' }); // 买完即可再画
      return;
    }
    if (r.cancelled) return; // 用户主动取消：静默不打扰
    if (r.pending) {
      // 钱已扣、推送未到：云函数幂等兜底最终会发货，不吓用户
      this._applyQuota(r.quota);
      wx.showModal({
        title: '到账稍有延迟',
        content: (r.msg || '支付成功，次数到账稍有延迟。') + '稍后重新打开本页会自动同步。',
        showCancel: false,
        confirmText: '知道啦'
      });
      return;
    }
    wx.showModal({
      title: '这次没有买成',
      content: r.msg || '支付未完成，请稍后再试',
      showCancel: false,
      confirmText: '知道啦'
    });
  },

  _stopPoll() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  },

  /** 首查立即、之后每 4s；上限 160s */
  _poll(ticketId) {
    this._stopPoll();
    let n = 0;
    const tick = async () => {
      n += 1;
      const r = await this._call('artQuery', { ticketId });
      if (r && r.ok && r.status === 'done' && r.fileID) {
        await this._showDone(r.fileID);
        return;
      }
      if (r && r.ok && r.status === 'failed') {
        this._syncQuota(); // 4.20.0：服务端已自动返还额度，前端只同步显示
        this.setData({ phase: 'failed', msg: r.msg || '这幅没画成，换个姿势再试一次吧' });
        return;
      }
      if (n >= POLL_MAX) {
        // 超时：job 大概率仍在跑（前端断开不影响云函数），引导稍后回来
        this.setData({ phase: 'failed', msg: '这次画得有点久，请稍后重新打开这个页面——画好后它会在这里等你' });
        return;
      }
      this._timer = setTimeout(tick, POLL_MS);
    };
    tick();
  },

  /** failed → 回到可开始状态（再点主按钮即重试，走完整额度检查） */

  /** done → 换一张：重新作画（同样扣额度，新图会替换票根上的图版） */
  again() { this.setData({ phase: 'idle', msg: '' }); },

  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.switchTab({ url: '/pages/album/album' }) // 无上级页面（极端落地场景）兜底（v6.1：wall 已并入 album）
    });
  },

  /** 4.19.3 empty 态出路：直达收票页（那里才有相册/摄像头入口）。
   *  redirectTo 替换当前页——补完票回来不落在旧的空态上 */
  goScan() {
    wx.redirectTo({ url: '/pages/scan/scan' });
  },

  /** done 图加载失败（临时链接过期等）：引导重画 */
  onArtError() {
    this.setData({ phase: 'failed', msg: '图版过期了（临时链接 24 小时有效），重新画一幅吧' });
  },

  // ===== Canvas 合成：图归图（AI 图 cover 铺满），字归 Canvas（藏品签精确叠加） =====

  /** 懒初始化 type=2d canvas：逻辑 1080×1440（3:4 竖版），dpr 缩放（同 card 页体系） */
  async _ensureCanvas() {
    if (this._ctx) return this._ctx;
    const node = await new Promise((resolve) => {
      this.createSelectorQuery()
        .select('#art-canvas')
        .fields({ node: true })
        .exec((res) => resolve(res && res[0] && res[0].node));
    });
    if (!node) throw new Error('canvas 不可用');
    const W = 1080, H = 1440;
    const dpr = Math.min((wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2, 3);
    node.width = W * dpr;
    node.height = H * dpr;
    const ctx = node.getContext('2d');
    ctx.scale(dpr, dpr);
    this._canvas = node;
    this._ctx = ctx;
    this._cw = W;
    this._ch = H;
    return ctx;
  },

  _loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = this._canvas.createImage();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  },

  /** 画整幅（4.22.3 修复导出裁切）：纸色底装裱 → AI 图 contain 完整呈现（不再 cover 裁切）→ 左下米白纸签 */
  async _compose() {
    const ctx = await this._ensureCanvas();
    const W = this._cw, H = this._ch;
    const img = await this._loadImg(this.data.imgUrl);
    const iw = img.width || W, ih = img.height || H;
    // 4.22.3：画布 3:4 竖版、AI 版画多为横版，原 cover（Math.max）会左右裁掉主票/副券；
    // 改 contain（Math.min）完整装裱：先铺纸色底，图完整居中略上移，藏品签落底部留白区
    ctx.fillStyle = '#F4EFE6';
    ctx.fillRect(0, 0, W, H);
    const s = Math.min(W / iw, H / ih);
    const dw = iw * s, dh = ih * s;
    const dx = (W - dw) / 2;
    const dy = Math.min(Math.max(48, (H - dh) / 2 - 90), H - dh); // 略上移给签留白；clamp 保证图完整不出界
    ctx.drawImage(img, dx, dy, dw, dh);

    // —— 藏品签：圆角米白纸签 + 墨棕三行（手写感 serif） ——
    const t = this.data.t || {};
    const title = String(t.title || '无题票根');
    const titleShort = title.length > 14 ? title.slice(0, 14) + '…' : title;
    const dateTxt = String(t.date || '').replace(/-/g, '.') || '—';
    const no = Math.max(1, this.data.plateNo || this._plateNo(false)); // 4.22.5（BUG审查④）：clamp≥1 防「Plate No.00」
    const lines = [
      { txt: titleShort, font: '600 46px serif' },
      { txt: dateTxt, font: '30px serif' },
      { txt: `Plate No.${String(no).padStart(2, '0')} · 有票为证藏`, font: '22px serif' }
    ];
    const pad = 34;
    let maxW = 0;
    lines.forEach((l) => { ctx.font = l.font; maxW = Math.max(maxW, ctx.measureText(l.txt).width); });
    const bw = Math.ceil(maxW) + pad * 2;
    const lh = 62;
    const bh = 40 + lh * lines.length + 24;
    const bx = 64, by = H - 64 - bh, r = 12;
    ctx.fillStyle = 'rgba(247, 240, 228, 0.9)';
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
    ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
    ctx.arcTo(bx, by + bh, bx, by, r);
    ctx.arcTo(bx, by, bx + bw, by, r);
    ctx.closePath();
    ctx.fill();

    let ty = by + 40 + 40; // 首行基线
    lines.forEach((l) => {
      ctx.font = l.font;
      ctx.fillStyle = '#5B4226';
      ctx.fillText(l.txt, bx + pad, ty);
      ty += lh;
    });

    // v5.0 S2：藏品图版右下角品牌水印（转发小红书/朋友圈自带品牌曝光；藏品签在左下，右下留白正合适）
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(139, 125, 107, 0.78)';
    ctx.fillText('@有票为证 · 你的时光档案馆', W - 48, H - 40);
  },

  /** 存入相册：合成 → 导出 → 授权保存（授权引导与埋点口径同 card 页） */
  async save() {
    if (this.data.saving || !this.data.imgUrl) return;
    this.setData({ saving: true });
    wx.showLoading({ title: '装帧中…', mask: true });
    try {
      await this._compose();
      const res = await wx.canvasToTempFilePath({ canvas: this._canvas });
      await new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({ filePath: res.tempFilePath, success: resolve, fail: reject });
      });
      wx.hideLoading();
      wx.vibrateShort({ type: 'medium' });
      // 4.19.0 art_save：图版装帧完成（口径：实际存入相册）
      track.track('art_save', { tid: String((this.data.t && this.data.t.id) || '').slice(-6) });
      wx.showToast({ title: '已存入相册', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      const msg = String((e && e.errMsg) || e.message || e);
      if (/auth/i.test(msg)) {
        wx.showModal({
          title: '需要相册权限',
          content: '保存图版需要「添加到相册」权限，请在设置中开启',
          confirmText: '去设置',
          success: (r) => { if (r.confirm) wx.openSetting(); }
        });
      } else if (!/cancel/i.test(msg)) {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      }
    } finally {
      this.setData({ saving: false });
    }
  },

  onShareAppMessage() {
    const t = this.data.t;
    return {
      title: t ? `我收藏的「${t.title}」有了自己的藏品图版` : '票根博物志 · 有票为证',
      path: t ? `/pages/detail/detail?id=${t.id}` : '/pages/album/album'
    };
  }
});
