/**
 * 上传小程序代码到微信后台（生成「开发版本」，可设为体验版）
 * 前置：已下载代码上传密钥、已配置IP白名单（或临时关闭）
 * 用法：node scripts/ci/upload.js
 */
const fs = require('fs')
const path = require('path')
const ci = require('miniprogram-ci')
const { config, ensure } = require('./config')
const { notify } = require('./notify')

function gitShort() {
  try {
    return require('child_process').execSync('git rev-parse --short HEAD', { cwd: config.root }).toString().trim()
  } catch (e) { return 'nogit' }
}

async function main() {
  ensure(['privateKeyPath'])
  if (!fs.existsSync(config.privateKeyPath)) {
    console.error('未找到上传密钥文件：' + config.privateKeyPath)
    process.exit(1)
  }

  const stamp = new Date().toLocaleString('zh-CN', { hour12: false })
  const desc = `${config.upload.remark} | ${stamp} | ${gitShort()}`

  const project = new ci.Project({
    appid: config.appid,
    type: 'miniProgram',
    projectPath: config.root,
    privateKeyPath: config.privateKeyPath,
    ignores: config.uploadIgnores
  })

  console.log(`开始上传：版本 ${config.upload.version}，备注 ${desc}`)
  const res = await ci.upload({
    project,
    version: config.upload.version, // 必须 数字.数字.数字
    desc,
    robot: config.upload.robot,
    setting: {
      es6: true,
      es7: true,
      minify: true,
      autoPrefixWXSS: true,
      minifyWXML: true,
      minifyWXSS: true,
      minifyJS: true
    },
    onProgressUpdate: undefined
  })
  console.log('上传成功：', JSON.stringify(res, null, 2))
  await notify(`上传成功 v${config.upload.version}（${desc}），可到公众平台设为体验版/提审`)
}

main().catch(err => {
  console.error('上传失败：', err && err.message ? err.message : err)
  notify('上传失败：' + (err && err.message ? err.message : err))
  process.exit(1)
})
