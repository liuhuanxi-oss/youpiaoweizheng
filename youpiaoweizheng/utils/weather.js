// utils/weather.js —— V1.5 天气记忆 UI 的端上公共模块
// 数据来源：云函数入库时经 Open-Meteo 静默存档的 { tempC, code }（WMO 天气码）。
// 诚实原则：weather 为 null 的票根（历史失败/旧记录）一律不显示，不造假。

/** WMO 天气码 → { text, icon }（Open-Meteo 标准码表精简版） */
const WMO = {
  0: ['晴', '☀️'],
  1: ['晴间多云', '🌤'],
  2: ['多云', '⛅'],
  3: ['阴', '☁️'],
  45: ['雾', '🌫'],
  48: ['雾凇', '🌫'],
  51: ['毛毛雨', '🌦'],
  53: ['毛毛雨', '🌦'],
  55: ['浓毛毛雨', '🌦'],
  56: ['冻毛毛雨', '🌧'],
  57: ['冻毛毛雨', '🌧'],
  61: ['小雨', '🌧'],
  63: ['中雨', '🌧'],
  65: ['大雨', '🌧'],
  66: ['冻雨', '🌧'],
  67: ['冻雨', '🌧'],
  71: ['小雪', '❄️'],
  73: ['中雪', '❄️'],
  75: ['大雪', '❄️'],
  77: ['雪粒', '❄️'],
  80: ['阵雨', '🌦'],
  81: ['阵雨', '🌦'],
  82: ['强阵雨', '⛈'],
  85: ['阵雪', '🌨'],
  86: ['阵雪', '🌨'],
  95: ['雷阵雨', '⛈'],
  96: ['雷雨伴冰雹', '⛈'],
  99: ['雷雨伴冰雹', '⛈']
};

/**
 * 天气记录 → 展示文本
 * @param {Object} w { tempC, code }
 * @returns {String} 「🌧 小雨 · 14°C」；无效输入返回 ''（调用方 wx:if 隐藏）
 */
function weatherText(w) {
  if (!w || typeof w.tempC !== 'number' || typeof w.code !== 'number') return '';
  const m = WMO[w.code];
  if (!m) return '';
  return `${m[1]} ${m[0]} · ${w.tempC}°C`;
}

/**
 * 天气记录 → AI 文案提示语（generateCaption 融合感官细节用）
 * @returns {String} 无效天气返回 ''（prompt 不加天气段）
 */
function weatherHint(w) {
  if (!w || typeof w.tempC !== 'number' || typeof w.code !== 'number') return '';
  const m = WMO[w.code];
  if (!m) return '';
  const feel = w.tempC <= 5 ? '微寒' : w.tempC <= 14 ? '微凉' : w.tempC >= 30 ? '闷热' : '';
  return `当晚${m[0]}、约${w.tempC}°C${feel ? '，体感' + feel : ''}。` +
    `可以在文案里自然融入一两个感官细节（雨声、风、温度感），但不要生硬罗列数据。`;
}

module.exports = { weatherText, weatherHint };
