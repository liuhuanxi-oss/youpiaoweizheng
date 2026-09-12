// pages/duo/duo.js —— 双人回忆绑定（品牌全案 · 稿屏10）
// ============================================================
// 未绑定：撕边纸片 hero（双头像 + 爱心 + 两枚按钮）→ 「我们的共同票根」→ 6 张齿边票根卡
// 已绑定：同一套版式换真数据 —— hero 写昵称与同行天数，卡片挂「共同场次 / 共同城市」胶囊
//
// 【未绑定态为什么也有票根卡】
//   稿里就是一张长页：上半张是邀请，下半张是「我们的共同票根」。未绑定时那 6 张铺的是
//   **你自己的**票根、一律不挂胶囊，分区标题下写明「绑定后会换成你们共同的那几张」——
//   与其中一句空口承诺，不如先把册子摆出来给人看。
//
// 【两个胶囊的口径】
//   共同场次 = 双方在同一场演出各留了一张票根（duoData.togetherKeys）
//   共同城市 = 双方在同一座城市留过票根，不要求同一场（duoData.togetherCities）
//   都命中的优先挂「共同场次」——同场是更强的连接；都没有就不挂胶囊（稿里也有两张空着）。
// ============================================================
const store = require('../../utils/store.js');
const couple = require('../../utils/couple.js');
const duoData = require('../../utils/duoData.js');
const themeUtil = require('../../utils/theme.js');
const sk = require('../../utils/skeleton.js');
const track = require('../../utils/track.js'); // 4.17.0：拉新埋点
const deco = require('../../utils/deco.js');   // 图形：齿边纸片 / 雏菊 / 邮戳 / 星点
const { iconSrc } = require('../../utils/icons.js');

// —— 尺寸（rpx）：WXSS 里写死的宽高必须与这里一致 ——
// 齿边是贴着纸边跑一圈的，盒子与 viewBox 差一点齿就偏出边框（同 deco.artFrame 的约定）
const HERO_W = 670, HERO_H = 530;   // 邀请卡
const CARD_W = 322, CARD_H = 218;   // 一张票根卡（(750 - 40×2 - 26) / 2 的列宽）
const GRID_N = 6;                   // 稿屏10 是 2 列 3 行

/** 类型 → 无照片时的兜底图标名（与时光机页同一套；中文类型名这一页不出，卡面只放图标） */
const TYPE_ICONS = { show: 'mask', movie: 'film', traffic: 'train' };

/** 绑定时间 → 同行天数（当天算第 1 天） */
function daysTogether(boundAt) {
  if (!boundAt) return 1;
  return Math.max(1, Math.floor((Date.now() - boundAt) / 86400000) + 1);
}

/** 2025-06-21 → 2025.06.21（稿里票根卡上的日期写法） */
function dotDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? `${m[1]}.${m[2]}.${m[3]}` : String(d || '');
}

/** 「城市 · 场馆」——缺哪个少哪个，都没有就留空（卡面那一行整个不渲染） */
function placeText(t) {
  return [t.city, t.venue].filter(Boolean).join(' · ');
}

