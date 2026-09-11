1	// saveTicket/index.js —— 入库云函数
2	// 职责：补齐服务端字段（openid/createdAt/eventKey/weather）→ 写入 tickets 集合。
3	// 前端传入：{ ticket }（确认页编辑后的字段）
4	// 返回：{ ok, _id }
5	const cloud = require('wx-server-sdk');
6	const crypto = require('crypto');
7	cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
8	
9	const { fetchWeather } = require('./weather.js');
10	const { lookupCity } = require('./citydict.js'); // 4.18.0 P0：城市静态坐标配对
11	const { geocodeVenue } = require('./geocode.js'); // 4.18.1：场馆级精化（配 LBS key 启用）
12	const { generateArt } = require('./artRestyle.js'); // 4.19.0：票根博物志 AI 重绘（GCJ-02 城市中心）
13	const pay = require('./pay.js'); // 4.20.0：虚拟支付（签名/code2Session/额度/错误码）
14	
15	/** 规范化场次键：同一场演出 = 同一场馆 + 同一日期（同场偶遇的聚合键） */
16	function makeEventKey(venue, date) {
17	  if (!venue || !date) return '';
18	  const s = `${venue.replace(/\s+/g, '')}|${date}`.toLowerCase();
19	  return 'evt_' + crypto.createHash('md5').update(s).digest('hex').slice(0, 16);
20	}
21	
22	/** 集合不存在时自动创建（免去手动建集合步骤，幂等可重试） */
23	async function ensureCollection(db, name) {
24	  try {
25	    await db.collection(name).count();
26	  } catch (e) {
27	    try {
28	      await db.createCollection(name);
29	    } catch (e2) {
30	      // 已存在/权限问题不阻塞，交由后续 add 的真实报错兜底
31	    }
32	  }
33	}
34	
35	/** 内容安全检测内部实现：pass 通过 / risky 拦截 / error 服务异常（调用方定策略） */
36	async function secCheck(openid, content) {
37	  try {
38	    const res = await cloud.openapi.security.msgSecCheck({
39	      openid,
40	      scene: 2,
41	      version: 2,
42	      content: String(content || '').slice(0, 2500)
43	    });
44	    const suggest = res && res.result && res.result.suggest;
45	    if (suggest === 'pass') return { result: 'pass', msg: '' };
46	    return { result: 'risky', msg: suggest === 'risky' ? '内容有违规风险' : '内容未通过安全检查' };
47	  } catch (e) {
48	    if (e && (e.errCode === 87014 || /87014/i.test(String(e.errMsg || '')))) {
49	      return { result: 'risky', msg: '内容含违规风险' };
50	    }
51	    return { result: 'error', msg: '安全检查服务异常' };
52	  }
53	}
54	
55	/** 内容安全校验（action 路由复用 secCheck，避免新增云函数的部署成本） */
56	async function checkTextAction(event, OPENID) {
57	  const content = String(event.content || '').trim().slice(0, 2500);
58	  if (!content) return { ok: false, msg: '内容为空' };
59	  const r = await secCheck(OPENID, content);
60	  if (r.result === 'pass') return { ok: true };
61	  if (r.result === 'risky') return { ok: false, msg: r.msg + '，换一句试试' };
62	  return { ok: false, msg: '安全检查服务异常，请稍后再试' };
63	}
64	
65	/**
66	 * M4.9.6：AI 文案持久化（action 路由）
67	 * 为什么不前端直连 update：tickets 集合在第一张票入库前并不存在，
68	 * 前端直连会报 -502005 database collection not exists；
69	 * 服务端 ensureCollection 自动建集合 + where 校验归属，一步自愈。
70	 */
71	async function setCaptionAction(event, OPENID) {
72	  const id = String(event.id || '').trim();
73	  const caption = String(event.caption || '').trim().slice(0, 500);
74	  if (!id || !caption) return { ok: false, msg: '参数缺失' };
75	  try {
76	    const db = cloud.database();
77	    await ensureCollection(db, 'tickets');
78	    // _openid 双保险：只能改自己的票（云函数端是管理员权限，必须自己限权）
79	    const res = await db.collection('tickets')
80	      .where({ _id: id, _openid: OPENID })
81	      .update({ data: { aiCaption: caption } });
82	    if (!res.stats || res.stats.updated === 0) {
83	      return { ok: false, msg: '票根不存在或不属于你' };
84	    }
85	    return { ok: true };
86	  } catch (e) {
87	    return { ok: false, msg: '文案保存失败：' + (e.message || 'unknown') };
88	  }
89	}
90	
91	/**
92	 * 4.14.0：组内拖拽排序（action 路由）
93	 * 前端整理模式下整组重排后调用；orders = [{id, sortAt}]（同组全量，组内严格有序）。
94	 * 复用 setCaptionAction 的自愈模式：ensureCollection + _openid 归属校验。
95	 */
96	async function reorderAction(event, OPENID) {
97	  const orders = Array.isArray(event.orders) ? event.orders.slice(0, 200) : [];
98	  if (!orders.length) return { ok: false, msg: '缺少排序数据' };
99	  try {
100	    const db = cloud.database();
101	    await ensureCollection(db, 'tickets');
102	    let updated = 0;
103	    for (const o of orders) {
104	      const id = String(o.id || '').trim();
105	      const sortAt = Number(o.sortAt) || 0;
106	      if (!id || !sortAt) continue;
107	      const res = await db.collection('tickets')
108	        .where({ _id: id, _openid: OPENID })
109	        .update({ data: { sortAt } });
110	      updated += (res.stats && res.stats.updated) || 0;
111	    }
112	    return { ok: true, updated };
113	  } catch (e) {
114	    return { ok: false, msg: '排序保存失败：' + (e.message || 'unknown') };
115	  }
116	}
117	
118	// ============================================================
119	// 4.16.0 组间排序（月份章节顺序）：prefs 集合按用户 upsert
120	// 文档结构：{ _openid, type:'groupOrder', labels:[月份label有序数组], updatedAt }
121	// ============================================================
122	async function reorderGroupsAction(event, OPENID) {
123	  const labels = (Array.isArray(event.labels) ? event.labels : [])
124	    .map((s) => String(s || '').trim().slice(0, 24))
125	    .filter(Boolean)
126	    .slice(0, 60);
127	  if (!labels.length) return { ok: false, msg: '缺少章节顺序数据' };
128	  try {
129	    const db = cloud.database();
130	    await ensureCollection(db, 'prefs');
131	    const col = db.collection('prefs');
132	    const found = await col.where({ _openid: OPENID, type: 'groupOrder' }).limit(1).get();
133	    const updatedAt = Date.now();
134	    if (found.data && found.data.length) {
135	      await col.doc(found.data[0]._id).update({ data: { labels, updatedAt } });
136	    } else {
137	      await col.add({ data: { _openid: OPENID, type: 'groupOrder', labels, updatedAt } });
138	    }
139	    return { ok: true, count: labels.length };
140	  } catch (e) {
141	    return { ok: false, msg: '章节顺序保存失败：' + (e.message || 'unknown') };
142	  }
143	}
144	
145	/** 读取章节顺序：失败/未设置返回空数组（默认日期序），不阻塞首页 */
146	async function getGroupOrderAction(OPENID) {
147	  try {
148	    const db = cloud.database();
149	    const res = await db.collection('prefs')
150	      .where({ _openid: OPENID, type: 'groupOrder' })
151	      .limit(1)
152	      .get();
153	    return { ok: true, labels: (res.data && res.data[0] && res.data[0].labels) || [] };
154	  } catch (e) {
155	    return { ok: true, labels: [] };
156	  }
157	}
158	
159	// ============================================================
160	// 4.17.0 M1 海报带码：生成小程序码（全局一份，云存储 + prefs 缓存 fileID）
161	// scene='b=poster'：扫码进入后 app.js 场景埋点可见，可区分海报带来的回流。
162	// getUnlimited 不传 envVersion → 默认 release 码：上线后扫码直达；
163	// 上线前（体验/开发版）扫 release 码会提示版本不存在——属预期，不处理。
164	// ============================================================
165	async function wxacodeAction() {
166	  try {
167	    const db = cloud.database();
168	    // 全局缓存：码与用户无关、永久有效，任何人生成过一次即全员复用
169	    try {
170	      const hit = await db.collection('prefs').where({ type: 'wxacode_poster' }).limit(1).get();
171	      if (hit.data && hit.data[0] && hit.data[0].fileID) {
172	        return { ok: true, fileID: hit.data[0].fileID, cached: true };
173	      }
174	    } catch (e) { /* 缓存读取失败 → 走生成 */ }
175	
176	    const wxa = await cloud.openapi.wxacode.getUnlimited({
177	      scene: 'b=poster',
178	      width: 430
179	    });
180	    // openapi 返回 { buffer } 对象；兜底兼容直接返回 Buffer 的形态
181	    const buf = wxa && wxa.buffer ? wxa.buffer : (Buffer.isBuffer(wxa) ? wxa : null);
182	    if (!buf || !buf.length) return { ok: false, msg: '码生成失败' };
183	
184	    const up = await cloud.uploadFile({
185	      cloudPath: `wxacode/poster-${Date.now()}.png`,
186	      fileContent: buf
187	    });
188	    if (!up || !up.fileID) return { ok: false, msg: '码上传失败' };
189	
190	    try {
191	      await ensureCollection(db, 'prefs');
192	      await db.collection('prefs').add({
193	        data: { type: 'wxacode_poster', fileID: up.fileID, createdAt: Date.now() }
194	      });
195	    } catch (e) { /* 缓存写失败不阻塞（下次重生成，可接受） */ }
196	    return { ok: true, fileID: up.fileID };
197	  } catch (e) {
198	    return { ok: false, msg: '小程序码服务异常：' + String((e && (e.errMsg || e.message)) || e).slice(0, 60) };
199	  }
200	}
201	
202	// ============================================================
203	// 4.18.0 P0 geo 存量回填：老票根只有 city 文本、geo 为 null → 城市字典补坐标。
204	// 4.18.1 升级：回填时优先场馆级精化（geocodeVenue），失败落城市中心；
205	// where 条件改为「geoSource != 'venue'」——城市中心票/无 geo 票都会重刷升级，
206	// 已是场馆级的跳过。只回填 geo 不回填天气（避免逐票 HTTP 超时风险）。
207	// limit 200 分批：多次调用直到返回 filled=0 即回填完毕。
208	// ============================================================
209	async function backfillGeoAction(OPENID) {
210	  try {
211	    const db = cloud.database();
212	    const _ = db.command;
213	    const res = await db.collection('tickets')
214	      .where({ _openid: OPENID, geoSource: _.neq('venue'), city: _.neq('').and(_.neq(null)) })
215	      .limit(200)
216	      .get();
217	    let filled = 0;
218	    for (const doc of res.data || []) {
219	      if (!doc.city) continue; // 双保险：不依赖 where 语义差异
220	      let g = null;
221	      let src = 'city';
222	      if (doc.venue) {
223	        const p = await geocodeVenue(doc.city, doc.venue); // 场馆级优先（未配 key 返回 null）
224	        if (p) { g = p; src = 'venue'; }
225	      }
226	      if (!g) g = lookupCity(doc.city);
227	      if (g) {
228	        await db.collection('tickets').doc(doc._id).update({ data: { geo: g, geoSource: src } });
229	        filled++;
230	      }
231	    }
232	    return { ok: true, scanned: (res.data || []).length, filled };
233	  } catch (e) {
234	    return { ok: false, msg: 'geo 回填失败：' + (e.message || 'unknown') };
235	  }
236	}
237	
238	// ============================================================
239	// 4.19.0 票根博物志：AI 艺术重绘（复古图版）
240	// 异步「启动 + 轮询」模式——生图 10-60s+，前端 callFunction 约 15s 必超时：
241	//   ① artRestyle：建 job(prefs 集合 status=running) → 同步跑生图全程
242	//     （前端会超时断开，但云函数继续执行到完成并回写 job）→ 返回 jobId
243	//   ② artQuery：前端每 4s 轮询 job 状态 → done 拿 fileID / failed 拿 msg
244	// 额度控制在本端（sp_art_quota，每月 3 张免费）；tickets.artVersion 记录最新图版。
245	// ============================================================
246	async function artRestyleAction(event, OPENID) {
247	  const ticketId = String(event.ticketId || '').trim();
248	  if (!ticketId) return { ok: false, msg: '缺少票根 id' };
249	  try {
250	    const db = cloud.database();
251	    await ensureCollection(db, 'prefs');
252	    const col = db.collection('tickets');
253	    // 归属校验 + 必须有照片（重绘主体）
254	    const got = await col.where({ _id: ticketId, _openid: OPENID }).limit(1).get();
255	    const t = got.data && got.data[0];
256	    if (!t) return { ok: false, msg: '票根不存在或不属于你' };
257	    if (!t.img) return { ok: false, msg: '这张票根没有照片，先补一张票根照片' };
258	
259	    // 防重复：同票已有 running 的 job → 直接返回（前端转轮询）
260	    const jobs = db.collection('prefs');
261	    const pend = await jobs.where({ _openid: OPENID, type: 'art_job', ticketId, status: 'running' }).limit(1).get();
262	    if (pend.data && pend.data.length) return { ok: true, queued: true, jobId: pend.data[0]._id };
263	
264	    // 4.20.0 服务端额度校验（权威记账：免费优先 → 付费兜底；前端仅展示）
265	    const spend = await pay.consumeQuota(db, OPENID);
266	    if (!spend.allowed) return { ok: false, quota: spend.quota, code: 'NO_QUOTA', msg: '本月免费额度已用完，可购买图版次数包' };
267	
268	    const job = await jobs.add({
269	      data: { _openid: OPENID, type: 'art_job', ticketId, status: 'running', createdAt: Date.now(), updatedAt: Date.now() }
270	    });
271	
272	    // 同步跑完生图全程（前端已不等）；任何失败回写 job，轮询侧可见
273	    try {
274	      const r = await generateArt(cloud, t.img);
275	      await jobs.doc(job._id).update({ data: { status: 'done', fileID: r.fileID, updatedAt: Date.now() } });
276	      await col.doc(ticketId).update({ data: { artVersion: { fileID: r.fileID, createdAt: Date.now() } } }).catch(() => { /* 记录失败不影响交付 */ });
277	    } catch (e) {
278	      const raw = String((e && e.message) || e);
279	      const msg = /model|not\s*found|permission|ai/i.test(raw)
280	        ? '生成服务暂不可用（需在云开发控制台「AI+」开通生图模型并核对资源包）'
281	        : raw.slice(0, 80);
282	      await jobs.doc(job._id).update({ data: { status: 'failed', msg, updatedAt: Date.now() } }).catch(() => {});
283	      await pay.refundQuota(db, OPENID).catch(() => {}); // 4.20.0 失败返还额度（服务端）
284	    }
285	    // 4.20.0：返回扣减后的额度视图（前端直接刷新显示）
286	    const q = await pay.loadQuota(db, OPENID);
287	    return { ok: true, jobId: job._id, async: true, quota: pay.quotaView(q) };
288	  } catch (e) {
289	    return { ok: false, msg: '图版服务异常：' + String((e && e.message) || e).slice(0, 60) };
290	  }
291	}
292	
293	/** 前端轮询：查该票最新 job 状态（none/running/done/failed） */
294	async function artQueryAction(event, OPENID) {
295	  const ticketId = String(event.ticketId || '').trim();
296	  if (!ticketId) return { ok: false, msg: '缺少票根 id' };
297	  try {
298	    const db = cloud.database();
299	    await ensureCollection(db, 'prefs');
300	    const res = await db.collection('prefs')
301	      .where({ _openid: OPENID, type: 'art_job', ticketId })
302	      .orderBy('createdAt', 'desc')
303	      .limit(1)
304	      .get();
305	    const j = res.data && res.data[0];
306	    if (!j) return { ok: true, status: 'none' };
307	    return { ok: true, status: j.status, fileID: j.fileID || '', msg: j.msg || '' };
308	  } catch (e) {
309	    return { ok: false, msg: '查询失败' };
310	  }
311	}
312	
313	// ============================================================
314	// 4.20.0 授权登录 + 虚拟支付
315	// ------------------------------------------------------------
316	// 登录（拉新推广的用户身份基座 + 支付签名前置）：
317	//   前端 wx.login() 拿 code → authLogin → 服务端 code2Session 换 openid + session_key。
318	//   云开发下 openid 本就由 getWXContext 提供（免登录标识），这里换 session_key 的
319	//   唯一目的：虚拟支付 signature = HMAC-SHA256(sessionKey, signData)。
320	//   session_key 属敏感凭证：只存服务端（prefs type=auth_session），绝不下发前端；
321	//   泄露单独不构成支付伪造风险（paySig 需要服务端 AppKey）。
322	// 支付（wx.requestVirtualPayment，官方文档 2026-09 核对）：
323	//   payCreate → 双签名（paySig=AppKey / signature=sessionKey）→ 前端拉起 →
324	//   微信发货推送 xpay_goods_deliver_notify（消息推送 → 本函数）→ 幂等发货 → 额度到账。
325	// 凭证：config 集合 pay_secret doc（offerId/appKey/appSecret/env），不入代码仓库。
326	// ============================================================
327	
328	/** 授权登录：code → session_key 落库（同时校验 code 归属当前用户，防串号） */
329	async function authLoginAction(event, OPENID) {
330	  const code = String(event.code || '').trim();
331	  if (!code) return { ok: false, msg: '缺少登录 code' };
332	  try {
333	    const db = cloud.database();
334	    const cfg = await pay.loadPayConfig(db);
335	    if (!cfg || !cfg.appSecret) return { ok: false, code: 'NO_CONFIG', msg: '登录服务尚未配置（config 集合缺 pay_secret.appSecret）' };
336	    const r = await pay.code2Session(cloud.getWXContext().APPID, cfg.appSecret, code);
337	    if (!r || r.errcode || !r.openid) {
338	      return { ok: false, msg: '登录校验失败：' + String((r && (r.errmsg || r.errcode)) || '未知'), code: 'WX_ERR' };
339	    }
340	    if (r.openid !== OPENID) return { ok: false, code: 'OPENID_MISMATCH', msg: '登录凭证与当前用户不一致' };
341	    await ensureCollection(db, 'prefs');
342	    const col = db.collection('prefs');
343	    const found = await col.where({ _openid: OPENID, type: 'auth_session' }).limit(1).get();
344	    const data = { sessionKey: r.session_key || '', updatedAt: Date.now() };
345	    if (found.data && found.data[0]) {
346	      await col.doc(found.data[0]._id).update({ data });
347	    } else {
348	      await col.add({ data: { _openid: OPENID, type: 'auth_session', ...data } });
349	    }
350	    return { ok: true };
351	  } catch (e) {
352	    return { ok: false, msg: '登录异常：' + String((e && e.message) || e).slice(0, 60) };
353	  }
354	}
355	
356	/** 读当前用户 session（支付签名用）；缺失/超 7 天视为过期 → 前端应先重新登录 */
357	async function getSession(db, OPENID) {
358	  try {
359	    const res = await db.collection('prefs').where({ _openid: OPENID, type: 'auth_session' }).limit(1).get();
360	    const s = res.data && res.data[0];
361	    if (!s || !s.sessionKey) return null;
362	    if (Date.now() - (s.updatedAt || 0) > 7 * 24 * 3600 * 1000) return null;
363	    return s;
364	  } catch (e) {
365	    return null;
366	  }
367	}
368	
369	/** 下单：组 signData + 双签名（paySig=AppKey / signature=sessionKey）+ 订单入库 */
370	async function payCreateAction(event, OPENID) {
371	  const productId = String(event.productId || '').trim();
372	  const product = pay.PRODUCTS[productId];
373	  if (!product) return { ok: false, msg: '未知的商品' };
374	  try {
375	    const db = cloud.database();
376	    const cfg = await pay.loadPayConfig(db);
377	    if (!cfg) return { ok: false, code: 'NO_CONFIG', msg: '支付尚未配置（config 集合缺 pay_secret：offerId/appKey）' };
378	    const session = await getSession(db, OPENID);
379	    if (!session) return { ok: false, code: 'NEED_LOGIN', msg: '登录态过期，请重新授权登录' };
380	
381	    const signData = JSON.stringify({
382	      offerId: cfg.offerId,
383	      buyQuantity: 1,
384	      env: Number(cfg.env) === 1 ? 1 : 0, // 0 现网 1 沙箱（iOS 不支持沙箱）
385	      currencyType: 'CNY',
386	      productId: productId,
387	      goodsPrice: product.priceFen, // 单位：分（-15003 高发坑）
388	      outTradeNo: pay.makeOutTradeNo(),
389	      attach: JSON.stringify({ openid: OPENID, productId })
390	    });
391	    const outTradeNo = JSON.parse(signData).outTradeNo;
392	    // 官方：沙箱(env=1)与现网(env=0)是两把不同的 AppKey，按下单 env 选对应 key 签 paySig
393	    const paySig = pay.hmacSha256(pay.pickAppKey(cfg, Number(cfg.env) === 1 ? 1 : 0), 'requestVirtualPayment&' + signData);
394	    const signature = pay.hmacSha256(session.sessionKey, signData);
395	    await ensureCollection(db, 'prefs');
396	    await db.collection('prefs').add({
397	      data: {
398	        _openid: OPENID, type: 'pay_order', outTradeNo, productId,
399	        priceFen: product.priceFen, status: 'created', createdAt: Date.now(), updatedAt: Date.now()
400	      }
401	    });
402	    return { ok: true, mode: 'short_series_goods', signData, paySig, signature, outTradeNo };
403	  } catch (e) {
404	    return { ok: false, msg: '下单失败：' + String((e && e.message) || e).slice(0, 60) };
405	  }
406	}
407	
408	/** 查单 + 额度视图（前端支付后轮询确认到账；created 超 60s 触发对账兜底） */
409	async function payQueryAction(event, OPENID) {
410	  try {
411	    const db = cloud.database();
412	    await ensureCollection(db, 'prefs');
413	    let order = null;
414	    const no = String(event.outTradeNo || '').trim();
415	    if (no) {
416	      const res = await db.collection('prefs').where({ _openid: OPENID, type: 'pay_order', outTradeNo: no }).limit(1).get();
417	      order = (res.data && res.data[0]) || null;
418	    }
419	    // —— 4.20.0 对账兜底（官方推荐推送+查单两分支结合，success 回调可能丢失）——
420	    // 本地仍 created、下单超 60s、距上次对账 ≥10s（限频护栏）→ 主动查微信侧真实状态：
421	    //   paid(2/3/4) → 补发货；refunded(5/8) → 标记不发货；查单失败 → 维持 created 不动
422	    if (order && order.status === 'created'
423	      && Date.now() - (order.createdAt || 0) > 60 * 1000
424	      && Date.now() - (order.lastCheckAt || 0) >= 10 * 1000) {
425	      const rec = await reconcileOrder(db, OPENID, order);
426	      if (rec && rec.order) order = rec.order;
427	    }
428	    const q = await pay.loadQuota(db, OPENID);
429	    return { ok: true, order: order ? { outTradeNo: order.outTradeNo, status: order.status } : null, quota: pay.quotaView(q) };
430	  } catch (e) {
431	    return { ok: false, msg: '查询失败' };
432	  }
433	}
434	
435	/**
436	 * 4.22.0 支付后主动确认（「即时到账」核心分支）：
437	 * 收银台 success 后前端立即调用——不再干等微信发货推送，服务端当场查微信侧
438	 * 真实支付状态，paid → 立即发货（幂等）。查单失败/未支付 → 返回 pending，
439	 * 前端落回轮询兜底（发货推送最终也会幂等补发，双保险）。
440	 * 虚拟商品语义：无任何物流环节，确认=发货=次数即时入账。
441	 */
442	async function payConfirmAction(event, OPENID) {
443	  const db = cloud.database();
444	  try {
445	    await ensureCollection(db, 'prefs');
446	    const no = String(event.outTradeNo || '').trim();
447	    if (!no) return { ok: false, msg: '缺订单号' };
448	    const col = db.collection('prefs');
449	    const found = await col.where({ _openid: OPENID, type: 'pay_order', outTradeNo: no }).limit(1).get();
450	    const order = found.data && found.data[0];
451	    if (!order) return { ok: false, code: 'NO_ORDER', msg: '订单不存在' };
452	    if (order.status === 'delivered') { // 幂等：早已到账 → 直接回当前额度（重进/重复确认场景）
453	      const q = await pay.loadQuota(db, OPENID);
454	      return { ok: true, quota: pay.quotaView(q), order: { status: 'delivered' }, delivered: false };
455	    }
456	    if (order.status === 'refunded') return { ok: false, code: 'REFUNDED', msg: '订单已退款' };
457	    if (order.status !== 'created') { // price_mismatch / attach_mismatch / expired 等异常终态
458	      return { ok: false, code: order.status, msg: '订单状态异常，本次不会到账；如有扣款请联系开发者核实' };
459	    }
460	    const cfg = await pay.loadPayConfig(db);
461	    const session = await getSession(db, OPENID);
462	    if (!cfg || !session) return { ok: false, code: 'NEED_LOGIN', msg: '登录态过期' };
463	    // 服务端权威核对：只有微信侧确认 paid 才发货——绝不轻信前端「已支付」声明
464	    const r = await pay.queryOrderOnWx(cloud.getWXContext().APPID, cfg, OPENID, session.sessionKey, no);
465	    if (!r.ok) return { ok: false, code: 'CHECK_FAIL', pending: true, msg: '支付状态确认失败，稍后自动到账' };
466	    if (r.paid) {
467	      const d = await deliverOrder(db, OPENID, no, order.productId, 1, r.paidFee);
468	      const q = await pay.loadQuota(db, OPENID);
469	      return { ok: true, quota: pay.quotaView(q), order: { status: 'delivered' }, delivered: d.delivered };
470	    }
471	    if (r.refunded) {
472	      await col.doc(order._id).update({ data: { status: 'refunded', updatedAt: Date.now() } });
473	      return { ok: false, code: 'REFUNDED', msg: '订单已退款' };
474	    }
475	    // 微信侧明确未支付：下单超 15 分钟 → 关单清理（expired，不影响任何额度）；
476	    // 未超时 → 维持 created（可能仍在支付流程中），由前端轮询继续等待
477	    if (Date.now() - (order.createdAt || 0) > 15 * 60 * 1000) {
478	      await col.doc(order._id).update({ data: { status: 'expired', updatedAt: Date.now() } });
479	      return { ok: false, code: 'EXPIRED', msg: '订单超时未支付已关闭，请重新购买' };
480	    }
481	    return { ok: false, code: 'NOT_PAID', pending: true, msg: '微信侧尚未确认到账' };
482	  } catch (e) {
483	    // 兜底：一切确认异常都不把用户挡在门外——落 pending，让轮询/推送自愈
484	    return { ok: false, code: 'CHECK_FAIL', pending: true, msg: '确认失败，稍后自动到账' };
485	  }
486	}
487	
488	/** 额度视图（art/me 页加载时刷新服务端权威额度）
489	 *  4.22.0 掉单自愈：读额度时顺带对账本人滞留 created 订单（下单>60s 且距上次
490	 *  对账 ≥10s 限频）——支付成功但前端断链/推送延迟的「掉单」，用户下次进入页面
491	 *  静默补发到账，无需任何手动操作。
492	 */
493	async function quotaGetAction(OPENID) {
494	  try {
495	    const db = cloud.database();
496	    await ensureCollection(db, 'prefs');
497	    try {
498	      const pend = await db.collection('prefs')
499	        .where({ _openid: OPENID, type: 'pay_order', status: 'created' })
500	        .limit(3).get();
501	      for (const o of (pend.data || [])) {
502	        if (Date.now() - (o.createdAt || 0) > 60 * 1000
503	          && Date.now() - (o.lastCheckAt || 0) >= 10 * 1000) {
504	          await reconcileOrder(db, OPENID, o); // 内部兜底，不抛；补发/过期都静默落地
505	        }
506	      }
507	    } catch (e) { /* 对账失败不影响额度读取 */ }
508	    const q = await pay.loadQuota(db, OPENID);
509	    return { ok: true, quota: pay.quotaView(q) };
510	  } catch (e) {
511	    return { ok: false, msg: '额度查询失败' };
512	  }
513	}
514	
515	// ============================================================
516	// 4.21.0 激励视频奖励入账（流量主变现：art 付费墙「看视频免费补 1 幅」）
517	// 入账口径：奖励并入 paid 池（consume/refund/quotaView 零改动，扣减顺序免费→付费不变）。
518	// 防刷三道闸：
519	//   ① 每用户每日上限 AD_REWARD_DAILY_LIMIT 次（prefs type='ad_reward' 计数器，北京时间口径）；
520	//   ② 仅登录用户（OPENID 由 getWXContext 注入，前端不可伪造归属）；
521	//   ③ 流量主开通后可升级为微信服务端激励回调（带签名校验），当前为客户端上报 + 日限额兜底，
522	//      单日最大敞口 = 3 幅生图成本，风险可控。
523	// ============================================================
524	const AD_REWARD_DAILY_LIMIT = 3;
525	
526	async function artRewardGrantAction(event, OPENID) {
527	  try {
528	    const db = cloud.database();
529	    await ensureCollection(db, 'prefs');
530	    const col = db.collection('prefs');
531	    const d = new Date();
532	    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
533	    const rec = await col.where({ _openid: OPENID, type: 'ad_reward', ymd }).limit(1).get();
534	    const cur = rec.data && rec.data[0];
535	    const count = (cur && cur.count) || 0;
536	    // 预检模式（check=true）：只读「今天还能看几次」，不扣不奖——付费墙展示用
537	    if (event.check) {
538	      const q0 = await pay.loadQuota(db, OPENID);
539	      return { ok: true, left: Math.max(AD_REWARD_DAILY_LIMIT - count, 0), quota: pay.quotaView(q0) };
540	    }
541	    if (count >= AD_REWARD_DAILY_LIMIT) {
542	      const q = await pay.loadQuota(db, OPENID);
543	      return { ok: false, code: 'LIMIT', msg: '今天看视频补画的机会已经用完，明天再来', quota: pay.quotaView(q), left: 0 };
544	    }
545	    if (cur) {
546	      await col.doc(cur._id).update({ data: { count: count + 1, updatedAt: Date.now() } });
547	    } else {
548	      await col.add({ data: { _openid: OPENID, type: 'ad_reward', ymd, count: 1, updatedAt: Date.now() } });
549	    }
550	    const q = await pay.loadQuota(db, OPENID);
551	    await col.doc(q._id).update({ data: { paid: (q.paid || 0) + 1, updatedAt: Date.now() } });
552	    const after = await pay.loadQuota(db, OPENID);
553	    return { ok: true, quota: pay.quotaView(after), left: AD_REWARD_DAILY_LIMIT - (count + 1) };
554	  } catch (e) {
555	    return { ok: false, msg: '奖励入账失败：' + String((e && e.message) || e).slice(0, 60) };
556	  }
557	}
558	
559	/**
560	 * 公共发货（4.20.0 官方文档精读对照）：payNotify 推送分支与 payQuery 对账分支共用。
561	 * 幂等：订单已 delivered / refunded 直接返回不重复加额度。
562	 * 官方推荐「推送 + 主动查单」两分支至少实现一个、结合更可靠——success 回调可能丢失。
563	 * @returns {{delivered:boolean, reason?:string}}
564	 */
565	async function deliverOrder(db, openid, outTradeNo, productId, quantity, priceFen) {
566	  const product = pay.PRODUCTS[productId];
567	  const col = db.collection('prefs');
568	  const found = await col.where({ _openid: openid, type: 'pay_order', outTradeNo }).limit(1).get();
569	  const order = found.data && found.data[0];
570	  if (order && order.status === 'delivered') return { delivered: false, reason: 'dup' };
571	  if (order && order.status === 'refunded') return { delivered: false, reason: 'refunded' };
572	  const addQuota = (product ? product.quota : 0) * (Number(quantity) || 1);
573	  if (order) {
574	    await col.doc(order._id).update({
575	      data: { status: 'delivered', deliveredAt: Date.now(), quantity: Number(quantity) || 1, updatedAt: Date.now() }
576	    });
577	  } else {
578	    // 兜底：推送先于订单可见（极端时序）→ 落一笔 delivered 记录防丢单
579	    await col.add({
580	      data: {
581	        _openid: openid, type: 'pay_order', outTradeNo, productId,
582	        priceFen: Number(priceFen) || 0, quantity: Number(quantity) || 1,
583	        status: 'delivered', deliveredAt: Date.now(), updatedAt: Date.now()
584	      }
585	    });
586	  }
587	  const q = await pay.loadQuota(db, openid);
588	  await col.doc(q._id).update({ data: { paid: (q.paid || 0) + addQuota, updatedAt: Date.now() } });
589	  return { delivered: true };
590	}
591	
592	/**
593	 * 单笔订单对账（查单兜底分支）：本地仍 created 的订单查微信侧真实状态并落地。
594	 * paid（status 2/3/4）→ deliverOrder 补发货；refunded（5/8）→ 标记不发货；
595	 * 查单失败（签名/session_key 过期 268490009/网络）→ 只更新 lastCheckAt 维持限频，不动状态。
596	 */
597	async function reconcileOrder(db, openid, order) {
598	  try {
599	    const cfg = await pay.loadPayConfig(db);
600	    const session = await getSession(db, openid);
601	    if (!cfg || !session) {
602	      await db.collection('prefs').doc(order._id).update({ data: { lastCheckAt: Date.now() } }).catch(() => {});
603	      return { order };
604	    }
605	    const r = await pay.queryOrderOnWx(cloud.getWXContext().APPID, cfg, openid, session.sessionKey, order.outTradeNo);
606	    if (r.ok && r.paid) {
607	      await deliverOrder(db, openid, order.outTradeNo, order.productId, 1, r.paidFee);
608	      return { order: { ...order, status: 'delivered' }, delivered: true };
609	    }
610	    if (r.ok && r.refunded) {
611	      await db.collection('prefs').doc(order._id).update({ data: { status: 'refunded', updatedAt: Date.now() } });
612	      return { order: { ...order, status: 'refunded' } };
613	    }
614	    // 4.22.0：查单成功但微信侧未支付——下单超 15 分钟 → 关单清理（expired，
615	    // 不留无限滞留的垃圾单）；未超时维持 created（支付流程中）仅刷新限频时间戳。
616	    if (r.ok && !r.paid) {
617	      if (Date.now() - (order.createdAt || 0) > 15 * 60 * 1000) {
618	        await db.collection('prefs').doc(order._id).update({ data: { status: 'expired', updatedAt: Date.now() } });
619	        return { order: { ...order, status: 'expired' } };
620	      }
621	    }
622	    await db.collection('prefs').doc(order._id).update({ data: { lastCheckAt: Date.now() } }).catch(() => {});
623	    return { order };
624	  } catch (e) {
625	    return { order };
626	  }
627	}
628	
629	/** 微信发货推送（消息推送 → 本函数；Event=xpay_goods_deliver_notify）。必须幂等。 */
630	async function payNotifyAction(event) {
631	  // 官方字段语义（2026-09 文档核对）：FromUserName 在道具发货场景固定为微信官方的 openid，
632	  // 用户 openid 在 event.OpenId —— 取错字段会把额度发到错误归属（P0）
633	  const openid = String(event.OpenId || event.FromUserName || '');
634	  const outTradeNo = String(event.OutTradeNo || '');
635	  const goods = event.GoodsInfo || {};
636	  const productId = String(goods.ProductId || '');
637	  const product = pay.PRODUCTS[productId];
638	  if (!openid || !outTradeNo) return { ErrCode: -1, ErrMsg: 'missing openid/outTradeNo' };
639	  try {
640	    const db = cloud.database();
641	    await ensureCollection(db, 'prefs');
642	    const col = db.collection('prefs');
643	    // 幂等对账：订单已发货/已退款 → 直接成功回执（微信重试周期 15s~6h，最多 15 次）
644	    const found = await col.where({ _openid: openid, type: 'pay_order', outTradeNo }).limit(1).get();
645	    const order = found.data && found.data[0];
646	    if (order && order.status === 'delivered') return { ErrCode: 0, ErrMsg: 'ok(dup)' };
647	    if (order && order.status === 'refunded') return { ErrCode: 0, ErrMsg: 'ok(refunded)' };
648	    // 价格校验：ActualPrice 与后台道具价不符 → 不发货不回执成功（微信侧重试/人工排查）
649	    // 未知订单也落 price_mismatch 审计记录（微信重试 15 次都过不了，必须留排查线索）
650	    if (product && Number(goods.ActualPrice) !== product.priceFen) {
651	      if (order) {
652	        await col.doc(order._id).update({ data: { status: 'price_mismatch', updatedAt: Date.now() } });
653	      } else {
654	        await col.add({ data: { _openid: openid, type: 'pay_order', outTradeNo, productId, priceFen: Number(goods.ActualPrice) || 0, status: 'price_mismatch', createdAt: Date.now(), updatedAt: Date.now() } });
655	      }
656	      return { ErrCode: -1, ErrMsg: 'price mismatch' };
657	    }
658	    // 归属校验：下单时 attach 带 openid，推送回带 GoodsInfo.Attach —— 防串单
659	    let attachOk = true;
660	    try {
661	      const at = typeof goods.Attach === 'string' ? JSON.parse(goods.Attach) : (goods.Attach || null);
662	      if (at && at.openid && at.openid !== openid) attachOk = false;
663	    } catch (e) { /* attach 非本系统格式时不拦截 */ }
664	    if (!attachOk) {
665	      if (order) {
666	        await col.doc(order._id).update({ data: { status: 'attach_mismatch', updatedAt: Date.now() } });
667	      } else {
668	        await col.add({ data: { _openid: openid, type: 'pay_order', outTradeNo, productId, priceFen: Number(goods.ActualPrice) || 0, status: 'attach_mismatch', createdAt: Date.now(), updatedAt: Date.now() } });
669	      }
670	      return { ErrCode: -1, ErrMsg: 'attach mismatch' };
671	    }
672	    // 发货（公共函数，payQuery 对账分支复用）：订单置 delivered + 付费额度 += 单件幅数 × 数量
673	    const r = await deliverOrder(db, openid, outTradeNo, productId, goods.Quantity, goods.ActualPrice);
674	    if (!r.delivered) return { ErrCode: 0, ErrMsg: 'ok(' + r.reason + ')' };
675	    return { ErrCode: 0, ErrMsg: 'ok' };
676	  } catch (e) {
677	    console.error('[payNotify] 发货异常：', e);
678	    return { ErrCode: -2, ErrMsg: String((e && e.message) || e).slice(0, 80) }; // 非 0 → 微信重试
679	  }
680	}
681	
682	/**
683	 * 退款推送（Event=xpay_refund_notify）：用户退款成功后回退次数额度。
684	 * 官方字段（2026-09 核对）：OpenId（用户）/ MchOrderId（=原单 outTradeNo）/
685	 * RefundFee（分）/ RetCode（SUCCESS=退款成功）。
686	 * 额度回退：paid -= 单件幅数 × quantity，下探到 0 为止（不产生负数欠账）；
687	 * 只有已发货（delivered）订单才回退——created/mismatch 单从未发出过额度。
688	 */
689	async function payRefundAction(event) {
690	  const openid = String(event.OpenId || '');
691	  const outTradeNo = String(event.MchOrderId || '');
692	  if (!openid || !outTradeNo) return { ErrCode: -1, ErrMsg: 'missing openid/MchOrderId' };
693	  // 退款失败的回调不改变任何状态，回执成功防无意义重推
694	  if (String(event.RetCode || '') !== 'SUCCESS') return { ErrCode: 0, ErrMsg: 'refund not success, ignored' };
695	  try {
696	    const db = cloud.database();
697	    await ensureCollection(db, 'prefs');
698	    const col = db.collection('prefs');
699	    const found = await col.where({ _openid: openid, type: 'pay_order', outTradeNo }).limit(1).get();
700	    const order = found.data && found.data[0];
701	    if (!order) {
702	      // 退款成功是既成事实：本地无单也回执成功防重推，但落审计记录留排查线索
703	      await col.add({
704	        data: { _openid: openid, type: 'pay_order', outTradeNo, productId: '', priceFen: 0, status: 'refund_unknown_order', createdAt: Date.now(), updatedAt: Date.now() }
705	      }).catch(() => {});
706	      return { ErrCode: 0, ErrMsg: 'ok(no order)' };
707	    }
708	    if (order.status === 'refunded') return { ErrCode: 0, ErrMsg: 'ok(dup)' }; // 幂等
709	    await col.doc(order._id).update({
710	      data: { status: 'refunded', refundedAt: Date.now(), refundFee: Number(event.RefundFee) || 0, updatedAt: Date.now() }
711	    });
712	    if (order.status === 'delivered') {
713	      const product = pay.PRODUCTS[order.productId];
714	      const back = ((product && product.quota) || 0) * (Number(order.quantity) || 1);
715	      const q = await pay.loadQuota(db, openid);
716	      await col.doc(q._id).update({ data: { paid: Math.max((q.paid || 0) - back, 0), updatedAt: Date.now() } });
717	    }
718	    return { ErrCode: 0, ErrMsg: 'ok' };
719	  } catch (e) {
720	    console.error('[payRefund] 退款处理异常：', e);
721	    return { ErrCode: -2, ErrMsg: String((e && e.message) || e).slice(0, 80) };
722	  }
723	}
724	
725	/**
726	 * iOS 退款问询推送（Event=xpay_subscribe_ios_refund_query_notify，Apple 消费争议问询）：
727	 * Apple 向用户发起退款问询、微信转发给开发者，3 秒内必须应答（超时=不确定，Apple 自行裁决）。
728	 * 应答体（非 ErrCode 格式）：{ result_code: 0=放过(不反对退款) | 1=拦截(建议不退),
729	 *   result_info: 文字说明, evidence: 证据（必填）}。
730	 * 策略：订单已发货（次数已到账）→ 拦截并附证据；未发货/未知/查询异常 → 放过
731	 *（宁可误放不可误拦——拦错直接影响用户资金与投诉升级）。
732	 */
733	async function payIosRefundQueryAction(event) {
734	  const openid = String(event.OpenId || '');
735	  const outTradeNo = String(event.OutTradeNo || event.MchOrderId || event.pay_order_id || '');
736	  let blocked = false;
737	  let reason = 'deliver not confirmed on our side';
738	  try {
739	    if (openid && outTradeNo) {
740	      const db = cloud.database();
741	      const res = await db.collection('prefs').where({ _openid: openid, type: 'pay_order', outTradeNo }).limit(1).get();
742	      const order = res.data && res.data[0];
743	      if (order && order.status === 'delivered') {
744	        blocked = true;
745	        const at = order.deliveredAt ? new Date(order.deliveredAt).toISOString() : '';
746	        reason = `virtual goods delivered${at ? ' at ' + at : ''}, quota credited to user; order ${order.outTradeNo}`;
747	      }
748	    }
749	  } catch (e) { /* 查询异常按放过处理 */ }
750	  return {
751	    result_code: blocked ? 1 : 0,
752	    result_info: reason,
753	    evidence: JSON.stringify({ openid, outTradeNo, blocked, ts: Date.now() })
754	  };
755	}
756	
757	/** 授权资料读取（拉新推广展示用：昵称 + 头像，均为用户主动授权后写入） */
758	async function profileGetAction(OPENID) {
759	  try {
760	    const db = cloud.database();
761	    await ensureCollection(db, 'prefs');
762	    const res = await db.collection('prefs').where({ _openid: OPENID, type: 'user_profile' }).limit(1).get();
763	    const p = res.data && res.data[0];
764	    return { ok: true, profile: p ? { nickname: p.nickname || '', avatar: p.avatar || '' } : { nickname: '', avatar: '' } };
765	  } catch (e) {
766	    return { ok: false, msg: '资料读取失败' };
767	  }
768	}
769	
770	/** 授权资料保存（昵称走内容安全——后续拉新场景会公开展示） */
771	async function profileSaveAction(event, OPENID) {
772	  const nickname = String(event.nickname || '').trim().slice(0, 24);
773	  const avatar = String(event.avatar || '').trim();
774	  // 4.20.0 头像必须是本环境云存储 fileID（防任意字符串写进展示位）；演示模式前端不持久化
775	  if (avatar && !/^cloud:\/\/[\w-]+\.[\w-]+\//.test(avatar)) {
776	    return { ok: false, msg: '头像地址不合法' };
777	  }
778	  if (!nickname && !avatar) return { ok: false, msg: '没有可保存的资料' };
779	  try {
780	    if (nickname) {
781	      const sc = await secCheck(OPENID, nickname);
782	      if (sc.result === 'risky') return { ok: false, msg: '昵称未通过安全检查：' + sc.msg };
783	    }
784	    const db = cloud.database();
785	    await ensureCollection(db, 'prefs');
786	    const col = db.collection('prefs');
787	    // 4.20.0 只 patch 非空字段：单独改头像不能把昵称清掉（反之亦然）
788	    const patch = { updatedAt: Date.now() };
789	    if (nickname) patch.nickname = nickname;
790	    if (avatar) patch.avatar = avatar;
791	    const found = await col.where({ _openid: OPENID, type: 'user_profile' }).limit(1).get();
792	    if (found.data && found.data[0]) {
793	      await col.doc(found.data[0]._id).update({ data: patch });
794	    } else {
795	      await col.add({ data: { _openid: OPENID, type: 'user_profile', nickname, avatar, ...patch } });
796	    }
797	    return { ok: true };
798	  } catch (e) {
799	    return { ok: false, msg: '资料保存失败：' + String((e && e.message) || e).slice(0, 60) };
800	  }
801	}
802	
803	/** 4.20.3 清除署名资料（profileClear）：删 user_profile 文档——PIPL 删除权呼应。
804	 *  只删昵称+头像展示位，不动票根/额度/订单；幂等（文档不存在也算成功）。 */
805	async function profileClearAction(OPENID) {
806	  try {
807	    const db = cloud.database();
808	    await ensureCollection(db, 'prefs');
809	    const found = await db.collection('prefs').where({ _openid: OPENID, type: 'user_profile' }).limit(1).get();
810	    if (found.data && found.data[0]) {
811	      await db.collection('prefs').doc(found.data[0]._id).remove();
812	    }
813	    return { ok: true };
814	  } catch (e) {
815	    return { ok: false, msg: '资料清除失败：' + String((e && e.message) || e).slice(0, 60) };
816	  }
817	}
818	
819	/** 4.20.4 上线前数据清理（opsCleanup）：清除测试期残留，让库回到「真实、干净」状态。
820	 *  清理范围：tickets 全部（测试票根）· couples 全部（测试绑定）
821	 *            prefs 按 type 清：pay_order（测试订单）/ auth_session（测试会话）/
822	 *            user_profile（测试署名，如「流浪唱片」）/ art_quota（测试额度）/ art_job（生图任务）/ wxacode_poster（码缓存）
823	 *  保留：config 集合（支付凭证，绝不动）· prefs 其余 type（未知用途不碰）。
824	 *  防滥用：必须携带 opsToken = config.pay_secret.appKey（MP 后台虚拟支付页可查），比对一致才执行。
825	 *  触发：开发者工具 → 云开发控制台 → 云函数 saveTicket → 云端测试 → 事件 {"action":"opsCleanup","opsToken":"<appKey>"}
826	 *  幂等：可重复执行，第二遍全 0 即清理干净。 */
827	async function opsCleanupAction(event) {
828	  const db = cloud.database();
829	  // 1. opsToken 校验（复用 pay_secret 的 appKey，不引入新凭据）
830	  let appKey = '';
831	  try {
832	    const res = await db.collection('config').doc('pay_secret').get();
833	    appKey = String((res && res.data && res.data.appKey) || '');
834	  } catch (e) {
835	    return { ok: false, msg: 'config.pay_secret 读取失败（支付凭证未配置？）' };
836	  }
837	  if (!appKey || String(event.opsToken || '') !== appKey) {
838	    return { ok: false, msg: 'opsToken 校验失败：需传 config.pay_secret 的 appKey 字段值' };
839	  }
840	  // 2. 逐范围清理（服务端 where().remove() 为批量删除）
841	  const report = {};
842	  const rm = async (name, where, label) => {
843	    try {
844	      const r = await db.collection(name).where(where).remove();
845	      report[label] = (r.stats && r.stats.removed) || 0;
846	    } catch (e) {
847	      report[label] = 'err: ' + String((e && (e.errMsg || e.message)) || e).slice(0, 80);
848	    }
849	  };
850	  await ensureCollection(db, 'tickets');
851	  await rm('tickets', {}, 'tickets_测试票根');
852	  await rm('couples', {}, 'couples_测试绑定');
853	  const TYPES = ['pay_order', 'auth_session', 'user_profile', 'art_quota', 'art_job', 'wxacode_poster'];
854	  for (const ty of TYPES) {
855	    await rm('prefs', { type: ty }, 'prefs_' + ty);
856	  }
857	  return {
858	    ok: true,
859	    msg: '清理完成。可再跑一遍核对全部为 0；微信侧 xpay 订单记录无法由此清除（沙箱订单不影响现网）',
860	    removed: report,
861	    kept: ['config（支付凭证）', 'prefs 其余类型']
862	  };
863	}
864	
865	/** 4.20.6 上线前只读巡检（opsAudit）：opsCleanup 的配套验收工具——只查不删。
866	 *  返回各集合计数 + config 就绪状态（offerId 掩码、密钥不回显），用于「清理前后对比」验收：
867	 *  清理前跑一次看残留清单 → opsCleanup 清理 → 再跑一次全 0 即验收通过。
868	 *  防滥用：同 opsCleanup（opsToken = config.pay_secret.appKey）。 */
869	async function opsAuditAction(event) {
870	  const db = cloud.database();
871	  let appKey = '';
872	  let offerIdMasked = '(空)';
873	  try {
874	    const res = await db.collection('config').doc('pay_secret').get();
875	    appKey = String((res && res.data && res.data.appKey) || '');
876	    const oid = String((res && res.data && res.data.offerId) || '');
877	    if (oid) offerIdMasked = oid.slice(0, 4) + '****' + (oid.length > 8 ? oid.slice(-4) : '');
878	  } catch (e) {
879	    return { ok: false, msg: 'config.pay_secret 读取失败（支付凭证未配置？）' };
880	  }
881	  if (!appKey || String(event.opsToken || '') !== appKey) {
882	    return { ok: false, msg: 'opsToken 校验失败：需传 config.pay_secret 的 appKey 字段值' };
883	  }
884	  const count = async (name, where) => {
885	    try {
886	      const r = where ? await db.collection(name).where(where).count() : await db.collection(name).count();
887	      return r.total;
888	    } catch (e) {
889	      return 'err';
890	    }
891	  };
892	  const TYPES = ['pay_order', 'auth_session', 'user_profile', 'art_quota', 'art_job', 'wxacode_poster'];
893	  const prefsCounts = {};
894	  for (const ty of TYPES) prefsCounts[ty] = await count('prefs', { type: ty });
895	  return {
896	    ok: true,
897	    msg: '巡检完成（只读不删）。tickets/couples/prefs 各 type 全 0 = 库已干净；pay_secret 就绪 = 支付凭证在位',
898	    config: { pay_secret: '就绪', offerId: offerIdMasked, appKey: '已配置(不回显)', env: '见配置值(0现网/1沙箱)' },
899	    counts: {
900	      tickets: await count('tickets'),
901	      couples: await count('couples'),
902	      prefs_by_type: prefsCounts
903	    },
904	    note: '微信侧 xpay 订单不在此巡检范围；权限设置/真机验收/支付单见《隐私合规与上线就绪排查报告》待确认清单'
905	  };
906	}
907	
908	/**
909	 * 4.20.0 一次性管理 action：把虚拟支付道具图上传到云存储并返回公网下载直链。
910	 * 用途：/xpay/start_upload_goods 的 item_url（必填道具图片公网地址）。
911	 * 调用方：HTTP API /tcb/invokecloudfunction（服务器侧），前端页面不使用。
912	 * imgBase64 传图时执行上传；不传时只返回已存文件的下载直链（幂等复跑）。
913	 * 4.20.4 合规加固：加 opsToken 校验（= config.pay_secret.appKey，与 opsCleanup 同一密令）——
914	 *   遗留管理入口收敛最小暴露面；cloudPath 固定 goods/brand-logo.png，可写范围本就仅此一个文件。
915	 */
916	async function goodsImgSetupAction(event) {
917	  const FIXED_FILEID = 'cloud://cloud1-d5gpnyzjw64a60ac7.636c-cloud1-d5gpnyzjw64a60ac7-1481239884/goods/brand-logo.png';
918	  try {
919	    // opsToken 校验（防滥用：该 action 不面向前端，只有持 appKey 的服务器侧调用应通过）
920	    const db = cloud.database();
921	    const cfgRes = await db.collection('config').doc('pay_secret').get();
922	    const appKey = String((cfgRes && cfgRes.data && cfgRes.data.appKey) || '');
923	    if (!appKey || String(event.opsToken || '') !== appKey) {
924	      return { ok: false, msg: 'opsToken 校验失败' };
925	    }
926	    let fileID = FIXED_FILEID;
927	    if (event.imgBase64) {
928	      const up = await cloud.uploadFile({
929	        cloudPath: 'goods/brand-logo.png',
930	        fileContent: Buffer.from(String(event.imgBase64), 'base64')
931	      });
932	      if (up && up.fileID) fileID = up.fileID;
933	    }
934	    const got = await cloud.getTempFileURL({ fileList: [fileID] });
935	    const f = got && got.fileList && got.fileList[0];
936	    return { ok: true, fileID: fileID, url: (f && f.tempFileURL) || '', status: (f && f.status) };
937	  } catch (e) {
938	    return { ok: false, msg: String((e && e.message) || e).slice(0, 100) };
939	  }
940	}
941	
942	// ============================================================
943	// M4 双人绑定：couples 集合（action 路由，免新增云函数）
944	// 文档结构：{ code, members:[openid], names:{openid:称呼},
945	//            status:'waiting'|'bound', createdAt, boundAt }
946	// ============================================================
947	const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉 0O1IL 等易混淆字符
948	
949	function makeInviteCode() {
950	  let s = '';
951	  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
952	  return s;
953	}
954	
955	/** 我所在的绑定文档（waiting / bound 都算） */
956	async function findMyCouple(db, OPENID) {
957	  const res = await db.collection('couples').where({ members: OPENID }).limit(1).get();
958	  return (res.data && res.data[0]) || null;
959	}
960	
961	/** 绑定文档 → 前端视图（不暴露对方 openid 明文亦可，这里保留以便双人查询） */
962	function coupleView(doc, OPENID) {
963	  const partner = (doc.members || []).find((m) => m !== OPENID) || '';
964	  return {
965	    code: doc.code,
966	    status: doc.status,
967	    myName: (doc.names || {})[OPENID] || '我',
968	    partnerOpenid: partner,
969	    partnerName: (doc.names || {})[partner] || 'TA',
970	    createdAt: doc.createdAt || 0,
971	    boundAt: doc.boundAt || 0
972	  };
973	}
974	
975	async function bindAction(event, OPENID) {
976	  const db = cloud.database();
977	  try {
978	    await ensureCollection(db, 'couples');
979	    const mode = event.mode;
980	
981	    // —— 生成我的邀请码 ——
982	    if (mode === 'create') {
983	      const mine = await findMyCouple(db, OPENID);
984	      if (mine) {
985	        if (mine.status === 'bound') return { ok: true, bound: true, couple: coupleView(mine, OPENID) };
986	        return { ok: true, code: mine.code }; // 还在等人 → 复用同一码
987	      }
988	      const name = String(event.name || '').trim().slice(0, 12) || '我';
989	      for (let i = 0; i < 3; i++) {
990	        const code = makeInviteCode();
991	        try {
992	          await db.collection('couples').add({
993	            data: {
994	              code,
995	              members: [OPENID],
996	              names: { [OPENID]: name },
997	              status: 'waiting',
998	              createdAt: Date.now()
999	            }
1000	          });
1001	          return { ok: true, code };
1002	        } catch (e) {
1003	          // 码撞车重试；其他错误直接抛
1004	        }
1005	      }
1006	      return { ok: false, msg: '邀请码生成失败，请重试' };
1007	    }
1008	
1009	    // —— 输码加入 ——
1010	    if (mode === 'join') {
1011	      const code = String(event.code || '').trim().toUpperCase();
1012	      if (code.length !== 4) return { ok: false, msg: '邀请码是 4 位字符' };
1013	      const mine = await findMyCouple(db, OPENID);
1014	      if (mine && mine.status === 'bound') return { ok: false, msg: '你已和 TA 绑定，先解绑才能换人' };
1015	      const res = await db.collection('couples').where({ code, status: 'waiting' }).limit(1).get();
1016	      const doc = (res.data && res.data[0]) || null;
1017	      if (!doc) return { ok: false, msg: '邀请码不存在或已被使用' };
1018	      if ((doc.members || []).includes(OPENID)) {
1019	        return { ok: true, bound: true, couple: coupleView(doc, OPENID) };
1020	      }
1021	      if ((doc.members || []).length !== 1) return { ok: false, msg: '这个邀请码刚被别人用了' };
1022	      if (Date.now() - (doc.createdAt || 0) > 7 * 24 * 3600 * 1000) {
1023	        await db.collection('couples').doc(doc._id).remove();
1024	        return { ok: false, msg: '邀请码已过期，让 TA 重新生成' };
1025	      }
1026	      const name = String(event.name || '').trim().slice(0, 12) || 'TA';
1027	      const next = {
1028	        members: [...doc.members, OPENID],
1029	        names: { ...(doc.names || {}), [OPENID]: name },
1030	        status: 'bound',
1031	        boundAt: Date.now()
1032	      };
1033	      await db.collection('couples').doc(doc._id).update({ data: next });
1034	      return { ok: true, bound: true, couple: coupleView({ ...doc, ...next }, OPENID) };
1035	    }
1036	
1037	    // —— 查询我的绑定态 ——
1038	    if (mode === 'query') {
1039	      const mine = await findMyCouple(db, OPENID);
1040	      if (!mine || mine.status !== 'bound') return { ok: true, bound: false };
1041	      return { ok: true, bound: true, couple: coupleView(mine, OPENID) };
1042	    }
1043	
1044	    // —— 解绑 ——
1045	    if (mode === 'unbind') {
1046	      const mine = await findMyCouple(db, OPENID);
1047	      if (mine) await db.collection('couples').doc(mine._id).remove();
1048	      return { ok: true };
1049	    }
1050	
1051	    return { ok: false, msg: '未知的绑定操作' };
1052	  } catch (e) {
1053	    return { ok: false, msg: '绑定服务异常：' + (e.message || 'unknown') };
1054	  }
1055	}
1056	
1057	/** 双人合并统计（端上读不到别人的票根，必须在云函数里查） */
1058	async function duoStatsAction(OPENID, full) {
1059	  const db = cloud.database();
1060	  try {
1061	    const mine = await findMyCouple(db, OPENID);
1062	    if (!mine || mine.status !== 'bound') return { ok: false, msg: '尚未绑定' };
1063	    const partner = (mine.members || []).find((m) => m !== OPENID) || '';
1064	    const _ = db.command;
1065	    const res = await db.collection('tickets')
1066	      .where({ _openid: _.in([OPENID, partner]) })
1067	      .limit(500)
1068	      .get();
1069	    const list = res.data || [];
1070	    const cities = new Set(list.filter((t) => t.city).map((t) => t.city));
1071	    const recent = list
1072	      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
1073	      .slice(0, 5)
1074	      .map((t) => ({
1075	        id: t._id,
1076	        title: t.title,
1077	        date: t.date,
1078	        type: t.type,
1079	        owner: t._openid === OPENID ? 'me' : 'partner'
1080	      }));
1081	    // M4-b：full 模式返回双方全量精简票根（timeline/report 页同源数据；list 已被上面的 sort 原地倒序）
1082	    const items = full
1083	      ? list.map((t) => ({
1084	          id: t._id,
1085	          title: t.title,
1086	          type: t.type,
1087	          date: t.date,
1088	          time: t.time || '',
1089	          city: t.city || '',
1090	          venue: t.venue || '',
1091	          seat: t.seat || '',
1092	          price: t.price || null,
1093	          geo: t.geo || null,
1094	          eventKey: t.eventKey || '',
1095	          owner: t._openid === OPENID ? 'me' : 'partner'
1096	        }))
1097	      : undefined;
1098	    return {
1099	      ok: true,
1100	      total: list.length,
1101	      shows: list.filter((t) => t.type === 'show').length,
1102	      cities: cities.size,
1103	      recent,
1104	      items,
1105	      myName: (mine.names || {})[OPENID] || '我',
1106	      partnerName: (mine.names || {})[partner] || 'TA',
1107	      boundAt: mine.boundAt || 0
1108	    };
1109	  } catch (e) {
1110	    return { ok: false, msg: '统计失败：' + (e.message || 'unknown') };
1111	  }
1112	}
1113	
1114	/** 同场收藏计数（同场偶遇的地基；只返回 count，无隐私面） */
1115	async function eventStatsAction(event) {
1116	  const eventKey = String(event.eventKey || '');
1117	  if (!eventKey) return { ok: false, msg: '缺少场次键' };
1118	  try {
1119	    const db = cloud.database();
1120	    const res = await db.collection('tickets').where({ eventKey }).count();
1121	    return { ok: true, count: res.total || 0 };
1122	  } catch (e) {
1123	    return { ok: false, msg: '查询失败' };
1124	  }
1125	}
1126	
1127	exports.main = async (event) => {
1128	  const { OPENID } = cloud.getWXContext();
1129	  // —— 4.20.0 虚拟支付消息推送（Event 分发，无 action 字段）——
1130	  // 所有 xpay_* 事件必须在此消化（回 {ErrCode:0} 或 iOS 问询应答体）：
1131	  // 掉进入库主流程会返回 {ok:false,...}，微信视为应答失败 → 最多重推 15 次
1132	  //（含对账无关事件：complaint 投诉 / wxpay_callback 支付回调等，收到即成功）。
1133	  if (/^xpay_/.test(String(event.Event || ''))) {
1134	    switch (event.Event) {
1135	      case 'xpay_goods_deliver_notify':
1136	        return payNotifyAction(event);
1137	      case 'xpay_refund_notify':
1138	        return payRefundAction(event);
1139	      case 'xpay_subscribe_ios_refund_query_notify':
1140	        return payIosRefundQueryAction(event);
1141	      default:
1142	        return { ErrCode: 0, ErrMsg: 'ignored' };
1143	    }
1144	  }
1145	  // —— action 路由：内容安全 / 双人绑定 / 双人统计 / 同场计数 / AI 文案 / 登录 / 支付 ——
1146	  if (event.action === 'checkText') {
1147	    return checkTextAction(event, OPENID);
1148	  }
1149	  if (event.action === 'setCaption') {
1150	    return setCaptionAction(event, OPENID);
1151	  }
1152	  if (event.action === 'reorder') {
1153	    return reorderAction(event, OPENID);
1154	  }
1155	  if (event.action === 'reorderGroups') {
1156	    return reorderGroupsAction(event, OPENID);
1157	  }
1158	  if (event.action === 'getGroupOrder') {
1159	    return getGroupOrderAction(OPENID);
1160	  }
1161	  if (event.action === 'wxacode') {
1162	    return wxacodeAction();
1163	  }
1164	  if (event.action === 'backfillGeo') {
1165	    return backfillGeoAction(OPENID);
1166	  }
1167	  if (event.action === 'artRestyle') {
1168	    return artRestyleAction(event, OPENID);
1169	  }
1170	  if (event.action === 'artQuery') {
1171	    return artQueryAction(event, OPENID);
1172	  }
1173	  // 4.20.0 授权登录 + 虚拟支付
1174	  if (event.action === 'authLogin') {
1175	    return authLoginAction(event, OPENID);
1176	  }
1177	  if (event.action === 'payCreate') {
1178	    return payCreateAction(event, OPENID);
1179	  }
1180	  if (event.action === 'payQuery') {
1181	    return payQueryAction(event, OPENID);
1182	  }
1183	  // 4.22.0 支付后主动确认（即时到账核心分支：查微信侧状态 → 立即发货）
1184	  if (event.action === 'payConfirm') {
1185	    return payConfirmAction(event, OPENID);
1186	  }
1187	  if (event.action === 'quotaGet') {
1188	    return quotaGetAction(OPENID);
1189	  }
1190	  // 4.21.0 激励视频奖励入账（流量主变现：看视频免费补 1 幅）
1191	  if (event.action === 'artRewardGrant') {
1192	    return artRewardGrantAction(event, OPENID);
1193	  }
1194	  if (event.action === 'profileGet') {
1195	    return profileGetAction(OPENID);
1196	  }
1197	  if (event.action === 'profileSave') {
1198	    return profileSaveAction(event, OPENID);
1199	  }
1200	  if (event.action === 'profileClear') {
1201	    return profileClearAction(OPENID);
1202	  }
1203	  // 4.20.0 一次性管理 action：上传虚拟支付道具图到云存储并返回公网下载直链
1204	  //（供 start_upload_goods 的 item_url 使用；经 HTTP API /tcb/invokecloudfunction 调用，前端不使用）
1205	  if (event.action === 'goodsImgSetup') {
1206	    return goodsImgSetupAction(event);
1207	  }
1208	  // 4.20.4 上线前数据清理（仅云端测试/HTTP API 调用，前端不使用；opsToken 防滥用）
1209	  if (event.action === 'opsCleanup') {
1210	    return opsCleanupAction(event);
1211	  }
1212	  // 4.20.6 上线前只读巡检（opsCleanup 配套验收工具；opsToken 防滥用）
1213	  if (event.action === 'opsAudit') {
1214	    return opsAuditAction(event);
1215	  }
1216	  if (event.action === 'bind') {
1217	    return bindAction(event, OPENID);
1218	  }
1219	  if (event.action === 'duoStats') {
1220	    return duoStatsAction(OPENID, !!event.full);
1221	  }
1222	  if (event.action === 'eventStats') {
1223	    return eventStatsAction(event);
1224	  }
1225	  const t = event.ticket || {};
1226	
1227	  // —— 必填兜底 ——
1228	  if (!t.title) t.title = '未命名票根';
1229	  if (!t.date) return { ok: false, msg: '缺少日期（请回确认页补全）' };
1230	
1231	  // —— 服务端补齐（不可信任客户端的字段都在这补） ——
1232	  t._openid = OPENID;
1233	  t.createdAt = Date.now();
1234	  // 4.11.0 同场印记 opt-out：用户退出参与时不下发场次键（eventStats 聚合自然排除）
1235	  const sameOptOut = !!t.sameOptOut;
1236	  delete t.sameOptOut; // 偏好不入库，只在当次入库生效并写进隐私协议口径
1237	  t.eventKey = sameOptOut ? '' : makeEventKey(t.venue, t.date);
1238	  t.type = ['show', 'movie', 'traffic'].includes(t.type) ? t.type : 'show';
1239	  t.price = Number(t.price) || null;
1240	  t.geo = t.geo && typeof t.geo.lat === 'number' ? t.geo : null;
1241	  // 4.18.0 P0 geo 断链修复：OCR/手填通常只有 city 文本、没有坐标，导致天气/足迹/勋章
1242	  // 全链路拿不到 geo。此处用城市静态字典按 city 配中心坐标（查不到保持 null，不猜）。
1243	  // 4.18.1 场馆级精化：配了腾讯位置服务 key 且场馆名可解析 → 精确到 POI 坐标
1244	  // （如「南京奥体中心」），失败/未配 key 保持城市中心；geoSource 标记坐标来源。
1245	  if (!t.geo && t.city) {
1246	    let src = '';
1247	    const g = lookupCity(t.city);
1248	    if (g) { t.geo = g; src = 'city'; }
1249	    if (t.geo && t.venue) {
1250	      const p = await geocodeVenue(t.city, t.venue);
1251	      if (p) { t.geo = p; src = 'venue'; }
1252	    }
1253	    if (src) t.geoSource = src;
1254	  }
1255	
1256	  // —— M5+：用户可改写的文本字段入库前统一过安全检测（合规口径：文字先审后显） ——
1257	  // title/note 为自由输入字段，入库前必检；venue/seat/city 以票面 OCR 转录+字典配对为主，不作强制检测。
1258	  // 服务异常（微信平台级故障）时放行入库：内容仅用户私有、无公开场景，不阻塞核心收藏流程。
1259	  const userText = [t.title, t.note].filter(Boolean).join('\n').trim();
1260	  if (userText) {
1261	    const sc = await secCheck(OPENID, userText);
1262	    if (sc.result === 'risky') return { ok: false, msg: '票面文字未通过安全检查：' + sc.msg };
1263	  }
1264	
1265	  // —— 天气静默存档（V1.5 起 UI 使用；失败不阻塞） ——
1266	  t.weather = null;
1267	  if (t.geo && t.date) {
1268	    t.weather = await fetchWeather(t.geo.lat, t.geo.lng, t.date);
1269	  }
1270	
1271	  try {
1272	    const db = cloud.database();
1273	    await ensureCollection(db, 'tickets');
1274	    const res = await db.collection('tickets').add({ data: t });
1275	    return { ok: true, _id: res._id, weather: t.weather };
1276	  } catch (e) {
1277	    return { ok: false, msg: '入库失败：' + (e.message || 'unknown') };
1278	  }
1279	};
1280	

[End of file.]