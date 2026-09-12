// utils/mock.js —— M1 演示数据
// M2 起将被云数据库真实数据替换，字段结构即为未来的数据模型，
// 请保持字段命名稳定（city/geo/weather/eventKey 都是 M2 要预埋的字段）。

// 票根类型 → 标签文案
const TYPE_TEXT = { show: '演出', movie: '电影', traffic: '交通' };

// 演示票根（字段结构 = 未来 tickets 表结构）
const tickets = [
  {
    id: 't1',
    type: 'show',
    title: '回春丹巡演 · 武汉站',
    date: '2025-10-26',
    time: '20:00',
    venue: 'VOX Livehouse',
    city: '武汉',                       // M2 起：大模型解析 + 内置城市字典
    geo: { lat: 30.508, lng: 114.39 },  // M2 起：查坐标字典
    seat: 'A区 12排 07座',
    price: 180,
    source: '大麦',
    note: '',
    weather: { tempC: 14, code: 63 },                  // 演示天气（结构与入库存档一致）: 10月底武汉 中雨
    eventKey: 'evt_huiyuechundun_vox_20251026', // 同场偶遇聚合键
    aiCaption: '整晚的音浪退去后，耳朵里还住着那片海。'
  },
  {
    id: 't2',
    type: 'movie',
    title: '隧道尽头',
    date: '2025-10-19',
    time: '15:30',
    venue: '万象影城 5号厅',
    city: '武汉',
    geo: { lat: 30.48, lng: 114.35 },
    seat: '7排 9座',
    price: 45,
    source: '猫眼',
    note: '老票有些褪色',
    weather: { tempC: 18, code: 2 },                   // 10月中旬武汉 多云
    eventKey: 'evt_suidaointou_wanxiang_20251019',
    aiCaption: '黑暗里我们都不说话，光亮起来时都红了眼。'
  },
  {
    id: 't3',
    type: 'traffic',
    title: 'G1758 武汉 → 长沙南',
    date: '2025-09-28',
    time: '09:15',
    venue: '武汉站',
    city: '长沙',
    geo: { lat: 28.15, lng: 112.98 },
    seat: '05车 12F',
    price: 164.5,
    source: '12306',
    note: '',
    weather: { tempC: 22, code: 3 },                   // 9月底长沙 阴
    eventKey: '',
    aiCaption: ''
  },
  {
    id: 't4',
    type: 'show',
    title: '「海边的月亮」中秋特别场',
    date: '2025-09-14',
    time: '20:30',
    venue: 'MAO Livehouse',
    city: '上海',
    geo: { lat: 31.22, lng: 121.46 },
    seat: '内场 018',
    price: 220,
    source: '秀动',
    note: '',
    weather: { tempC: 24, code: 1 },                   // 9月中旬上海 晴间多云
    eventKey: 'evt_haibiandeyueliang_mao_20250914',
    aiCaption: '月亮挂在舞台上方，也挂在每个人摇晃的手臂上。'
  },
  {
    id: 't5',
    type: 'movie',
    title: '花束般的恋爱',
    date: '2025-08-30',
    time: '19:00',
    venue: '百丽宫影城 3号厅',
    city: '上海',
    geo: { lat: 31.23, lng: 121.47 },
    seat: '8排 5座 · 8排 6座',
    price: 90,
    source: '淘票票',
    note: '双人',
    weather: { tempC: 28, code: 0 },                   // 8月底上海 晴
    eventKey: 'evt_huashu_bailigong_20250830',
    aiCaption: '两个人看同一束花，各自看哭又假装没哭。'
  },
  {
    id: 't6',
    type: 'show',
    title: '腰乐队《相见恨晚》巡演',
    date: '2025-08-16',
    time: '21:00',
    venue: '堅果Livehouse',
    city: '长沙',
    geo: { lat: 28.20, lng: 112.97 },
    seat: '预售 036',
    price: 150,
    source: '秀动',
    note: '',
    weather: { tempC: 30, code: 95 },                  // 8月中旬长沙 雷阵雨
    eventKey: 'evt_yao_yaoguo_20250816',
    aiCaption: '相见恨晚的不止乐队，还有散场后的夜风。'
  },
  {
    id: 't7',
    type: 'traffic',
    title: 'C5301 长沙 → 武汉',
    date: '2025-08-04',
    time: '18:40',
    venue: '长沙南站',
    city: '武汉',
    geo: { lat: 30.51, lng: 114.42 },
    seat: '03车 08A',
    price: 164.5,
    source: '12306',
    note: '',
    weather: { tempC: 31, code: 0 },                   // 8月初武汉 盛夏晴
    eventKey: '',
    aiCaption: ''
  },
  {
    id: 't8',
    type: 'show',
    title: 'keys 玩团 · 秋日巡游',
    date: '2024-10-27',
    time: '20:00',
    venue: '坚果Livehouse',
    city: '武汉',
    geo: { lat: 28.21, lng: 112.94 },
    seat: 'A区 03排 05座',
    price: 120,
    source: '大麦',
    note: '',
    weather: { tempC: 15, code: 3 },                   // 去年10月底武汉 阴
    eventKey: 'evt_keys_yaoguo_20241027',
    aiCaption: '一年后回看，那晚的秋风吹得刚刚好。'
  }
];

