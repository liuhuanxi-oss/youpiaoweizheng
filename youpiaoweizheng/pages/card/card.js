// pages/card/card.js —— 纪念卡片（M3.2 Canvas 真实渲染 + 相册导出）
// ============================================================
// 四套风格在同一张 600×960 逻辑画布上绘制：
//   classic 经典纸感（视觉方案 A · 纸质收藏册底座）
//   poster  演出海报（视觉方案 B · 午夜现场，暗色光晕）
//   journal 手账水彩（视觉方案 C · 情侣手账，拍立得+水彩晕染）
//   daily   每日日签
// M3.1 对齐产品原型屏③：
//   + 票根照片区（有照片画照片 cover 裁剪，无照片画纸票占位）
//   + 演出海报补 NO. 收藏编号眉头
//   + 经典纸感补「有票为证」邮戳（盖在照片角上）
//   + 撕票线打孔颜色随底色自适应
// 保存：canvasToTempFilePath → saveImageToPhotosAlbum（含授权引导）
// 换一版文案：AI 实时重写（详情页保存为准）
// ============================================================
const store = require('../../utils/store.js');
const { weekday, annivYears } = require('../../utils/date.js');
const ai = require('../../utils/ai.js');
const themeUtil = require("../../utils/theme.js");
const couple = require('../../utils/couple.js');
const { USE_CLOUD } = require('../../utils/env.js');       // 4.17.0：演示模式不带码
const track = require('../../utils/track.js');             // 4.17.0：拉新埋点
const share = require('../../utils/share.js');             // 7.3.0 S1/S2：分享文案（好友 + 朋友圈）
const invite = require('../../utils/invite.js');           // 7.3.0 R6：海报码带邀请人短码
const pay = require('../../utils/pay.js');                 // 4.20.3：署名（昵称 → 卡面落款）
const points = require('../../utils/points.js');           // 7.4.0 B 段 R2：生成卡片 +2（端上唯一的得分上报）
const { iconSrc } = require('../../utils/icons.js');       // 稿屏6：按钮与空态图标（全页无 emoji）
const decoUtil = require('../../utils/deco.js');           // 稿屏6：卡外那几处手绘点缀
// 与年报长图共用的画笔（齿边 / 圆角 / 折行 / 花枝 / 星点 / 水彩晕）。
// ⚠️ 必须写成一整行：scripts/dev/preview-card.js 靠「行首 const … require(…);」整行删掉
//    再自行注入这几支笔，拆行会剩下半截声明与注入的同名变量撞车。
const { wrapText, roundRect, pinkedRect, watercolorBlob, drawStar4, drawHeart, drawSprig, drawTape, safeDpr } = require('../../utils/canvas-deco.js');
const haptics = require('../../utils/haptics.js'); // 7.4.0：触觉三档，别再直接写 vibrateShort

const W = 600, H = 960;
const LS_SHARE = 'sp_share_count'; // 时光信使勋章：分享/导出计数（本地）

// v5.0 S1 小红书竖版：主画布 600×960（5:8）→ 离屏画布装裱成 1080×1440（3:4 标准竖版）
// 装裱底色/水印色随卡片风格适配（poster 深底用奶油水印，其余纸底用褐灰）
const XHS_W = 1080, XHS_H = 1440;
const XHS_BG = { classic: '#F4EFE6', daily: '#F4EFE6', journal: '#FDF9F0', poster: '#1A1512' };
const XHS_WM = {
  classic: 'rgba(156, 143, 128, 0.9)',
  daily: 'rgba(156, 143, 128, 0.9)',
  journal: 'rgba(185, 168, 140, 0.9)',
  poster: 'rgba(247, 242, 230, 0.55)'
};
const WM_TEXT = '@有票为证 · 你的时光档案馆'; // v5.0 S2 标准品牌水印文案

// ---------- 绘制工具 ----------
function drawBarcode(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  let cx = x;
  let seed = 7;
  while (cx < x + w - 6) {
    seed = (seed * 9301 + 49297) % 233280;
    const bw = 2 + (seed % 5);
    ctx.fillRect(cx, y, bw, h);
    cx += bw + 3 + (seed % 4);
  }
}

function tearLine(ctx, y, color, holeColor) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(36, y);
  ctx.lineTo(W - 36, y);
  ctx.stroke();
  // 两侧打孔（用撕线后的底色圆模拟缺口）
  ctx.setLineDash([]);
  ctx.fillStyle = holeColor || '#F4EFE6';
  ctx.beginPath(); ctx.arc(36, y, 12, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(W - 36, y, 12, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function kvRow(ctx, k, v, y, kColor, vColor) {
  ctx.textAlign = 'left';
  ctx.font = '20px sans-serif';
  ctx.fillStyle = kColor;
  ctx.fillText(k, 60, y);
  ctx.textAlign = 'right';
  ctx.font = '600 20px sans-serif';
  ctx.fillStyle = vColor;
  ctx.fillText(String(v || '—').slice(0, 22), W - 60, y);
}

function md(dateStr) {
  const parts = String(dateStr || '').split('-');
  return parts.length === 3 ? `${Number(parts[1])}.${parts[2]}` : '--.--';
}

/** 票根照片区：有照片 cover 裁剪，无照片画纸票占位；右下角标座位·票价 */
function drawPhotoBlock(ctx, img, t, x, y, w, h, opts) {
  const o = opts || {};
  ctx.save();
  roundRect(ctx, x, y, w, h, 16);
  ctx.clip();
  if (img) {
    const iw = img.width || 600, ih = img.height || 800;
    const s = Math.max(w / iw, h / ih);
    const dw = iw * s, dh = ih * s;
    try { ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); } catch (e) { /* 图异常则落占位 */ }
  }
  if (!img) {
    ctx.fillStyle = o.emptyBg || '#EFE7D6';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = o.emptyFg || '#B3A690';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('票根照片 · 待补拍', x + 22, y + h / 2 - 12);
    drawBarcode(ctx, x + 22, y + h / 2 + 8, Math.min(w - 44, 220), 16, o.emptyBarcode || '#C9BB9F');
  }
  ctx.restore();
  ctx.strokeStyle = o.border || 'rgba(43,36,32,0.18)';
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 16);
  ctx.stroke();
  const cap = [t.seat, t.price ? '¥' + t.price : ''].filter(Boolean).join(' · ');
  if (cap) {
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = o.capColor || 'rgba(43,36,32,0.5)';
    ctx.fillText(cap, x + w, y + h + 26);
  }
}

/** 「有票为证」邮戳（4.11.1 对齐品牌定稿印章）：虚线外环 + 实心印面 + 白「证」 */
function drawPostmark(ctx, x, y, r, color) {
  ctx.save();
  // 外虚线环（呼应定稿标识的外圈虚线）
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 6]);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  // 实心印面
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r - 7, 0, Math.PI * 2); ctx.fill();
  // 印面白「证」
  ctx.fillStyle = '#FDF6EC';
  ctx.textAlign = 'center';
  ctx.font = `700 ${Math.round((r - 7) * 1.12)}px serif`;
  ctx.fillText('证', x, y + (r - 7) * 0.36);
  ctx.restore();
}

/** 双人头像徽章：M4 绑定后替代邮戳出现在照片角上（我橘 · TA蓝） */
function drawDuoBadge(ctx, x, y, r, duo) {
  const off = r * 0.74;
  const one = (cx, char, bg) => {
    ctx.save();
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,252,245,0.92)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = '#FFF6E8';
    ctx.font = `700 ${Math.round(r * 0.92)}px serif`;
    ctx.textAlign = 'center';
    ctx.fillText(char, cx, y + r * 0.34);
    ctx.restore();
  };
  one(x - off, (duo.myName || '我')[0], '#E0532F');
  one(x + off, (duo.partnerName || 'TA')[0], '#3E6B8C');
}

/** 4.11.0 同场角标：「✦ 同场 N 人共同收藏」（N≥2 才画；深色胶囊底适配四风格） */
function drawSameBadge(ctx, x, y, n, dark) {
  if (!(n >= 2)) return;
  const text = `✦ 同场 ${n} 人共同收藏`;
  ctx.font = '600 17px sans-serif';
  const w = ctx.measureText(text).width + 34;
  const h = 34;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = dark ? 'rgba(20,16,24,0.66)' : 'rgba(30,24,20,0.62)';
  roundRect(ctx, x, y - h / 2, w, h, 17);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#FFF6E8';
  ctx.textAlign = 'left';
  ctx.fillText(text, x + 17, y + 6);
  ctx.restore();
}

/** 4.17.0 M1 海报带码：右下角小程序码（白底圆角衬 + 88px 画幅，扫码直达收藏册）
 *  qr 为空不画，返回默认右距；带码时返回让位后的品牌文案右对齐 x。 */
function drawQR(ctx, qr) {
  if (!qr) return W - 60;
  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, W - 148, 826, 88, 88, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(43,36,32,0.14)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, W - 148, 826, 88, 88, 12);
  ctx.stroke();
  try { ctx.drawImage(qr, W - 142, 832, 76, 76); } catch (e) { /* 码图异常则只留白衬 */ }
  ctx.restore();
  return W - 162; // 品牌文案右对齐让位（码左缘 - 14px 间距）
}

