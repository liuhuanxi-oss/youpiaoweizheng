// scripts/dev/canvas2svg.js —— 把 Canvas 2D 调用录成 SVG（仅供开发期预览，不进小程序包）
// ============================================================
// 为什么需要它：卡面（pages/card/card.js）整张是画在 Canvas 上的，本机没有 node-canvas，
// 改完版式就无法「先看一眼」。这里用最小实现的 Canvas 2D 子集把绘制过程录成 SVG，
// 再交给 resvg 光栅化成 PNG —— 版式、碰撞、配色都能在提交前肉眼核一遍。
//
// 支持的子集（够卡面用）：路径（moveTo/lineTo/quadraticCurveTo/bezierCurveTo/arc/ellipse/
// rect/closePath）、fill/stroke/clip、save/restore/translate/rotate/scale、线性与径向渐变、
// fillText/measureText、setLineDash、阴影（近似成 SVG filter 的 drop-shadow 省略）。
// 不支持：drawImage（记成占位框）、合成模式、滤镜。
// ============================================================

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 2×3 矩阵（与 Canvas 的 a b c d e f 同序） */
const IDENT = [1, 0, 0, 1, 0, 0];
function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
  ];
}
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const mxStr = (m) => `matrix(${m.map((v) => Math.round(v * 1000) / 1000).join(' ')})`;

