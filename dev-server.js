import express from 'express'
import { createServer as createViteServer } from 'vite'
import fetch from 'node-fetch'
import crypto from 'crypto'
import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.SCROLLER_PORT, 10) || 5177
const COOKIE_FILE = join(__dirname, `.session-cookies-${PORT}.json`)
const FB_COOKIE_FILE = join(__dirname, `.fb-session-cookies-${PORT}.json`)

const app = express()

const sessionCookies = new Map()

// Load persisted cookies on startup
try {
  if (existsSync(COOKIE_FILE)) {
    const data = JSON.parse(readFileSync(COOKIE_FILE, 'utf-8'))
    for (const [key, value] of Object.entries(data)) {
      sessionCookies.set(key, value)
    }
    const count = sessionCookies.get('default')?.length || 0
    console.log(`🍪 Loaded ${count} persisted cookies from disk`)
  }
} catch (e) {
  console.log(`⚠️ Could not load saved cookies: ${e.message}`)
}

function saveCookies() {
  try {
    const obj = Object.fromEntries(sessionCookies)
    writeFileSync(COOKIE_FILE, JSON.stringify(obj, null, 2))
  } catch (e) {
    console.error(`⚠️ Could not save cookies: ${e.message}`)
  }
}

function getSessionCookies(sessionId) {
  if (!sessionCookies.has(sessionId)) {
    sessionCookies.set(sessionId, [])
  }
  return sessionCookies.get(sessionId)
}

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Global request logger
app.use((req, res, next) => {
  if (!req.url.includes('/api/media/') && !req.url.includes('/api/static/')) {
    console.log(`[REQUEST] ${req.method} ${req.url}`)
  }
  next()
})

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
      saveCookies()
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

  // Copy the database to a temp file so we can read the WAL (fresh cookies)
  const tmpDb = '/tmp/brave-cookies-tmp.db'
  execSync(`cp "${cookieDb}" "${tmpDb}" && cp "${cookieDb}-wal" "${tmpDb}-wal" 2>/dev/null; cp "${cookieDb}-shm" "${tmpDb}-shm" 2>/dev/null; true`)

  // Query the encrypted cookie value via sqlite3 CLI (hex-encoded)
  const hex = execSync(
    `sqlite3 "${tmpDb}" "SELECT hex(encrypted_value) FROM cookies WHERE host_key LIKE '%reddit.com' AND name = 'reddit_session' ORDER BY last_access_utc DESC LIMIT 1;"`,
    { encoding: 'utf-8' }
  ).trim()

  // Clean up temp files
  execSync(`rm -f "${tmpDb}" "${tmpDb}-wal" "${tmpDb}-shm" 2>/dev/null; true`)

  if (!hex) {
    throw new Error('reddit_session cookie not found in Brave — are you logged into Reddit?')
  }

  const encrypted = Buffer.from(hex, 'hex')
  return decryptChromiumCookie(encrypted)
}

// ─── Facebook Cookie Store ───────────────────────────────────────────────────

let fbSessionCookies = []
try {
  if (existsSync(FB_COOKIE_FILE)) {
    fbSessionCookies = JSON.parse(readFileSync(FB_COOKIE_FILE, 'utf-8'))
    console.log(`🍪 [FB] Loaded ${fbSessionCookies.length} persisted Facebook cookies`)
  }
} catch (e) {
  console.log(`⚠️ [FB] Could not load saved Facebook cookies: ${e.message}`)
}

function saveFbCookies() {
  try { writeFileSync(FB_COOKIE_FILE, JSON.stringify(fbSessionCookies, null, 2)) } catch (e) {}
}

// Decrypt a generic Chromium v10 cookie value to a plain string
function decryptChromiumCookieGeneric(encryptedValue) {
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
  let raw = decrypted.toString('utf-8')
  // Strip leading null/control bytes from AES-CBC padding
  let start = 0
  while (start < raw.length && raw.charCodeAt(start) < 32) start++
  let end = raw.length
  while (end > start && raw.charCodeAt(end - 1) < 32) end--
  return raw.slice(start, end)
}

// Extract Facebook cookies from the LIVE Brave browser via CDP (port 9222)
// Works while Brave is running — no SQLite locking, no decryption needed
async function extractFacebookCookiesViaCDP(cdpPort = 9222) {
  // Step 1: Get list of page targets and pick one to attach to
  const tabsRes = await fetch(`http://localhost:${cdpPort}/json`)
  if (!tabsRes.ok) throw new Error(`CDP not available on port ${cdpPort}`)
  const tabs = await tabsRes.json()

  // Prefer a non-devtools page target
  const pageTab = tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl) ||
                  tabs.find(t => t.webSocketDebuggerUrl)
  if (!pageTab) throw new Error('No CDP page target found')

  console.log(`🔌 [FB] Connecting to CDP page: ${pageTab.url} -> ${pageTab.webSocketDebuggerUrl}`)

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(pageTab.webSocketDebuggerUrl)
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('CDP WebSocket timed out'))
    }, 10000)

    ws.addEventListener('open', () => {
      // Network.getAllCookies works on page targets and returns ALL browser cookies
      ws.send(JSON.stringify({ id: 1, method: 'Network.getAllCookies', params: {} }))
    })

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.id !== 1) return
        clearTimeout(timeout)
        ws.close()

        if (msg.error) {
          return reject(new Error(`CDP error: ${msg.error.message}`))
        }

        const allCookies = msg.result?.cookies || []
        console.log(`🍪 [FB] Got ${allCookies.length} total cookies from browser`)

        // Filter to Facebook domains, keep session-critical ones
        const KEEP = new Set(['c_user', 'xs', 'datr', 'fr', 'sb', 'presence', 'wd', 'dpr'])
        const fbCookies = allCookies
          .filter(c => (c.domain || '').includes('facebook.com') && KEEP.has(c.name))
          .map(c => `${c.name}=${c.value}`)

        console.log(`🍪 [FB] Extracted ${fbCookies.length} FB cookies: ${fbCookies.map(c => c.split('=')[0]).join(', ')}`)

        if (!fbCookies.some(c => c.startsWith('c_user=') || c.startsWith('xs='))) {
          return reject(new Error('No c_user or xs cookie found — make sure you are logged into Facebook in Brave'))
        }

        resolve(fbCookies)
      } catch (e) {
        clearTimeout(timeout)
        ws.close()
        reject(e)
      }
    })

    ws.addEventListener('error', (event) => {
      clearTimeout(timeout)
      reject(new Error(`CDP WebSocket error: ${event.message || 'connection failed'}`))
    })
  })
}

// Facebook auth: status
app.get('/fb-auth/status', (req, res) => {
  const cUser = fbSessionCookies.find(c => c.startsWith('c_user='))
  if (cUser) {
    const uid = cUser.split('=')[1]
    res.json({ loggedIn: true, uid, cookieCount: fbSessionCookies.length })
  } else {
    res.json({ loggedIn: false, cookieCount: 0 })
  }
})