Page({
  data: {
    theme: 'a',
    skeleton: false,   // 加载超 300ms 才显示骨架
    bound: false,
    // —— 下拉弹性 ——
    refreshing: false,
    refreshText: '下拉翻册',
    // —— 未绑定 ——
    myCode: '',
    codeBusy: false,
    sheet: false,      // 邀请码面板
    // —— 已绑定 ——
    duo: null,         // { myName, partnerName, meChar, partnerChar, days }
    stat: null,        // { together, shared, total }
    rows: [],          // 票根卡（最多 6 张）
    ic: {}, art: {}
  },

  onShow() {
    themeUtil.apply(this);
    this.buildArt();
    this.refresh();
  },

  // ===== 下拉弹性（重新拉绑定态 + 卡面） =====
  onRefresh() {
    this.setData({ refreshing: true, refreshText: '正在翻册…' });
    this.refresh()
      .then(() => this.setData({ refreshing: false, refreshText: '已更新' }))
      .catch(() => this.setData({ refreshing: false, refreshText: '刷新失败，再试一次' }));
  },

  onPulling(e) {
    const dy = (e && e.detail && e.detail.dy) || 0;
    const next = dy >= 60 ? '松手翻册' : '下拉翻册';
    if (next !== this.data.refreshText) this.setData({ refreshText: next });
  },

  onRestore() {
    this.setData({ refreshText: '下拉翻册' });
  },

  async refresh() {
    sk.start(this);
    try {
      const c = await couple.queryCouple();
      if (c && c.boundAt) await this.renderBound(c);
      else await this.renderFree();
    } catch (e) {
      wx.showToast({ title: String(e.message || e).slice(0, 40), icon: 'none' });
    } finally {
      sk.end(this);
    }
  },

  /** 未绑定：铺自己的票根当示意（不挂胶囊），顺带把邀请码备好 */
  async renderFree() {
    this.setData({ bound: false, duo: null, stat: null, rows: [] });
    try {
      const raw = await store.listTickets();
      this.setData({ rows: this._rowCards((raw || []).filter((t) => t && t.title && t.date)) });
    } catch (e) {
      this.setData({ rows: [] });
    }
    if (this.data.myCode) return;
    try {
      const r = await couple.createCode('');   // 幂等：已有码则复用
      if (r && r.code) this.setData({ myCode: r.code });
    } catch (e) { /* 码生成失败不阻塞浏览 */ }
  },

  /** 已绑定：合并数据 → 挂胶囊的票根卡 */
  async renderBound(c) {
    const duo = {
      myName: c.myName || '我',
      partnerName: c.partnerName || 'TA',
      days: daysTogether(c.boundAt)
    };
    this.setData({ bound: true, duo });

    const merged = await duoData.loadMerged(c);
    const showKeys = duoData.togetherKeys(merged.items);
    const citySet = duoData.togetherCities(merged.items);
    const rank = (t) => (showKeys.has(duoData.eventKeyOf(t)) ? 2 : (citySet.has(t.city) ? 1 : 0));
    // 有共同关系的排前面：稿里那 6 张也是「挂胶囊的夹着没胶囊的」
    const items = (merged.items || []).slice().sort((a, b) => rank(b) - rank(a));
    const recent = (merged.items || [])[0];
    this.setData({
      stat: {
        together: (merged.items || []).filter((t) => showKeys.has(duoData.eventKeyOf(t))).length,
        shared: citySet.size,
        total: merged.total,
        // 生成双人卡片时要带一张共同票根的 id —— 不带 id 的 card 页会退回"最近一张票"，
        // 结果生成出来的是自己一个人的卡片（4.22.5 BUG审查② 修过一次，别再倒退）
        recentId: recent ? recent.id : ''
      },
      rows: this._rowCards(items, { show: showKeys, city: citySet })
    });
  },

  /**
   * 铺票根卡：最多 6 张，有照片的先上（卡面主视觉就是那张照片）。
   * ⚠️ 卡面图形（齿边底 / 邮戳 / 爱心）留在 art 里由 WXML 引用 —— 每张卡各塞一份
   * data-uri 会让 setData 的包体膨胀好几倍（一张齿边底就好几 KB）。
   * @param {Array} items 票根行
   * @param {Object} [marks] { show:Set, city:Set } 共同关系；未绑定不传 → 一律不挂胶囊
   */
  _rowCards(items, marks) {
    return (items || [])
      .slice()
      .sort((a, b) =>
        ((b.img ? 1 : 0) - (a.img ? 1 : 0)) ||
        String(b.date || '').localeCompare(String(a.date || ''))
      )
      .slice(0, GRID_N)
      .map((t) => {
        let tag = null;
        if (marks && marks.show.has(duoData.eventKeyOf(t))) tag = { kind: 'show', text: '共同场次' };
        else if (marks && marks.city.has(t.city)) tag = { kind: 'city', text: '共同城市' };
        return {
          id: t.id,
          img: t.img || '',
          title: t.title,
          dateText: dotDate(t.date),
          placeText: placeText(t),
          // 没照片的卡用类型图标顶替（数据-uri 很小，逐卡带上比在 WXML 里套三元干净）
          ico: iconSrc(TYPE_ICONS[t.type] || 'ticket', this._ink || '#6B5B50', 0.42, 1.5),
          tag
        };
      });
  },

  /** 主题切换 / 换页回来都要重编一遍图形（data-uri 里的颜色是编译时写死的） */
  buildArt() {
    const m = themeUtil.getThemeMeta(themeUtil.getTheme());
    const pm = deco.postmarkParts(m);
    const white = '#FFF8F2';   // 压在玫瑰/鼠尾草实底上的白
    this._ink = m.text;        // 票根卡的类型兜底图标要用（_rowCards 里编译）
    this.setData({
      ic: {
        // hero 两个头像：白色人形剪影压在实底圆上
        avatar: iconSrc('user', white, 0, 1.7, true),
        // 胶囊里的白图标（共同场次 / 共同城市）
        tagShow: iconSrc('users', white, 0, 1.5),
        tagCity: iconSrc('pin', white, 0, 1.5),
        // 日期 / 地点两行的小图标
        calendar: iconSrc('calendar', m.text, 0.5, 1.5),
        pin: iconSrc('pin', m.text, 0.5, 1.5),
        // 未绑定且一张票根都没有时的空态
        emptyIc: iconSrc('ticket', m.text, 0.28, 1.4)
      },
      art: {
        // 两张齿边纸片：尺寸由 JS 传给图形，与 WXSS 的盒子严丝合缝
        hero: deco.pinkedPanel(HERO_W, HERO_H, { fill: '#FFFDF8', ink: '#C9A469', tooth: 22, amp: 5, inset: 5, strokeAlpha: 0.3 }),
        card: deco.pinkedPanel(CARD_W, CARD_H, { fill: '#FFFDF8', ink: '#C9A469', tooth: 16, amp: 4, inset: 4, strokeAlpha: 0.3 }),
        // 白色小雏菊：hero 左上 / 左下两枝，页脚一枝
        daisy: deco.decoSrc('daisy', Object.assign({}, m, { paper: '#FFFDF8', leaf: '#A9C3A6', core: '#F6DFA8' })),
        star: deco.decoSrc('star4', Object.assign({}, m, { accent: '#E2B85C' })),
        heart: deco.decoSrc('heartsmall', Object.assign({}, m, { accent: '#E8AFA8' })),
        // 邮戳：圈与注销线是图形，文字（PARIS 那四行）在稿里是装饰，这里只留圈与线
        pmRing: pm.ring,
        pmWave: pm.wave
      }
    });
  },

  // ---------- 未绑定：绑定入口 ----------
  /** 「发起绑定」：出示我的邀请码 / 输入 TA 的邀请码 */
  startBind() {
    wx.showActionSheet({
      itemList: ['出示我的邀请码', '输入 TA 的邀请码'],
      success: (r) => {
        if (r.tapIndex === 0) this.showCode();
        else this.joinCode();
      },
      fail: () => { /* 用户取消，不处理 */ }
    });
  },

  /** 出示我的邀请码（面板里可复制、可转发） */
  async showCode() {
    track.track('duo_code_open', { has: this.data.myCode ? 1 : 0 });
    if (this.data.myCode) { this.setData({ sheet: true }); return; }
    this.setData({ codeBusy: true });
    try {
      const r = await couple.createCode('');
      this.setData({ myCode: (r && r.code) || '', sheet: true });
    } catch (e) {
      wx.showToast({ title: String(e.message || e).slice(0, 40), icon: 'none' });
    } finally {
      this.setData({ codeBusy: false });
    }
  },

  closeSheet() {
    this.setData({ sheet: false });
  },

  copyCode() {
    if (!this.data.myCode) return;
    wx.setClipboardData({
      data: this.data.myCode,
      success: () => wx.showToast({ title: '已复制，发给 TA 吧', icon: 'none' })
    });
  },

  /** 输入 TA 的邀请码完成绑定 */
  joinCode() {
    wx.showModal({
      title: '输入 TA 的邀请码',
      editable: true,
      placeholderText: '4 位字符，如：K7MP',
      success: async (r) => {
        if (!r.confirm) return;
        const code = String(r.content || '').trim();
        if (!code) return;
        this.setData({ codeBusy: true });
        wx.showLoading({ title: '正在绑定…', mask: true });
        try {
          const c = await couple.joinByCode(code, '');
          wx.hideLoading();
          wx.vibrateShort({ type: 'medium' });   // 关键操作（绑定成功）的明确反馈
          // 4.17.0 invite_bind：被邀请方落地成功（增长口径：K 因子的转化环节）
          track.track('invite_bind', { via: 'code' });
          wx.showToast({ title: `已和 ${c.couple.partnerName} 绑定`, icon: 'success' });
          this.refresh();
        } catch (e) {
          wx.hideLoading();
          wx.showModal({ title: '绑定失败', content: String(e.message || e).slice(0, 80), showCancel: false });
        } finally {
          this.setData({ codeBusy: false });
        }
      }
    });
  },

  /** 点卡片进票根详情 */
  goDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` });
  },

  /** 空态直达录入（与时间线 / 墙的空态同构） */
  goScan() {
    wx.navigateTo({ url: '/pages/scan/scan' });
  },

  // ---------- 已绑定 ----------
  /** 生成双人纪念卡片：带最近一张共同票根的 id；一张都没有就去看完整时间线 */
  goCard() {
    const id = this.data.stat && this.data.stat.recentId;
    wx.vibrateShort({ type: 'light' });
    if (id) { wx.navigateTo({ url: `/pages/card/card?id=${id}` }); return; }
    wx.navigateTo({ url: '/pages/timeline/timeline' });
  },

  goReport() {
    wx.vibrateShort({ type: 'light' });
    wx.navigateTo({ url: '/pages/report/report' });
  },

  unbindTap() {
    wx.showModal({
      title: '解除绑定',
      content: '解绑后双人空间会清空，双方回到各自收藏册。确定解除吗？',
      confirmText: '解除',
      confirmColor: '#E0532F',
      success: async (r) => {
        if (!r.confirm) return;
        wx.vibrateShort({ type: 'heavy' });   // 删除类操作的明确反馈
        try {
          await couple.unbind();
          wx.showToast({ title: '已解绑', icon: 'none' });
          this.refresh();
        } catch (e) {
          wx.showToast({ title: String(e.message || e).slice(0, 40), icon: 'none' });
        }
      }
    });
  },

  /** 了解双人回忆空间是什么 */
  about() {
    wx.showModal({
      title: '双人回忆空间',
      content: '和最重要的人绑定后，你们的票根会汇入同一本册子：同一天的同一场会标成「共同场次」，同一座城市标成「共同城市」。',
      showCancel: false,
      confirmText: '期待'
    });
  },

  // ---------- 转发 ----------
  onShareAppMessage() {
    const code = this.data.myCode;
    // 4.17.0 M2 时光同谋：发起过邀请就点亮勋章资格 + 埋点
    try { wx.setStorageSync('sp_invite_sent', Date.now()); } catch (e) { /* 忽略 */ }
    track.track('share_click', { from: 'duo' });
    // v5.1 L2：标题用「我们」钩子 + 结果前置，比功能描述更能唤起绑定（分享卡片直达绑定位）
    return {
      title: '我把咱俩看过的时光收成了收藏册，给你留了位置，来一起翻',
      path: code ? `/pages/bind/bind?code=${code}` : '/pages/duo/duo',
      imageUrl: '/images/brand-logo.png'
    };
  }
});
