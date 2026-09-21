/**
 * 把字体文件传到云开发「静态网站托管」
 * 用法：node scripts/ci/upload-fonts.js
 *
 * 走的是 miniprogram-ci 的 uploadStaticStorage —— 用的是项目已有的「代码上传密钥」，
 * 不需要腾讯云 API 密钥，也不用去控制台手动拖文件。
 * 只往指定目录里**新增/覆盖**文件，不动托管上其它内容。
 *
 * 传完的地址就是 utils/font.js 里的 FONT_BASE，两边必须对得上：
 *   https://<staticDomain>/<remotePath>/
 * 域名从云端环境信息里实时读，不写死 —— 换环境/换域名时这里不用改。
 */
const ci = require('miniprogram-ci')
const path = require('path')
const fs = require('fs')
const { config, ensure } = require('./config')
const { initEnvironmentByProject } = require('miniprogram-ci/dist/cloud/utils')

// 字体源文件目录（在项目**上一级**，故意不放进小程序包，免得被上传进小程序里）
const SRC_DIR = path.join(config.root, '..', '字体文件-传腾讯云用')
// 托管上的目录（和 utils/font.js 的 FONT_BASE 后半段一致）
const REMOTE_PATH = 'ypwz/fonts/'

async function main() {
  ensure(['privateKeyPath'])
  if (!fs.existsSync(SRC_DIR)) {
    console.error('找不到字体目录：' + SRC_DIR)
    process.exit(1)
  }

  const project = new ci.Project({
    appid: config.appid,
    type: 'miniProgram',
    projectPath: config.root,
    privateKeyPath: config.privateKeyPath,
    ignores: config.uploadIgnores
  })

  // 先把托管状态读出来：没开通的话这里就是空的，早点报清楚免得后面报一堆看不懂的错
  const { currentEnv } = await initEnvironmentByProject(project, config.tcb.envId)
  const st = (currentEnv.staticStorages || [])[0]
  if (!st) {
    console.error('这个云开发环境还没开通「静态网站托管」，去控制台点一下开通再跑。')
    process.exit(1)
  }
  if (st.status !== 'online') {
    console.error('静态网站托管当前状态是「' + st.status + '」，不是 online，先到控制台看看。')
    process.exit(1)
  }

  console.log('开始上传字体 → https://' + st.staticDomain + '/' + REMOTE_PATH)
  await ci.cloud.uploadStaticStorage({
    project,
    env: config.tcb.envId,
    path: SRC_DIR,
    remotePath: REMOTE_PATH
  })

  console.log('\n上传完成。字体地址：')
  for (const f of fs.readdirSync(SRC_DIR).filter(n => /\.(woff2?|ttf|otf)$/i.test(n))) {
    console.log('  https://' + st.staticDomain + '/' + REMOTE_PATH + f)
  }
  console.log('\nutils/font.js 里的 FONT_BASE 应该是：')
  console.log("  'https://" + st.staticDomain + '/' + REMOTE_PATH + "'")
  console.log('\n还差一步（改不了，得你去后台点）：')
  console.log('  微信公众平台 → 开发管理 → 开发设置 → 服务器域名 → downloadFile 合法域名')
  console.log('  加上：https://' + st.staticDomain)
}

main().catch(err => {
  console.error('字体上传失败：', err && err.message ? err.message : err)
  process.exit(1)
})