/** 粗略量字宽：CJK/全角按 1em，ASCII 按 0.55em（预览够用，真机由 Canvas 自己量） */
function measure(text, size) {
  let w = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    w += (c > 0x2e80 ? 1 : (/[ilj.,;:'!|]/.test(ch) ? 0.3 : 0.55)) * size;
  }
  return w;
}

class Gradient {
  constructor(kind, args, m) {
    this.kind = kind; this.args = args; this.m = m; this.stops = [];
    this.id = 'g' + (Gradient.n = (Gradient.n || 0) + 1);
  }
  addColorStop(off, color) { this.stops.push([off, color]); }
  def() {
    const st = this.stops.map(([o, c]) => `<stop offset="${o}" stop-color="${esc(c)}"/>`).join('');
    if (this.kind === 'linear') {
      return `<linearGradient id="${this.id}" gradientUnits="userSpaceOnUse" x1="${this.args[0]}" y1="${this.args[1]}" x2="${this.args[2]}" y2="${this.args[3]}">${st}</linearGradient>`;
    }
    return `<radialGradient id="${this.id}" gradientUnits="userSpaceOnUse" cx="${this.args[3]}" cy="${this.args[4]}" r="${this.args[5]}" fx="${this.args[0]}" fy="${this.args[1]}">${st}</radialGradient>`;
  }
}

class Recorder {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.m = IDENT.slice();
    this.stack = [];
    this.defs = [];
    this.body = [];
    this.path = [];
    this.props = {
      fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineJoin: 'miter', lineCap: 'butt',
      dash: [], font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
      shadowColor: 'transparent', shadowBlur: 0, shadowOffsetY: 0, globalAlpha: 1
    };
    this._grad = {};
  }

  // ---- 样式 ----
  set fillStyle(v) { this.props.fillStyle = v; }
  get fillStyle() { return this.props.fillStyle; }
  set strokeStyle(v) { this.props.strokeStyle = v; }
  get strokeStyle() { return this.props.strokeStyle; }
  set lineWidth(v) { this.props.lineWidth = v; }
  get lineWidth() { return this.props.lineWidth; }
  set lineJoin(v) { this.props.lineJoin = v; }
  get lineJoin() { return this.props.lineJoin; }
  set lineCap(v) { this.props.lineCap = v; }
  get lineCap() { return this.props.lineCap; }
  set font(v) { this.props.font = v; }
  get font() { return this.props.font; }
  set textAlign(v) { this.props.textAlign = v; }
  get textAlign() { return this.props.textAlign; }
  set textBaseline(v) { this.props.textBaseline = v; }
  get textBaseline() { return this.props.textBaseline; }
  set shadowColor(v) { this.props.shadowColor = v; }
  get shadowColor() { return this.props.shadowColor; }
  set shadowBlur(v) { this.props.shadowBlur = v; }
  get shadowBlur() { return this.props.shadowBlur; }
  set shadowOffsetY(v) { this.props.shadowOffsetY = v; }
  get shadowOffsetY() { return this.props.shadowOffsetY; }
  set shadowOffsetX(v) { /* 预览忽略 */ }
  set globalAlpha(v) { this.props.globalAlpha = v; }
  get globalAlpha() { return this.props.globalAlpha; }

  // ---- 变换 ----
  save() { this.stack.push({ m: this.m.slice(), p: Object.assign({}, this.props), clip: this._clip }); }
  restore() { const s = this.stack.pop(); if (s) { this.m = s.m; this.props = s.p; this._clip = s.clip; } }
  translate(x, y) { this.m = mul(this.m, [1, 0, 0, 1, x, y]); }
  rotate(a) { const c = Math.cos(a), s = Math.sin(a); this.m = mul(this.m, [c, s, -s, c, 0, 0]); }
  scale(x, y) { this.m = mul(this.m, [x, 0, 0, y, 0, 0]); }
  setTransform(a, b, c, d, e, f) { this.m = [a, b, c, d, e, f]; }
  setLineDash(d) { this.props.dash = d || []; }

  // ---- 路径 ----
  beginPath() { this.path = []; this._cur = null; }
  closePath() { this.path.push('Z'); }
  moveTo(x, y) { this.path.push(`M${x} ${y}`); this._cur = [x, y]; }
  lineTo(x, y) { this.path.push(`L${x} ${y}`); this._cur = [x, y]; }
  quadraticCurveTo(cx, cy, x, y) { this.path.push(`Q${cx} ${cy} ${x} ${y}`); this._cur = [x, y]; }
  bezierCurveTo(a, b, c, d, x, y) { this.path.push(`C${a} ${b} ${c} ${d} ${x} ${y}`); this._cur = [x, y]; }
  rect(x, y, w, h) { this.path.push(`M${x} ${y}H${x + w}V${y + h}H${x}Z`); this._cur = [x, y]; }
  /** 圆角矩形靠它（roundRect 用的就是 arcTo）：按两段直线的切点算出圆弧 */
  arcTo(x1, y1, x2, y2, r) {
    const p0 = this._cur;
    if (!p0) { this.lineTo(x1, y1); return; }
    let di = [p0[0] - x1, p0[1] - y1];
    let doo = [x2 - x1, y2 - y1];
    const li = Math.hypot(di[0], di[1]) || 1, lo = Math.hypot(doo[0], doo[1]) || 1;
    di = [di[0] / li, di[1] / li];
    doo = [doo[0] / lo, doo[1] / lo];
    let d = Math.atan2(di[1], di[0]) - Math.atan2(doo[1], doo[0]);
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const t = Math.abs(Math.tan(d / 2)) < 1e-6 ? r : r / Math.abs(Math.tan(d / 2));
    const a = [x1 + di[0] * t, y1 + di[1] * t];
    const b = [x1 + doo[0] * t, y1 + doo[1] * t];
    this.path.push(`L${a[0]} ${a[1]}A${r} ${r} 0 0 ${d > 0 ? 1 : 0} ${b[0]} ${b[1]}`);
    this._cur = b;
  }
  arc(x, y, r, a0, a1, ccw) {
    const raw = a1 - a0;
    const sweep = ((raw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const large = sweep > Math.PI ? 1 : 0;
    const p0 = [x + r * Math.cos(a0), y + r * Math.sin(a0)];
    const p1 = [x + r * Math.cos(a1), y + r * Math.sin(a1)];
    // 整圆：2π 取模后为 0，但始末角其实差了整整一圈 —— 不特判就会画成一条零长弧
    const full = Math.abs(raw) > 1e-6 && sweep < 1e-6;
    if (full) {
      // 整圆：两段半弧（SVG 的 A 画不出闭合整圆）
      this.path.push(`M${x - r} ${y}A${r} ${r} 0 1 0 ${x + r} ${y}A${r} ${r} 0 1 0 ${x - r} ${y}`);
      return;
    }
    this.path.push(`M${p0[0]} ${p0[1]}A${r} ${r} 0 ${large} ${ccw ? 0 : 1} ${p1[0]} ${p1[1]}`);
  }
  ellipse(x, y, rx, ry, rot, a0, a1) {
    const p0 = [x + rx * Math.cos(a0), y + ry * Math.sin(a0)];
    const p1 = [x + rx * Math.cos(a1), y + ry * Math.sin(a1)];
    const deg = Math.round((rot * 180) / Math.PI);
    const raw = a1 - a0;
    const sweep = ((raw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const full = Math.abs(raw) > 1e-6 && sweep < 1e-6;
    if (full) {
      this.path.push(`M${x - rx} ${y}A${rx} ${ry} ${deg} 1 0 ${x + rx} ${y}A${rx} ${ry} ${deg} 1 0 ${x - rx} ${y}`);
      return;
    }
    this.path.push(`M${p0[0]} ${p0[1]}A${rx} ${ry} ${deg} ${sweep > Math.PI ? 1 : 0} 1 ${p1[0]} ${p1[1]}`);
  }

  // ---- 填充 / 描边 ----
  _paint(style) {
    if (style && style instanceof Gradient) { this.defs.push(style.def()); return `url(#${style.id})`; }
    return esc(style);
  }
  _attrs(kind) {
    const p = this.props;
    const a = [`${kind}="${this._paint(kind === 'fill' ? p.fillStyle : p.strokeStyle)}"`];
    if (kind === 'stroke') {
      a.push(`stroke-width="${p.lineWidth}"`, `stroke-linejoin="${p.lineJoin}"`, `stroke-linecap="${p.lineCap}"`);
      if (p.dash && p.dash.length) a.push(`stroke-dasharray="${p.dash.join(' ')}"`);
    }
    if (p.globalAlpha !== 1) a.push(`opacity="${p.globalAlpha}"`);
    return a.join(' ');
  }
  _wrap(content) {
    const t = mxStr(this.m);
    const clipId = this._clip;
    const g = `<g transform="${t}"${clipId ? ` clip-path="url(#${clipId})"` : ''}>${content}</g>`;
    this.body.push(g);
  }
  fill() {
    if (!this.path.length) return;
    const d = this.path.join('');
    // 投影：近似成 SVG 的 drop-shadow（只在有阴影时挂，别给每条路径都上 filter）
    const p = this.props;
    const sh = p.shadowColor && p.shadowColor !== 'transparent' && p.shadowBlur > 0
      ? ` filter="url(#sh${this.defs.push(
        `<filter id="sh${this.defs.length}" x="-30%" y="-30%" width="180%" height="180%">` +
        `<feDropShadow dx="0" dy="${p.shadowOffsetY}" stdDeviation="${p.shadowBlur / 2.6}" flood-color="${esc(p.shadowColor)}"/></filter>`) - 1})"`
      : '';
    this._wrap(`<path d="${d}" ${this._attrs('fill')}${sh}/>`);
  }
  stroke() {
    if (!this.path.length) return;
    this._wrap(`<path d="${this.path.join('')}" fill="none" ${this._attrs('stroke')}/>`);
  }
  fillRect(x, y, w, h) {
    const p = this.props;
    const op = p.globalAlpha !== 1 ? ` opacity="${p.globalAlpha}"` : '';
    this._wrap(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${this._paint(p.fillStyle)}"${op}/>`);
  }
  strokeRect(x, y, w, h) {
    this._wrap(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" ${this._attrs('stroke')}/>`);
  }
  clearRect() { /* 预览忽略 */ }
  clip() {
    const id = 'c' + (this.defs.push(`<clipPath id="c${this.defs.length}"><path d="${this.path.join('')}"/></clipPath>`) - 1);
    this._clip = id;
  }

  // ---- 文字 ----
  fillText(text, x, y) {
    const p = this.props;
    const m = /(\d+(?:\.\d+)?)px/.exec(p.font);
    const size = m ? Number(m[1]) : 10;
    const weight = /\b(?:bold|[6-9]00)\b/.test(p.font) ? ' font-weight="700"' : '';
    const italic = /italic/.test(p.font) ? ' font-style="italic"' : '';
    const anchor = p.textAlign === 'center' ? 'middle' : (p.textAlign === 'right' || p.textAlign === 'end' ? 'end' : 'start');
    this._wrap(`<text x="${x}" y="${y}" font-size="${size}"${weight}${italic} text-anchor="${anchor}" ` +
      `font-family="'Noto Sans CJK SC','Microsoft YaHei',sans-serif" fill="${this._paint(p.fillStyle)}">${esc(text)}</text>`);
  }
  measureText(text) {
    const m = /(\d+(?:\.\d+)?)px/.exec(this.props.font);
    return { width: measure(text, m ? Number(m[1]) : 10) };
  }

  // ---- 渐变 / 图片 ----
  createLinearGradient(x0, y0, x1, y1) { return new Gradient('linear', [x0, y0, x1, y1], this.m.slice()); }
  createRadialGradient(x0, y0, r0, x1, y1, r1) { return new Gradient('radial', [x0, y0, r0, x1, y1, r1], this.m.slice()); }
  /** drawImage 记成占位框（预览里照片位是空的，正好看出让位对不对） */
  drawImage(img, x, y, w, h) {
    if (typeof x !== 'number') return;
    const args = Array.prototype.slice.call(arguments, 1);
    const [dx, dy, dw, dh] = args.length >= 4 ? args.slice(-4) : [args[0], args[1], img.width, img.height];
    this._wrap(`<rect x="${dx}" y="${dy}" width="${dw}" height="${dh}" fill="#D8CFBE" opacity="0.9"/>`);
  }

  toSVG() {
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}">\n` +
      `<defs>${this.defs.join('')}</defs>\n${this.body.join('\n')}\n</svg>`;
  }
}

module.exports = { Recorder };
