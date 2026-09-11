/**
 * 豆包 → CodeBuddy/WorkBuddy 标准化派单脚本（无头模式驱动其在本项目内自动改码）
 *
 * 原理：调用 CodeBuddy Code CLI 的 headless 模式：
 *   codebuddy -p "<任务>" -y --permission-mode acceptEdits --max-turns N
 *             --output-format stream-json --allowedTools <白名单> --disallowedTools <黑名单>
 *
 * 用法：
 *   node scripts/ai/dispatch.js "把票根详情页的标题改为走 var(--text-main)"
 *   node scripts/ai/dispatch.js --file tasks/xxx.md --max-turns 30
 *   node scripts/ai/dispatch.js "继续上次" --continue
 *
 * 安全设计：
 *   - 默认只放行 读/写/编辑/安全命令，禁止 push、reset --hard、删除类高危操作
 *   - 限制最大轮次防失控；不自动 commit，改动留工作区由豆包 review 后合入
 *   - 全过程输出落盘 dist/ai-tasks/，可审计
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const OUT_DIR = path.join(ROOT, 'dist', 'ai-tasks')
fs.mkdirSync(OUT_DIR, { recursive: true })

// ---------- 参数解析 ----------
const argv = process.argv.slice(2)
function getOpt(name, def) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}
const fileOpt = getOpt('--file')
const maxTurns = getOpt('--max-turns', '40')
const useContinue = argv.includes('--continue')
const plainText = argv.includes('--text')
const task = fileOpt
  ? fs.readFileSync(path.resolve(ROOT, fileOpt), 'utf8')
  : argv.filter(a => !a.startsWith('--') && a !== getOpt('--max-turns', '__n__') && a !== getOpt('--file', '__n__')).join(' ').trim()

if (!task && !useContinue) {
  console.error('用法: node scripts/ai/dispatch.js "任务描述" [--file f.md] [--max-turns 40] [--continue] [--text]')
  process.exit(1)
}

// ---------- 工具白/黑名单（安全护栏）----------
// 允许：读写编辑文件、搜索、跑安全的构建/测试/安装/git只读与本地提交
const ALLOWED = [
  'Read(*)', 'Edit(*)', 'Write(*)', 'Glob(*)', 'Grep(*)',
  'Bash(node --check*)', 'Bash(npm run*)', 'Bash(npm test*)',
  'Bash(git status*)', 'Bash(git diff*)', 'Bash(git add*)', 'Bash(git commit*)', 'Bash(git log*)'
].join(',')
// 明确禁止：外发、强重置、递归删除、切远程、改全局配置
const DISALLOWED = [
  'Bash(git push*)', 'Bash(git reset --hard*)', 'Bash(git checkout --*)',
  'Bash(rm -rf*)', 'Bash(rd /s*)', 'Bash(format*)', 'Bash(npm publish*)'
].join(',')

// ---------- 前置检测 ----------
function hasCli() {
  try {
    require('child_process').execSync('codebuddy --version', { stdio: 'ignore', shell: true })
    return true
  } catch (e) { return false }
}
if (!hasCli()) {
  console.error('[未安装] 未检测到 CodeBuddy Code CLI。请先执行：')
  console.error('  npm i -g @tencent-ai/codebuddy-code')
  console.error('安装后完成登录（二选一）：')
  console.error('  交互登录：codebuddy        （按提示微信/账号登录，复用 WorkBuddy 账号）')
  console.error('  或设置环境变量 CODEBUDDY_API_KEY（中国版同时设 CODEBUDDY_INTERNET_ENVIRONMENT=internal）')
  process.exit(2)
}

// ---------- 组装命令 ----------
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const logFile = path.join(OUT_DIR, `task-${stamp}.log`)
const args = ['-p']
if (useContinue) args.push('--continue')
if (task) args.push(task)
args.push('-y')
args.push('--permission-mode', 'acceptEdits')
args.push('--max-turns', String(maxTurns))
args.push('--allowedTools', ALLOWED)
args.push('--disallowedTools', DISALLOWED)
if (!plainText) args.push('--output-format', 'stream-json')

console.log('==> 派单给 CodeBuddy，任务：', (task || '(继续上次)').slice(0, 120))
console.log('==> 最大轮次：', maxTurns, '｜输出日志：', path.relative(ROOT, logFile))

const logStream = fs.createWriteStream(logFile)
// Windows 下 codebuddy 为 .cmd，需 shell:true
const child = spawn('codebuddy', args, { cwd: ROOT, shell: true, env: process.stdio ? process.env : process.env })

let toolUses = 0
child.stdout.on('data', d => {
  const s = d.toString()
  logStream.write(s)
  // stream-json：逐行解析，只把关键进度精简打印，避免刷屏
  if (!plainText) {
    s.split(/\r?\n/).filter(Boolean).forEach(line => {
      try {
        const o = JSON.parse(line)
        if (o.type === 'assistant' && o.message?.content) {
          o.message.content.forEach(c => {
            if (c.type === 'text' && c.text) console.log('  💬 ' + c.text.replace(/\n/g, '\n     ').slice(0, 500))
            if (c.type === 'tool_use') { toolUses++; console.log(`  🔧 [${toolUses}] ${c.name}`) }
          })
        }
        if (o.type === 'system' && o.subtype === 'task_notification') console.log('  📦 ' + o.summary)
      } catch (e) { /* 非JSON行忽略 */ }
    })
  } else {
    process.stdout.write(d)
  }
})
child.stderr.on('data', d => { process.stderr.write(d); logStream.write(d) })

child.on('close', code => {
  logStream.end()
  console.log(`\n==> CodeBuddy 结束，退出码 ${code}，工具调用 ${toolUses} 次`)
  // 列出本次工作区改动，供豆包 review
  try {
    const { execSync } = require('child_process')
    const changed = execSync('git status --short', { cwd: ROOT, shell: true }).toString().trim()
    console.log('==> 工作区改动（review 后再决定合入）：')
    console.log(changed || '（无改动 / 非git仓库）')
  } catch (e) { console.log('（非 git 仓库，无法列出改动）') }
  if (code !== 0) process.exit(code || 1)
})
