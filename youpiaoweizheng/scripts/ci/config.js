/**
 * 统一读取 CI 配置与环境变量，并做必填校验
 * 所有脚本通过本模块取配置，禁止在各脚本里散落 process.env
 */
const path = require('path')
const fs = require('fs')

// 加载项目根目录 .env（不依赖 dotenv 也能兜底）
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') })
} catch (e) {
  const envPath = path.join(__dirname, '..', '..', '.env')
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    })
  }
}

const ROOT = path.join(__dirname, '..', '..')

function readPkgVersion() {
  try {
    return require(path.join(ROOT, 'package.json')).version || '1.0.0'
  } catch (e) {
    return '1.0.0'
  }
}

const config = {
  root: ROOT,
  distDir: path.join(ROOT, 'dist'),
  appid: process.env.WX_APPID || 'wx42ef98dfb4ecab23',
  appSecret: process.env.WX_APPSECRET || '',
  privateKeyPath: path.resolve(ROOT, process.env.WX_PRIVATE_KEY_PATH || './secret/private.key'),
  tcb: {
    envId: process.env.TCB_ENV_ID || 'cloud1-d5gpnyzjw64a60ac7',
    secretId: process.env.TCB_SECRET_ID || '',
    secretKey: process.env.TCB_SECRET_KEY || '',
    functions: (process.env.TCB_FUNCTIONS || '').split(',').map(s => s.trim()).filter(Boolean)
  },
  upload: {
    version: process.env.UPLOAD_VERSION || readPkgVersion(),
    remark: process.env.UPLOAD_REMARK || '自动化上传',
    robot: Number(process.env.CI_ROBOT || 1)
  },
  audit: {
    categoryId: process.env.AUDIT_CATEGORY_ID || '',
    desc: process.env.AUDIT_DESC || '',
    autoRelease: String(process.env.AUTO_RELEASE || 'false') === 'true'
  },
  notifyWebhook: process.env.NOTIFY_WEBHOOK || '',
  // 打包/上传时忽略的文件（避免把脚本、文档、嵌套历史目录、依赖打进小程序包）
  uploadIgnores: [
    'node_modules/**/*',
    '.git/**/*',
    'scripts/**/*',
    'dist/**/*',
    'secret/**/*',
    '.env',
    '**/*.md',
    'tests/**/*', // 280KB 的测试源码没人 require，却跟着用户一起下载 —— 排除
    'youpiaoweizheng/**/*' // 嵌套的历史重复目录，必须排除
  ]
}

/**
 * 必填项校验；missing 时打印清晰指引并退出
 */
function ensure(keys) {
  const missing = keys.filter(k => {
    const v = k.split('.').reduce((o, i) => (o || {})[i], config)
    return !v
  })
  if (missing.length) {
    console.error('[配置缺失] 以下配置未填写，请在项目根目录 .env 中补齐：')
    missing.forEach(k => console.error('  - ' + k))
    console.error('可复制 .env.ci.example 为 .env 后填写。')
    process.exit(1)
  }
}

module.exports = { config, ensure }
