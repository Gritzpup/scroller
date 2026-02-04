import express from 'express'
import { createServer as createViteServer } from 'vite'
import fetch from 'node-fetch'
import crypto from 'crypto'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'

const app = express()
const PORT = 5177

const sessionCookies = new Map()

function getSessionCookies(sessionId) {
  if (!sessionCookies.has(sessionId)) {
    sessionCookies.set(sessionId, [])
  }
  return sessionCookies.get(sessionId)
}

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Handle CORS preflight requests
app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.status(200).send('')
})

// Proxy for static resources
app.all('/api/static/*', async (req, res) => {
  try {
    const urlPath = req.path.substring('/api/static/'.length)
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''
    const resourceUrl = `https://www.redditstatic.com/${urlPath}${queryString}`

    console.log(`📦 Proxying static: ${resourceUrl}`)

    const response = await fetch(resourceUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'Referer': 'https://www.reddit.com/'
      }
    })

    const buffer = await response.buffer()
    const responseText = buffer.toString('utf-8')

    // If we got HTML back (likely error page), log it
    if (responseText.includes('<html') || responseText.includes('<!DOCTYPE')) {
      console.warn(`⚠️ Got HTML response for: ${resourceUrl}`)
      res.status(500).send('Invalid response from Reddit')
      return
    }

    let contentType = response.headers.get('content-type')

    // Force correct content types based on URL
    const reqPath = req.path.toLowerCase()
    if (reqPath.includes('.js') || reqPath.includes('concat?')) {
      contentType = 'application/javascript; charset=utf-8'
    } else if (reqPath.includes('.css')) {
      contentType = 'text/css; charset=utf-8'
    } else if (reqPath.includes('.json')) {
      contentType = 'application/json'
    } else if (reqPath.includes('.png')) {
      contentType = 'image/png'
    } else if (reqPath.includes('.jpg') || reqPath.includes('.jpeg')) {
      contentType = 'image/jpeg'
    } else if (reqPath.includes('.gif')) {
      contentType = 'image/gif'
    } else if (reqPath.includes('.svg')) {
      contentType = 'image/svg+xml'
    }

    if (contentType) {
      res.setHeader('Content-Type', contentType)
    }

    // Set CORS headers for static resources
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cache-Control', 'public, max-age=31536000')
    res.send(buffer)
  } catch (error) {
    console.error('❌ Static proxy error:', error.message)
    res.status(500).send('Static proxy error: ' + error.message)
  }
})

// Handle /api/tracking/w3-reporting/* (proxy to w3-reporting.reddit.com) - MUST be before general /api/*
app.all('/api/tracking/w3-reporting/*', async (req, res) => {
  try {
    const pathAfterPrefix = req.path.substring('/api/tracking/w3-reporting'.length) || '/'
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''
    const trackerUrl = `https://w3-reporting.reddit.com${pathAfterPrefix}${queryString}`

    console.log(`📡 Proxying w3-reporting: ${trackerUrl}`)

    const response = await fetch(trackerUrl, {
      method: req.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'Referer': 'https://www.reddit.com/'
      }
    })

    // Set CORS headers to allow from localhost
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    const contentType = response.headers.get('content-type')
    if (contentType) {
      res.setHeader('Content-Type', contentType)
    }

    const buffer = await response.buffer()
    res.status(response.status).send(buffer)
  } catch (error) {
    console.error('❌ W3-reporting proxy error:', error.message)
    res.status(204).send('')
  }
})

// Handle /api/tracking/error-tracking/* (proxy to error-tracking.reddit.com) - MUST be before general /api/*
app.all('/api/tracking/error-tracking/*', async (req, res) => {
  try {
    const pathAfterPrefix = req.path.substring('/api/tracking/error-tracking'.length) || '/'
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''
    const trackerUrl = `https://error-tracking.reddit.com${pathAfterPrefix}${queryString}`

    console.log(`📡 Proxying error-tracking: ${trackerUrl}`)

    const response = await fetch(trackerUrl, {
      method: req.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'Referer': 'https://www.reddit.com/',
        'Content-Type': 'application/json'
      }
    })

    // Set CORS headers to allow from localhost
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    const contentType = response.headers.get('content-type')
    if (contentType) {
      res.setHeader('Content-Type', contentType)
    }

    const buffer = await response.buffer()
    res.status(response.status).send(buffer)
  } catch (error) {
    console.error('❌ Error-tracking proxy error:', error.message)
    res.status(204).send('')
  }
})

