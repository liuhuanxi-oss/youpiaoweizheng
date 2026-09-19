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
    // 编译并发：默认跟着 CPU 核数走（最多 8 个 worker，每个都是一个独立 V8 实例）。
    // 本机提交内存吃紧时（空闲提交约 2G），8 个 worker 会直接把进程撑爆
    // ——报「Zone Allocation failed」然后 exit 134，且崩在哪个文件每次都不一样。
    // 压到 2 个既躲开这个坑，速度也没差多少。
    threads: Number(process.env.CI_THREADS || 2),
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
  const sizeLine = reportSize(res)
  await notify(`上传成功 v${config.upload.version}（${desc}），${sizeLine}，可到公众平台设为体验版/提审`)
}

/**
 * 包体积台账（8.1.3 起）：主包上限 2 MB，红线是「每版本增幅 ≤ 20 KB」
 * （7.4.4 → 8.1.2 四版涨了 162 KB，平均每版 +40 KB，按那速度迟早撞上限）。
 * 上一次的数值记在 scripts/ci/pkg-size.json 里 —— 上传时对比一次，超了就喊一声。
 */
const SIZE_LEDGER = path.join(__dirname, 'pkg-size.json')
const SIZE_LIMIT_KB = 2048
const SIZE_DELTA_KB = 20

function reportSize(res) {
  const packs = (res && res.subPackageInfo) || []
  if (!packs.length) {
    console.log('包体积：本次上传未返回尺寸信息，跳过台账')
    return '包体积未取到'
  }
  const main = packs.find((p) => !p.name || p.name === '__FULL__' || p.name === '__APP__') || packs[0]
  const kb = (n) => Math.round(n / 1024)
  const total = kb(main.size)
  console.log(`包体积：主包 ${total} KB / 上限 ${SIZE_LIMIT_KB} KB（${((total / SIZE_LIMIT_KB) * 100).toFixed(1)}%）`)
  packs.forEach((p) => { if (p !== main) console.log(`        分包 ${p.name}：${kb(p.size)} KB`) })

  let prev = null
  try { prev = JSON.parse(fs.readFileSync(SIZE_LEDGER, 'utf8')) } catch (e) { /* 首次上传没有台账 */ }
  const last = prev && prev.byVersion ? prev.byVersion[prev.latest] : null
  if (last) {
    const delta = total - last.mainKb
    const sign = delta >= 0 ? '+' : ''
    const warn = delta > SIZE_DELTA_KB ? `  ⚠️ 超过 +${SIZE_DELTA_KB} KB 红线（这一版涨多了，看看是不是新塞了图）` : ''
    console.log(`        比 v${prev.latest}（${last.mainKb} KB）${sign}${delta} KB${warn}`)
  }
  if (total > SIZE_LIMIT_KB) console.log(`        ⚠️ 已超主包上限（${SIZE_LIMIT_KB} KB），必须分包或删资源`)

  const ledger = (prev && prev.byVersion) || {}
  const v = config.upload.version
  ledger[v] = { mainKb: total, at: new Date().toISOString().slice(0, 10) }
  fs.writeFileSync(SIZE_LEDGER, JSON.stringify({ latest: v, byVersion: ledger }, null, 2) + '\n')
  return `主包 ${total} KB`
}

main().catch(err => {
  console.error('上传失败：', err && err.message ? err.message : err)
  notify('上传失败：' + (err && err.message ? err.message : err))
  process.exit(1)
})
