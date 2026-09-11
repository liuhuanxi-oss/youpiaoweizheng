// components/svg-icon/index.js —— V3 线性图标组件（image + 上色 data-uri SVG）
// V2 用 CSS mask 渲染 currentColor，在部分真机 WebView 上退化为实心方块（4.10 已整组回退）。
// V3 改走官方 image 组件：image 原生支持 SVG（JPG/PNG/SVG/WEBP/GIF），
// 颜色在拼 SVG 时按主题写进 stroke，不再依赖 mask / currentColor。
// path 基准沿用 V2：24×24 网格、stroke 1.5、round 端点/连接、fill none。
// ⚠ 4.11.0 仅单点试点（detail 页 AI 文案区），真机验证通过后再考虑全量替换。
const P = (d) => '<path d="' + d + '"/>';
const ICONS = {
  ticket: P('M4.5 6.5h15a1 1 0 0 1 1 1v2.1a2.2 2.2 0 0 0 0 3.8v2.1a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-2.1a2.2 2.2 0 0 0 0-3.8V7.5a1 1 0 0 1 1-1Z') + P('M13.2 6.5v2.4M13.2 15.1v2.4'),
  'camera-retro': P('M4 8.5h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5Z M8 8.5 9.6 6h4.8L16 8.5 M12 10.2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z M6.6 11.5v3.4M17.4 11.5v3.4'),
  feather: P('M19.8 4.2a3 3 0 0 0-4.2 0L6.5 13.3 5.5 18.5l5.2-1L19.8 8.4a3 3 0 0 0 0-4.2Z M9.6 15.4l-.7.7'),
  bookmark: P('M7 4.5h10a1 1 0 0 1 1 1v14l-6-4-6 4v-14a1 1 0 0 1 1-1Z'),
  envelope: P('M4.5 7a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V7Z M5 8l7 5.5L19 8'),
  stamp: P('M12 3.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Z M12 7.4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2Z M12 9.9l1.3 2.6 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4Z'),
  compass: P('M12 3.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Z M14.8 9.2l-1.9 3.7-3.7 1.9 1.9-3.7Z'),
  moon: P('M19.6 13.8A7.6 7.6 0 1 1 10.2 4.4a6 6 0 0 0 9.4 9.4Z M6.8 6.8h.01M17.2 17.2h.01'),
  heart: P('M12 19.6C7.2 16.2 4.2 13.4 4.2 9.8A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.8 2.6c0 3.6-3 6.4-7.8 9.8Z'),
  album: P('M5.5 5h13a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z M8.5 5v14 M12 9.5h4M12 12.5h3'),
  'map-folded': P('M4.5 6 9 4l6 2 4.5-1.8V18L15 19.8 9 17.8l-4.5 1.6Z M9 4v13.8M15 6v13.8'),
  gramophone: P('M4.5 9.5c4.8-.4 8.6 2.6 12.4 8.4 M4.5 9.5c3.4 5 3.4 8.8-1.4 11.2 M8 17.5l9.4 2.8 M14.5 19.6 13.5 21.5h-4'),
  'film-strip': P('M4.5 5.5h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z M7.5 5.5v13M16.5 5.5v13 M7.5 9h1.6M7.5 12h1.6M7.5 15h1.6M14.9 9h1.6M14.9 12h1.6M14.9 15h1.6'),
  train: P('M5 15V9.5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3V15 M9 6.5V4.5h6v2 M12 11v3') + P('M8 16.5h.01M16 16.5h.01'),
  trophy: P('M8.5 4.5h7V8a3.5 3.5 0 0 1-7 0V4.5Z M8.5 6.5H6.8a1.5 1.5 0 0 0 0 3H9 M15.5 6.5h1.7a1.5 1.5 0 0 1 0 3H15 M10.5 15.5h3 M12 12v3.5 M8.5 19.5h7'),
  'users-two': P('M9 4.6a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z M5 18.2c.4-3.2 1.9-5 4-5s3.6 1.8 4 5 M16.4 5.4a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Z M14.4 15.6c1.8-.9 3.7-1.6 5.2-.8'),
  settings: P('M12 3.6v2.6M12 17.8v2.6M3.6 12h2.6M17.8 12h2.6M6.3 6.3l1.9 1.9M15.8 15.8l1.9 1.9M17.7 6.3l-1.9 1.9M8.2 15.8l-1.9 1.9') + P('M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z'),
  search: P('M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z M15.8 15.8l4.7 4.7'),
  plus: P('M12 5.5v13M5.5 12h13'),
  trash: P('M5.5 7h13 M9 7V5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7 M7.2 7l1 13h7.6l1-13 M10.2 10.5v6.5M13.8 10.5v6.5'),
  star: P('M12 4l2.1 4.5 5 .6-3.6 3.5.9 4.9-4.4-2.4-4.4 2.4.9-4.9L4.9 9.1l5-.6Z'),
  fire: P('M12 3.2c.7 3.7-2.3 5.6-2.3 8.2a2.5 2.5 0 0 0 5 0c0-1.4-.7-2.3-1.2-3 .9 2.7-.1 5-2 6.7'),
  mic: P('M9 3.5h6v10a3 3 0 0 1-6 0V3.5Z M5.5 11.5a6.5 6.5 0 0 0 13 0 M12 18v3M8.5 21h7'),
  pin: P('M12 20.5S5.5 15.3 5.5 10.5a6.5 6.5 0 0 1 13 0c0 4.8-6.5 10-6.5 10Z') + P('M12 11h.01'),
  lock: P('M5.5 10.5h13v9a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1Z M8 10.5V8a4 4 0 0 1 8 0v2.5 M12 14.5v2'),
  share: P('M4 11.5v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7 M12 15.5V4.5 M8 7.5 12 3.5l4 4'),
  calendar: P('M4.5 6.5h15a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1Z M4.5 10.5h15 M8.5 4v3M15.5 4v3'),
  link: P('M9.5 14.5 14.5 9.5 M7.2 12.9 5 15.1a3.6 3.6 0 0 0 5.1 5.1l2.2-2.2 M16.8 11.1 19 8.9A3.6 3.6 0 0 0 13.9 3.8l-2.2 2.2')
};

