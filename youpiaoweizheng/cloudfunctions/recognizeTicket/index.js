// recognizeTicket/index.js —— 识别云函数
// 链路：前端上传图片到云存储 → 本函数下载 → OCR 双通道 → 规则解析
//      → 返回结构化草稿给前端确认。
// OCR 双通道（4.9.0）：
//   ① 百度智能云「通用文字识别」——每月 1000 次免费额度，需在下方填
//      API_KEY / SECRET_KEY（百度智能云控制台 → 文字识别 → 创建应用）
//   ② 微信云调用 openapi.ocr.printedText——兜底（需服务市场配额）
// 调用方传入：{ fileID }（云存储 fileID）
// 返回：{ ok, draft, lines } 或 { ok:false, msg }
const https = require('https');
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const parser = require('./parser.js');

// ★★★ 百度 OCR 密钥（填入后自动启用百度通道；留空则只走微信通道）★★★
const BAIDU_OCR = {
  API_KEY: '',      // ← API Key
  SECRET_KEY: ''    // ← Secret Key
};

// ---------- 通用 https POST（内置模块，零依赖） ----------
function httpsPost(host, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host, path, method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error('响应解析失败：' + buf.slice(0, 80))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => req.destroy(new Error('请求超时')));
    req.write(body);
    req.end();
  });
}

// ---------- 百度通道（access_token 内存缓存，有效期约 30 天） ----------
let _bdToken = null;

async function baiduToken() {
  if (_bdToken && _bdToken.expiresAt > Date.now()) return _bdToken.value;
  const body =
    'grant_type=client_credentials' +
    '&client_id=' + encodeURIComponent(BAIDU_OCR.API_KEY) +
    '&client_secret=' + encodeURIComponent(BAIDU_OCR.SECRET_KEY);
  const r = await httpsPost('aip.baidubce.com', '/oauth/2.0/token', body);
  if (!r || !r.access_token) {
    throw new Error('token 获取失败 ' + JSON.stringify(r).slice(0, 90));
  }
  _bdToken = { value: r.access_token, expiresAt: Date.now() + ((r.expires_in || 2592000) - 86400) * 1000 };
  return _bdToken.value;
}

async function baiduOcr(imgBuffer) {
  const token = await baiduToken();
  const body = 'image=' + encodeURIComponent(imgBuffer.toString('base64')) + '&language_type=CHN_ENG';
  const r = await httpsPost(
    'aip.baidubce.com',
    '/rest/2.0/ocr/v1/general_basic?access_token=' + encodeURIComponent(token),
    body
  );
  if (r && r.error_code) {
    throw new Error('错误码 ' + r.error_code + ' ' + (r.error_msg || ''));
  }
  return ((r && r.words_result) || []).map((w) => String(w.words || '').trim()).filter(Boolean);
}

// ---------- 微信通道（云调用，免密钥，需服务市场配额） ----------
async function wxOcr(imgBuffer) {
  const ocr = await cloud.openapi.ocr.printedText({
    img: { contentType: 'image/jpeg', value: imgBuffer }
  });
  return (ocr.items || []).map((i) => String(i.text || '').trim()).filter(Boolean);
}

// ---------- 主流程 ----------
exports.main = async (event) => {
  const { fileID } = event;
  if (!fileID) return { ok: false, msg: '缺少 fileID' };
  // 4.18.0 P2：fileID 白名单——downloadFile 只允许读本环境云存储路径，
  // 防伪造 fileID 触发异常下载/探测（云函数端是管理员权限，必须自己限权）。
  if (!/^cloud:\/\/[\w-]+\.[^/]+\//.test(String(fileID))) {
    return { ok: false, msg: 'fileID 格式不合法' };
  }

  try {
    // 1. 从云存储下载原图
    const dl = await cloud.downloadFile({ fileID });
    const imgBuffer = Buffer.from(dl.fileContent);

    // 2. OCR 双通道：百度（已配密钥时优先）→ 微信（兜底）
    const hasBaidu = !!(BAIDU_OCR.API_KEY && BAIDU_OCR.SECRET_KEY);
    let lines = [];
    const errs = [];
    if (hasBaidu) {
      try {
        lines = await baiduOcr(imgBuffer);
      } catch (e) {
        errs.push('百度：' + (e.message || e));
      }
    }
    if (!lines.length) {
      try {
        lines = await wxOcr(imgBuffer);
      } catch (e) {
        errs.push('微信：' + (e.errMsg || e.message || e));
      }
    }

    // 3. 提取文本行
    if (!lines.length) {
      // 有报错 = 通道问题；无报错 = 两通道都认为图里没字
      if (errs.length) {
        return { ok: false, msg: 'OCR 识别失败（' + errs.join('；') + '）' };
      }
      return { ok: false, msg: '没有识别到文字，试试对焦更近、光线更亮？' };
    }

    // 4. 规则解析 → 结构化草稿
    const draft = parser.parse(lines);
    return { ok: true, draft, lines };
  } catch (e) {
    return { ok: false, msg: '识别异常：' + (e.message || 'unknown') };
  }
};
