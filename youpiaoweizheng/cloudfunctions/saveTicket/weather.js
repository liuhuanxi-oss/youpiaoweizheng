// saveTicket/weather.js —— 历史天气查询（Open-Meteo 免费接口，无需密钥）
// 策略：票面日期早于 6 天前 → archive 历史库；6 天内 → forecast 接口（含过去 7 天）。
// 任何失败都静默返回 null，绝不阻塞票根入库。
const https = require('https');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    // 4.18.0 热修：4 秒拿不到就放弃（Open-Meteo 是境外 API，网络挂起时
    // 原 Promise 永不 settle → 拖死云函数触发 -504003 超时）。静默 null，不入库阻塞。
    req.setTimeout(4000, () => req.destroy(new Error('weather timeout')));
  });
}

async function fetchWeather(lat, lng, dateStr) {
  const day = new Date(dateStr.replace(/-/g, '/'));
  const diffDays = (Date.now() - day.getTime()) / 86400000;
  try {
    if (diffDays > 6) {
      // 历史库（ERA5 再分析，滞后约 5 天）
      const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}`
        + `&start_date=${dateStr}&end_date=${dateStr}`
        + `&daily=temperature_2m_mean,weather_code&timezone=auto`;
      const r = await getJSON(url);
      const t = r.daily && r.daily.temperature_2m_mean && r.daily.temperature_2m_mean[0];
      if (t === null || t === undefined) return null;
      return { tempC: Math.round(t), code: r.daily.weather_code[0] };
    } else {
      // 近期日期：forecast 接口带过去 7 天
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
        + `&daily=temperature_2m_mean,weather_code&past_days=7&forecast_days=1&timezone=auto`;
      const r = await getJSON(url);
      if (!r.daily) return null;
      const i = r.daily.time.indexOf(dateStr);
      if (i < 0) return null;
      const t = r.daily.temperature_2m_mean[i];
      if (t === null || t === undefined) return null;
      return { tempC: Math.round(t), code: r.daily.weather_code[i] };
    }
  } catch (e) {
    return null; // 静默：天气只是锦上添花
  }
}

module.exports = { fetchWeather };
