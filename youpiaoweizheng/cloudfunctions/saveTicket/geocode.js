// saveTicket/geocode.js —— 4.18.1 场馆级定位（腾讯位置服务 place search）
// ============================================================
// 为什么：城市字典只有城市中心（市级精度），足迹地图放大后 pin 偏离场馆
//        （如「南京」中心距奥体中心约 8-10km）。本模块按「场馆名 + 限定同城」
//        检索 POI，把坐标精化到场馆级。
// key 申请：lbs.qq.com → 控制台 → 应用管理 → 创建应用 → 添加 Key →
//          勾选「WebServiceAPI」（域名白名单可留空，云函数调用不受限）。
// 策略：keyword=场馆名原文，boundary=region(城市) 防同名场馆串城市；
//       4 秒超时护栏（教训见 weather.js——境外/慢网请求绝不拖死入库）；
//       key 留空 → 通道整体禁用，调用方落回城市中心坐标，链路不断。
// ============================================================
const https = require('https');

// ★★★ 腾讯位置服务 Key（填入后自动启用场馆级定位；留空 = 只用城市中心）★★★
let LBS_KEY = '7XKBZ-GU3LJ-3L2FJ-FNNTN-B42U5-VIF4G';

/** 运行时注入 key（测试用；线上直接填上方常量即可） */
function setLbsKey(k) { LBS_KEY = String(k || '').trim(); }

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
    req.setTimeout(4000, () => req.destroy(new Error('geocode timeout')));
  });
}

/** 场馆名 → 精确坐标 {lat,lng}（GCJ-02）；未配 key / 参数缺失 / 失败 → null（调用方落回城市中心） */
async function geocodeVenue(city, venue) {
  if (!LBS_KEY || !venue || !city) return null;
  try {
    const q =
      'keyword=' + encodeURIComponent(String(venue).replace(/\s+/g, '').slice(0, 40)) +
      '&boundary=' + encodeURIComponent(`region(${String(city).replace(/\s+/g, '').slice(0, 20)},0)`) +
      '&page_size=1&page_index=1' +
      '&key=' + LBS_KEY;
    const r = await getJSON('https://apis.map.qq.com/ws/place/v1/search?' + q);
    const hit = r && r.status === 0 && r.data && r.data[0];
    if (!hit || !hit.location || typeof hit.location.lat !== 'number') return null;
    return { lat: hit.location.lat, lng: hit.location.lng };
  } catch (e) {
    return null; // 静默：场馆级是精化层，失败不影响入库
  }
}

module.exports = { geocodeVenue, setLbsKey, LBS_KEY: () => LBS_KEY };