// Pure pass-through proxy for login popup - no modifications at all
// Just forward everything as-is
app.all('/popup/*', async (req, res) => {
  try {
    const pathAfterPrefix = req.path.substring('/popup'.length) || '/'
    const redditUrl = 'https://www.reddit.com' + pathAfterPrefix

    console.log(`📱 Popup proxy: ${redditUrl}`)

    const headers = {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      'Referer': 'https://www.reddit.com/',
      'Accept-Language': 'en-US,en;q=0.9'
    }

    const cookies = getSessionCookies('default')
    if (cookies.length > 0) {
      headers['Cookie'] = cookies.join('; ')
    }

    const fetchOptions = {
      method: req.method,
      headers,
      redirect: 'manual'
    }

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      let bodyData = ''
      if (req.body) {
        bodyData = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
      }
      if (bodyData) {
        fetchOptions.body = bodyData
      }
    }

    const response = await fetch(redditUrl, fetchOptions)

    // Capture Set-Cookie headers
    const setCookieHeaders = response.headers.raw()['set-cookie']
    if (setCookieHeaders && setCookieHeaders.length > 0) {
      const cookies = getSessionCookies('default')
      setCookieHeaders.forEach(cookieHeader => {
        const cookieValue = cookieHeader.split(';')[0]
        const cookieName = cookieValue.split('=')[0]
        const existingIndex = cookies.findIndex(c => c.startsWith(cookieName + '='))
        if (existingIndex >= 0) {
          cookies[existingIndex] = cookieValue
        } else {
          cookies.push(cookieValue)
        }
      })
      console.log(`🍪 Captured ${setCookieHeaders.length} cookies from login`)
    }

    // Set basic CORS
    res.setHeader('Access-Control-Allow-Origin', '*')

    // Forward all response headers
    response.headers.forEach((value, name) => {
      if (name !== 'content-encoding') {
        res.setHeader(name, value)
      }
    })

    const buffer = await response.buffer()
    res.status(response.status).send(buffer)
  } catch (error) {
    console.error('❌ Popup proxy error:', error.message)
    res.status(500).send(error.message)
  }
})

// Decrypt Chromium v10 cookie (Linux hardcoded key)
function decryptChromiumCookie(encryptedValue) {
  const prefix = encryptedValue.slice(0, 3).toString('ascii')
  if (prefix !== 'v10') {
    throw new Error(`Unsupported cookie encryption: ${prefix}`)
  }
  const encrypted = encryptedValue.slice(3)
  const key = crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1')
  const iv = Buffer.alloc(16, 0x20)
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv)
  let decrypted = decipher.update(encrypted)
  decrypted = Buffer.concat([decrypted, decipher.final()])
  const raw = decrypted.toString('utf-8')

  // Decryption produces a binary prefix before the actual cookie value.
  // The reddit_session cookie is a JWT starting with "eyJ".
  // Find the start and strip any trailing control characters.
  const jwtStart = raw.indexOf('eyJ')
  if (jwtStart < 0) {
    throw new Error('Could not find JWT in decrypted cookie')
  }
  let value = raw.slice(jwtStart)
  // Strip trailing PKCS padding / control chars
  while (value.length > 0 && value.charCodeAt(value.length - 1) < 32) {
    value = value.slice(0, -1)
  }
  return value
}

// Extract reddit_session from Brave's cookie database
function extractBraveCookie() {
  const cookieDb = `${homedir()}/.config/BraveSoftware/Brave-Browser/Default/Cookies`
  if (!existsSync(cookieDb)) {
    throw new Error('Brave cookie database not found')
  }

  // Query the encrypted cookie value via sqlite3 CLI (hex-encoded)
  const hex = execSync(
    `sqlite3 "file:${cookieDb}?immutable=1" "SELECT hex(encrypted_value) FROM cookies WHERE host_key LIKE '%reddit.com' AND name = 'reddit_session' LIMIT 1;"`,
    { encoding: 'utf-8' }
  ).trim()

  if (!hex) {
    throw new Error('reddit_session cookie not found in Brave — are you logged into Reddit?')
  }

  const encrypted = Buffer.from(hex, 'hex')
  return decryptChromiumCookie(encrypted)
}

