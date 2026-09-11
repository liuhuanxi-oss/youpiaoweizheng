/**
 * 获取微信接口调用凭证 access_token（普通自有小程序，AppID+AppSecret）
 * 本地缓存到 dist/.token.json，过期前 5 分钟自动刷新，避免频繁调用
 */
const https = require('https')
const fs = require('fs')
const path = require('path')
const { config, ensure } = require('./config')

const CACHE_FILE = path.join(config.distDir, '.token.json')

function requestToken() {
  return new Promise((resolve, reject) => {
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${config.appid}&secret=${config.appSecret}`
    https.get(url, res => {
      let data = ''
      res.on('data', c => (data += c))
      res.on('end', () => {
        try {
          const j = JSON.parse(data)
          if (j.access_token) {
            const payload = { token: j.access_token, expireAt: Date.now() + (j.expires_in - 300) * 1000 }
            fs.mkdirSync(config.distDir, { recursive: true })
            fs.writeFileSync(CACHE_FILE, JSON.stringify(payload))
            resolve(payload.token)
          } else {
            reject(new Error(`获取access_token失败：${data}`))
          }
        } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

async function getAccessToken() {
  ensure(['appSecret'])
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
      if (c.token && c.expireAt > Date.now()) return c.token
    } catch (e) {}
  }
  return requestToken()
}

/** 封装微信服务端 GET/POST JSON 请求 */
function callWxApi(url, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: bodyObj ? 'POST' : 'GET' }
    const req = https.request(opts, res => {
      let data = ''
      res.on('data', c => (data += c))
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(new Error('返回非JSON：' + data)) }
      })
    })
    req.on('error', reject)
    if (bodyObj) req.write(JSON.stringify(bodyObj))
    req.end()
  })
}

module.exports = { getAccessToken, callWxApi }
