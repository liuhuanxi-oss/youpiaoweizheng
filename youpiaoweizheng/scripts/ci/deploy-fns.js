/**
 * 部署云函数到微信云开发环境
 * 原理：调用全局安装的 CloudBase CLI（tcb），用腾讯云API密钥非交互登录后逐个部署
 * 前置：npm i -g @cloudbase/cli ；配置 TCB_SECRET_ID / TCB_SECRET_KEY
 * 用法：node scripts/ci/deploy-fns.js           部署 .env 指定(或全部)云函数
 *       node scripts/ci/deploy-fns.js saveTicket 只部署指定云函数
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { config, ensure } = require('./config')
const { notify } = require('./notify')

function run(cmd) {
  console.log('$ ' + cmd)
  return execSync(cmd, { cwd: config.root, stdio: 'inherit' })
}

function listFunctions() {
  const dir = path.join(config.root, 'cloudfunctions')
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
}

async function main() {
  ensure(['tcb.secretId', 'tcb.secretKey'])
  const only = process.argv[2]
  let fns = only ? [only] : config.tcb.functions
  if (!fns.length) fns = listFunctions()
  if (!fns.length) { console.log('未发现云函数，跳过'); return }

  // 校验 tcb 已安装
  try { execSync('tcb --version', { stdio: 'ignore' }) }
  catch (e) {
    console.error('未安装 CloudBase CLI，请先执行：npm i -g @cloudbase/cli')
    process.exit(1)
  }

  // 非交互登录（CI 场景）
  run(`tcb login --apiKeyId "${config.tcb.secretId}" --apiKey "${config.tcb.secretKey}"`)

  // 逐个部署，--force 覆盖
  for (const name of fns) {
    const fnDir = path.join(config.root, 'cloudfunctions', name)
    if (!fs.existsSync(fnDir)) { console.warn(`云函数不存在，跳过：${name}`); continue }
    run(`tcb fn deploy "${name}" -e "${config.tcb.envId}" --force`)
  }
  console.log('云函数部署完成：' + fns.join(', '))
  await notify('云函数部署完成：' + fns.join(', '))
}

main().catch(err => {
  console.error('云函数部署失败：', err && err.message ? err.message : err)
  notify('云函数部署失败：' + (err && err.message ? err.message : err))
  process.exit(1)
})
