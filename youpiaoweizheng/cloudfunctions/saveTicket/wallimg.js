// saveTicket/wallimg.js —— 8.1.3 上墙图片送检（同场票根墙的最后一道闸门）
// ============================================================
// 【为什么现在才有】8.1.0 建墙时，文字从第一版就检了，**照片一张没检**。
//   可墙是全项目唯一一个陌生人可读的出口 —— 别人上传的图，陌生人直接就能看到。
//   这是一个真洞，8.1.3 补上。
//
// 【为什么不能直接检原图】`security.imgSecCheck` 只吃 ≤1MB 且 ≤750×1334 的图，
//   而票根原图是长边 1600 压出来的（约 200–600KB，尺寸超框）。所以端上在上墙那一下
//   另压一张长边 750 的小图（约 100KB）送来 —— 于是：
//   ① 送检的必然落在接口的限制内；② **展示的就是送检的那张**（写进 wallImg），
//   堵掉「送一张良性的、展示一张违规的」这条旁路。
//
// 【平台故障不等于放行】与 index.js 的 secGate 同一套口径：接口抖动（errCode -1
//   这类）重试一次，两次都异常就**拒**。旧口径「服务异常即通过」在内容安全上
//   等于给违规内容留了一条旁路：挑腾讯侧抖动的时刻提交就进去了。
//
// 【本模块为什么单独成文件】它是安全边界，要能脱开 index.js 单独跑测试：
//   所以 cloud 从参数传进来（与 recall.js 同一条规矩），不 require wx-server-sdk。
// ============================================================

/** 与 index.js 里那条同源（本模块要能独立测试，不反向依赖 index） */
const CLOUD_FILEID_RE = /^cloud:\/\/[\w-]+\.[\w-]+\//;
/** imgSecCheck 的官方体积上限。社区实测 500KB 以上不太稳，端上那张小图约 100KB，留足余量 */
const IMG_MAX = 1024 * 1024;

function isFileID(v) {
  return CLOUD_FILEID_RE.test(String(v || ''));
}

/**
 * 单次送检：下载 → 体积闸 → 送检。
 * @param {object} cloud wx-server-sdk（用它的 downloadFile 与 openapi）
 * @param {string} fileID 要检的云文件 ID
 * @returns {Promise<{ok:true}|{ok:false,msg:string,retry?:boolean}>}
 *   retry 只在「接口抖动」时为真 —— 调用方据此决定要不要再试一次
 */
async function check(cloud, fileID) {
  try {
    const f = await cloud.downloadFile({ fileID });
    const buf = f && f.fileContent;
    if (!buf || !buf.length) return { ok: false, msg: '照片读取失败，请重试' };
    // 超过上限的**不送**（送过去也是报错），给一句人话让人换张图 —— 不重试，重试也还是这么大
    if (buf.length > IMG_MAX) return { ok: false, msg: '这张票根的照片太大，暂时放不上墙' };
    await cloud.openapi.security.imgSecCheck({
      media: { contentType: 'image/jpeg', value: buf }
    });
    return { ok: true };
  } catch (e) {
    const code = (e && (e.errCode || e.errcode)) || 0;
    const text = String((e && (e.errMsg || e.message)) || e);
    // 87014 = 内容含违规风险（imgSecCheck 的固定错误码）
    if (code === 87014 || /87014|risky/i.test(text)) {
      return { ok: false, msg: '照片未通过安全检查，换一张再试' };
    }
    return { ok: false, msg: '图片安检暂时不可用，请稍后再试', retry: true };
  }
}

/** 闸门：抖动重试一次，两次都异常才拒 */
async function gate(cloud, fileID) {
  let r = await check(cloud, fileID);
  if (r.retry) r = await check(cloud, fileID);
  return r;
}

/** 删一张云存储文件（尽力而为）：删不掉不影响业务，也不该让用户看到错误 */
async function drop(cloud, fileID) {
  try {
    if (isFileID(fileID)) await cloud.deleteFile({ fileList: [String(fileID)] });
  } catch (e) { /* 忽略 */ }
}

module.exports = { check, gate, drop, isFileID, IMG_MAX };
