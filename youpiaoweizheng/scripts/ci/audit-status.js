/**
 * 查询最近一次审核状态
 * 接口：GET https://api.weixin.qq.com/wxa/get_latest_auditstatus
 * status: 0=审核通过(可发布) 1=审核被拒 2=审核中 3=已撤回 4=审核通过后自动发布失败? 以官方为准
 * 用法：node scripts/ci/audit-status.js
 */
const { config, ensure } = require('./config')
const { getAccessToken, callWxApi } = require('./token')
const { notify } = require('./notify')

const STATUS_MAP = { 0: '审核通过', 1: '审核被拒', 2: '审核中', 3: '已撤回' }

async function main() {
  ensure(['appSecret'])
  const token = await getAccessToken()
  const res = await callWxApi(
    `https://api.weixin.qq.com/wxa/get_latest_auditstatus?access_token=${token}`)
  console.log('审核状态：', JSON.stringify(res, null, 2))
  console.log('含义：', STATUS_MAP[res.status] || '未知')
  if (res.status === 0) console.log('审核已通过，可执行 npm run release 发布上线')
  if (res.status === 1) console.log('被拒原因：', res.reason)
  await notify(`审核状态：${STATUS_MAP[res.status] || res.status}`)
}

main().catch(e => { console.error(e); process.exit(1) })