// Facebook auth: pull cookies from live Brave browser via CDP
app.get('/fb-auth/pull', async (req, res) => {
  try {
    console.log('🔐 [FB] Pulling Facebook cookies from live Brave browser via CDP...')
    const extracted = await extractFacebookCookiesViaCDP()
    // Merge into fbSessionCookies
    for (const cookie of extracted) {
      const name = cookie.split('=')[0]
      const idx = fbSessionCookies.findIndex(c => c.split('=')[0] === name)
      if (idx >= 0) fbSessionCookies[idx] = cookie
      else fbSessionCookies.push(cookie)
    }
    saveFbCookies()
    const cUser = fbSessionCookies.find(c => c.startsWith('c_user='))
    const uid = cUser ? cUser.split('=')[1] : null
    console.log(`✅ [FB] Pulled ${extracted.length} cookies. c_user=${uid}`)
    res.json({ ok: true, uid, cookieCount: fbSessionCookies.length })
  } catch (e) {
    console.error('❌ [FB] CDP cookie pull failed:', e.message)
    // Fall back to SQLite approach if CDP fails
    try {
      console.log('📁 [FB] Falling back to SQLite extraction...')
      const extracted = extractFacebookCookiesFromBrave_sqlite()
      for (const cookie of extracted) {
        const name = cookie.split('=')[0]
        const idx = fbSessionCookies.findIndex(c => c.split('=')[0] === name)
        if (idx >= 0) fbSessionCookies[idx] = cookie
        else fbSessionCookies.push(cookie)
      }
      saveFbCookies()
      const cUser = fbSessionCookies.find(c => c.startsWith('c_user='))
      const uid = cUser ? cUser.split('=')[1] : null
      res.json({ ok: true, uid, cookieCount: fbSessionCookies.length, method: 'sqlite' })
    } catch (e2) {
      res.json({ ok: false, error: `CDP: ${e.message} | SQLite: ${e2.message}` })
    }
  }
})

// SQLite fallback (kept for when browser is closed or CDP fails)
function extractFacebookCookiesFromBrave_sqlite() {
  try {
    const pythonScript = __dirname + '/extract-brave-cookies.py';
    const output = execSync(`python3 ${pythonScript}`, { encoding: 'utf-8' }).trim();
    if (output.startsWith('SUCCESS:')) {
      const parts = output.replace('SUCCESS:', '').trim().split('; ');
      const cookies = parts.filter(c => c.trim().length > 0);
      if (cookies.some(c => c.startsWith('c_user=') || c.startsWith('xs='))) {
        return cookies;
      }
    }
    throw new Error('Python extraction output was invalid: ' + output);
  } catch (err) {
    throw new Error('Could not extract v11 c_user or xs cookies via python: ' + err.message);
  }
}

// Facebook auth: status


// Stored accounts file (per-port, maps username -> cookies array)
const ACCOUNTS_FILE = join(__dirname, `.scroller-accounts-${PORT}.json`)
let storedAccounts = {}
try {
  if (existsSync(ACCOUNTS_FILE)) {
    storedAccounts = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'))
    console.log(`👥 Loaded ${Object.keys(storedAccounts).length} stored accounts`)
  }
} catch (e) {}

function saveAccounts() {
  try { writeFileSync(ACCOUNTS_FILE, JSON.stringify(storedAccounts, null, 2)) } catch (e) {}
}

// Verify cookies against Reddit API and return username
async function verifyRedditCookies(cookies) {
  const testResponse = await fetch('https://old.reddit.com/api/me.json', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Cookie': cookies.join('; ')
    }
  })
  const meData = await testResponse.text()
  try {
    const parsed = JSON.parse(meData)
    return parsed?.data?.name || null
  } catch (e) { return null }
}

// Check current login status
app.get('/auth/status', async (req, res) => {
  try {
    const cookies = getSessionCookies('default')
    if (!cookies.some(c => c.startsWith('reddit_session='))) {
      return res.json({ loggedIn: false, accounts: Object.keys(storedAccounts) })
    }
    const username = await verifyRedditCookies(cookies)
    if (username) {
      // Save/update this account
      storedAccounts[username] = [...cookies]
      saveAccounts()
      res.json({ loggedIn: true, username, accounts: Object.keys(storedAccounts) })
    } else {
      res.json({ loggedIn: false, accounts: Object.keys(storedAccounts) })
    }
  } catch (error) {
    res.json({ loggedIn: false, accounts: Object.keys(storedAccounts) })
  }
})

// Logout: clear active session (keeps stored accounts)
app.post('/auth/logout', (req, res) => {
  const cookies = getSessionCookies('default')
  cookies.length = 0
  saveCookies()
  console.log('🔓 Logged out - active session cleared')
  res.json({ ok: true, accounts: Object.keys(storedAccounts) })
})

// Switch to a stored account
app.post('/auth/switch', express.json(), (req, res) => {
  const { username } = req.body
  if (!username || !storedAccounts[username]) {
    return res.json({ ok: false, error: 'Account not found' })
  }
  const cookies = getSessionCookies('default')
  cookies.length = 0
  storedAccounts[username].forEach(c => cookies.push(c))
  saveCookies()
  console.log(`🔄 Switched to account: ${username}`)
  res.json({ ok: true, username })
})

// Add account: check if proxy has captured new cookies and store them
app.get('/auth/add-account', async (req, res) => {
  try {
    const cookies = getSessionCookies('default')
    const username = await verifyRedditCookies(cookies)
    if (username) {
      storedAccounts[username] = [...cookies]
      saveAccounts()
      console.log(`✅ Stored account: ${username}`)
      res.json({ ok: true, username, accounts: Object.keys(storedAccounts) })
    } else {
      // Try Brave extraction as fallback (only works on server machine)
      try {
        const cookieValue = extractBraveCookie()
        const newCookies = [`reddit_session=${cookieValue}`]
        const braveUser = await verifyRedditCookies(newCookies)
        if (braveUser) {
          const currentCookies = getSessionCookies('default')
          const idx = currentCookies.findIndex(c => c.startsWith('reddit_session='))
          if (idx >= 0) currentCookies[idx] = `reddit_session=${cookieValue}`
          else currentCookies.push(`reddit_session=${cookieValue}`)
          saveCookies()
          storedAccounts[braveUser] = [...currentCookies]
          saveAccounts()
          res.json({ ok: true, username: braveUser, accounts: Object.keys(storedAccounts) })
        } else {
          res.json({ ok: false, error: 'Could not verify login. Try again.' })
        }
      } catch (e) {
        res.json({ ok: false, error: 'Could not verify login. Try again.' })
      }
    }
  } catch (error) {
    res.json({ ok: false, error: error.message })
  }
})

