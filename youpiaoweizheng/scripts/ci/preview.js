/**
 * 生成「预览版」二维码（真机扫码即看当前代码，不占开发版本号）
 * 产物：dist/preview.png，直接发给体验成员扫码
 * 用法：node scripts/ci/preview.js
 */
const fs = require('fs')
const path = require('path')
const ci = require('miniprogram-ci')
const { config, ensure } = require('./config')

async function main() {
  ensure(['privateKeyPath'])
  if (!fs.existsSync(config.privateKeyPath)) {
    console.error('未找到上传密钥文件：' + config.privateKeyPath)
    process.exit(1)
  }
  fs.mkdirSync(config.distDir, { recursive: true })
  const qrPath = path.join(config.distDir, 'preview.png')

  const project = new ci.Project({
    appid: config.appid,
    type: 'miniProgram',
    projectPath: config.root,
    privateKeyPath: config.privateKeyPath,
    ignores: config.uploadIgnores
  })

  const res = await ci.preview({
    project,
    desc: '预览 ' + new Date().toLocaleString('zh-CN', { hour12: false }),
    robot: config.upload.robot,
    setting: { es6: true, es7: true, minify: true },
    qrcodeFormat: 'image',
    qrcodeOutputDest: qrPath,
    pagePath: undefined // 可指定启动页，如 'pages/wall/wall'
  })
  console.log('预览二维码已生成：' + qrPath)
  console.log('包体积信息：', JSON.stringify(res.subPackageInfo || res.pluginInfo || {}))
}

main().catch(err => {
  console.error('预览失败：', err && err.message ? err.message : err)
  process.exit(1)
})
