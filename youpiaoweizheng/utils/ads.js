// utils/ads.js —— 4.21.0 流量主变现基建（激励视频 + 广告位配置）
// ============================================================
// 铁律（4.21.0 UI 审查结论落地）：
//   ① 广告位 ID 未配置（空字符串）时，相关 UI 由页面 wx:if 守卫全部隐藏——
//      流量主开通前零视觉入侵，开通后到 MP 后台建广告位、回填 ID 即生效；
//   ② 激励视频 promise 化封装：不 throw、一律 resolve {ok, ended|reason}，
//      调用方（art 付费墙）单一处理路径；
//   ③ 主题适配：微信 ad 组件样式由平台下发不可改，theme-b 深色主题下
//      广告自带白底——所有广告位必须用「纸卡容器」包边（.ad-wrap / .card），
//      把平台白底框成「装裱画框」而不是裸贴补丁。
// 广告位申请路径：MP 后台 → 流量主 → 广告位管理 → 新建 → 回填下方常量。
// ============================================================

/** 激励视频广告位（art 付费墙「看视频免费补 1 幅」） */
const REWARDED_ID = '';
/** detail 页底部 Banner 广告位 */
const BANNER_DETAIL_ID = '';

function hasRewarded() { return !!REWARDED_ID; }
function hasBanner() { return !!BANNER_DETAIL_ID; }

// —— 激励视频：进程内单例（RewardedVideoAd 官方即单例语义，重复 create 会互相顶掉） ——
let _rewarded = null;

function _getRewarded() {
  if (!REWARDED_ID) return null;
  if (!wx.createRewardedVideoAd) return null; // 低版本基础库
  if (!_rewarded) {
    _rewarded = wx.createRewardedVideoAd({ adUnitId: REWARDED_ID });
    // 全局错误静默：广告加载失败不能惊扰用户（调用方 show 失败路径有降级提示）
    try { _rewarded.onError(() => {}); } catch (e) { /* 忽略 */ }
  }
  return _rewarded;
}

/**
 * 拉起激励视频。
 * @returns {Promise<{ok:boolean, ended?:boolean, reason?:string}>}
 *   ok=true 且 ended=true → 完整看完，可发奖；ended=false → 中途关闭，不发奖；
 *   ok=false → 未配置/环境不支持/拉起失败，调用方按「无广告」降级。
 */
function showRewarded() {
  if (!REWARDED_ID) return Promise.resolve({ ok: false, reason: 'not-configured' });
  const ad = _getRewarded();
  if (!ad) return Promise.resolve({ ok: false, reason: 'unsupported' });
  return new Promise((resolve) => {
    let settled = false;
    const onClose = (res) => {
      if (settled) return;
      settled = true;
      try { ad.offClose(onClose); } catch (e) { /* 忽略 */ }
      resolve({ ok: true, ended: !!(res && res.isEnded) });
    };
    try { ad.onClose(onClose); } catch (e) {
      if (!settled) { settled = true; resolve({ ok: false, reason: 'unsupported' }); }
      return;
    }
    const fail = () => {
      if (settled) return;
      settled = true;
      try { ad.offClose(onClose); } catch (e) { /* 忽略 */ }
      resolve({ ok: false, reason: 'show-failed' });
    };
    ad.show().catch(() => {
      // 首次 show 失败（未加载）→ load 后重试一次，仍失败才降级
      ad.load().then(() => ad.show()).catch(fail);
    });
  });
}

module.exports = {
  REWARDED_ID, BANNER_DETAIL_ID,
  hasRewarded, hasBanner, showRewarded
};
