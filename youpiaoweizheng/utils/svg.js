// utils/svg.js —— 把拼好的 SVG 字符串转成 <image src> 能用的 data-uri
// ============================================================
// 【为什么必须是 base64（2026-09-13 真机事故）】
//   原先三个图形工厂（icons / deco / mapArt）都写成
//     'data:image/svg+xml,' + encodeURIComponent(svg)   ← 百分号编码，非 base64
//   这套写法在开发者工具里一切正常，在**真机上整片不显示**：真机的 <image>
//   只认位图与 base64 data-uri，不解析 SVG 文本结构。于是 7.0 之后的版本传到
//   手机上就是「只有文字没有图案」——首页、勋章、水彩地图、tab 栏全都只剩字。
//   工具能看、真机不能看，所以上线前一直没被发现。
//   base64 是唯一在「工具 + 真机」两边都成立的形态，故收口到这一个函数。
//
// 【为什么要自己写 base64】
//   小程序没有 btoa / TextEncoder。SVG 按仓库规矩不写中文（见 utils/icons.js），
//   但真写了也不能悄悄编坏：charCode 直接塞进制会污染整串且不报错。
//   所以先按 UTF-8 取字节，再编码 —— 几十行换一个「错了能看出来」的确定性。
//
// 【用法】
//   const { toDataUri } = require('../../utils/svg.js');
//   return toDataUri('<svg xmlns="...">...</svg>');
// ============================================================

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 字符串 → UTF-8 字节数组（含代理对，中文/emoji 都不会编坏） */
function utf8Bytes(str) {
  const s = String(str);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    } else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      const c2 = s.charCodeAt(++i);
      const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return out;
}

/** UTF-8 字节数组 → base64 字符串 */
function b64(str) {
  const b = utf8Bytes(str);
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] +
      (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') +
      (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return out;
}

/**
 * 拼好的 SVG → 可直接写进 <image src> 的 data-uri。
 * 前缀必须是完整的 `data:image/svg+xml;base64,`（少一段真机就静默不显示）。
 */
function toDataUri(svg) {
  return 'data:image/svg+xml;base64,' + b64(svg);
}

module.exports = { toDataUri, b64 };
