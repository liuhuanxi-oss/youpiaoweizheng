/**
 * 提交代码审核（把刚上传的开发版本提交给微信审核）
 * 接口：POST https://api.weixin.qq.com/wxa/submit_audit
 * 注意：类目ID必填且必须是后台已配置类目；首次建议先在公众平台手动提审一次摸清材料
 * 用法：node scripts/ci/audit-submit.js
 */
const { config, ensure } = require('./config')
const { getAccessToken, callWxApi } = require('./token')
const { notify } = require('./notify')

async function main() {
  ensure(['appSecret', 'audit.categoryId'])
  const token = await getAccessToken()

  const body = {
    // 审核项列表，至多5项；首版按首页进入
    item_list: [
      {
        address: 'pages/wall/wall',
        tag: '首页 票根墙',
        first_class: config.audit.categoryId,
        second_class: '',
        third_class: '',
        title: '有票为证-票根数字化珍藏工具'
      }
    ],
    // 版本描述（给审核员看）
    version_desc: config.audit.desc || '本次为常规功能迭代与体验优化。',
    // 声明：不需要预览补充材料时可留空；如涉及登录/支付，需通过 preview_info 提供测试账号
    preview_info: { video_id_list: [], pic_id_list: [] },
    // 反馈信息（审核被拒时微信能联系到）
    feedback_info: '',
    feedback_stuff: ''
  }

  const res = await callWxApi(
    `https://api.weixin.qq.com/wxa/submit_audit?access_token=${token}`, body)
  console.log('提审结果：', JSON.stringify(res, null, 2))
  if (res.errcode === 0) {
    console.log('已提交审核，审核单ID(若返回)：', res.auditid)
    await notify('已提交微信审核，可运行 npm run audit:status 轮询结果')
  } else {
    await notify('提审失败：' + res.errmsg)
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
