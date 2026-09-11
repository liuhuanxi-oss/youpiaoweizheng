/**
 * 结果通知：企业微信群机器人（可选）。未配置 webhook 时仅控制台打印
 */
const https = require('https')
const { config } = require('./config')

function notify(content) {
  console.log('[通知] ' + content)
  if (!config.notifyWebhook) return Promise.resolve()
  const payload = JSON.stringify({
    msgtype: 'text',
    text: { content: `【有票为证CI】${content}` }
  })
  return new Promise(resolve => {
    const u = new URL(config.notifyWebhook)
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, res => res.on('end', resolve))
    req.on('error', () => resolve())
    req.write(payload); req.end()
  })
}

module.exports = { notify }