// Auto-login: extract cookie from Brave and verify it
app.get('/auth/login', async (req, res) => {
  try {
    console.log('🔐 Extracting reddit_session from Brave browser...')
    const cookieValue = extractBraveCookie()
    console.log(`🔐 Got reddit_session (${cookieValue.length} chars)`)

    // Store the cookie
    const cookies = getSessionCookies('default')
    const existingIndex = cookies.findIndex(c => c.startsWith('reddit_session='))
    const cookieEntry = `reddit_session=${cookieValue}`
    if (existingIndex >= 0) {
      cookies[existingIndex] = cookieEntry
    } else {
      cookies.push(cookieEntry)
    }

    // Verify it works
    const testResponse = await fetch('https://old.reddit.com/api/me.json', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Cookie': cookies.join('; ')
      }
    })

    const meData = await testResponse.text()
    let username = null
    try {
      const parsed = JSON.parse(meData)
      username = parsed?.data?.name
    } catch (e) {}

    if (username) {
      console.log(`✅ Reddit session verified for user: ${username}`)
      console.log(`🍪 Total stored cookies: ${cookies.length}`)
      res.json({ ok: true, username })
    } else {
      console.log(`⚠️ Cookie extracted but did not authenticate. Response: ${meData.substring(0, 200)}`)
      const badIndex = cookies.findIndex(c => c.startsWith('reddit_session='))
      if (badIndex >= 0) cookies.splice(badIndex, 1)
      res.json({ ok: false, error: 'Cookie is expired or invalid. Try logging into Reddit in Brave first.' })
    }
  } catch (error) {
    console.error('❌ Auto-login error:', error.message)
    res.json({ ok: false, error: error.message })
  }
})

