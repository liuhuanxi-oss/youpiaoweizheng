/**
 * 部署云函数到微信云开发环境
 * 两条路，自动选：
 *   ① miniprogram-ci（默认）：用项目已有的「代码上传密钥」，不需要腾讯云 API 密钥
 *      —— 云函数必须写 package.json（依赖由云端 npm 安装），saveTicket 已满足
 *   ② CloudBase CLI（tcb）：配了 TCB_SECRET_ID / TCB_SECRET_KEY 且全局装了 tcb 才走
 * 用法：node scripts/ci/deploy-fns.js            部署 .env 指定(或全部)云函数
 *       node scripts/ci/deploy-fns.js saveTicket 只部署指定云函数
 *       node scripts/ci/deploy-fns.js --triggers 只按 config.json 建定时触发器，不传代码
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

/** 能不能走 tcb：密钥齐 + 全局装了 CLI，缺一不可 */
function canUseTcb() {
  if (!config.tcb.secretId || !config.tcb.secretKey) return false
  try { execSync('tcb --version', { stdio: 'ignore' }); return true } catch (e) { return false }
}

/** 建 Project 实例（appid + 上传密钥）：传代码、建触发器都要它 */
function makeProject() {
  ensure(['privateKeyPath'])
  if (!fs.existsSync(config.privateKeyPath)) {
    console.error('未找到上传密钥文件：' + config.privateKeyPath)
    process.exit(1)
  }
  const ci = require('miniprogram-ci')
  return new ci.Project({
    appid: config.appid,
    type: 'miniProgram',
    projectPath: config.root,
    privateKeyPath: config.privateKeyPath,
    ignores: config.uploadIgnores
  })
}

/** 走 miniprogram-ci：凭项目自身的代码上传密钥部署（与上传小程序代码同一把） */
async function deployViaCI(fns) {
  const ci = require('miniprogram-ci')
  const project = makeProject()
  for (const name of fns) {
    const fnDir = path.join(config.root, 'cloudfunctions', name)
    if (!fs.existsSync(fnDir)) { console.warn(`云函数不存在，跳过：${name}`); continue }
    console.log(`开始部署云函数 ${name}（云端装依赖，可能要几分钟）…`)
    const res = await ci.cloud.uploadFunction({
      project,
      env: config.tcb.envId,
      name,
      path: fnDir,
      remoteNpmInstall: true // 依赖（wx-server-sdk）由云端 npm 安装，本地不传 node_modules
    })
    console.log(`  ${name} 部署完成：${res.filesCount} 个文件 / ${(res.packSize / 1024).toFixed(1)}KB`)
  }
  return project // 触发器那一步还要用（同一个 Project 实例带着密钥）
}

/**
 * config.json 里有 triggers 的云函数，部署完顺手确保触发器真的建了。
 * 为什么必须单独做这一步：miniprogram-ci 的 uploadFunction **只传代码，不管触发器**——
 * 触发器没建不报错、不留痕，只是永远不发（7.4.0 的召回定时器就踩在这个坑上）。
 * 已存在时接口会返回失败，按「已经有了」处理，不打断部署。
 */
async function ensureTriggers(project, fns) {
  const ci = require('miniprogram-ci') // 上一步是局部 require，这里得自己拿一份
  for (const name of fns) {
    const cfgPath = path.join(config.root, 'cloudfunctions', name, 'config.json')
    if (!fs.existsSync(cfgPath)) continue
    let triggers = []
    try { triggers = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).triggers || [] } catch (e) {
      console.warn(`  ${name} 的 config.json 读不出来，跳过触发器：` + e.message)
      continue
    }
    if (!triggers.length) continue
    try {
      const msg = await ci.cloud.createTimeTrigger({
        project,
        envId: config.tcb.envId,
        functionName: name,
        triggersConfig: triggers.map(t => ({ name: t.name, type: t.type || 'timer', config: t.config }))
      })
      console.log(`  ${name} 定时触发器：${msg}`)
    } catch (e) {
      console.warn(`  ${name} 定时触发器未能创建（若已存在属正常）：` + (e && e.message ? e.message : e))
    }
  }
}

async function main() {
  const arg = process.argv[2]
  const only = arg && arg !== '--triggers' ? arg : ''
  let fns = only ? [only] : config.tcb.functions
  if (!fns.length) fns = listFunctions()
  if (!fns.length) { console.log('未发现云函数，跳过'); return }

  // 只建触发器（改了 cron、或怀疑触发器没建时用）：传代码要几分钟，这一步不用
  if (arg === '--triggers') {
    ensureTriggers(await makeProject(), fns)
    return
  }

  if (canUseTcb()) {
    // 非交互登录（CI 场景）
    run(`tcb login --apiKeyId "${config.tcb.secretId}" --apiKey "${config.tcb.secretKey}"`)
    // 逐个部署，--force 覆盖
    for (const name of fns) {
      const fnDir = path.join(config.root, 'cloudfunctions', name)
      if (!fs.existsSync(fnDir)) { console.warn(`云函数不存在，跳过：${name}`); continue }
      run(`tcb fn deploy "${name}" -e "${config.tcb.envId}" --force`)
    }
  } else {
    console.log('未配置 TCB 密钥或未安装 tcb，改走 miniprogram-ci（用代码上传密钥）')
    await ensureTriggers(await deployViaCI(fns), fns)
  }

  console.log('云函数部署完成：' + fns.join(', '))
  await notify('云函数部署完成：' + fns.join(', '))
}

main().catch(err => {
  console.error('云函数部署失败：', err && err.message ? err.message : err)
  notify('云函数部署失败：' + (err && err.message ? err.message : err))
  process.exit(1)
})