/** 拍立得：白框 + 微倾斜 + 底边手写注释 + 双角胶带（手账水彩风格的照片区） */
function drawPolaroid(ctx, img, t, cx, cy, w, h, angle, duo) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  // 白框（带投影，像贴上去的）
  ctx.shadowColor = 'rgba(43,36,32,0.18)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, -w / 2, -h / 2, w, h, 6);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  // 图区
  const px = -w / 2 + 14, py = -h / 2 + 14;
  const pw = w - 28, ph = h - 74;
  ctx.save();
  roundRect(ctx, px, py, pw, ph, 4);
  ctx.clip();
  if (img) {
    const iw = img.width || 600, ih = img.height || 800;
    const s = Math.max(pw / iw, ph / ih);
    try { ctx.drawImage(img, px + (pw - iw * s) / 2, py + (ph - ih * s) / 2, iw * s, ih * s); } catch (e) { /* 异常落占位 */ }
  }
  if (!img) {
    ctx.fillStyle = '#F2EAD9';
    ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = '#C9BB9F';
    ctx.font = '15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('票根照片 · 待补拍', 0, -12);
    drawBarcode(ctx, -80, 0, 160, 14, '#D5C8AC');
  }
  ctx.restore();
  // 白框底边手写注释
  const cap = [t.seat, t.price ? '¥' + t.price : ''].filter(Boolean).join(' · ');
  if (cap) {
    ctx.fillStyle = '#8A7B66';
    ctx.font = 'italic 17px serif';
    ctx.textAlign = 'center';
    ctx.fillText(cap, 0, h / 2 - 24);
  }
  // 双角和纸胶带（半透明，压在照片上边缘）
  drawTape(ctx, -w / 2 + 26, -h / 2 + 6, -0.6, 70, 26, 'rgba(240,170,110,0.5)');
  drawTape(ctx, w / 2 - 26, -h / 2 + 6, 0.6, 70, 26, 'rgba(150,180,200,0.45)');
  // 绑定后：右下角双人头像徽章
  if (duo) drawDuoBadge(ctx, w / 2 - 66, h / 2 - 28, 26, duo);
  ctx.restore();
}

// ---------- 三套风格 ----------
function drawClassic(ctx, t, quote, img, duo, same, qr, sig) {
  ctx.fillStyle = '#F4EFE6';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#E0D6C2';
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, W - 40, H - 40);

  ctx.textAlign = 'left';
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#9C8F80';
  ctx.fillText('Y O U P I A O · K E E P S A K E', 60, 70);
  ctx.textAlign = 'right';
  ctx.fillText('NO.' + String(t.id || '').slice(-6).toUpperCase(), W - 60, 70);

  tearLine(ctx, 100, 'rgba(43,36,32,0.35)');

  // 票名（两行）
  ctx.textAlign = 'left';
  ctx.font = '600 32px sans-serif';
  ctx.fillStyle = '#2B2420';
  const titleLines = wrapText(ctx, t.title, W - 120, 2);
  titleLines.forEach((l, i) => ctx.fillText(l, 60, 175 + i * 44));

  // 信息区（行数不定 → 照片区动态让位）
  let y = 275;
  kvRow(ctx, '时间', `${t.date} ${t.time || ''}`, y, '#9C8F80', '#2B2420'); y += 46;
  kvRow(ctx, '场馆', t.venue, y, '#9C8F80', '#2B2420'); y += 46;
  kvRow(ctx, '城市', t.city, y, '#9C8F80', '#2B2420'); y += 46;
  if (t.seat) { kvRow(ctx, '座位', t.seat, y, '#9C8F80', '#2B2420'); y += 46; }
  if (t.price) { kvRow(ctx, '票价', `¥${t.price}${t.source ? ' · ' + t.source : ''}`, y, '#9C8F80', '#2B2420'); }

  // 票根照片区（信息行越多画得越矮，保证文案区不挤压）
  const rows = 3 + (t.seat ? 1 : 0) + (t.price ? 1 : 0);
  const infoEnd = 275 + rows * 46;
  const photoH = rows >= 4 ? 140 : 180;
  const photoY = infoEnd + 26;
  drawPhotoBlock(ctx, img, t, 60, photoY, W - 120, photoH);
  // 绑定后照片角上是双人头像徽章，未绑定是「有票为证」邮戳
  if (duo) drawDuoBadge(ctx, W - 118, photoY + photoH - 30, 30, duo);
  else drawPostmark(ctx, W - 118, photoY + photoH - 30, 34, 'rgba(224,83,47,0.72)');
  // 4.11.0：同场角标（照片区左下，避开右侧邮戳/双人徽章）
  drawSameBadge(ctx, 76, photoY + photoH - 30, same, false);

  // 文案
  if (quote) {
    const quoteY = photoY + photoH + 66;
    ctx.font = 'italic 22px serif';
    ctx.fillStyle = '#6B5F52';
    ctx.textAlign = 'left';
    const qLines = wrapText(ctx, `「${quote}」`, W - 120, 2);
    qLines.forEach((l, i) => ctx.fillText(l, 60, quoteY + i * 34));
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#B3A690';
    ctx.fillText('—— 文案由 AI 生成', 60, quoteY + qLines.length * 34 + 12);
  }

  // 底部条形码 + 品牌（4.17.0 M1：带码时品牌文案左让，给右下小程序码腾位）
  drawBarcode(ctx, 60, 830, 280, 44, '#2B2420');
  const brandX = drawQR(ctx, qr);
  ctx.textAlign = 'right';
  ctx.font = '600 18px sans-serif';
  ctx.fillStyle = '#2B2420';
  ctx.fillText((sig ? sig + ' · ' : '') + '有票为证 · 让时光有迹可循', brandX, 850);
  ctx.font = '14px sans-serif';
  ctx.fillStyle = '#9C8F80';
  ctx.fillText(`${t.date} · ${t.city || ''}`, brandX, 878);
}

function drawPoster(ctx, t, quote, img, duo, same, qr, sig) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#3A2E24');
  g.addColorStop(0.55, '#241E19');
  g.addColorStop(1, '#1A1512');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 顶部光晕
  const halo = ctx.createRadialGradient(160, 90, 20, 160, 90, 320);
  halo.addColorStop(0, 'rgba(245,185,64,0.30)');
  halo.addColorStop(1, 'rgba(245,185,64,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, 420);

  ctx.textAlign = 'left';
  ctx.font = '16px sans-serif';
  ctx.fillStyle = 'rgba(247,242,230,0.55)';
  ctx.fillText('Y O U P I A O · L I V E', 60, 70);
  // 收藏编号眉头（对齐原型 NO.0077）
  ctx.textAlign = 'right';
  ctx.fillText('NO.' + String(t.id || '').slice(-6).toUpperCase(), W - 185, 71);

  // 日期徽章
  ctx.fillStyle = '#E0532F';
  roundRect(ctx, W - 160, 42, 100, 44, 22);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.font = '600 20px sans-serif';
  ctx.fillStyle = '#FFF6E8';
  ctx.fillText(md(t.date), W - 110, 71);

  // 票名（三行，大字）
  ctx.textAlign = 'left';
  ctx.font = '600 40px sans-serif';
  ctx.fillStyle = '#F7F2E6';
  const titleLines = wrapText(ctx, t.title, W - 120, 3);
  titleLines.forEach((l, i) => ctx.fillText(l, 60, 175 + i * 54));

  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#C9A24B';
  ctx.fillText(`${t.city || ''} ${t.venue ? '· ' + t.venue : ''}`.trim().slice(0, 24), 60, 175 + titleLines.length * 54 + 16);

  tearLine(ctx, 370, 'rgba(247,242,230,0.30)', '#2B231C');

  // 票根照片区（对齐原型：海报中段是票根图）
  drawPhotoBlock(ctx, img, t, 60, 400, W - 120, 160, {
    border: 'rgba(247,242,230,0.25)',
    capColor: 'rgba(247,242,230,0.55)',
    emptyBg: 'rgba(255,255,255,0.08)',
    emptyFg: 'rgba(247,242,230,0.5)',
    emptyBarcode: 'rgba(247,242,230,0.35)'
  });
  if (duo) drawDuoBadge(ctx, W - 118, 530, 30, duo);
  // 4.11.0：同场角标
  drawSameBadge(ctx, 76, 530, same, true);

  // 信息
  kvRow(ctx, '时间', `${t.date} ${t.time || ''}`, 624, 'rgba(247,242,230,0.5)', 'rgba(247,242,230,0.95)');
  if (t.seat) kvRow(ctx, '座位', t.seat, 666, 'rgba(247,242,230,0.5)', 'rgba(247,242,230,0.95)');

  // 文案
  if (quote) {
    const quoteY = 712;
    ctx.font = 'italic 24px serif';
    ctx.fillStyle = 'rgba(247,242,230,0.9)';
    ctx.textAlign = 'left';
    const qLines = wrapText(ctx, `「${quote}」`, W - 120, 2);
    qLines.forEach((l, i) => ctx.fillText(l, 60, quoteY + i * 38));
    ctx.font = '14px sans-serif';
    ctx.fillStyle = 'rgba(247,242,230,0.45)';
    ctx.fillText('—— 文案由 AI 生成', 60, quoteY + qLines.length * 38 + 14);
  }

  // 底部条形码 + 品牌（4.17.0 M1：带码时品牌文案左让）
  drawBarcode(ctx, 60, 830, 280, 44, 'rgba(247,242,230,0.85)');
  const brandXP = drawQR(ctx, qr);
  ctx.textAlign = 'right';
  ctx.font = '600 18px sans-serif';
  ctx.fillStyle = '#F7F2E6';
  ctx.fillText((sig ? sig + ' · ' : '') + '有票为证 · 让时光有迹可循', brandXP, 850);
  ctx.font = '14px sans-serif';
  ctx.fillStyle = 'rgba(247,242,230,0.5)';
  ctx.fillText(`${t.date} · ${t.city || ''}`, brandXP, 878);
}