// Dedicated login POST - handles Reddit's redirects properly
// Login page popup - instructs user to log in via Brave on the server
app.get('/auth/login-page', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Add Reddit Account</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1a1a1b; color: #d7dadc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .login-box { background: #272729; border: 1px solid #343536; border-radius: 12px; padding: 32px; width: 400px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
    h2 { margin-bottom: 16px; font-size: 20px; text-align: center; }
    .steps { margin-bottom: 20px; }
    .step { display: flex; gap: 10px; margin-bottom: 12px; font-size: 14px; line-height: 1.4; }
    .step-num { background: #ff4500; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; flex-shrink: 0; }
    button { width: 100%; padding: 12px; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s; margin-bottom: 8px; }
    .btn-extract { background: #ff4500; color: white; }
    .btn-extract:hover { background: #cc3700; }
    .btn-extract:disabled { background: #555; cursor: not-allowed; }
    .msg { font-size: 13px; margin-top: 8px; text-align: center; }
    .msg.error { color: #ff4500; }
    .msg.success { color: #28a745; }
  </style>
</head>
<body>
  <div class="login-box">
    <h2>Add Reddit Account</h2>
    <div class="steps">
      <div class="step"><span class="step-num">1</span><span>Log into Reddit in Brave on the server machine</span></div>
      <div class="step"><span class="step-num">2</span><span>Click the button below to pull the session</span></div>
    </div>
    <button class="btn-extract" id="extractBtn" onclick="extract()">Pull Account from Brave</button>
    <div class="msg" id="msg"></div>
  </div>
  <script>
    async function extract() {
      var btn = document.getElementById('extractBtn');
      var msg = document.getElementById('msg');
      btn.disabled = true;
      btn.textContent = 'Extracting...';
      msg.className = 'msg';
      msg.textContent = '';
      try {
        var resp = await fetch('/auth/add-account');
        var data = await resp.json();
        if (data.ok) {
          msg.className = 'msg success';
          msg.textContent = 'Added u/' + data.username + '!';
          setTimeout(function() { window.close(); }, 1200);
        } else {
          msg.className = 'msg error';
          msg.textContent = data.error || 'Failed to extract session';
        }
      } catch (e) {
        msg.className = 'msg error';
        msg.textContent = 'Connection error';
      }
      btn.disabled = false;
      btn.textContent = 'Pull Account from Brave';
    }
  </script>
</body>
</html>`)
})

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
      saveCookies()
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

// Media proxy for v.redd.it, i.redd.it, preview.redd.it
app.all('/api/media/v/*', async (req, res) => {
  try {
    const urlPath = req.path.substring('/api/media/v'.length)
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''
    const mediaUrl = `https://v.redd.it${urlPath}${queryString}`

    console.log(`🎬 Proxying video: ${mediaUrl}`)

    const headers = {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      'Referer': 'https://www.reddit.com/'
    }
    if (req.headers.range) {
      headers['Range'] = req.headers.range
    }

    const response = await fetch(mediaUrl, { method: 'GET', headers })
    const buffer = await response.buffer()

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Accept-Ranges', 'bytes')
    const ct = response.headers.get('content-type')
    if (ct) res.setHeader('Content-Type', ct)
    const cl = response.headers.get('content-length')
    if (cl) res.setHeader('Content-Length', cl)
    const cr = response.headers.get('content-range')
    if (cr) res.setHeader('Content-Range', cr)

    res.status(response.status).send(buffer)
  } catch (error) {
    console.error('❌ Video proxy error:', error.message)
    res.status(500).send('Video proxy error: ' + error.message)
  }
})

app.all('/api/media/i/*', async (req, res) => {
  try {
    const urlPath = req.path.substring('/api/media/i'.length)
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''
    const mediaUrl = `https://i.redd.it${urlPath}${queryString}`

    console.log(`🖼️ Proxying image: ${mediaUrl}`)

    const headers = {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      'Referer': 'https://www.reddit.com/'
    }
    if (req.headers.range) {
      headers['Range'] = req.headers.range
    }

    const response = await fetch(mediaUrl, { method: 'GET', headers })
    const buffer = await response.buffer()

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Accept-Ranges', 'bytes')
    const ct = response.headers.get('content-type')
    if (ct) res.setHeader('Content-Type', ct)
    const cl = response.headers.get('content-length')
    if (cl) res.setHeader('Content-Length', cl)
    const cr = response.headers.get('content-range')
    if (cr) res.setHeader('Content-Range', cr)

    res.status(response.status).send(buffer)
  } catch (error) {
    console.error('❌ Image proxy error:', error.message)
    res.status(500).send('Image proxy error: ' + error.message)
  }
})

app.all('/api/media/preview/*', async (req, res) => {
  try {
    const urlPath = req.path.substring('/api/media/preview'.length)
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''
    const mediaUrl = `https://preview.redd.it${urlPath}${queryString}`

    console.log(`🖼️ Proxying preview: ${mediaUrl}`)

    const headers = {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      'Referer': 'https://www.reddit.com/'
    }
    if (req.headers.range) {
      headers['Range'] = req.headers.range
    }

    const response = await fetch(mediaUrl, { method: 'GET', headers })
    const buffer = await response.buffer()

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Accept-Ranges', 'bytes')
    const ct = response.headers.get('content-type')
    if (ct) res.setHeader('Content-Type', ct)
    const cl = response.headers.get('content-length')
    if (cl) res.setHeader('Content-Length', cl)
    const cr = response.headers.get('content-range')
    if (cr) res.setHeader('Content-Range', cr)

    res.status(response.status).send(buffer)
  } catch (error) {
    console.error('❌ Preview proxy error:', error.message)
    res.status(500).send('Preview proxy error: ' + error.message)
  }
})

// Proxy for /api/* requests
app.all('/api/*', async (req, res) => {
  try {
    const sessionId = 'default'
    // Ensure we don't have double /api/api
    let pathAfterApi = req.path.substring('/api'.length) || '/'
    if (pathAfterApi.startsWith('/api')) {
      pathAfterApi = pathAfterApi.substring('/api'.length) || '/'
    }
    const queryString = req.originalUrl.includes('?') ? req.originalUrl.substring(req.originalUrl.indexOf('?')) : ''
    const redditUrl = 'https://old.reddit.com' + pathAfterApi + queryString

    console.log(`📡 Proxying: ${redditUrl} (Path: ${pathAfterApi})`)

    const headers = {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      'Referer': 'https://old.reddit.com/',
      'Origin': 'https://old.reddit.com'
    }

    // Forward relevant headers from client
    Object.keys(req.headers).forEach(key => {
      const lowerKey = key.toLowerCase();
      if (!['host', 'cookie', 'connection', 'content-length', 'accept-encoding', 'referer', 'origin'].includes(lowerKey)) {
        headers[key] = req.headers[key];
      }
    });

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
      const reqContentType = req.headers['content-type'] || ''
      if (reqContentType.includes('application/x-www-form-urlencoded') && req.body && typeof req.body === 'object') {
        // Re-encode parsed form data back to URL-encoded format
        fetchOptions.body = new URLSearchParams(req.body).toString()
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
      } else {
        let bodyData = ''
        if (req.body) {
          bodyData = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
        } else {
          for await (const chunk of req) {
            bodyData += chunk
          }
        }
        if (bodyData) {
          fetchOptions.body = bodyData
        }
      }
    }

    const response = await fetch(redditUrl, fetchOptions)
    console.log(`⏪ Response from Reddit: ${response.status} ${response.statusText} for ${pathAfterApi}`)

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
      saveCookies()
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
      html = html.replace(/https:\/\/v\.redd\.it/g, '/api/media/v')
      html = html.replace(/https:\/\/i\.redd\.it/g, '/api/media/i')
      html = html.replace(/https:\/\/preview\.redd\.it/g, '/api/media/preview')
      html = html.replace(/https:\/\/w3-reporting\.reddit\.com/g, '/api/tracking/w3-reporting')
      html = html.replace(/https:\/\/error-tracking\.reddit\.com/g, '/api/tracking/error-tracking')

      // Inject override script in head
      const injectScript = `<script>
  function rewriteUrl(url) {
    if (typeof url !== 'string' || url.length === 0 || url.startsWith('data:') || url.startsWith('blob:')) return url
    
    // Handle root-relative paths
    if (url.startsWith('/')) {
      if (url.startsWith('/api')) return url; // Already prefixed
      if (!url.startsWith('/@') && !url.startsWith('/src') && !url.startsWith('/node_modules') && !url.startsWith('/popup') && !url.startsWith('/auth')) {
        return '/api' + url
      }
      return url;
    }

    // Absolute URLs
    if (url.includes('://') || url.startsWith('//')) {
      if (url.includes('reddit.com') || url.includes('redditstatic.com') || url.includes('redd.it')) {
        let path = '';
        if (url.startsWith('https://www.reddit.com')) path = url.substring(22)
        else if (url.startsWith('https://old.reddit.com')) path = url.substring(22)
        else if (url.startsWith('https://reddit.com')) path = url.substring(18)
        else if (url.startsWith('//www.reddit.com')) path = url.substring(16)
        else if (url.startsWith('//old.reddit.com')) path = url.substring(16)
        
        if (path) return path.startsWith('/api') ? path : '/api' + path;

        if (url.startsWith('https://www.redditstatic.com')) return '/api/static/' + url.substring(28)
        if (url.startsWith('https://redditstatic.com')) return '/api/static/' + url.substring(24)
        if (url.startsWith('https://v.redd.it')) return '/api/media/v' + url.substring(17)
        if (url.startsWith('https://i.redd.it')) return '/api/media/i' + url.substring(17)
        if (url.startsWith('https://preview.redd.it')) return '/api/media/preview' + url.substring(23)
      }
      return url;
    }
    
    // Truly relative URLs (no leading slash, no protocol) - e.g. "expando/..."
    // We MUST prepend /api/ because the current page is effectively at /api/ (or root)
    if (window.location.pathname.startsWith('/api')) {
       return url; // Browser will resolve relative to current /api/... path
    }
    return '/api/' + url;
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
</script>
<script>
(function() {
  var PROXY_PREFIX = '/api';
  var REDDIT_BASE = 'https://www.reddit.com';
  var REDDIT_PATH_RE = /^\\/(r\\/|u\\/|user\\/|comments\\/|message\\/|submit|wiki\\/|search|prefs\\/|over18|domain\\/|duplicates\\/|report|live\\/|gallery\\/|poll\\/)/;
  var SKIP_RE = /^\\/(api\\/static\\/|api\\/tracking\\/|proxy-static\\/)/;
  var nativeHrefDesc = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'href');

  function shouldFixLink(href) {
    if (!href || href.startsWith('javascript:') || href === '#') return false;
    var path = href;
    if (PROXY_PREFIX && path.startsWith(PROXY_PREFIX + '/')) {
      path = path.substring(PROXY_PREFIX.length);
    } else if (PROXY_PREFIX && path.startsWith(PROXY_PREFIX)) {
      path = path.substring(PROXY_PREFIX.length) || '/';
    }
    if (SKIP_RE.test(path)) return false;
    
    // Catch-all: If it looks like a relative path, treat it as a Reddit link
    if (path.startsWith('/')) return true;
    
    return false;
  }

  function getProxyPath(href) {
    if (PROXY_PREFIX && href.startsWith(PROXY_PREFIX)) return href;
    return PROXY_PREFIX + href;
  }

  function getRealUrl(href) {
    var path = href;
    if (PROXY_PREFIX && path.startsWith(PROXY_PREFIX + '/')) {
      path = path.substring(PROXY_PREFIX.length);
    } else if (PROXY_PREFIX && path.startsWith(PROXY_PREFIX)) {
      path = path.substring(PROXY_PREFIX.length) || '/';
    }
    return REDDIT_BASE + path;
  }

  function fixLink(a) {
    var href = a.getAttribute('href');
    if (!href || a.hasAttribute('data-proxy-href')) return;
    if (!shouldFixLink(href)) return;
    var proxyPath = getProxyPath(href);
    a.setAttribute('data-proxy-href', proxyPath);
    nativeHrefDesc.set.call(a, getRealUrl(href));
  }

  function fixAllLinks(root) {
    var links = (root || document).querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) fixLink(links[i]);
  }

  document.addEventListener('DOMContentLoaded', function() { fixAllLinks(); });

  var observer = new (window.OriginalMutationObserver || MutationObserver)(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (node.nodeType === 1) {
          if (node.tagName === 'A') fixLink(node);
          if (node.querySelectorAll) fixAllLinks(node);
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('click', function(e) {
    var a = e.target.closest ? e.target.closest('a[data-proxy-href]') : null;
    if (!a) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    window.location.href = a.getAttribute('data-proxy-href');
  }, true);
})();
</script>
<script>
(function() {
  var loading = false;
  var pageNum = 1;
  var seenPosts = new Set();

  // Track posts already on the initial page
  document.querySelectorAll('#siteTable > .thing[data-fullname]').forEach(function(post) {
    seenPosts.add(post.getAttribute('data-fullname'));
  });

  function getNextUrl() {
    var nextBtn = document.querySelector('.next-button a');
    if (!nextBtn) return null;
    return nextBtn.getAttribute('data-proxy-href') || nextBtn.getAttribute('href');
  }

  function loadNextPage() {
    if (loading) return;
    var nextUrl = getNextUrl();
    if (!nextUrl) return;

    loading = true;
    pageNum++;

    var marker = document.createElement('div');
    marker.style.cssText = 'text-align:center;padding:20px;color:#818384;font-size:14px;border-top:2px solid #343536;margin:10px 0;';
    var siteTable = document.querySelector('#siteTable');
    // if (siteTable) siteTable.appendChild(marker);

    fetch(nextUrl)
      .then(function(r) { return r.text(); })
      .then(function(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var newPosts = doc.querySelectorAll('#siteTable > .thing');
        var newNext = doc.querySelector('.next-button a');

        if (siteTable && newPosts.length > 0) {
          newPosts.forEach(function(post) {
            var fullname = post.getAttribute('data-fullname');
            if (fullname && seenPosts.has(fullname)) return;
            if (fullname) seenPosts.add(fullname);
            siteTable.appendChild(post);
          });

          // Update next button for the following page
          var oldNext = document.querySelector('.next-button a');
          if (oldNext && newNext) {
            var newHref = newNext.getAttribute('href');
            oldNext.setAttribute('data-proxy-href', newHref);
          } else if (!newNext) {
            var nb = document.querySelector('.next-button');
            if (nb) nb.remove();
          }
        } else {
          marker.textContent = 'No more posts';
        }
        loading = false;
      })
      .catch(function(err) {
        console.error('Infinite scroll error:', err);
        marker.textContent = 'Error loading page';
        loading = false;
      });
  }

  window.addEventListener('scroll', function() {
    if (document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 800) {
      loadNextPage();
    }
  });
})();
</script>`

      const nightModeCSS = `<style id="scroller-nightmode">
  /* Base */
  html, body, body > .content, #siteTable, .listing-page, .comments-page,
  .search-page, .wiki-page, .other-discussions, .organic-listing {
    background-color: #1a1a1b !important;
    color: #d7dadc !important;
  }

  /* Header */
  #header, #header-bottom-left {
    background-color: #1a1a1b !important;
    border-bottom: 1px solid #343536 !important;
  }
  #header-img, #header-img-a img {
    filter: invert(1) hue-rotate(180deg) brightness(1.2) !important;
  }
  #header .pagename a, #header-bottom-left a {
    color: #d7dadc !important;
  }
  .tabmenu li a {
    background-color: #272729 !important;
    color: #818384 !important;
    border-color: #343536 !important;
  }
  .tabmenu li.selected a {
    background-color: #1a1a1b !important;
    color: #d7dadc !important;
    border-bottom-color: #1a1a1b !important;
  }
  .tabmenu li a:hover { background-color: #343536 !important; color: #d7dadc !important; }
  #header-bottom-right { color: #818384 !important; }
  #header-bottom-right a { color: #4fbcff !important; }
  #sr-header-area, #sr-more-link {
    background-color: #272729 !important;
    color: #818384 !important;
    border-color: #343536 !important;
  }
  #sr-header-area a { color: #d7dadc !important; }
  .sr-bar a { color: #818384 !important; }
  .separator { color: #343536 !important; }
  #searchexpander, .search-expander { background-color: #272729 !important; }
  #search input[type="text"], #searchexpander input {
    background-color: #272729 !important;
    color: #d7dadc !important;
    border-color: #343536 !important;
  }

  /* Sidebar */
  .side, .sidebox, .spacer .titlebox, .linkinfo,
  .side .md, .side .spacer {
    background-color: #1a1a1b !important;
    color: #d7dadc !important;
    border-color: #343536 !important;
  }
  .morelink { background-color: #272729 !important; border-color: #343536 !important; }
  .morelink a { color: #d7dadc !important; }
  .morelink .nub, .sidebox .nub, .nub {
    display: none !important;
  }
  .sidebox .spacer, .account-activity-box,
  .premium-banner, .premium-banner *,
  .create-your-own, .goldvertisement {
    background-color: #272729 !important;
    color: #d7dadc !important;
    border-color: #343536 !important;
  }
  .goldvertisement a, .premium-banner a { color: #4fbcff !important; }
  .sidecontentbox, .sidecontentbox .content {
    background-color: #1a1a1b !important;
    border-color: #343536 !important;
  }
  .sidecontentbox .title h2 {
    color: #d7dadc !important;
  }
  .titlebox .bottom {
    border-color: #343536 !important;
  }
  .subscribe-button .add, .subscribe-button .remove {
    background-color: #272729 !important;
    color: #d7dadc !important;
    border-color: #343536 !important;
  }
  .leavemoderator, .leavecontributor { background-color: #272729 !important; }

  /* Posts / Things */
  .thing, .link, .comment, .nestedlisting, .panestack-title,
  .comment .midcol, .comment .entry, .comment .child,
  .sitetable, .sitetable .thing, .nestedlisting .thing {
    background-color: #1a1a1b !important;
    color: #d7dadc !important;
  }
  div.thing.comment,
  div.thing.comment > .midcol,
  div.thing.comment > .entry,
  div.thing.comment > .child,
  div.thing.comment > .child > .sitetable,
  div.thing.comment > .child > .sitetable > .thing,
  div.comment.noncollapsed,
  div.comment.collapsed {
    background-color: #1a1a1b !important;
    color: #d7dadc !important;
  }
  .link .entry, .comment .entry {
    background-color: transparent !important;
  }
  .link, .thing.link {
    border-bottom: 0 !important;
    margin-bottom: 0 !important;
  }
  #siteTable > .thing + .clearleft + .thing,
  #siteTable > .thing + .thing {
    border-top: 6px solid #343536 !important;
  }
  .promoted, .promotedlink, .thing.promoted, .thing.promotedlink {
    border: 1px solid #343536 !important;
    outline: none !important;
    background-color: #272729 !important;
    border-radius: 4px !important;
    padding: 8px !important;
  }
  .link .title a, .link .title a:visited {
    color: #d7dadc !important;
  }
  .link .title a:hover {
    color: #4fbcff !important;
  }
  a { color: #4fbcff !important; }
  a:visited { color: #9b8dff !important; }
  .md, .md p, .md li, .md h1, .md h2, .md h3, .usertext-body {
    color: #d7dadc !important;
  }
  .md blockquote {
    border-left-color: #4fbcff !important;
    color: #818384 !important;
  }
  .md code, .md pre {
    background-color: #272729 !important;
    color: #d7dadc !important;
    border-color: #343536 !important;
  }
  .comment .author { color: #4fbcff !important; }
  .tagline, .tagline a, .search-result-meta {
    color: #818384 !important;
  }

  /* Votes */
  .arrow.up:hover, .arrow.upmod { color: #ff4500 !important; }
  .arrow.down:hover, .arrow.downmod { color: #7193ff !important; }
  .rank, .midcol .rank, .thing .rank { display: none !important; width: 0 !important; overflow: hidden !important; }
  .score, .score.likes, .score.dislikes, .score.unvoted { color: #818384 !important; }

  /* Footer */
  .footer, .footer-parent, .bottommenu, .debuginfo {
    background-color: #1a1a1b !important;
    color: #818384 !important;
    border-color: #343536 !important;
  }

  /* Forms & inputs */
  .infobar, .roundfield, .login-form-side {
    background-color: #272729 !important;
    color: #d7dadc !important;
    border-color: #343536 !important;
  }
  input, textarea, select {
    background-color: #272729 !important;
    color: #d7dadc !important;
    border-color: #343536 !important;
  }
  .btn, button {
    background-color: #272729 !important;
    color: #d7dadc !important;
    border-color: #343536 !important;
  }

  /* Menu / dropdowns */
  .menuarea, .dropdown.lightdrop .selected, .drop-choices {
    background-color: #272729 !important;
    color: #d7dadc !important;
    border-color: #343536 !important;
  }
  .drop-choices a { color: #d7dadc !important; }
  .drop-choices a:hover { background-color: #343536 !important; }

  /* Comments page */
  .commentarea, .commentarea > .sitetable,
  .commentarea .comment, .commentarea .comment .entry,
  .commentarea .panestack-title, .commentarea .menuarea {
    background-color: #1a1a1b !important;
    color: #d7dadc !important;
  }
  .comment .child, .comment .showreplies {
    border-left-color: #343536 !important;
  }
  .comment.collapsed .entry { background-color: #1a1a1b !important; }
  .comment .usertext-body .md {
    background-color: transparent !important;
  }
  /* Sorted by dropdown area */
  .commentarea .menuarea, .commentarea .menuarea *,
  .commentarea .panestack-title,
  .dropdown.lightdrop .selected,
  .commentarea .flatlist, .commentarea .flat-list {
    background-color: #1a1a1b !important;
    color: #d7dadc !important;
  }
  /* Main post on comment pages */
  .linklisting, .linklisting .thing, .linklisting .link,
  .linklisting .link .entry, .linklisting .link .top-matter,
  .linklisting .link .usertext-body {
    background-color: #1a1a1b !important;
    color: #d7dadc !important;
  }
  /* Reply text box */
  .usertext-edit, .usertext-edit textarea,
  .usertext-edit .md, .usertext-edit .bottom-area,
  .usertext button, .save-button,
  .RESDialogSmall, .RESDialogSmall * {
    background-color: #272729 !important;
    color: #d7dadc !important;
    border-color: #343536 !important;
  }
  /* Sticky / mod / automod comments */
  .comment .stickied-tagline, .stickied .entry,
  .comment.stickied, .comment.stickied .entry,
  .comment.stickied .usertext-body .md {
    background-color: #1a1a1b !important;
  }
  /* Page content wrapper */
  .content[role="main"] {
    background-color: #1a1a1b !important;
    color: #d7dadc !important;
  }

  /* Content policy / mod warnings / infobar */
  .content-policy-warning, .content-policy-warning *,
  .quarantine-notice, .quarantine-notice *,
  .infobar-toaster, .infobar-toaster *,
  .interstitial, .interstitial *,
  .content[role="main"], .content {
    background-color: #1a1a1b !important;
    color: #d7dadc !important;
  }
  .content-policy-warning a, .quarantine-notice a { color: #4fbcff !important; }

  /* Catch-all for remaining white backgrounds */
  .commentarea, .commentarea *,
  .linklisting, .linklisting *,
  .content[role="main"],
  .sitetable.listing, .sitetable.listing > *,
  .nestedlisting, .nestedlisting * {
    background-color: #1a1a1b !important;
  }
  /* Restore specific backgrounds that need #272729 */
  .expando, .selftext, .md code, .md pre,
  .usertext-edit, .usertext-edit textarea,
  .sidebox, .sidebox *, .morelink,
  .btn, button, input, textarea, select,
  .promoted, .promotedlink, .thing.promoted {
    background-color: #272729 !important;
  }

  /* Video player - keep overlays transparent so video is visible */
  video,
  .media-preview, .media-preview *,
  .media-preview-content, .media-preview-content *,
  .video-player, .video-player *,
  [id^="video-"], [id^="video-"] *,
  [id^="media-preview-"], [id^="media-preview-"] * {
    background-color: transparent !important;
  }
  
  /* EXPLICITLY show playback controls and progress bars */
  .reddit-video-player-root,
  .playback-controls,
  .progress-bar, .progress-bar-fill, .progress-bar-bg {
    background-color: rgba(0,0,0,0.5) !important;
    opacity: 1 !important;
    visibility: visible !important;
    display: block !important;
  }
  
  .progress-bar-fill {
    background-color: #ff4500 !important;
    height: 100% !important;
    display: block !important;
  }

  /* Fix expando button icons */
  .expando-button, .expando-button * {
    background-color: transparent !important;
  }

  .expando .media-preview {
    background-color: #000 !important;
  }

  /* Misc */
  hr, .thing .child { border-color: #343536 !important; }
  .clearleft + .clearleft { border-color: #343536 !important; }
  .expando { background-color: #272729 !important; border-color: #343536 !important; }
  .selftext, .usertext-edit { background-color: #272729 !important; }
  .nav-buttons, .nextprev { display: none !important; }
  .flair, .linkflairlabel {
    background-color: #272729 !important;
    color: #d7dadc !important;
    border-color: #343536 !important;
  }
  .thumbnail { opacity: 0.9; }
  .thing .flat-list li a { color: #818384 !important; }
  .thing .flat-list li a:hover { color: #d7dadc !important; }
  .organic-listing { border-color: #343536 !important; }
  .listing-chooser-collapsed, .listing-chooser,
  .listing-chooser *, .listing-chooser .grippy {
    background-color: #272729 !important;
    color: #d7dadc !important;
    border-color: #343536 !important;
  }
  .listing-chooser li { border-color: #343536 !important; background-color: #272729 !important; }
  .listing-chooser li:hover { background-color: #343536 !important; }
  .listing-chooser li a { color: #d7dadc !important; }
  .listing-chooser li.selected { background-color: #1a1a1b !important; }
  .listing-chooser .grippy {
    background-color: #343536 !important;
    border-color: #343536 !important;
  }
  .listing-chooser .grippy:hover { background-color: #4a4a4c !important; }
  .listing-chooser .grippy::after, .listing-chooser .grippy::before,
  .listing-chooser-collapsed::after, .listing-chooser-collapsed::before {
    border-color: transparent transparent transparent #818384 !important;
  }
  .listing-chooser-collapsed { background-color: #272729 !important; }
  .listing-chooser .title { color: #818384 !important; }
  .wiki-page .wiki-page-content { background-color: #1a1a1b !important; }
  .res-nightmode .thing, .RES-keyNav-activeElement, .res-selected {
    background-color: #272729 !important;
    outline-color: #343536 !important;
  }

  /* User bar (top right: username, mail, prefs) */
  #header-bottom-right, #header-bottom-right * {
    background-color: #272729 !important;
    color: #d7dadc !important;
    border-color: #343536 !important;
  }
  #header-bottom-right .user a { color: #4fbcff !important; }
  #header-bottom-right .separator { color: #343536 !important; }
  #mail, #modmail { filter: brightness(0.8) !important; }

  /* Vote arrows area */
  .midcol, .arrow { background-color: transparent !important; }
  .thing .midcol { background-color: transparent !important; }

  /* Reddit Premium / gold box */
  .premium-banner, .premium-banner *,
  .goldvertisement, .goldvertisement *,
  .side .gold-accent, .side .gold-accent * {
    background-color: #272729 !important;
    color: #d7dadc !important;
    border-color: #343536 !important;
  }
  .goldvertisement .inner, .premium-banner .inner { background-color: #272729 !important; }
  .goldvertisement img, .premium-banner img { filter: brightness(0.9) !important; }

  /* Create your own subreddit / bottom sidebar boxes */
  .side .spacer, .side .spacer * {
    background-color: #1a1a1b !important;
    color: #d7dadc !important;
  }
  .side .spacer .sidebox, .side .spacer .sidebox * {
    background-color: #272729 !important;
    color: #d7dadc !important;
    border-color: #343536 !important;
  }
  .sidebox .nub {
    display: none !important;
  }

  /* Catch-all: any remaining white backgrounds in the side */
  .side div[style*="background"], .side .content {
    background-color: #272729 !important;
  }

  /* Reddit snoo footer icon */
  .footer .bottommenu img, #footer img { filter: invert(1) brightness(0.8) !important; }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 0px !important; display: none !important; }
  ::-webkit-scrollbar-track { background: transparent !important; }
  ::-webkit-scrollbar-thumb { background: transparent !important; }
  ::-webkit-scrollbar-thumb:hover { background: transparent !important; }
  body { scrollbar-width: none !important; -ms-overflow-style: none !important; overflow-y: scroll !important; }
</style>`

      html = html.replace(/<head[^>]*>/i, `<head>${injectScript}${nightModeCSS}<link rel="stylesheet" href="/custom.css"><script src="/custom.js" defer></script>`)
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
    server: { middlewareMode: true, hmr: { port: PORT + 1000 } }
  })

  // Use vite's connect instance as middleware
// Direct proxy for Facebook — forwards session cookies from Brave extraction
app.get('/fb-api/sw.js', (req, res) => {
  const swContent = `
const PROXY_ORIGIN = self.location.origin;
const FB_DOMAINS = ['facebook.com', 'fbcdn.net', 'fbsbx.com', 'messenger.com', 'facebook.net'];

function rewriteUrl(url) {
  if (typeof url !== 'string' || url.startsWith('blob:') || url.startsWith('data:') || url.includes('doubleclick')) return url;
  
  let absoluteUrl;
  try {
    absoluteUrl = new URL(url, self.location.href).href;
  } catch (e) { return url; }

  if (FB_DOMAINS.some(d => absoluteUrl.includes(d))) {
    if (absoluteUrl.startsWith(PROXY_ORIGIN + '/fb-api/') || absoluteUrl.startsWith(PROXY_ORIGIN + '/fb-static/')) {
      return url;
    }
    const isApi = absoluteUrl.includes('facebook.com') || absoluteUrl.includes('fbsbx.com') ||
                  absoluteUrl.includes('/ajax/') || absoluteUrl.includes('/api/') || 
                  absoluteUrl.includes('/async/') || absoluteUrl.includes('/bloks');
    return (isApi ? '/fb-api/' : '/fb-static/') + absoluteUrl;
  }
  return url;
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const newUrl = rewriteUrl(event.request.url);
  if (newUrl !== event.request.url) {
    const headers = new Headers(event.request.headers);
    headers.set('X-Proxied-By', 'Antigravity-SW');
    
    const requestInit = {
      method: event.request.method,
      headers: headers,
      mode: 'cors',
      credentials: 'omit', // Proxy server handles session cookies
      cache: event.request.cache,
      redirect: 'manual' 
    };

    if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
      event.respondWith(
        event.request.clone().arrayBuffer().then(body => {
          return fetch(newUrl, { ...requestInit, body });
        })
      );
    } else {
      event.respondWith(fetch(newUrl, requestInit));
    }
    return;
  }
  event.respondWith(fetch(event.request));
});
  `;
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.send(swContent);
});

app.all('/fb-api/*', async (req, res) => {
  try {
    const domain = 'https://m.facebook.com';
    const pathAfterPrefix = req.path.substring('/fb-api'.length) || '/';
    
    let fbUrl;
    // If it starts with /http, it's a full URL passed by our shim
    if (pathAfterPrefix.startsWith('/http')) {
      fbUrl = pathAfterPrefix.substring(1) + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
    } else {
      // Standard relative path from Facebook Lite
      fbUrl = `${domain}${pathAfterPrefix}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`;
    }

    console.log(`[FB] Proxying: ${fbUrl} (${fbSessionCookies.length} cookies)`);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'identity',
      'Referer': 'https://m.facebook.com/'
    };
    
    if (fbSessionCookies.length > 0) {
      headers['Cookie'] = fbSessionCookies.join('; ');
    }
    
    const fetchOptions = { method: req.method, headers, redirect: 'follow' };
    if (req.method !== 'GET' && req.method !== 'HEAD' && Object.keys(req.body || {}).length > 0) {
      fetchOptions.body = new URLSearchParams(req.body).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    
    const response = await fetch(fbUrl, fetchOptions);
    const contentType = response.headers.get('content-type');

    // Capture cookies
    const rawCookies = response.headers.raw?.()['set-cookie'] || [];
    if (rawCookies.length > 0) {
      for (const cookieHeader of rawCookies) {
        const pair = cookieHeader.split(';')[0];
        const name = pair.split('=')[0];
        const idx = fbSessionCookies.findIndex(c => c.split('=')[0] === name);
        if (idx >= 0) fbSessionCookies[idx] = pair;
        else fbSessionCookies.push(pair);
      }
      saveFbCookies();
    }

    for (const [key, value] of response.headers) {
      const lowerKey = key.toLowerCase();
      if (lowerKey !== 'content-security-policy' && 
          lowerKey !== 'x-frame-options' && 
          lowerKey !== 'report-to' &&
          lowerKey !== 'content-encoding') {
        res.setHeader(key, value);
      }
    }
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
    
    if (contentType && contentType.includes('text/html')) {
      let html = await response.text();
      
      const proxyShim = `
<script id="fb-proxy-shim">
(function() {
  // Service Worker Registration (Ironclad Proxy)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/fb-api/sw.js', { scope: '/fb-api/' })
      .then(reg => console.log('🛡️ FB Proxy Service Worker Active', reg.scope))
      .catch(err => console.error('❌ FB Proxy SW Failed', err));
  }

  const originalFetch = window.fetch;
  const originalXHR = window.XMLHttpRequest.prototype.open;
  const originalSendBeacon = navigator.sendBeacon;
  
  function rewriteUrl(url) {
    if (typeof url !== 'string' || url.startsWith('blob:') || url.startsWith('data:') || url.includes('doubleclick')) return url;
    
    let absoluteUrl;
    try {
      absoluteUrl = new URL(url, window.location.href).href;
    } catch (e) { return url; }

    const fbDomains = ['facebook.com', 'fbcdn.net', 'fbsbx.com', 'messenger.com', 'facebook.net', 'z-m-static.xx.fbcdn.net'];
    if (fbDomains.some(d => absoluteUrl.includes(d))) {
      if (absoluteUrl.startsWith(window.location.origin + '/fb-api/') || absoluteUrl.startsWith(window.location.origin + '/fb-static/')) {
        return url;
      }
      // Use fb-api proxy for all logging, api, fbsbx and bloks calls
      const isApi = absoluteUrl.includes('facebook.com') || absoluteUrl.includes('fbsbx.com') ||
                    absoluteUrl.includes('/ajax/') || absoluteUrl.includes('/api/') || 
                    absoluteUrl.includes('/async/') || absoluteUrl.includes('/a/bz') || 
                    absoluteUrl.includes('/bloks');
      return (isApi ? '/fb-api/' : '/fb-static/') + absoluteUrl;
    }
    
    if (url.startsWith('/') && !url.startsWith('/fb-') && !url.startsWith('/api/') && !url.startsWith('/@vite/')) {
       return '/fb-api' + url;
    }
    return url;
  }

  window.fetch = function(input, init) {
    if (typeof input === 'string') {
      input = rewriteUrl(input);
    } else if (typeof input === 'object' && input.url) {
      const newUrl = rewriteUrl(input.url);
      if (newUrl !== input.url) {
        try {
          input = new Request(newUrl, input);
        } catch (e) { console.debug('FB-Shim: Request rewrite failed', e); }
      }
    }
    return originalFetch.call(this, input, init);
  };

  window.XMLHttpRequest.prototype.open = function(method, url) {
    arguments[1] = rewriteUrl(url);
    return originalXHR.apply(this, arguments);
  };
  
  if (originalSendBeacon) {
    navigator.sendBeacon = function(url, data) {
      return originalSendBeacon.call(this, rewriteUrl(url), data);
    };
  }
  
  try {
    const ImageOrig = window.Image;
    window.Image = function() {
      const img = new ImageOrig(...arguments);
      const nativeSrcSet = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src').set;
      Object.defineProperty(img, 'src', {
        set: function(v) { nativeSrcSet.call(this, rewriteUrl(v)); },
        get: function() { return this.getAttribute('src'); }
      });
      return img;
    };
  } catch (e) {}
  
  // Patch createElement for dynamic scripts/iframes
  const origCreateElement = document.createElement;
  document.createElement = function(tag) {
    const el = origCreateElement.call(document, tag);
    const lowTag = tag.toLowerCase();
    if (lowTag === 'script' || lowTag === 'iframe' || lowTag === 'link' || lowTag === 'img' || lowTag === 'embed') {
      const originalSetAttribute = el.setAttribute;
      el.setAttribute = function(name, value) {
        if (name.toLowerCase() === 'src' || name.toLowerCase() === 'href') value = rewriteUrl(value);
        return originalSetAttribute.call(this, name, value);
      };
      if (typeof el.src !== 'undefined') {
        Object.defineProperty(el, 'src', {
          set: function(v) { this.setAttribute('src', v); },
          get: function() { return this.getAttribute('src'); }
        });
      }
      if (typeof el.href !== 'undefined') {
        Object.defineProperty(el, 'href', {
          set: function(v) { this.setAttribute('href', v); },
          get: function() { return this.getAttribute('href'); }
        });
      }
    }
    return el;
  };
  
  // Patch Worker for background threads
  const origWorker = window.Worker;
  window.Worker = function(url, options) {
    return new origWorker(rewriteUrl(url), options);
  };
  
  // Intercept link clicks to keep navigation within the proxy
  document.addEventListener('click', function(e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    var newHref = rewriteUrl(href);
    if (newHref !== href) {
      e.preventDefault();
      window.location.href = newHref;
    }
  }, true);

  console.log('🛡️ FB Proxy Shim Active');
})();
</script>
`;

      html = html.replace(/<head[^>]*>/i, `$&<base href="/fb-api/">${proxyShim}`);

      // More aggressive domain replacement
      html = html.replace(/https?:\/\/(m|www|graph)\.facebook\.com/g, '/fb-api/https://$1.facebook.com');
      html = html.replace(/https?:\/\/static\.xx\.fbcdn\.net/g, '/fb-static/https://static.xx.fbcdn.net');
      html = html.replace(/https?:\/\/[a-z0-9-]+\.xx\.fbcdn\.net/g, (m) => '/fb-static/' + m);
      html = html.replace(/https?:\/\/(www|m)\.fbsbx\.com/g, '/fb-static/https://$1.fbsbx.com');
      html = html.replace(/https?:\/\/facebook\.com/g, '/fb-api/https://facebook.com');
      html = html.replace(/https?:\/\/www\.facebook\.net/g, '/fb-static/https://www.facebook.net');
      
      // Handle protocol-relative // in scripts/links (Fixed double-slash)
      html = html.replace(/"\/\/(m|www|graph|static|z-m-static|static\.xx)\./g, (m) => '"/fb-api/https://' + m.substring(2));
      
      // Patch preloads to point to the proxy
      html = html.replace(/href="https?:\/\/([a-z0-9.-]+\.fbcdn\.net|facebook\.com|fbsbx\.com)/g, (m) => {
        const url = m.substring(6);
        const isStatic = url.includes('fbcdn.net') || url.includes('fbsbx.com');
        return `href="${isStatic ? '/fb-static/' : '/fb-api/'}${url}`;
      });
      
      html = html.replace(/<meta[^>]*Content-Security-Policy[^>]*>/gi, '');
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } else {
      const buffer = await response.buffer();
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      res.send(buffer);
    }
  } catch (error) {
    console.error('[FB] Proxy error:', error.message);
    res.status(500).json({ error: 'Proxy error', message: error.message });
  }
});

app.all(['/a/*', '/async/*', '/ajax/*', '/bloks/*', '/api/*', '/paid_ads_pixel/*', '/tr/*'], (req, res) => {
  console.log(`[FB-REDIR] Redirecting misrouted path: ${req.url}`);
  res.redirect(307, '/fb-api' + req.url);
});

app.all('/fb-static/*', async (req, res) => {
  try {
    const pathAfterPrefix = req.path.substring('/fb-static'.length) || '/';
    let staticUrl;
    
    if (pathAfterPrefix.startsWith('/http')) {
      staticUrl = pathAfterPrefix.substring(1) + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
    } else {
      staticUrl = 'https://static.xx.fbcdn.net' + pathAfterPrefix +
        (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
    }

    console.log(`[FB-STATIC] Proxying: ${staticUrl}`);
    const response = await fetch(staticUrl, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15',
        'Referer': 'https://m.facebook.com/'
      }
    });

    if (!response.ok) {
      console.error(`[FB-STATIC] Fetch failed (${response.status}): ${staticUrl}`);
    }

    const ct = response.headers.get('content-type');
    res.setHeader('Content-Type', ct || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const buf = await response.buffer();
    res.send(buf);
  } catch (e) {
    console.error(`[FB-STATIC] Proxy error: ${e.message} for ${req.url}`);
    res.status(500).send('FB static proxy error: ' + e.message);
  }
});

  app.use(vite.middlewares)

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Dev server running on http://localhost:${PORT}`)
  })
}

start()