// 与 app.wxss 三主题 token 同值。组件属性吃不到 CSS 变量，SVG 的 stroke 必须是具体色值。
const THEME_COLOR = {
  a: { ink: '#2C2C2C', accent: '#C4623A' },
  b: { ink: '#F0EDE8', accent: '#FF6B9D' },
  c: { ink: '#5A4E42', accent: '#95B088' }
};

function svgData(name, stroke) {
  const body = ICONS[name] || ICONS.ticket;
  // 只放行十六进制色值字符，防注入/防误传 CSS 变量（SVG 属性不认 var()）
  const safe = String(stroke || '#2C2C2C').replace(/[^#0-9a-zA-Z]/g, '');
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='" + safe + "' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'>" + body + '</svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

Component({
  properties: {
    name: { type: String, value: 'ticket' },
    size: { type: Number, value: 36 },        // rpx
    theme: { type: String, value: 'a' },      // a | b | c（对齐页面 data.theme）
    tone: { type: String, value: 'accent' },  // ink | accent
    color: { type: String, value: '' }        // 显式十六进制色值，优先于 theme/tone
  },
  data: { src: '' },
  observers: {
    'name, theme, tone, color'() { this.update(); }
  },
  lifetimes: {
    attached() { this.update(); }
  },
  methods: {
    update() {
      const t = THEME_COLOR[this.data.theme] || THEME_COLOR.a;
      const stroke = this.data.color || t[this.data.tone] || t.accent;
      this.setData({ src: svgData(this.data.name, stroke) });
    }
  }
});