function drawDaily(ctx, t, quote, img, duo, same, qr, sig) {
  ctx.fillStyle = '#F4EFE6';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#E0D6C2';
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, W - 40, H - 40);

  // 顶部大日期
  ctx.textAlign = 'left';
  ctx.font = '600 72px sans-serif';
  ctx.fillStyle = '#E0532F';
  ctx.fillText(md(t.date), 60, 150);
  ctx.font = '18px sans-serif';
  ctx.fillStyle = '#9C8F80';
  ctx.fillText(`${t.date} ${weekday(t.date)}`, 60, 190);
  ctx.textAlign = 'right';
  ctx.font = '16px sans-serif';
  ctx.fillText('今日时光签', W - 60, 70);
  ctx.fillText('YOUPIAO DAILY', W - 60, 95);

  // 票名
  ctx.textAlign = 'left';
  ctx.font = '600 30px sans-serif';
  ctx.fillStyle = '#2B2420';
  const titleLines = wrapText(ctx, t.title, W - 120, 2);
  titleLines.forEach((l, i) => ctx.fillText(l, 60, 300 + i * 42));

  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#6B5F52';
  ctx.fillText(`${t.city || ''} ${t.venue ? '· ' + t.venue : ''}`.trim().slice(0, 24), 60, 300 + titleLines.length * 42 + 16);

  // 票根照片区（小横幅）
  drawPhotoBlock(ctx, img, t, 60, 392, W - 120, 140);
  // 4.11.0：同场角标
  drawSameBadge(ctx, 76, 392 + 140 - 30, same, false);

  tearLine(ctx, 580, 'rgba(43,36,32,0.35)');

  // 文案（居中）
  if (quote) {
    ctx.textAlign = 'center';
    ctx.font = '26px serif';
    ctx.fillStyle = '#2B2420';
    const qLines = wrapText(ctx, quote, W - 160, 3);
    qLines.forEach((l, i) => ctx.fillText(l, W / 2, 630 + i * 44));
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#B3A690';
    ctx.fillText('—— 文案由 AI 生成', W / 2, 630 + qLines.length * 44 + 16);
  }

  // 底部条形码 + 品牌（4.17.0 M1：带码时品牌文案左让）
  drawBarcode(ctx, 60, 830, 280, 44, '#2B2420');
  const brandXD = drawQR(ctx, qr);
  ctx.textAlign = 'right';
  ctx.font = '600 18px sans-serif';
  ctx.fillStyle = '#2B2420';
  ctx.fillText((sig ? sig + ' · ' : '') + '有票为证 · 让时光有迹可循', brandXD, 850);
}

// 手账水彩（对齐视觉方案 C：情侣/温柔气质——水彩晕染 + 拍立得 + bullet 手账排版）
function drawJournal(ctx, t, quote, img, duo, same, qr) {
  // 暖白纸底 + 水彩晕染
  ctx.fillStyle = '#FDF9F0';
  ctx.fillRect(0, 0, W, H);
  watercolorBlob(ctx, 500, 110, 280, 'rgba(240,150,90,0.20)');
  watercolorBlob(ctx, 100, 850, 260, 'rgba(90,130,170,0.14)');
  watercolorBlob(ctx, 110, 210, 180, 'rgba(230,120,110,0.10)');

  // 虚线手账框
  ctx.save();
  ctx.strokeStyle = '#D9CBB2';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 7]);
  roundRect(ctx, 26, 26, W - 52, H - 52, 20);
  ctx.stroke();
  ctx.restore();

  // 顶部：日期贴纸 + 手写英文
  ctx.fillStyle = '#F6D9B8';
  roundRect(ctx, 52, 52, 156, 44, 10);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.font = '600 18px sans-serif';
  ctx.fillStyle = '#8A5A2B';
  ctx.fillText(`${md(t.date)} ${weekday(t.date)}`, 130, 81);
  ctx.textAlign = 'right';
  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#B9A88C';
  ctx.fillText('YOUPIAO JOURNAL', W - 56, 70);

  // 标题 + 水彩笔触下划线
  ctx.textAlign = 'left';
  ctx.font = '700 34px serif';
  ctx.fillStyle = '#4A3B2D';
  const titleLines = wrapText(ctx, t.title, W - 130, 2);
  titleLines.forEach((l, i) => ctx.fillText(l, 60, 165 + i * 46));
  const titleW = ctx.measureText(titleLines[0]).width;
  const underlineY = 182 + (titleLines.length - 1) * 46;
  ctx.fillStyle = 'rgba(240,150,90,0.28)';
  roundRect(ctx, 58, underlineY, Math.min(titleW + 26, W - 130), 12, 6); ctx.fill();
  ctx.fillStyle = 'rgba(240,150,90,0.18)';
  roundRect(ctx, 72, underlineY + 5, Math.min(titleW + 60, W - 116), 10, 5); ctx.fill();

  // 拍立得照片（微倾斜 + 双角胶带；绑定后角上双人徽章）
  drawPolaroid(ctx, img, t, W / 2, 432, 400, 330, -0.028, duo);
  // 4.11.0：同场角标（拍立得左下）
  drawSameBadge(ctx, 122, 556, same, false);

  // 手账 bullet 信息
  const bullets = [
    ['时间', `${t.date} ${t.time || ''}`.trim()],
    ['地点', `${t.city || ''} ${t.venue ? '· ' + t.venue : ''}`.trim() || '—']
  ];
  if (t.seat) bullets.push(['座位', t.seat]);
  let by = 650;
  ctx.textAlign = 'left';
  bullets.forEach((b) => {
    ctx.fillStyle = '#E0532F';
    ctx.beginPath(); ctx.arc(66, by - 7, 4, 0, Math.PI * 2); ctx.fill();
    ctx.font = '19px sans-serif';
    ctx.fillStyle = '#8A7B66';
    ctx.fillText(b[0], 82, by);
    ctx.font = '600 19px sans-serif';
    ctx.fillStyle = '#4A3B2D';
    ctx.fillText(String(b[1]).slice(0, 20), 138, by);
    by += 38;
  });

  // 文案
  if (quote) {
    const quoteY = by + 16;
    ctx.font = 'italic 22px serif';
    ctx.fillStyle = '#6B5A45';
    const qLines = wrapText(ctx, `「${quote}」`, W - 140, 2);
    qLines.forEach((l, i) => ctx.fillText(l, 60, quoteY + i * 34));
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#C0B09A';
    ctx.fillText('—— 文案由 AI 生成', 60, quoteY + qLines.length * 34 + 14);
  }

  // 底部：星星分隔 + 品牌（4.17.0 M1：码画右下，居中文案不冲突、无需让位）
  drawQR(ctx, qr);
  ctx.textAlign = 'center';
  ctx.font = '14px sans-serif';
  ctx.fillStyle = '#D9B88A';
  ctx.fillText('✦ · ✦ · ✦', W / 2, 864);
  ctx.font = '600 17px sans-serif';
  ctx.fillStyle = '#4A3B2D';
  ctx.fillText('有票为证 · 让时光有迹可循', W / 2, 894);
}

// ---------- 第五套风格：齿边明信片（品牌全案 · 稿屏6，现为默认风格） ----------
// 卡面一律是 JS 画出来的，读不到 CSS 变量 —— 所以品牌固定色只能写死在这里。
// 这组色与 app.wxss 的 --cream/--peach/--butter/--rose/--sage/--brown/--stamp 同源。
const PC = {
  paper: '#FBF6E8',                      // 卡片纸底
  edge: 'rgba(196,168,116,0.85)',        // 齿孔线的墨
  ink: '#4A3B2E',                        // 正文墨（深褐，比纯黑软）
  soft: '#8A7B66',                       // 次级文字
  rose: '#D98E9B',                       // 玫瑰：编号标签描边、三道波浪、爱心
  deep: '#C26B5E',                       // 深玫瑰：品牌标渐变的下端
  gold: '#E2B85C',                       // 金：星点、花心
  butter: '#F6DFA8',                     // 奶油黄：编号标签底
  leaf: '#A9C3A6',                       // 叶
  petal: '#E8AFA8',                      // 花瓣
  frame: 'rgba(196,168,116,0.55)'        // 白框/码框的边
};
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// 星点 / 爱心 / 花枝三支笔在 utils/canvas-deco.js，与年报长图共用；
// 花枝的色板传 PC，保证卡面上那两枝仍是明信片自己的绿与粉。

/**
 * 稿屏6 的卡面：齿边明信片（编号标签 / 邮戳 / 注销波浪 / 齿边照片 / 标题 + 三道波浪 /
 * 城市·日期 / 虚线 / 品牌标 + 二维码）。
 * 版式按「卡片高 960」等比排：y 值全部是实测稿内比例换算，改一处要连着看下一条会不会撞。
 */
