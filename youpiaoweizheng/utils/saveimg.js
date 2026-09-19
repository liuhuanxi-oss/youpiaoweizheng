// utils/saveimg.js —— 画布出图 → 存进相册（含授权引导）
// ============================================================
// 【为什么有这一支】「保存失败」有四种，用户看到的却只有一种「保存失败，请重试」：
//   ① 用户没授权相册 —— 微信**不会再弹第二次**，必须引他去设置里开，光说「重试」他
//      会一直点、一直失败；
//   ② 用户自己取消了 —— 那不是错误，别弹任何东西；
//   ③ 画布还没画完就导出（真机上表现为存出一张空白）；
//   ④ 真失败。
//   唯一的「保存」入口原先只有记忆卡片页在用，逻辑长在 card.js 里；8.1.0 的回忆地图
//   长图是第二个入口，故把它拎出来 —— 两份「一样的授权引导」早晚有一边会改歪
//   （同 utils/canvas-deco.js 顶部那条理由）。
//
// 【8.1.3 已清账】card.js ×2 / art.js / annual.js 里那四份等价的 catch 分支全并进来了，
//   现在全项目就这一份「保存失败怎么分」。调用方只剩一句「没弹过的那个弹出去」：
//     try { ... await saveimg.save(path); ... }
//     catch (e) { wx.hideLoading(); if (!e.shown) wx.showToast({ title: e.msg, icon: 'none' }); }
// ============================================================
const AUTH_RE = /auth|authorize|deny|permission/i;
const CANCEL_RE = /cancel/i;

/**
 * 相册权限：用户拒过一次之后微信不再弹窗，只能引到设置页自己开。
 * 弹窗自己弹（调用方不要再弹第二个）。
 */
function guideAuth() {
  wx.showModal({
    title: '需要相册权限',
    content: '保存图片需要「添加到相册」权限，请在设置中开启',
    confirmText: '去设置',
    success: (r) => { if (r.confirm) wx.openSetting(); }
  });
}

/**
 * 画布 → 临时图片文件。
 * getContext('2d') 的节点必须是 createSelectorQuery 拿到的那个 node（不是页面里的 canvas id）。
 * @param {object} canvas canvas 2d 节点
 * @returns {Promise<string>} 临时文件路径
 */
function exportCanvas(canvas) {
  return new Promise((resolve, reject) => {
    if (!canvas) return reject(new Error('画布还没准备好'));
    wx.canvasToTempFilePath({
      canvas,
      success: (res) => resolve(res.tempFilePath),
      fail: (e) => reject(new Error(String((e && e.errMsg) || e)))
    });
  });
}

/**
 * 存进相册。
 * 失败时抛出的 Error 带两个字段：
 *   msg   —— 给用户看的人话（调用方直接 toast 这句）
 *   shown —— true 表示「已经弹过窗了」，调用方别再弹第二个
 * @param {string} filePath 临时文件路径
 */
function save(filePath) {
  return new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => resolve(true),
      fail: (e) => {
        const msg = String((e && e.errMsg) || e);
        if (AUTH_RE.test(msg)) {
          guideAuth();
          return reject(Object.assign(new Error('需要相册权限'), { msg: '', shown: true }));
        }
        if (CANCEL_RE.test(msg)) {
          return reject(Object.assign(new Error('已取消'), { msg: '', shown: true }));
        }
        reject(Object.assign(new Error('保存失败，请重试'), { msg: '保存失败，请重试', shown: false }));
      }
    });
  });
}

module.exports = { exportCanvas, save, guideAuth };
