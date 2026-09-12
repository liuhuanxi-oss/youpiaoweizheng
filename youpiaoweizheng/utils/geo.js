// utils/geo.js —— M4-b 抽公共地理计算（现由 report 页里程使用）
// 纯端上计算，无网络请求。

/** 球面距离 km（哈弗辛公式）。a/b: { latitude, longitude } */
function haversine(a, b) {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * 有坐标票根的累计里程 km（取整）。
 * tickets: 需已按日期排序（足迹的叙事是"按时间走过的地方"）；geo 字段 { lat, lng }
 */
function totalKmOf(sortedTickets) {
  const pts = (sortedTickets || [])
    .filter((t) => t.geo && typeof t.geo.lat === 'number' && typeof t.geo.lng === 'number')
    .map((t) => ({ latitude: t.geo.lat, longitude: t.geo.lng }));
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += haversine(pts[i - 1], pts[i]);
  return Math.round(km);
}

module.exports = { haversine, totalKmOf };