function drawPostcard(ctx, t, quote, img, duo, same, qr, sig) {
  const M = 74;                 // 内容左右边距
  const iw = W - M * 2;         // 内容可用宽（452）
  // ① 纸底 + 齿孔线（整张卡就是一枚从整版上撕下来的齿孔明信片）
  ctx.fillStyle = PC.paper;
  ctx.fillRect(0, 0, W, H);
  // 两团极淡的水彩，给纸面一点温度（不抢正文）
  watercolorBlob(ctx, W - 110, 150, 210, 'rgba(244,198,180,0.16)');
  watercolorBlob(ctx, 90, H - 120, 190, 'rgba(169,195,166,0.14)');
  ctx.strokeStyle = PC.edge;
  ctx.lineWidth = 2.4;
  ctx.lineJoin = 'round';
  pinkedRect(ctx, 15, 15, W - 30, H - 30, 22, 5.5);
  ctx.stroke();

  // ② 左上角编号标签（奶油黄底 + 虚线边，微微歪着贴上去）
  const no = 'No.' + String(t.id || '').slice(-6).toUpperCase();
  ctx.save();
  ctx.translate(M, 84);
  ctx.rotate(-0.035);
  ctx.fillStyle = PC.butter;
  roundRect(ctx, -20, -23, 168, 46, 8);
  ctx.fill();
  ctx.strokeStyle = PC.rose;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([5, 4]);
  roundRect(ctx, -13, -16, 154, 32, 6);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = PC.ink;
  ctx.font = '700 21px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(no, 0, 8);
  ctx.restore();

  // ③ 右上角邮戳：双圈 + 弧形城市名 + 日/月/年三行 + 注销波浪
  const pmX = W - 152, pmY = 118, pmR = 52;
  ctx.save();
  ctx.strokeStyle = 'rgba(150,120,80,0.72)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(pmX, pmY, pmR, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([4, 5]);
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(pmX, pmY, pmR - 10, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  // 城市名逐字排上圆弧（与时光机页的邮戳同一套算法：先按角度自转，再沿自身「上」方推半径）
  const city = String(t.city || '票根').slice(0, 4);
  ctx.fillStyle = 'rgba(120,95,62,0.9)';
  ctx.font = '600 15px sans-serif';
  ctx.textAlign = 'center';
  if (city.length > 1) {
    const spread = 0.5 * (city.length - 1);          // 弧度制：2 字 0.5rad、4 字 1.5rad
    const step = spread / (city.length - 1);
    city.split('').forEach((ch, i) => {
      const a = -spread / 2 + step * i;
      ctx.save();
      ctx.translate(pmX, pmY);
      ctx.rotate(a);
      ctx.fillText(ch, 0, -pmR + 15);
      ctx.restore();
    });
  } else {
    ctx.fillText(city, pmX, pmY - pmR + 19);
  }
  // 日 / 月 / 年（邮戳里的三行排法：日在上、月居中、年在下）
  const dp = String(t.date || '').split('-');
  const pmLines = [
    { s: dp[2] || '--', f: '700 19px sans-serif', dy: -10 },
    { s: MON[(Number(dp[1]) || 1) - 1] || '', f: '600 13px sans-serif', dy: 10 },
    { s: dp[0] || '----', f: '700 18px sans-serif', dy: 30 }
  ];
  ctx.fillStyle = 'rgba(120,95,62,0.95)';
  pmLines.forEach((l) => { ctx.font = l.f; ctx.fillText(l.s, pmX, pmY + l.dy); });
  // 底部小星 + 序号末两位（稿里的 ☆ 6）
  drawStar4(ctx, pmX - 16, pmY + pmR - 12, 7, 'rgba(150,120,80,0.8)');
  ctx.font = '600 13px sans-serif';
  ctx.fillText(String(t.id || '').slice(-2), pmX + 6, pmY + pmR - 7);
  ctx.restore();
  // 注销波浪：邮戳右侧三道，长度递减
  ctx.save();
  ctx.strokeStyle = 'rgba(150,120,80,0.65)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const y0 = pmY - 20 + i * 20;
    const x0 = pmX + pmR + 6;
    const x1 = W - 44 - i * 8;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    for (let x = x0; x < x1; x += 8) {
      ctx.quadraticCurveTo(x + 4, y0 + (i % 2 ? 5 : -5), Math.min(x + 8, x1), y0);
    }
    ctx.stroke();
  }
  ctx.restore();

  // ④ 票根照片：齿边白框（像一枚邮票），框内 cover 裁切
  const fw = 456, fh = 312, fcx = W / 2, fcy = 346;
  ctx.save();
  ctx.translate(fcx, fcy);
  ctx.rotate(-0.012);
  ctx.shadowColor = 'rgba(74,59,46,0.20)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 9;
  ctx.fillStyle = '#FFFFFF';
  pinkedRect(ctx, -fw / 2, -fh / 2, fw, fh, 20, 4);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  const px = -fw / 2 + 15, py = -fh / 2 + 15, pw = fw - 30, ph = fh - 30;
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, pw, ph);
  ctx.clip();
  if (img) {
    const iw2 = img.width || 600, ih2 = img.height || 800;
    const s = Math.max(pw / iw2, ph / ih2);
    try { ctx.drawImage(img, px + (pw - iw2 * s) / 2, py + (ph - ih2 * s) / 2, iw2 * s, ih2 * s); } catch (e) { /* 图异常落占位 */ }
  }
  if (!img) {
    ctx.fillStyle = '#F2EAD9';
    ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = '#C9BB9F';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('票根照片 · 待补拍', px + 24, py + ph / 2 - 10);
    drawBarcode(ctx, px + 24, py + ph / 2 + 10, Math.min(pw - 48, 240), 18, '#D5C8AC');
  }
  ctx.restore();
  // 绑定态 → 照片右下角双人头像徽章；未绑定不盖品牌印（稿屏6 的邮戳已在右上角，再盖一个就重了）
  if (duo) drawDuoBadge(ctx, fw / 2 - 42, fh / 2 - 42, 28, duo);
  // 4.11.0：同场角标（照片左下）
  drawSameBadge(ctx, -fw / 2 + 42, fh / 2 - 42, same, false);
  ctx.restore();

  // ⑤ 标题（最多两行）+ 右侧三道玫瑰波浪 + 城市·日期
  ctx.textAlign = 'left';
  ctx.fillStyle = PC.ink;
  ctx.font = '900 40px sans-serif';
  const titleLines = wrapText(ctx, t.title || '这张票根', fw - 30, 2);
  const titleY = 566;
  titleLines.forEach((l, i) => ctx.fillText(l, M, titleY + i * 46));
  const cityY = titleY + (titleLines.length - 1) * 46 + 62;
  // 三道波浪：右对齐，长度递减，与城市行同一个视觉带（稿里就在「上海 · 日期」右侧）
  ctx.save();
  ctx.strokeStyle = PC.rose;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  [100, 84, 68].forEach((len, i) => {
    const y0 = cityY - 30 + i * 12;
    ctx.beginPath();
    ctx.moveTo(W - M - len, y0);
    for (let x = W - M - len; x < W - M; x += 12) {
      ctx.quadraticCurveTo(x + 6, y0 + 4, Math.min(x + 12, W - M), y0);
    }
    ctx.stroke();
  });
  ctx.restore();
  ctx.fillStyle = PC.soft;
  ctx.font = '21px sans-serif';
  ctx.fillText([t.city, (t.date || '').replace(/-/g, '.')].filter(Boolean).join(' · '), M, cityY);

  // ⑥ 虚线分隔
  const sepY = cityY + 44;
  ctx.save();
  ctx.strokeStyle = PC.frame;
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 6]);
  ctx.beginPath();
  ctx.moveTo(M, sepY);
  ctx.lineTo(W - M, sepY);
  ctx.stroke();
  ctx.restore();

  // ⑦ 左下品牌标 + 右下二维码
  const QR = 118, qrX = W - M - QR, qrY = sepY + 30;
  if (qr) {
    // 码框也是齿边（与卡片、照片同一套「从整版撕下来」的语汇）
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    pinkedRect(ctx, qrX, qrY, QR, QR, 13, 3);
    ctx.fill();
    ctx.strokeStyle = PC.frame;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
    try { ctx.drawImage(qr, qrX + 13, qrY + 13, QR - 26, QR - 26); } catch (e) { /* 码图异常则只留白衬 */ }
    ctx.fillStyle = PC.soft;
    ctx.font = '15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('扫码看我的时光档案', qrX + QR / 2, qrY + QR + 26);
  }
  // 品牌标：圆角方 + 桃→玫瑰渐变 + 白色票根剪影（与 Tab/启动图的标一致）
  const lgY = sepY + 34, lgS = 64;
  ctx.save();
  const lg = ctx.createLinearGradient(M, lgY, M + lgS, lgY + lgS);
  lg.addColorStop(0, '#F4C6B4');
  lg.addColorStop(1, PC.deep);
  ctx.fillStyle = lg;
  roundRect(ctx, M, lgY, lgS, lgS, 18);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  roundRect(ctx, M + 14, lgY + 20, lgS - 28, 24, 5);
  ctx.fill();
  ctx.fillStyle = PC.deep;
  ctx.fillRect(M + 19, lgY + 29, lgS - 38, 2.4);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  drawStar4(ctx, M + lgS - 14, lgY + 14, 6, 'rgba(255,255,255,0.95)');
  ctx.restore();
  ctx.fillStyle = PC.ink;
  ctx.font = '800 32px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('有票为证', M + 80, lgY + 30);
  ctx.fillStyle = PC.soft;
  ctx.font = '16px sans-serif';
  ctx.fillText((sig ? sig + ' · ' : '') + '让时光有迹可循', M + 80, lgY + 56);

  // ⑧ 卡面点缀：金星星 / 玫瑰心 / 两枝花（稿里撒在卡边的那几处）
  //    只往左右两条边距里放 —— 正文区（M..W-M）一律不碰，标题换行也不会撞上
  drawStar4(ctx, 46, 288, 11, PC.gold);
  drawStar4(ctx, W - 42, 430, 9, 'rgba(226,184,92,0.85)');
  drawStar4(ctx, 50, sepY + 96, 8, 'rgba(226,184,92,0.75)');
  drawHeart(ctx, W - 50, sepY + 74, 10, 'rgba(217,142,155,0.85)');
  // 两枝都收在卡片底部的两个角上：文案居中占的是 x 104..496，左右各留出一条空当，
  // 花枝竖着长正好嵌进去，标题换行、二维码有无都不会撞
  drawSprig(ctx, 36, H - 24, 72, -1.15, false, PC);
  drawSprig(ctx, W - 36, H - 24, 72, -1.15, true, PC);

  // ⑨ AI 文案（换一版文案在这里生效；放最下面一行，不挤正文）
  if (quote) {
    ctx.fillStyle = PC.soft;
    ctx.font = 'italic 18px serif';
    ctx.textAlign = 'center';
    const qLines = wrapText(ctx, `「${quote}」`, iw - 60, 2);
    qLines.forEach((l, i) => ctx.fillText(l, W / 2, H - 84 + i * 26));
  }
}

