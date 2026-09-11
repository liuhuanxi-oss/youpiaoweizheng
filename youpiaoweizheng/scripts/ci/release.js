/**
 * 发布已通过审核的版本（正式上线，对所有用户生效）
 * 接口：POST https://api.weixin.qq.com/wxa/release
 * 注意：必须审核通过后调用；POST 必须带 body（传 {}），否则报 44002 empty post data
 * 用法：node scripts/ci/release.js
 */
const { config, ensure } = require('./config')
const { getAccessToken, callWxApi } = require('./token')
const { notify } = require('./notify')

async function main() {
  ensure(['appSecret'])
  const token = await getAccessToken()
  const res = await callWxApi(
    `https://api.weixin.qq.com/wxa/release?access_token=${token}`, {})
  console.log('发布结果：', JSON.stringify(res, null, 2))
  if (res.errcode === 0) {
    console.log('✅ 已发布上线')
    await notify('版本已正式发布上线')
  } else {
    await notify('发布失败：' + res.errmsg)
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