// 那年今日（M1 静态演示命中态；M3 起按「月-日」聚合查询）
const timeMachine = {
  hit: true,
  ticketId: 't8',
  label: '那年今日 · 2024.10.27',
  title: 'keys 玩团 · 秋日巡游',
  sub: '一年前的今天，你在坚果 Livehouse'
};

// 勋章定义（M4 接入自动触发；当前静态展示。
// 对齐原型「时光勋章 已解锁 4 / 12」的 12 枚盘子 + 4.17.0 拉新新增第 13 枚「时光同谋」，
// 演示数据诚实解锁 1 枚）
// v7.0：icon 字段从 emoji 改为 utils/icons.js 的图标名。
//   原因同上——emoji 是彩色位图，三端造型不一，且无法随主题置灰；
//   改成图标名后由 utils/badges.js + 页面用 iconSrc() 编译成实色 SVG。
const badges = [
  { id: 'b1', icon: 'ticket', name: '第一张票', desc: '万事开头', unlocked: true },
  { id: 'b2', icon: 'music', name: '十场现场', desc: '还差 6 场', unlocked: false },
  { id: 'b3', icon: 'sparkle', name: '跨年现场', desc: '在歌声中跨年', unlocked: false },
  { id: 'b4', icon: 'users', name: '双人同行', desc: '绑定搭档', unlocked: false },
  { id: 'b5', icon: 'film', name: '观影百部', desc: '还差 98 部', unlocked: false },
  { id: 'b6', icon: 'pin', name: '十城之路', desc: '还差 7 座', unlocked: false },
  { id: 'b7', icon: 'moon', name: '深夜场', desc: '散场已是凌晨', unlocked: false },
  { id: 'b8', icon: 'train', name: '环线旅人', desc: '十次远行', unlocked: false },
  { id: 'b9', icon: 'disc', name: '返场狂人', desc: '同一乐队三见', unlocked: false },
  { id: 'b10', icon: 'map', name: '巡游五城', desc: '五城观演', unlocked: false },
  { id: 'b11', icon: 'share', name: '时光信使', desc: '分享 10 张卡片', unlocked: false },
  { id: 'b12', icon: 'compass', name: '足迹地图', desc: '点亮 3 座城市', unlocked: false },
  // 4.17.0 M2 拉新勋章：邀请是双人情谊的自然延伸，不诱导（分享本身已是行为门槛）
  { id: 'b13', icon: 'heart', name: '时光同谋', desc: '把双人空间分享给 TA', unlocked: false }
];

// M4.9.6：演示票 id 集合（云模式下兜底展示的是这批票，
// 对它们做「写」操作必须走本地覆盖层，不能碰云库——-502005 的教训）
const MOCK_IDS = tickets.map((t) => String(t.id));

module.exports = { TYPE_TEXT, tickets, timeMachine, badges, MOCK_IDS };