const DRAWERS = { postcard: drawPostcard, classic: drawClassic, poster: drawPoster, journal: drawJournal, daily: drawDaily };

// ---------- 小红书素材：封面图与步骤图（8.0.0 X3） ----------
// 卡片页「存小红书素材」一共出三张 3:4 竖图：成品图（saveXHS 装裱的卡面截图）、封面图
// （drawXhsCover）、步骤图（drawXhsSteps）。后两张是**直接画**在 1080×1440 上的、不截卡面——
// 封面要的是能在信息流里被点开的大图，把 600×960 的卡面等比放大只会得到一张小字；
// 步骤图讲的是「怎么用」，跟某一张具体的票无关。
//
// 【为什么一张二维码都不画 —— 这不是漏了】
//   小红书 2026 细则把站外导流判成违规：笔记配图里出现二维码即算导流，图像识别能识破
//   马赛克，处罚含限流 30 天、封号、最高 2 万违约金。所以这两支笔连 qr 参数都不接——
//   卡面右下角那枚「扫码看我的时光档案」绝不许混进来。
//   **连「微信搜 XX」这种字样也不能写**：项目自己的运营口径《有票为证小红书内容运营
//   提示词.md》§5 把「图里出现搜索字样」与放码并列成红线，§7 的反面例子表里逐字列着
//   「微信搜有票为证」。判导流看的是「有没有把用户往站外指」——写出来就是指示。
//   所以素材图上只落品牌名，让用户自己起「叫什么来着，我搜一下」的念头（§8 原话）。
const XM = 84;             // 素材图左右留白（1080 宽里取 84，比卡面的 74 松一点）
const XW = XHS_W - XM;     // 内容右边界（996）

/** 封面图：顶部标签 + 大标题 + 齿边照片 + 票面信息 + AI 文案 + 品牌行 */
function drawXhsCover(ctx, t, quote, img, duo, same, sig) {
  // ① 纸底 + 两团极淡水彩（与卡面同一支笔，给纸面一点温度）
  ctx.fillStyle = PC.paper;
  ctx.fillRect(0, 0, XHS_W, XHS_H);
  watercolorBlob(ctx, XHS_W - 150, 240, 330, 'rgba(244,198,180,0.18)');
  watercolorBlob(ctx, 120, XHS_H - 210, 300, 'rgba(169,195,166,0.15)');

  // ② 顶部标签（卡面左上那个 No. 标签的同款语汇：奶油黄底 + 玫瑰虚线内框）
  ctx.font = '700 30px sans-serif';
  const tagW = ctx.measureText('票根收藏册').width + 64;
  ctx.fillStyle = PC.butter;
  roundRect(ctx, XM, 76, tagW, 64, 12);
  ctx.fill();
  ctx.strokeStyle = PC.rose;
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 6]);
  roundRect(ctx, XM + 10, 86, tagW - 20, 44, 8);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = PC.ink;
  ctx.textAlign = 'left';
  ctx.fillText('票根收藏册', XM + 32, 119);

  // ③ 大标题：最多两行。超出的截断补省略号——84px 的字截在半个词上，一眼就看出是坏的
  ctx.fillStyle = PC.ink;
  ctx.font = '900 84px sans-serif';
  const all = wrapText(ctx, t.title || '这张票根', XW - XM, 99);
  const lines = all.slice(0, 2);
  if (all.length > 2) lines[1] = lines[1].slice(0, -1) + '…';
  lines.forEach((l, i) => ctx.fillText(l, XM, 282 + i * 100));

  // ④ 标题只有一行时，在照片上方补一道玫瑰波浪 —— 免得中间空出一大块。
  //    两行时那块地方本来就被第二行占着，不加（加了会撞字）
  if (lines.length < 2) {
    ctx.save();
    ctx.strokeStyle = PC.rose;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    [230, 190, 150].forEach((len, i) => {
      const y0 = 344 + i * 17;
      ctx.beginPath();
      ctx.moveTo(XM, y0);
      for (let x = XM; x < XM + len; x += 22) {
        ctx.quadraticCurveTo(x + 11, y0 + 7, Math.min(x + 22, XM + len), y0);
      }
      ctx.stroke();
    });
    ctx.restore();
  }

  // ⑤ 票根照片：齿边白框（与卡面同一支笔），框内 cover 裁切。
  //    位置固定、不随标题行数走——标题只有一行时上方多留一点空，
  //    比「版式跟着字数跳」更像一张排好的图
  const fw = XW - XM, fh = 608, fcx = XHS_W / 2, fcy = 734;
  ctx.save();
  ctx.translate(fcx, fcy);
  ctx.rotate(-0.008);
  ctx.shadowColor = 'rgba(74,59,46,0.20)';
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = '#FFFFFF';
  pinkedRect(ctx, -fw / 2, -fh / 2, fw, fh, 30, 8);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  const px = -fw / 2 + 24, py = -fh / 2 + 24, pw = fw - 48, ph = fh - 48;
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, pw, ph);
  ctx.clip();
  if (img) {
    const iw = img.width || 600, ih = img.height || 800;
    const s = Math.max(pw / iw, ph / ih);
    try { ctx.drawImage(img, px + (pw - iw * s) / 2, py + (ph - ih * s) / 2, iw * s, ih * s); } catch (e) { /* 图异常落占位 */ }
  }
  if (!img) {
    ctx.fillStyle = '#F2EAD9';
    ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = '#C9BB9F';
    ctx.font = '28px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('票根照片 · 待补拍', px + 40, py + ph / 2 - 20);
    drawBarcode(ctx, px + 40, py + ph / 2 + 16, Math.min(pw - 80, 380), 30, '#D5C8AC');
  }
  ctx.restore();
  if (duo) drawDuoBadge(ctx, fw / 2 - 62, fh / 2 - 62, 40, duo);
  drawSameBadge(ctx, -fw / 2 + 62, fh / 2 - 62, same, false);
  ctx.restore();

  // ⑥ 票面信息一行（超宽截断：场馆名可能很长，宁可截也不要折行去压下面的虚线）
  ctx.fillStyle = PC.soft;
  ctx.font = '34px sans-serif';
  ctx.textAlign = 'left';
  const meta = [t.city, (t.date || '').replace(/-/g, '.'), t.venue].filter(Boolean).join(' · ');
  ctx.fillText(wrapText(ctx, meta, XW - XM, 1)[0], XM, 1118);

  // ⑦ 虚线分隔（与卡面同一道）
  ctx.save();
  ctx.strokeStyle = PC.frame;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([9, 8]);
  ctx.beginPath();
  ctx.moveTo(XM, 1172);
  ctx.lineTo(XW, 1172);
  ctx.stroke();
  ctx.restore();

  // ⑧ AI 文案（「换一版文案」在这张图上同样生效）
  if (quote) {
    ctx.fillStyle = PC.soft;
    ctx.font = 'italic 32px serif';
    wrapText(ctx, '「' + quote + '」', XW - XM, 2)
      .forEach((l, i) => ctx.fillText(l, XM, 1240 + i * 46));
  }

  // ⑨ 品牌行（与卡面左下那行同文；不做 logo 方块，封面底部留干净些）
  ctx.fillStyle = PC.ink;
  ctx.font = '800 40px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('有票为证', XM, 1362);
  ctx.fillStyle = PC.soft;
  ctx.font = '26px sans-serif';
  ctx.fillText((sig ? sig + ' · ' : '') + '让时光有迹可循', XM + 172, 1362);

  // ⑩ 边距里撒几处点缀（只走左右两条边距，正文区一律不碰 —— 同卡面 ⑧ 的规矩）
  drawStar4(ctx, 42, 470, 20, PC.gold);
  drawStar4(ctx, XHS_W - 38, 700, 15, 'rgba(226,184,92,0.85)');
  drawHeart(ctx, 42, 1080, 17, 'rgba(217,142,155,0.85)');
}