// Proxy for /api/* requests
app.all('/api/*', async (req, res) => {
  try {
    const sessionId = 'default'
    const pathAfterApi = req.path.substring('/api'.length) || '/'
    const isLoginPage = pathAfterApi.includes('/login') || pathAfterApi.includes('/auth')
    const domain = isLoginPage ? 'https://www.reddit.com' : 'https://old.reddit.com'
    const redditUrl = domain + pathAfterApi

    console.log(`📡 Proxying: ${redditUrl}`)

    const headers = {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      'Referer': 'https://www.reddit.com/',
      'Accept-Language': 'en-US,en;q=0.9'
    }

    const cookies = getSessionCookies(sessionId)
    if (cookies.length > 0) {
      headers['Cookie'] = cookies.join('; ')
      if (pathAfterApi === '/') {
        console.log(`🔑 Sending ${cookies.length} cookies with main page request`)
        cookies.forEach(c => console.log(`   🔑 ${c.substring(0, 80)}`))
      }
    } else if (pathAfterApi === '/') {
      console.log(`⚠️ No cookies stored for session: ${sessionId}`)
    }

    const fetchOptions = {
      method: req.method,
      headers,
      redirect: 'follow'
    }

    // For POST/PUT/PATCH requests, forward the body
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      let bodyData = ''
      if (req.body) {
        bodyData = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
      } else {
        // If body is not parsed, read from stream
        for await (const chunk of req) {
          bodyData += chunk
        }
      }
      if (bodyData) {
        fetchOptions.body = bodyData
      }
    }

    const response = await fetch(redditUrl, fetchOptions)

    const contentType = response.headers.get('content-type')

    // Capture Set-Cookie headers from Reddit responses
    const setCookieHeaders = response.headers.raw()['set-cookie']
    if (setCookieHeaders && setCookieHeaders.length > 0) {
      const cookies = getSessionCookies(sessionId)

      // Parse and store cookies
      setCookieHeaders.forEach(cookieHeader => {
        // Extract cookie name=value (before first semicolon)
        const cookieValue = cookieHeader.split(';')[0]

        // Update or add cookie to session storage
        const cookieName = cookieValue.split('=')[0]
        const existingIndex = cookies.findIndex(c => c.startsWith(cookieName + '='))

        if (existingIndex >= 0) {
          cookies[existingIndex] = cookieValue
        } else {
          cookies.push(cookieValue)
        }
      })

      console.log(`🍪 Captured ${setCookieHeaders.length} cookies for session: ${sessionId}`)
    }

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Allow-Credentials', 'true')

    if (contentType) {
      res.setHeader('Content-Type', contentType)
    }

    const buffer = await response.buffer()

    // If HTML, inject fetch/XHR override script and rewrite URLs
    if (contentType && contentType.includes('text/html')) {
      let html = buffer.toString('utf-8')

      // Remove CSP headers
      html = html.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '')

      // Rewrite ALL hardcoded URLs in HTML to go through proxy
      html = html.replace(/https:\/\/www\.redditstatic\.com/g, '/api/static')
      html = html.replace(/https:\/\/redditstatic\.com/g, '/api/static')
      html = html.replace(/https:\/\/www\.reddit\.com/g, '/api')
      html = html.replace(/https:\/\/old\.reddit\.com/g, '/api')
      html = html.replace(/https:\/\/reddit\.com/g, '/api')
      html = html.replace(/https:\/\/w3-reporting\.reddit\.com/g, '/api/tracking/w3-reporting')
      html = html.replace(/https:\/\/error-tracking\.reddit\.com/g, '/api/tracking/error-tracking')

      // Inject override script in head
      const injectScript = `<script>
  function rewriteUrl(url) {
    if (typeof url !== 'string') return url
    if (url.startsWith('https://www.reddit.com')) return url.substring('https://www.reddit.com'.length) || '/'
    if (url.startsWith('https://old.reddit.com')) return url.substring('https://old.reddit.com'.length) || '/'
    if (url.startsWith('https://reddit.com')) return url.substring('https://reddit.com'.length) || '/'
    if (url.startsWith('https://www.redditstatic.com')) return '/api/static/' + url.substring('https://www.redditstatic.com/'.length)
    if (url.startsWith('https://redditstatic.com')) return '/api/static/' + url.substring('https://redditstatic.com/'.length)
    if (url.startsWith('https://w3-reporting.reddit.com')) return '/api/tracking/w3-reporting' + url.substring('https://w3-reporting.reddit.com'.length)
    if (url.startsWith('https://error-tracking.reddit.com')) return '/api/tracking/error-tracking' + url.substring('https://error-tracking.reddit.com'.length)
    return url
  }
  const OriginalXHR = window.XMLHttpRequest
  window.XMLHttpRequest = function() {
    const xhr = new OriginalXHR()
    const originalOpen = xhr.open
    xhr.open = function(method, url, ...args) {
      if (typeof url === 'string') url = rewriteUrl(url)
      return originalOpen.apply(this, [method, url, ...args])
    }
    return xhr
  }
  window.XMLHttpRequest.prototype = OriginalXHR.prototype

  const originalCreateElement = document.createElement
  document.createElement = function(tag) {
    const element = originalCreateElement.call(document, tag)
    if (tag === 'script' || tag === 'link') {
      const originalSetAttr = element.setAttribute
      element.setAttribute = function(name, value) {
        if ((name === 'src' || name === 'href') && typeof value === 'string') {
          value = rewriteUrl(value)
        }
        return originalSetAttr.call(this, name, value)
      }
    }
    return element
  }

  const originalSetAttribute = Element.prototype.setAttribute
  Element.prototype.setAttribute = function(name, value) {
    if ((name === 'src' || name === 'href') && typeof value === 'string') {
      value = rewriteUrl(value)
    }
    return originalSetAttribute.call(this, name, value)
  }
  const originalFetch = window.fetch
  window.fetch = function(resource, init) {
    if (typeof resource === 'string') resource = rewriteUrl(resource)
    return originalFetch(resource, init).catch(err => {
      if (typeof resource === 'string' && (resource.includes('error-tracking') || resource.includes('w3-reporting'))) {
        return new Response('{}', { status: 204 })
      }
      throw err
    })
  }
</script>`

      html = html.replace(/<head[^>]*>/i, `<head>${injectScript}`)
      res.send(html)
    } else {
      res.send(buffer)
    }
  } catch (error) {
    console.error('❌ Proxy error:', error.message)
    res.status(500).json({ error: error.message })
  }
})

// Handle /svc/shreddit/* (dummy responses)
app.all('/svc/shreddit/*', (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.status(200).send('{}')
})

// Handle /tracking/* (silently)
app.all('/tracking/*', (req, res) => {
  res.status(204).send('')
})

// Create Vite server for dev
async function start() {
  const vite = await createViteServer({
    server: { middlewareMode: true }
  })

  // Use vite's connect instance as middleware
  app.use(vite.middlewares)

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Dev server running on http://localhost:${PORT}`)
  })
}

start()
