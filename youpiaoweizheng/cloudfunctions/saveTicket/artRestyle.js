// saveTicket/artRestyle.js —— 4.19.0 票根博物志（AI 艺术重绘）
// ============================================================
// 把票根照片重绘成 19 世纪博物志「标本图版」：铜版雕刻线条 + 薄水彩 +
// 旧纸质感。提示词体系基于 vintage-plate 五块式（STYLE/SUBJECT/SIMPLIFY/
// NEGATIVE）做票根适配；TEXT 块（手写标注 + Plate No.）**不由模型生成**——
// 中文小字是图生图乱码重灾区，且标注内容（演出名/日期）是已知精确文本，
// 由前端 Canvas 叠加 100% 准确（这也是「有票为证」的凭证价值：画是艺术的，
// 字是真实的）。提示词里明确禁止模型自作主张加任何文字。
// API：cloud.ai().createImageModel('hunyuan-image').generateImage（I2I 模型，
// 需 wx-server-sdk >= 3.0.5-beta.1；仅服务端可调）。生图 10-60s+：
// 调用方（artRestyle action）走「启动 + 前端轮询」异步模式，见 index.js。
// ============================================================
const https = require('https');

/** 图生图专用模型（I2I）；文生图为 HY-Image-3.0-Plus 系列，勿混用 */
const MODEL = 'HY-Image-v3.0-I2I-ToB-v1.0.1';
const PROVIDER = 'hunyuan-image';

/**
 * 五块式提示词（票根适配版）
 * SUBJECT 保留票面文字（雕刻化重绘）——这是「阶段一效果验证」的核心观察项；
 * 若真机验证乱码严重，V2 降级路径 = 提示词去掉文字保留要求（纯图形化），
 * 全部票面信息由前端 Canvas 重排（方案第七节预备案）。
 */
const PROMPT = [
  // STYLE
  'Redraw the ticket stub in the attached photo as a specimen plate from a 19th-century collector\'s album: a hand-coloured copperplate engraving on aged ivory-cream paper, seen as a scan of an antique printed page. The entire background is aged cream paper with visible fibre grain, faint speckles and slightly uneven yellowing; no frame, no border, no scene, no table and no hand.',
  // SUBJECT
  'The ticket stub is drawn as a flat specimen, shown in exact front view, filling about 55-65% of the frame with generous blank paper around it. Preserve the ticket\'s core structure: its shape (including perforated edges, stub tears and punch holes), the event title, date, venue, seat number, and distinctive graphics or logos. Redraw all text as fine engraved lettering that matches the original layout, keep the words legible and in their original positions. The drawing is built from fine engraved contour lines with delicate hatching in sepia-brown ink, then tinted with thin, translucent, low-saturation watercolour washes that echo the ticket\'s original colours but muted and aged: dusty rose, ochre, slate blue, sepia, warm grey. Lighting is flat and even like a scientific illustration. The print has the slight softness, ink texture and gentle colour misregistration of an old book plate.',
  // SIMPLIFY
  'Isolate the ticket on blank paper. Remove everything else from the photo: the table or desk surface, the user\'s hand, any other objects, reflections, shadows and background clutter. The ticket is the only subject.',
  // TEXT-NOT（模型不加字；标注由前端 Canvas 精确叠加）
  'Do not add any captions, signatures, plate numbers, watermarks or extra text yourself.',
  // NEGATIVE
  'Not a photograph, not a digital painting, not vector or flat illustration, not cartoon or anime. No thick black outlines, no neon or saturated colours, no smooth gradients, no white studio background, no modern illustration gloss.'
].join('\n\n');

function httpsGetBuffer(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 || res.statusCode < 200) {
        res.resume();
        return reject(new Error('图片下载 HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 30000, () => req.destroy(new Error('图片下载超时')));
  });
}

/**
 * 生成博物志图版
 * @param {Object} cloud 已 init 的 wx-server-sdk 单例
 * @param {String} photoFileID 票根照片云存储 fileID
 * @returns {ok, fileID?|msg} 成功返回云存储 fileID（生图 URL 24h 有效，必须转存）
 */
async function generateArt(cloud, photoFileID) {
  // 1. 照片 fileID → 临时公网 URL（I2I 垫图要求 http(s) 地址）
  const urls = await cloud.getTempFileURL({ fileList: [photoFileID] });
  const f0 = urls.fileList && urls.fileList[0];
  const photoUrl = f0 && f0.tempFileURL;
  if (!photoUrl) throw new Error('照片临时链接获取失败');

  // 2. 图生图（混元 I2I；revise 改写 +10s 但显著提升风格遵循度，开）
  const imageModel = cloud.ai().createImageModel(PROVIDER);
  const res = await imageModel.generateImage({
    model: MODEL,
    prompt: PROMPT,
    image_urls: [photoUrl],
    revise: { value: true }
  });
  const artUrl = res && res.data && res.data[0] && res.data[0].url;
  if (!artUrl) throw new Error('生图返回为空');

  // 3. 转存云存储（生图 URL 24 小时失效，不入库）
  const buf = await httpsGetBuffer(artUrl, 30000);
  if (!buf || !buf.length) throw new Error('生图下载为空');
  const up = await cloud.uploadFile({
    cloudPath: `art/art-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`,
    fileContent: buf
  });
  if (!up || !up.fileID) throw new Error('图版上传失败');
  return { fileID: up.fileID };
}

module.exports = { generateArt, MODEL, PROVIDER };