/** 步骤图：三步教程（怎么用这个小程序），当笔记的第二张图 */
function drawXhsSteps(ctx) {
  // ① 纸底 + 齿边内框（整张图就是一枚从整版上撕下来的齿孔页）
  ctx.fillStyle = PC.paper;
  ctx.fillRect(0, 0, XHS_W, XHS_H);
  watercolorBlob(ctx, XHS_W - 130, 200, 310, 'rgba(244,198,180,0.16)');
  watercolorBlob(ctx, 110, XHS_H - 260, 290, 'rgba(169,195,166,0.14)');
  ctx.strokeStyle = PC.edge;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  pinkedRect(ctx, 26, 26, XHS_W - 52, XHS_H - 52, 30, 7);
  ctx.stroke();

  // ② 标题
  ctx.textAlign = 'left';
  ctx.fillStyle = PC.ink;
  ctx.font = '900 78px sans-serif';
  ctx.fillText('三步，把票根收成册', XM, 216);
  ctx.fillStyle = PC.soft;
  ctx.font = '32px sans-serif';
  ctx.fillText('有票为证 · 拍下票根，AI 帮你存档', XM, 280);

  // ③ 标题下那道玫瑰波浪（与封面图同一道 —— 两张图摆在一起像一套）
  ctx.save();
  ctx.strokeStyle = PC.rose;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  [230, 190, 150].forEach((len, i) => {
    const y0 = 344 + i * 17;
    ctx.beginPath();
    ctx.moveTo(XM, y0);
    for (let x = XM; x < XM + len; x += 22) {
      ctx.quadraticCurveTo(x + 11, y0 + 7, Math.min(x + 22, XM + len), y0);
    }
    ctx.stroke();
  });
  ctx.restore();

  // ④ 三步：数字圆 + 标题 + 说明（块与块之间一道虚线）。
  //    说明都压在一行里 —— 折出「都行」这种孤字行，比少说两句话难看多了
  const STEPS = [
    ['拍下票根', '对着票根拍一张 —— 演出票、电影票、车票都行'],
    ['AI 自动识别', '票名、场馆、日期自动填好，还会替你写一句纪念文案'],
    ['收进册子', '生成纪念卡片、回忆地图、年度报告，随时翻出来看']
  ];
  const tx = XM + 148;   // 文字左边界（让开数字圆）
  STEPS.forEach((s, i) => {
    const cy = 500 + i * 300;
    ctx.fillStyle = PC.deep;
    ctx.beginPath(); ctx.arc(XM + 54, cy, 54, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFF6E8';
    ctx.font = '700 54px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), XM + 54, cy + 19);
    ctx.textAlign = 'left';
    ctx.fillStyle = PC.ink;
    ctx.font = '800 48px sans-serif';
    ctx.fillText(s[0], tx, cy - 24);
    ctx.fillStyle = PC.soft;
    ctx.font = '30px sans-serif';
    wrapText(ctx, s[1], XW - tx, 2).forEach((l, k) => ctx.fillText(l, tx, cy + 32 + k * 44));
    if (i < 2) {
      ctx.save();
      ctx.strokeStyle = PC.frame;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 7]);
      ctx.beginPath();
      ctx.moveTo(tx, cy + 156);
      ctx.lineTo(XW, cy + 156);
      ctx.stroke();
      ctx.restore();
    }
  });

  // ⑤ 页脚：只落品牌名，不写「去哪儿找」（口径见本段文件头注释）——与封面图的品牌行同一套写法
  ctx.save();
  ctx.strokeStyle = PC.frame;
  ctx.lineWidth = 2;
  ctx.setLineDash([9, 8]);
  ctx.beginPath();
  ctx.moveTo(XM, 1276);
  ctx.lineTo(XW, 1276);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = PC.ink;
  ctx.font = '800 40px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('有票为证', XM, 1352);
  ctx.fillStyle = PC.soft;
  ctx.font = '26px sans-serif';
  ctx.fillText('让时光有迹可循', XM + 172, 1352);

  // ⑥ 步数那张图正文排得满，装饰只往左右边距里放两处，够了
  drawStar4(ctx, 42, 372, 20, PC.gold);
  drawStar4(ctx, XHS_W - 38, 1180, 15, 'rgba(226,184,92,0.85)');
}

const XHS_ART = { cover: drawXhsCover, steps: drawXhsSteps };

