import express from 'express'
import { createServer as createViteServer } from 'vite'
import fetch from 'node-fetch'
import crypto from 'crypto'
import { execSync, execFile } from 'child_process'
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

// Extract Facebook cookies from the LIVE Brave browser via CDP
// Tries port 9223 (Brave) first, then 9222 (fallback)
async function extractFacebookCookiesViaCDP(cdpPort, cdpHost) {
  if (!cdpPort) {
    // Try Brave's port first, then fallback
    for (const port of [9223, 9222]) {
      // Try both IPv4 and IPv6 loopback (Brave may bind to either)
      for (const host of ['127.0.0.1', '[::1]']) {
        try {
          const test = await fetch(`http://${host}:${port}/json`)
          if (test.ok) {
            console.log(`🔌 [FB] Found CDP on ${host}:${port}`)
            return extractFacebookCookiesViaCDP(port, host)
          }
        } catch (e) { /* try next */ }
      }
    }
    throw new Error('No CDP available on ports 9222-9223. Launch Brave with --remote-debugging-port=9222')
  }
  if (!cdpHost) cdpHost = '127.0.0.1'
  // Step 1: Get list of page targets and pick one to attach to
  const tabsRes = await fetch(`http://${cdpHost}:${cdpPort}/json`)
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
    // Replace all cookies (don't merge - stale cookies cause errors)
    fbSessionCookies.length = 0
    for (const cookie of extracted) {
      fbSessionCookies.push(cookie)
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

// Hidden posts (per-port) — fullnames the user has hidden, remembered across
// server restarts AND browser-data clears so they never reappear in the feed.
const HIDDEN_FILE = join(__dirname, `.hidden-posts-${PORT}.json`)
let hiddenPosts = []
try {
  if (existsSync(HIDDEN_FILE)) {
    const parsed = JSON.parse(readFileSync(HIDDEN_FILE, 'utf-8'))
    if (Array.isArray(parsed)) hiddenPosts = parsed
    console.log(`🙈 Loaded ${hiddenPosts.length} hidden posts`)
  }
} catch (e) {}

function saveHiddenPosts() {
  try { writeFileSync(HIDDEN_FILE, JSON.stringify(hiddenPosts, null, 2)) } catch (e) {}
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

// Hidden-posts API — the proxied page records hides here so they survive restarts.
app.get('/scroller/hidden', (req, res) => {
  res.json({ hidden: hiddenPosts })
})
app.post('/scroller/hide', (req, res) => {
  const fn = req.body && req.body.fullname
  if (fn && !hiddenPosts.includes(fn)) {
    hiddenPosts.push(fn)
    saveHiddenPosts()
  }
  res.json({ ok: true, count: hiddenPosts.length })
})
app.post('/scroller/unhide', (req, res) => {
  const fn = req.body && req.body.fullname
  if (fn) {
    const idx = hiddenPosts.indexOf(fn)
    if (idx >= 0) {
      hiddenPosts.splice(idx, 1)
      saveHiddenPosts()
    }
  }
  res.json({ ok: true, count: hiddenPosts.length })
})

// Reddit write actions (comment/edit/delete) + identity. The /api/* proxy mangles
// Reddit's /api/ POST paths (double-strips), so do them here directly with the
// stored cookies + modhash. /api/me.json gives the modhash (CSRF) AND the username.
const RUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
let cachedMe = { uh: null, name: null, ts: 0 }
async function getMe(cookies) {
  if (cachedMe.uh && Date.now() - cachedMe.ts < 10 * 60 * 1000) return cachedMe
  try {
    const r = await fetch('https://old.reddit.com/api/me.json', { headers: { 'Cookie': cookies.join('; '), 'User-Agent': RUA } })
    const d = (await r.json()).data
    if (d && d.modhash) cachedMe = { uh: d.modhash, name: d.name || null, ts: Date.now() }
  } catch (e) {}
  return cachedMe
}
async function redditPost(path, params, cookies) {
  const r = await fetch('https://old.reddit.com' + path, {
    method: 'POST',
    headers: { 'Cookie': cookies.join('; '), 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': RUA, 'Referer': 'https://old.reddit.com/', 'Origin': 'https://old.reddit.com' },
    body: new URLSearchParams(params).toString()
  })
  return r.json()
}

app.get('/scroller/me', async (req, res) => {
  const me = await getMe(getSessionCookies('default'))
  res.json({ name: me.name || null })
})

app.post('/scroller/comment', async (req, res) => {
  try {
    const { thing_id, text } = req.body || {}
    if (!thing_id || !text) return res.json({ ok: false, error: 'missing thing_id or text' })
    const cookies = getSessionCookies('default'); if (!cookies.length) return res.json({ ok: false, error: 'not logged in' })
    const me = await getMe(cookies); if (!me.uh) return res.json({ ok: false, error: 'not logged in (no modhash)' })
    res.json(await redditPost('/api/comment', { thing_id, text, uh: me.uh, api_type: 'json' }, cookies))
  } catch (e) { res.json({ ok: false, error: String((e && e.message) || e) }) }
})

app.post('/scroller/edit', async (req, res) => {
  try {
    const { thing_id, text } = req.body || {}
    if (!thing_id || !text) return res.json({ ok: false, error: 'missing thing_id or text' })
    const cookies = getSessionCookies('default'); if (!cookies.length) return res.json({ ok: false, error: 'not logged in' })
    const me = await getMe(cookies); if (!me.uh) return res.json({ ok: false, error: 'not logged in' })
    res.json(await redditPost('/api/editusertext', { thing_id, text, uh: me.uh, api_type: 'json' }, cookies))
  } catch (e) { res.json({ ok: false, error: String((e && e.message) || e) }) }
})

app.post('/scroller/del', async (req, res) => {
  try {
    const id = req.body && req.body.id
    if (!id) return res.json({ ok: false, error: 'missing id' })
    const cookies = getSessionCookies('default'); if (!cookies.length) return res.json({ ok: false, error: 'not logged in' })
    const me = await getMe(cookies); if (!me.uh) return res.json({ ok: false, error: 'not logged in' })
    await redditPost('/api/del', { id, uh: me.uh }, cookies)
    res.json({ ok: true })
  } catch (e) { res.json({ ok: false, error: String((e && e.message) || e) }) }
})

// Raw markdown of a comment (for the edit box).
app.get('/scroller/raw', async (req, res) => {
  try {
    const id = String(req.query.id || '')
    if (!/^t1_[A-Za-z0-9]+$/.test(id)) return res.json({ ok: false, error: 'bad id' })
    const cookies = getSessionCookies('default')
    const r = await fetch('https://old.reddit.com/api/info.json?id=' + id, { headers: { 'Cookie': cookies.join('; '), 'User-Agent': RUA } })
    const c = ((await r.json()).data || {}).children
    res.json({ ok: true, body: (c && c[0] && c[0].data && c[0].data.body) || '' })
  } catch (e) { res.json({ ok: false, error: String((e && e.message) || e) }) }
})

// ============================================================
// Inline comments feature (served as /custom.css + /custom.js, which the proxied
// page already links in its <head>). Adds a "+ comments" button next to the
// expand button that opens a scrollable comments panel (beside the video if one
// is playing). Kept separate from the post's own content-expand button.
// ============================================================
app.get('/custom.css', (req, res) => {
  res.setHeader('Content-Type', 'text/css')
  res.setHeader('Cache-Control', 'no-store')
  res.send(`
  .sco-comments-li { display: flex !important; align-items: flex-end !important; }
  .sco-comments-btn { cursor: pointer; color: #4fbcff !important; font-weight: 600 !important; white-space: nowrap; }
  .sco-comments-btn.sco-active { color: #ff4500 !important; }

  .sco-comments-panel {
    margin: 8px 0 0 0;
    height: 460px;
    max-height: 72vh;
    overflow-y: auto;
    overflow-x: hidden;
    width: 100%;
    box-sizing: border-box;
    background: #131314;
    border: 1px solid #343536;
    padding: 8px 12px;
    scrollbar-width: thin;
    scrollbar-color: #45474a transparent;
  }
  .sco-comments-panel::-webkit-scrollbar { width: 9px !important; display: block !important; }
  .sco-comments-panel::-webkit-scrollbar-thumb { background: #45474a !important; border-radius: 5px !important; }
  .sco-comments-panel::-webkit-scrollbar-track { background: transparent !important; }
  .sco-cmt-status { color: #818384; padding: 14px; font-size: 13px; text-align: center; }

  /* Comments open BESIDE the video when one is playing */
  .expando.sco-side {
    display: flex !important;
    flex-direction: row !important;
    gap: 10px !important;
    align-items: flex-start !important;
    width: 100% !important;
  }
  .expando.sco-side > .sco-comments-panel.sco-side-panel {
    margin: 0 !important;
    flex: 1 1 auto !important;
    min-width: 300px !important;
    overflow-y: auto !important;
    /* height is set inline by JS to match the media height (scrollable within it) */
  }
  /* Ensure the video or media content takes the remaining space */
  .expando.sco-side > .media-preview,
  .expando.sco-side > .reddit-video-player-root {
    flex: 1 1 70% !important;
    min-width: 0 !important;
  }

  /* Tidy the fetched comment tree inside the panel */
  .sco-comments-panel .commentarea,
  .sco-comments-panel .sitetable { background: transparent !important; margin: 0 !important; }
  .sco-comments-panel .panestack-title,
  .sco-comments-panel .menuarea,
  .sco-comments-panel .commentarea > .infobar,
  .sco-comments-panel .comment-visits-box { display: none !important; }
  /* Contain the comment tree's floats so the panel knows its real content height
     and actually scrolls (otherwise the floated vote columns collapse it). */
  .sco-comments-panel .commentarea,
  .sco-comments-panel .sitetable,
  .sco-comments-panel .nestedlisting,
  .sco-comments-panel .comment,
  .sco-comments-panel .comment > .child,
  .sco-comments-panel .comment > .entry {
    display: flow-root !important;
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
  }
  .sco-comments-panel .comment { margin: 2px 0 !important; }
  .sco-comments-panel .usertext-body { font-size: 13px !important; }
  .sco-cmt-more { text-align: center; padding: 10px; color: #818384; font-size: 12px; }
  /* Inline reply box */
  .sco-replybox { margin: 6px 0 8px 0; }
  .sco-replybox .sco-reply-ta { width: 100%; box-sizing: border-box; background: #1a1a1b; color: #d7dadc; border: 1px solid #45474a; border-radius: 4px; padding: 6px 8px; font: inherit; resize: vertical; }
  .sco-replybox .sco-reply-row { margin-top: 5px; display: flex; gap: 8px; align-items: center; }
  .sco-replybox button { background: #272729; color: #d7dadc; border: 1px solid #45474a; border-radius: 4px; padding: 3px 14px; cursor: pointer; font: inherit; }
  .sco-replybox .sco-send { background: #4fbcff; color: #03263b; border-color: #4fbcff; font-weight: 700; }
  .sco-replybox .sco-reply-status { color: #818384; font-size: 12px; }
  /* Your own comments: highlight + edit/delete actions */
  .sco-comments-panel .comment.sco-mine > .entry { border-left: 3px solid #4fbcff !important; padding-left: 7px !important; background: rgba(79,188,255,0.08) !important; }
  .sco-comments-panel .comment.sco-mine > .entry .tagline .author { color: #4fbcff !important; font-weight: 700 !important; }
  .sco-comments-panel .comment.sco-mine > .entry .tagline .author::after { content: " (you)"; color: #4fbcff; font-weight: 700; }
  .sco-own-actions { margin-left: 6px !important; }
  .sco-own-actions .sco-edit { color: #4fbcff !important; font-weight: 600 !important; cursor: pointer; }
  .sco-own-actions .sco-del { color: #ff6b6b !important; font-weight: 600 !important; cursor: pointer; }
  /* Image lightbox (click an image -> overlay instead of navigating away) */
  .sco-lightbox { position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; background: rgba(0,0,0,0.92) !important; display: flex !important; align-items: center !important; justify-content: center !important; cursor: zoom-out !important; }
  .sco-lightbox img { max-width: 96vw !important; max-height: 96vh !important; object-fit: contain !important; box-shadow: 0 0 40px rgba(0,0,0,0.6) !important; }
  `)
})

app.get('/custom.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript')
  res.setHeader('Cache-Control', 'no-store')
  res.send(`
(function() {
  'use strict';
  function api(p){ return (p && p.charAt(0) === '/' && p.indexOf('/api') !== 0) ? '/api' + p : p; }

  function addBtn(thing){
    if (!thing || thing.getAttribute('data-sco-cmt') === '1') return;
    var entry = thing.querySelector('.entry');
    var topMatter = thing.querySelector('.top-matter');
    var buttons = thing.querySelector('.flat-list.buttons');
    
    if (!buttons) {
      buttons = document.createElement('ul');
      buttons.className = 'flat-list buttons';
      if (topMatter) topMatter.appendChild(buttons);
      else if (entry) entry.appendChild(buttons);
    }
    
    var permalink = thing.getAttribute('data-permalink');
    if (!buttons || !permalink) return;
    
    thing.setAttribute('data-sco-cmt', '1');
    var li = document.createElement('li');
    li.className = 'sco-comments-li';
    var a = document.createElement('a');
    a.href = 'javascript:void(0)';
    a.className = 'sco-comments-btn';
    a.textContent = '+ comments';
    a.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); toggle(thing, permalink, a); }, true);
    li.appendChild(a);
    buttons.insertBefore(li, buttons.firstChild);
  }

  function toggle(thing, permalink, a){
    var panel = thing.querySelector('.sco-comments-panel');
    if (panel){ panel.remove(); a.classList.remove('sco-active'); a.textContent = '+ comments'; unside(thing); return; }
    a.classList.add('sco-active'); a.textContent = '- comments';
    panel = document.createElement('div');
    panel.className = 'sco-comments-panel';
    panel.innerHTML = '<div class="sco-cmt-status">Loading comments...</div>';
    place(thing, panel);
    load(permalink, panel);
  }

  function place(thing, panel){
    // If media is expanded (video OR image), open comments BESIDE it on the right,
    // stretched to the same height as the media (and scrollable within that).
    var expando = thing.querySelector('.expando');
    if (expando && expando.offsetHeight > 40 && expando.querySelector('.reddit-video-player-root, img, video, .media-preview')){
      expando.classList.add('sco-side'); panel.classList.add('sco-side-panel'); expando.appendChild(panel);
      matchSideHeight(expando, panel);
      return;
    }
    var entry = thing.querySelector('.entry');
    (entry || thing).appendChild(panel);
  }

  function matchSideHeight(expando, panel){
    function apply(){
      var media = expando.querySelector('.reddit-video-player-root') || expando.querySelector('video') || expando.querySelector('img') || expando.querySelector('.media-preview');
      if (media){ var h = media.offsetHeight; if (h > 80) panel.style.height = h + 'px'; }
    }
    apply();
    var v = expando.querySelector('video');
    if (v){ v.addEventListener('loadedmetadata', apply); v.addEventListener('loadeddata', apply); v.addEventListener('resize', apply); }
    var img = expando.querySelector('img'); if (img && !img.complete) img.addEventListener('load', apply);
    setTimeout(apply, 400); setTimeout(apply, 1200); setTimeout(apply, 2500);
  }
  function unside(thing){ var m = thing.querySelector('.expando.sco-side'); if (m) m.classList.remove('sco-side'); }

  function load(permalink, panel){
    var url = api(permalink);
    url += (url.indexOf('?') >= 0 ? '&' : '?') + 'limit=500';
    fetch(url).then(function(r){ return r.text(); }).then(function(html){
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var area = doc.querySelector('.commentarea');
      var listing = area && (area.querySelector('.sitetable.nestedlisting') || area.querySelector('.sitetable'));
      if (!listing || !listing.querySelector('.comment')){ panel.innerHTML = '<div class="sco-cmt-status">No comments yet.</div>'; return; }
      panel.innerHTML = '';
      panel.appendChild(listing);
      stripOnclick(panel);
      wireLoadMore(panel);
      wireReplies(panel);
      tagAllMine();
    }).catch(function(){ panel.innerHTML = '<div class="sco-cmt-status">Could not load comments.</div>'; });
  }

  // Reddit's comment onclick handlers (reply/vote/...) reference JS we don't load,
  // so strip them to avoid console errors; we handle reply ourselves.
  function stripOnclick(root){ var els = root.querySelectorAll('[onclick]'); for (var i = 0; i < els.length; i++) els[i].removeAttribute('onclick'); }
  function decodeHTML(s){ var t = document.createElement('textarea'); t.innerHTML = s; return t.value; }

  function wireReplies(panel){
    if (panel.getAttribute('data-sco-replies')) return;
    panel.setAttribute('data-sco-replies', '1');
    panel.addEventListener('click', function(e){
      var a = e.target.closest && e.target.closest('a');
      if (!a || !panel.contains(a)) return;
      if ((a.textContent || '').trim().toLowerCase() === 'reply'){
        e.preventDefault(); e.stopPropagation();
        var c = a.closest('.comment[data-fullname]');
        if (c) showReplyBox(c);
      }
    }, true);
  }

  function showReplyBox(comment){
    var entry = comment.querySelector(':scope > .entry') || comment;
    var existing = entry.querySelector(':scope > .sco-replybox');
    if (existing){ existing.querySelector('textarea').focus(); return; }
    var box = document.createElement('div'); box.className = 'sco-replybox';
    box.innerHTML = '<textarea class="sco-reply-ta" rows="3" placeholder="reply  (Enter to send, Shift+Enter for newline)"></textarea><div class="sco-reply-row"><button type="button" class="sco-send">Send</button><button type="button" class="sco-cancel">Cancel</button><span class="sco-reply-status"></span></div>';
    entry.appendChild(box);
    var ta = box.querySelector('textarea'); ta.focus();
    box.querySelector('.sco-cancel').addEventListener('click', function(){ box.remove(); });
    box.querySelector('.sco-send').addEventListener('click', function(){ sendReply(comment, box); });
    ta.addEventListener('keydown', function(e){ if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendReply(comment, box); } });
  }

  function sendReply(comment, box){
    var ta = box.querySelector('textarea'); var text = ta.value;
    if (!text.trim()) return;
    var fullname = comment.getAttribute('data-fullname');
    var status = box.querySelector('.sco-reply-status'); var btn = box.querySelector('.sco-send');
    status.textContent = 'sending...'; btn.disabled = true;
    fetch('/scroller/comment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thing_id: fullname, text: text }) })
      .then(function(r){ return r.json(); })
      .then(function(j){
        var errs = j && j.json && j.json.errors;
        if (errs && errs.length){ status.textContent = 'error: ' + errs[0].join(' '); btn.disabled = false; return; }
        if (j && j.ok === false){ status.textContent = 'error: ' + (j.error || 'failed'); btn.disabled = false; return; }
        var things = j && j.json && j.json.data && j.json.data.things;
        if (things && things[0] && things[0].data && things[0].data.contentHTML){
          var tmp = document.createElement('div'); tmp.innerHTML = decodeHTML(things[0].data.contentHTML);
          stripOnclick(tmp);
          var child = comment.querySelector(':scope > .child');
          if (!child){ child = document.createElement('div'); child.className = 'child'; comment.appendChild(child); }
          var listing = child.querySelector('.sitetable'); if (!listing){ listing = document.createElement('div'); listing.className = 'sitetable'; child.appendChild(listing); }
          while (tmp.firstChild) listing.insertBefore(tmp.firstChild, listing.firstChild);
          box.remove();
          tagAllMine();
        } else { status.textContent = 'posted'; setTimeout(function(){ box.remove(); }, 700); }
      })
      .catch(function(){ status.textContent = 'failed to send'; btn.disabled = false; });
  }

  // ---- Your own comments: highlight + edit + delete ----
  var ME = null;
  function loadMe(){ fetch('/scroller/me').then(function(r){ return r.json(); }).then(function(j){ ME = (j && j.name) || null; if (ME) tagAllMine(); }).catch(function(){}); }
  function tagAllMine(){ if (!ME) return; var cs = document.querySelectorAll('.sco-comments-panel .comment[data-author]'); for (var i = 0; i < cs.length; i++) tagMine(cs[i]); }
  function tagMine(comment){
    if (!ME || comment.getAttribute('data-author') !== ME || comment.classList.contains('sco-mine')) return;
    comment.classList.add('sco-mine');
    addOwnActions(comment);
  }
  function addOwnActions(comment){
    var entry = comment.querySelector(':scope > .entry');
    var buttons = entry && entry.querySelector('.flat-list.buttons');
    if (!buttons || buttons.querySelector('.sco-own-actions')) return;
    var li = document.createElement('li'); li.className = 'sco-own-actions';
    var edit = document.createElement('a'); edit.href = 'javascript:void(0)'; edit.className = 'sco-edit'; edit.textContent = 'edit';
    var del = document.createElement('a'); del.href = 'javascript:void(0)'; del.className = 'sco-del'; del.textContent = 'delete';
    li.appendChild(edit); li.appendChild(document.createTextNode(' ')); li.appendChild(del);
    buttons.appendChild(li);
    edit.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); editComment(comment); });
    del.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); delComment(comment, del); });
  }
  function editComment(comment){
    var entry = comment.querySelector(':scope > .entry');
    var open = entry.querySelector(':scope > .sco-editbox');
    if (open){ open.querySelector('textarea').focus(); return; }
    var id = comment.getAttribute('data-fullname');
    var box = document.createElement('div'); box.className = 'sco-replybox sco-editbox';
    box.innerHTML = '<textarea class="sco-reply-ta" rows="4"></textarea><div class="sco-reply-row"><button type="button" class="sco-send">Save</button><button type="button" class="sco-cancel">Cancel</button><span class="sco-reply-status"></span></div>';
    entry.appendChild(box);
    var ta = box.querySelector('textarea'); ta.value = 'loading...'; ta.disabled = true;
    fetch('/scroller/raw?id=' + encodeURIComponent(id)).then(function(r){ return r.json(); }).then(function(j){ ta.value = (j && j.body) || ''; ta.disabled = false; ta.focus(); }).catch(function(){ ta.value = ''; ta.disabled = false; });
    box.querySelector('.sco-cancel').addEventListener('click', function(){ box.remove(); });
    box.querySelector('.sco-send').addEventListener('click', function(){ saveEdit(comment, box); });
    ta.addEventListener('keydown', function(e){ if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); saveEdit(comment, box); } });
  }
  function saveEdit(comment, box){
    var ta = box.querySelector('textarea'); var text = ta.value; if (!text.trim()) return;
    var id = comment.getAttribute('data-fullname'); var status = box.querySelector('.sco-reply-status'); var btn = box.querySelector('.sco-send');
    status.textContent = 'saving...'; btn.disabled = true;
    fetch('/scroller/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thing_id: id, text: text }) })
      .then(function(r){ return r.json(); }).then(function(j){
        var errs = j && j.json && j.json.errors; if (errs && errs.length){ status.textContent = 'error: ' + errs[0].join(' '); btn.disabled = false; return; }
        var things = j && j.json && j.json.data && j.json.data.things;
        if (things && things[0] && things[0].data && things[0].data.contentHTML){
          var tmp = document.createElement('div'); tmp.innerHTML = decodeHTML(things[0].data.contentHTML); stripOnclick(tmp);
          var nb = tmp.querySelector('.usertext-body'); var ob = comment.querySelector(':scope > .entry .usertext-body');
          if (nb && ob){ ob.parentNode.replaceChild(nb, ob); }
          box.remove();
        } else { status.textContent = 'saved'; setTimeout(function(){ box.remove(); }, 600); }
      }).catch(function(){ status.textContent = 'failed'; btn.disabled = false; });
  }
  function delComment(comment, link){
    if (link.getAttribute('data-confirm') !== '1'){ link.setAttribute('data-confirm', '1'); link.textContent = 'confirm?'; setTimeout(function(){ if (link.getAttribute('data-confirm') === '1'){ link.removeAttribute('data-confirm'); link.textContent = 'delete'; } }, 3000); return; }
    var id = comment.getAttribute('data-fullname'); link.textContent = 'deleting...';
    fetch('/scroller/del', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
      .then(function(r){ return r.json(); }).then(function(j){
        var ob = comment.querySelector(':scope > .entry .usertext-body'); if (ob) ob.innerHTML = '<p><em>[deleted]</em></p>';
        comment.style.opacity = '0.5'; link.textContent = 'deleted';
      }).catch(function(){ link.textContent = 'failed'; });
  }

  // Make Reddit's "load more comments" / "continue this thread" stubs load inline.
  // The proxied page hijacks normal links, so neutralize the href and handle it here.
  function wireLoadMore(container){
    var links = container.querySelectorAll('.morechildren a, .morecomments a, .deepthread a');
    for (var i = 0; i < links.length; i++){
      var a = links[i];
      if (a.getAttribute('data-sco-more')) continue;
      var href = a.getAttribute('href');
      var parent = a.closest('.comment[data-permalink]');
      var path = (href && href.charAt(0) === '/') ? href : (parent ? parent.getAttribute('data-permalink') : null);
      if (!path) continue;
      a.setAttribute('data-sco-more', path);
      a.removeAttribute('data-proxy-href');
      a.setAttribute('href', 'javascript:void(0)');
      a.addEventListener('click', loadMoreClick, true);
    }
  }

  function loadMoreClick(e){
    e.preventDefault(); e.stopPropagation();
    var a = e.currentTarget;
    var path = a.getAttribute('data-sco-more');
    var parent = a.closest('.comment[data-permalink]');
    var panel = a.closest('.sco-comments-panel');
    var stub = a.closest('.morechildren') || a.closest('.morecomments') || a.closest('.deepthread') || a;
    if (!path) return;
    stub.textContent = 'loading...';
    var u = api(path); u += (u.indexOf('?') >= 0 ? '&' : '?') + 'limit=500';
    fetch(u).then(function(r){ return r.text(); }).then(function(html){
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var listing = doc.querySelector('.commentarea .sitetable.nestedlisting') || doc.querySelector('.commentarea .sitetable');
      if (!listing){ stub.textContent = 'no more comments'; return; }
      stripOnclick(listing);
      if (parent && parent.parentNode){ parent.replaceWith(listing); } else if (stub.parentNode){ stub.replaceWith(listing); }
      if (panel) wireLoadMore(panel);
      tagAllMine();
    }).catch(function(){ stub.textContent = 'failed to load'; });
  }

  // Reddit's native selftext (3-lines) expando fetches through the proxy and gets
  // the whole page back, so the text never shows. Take it over and load the post
  // text ourselves from the permalink.
  function wireSelftext(thing){
    var btn = thing.querySelector('.expando-button.selftext');
    if (!btn || btn.getAttribute('data-sco-self')) return;
    btn.setAttribute('data-sco-self', '1');
    btn.onclick = null;
    btn.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); toggleSelftext(thing, btn); }, true);
  }

  function toggleSelftext(thing, btn){
    var exp = thing.querySelector('.expando');
    if (btn.classList.contains('expanded')){
      btn.classList.remove('expanded'); btn.classList.add('collapsed');
      if (exp) exp.style.display = 'none';
      return;
    }
    btn.classList.remove('collapsed'); btn.classList.add('expanded');
    if (!exp){ exp = document.createElement('div'); exp.className = 'expando'; var entry = thing.querySelector('.entry'); (entry || thing).appendChild(exp); }
    exp.style.display = 'block';
    if (exp.getAttribute('data-sco-loaded')) return;
    exp.innerHTML = '<div class="sco-cmt-status">Loading post text...</div>';
    var permalink = thing.getAttribute('data-permalink');
    if (!permalink){ exp.innerHTML = ''; return; }
    fetch(api(permalink)).then(function(r){ return r.text(); }).then(function(html){
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var body = doc.querySelector('.linklisting .entry .usertext-body') || doc.querySelector('.linklisting .usertext-body') || doc.querySelector('.usertext-body');
      if (body){ exp.innerHTML = ''; exp.appendChild(body); exp.setAttribute('data-sco-loaded', '1'); }
      else { exp.innerHTML = '<div class="sco-cmt-status">(this post has no text)</div>'; }
    }).catch(function(){ exp.innerHTML = '<div class="sco-cmt-status">Could not load post text.</div>'; });
  }

  // YouTube posts: the native embed shows "Sign in to confirm you're not a bot",
  // so play it as a native <video> from /yt (server extracts the real stream).
  function clean(s){ if(!s) return null; s = s.split('&')[0].split('?')[0].split('/')[0].split('#')[0]; return /^[\\w-]{6,20}$/.test(s) ? s : null; }
  function ytId(thing){
    var u = thing.getAttribute('data-url') || ((thing.querySelector('a.title')||{}).href) || '';
    var low = u.toLowerCase();
    // Only treat as YouTube if it's actually a YouTube host (otherwise non-YouTube
    // links containing "watch?v="/"/embed/"/"/v/" were falsely matched -> "could not load video").
    if (low.indexOf('youtube.com/') < 0 && low.indexOf('youtu.be/') < 0 && low.indexOf('youtube-nocookie.com/') < 0) return null;
    function after(marker){ var i = low.indexOf(marker); return i < 0 ? null : clean(u.substring(i + marker.length)); }
    return after('youtu.be/') || after('watch?v=') || after('/embed/') || after('/shorts/') || after('/live/') || after('/v/');
  }
  function wireYouTube(thing){
    var id = ytId(thing);
    if (!id) return;
    var btn = thing.querySelector('.expando-button.video');
    if (!btn || btn.getAttribute('data-sco-yt')) return;
    btn.setAttribute('data-sco-yt', '1');
    btn.onclick = null;
    btn.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); toggleYouTube(thing, btn, id); }, true);
  }
  function toggleYouTube(thing, btn, id){
    var exp = thing.querySelector('.expando');
    if (btn.classList.contains('expanded')){
      btn.classList.remove('expanded'); btn.classList.add('collapsed');
      if (exp){ exp.style.display = 'none'; var pv = exp.querySelector('video'); if (pv) try { pv.pause(); } catch(e){} }
      return;
    }
    btn.classList.remove('collapsed'); btn.classList.add('expanded');
    if (!exp){ exp = document.createElement('div'); exp.className = 'expando'; var entry = thing.querySelector('.entry'); (entry || thing).appendChild(exp); }
    exp.style.display = 'block';
    if (!exp.getAttribute('data-sco-yt-loaded')){
      exp.setAttribute('data-sco-yt-loaded', '1');
      exp.innerHTML = '<div class="media-preview" style="background:#000;"><video class="sco-yt" controls playsinline autoplay preload="auto" style="width:100%;max-height:72vh;display:block;background:#000;" src="/yt?v=' + id + '"></video><div class="sco-cmt-status sco-yt-msg">Loading video...</div></div>';
      var vid = exp.querySelector('video');
      var msg = exp.querySelector('.sco-yt-msg');
      if (vid){
        var startPlay = function(){ if (msg) msg.style.display = 'none'; try { var p = vid.play(); if (p && p.catch) p.catch(function(){}); } catch(e){} };
        vid.addEventListener('loadeddata', startPlay);
        vid.addEventListener('canplay', startPlay);
        vid.addEventListener('error', function(){
          // YouTube blocked inline extraction (anti-bot) — offer a direct link instead.
          exp.innerHTML = '<div class="sco-cmt-status" style="padding:18px;">YouTube blocked inline playback for this video. <a href="https://www.youtube.com/watch?v=' + id + '" target="_blank" rel="noopener" style="color:#4fbcff;font-weight:700;">▶ Watch on YouTube</a></div>';
        });
      }
    }
  }

  // Open reddit images in an in-page lightbox instead of navigating away (which
  // loses your scroll position on Back).
  function wireImage(thing){
    var du = thing.getAttribute('data-url') || '';
    if (du.indexOf('/media/i/') < 0) return; // only reddit single-image posts
    var url = du.indexOf('/api') === 0 ? du : ('/api/media/i/' + du.split('/media/i/')[1]);
    var th = thing.querySelector('a.thumbnail');
    if (!th || th.getAttribute('data-sco-img')) return;
    th.setAttribute('data-sco-img', '1');
    th.removeAttribute('data-proxy-href');
    th.setAttribute('href', 'javascript:void(0)');
    th.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); openLightbox(url); }, true);
  }
  function openLightbox(url){
    var ov = document.createElement('div'); ov.className = 'sco-lightbox';
    var img = document.createElement('img'); img.src = url; img.alt = '';
    ov.appendChild(img);
    document.documentElement.appendChild(ov); // outside body's zoom -> fills the real viewport
    function close(){ if (ov.parentNode) ov.parentNode.removeChild(ov); document.removeEventListener('keydown', onKey, true); }
    function onKey(e){ if (e.key === 'Escape') close(); }
    ov.addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
  }

  function scan(root){ var p = (root || document).querySelectorAll('#siteTable > .thing.link[data-fullname]'); for (var i = 0; i < p.length; i++) { addBtn(p[i]); wireSelftext(p[i]); wireYouTube(p[i]); wireImage(p[i]); } }

  function init(){
    scan();
    loadMe();
    var st = document.querySelector('#siteTable');
    if (st){
      var obs = new MutationObserver(function(muts){
        for (var i = 0; i < muts.length; i++){
          var ad = muts[i].addedNodes;
          for (var j = 0; j < ad.length; j++){
            var n = ad[j];
            if (n.nodeType !== 1) continue;
            if (n.matches && n.matches('.thing.link')) { addBtn(n); wireSelftext(n); wireYouTube(n); wireImage(n); }
            else if (n.querySelectorAll) scan(n);
          }
        }
      });
      obs.observe(st, { childList: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
  `)
})

// ============================================================
// YouTube playback: native <video> instead of the broken embed (the embed shows
// "Sign in to confirm you're not a bot" because it can't use the browser's YouTube
// session). The server extracts the direct progressive MP4 with yt-dlp (using the
// logged-in browser's cookies + deno for YouTube's challenge) and 302s to it; the
// <video> plays it directly (same public IP, no CORS, no embed wall).
// ============================================================
const YT_DLP = join(__dirname, 'yt-dlp')
const YT_ENV = { ...process.env, PATH: '/home/ubuntubox2/.local/bin:' + (process.env.PATH || '') }
const ytCache = new Map()
function ytExtract(v, cb) {
  execFile(YT_DLP, [
    '--cookies-from-browser', 'chromium:/home/ubuntubox2/.hermes/chrome-debug',
    '--no-warnings', '-f', '18/22/best[protocol^=http][vcodec!=none][acodec!=none]',
    '-g', 'https://www.youtube.com/watch?v=' + v
  ], { env: YT_ENV, timeout: 90000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
    const url = String(stdout || '').trim().split('\n')[0]
    cb(url.startsWith('http') ? url : null, (stderr || (err && err.message) || ''))
  })
}
app.get('/yt', (req, res) => {
  const v = String(req.query.v || '')
  if (!/^[\w-]{6,20}$/.test(v)) return res.status(400).send('bad video id')
  const hit = ytCache.get(v)
  if (hit && Date.now() - hit.ts < 60 * 60 * 1000) return res.redirect(hit.url)
  ytExtract(v, (url, errText) => {
    if (url) { ytCache.set(v, { url, ts: Date.now() }); console.log('▶️ youtube', v); return res.redirect(url) }
    // Retry once — YouTube's anti-bot wall is often intermittent.
    setTimeout(() => ytExtract(v, (url2, errText2) => {
      if (url2) { ytCache.set(v, { url: url2, ts: Date.now() }); console.log('▶️ youtube', v, '(retry)'); return res.redirect(url2) }
      console.error('❌ yt-dlp failed for', v, ':', (errText2 || errText).slice(0, 200))
      res.status(502).send('Could not extract video')
    }), 1200)
  })
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
      // Also drop conditional-cache headers: on reload the browser sends these,
      // Reddit replies 304 Not Modified with an EMPTY body, and the proxy would
      // inject into nothing -> blank/partial white page until a fresh fetch.
      if (!['host', 'cookie', 'connection', 'content-length', 'accept-encoding', 'referer', 'origin',
            'if-none-match', 'if-modified-since', 'if-unmodified-since', 'if-match', 'if-range'].includes(lowerKey)) {
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
      if (!url.startsWith('/@') && !url.startsWith('/src') && !url.startsWith('/node_modules') && !url.startsWith('/popup') && !url.startsWith('/auth') && !url.startsWith('/scroller')) {
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
  // --- Persistent "hide" memory ---
  // Remembers posts the user hides so they stay gone after a refresh.
  // Two layers of persistence:
  //   1. The server stores the list in .hidden-posts-<port>.json and injects it
  //      inline below, so hides survive server restarts and browser-data clears.
  //   2. localStorage caches it client-side for instant, offline-safe filtering.
  var HIDDEN_KEY = 'scrollerHiddenPosts';
  var hidden;
  try { hidden = new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); }
  catch (e) { hidden = new Set(); }
  // Server-side list, injected at proxy time (authoritative across restarts).
  try {
    var serverHidden = ${JSON.stringify(hiddenPosts)};
    if (Array.isArray(serverHidden)) serverHidden.forEach(function(fn) { hidden.add(fn); });
  } catch (e) {}

  function persist() {
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(Array.from(hidden))); } catch (e) {}
  }
  function syncServer(path, fn) {
    // Note: /scroller/* is excluded from the in-page URL rewriter above.
    try {
      fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullname: fn })
      }).catch(function() {});
    } catch (e) {}
  }

  // Shared so the infinite-scroll loader can skip hidden posts as it appends them.
  window.__scrollerHidden = {
    has: function(fn) { return hidden.has(fn); },
    add: function(fn) { if (fn && !hidden.has(fn)) { hidden.add(fn); persist(); syncServer('/scroller/hide', fn); } },
    remove: function(fn) { if (fn && hidden.delete(fn)) { persist(); syncServer('/scroller/unhide', fn); } }
  };
  persist();

  function sweep(root) {
    if (hidden.size === 0) return;
    var posts = (root || document).querySelectorAll('#siteTable > .thing[data-fullname]');
    for (var i = 0; i < posts.length; i++) {
      if (hidden.has(posts[i].getAttribute('data-fullname'))) posts[i].remove();
    }
  }

  // Strip already-hidden posts as the page streams in, so they never flash on screen.
  var obs = new MutationObserver(function(muts) {
    if (hidden.size === 0) return;
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (node.nodeType !== 1) continue;
        if (node.matches && node.matches('.thing[data-fullname]') &&
            hidden.has(node.getAttribute('data-fullname'))) { node.remove(); continue; }
        if (node.querySelectorAll) sweep(node);
      }
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', function() { sweep(); });

  // Remember when the user clicks Reddit's native hide / unhide links.
  document.addEventListener('click', function(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var thing = t.closest('.thing[data-fullname]');
    if (!thing) return;
    var fn = thing.getAttribute('data-fullname');
    if (t.closest('.unhide-button')) {
      window.__scrollerHidden.remove(fn);
      return;
    }
    if (t.closest('.hide-button')) {
      window.__scrollerHidden.add(fn);
      // Defer removal so Reddit's own hide handler can finish first.
      setTimeout(function() { thing.remove(); }, 0);
    }
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
            if (fullname && window.__scrollerHidden && window.__scrollerHidden.has(fullname)) return;
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
  /* Zoom the whole page ~30% bigger (text, posts, media, comments all scale). */
  body { zoom: 1.3 !important; }
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
  /* Feed post layout. Everything is anchored to the TOP: the title, the vote
     arrows and the thumbnail all start at the same top line (inline with the
     picture). The thumbnail still fills the text-panel height via its own
     align-self: stretch below, and its <img> is absolutely positioned so it does
     NOT add height to the row (which previously pushed the title/arrows down and
     left whitespace above them). */
  #siteTable > .thing.link {
    display: flex !important;
    align-items: flex-start !important;
    padding-top: 12px !important;
    padding-bottom: 12px !important;
  }
  #siteTable > .thing.link > .entry {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    align-self: stretch !important;
  }
  /* Tighten the title's line-height and pull its first line up so the title text
     lines up with the TOP of the photo/video thumbnail (the default leading made
     the title sit a few px lower, looking uneven with the image). */
  #siteTable > .thing.link .top-matter > .title {
    line-height: 1.2 !important;
    margin-top: -3px !important;
    margin-bottom: 2px !important;
  }
  /* Uniform preview thumbnails: fixed width, filling the text-panel height. Only
     real image thumbnails (:has(img)), not self/default icons. */
  #siteTable > .thing.link > .thumbnail:has(img) {
    position: relative !important;
    align-self: stretch !important;
    flex: 0 0 140px !important;
    width: 140px !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    margin: 0 14px 0 0 !important;
    overflow: hidden !important;
    border-radius: 0 !important;
  }
  #siteTable > .thing.link > .thumbnail:has(img) img {
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    width: 100% !important;
    height: 100% !important;
    max-width: none !important;
    max-height: none !important;
    object-fit: cover !important;
    display: block !important;
    border-radius: 0 !important;
  }
  /* EXPANDED posts (image / video / selftext) OR posts with the comments panel
     open: the entry becomes tall, so don't center or stretch the left column —
     anchor the arrows and thumbnail at the top at their normal size. */
  #siteTable > .thing.link:has(.expando-button.expanded),
  #siteTable > .thing.link:has(.sco-comments-panel) {
    align-items: flex-start !important;
  }
  #siteTable > .thing.link:has(.expando-button.expanded) > .thumbnail:has(img),
  #siteTable > .thing.link:has(.sco-comments-panel) > .thumbnail:has(img) {
    align-self: flex-start !important;
    height: auto !important;
    max-height: 160px !important;
  }
  #siteTable > .thing.link:has(.expando-button.expanded) > .thumbnail:has(img) img,
  #siteTable > .thing.link:has(.sco-comments-panel) > .thumbnail:has(img) img {
    position: static !important;
    height: auto !important;
    max-height: 160px !important;
    object-fit: contain !important;
  }
  /* Posts with NO preview image (link / self / nsfw): give the placeholder the
     same 140px box as real thumbnails so the left column and titles all line up.
     The reddit sprite icon can't be re-centered inside a large box, so we draw a
     centered circle + glyph instead. */
  #siteTable > .thing.link > .thumbnail:not(:has(img)) {
    position: relative !important;
    align-self: stretch !important;
    flex: 0 0 140px !important;
    width: 140px !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    margin: 0 14px 0 0 !important;
    overflow: hidden !important;
    border-radius: 0 !important;
    background-image: none !important;
    background-color: #1a1a1b !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
  }
  #siteTable > .thing.link > .thumbnail:not(:has(img))::after {
    content: "\\1F517";
    position: absolute !important;
    top: 50% !important;
    left: 50% !important;
    transform: translate(-50%, -50%) !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 60px !important;
    height: 60px !important;
    border-radius: 50% !important;
    background-color: #272729 !important;
    font-size: 26px !important;
    line-height: 1 !important;
  }
  #siteTable > .thing.link > .thumbnail.self:not(:has(img))::after { content: "\\1F4AC" !important; }
  #siteTable > .thing.link > .thumbnail.nsfw:not(:has(img))::after { content: "\\1F51E" !important; }
  /* When such a post is expanded (or comments are open), don't let the placeholder
     box stretch tall. */
  #siteTable > .thing.link:has(.expando-button.expanded) > .thumbnail:not(:has(img)),
  #siteTable > .thing.link:has(.sco-comments-panel) > .thumbnail:not(:has(img)) {
    align-self: flex-start !important;
    height: 90px !important;
  }
  /* Put the expand [+] button at the bottom-left, lined up with the comments row
     (it used to float up near the top of the post). */
  #siteTable > .thing.link .entry .top-matter {
    position: relative !important;
  }
  #siteTable > .thing.link .top-matter > .expando-button {
    position: absolute !important;
    left: 0 !important;
    bottom: 0 !important;
    float: none !important;
    margin: 0 !important;
    transform: scale(0.82) !important;   /* sized to sit on the buttons line */
    transform-origin: bottom left !important;  /* stay anchored at bottom-left */
  }
  /* Consistent gap above the buttons row on EVERY post (with or without an expand
     button) so the comments/share/save/... line sits in the same spot, and the
     expand button has room and doesn't poke into the "submitted" line. */
  #siteTable > .thing.link .top-matter > .flat-list.buttons {
    padding: 0 0 0 30px !important;
    margin: 12px 0 0 0 !important;
    display: flex !important;
    flex-wrap: nowrap !important;
    align-items: flex-end !important;
    line-height: normal !important;
  }
  #siteTable > .thing.link .top-matter > .flat-list.buttons > li {
    display: flex !important;
    align-items: flex-end !important;
  }
  /* Normalize line-height on every button (incl. the hide toggle form, whose
     larger line-height made "hide" taller and higher than the other buttons). */
  #siteTable > .thing.link .top-matter > .flat-list.buttons > li,
  #siteTable > .thing.link .top-matter > .flat-list.buttons > li * {
    line-height: normal !important;
  }
  /* Make the hide/save toggle wrapper <form>/<span> transparent so their links
     align EXACTLY like the plain-link buttons (comments/share/report/crosspost). */
  #siteTable > .thing.link .top-matter > .flat-list.buttons > li form,
  #siteTable > .thing.link .top-matter > .flat-list.buttons > li form > span,
  #siteTable > .thing.link .top-matter > .flat-list.buttons > li form > .option {
    display: contents !important;
  }
  #siteTable > .thing.link > .midcol {
    margin: 0 10px 0 4px !important;
    flex: 0 0 auto !important;
  }
  /* Enlarge the vote arrows ONLY when media is expanded (so they're proportionate
     next to a large image/video). In the feed the arrows stay normal size, since a
     taller arrow column would make short posts taller than their text and leave a
     gap below the buttons. */
  #siteTable > .thing.link:has(.expando-button.expanded) > .midcol {
    zoom: 1.3 !important;
  }
  /* Consistent divider above every feed post. Using a plain border on each post
     (instead of adjacent-sibling selectors) keeps the spacing uniform even
     across page boundaries (.nav-buttons) and after a hidden post is removed. */
  #siteTable > .thing.link {
    border-top: 6px solid #343536 !important;
  }
  #siteTable > .thing.link:first-child,
  #siteTable > .clearleft:first-child + .thing.link {
    border-top: 0 !important;
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
  
  /* Show playback controls + progress bar. NOTE: .playback-controls is a
     horizontal flex row -- the previous 'display: block' here stacked the play
     button, time and progress bar into a vertical column. Keep it as a row. */
  .reddit-video-player-root,
  .progress-bar, .progress-bar-fill, .progress-bar-bg {
    background-color: rgba(0,0,0,0.5) !important;
    opacity: 1 !important;
    visibility: visible !important;
    display: block !important;
  }
  .playback-controls {
    background-color: rgba(0,0,0,0.5) !important;
    opacity: 1 !important;
    visibility: visible !important;
    display: flex !important;
    flex-direction: row !important;
    flex-wrap: nowrap !important;
    align-items: center !important;
  }
  /* Keep each control icon on the line (don't let them wrap or grow). */
  .playback-controls > * {
    flex: 0 0 auto !important;
    align-self: center !important;
  }
  .playback-controls > .reddit-video-seek-bar-root {
    flex: 1 1 auto !important;
  }
  .progress-bar {
    flex: 1 1 auto !important;
  }

  .progress-bar-fill {
    background-color: #ff4500 !important;
    height: 100% !important;
    display: block !important;
  }

  /* The blanket "transparent background" rule above also wiped the colours of
     reddit's actual video seek bar (.reddit-video-seek-bar-root), which is why
     no progress bar was visible. Restore them so the scrubber shows. */
  .reddit-video-seek-bar-root .seek-bar-bar.seek-bar-background { background-color: rgba(255,255,255,0.3) !important; }
  .reddit-video-seek-bar-root .seek-bar-bar.seek-bar-buffered   { background-color: rgba(255,255,255,0.5) !important; }
  .reddit-video-seek-bar-root .seek-bar-bar.seek-bar-lookahead  { background-color: rgba(255,69,0,0.4) !important; }
  .reddit-video-seek-bar-root .seek-bar-bar.seek-bar-progress   { background-color: #ff4500 !important; }
  .reddit-video-seek-bar-root .seek-bar-thumb                   { background-color: #ff4500 !important; }
  /* Make the bar a touch taller so it reads as a real progress bar. */
  .reddit-video-seek-bar-root .seek-bar-bar { height: 6px !important; }
  /* Volume slider got hit by the same rule. */
  .reddit-video-volume-slider-root .volume-slider-track    { background-color: rgba(255,255,255,0.3) !important; }
  .reddit-video-volume-slider-root .volume-slider-progress { background-color: #ff4500 !important; }
  .reddit-video-volume-slider-root .volume-slider-thumb    { background-color: #ffffff !important; }

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
      // Never cache the proxied page, so a reload always re-fetches full content.
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
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
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'identity'
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

  // Intercept ALL navigation to keep within proxy
  try {
    // Intercept location.href = "..."
    var origHrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    if (origHrefDesc && origHrefDesc.set) {
      Object.defineProperty(Location.prototype, 'href', {
        set: function(v) { origHrefDesc.set.call(this, rewriteUrl(v)); },
        get: origHrefDesc.get,
        configurable: true
      });
    }
    // Intercept location.assign() and location.replace()
    var origAssign = Location.prototype.assign;
    var origReplace = Location.prototype.replace;
    Location.prototype.assign = function(url) { return origAssign.call(this, rewriteUrl(url)); };
    Location.prototype.replace = function(url) { return origReplace.call(this, rewriteUrl(url)); };
    // Intercept history.pushState/replaceState
    var origPushState = history.pushState;
    var origReplaceState = history.replaceState;
    history.pushState = function(s, t, url) { return origPushState.call(this, s, t, url ? rewriteUrl(url) : url); };
    history.replaceState = function(s, t, url) { return origReplaceState.call(this, s, t, url ? rewriteUrl(url) : url); };
  } catch(e) { console.debug('FB-Shim: location intercept failed', e); }

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

      // Inject location-blocking shim BEFORE any other scripts
      const locationBlocker = `<script>
// Block Facebook's domain-check redirect by freezing navigation
(function() {
  var _origHref = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
  if (_origHref && _origHref.set) {
    Object.defineProperty(Location.prototype, 'href', {
      set: function(v) {
        if (typeof v === 'string' && (v === '/' || v === window.location.origin + '/')) {
          console.log('[FB-Block] Blocked redirect to:', v);
          return;
        }
        if (typeof v === 'string' && !v.includes('/fb-api') && !v.includes('/fb-static') && v.startsWith('/')) {
          v = '/fb-api' + v;
        }
        _origHref.set.call(this, v);
      },
      get: _origHref.get,
      configurable: true
    });
  }
  var _origAssign = Location.prototype.assign;
  Location.prototype.assign = function(u) {
    if (u === '/' || u === window.location.origin + '/') { console.log('[FB-Block] Blocked assign to:', u); return; }
    if (typeof u === 'string' && !u.includes('/fb-api') && !u.includes('/fb-static') && u.startsWith('/')) u = '/fb-api' + u;
    return _origAssign.call(this, u);
  };
  var _origReplace = Location.prototype.replace;
  Location.prototype.replace = function(u) {
    if (u === '/' || u === window.location.origin + '/') { console.log('[FB-Block] Blocked replace to:', u); return; }
    if (typeof u === 'string' && !u.includes('/fb-api') && !u.includes('/fb-static') && u.startsWith('/')) u = '/fb-api' + u;
    return _origReplace.call(this, u);
  };
})();
</script>`;
      html = html.replace(/<head[^>]*>/i, `$&${locationBlocker}<base href="/fb-api/">`);

      // More aggressive domain replacement
      html = html.replace(/https?:\/\/(mbasic|m|www|graph)\.facebook\.com/g, '/fb-api/https://$1.facebook.com');
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