// ---------- 页面 ----------
Page({

  onShow() {
    themeUtil.apply(this);
    this.buildArt();
    this._loadSignature(); // 4.20.3：署名异步到货后重绘（首绘不等它，不卡首屏）
  },

  /**
   * 按当前主题把这一页要用的图形编译成实色 data-uri（主题切换后必须重编）。
   * 卡外那几处点缀（花枝 / 四角星 / 小粉心）取品牌固定色而非主题 primary——
   * 它们是「实物」，六套主题下色相不变；纸感主题的 primary 近乎全黑，会画成一丛黑枝。
   */
  buildArt() {
    const m = themeUtil.getThemeMeta(themeUtil.getTheme());
    this.setData({
      ic: {
        back: iconSrc('back', m.text, 0.85),
        share: iconSrc('share', '#FFF8F2', 0, 1.8),
        download: iconSrc('download', m.text, 0.85, 1.7),
        empty: iconSrc('ticket', m.text, 0.28, 1.4)
      },
      art: {
        sprig: decoUtil.decoSrc('sprig', Object.assign({}, m, { primary: '#A9C3A6', accent: '#E8AFA8' })),
        star: decoUtil.decoSrc('star4', Object.assign({}, m, { accent: '#E2B85C' })),
        heart: decoUtil.decoSrc('heartsmall', Object.assign({}, m, { accent: '#E8AFA8' }))
      }
    });
  },

  /** 4.20.3 署名：昵称截 10 字防落款溢出；云失败/未设置 → 空串，落款保持品牌原样 */
  _loadSignature() {
    pay.getProfile().then((p) => {
      const nick = String((p && p.nickname) || '').trim();
      const sig = nick ? (nick.length > 10 ? nick.slice(0, 10) + '…' : nick) : '';
      if (sig === this.data.signature) return;
      this.setData({ signature: sig }, () => { if (this._ctx && this.data.t) this.draw(); });
    }).catch(() => {});
  },
  data: {
    theme: "a", legacyTheme: "a",
    t: null,
    quote: '',
    // 稿屏6 的齿边明信片是默认风格；其余四套搬到右上角「···」里，主界面只留该有的两枚按钮
    style: 'postcard',
    signature: '', // 4.20.3：卡面落款署名（昵称，截 10 字；空=不署名）
    styles: [
      { key: 'postcard', label: '齿边明信片' },
      { key: 'classic', label: '经典纸感' },
      { key: 'poster', label: '演出海报' },
      { key: 'journal', label: '手账水彩' },
      { key: 'daily', label: '每日日签' }
    ],
    ic: {},   // 单色图标（buildArt 编译）
    art: {},  // 卡外点缀（花枝 / 四角星 / 小粉心，buildArt 编译）
    exporting: false,
    redoing: false,
    // 7.2.0：取票期间的状态位。此前 t 为 null 且 notFound 为 false 时两个分支都不命中，
    // 整页只剩一根导航栏——弱网/云函数冷启动时白屏可达数秒
    loading: true,
    // 4.19.1 空态：票根未命中（过期 id / 云库异常 / 分享落地）——整页内容都挂在
    // wx:if="{{t}}" 下，t=null 时四个风格胶囊、海报、按钮全部消失只剩导航栏白屏
    notFound: false,
    // 7.4.0：画布节点初始化重试耗尽（见 _ensureCanvas）→ 卡位上盖一层可点的提示。
    // 之前只在控制台 warn，用户看到的是空框，只会以为「还在生成」
    canvasFail: false,
    // 7.3.0 S1：朋友圈单页模式（无身份、不能跳页）→ 整页换品牌落地卡
    sp: share.sp()
  },

  async onLoad(options) {
    // 7.3.0 S1：朋友圈单页模式拿不到身份，取票必然落空 → 直接亮品牌落地卡，
    // 不白跑一趟云库、也不让空态与落地卡同时出现（loading 得关掉）
    if (this.data.sp) { this.setData({ loading: false }); return; }
    // 4.22.5 修复（BUG审查①）：移除「getTicket 未命中 → 自动 fallback 自己第一张票」。
    // 后果：好友点开分享卡（云库仅创建者可读，读不到他人票）会看到"自己的票"而非空态，
    // 同场角标/海报文案全部错位。现在 id 失效/越权一律落 notFound 空态（明确出路）。
    // 4.19.1 保留：取票 reject 不外抛，页面不死透。
    let t = null;
    try {
      t = await store.getTicket(options.id);
    } catch (e) {
      console.warn('[card] 取票链路异常：', e);
    }
    if (!t) {
      console.warn('[card] 票根未命中，落空态：id =', options && options.id);
      this.setData({ notFound: true, loading: false });
      return;
    }
    // 4.17.0 M1 海报带码 A/B：首次进入随机分组并持久化（20% 不带码做对照，
    // 用于对比两组海报的扫码回流）。演示模式无云能力 → 固定不带。
    let ab = '';
    try { ab = wx.getStorageSync('sp_poster_ab') || ''; } catch (e) { /* 忽略 */ }
    if (!ab) {
      ab = Math.random() < 0.8 ? 'code' : 'none';
      try { wx.setStorageSync('sp_poster_ab', ab); } catch (e) { /* 忽略 */ }
    }
    this._ab = USE_CLOUD ? ab : 'none';
    // 4.11.0：详情页带来的同场数（N≥2 时卡片画「同场 N 人共同收藏」角标）
    this._same = Number(options && options.same) || 0;
    // 绑定态 → 海报照片角画双人头像徽章
    const c = couple.cachedCouple();
    this._duo = c && c.boundAt ? c : null;
    this.setData({
      t,
      loading: false,
      quote: t.aiCaption || '有些夜晚值得被留下来，一遍一遍地放。'
    }, () => {
      // 4.22.4：t 到货后 canvas 才真正挂载，此处补初始化再首绘（修 onReady 竞争导致的空白画布）
      this._ensureCanvas().then((ok) => { if (ok) this.draw(); });
    });
  },

  onReady() {
    this._ensureCanvas().then((ok) => { if (ok) this.draw(); });
  },

  /**
   * 7.4.3：页面退出把画布还回去。这张 600×960 的卡按 dpr 放大后位图约 53MB（年报表那张 74MB），
   * 是全站最大内存单点；不释放就只能等 GC —— 低端机上连着导出几张海报会直接闪退。
   * 置零而不是只丢引用：Canvas 2D 的位图要显式释放。
   * 只在退出时释放、不在导出后释放：onShareAppMessage 还要用同一块画布出转发图。
   */
  _releaseCanvas() {
    if (this._canvas) {
      this._canvas.width = 0;
      this._canvas.height = 0;
    }
    this._canvas = null;
    this._ctx = null;
  },

  onUnload() {
    this._releaseCanvas();
  },

  /**
   * 4.22.4 修复：canvas 初始化幂等 + 重试（修「卡片区域整块空白」）。
   * 根因——canvas 挂在 wx:if="{{t}}" 下，onReady 与异步取票存在竞争：
   * 取票慢时（云函数冷启动/弱网）onReady 先跑，t 还是 null → canvas 节点尚未挂载 →
   * 旧逻辑打句 warn 就 return，之后再也没人初始化；取票回来 setData 后画布永远空白
   * （真机表现：风格胶囊/按钮都在，卡片区域一整块黑）。改为幂等自愈：
   * onReady / 票到货 / 任何 draw 入口都可经此补初始化（已初始化直接返回 true）。
   */
  _ensureCanvas(tryN) {
    if (this._ctx) return Promise.resolve(true);
    tryN = tryN || 0;
    return new Promise((resolve) => {
      this.createSelectorQuery().select('#cardCanvas').fields({ node: true, size: true }).exec((res) => {
        const node = res && res[0] && res[0].node;
        if (!node) {
          if (tryN >= 10) {
            console.warn('[card] canvas 节点初始化失败（重试耗尽），海报不会渲染：', res);
            // 7.4.0：还要让**用户**知道 —— 只打 console 等于让他对着一个空框干等「生成中」
            this.setData({ canvasFail: true });
            return resolve(false);
          }
          return setTimeout(() => resolve(this._ensureCanvas(tryN + 1)), 200);
        }
        this._canvas = node;
        this._ctx = node.getContext('2d');
        if (this.data.canvasFail) this.setData({ canvasFail: false }); // 起死回生：提示自己收掉
        // 卡面 600×960 目前怎么放都到不了上限，走同一条回夹规则是为了**尺寸改大时不再出事**
        // （年报表就是 1080×1920 × 3 = 5760，早越线了，见 utils/canvas-deco.js 的 safeDpr）
        const dpr = safeDpr(W, H, ((wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2));
        this._canvas.width = W * dpr;
        this._canvas.height = H * dpr;
        this._ctx.scale(dpr, dpr);
        resolve(true);
      });
    });
  },

  /** 兜底提示被点：把画布初始化整条重走一遍（不清 _ctx 的话 _ensureCanvas 会直接返回 true），
   *  成了就重画并收起提示；还是不行就留着提示 —— 再弹一个「失败」弹窗只是把人堵在这里。 */
  retryCanvas() {
    if (this._retrying) return;          // 连点：重试本身要建节点，排队重来一遍没意义
    this._retrying = true;
    haptics.tap();
    this._ctx = null;
    this._canvas = null;
    this._ensureCanvas().then((ok) => {
      this._retrying = false;
      if (!ok) return;
      this.draw();
    });
  },

  /** 票根照片 → Canvas Image（cloud:// 先换临时链接；失败返回 null 走占位） */
  _ensurePhoto() {
    const t = this.data.t || {};
    if (!t.img) return Promise.resolve(null);
    if (this._photoFor === t.img && this._photo) return Promise.resolve(this._photo);
    return new Promise((resolve) => {
      const finish = (url) => {
        if (!url || !this._canvas) return resolve(null);
        const img = this._canvas.createImage();
        img.onload = () => { this._photo = img; this._photoFor = t.img; resolve(img); };
        img.onerror = () => resolve(null);
        img.src = url;
      };
      if (/^cloud:/.test(t.img)) {
        wx.cloud.getTempFileURL({
          fileList: [t.img],
          success: (r) => finish(r.fileList && r.fileList[0] && r.fileList[0].tempFileURL),
          fail: () => resolve(null)
        });
      } else {
        finish(t.img);
      }
    });
  },

  draw() {
    if (!this.data.t) return;
    if (!this._ctx) {
      // 4.22.4：任何入口（风格切换/署名回包）先到而画布未初始化 → 自愈补初始化后再绘
      this._ensureCanvas().then((ok) => { if (ok && this.data.t) this.draw(); });
      return;
    }
    const token = (this._drawToken = (this._drawToken || 0) + 1);
    // 4.17.1 修复：海报不等码图——首版 Promise.all(照片, 码) 让首屏卡在云函数上
    //（wxacode 冷启动可达十几秒，真机表现为画布长期空白）。
    // 现改为：照片就绪立即渲染（恢复 4.16.0 秒出体验）；码图独立加载，
    // 就绪且本次绘制未被风格切换过期 → 自动补画带码版。
    this._ensurePhoto().then((img) => {
      if (token !== this._drawToken) return;
      this._render(img, this._qrImg || null);
      if (this._ab === 'code' && !this._qrImg && !this._qrFail) {
        this._ensureQR().then((qr) => {
          if (qr && token === this._drawToken) this._render(img, qr);
        });
      }
    });
  },

  /**
   * 等第一帧画出来（最多 3 秒）。
   * 为什么必须有：进页面就秒点「保存到相册」时，照片还在 load，画布上什么都没有 ——
   * 导出的是一张空白卡，而且用户拿到的是一张看着「成功」的废图。
   * 已经有帧了就直接过（正常路径零等待）。
   */
  _waitFirstFrame() {
    if (this._rendered) return Promise.resolve(true);
    return new Promise((resolve) => {
      this._firstFrame = resolve;
      setTimeout(() => { // 兜底：一直没画出来也放行，画布失败另有 canvasFail 提示兜着
        if (this._firstFrame) { this._firstFrame(false); this._firstFrame = null; }
      }, 3000);
    });
  },

  /** 用已就绪的素材渲染当前风格海报（img/qr 任一可为 null：落照片占位/不带码） */
  _render(img, qr) {
    this._rendered = true;
    if (this._firstFrame) { this._firstFrame(true); this._firstFrame = null; }
    this._qrDrawn = !!qr; // 本次实际是否带码（poster_save 埋点口径）
    // 8.0.0：封面图要用同一张照片 —— 记下这个已加载好的 img，导出时就不再走一遍云存储
    this._photoImg = img || null;
    (DRAWERS[this.data.style] || drawClassic)(this._ctx, this.data.t, this.data.quote, img, this._duo || null, this._same || 0, qr || null, this.data.signature || '');
  },

  /** 4.17.0 M1：小程序码图（云函数生成 + 全局缓存 fileID；A组 none / 演示 / 失败 → null 静默） */
  _ensureQR() {
    if (this._ab !== 'code' || this._qrFail) return Promise.resolve(null);
    if (this._qrImg) return Promise.resolve(this._qrImg);
    if (this._qrPend) return this._qrPend; // 4.17.1：进行中的请求直接复用（防连点风格重复调云函数）
    // 7.3.0 R6：先确保「我的邀请短码」就绪 —— 海报上的码带 r=<短码>，
    // 扫码进来的人才会归因到我（app.js 启动时已在取，通常这里直接命中缓存；
    // 没命中就多等一次云调用，码本来就是后台加载、不挡首屏）
    this._qrPend = invite.ensureCode().then(() => this._fetchQR());
    return this._qrPend;
  },

  /** 取码图：云函数生成/缓存 fileID → 临时链接 → canvas image（失败静默 null） */
  _fetchQR() {
    return new Promise((resolve) => {
      wx.cloud.callFunction({
        name: 'saveTicket',
        data: { action: 'wxacode', ref: invite.myCode() },
        success: (res) => {
          const fileID = res.result && res.result.fileID;
          if (!fileID) { this._qrFail = true; this._qrPend = null; return resolve(null); }
          wx.cloud.getTempFileURL({
            fileList: [fileID],
            success: (r) => {
              const url = r.fileList && r.fileList[0] && r.fileList[0].tempFileURL;
              if (!url || !this._canvas) { this._qrFail = true; this._qrPend = null; return resolve(null); }
              const img = this._canvas.createImage();
              img.onload = () => { this._qrImg = img; this._qrPend = null; resolve(img); };
              img.onerror = () => { this._qrFail = true; this._qrPend = null; resolve(null); };
              img.src = url;
            },
            fail: () => { this._qrFail = true; this._qrPend = null; resolve(null); }
          });
        },
        fail: () => { this._qrFail = true; this._qrPend = null; resolve(null); }
      });
    });
  },

  /** 切换卡片风格（画布重绘；导出与分享都按当前风格走） */
  pickStyle(key) {
    if (!DRAWERS[key] || key === this.data.style) return;
    this.setData({ style: key }, () => this.draw());
  },

  /**
   * 卡片风格：主界面只留「保存图片 / 分享给好友」两枚按钮（稿屏6 的版式），
   * 五套风格塞不下也摆不开，故走系统 ActionSheet —— 不额外造弹层，
   * 也就不必再维护一套浮层样式、遮罩与手势。
   */
  onStyle() {
    const cur = this.data.style;
    wx.showActionSheet({
      itemList: this.data.styles.map((s) => (s.key === cur ? s.label + ' · 当前' : s.label)),
      success: (r) => {
        const s = this.data.styles[r.tapIndex];
        if (s) this.pickStyle(s.key);
      },
      fail: () => {}
    });
  },

  /** 换一版 AI 文案（仅当前画布生效，详情页保存为准；4.11.0 跟随详情页风格记忆 + 周年语气） */
  async redo() {
    const t = this.data.t;
    if (!t || this.data.redoing) return;
    this.setData({ redoing: true });
    wx.showLoading({ title: 'AI 重写中…', mask: true });
    try {
      let style = '';
      try { style = wx.getStorageSync('sp_cap_style') || ''; } catch (e) { /* 忽略 */ }
      const quote = await ai.generateCaption(t, style, annivYears(t.date));
      this.setData({ quote }, () => this.draw());
      wx.hideLoading();
      wx.showToast({ title: '已换一版', icon: 'none' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '换版失败，稍后再试', icon: 'none' });
    } finally {
      this.setData({ redoing: false });
    }
  },

  /** 时光信使勋章：**真分享**一次 +1（本地计数）。
   *  7.4.0 C 段修正口径：保存图片到相册**不再计入分享** —— 原先它和分享共用一个函数，
   *  用户一次没分享过、只是存了 10 张图，「分享 10 张卡片」的勋章就亮了。 */
  _incrShare() {
    try {
      const n = (wx.getStorageSync(LS_SHARE) || 0) + 1;
      wx.setStorageSync(LS_SHARE, n);
    } catch (e) { /* 忽略 */ }
  },

  /** 7.4.0 B 段 R2：生成卡片 +2 分（服务端白名单只认这一个端上行为，日上限 2 次）。
   *  不 await、不看返回值：积分是附赠，绝不能因为记账慢/失败打断「已存入相册」的反馈。
   *  记在**真的生成了一张卡片**的时刻（保存 / 小红书导出）——分享没有生成卡片，不算。 */
  _earnCard() {
    points.earnCard();
  },

  /** 导出 PNG 到相册 */
  async save() {
    if (!this._canvas || this.data.exporting) return;
    this.setData({ exporting: true });
    wx.showLoading({ title: '生成图片中…', mask: true });
    try {
      await this._waitFirstFrame(); // 别把还没画出来的空画布存进相册（见 _waitFirstFrame）
      const res = await wx.canvasToTempFilePath({ canvas: this._canvas });
      await new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: resolve,
          fail: reject
        });
      });
      this._earnCard();
      // 4.17.0 poster_save：带码海报的保存转化（口径：本次实际画没画码）
      track.track('poster_save', { style: this.data.style, code: this._qrDrawn ? 1 : 0 });
      wx.hideLoading();
      haptics.confirm(); // M4.5：关键操作（卡片入册）
      wx.showToast({ title: '已存入相册', icon: 'success' });
      // 4.20.3 按需触发署名：保存动作完成、价值已兑现后再邀请（一次会话至多一次，不打断主流程）
      if (!this.data.signature && !this._sigHintShown) {
        this._sigHintShown = true;
        setTimeout(() => {
          wx.showModal({
            title: '给卡片署个名？',
            content: '设置昵称后，你的卡片落款会带上「你的昵称 · 有票为证」。随时可清除。',
            confirmText: '去设置',
            cancelText: '暂不',
            // 「我的」是 tab 页：navigateTo 打不开 tab 页（点了没反应），必须 switchTab
            success: (r) => { if (r.confirm) wx.switchTab({ url: '/pages/me/me' }); }
          });
        }, 1200); // 让「已存入相册」toast 先走完
      }
    } catch (e) {
      wx.hideLoading();
      const msg = String((e && e.errMsg) || e.message || e);
      if (/auth/i.test(msg)) {
        wx.showModal({
          title: '需要相册权限',
          content: '保存卡片需要「添加到相册」权限，请在设置中开启',
          confirmText: '去设置',
          success: (r) => { if (r.confirm) wx.openSetting(); }
        });
      } else if (!/cancel/i.test(msg)) {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      }
    } finally {
      this.setData({ exporting: false });
    }
  },

  /**
   * 8.0.0 X3：小红书素材三件套的入口。原先这一行只出「成品图」（卡面截图装裱），
   * 现在点开是三个选项 —— 发一条笔记，封面 / 教程 / 成品各要一张，分三次点太笨。
   */
  saveXHS() {
    if (!this._canvas || this.data.exporting) return;
    wx.showActionSheet({
      itemList: ['成品图 · 这张卡片', '封面图 · 大图海报', '步骤图 · 三步教程'],
      success: (r) => { this._saveXhsArt(['shot', 'cover', 'steps'][r.tapIndex] || 'shot'); },
      fail: () => { /* 用户点「取消」：什么都不做，不提示 */ }
    });
  },

  /**
   * 出一张 1080×1440 的小红书素材并存相册。
   * @param {string} kind shot=成品图（卡面截图装裱）· cover=封面图 · steps=步骤图
   */
  async _saveXhsArt(kind) {
    if (this.data.exporting) return;
    const TIP = { shot: '生成小红书竖图…', cover: '生成封面图…', steps: '生成步骤图…' };
    this.setData({ exporting: true });
    wx.showLoading({ title: TIP[kind] || TIP.shot, mask: true });
    try {
      const style = this.data.style;
      // 三张图都得等：成品图截的是这个画布，封面图用的也是画布上那张照片（_photoImg 由
      // _render 存下来）。秒点的话，前者截到空白、后者落到「票根照片 · 待补拍」占位
      await this._waitFirstFrame();
      const off = wx.createOffscreenCanvas({ type: '2d', width: XHS_W, height: XHS_H });
      const ctx = off.getContext('2d');
      if (kind === 'shot') {
        const shot = await wx.canvasToTempFilePath({ canvas: this._canvas });
        const img = await new Promise((resolve, reject) => {
          const im = off.createImage();
          im.onload = () => resolve(im);
          im.onerror = () => reject(new Error('装裱失败'));
          im.src = shot.tempFilePath;
        });
        // contain 装裱：完整呈现不裁切，纸色/墨色底出收藏册质感（600×960 图高向受限，左右自然出纸边）
        ctx.fillStyle = XHS_BG[style] || '#F4EFE6';
        ctx.fillRect(0, 0, XHS_W, XHS_H);
        const s = Math.min(XHS_W / img.width, XHS_H / img.height);
        const dw = img.width * s, dh = img.height * s;
        ctx.drawImage(img, (XHS_W - dw) / 2, (XHS_H - dh) / 2, dw, dh);
        // S2 水印：右下角小字（深浅底随风格适配）
        ctx.font = '24px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillStyle = XHS_WM[style] || XHS_WM.classic;
        ctx.fillText(WM_TEXT, XHS_W - 44, XHS_H - 36);
      } else {
        // 封面图 / 步骤图直接画在离屏画布上，不截卡面（见绘制半段的 drawXhsCover / drawXhsSteps）
        (XHS_ART[kind] || XHS_ART.cover)(ctx, this.data.t, this.data.quote,
          this._photoImg || null, this._duo || null, this._same || 0, this.data.signature || '');
      }
      const out = await wx.canvasToTempFilePath({ canvas: off });
      await new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({ filePath: out.tempFilePath, success: resolve, fail: reject });
      });
      this._earnCard();
      track.track('poster_save', { style, code: this._qrDrawn ? 1 : 0, xhs: 1, kind });
      wx.hideLoading();
      haptics.confirm();
      wx.showToast({ title: '已存入相册 · 3:4 适配小红书', icon: 'none' });
    } catch (e) {
      wx.hideLoading();
      const msg = String((e && e.errMsg) || e.message || e);
      if (/auth/i.test(msg)) {
        wx.showModal({
          title: '需要相册权限',
          content: '保存卡片需要「添加到相册」权限，请在设置中开启',
          confirmText: '去设置',
          success: (r) => { if (r.confirm) wx.openSetting(); }
        });
      } else if (!/cancel/i.test(msg)) {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      }
    } finally {
      this.setData({ exporting: false });
    }
  },

  /** 4.19.1 空态动作（与 detail 4.18.0 空态同款）：去收自己的第一张票 / 返回 */
  goScan() {
    wx.redirectTo({ url: '/pages/scan/scan' });
  },
  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.switchTab({ url: '/pages/album/album' }) // 无页面栈兜底（v6.1：wall 已并入 album，tab 页须用 switchTab）
    });
  },

  onShareAppMessage() {
    this._incrShare();
    const t = this.data.t || {};
    // v5.0 S1：分享卡片图用当前画布导出（promise 需 3 秒内返回；失败降级默认截图）
    const promise = this._canvas
      ? wx.canvasToTempFilePath({ canvas: this._canvas })
        .then((r) => ({ imageUrl: r.tempFilePath }))
        .catch(() => ({}))
      : null;
    // 7.3.0 S2：文案与落地页走 share.js（标题带票名与口号，path 带邀请码）
    return share.message('ticket', { title: t.title, id: t.id }, { promise });
  },

  /** 7.3.0 S1：分享到朋友圈（朋友圈只能带 query、落地就是本页） */
  onShareTimeline() {
    const t = this.data.t || {};
    track.track('share_timeline', { from: 'card' });
    return share.timeline('ticket', { title: t.title, id: t.id });
  }
});
