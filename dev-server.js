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
const COOKIE_FILE = join(__dirname, '.session-cookies.json')

const app = express()
const PORT = 5177

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
    if (path.startsWith('/') && REDDIT_PATH_RE.test(path)) return true;
    if (path === '/' || path.startsWith('/?')) return true;
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

  function getNextUrl() {
    var nextBtn = document.querySelector('.next-button a');
    return nextBtn ? nextBtn.href : null;
  }

  function loadNextPage() {
    if (loading) return;
    var nextUrl = getNextUrl();
    if (!nextUrl) return;

    loading = true;
    pageNum++;

    var marker = document.createElement('div');
    marker.style.cssText = 'text-align:center;padding:20px;color:#818384;font-size:14px;border-top:2px solid #343536;margin:10px 0;';
    marker.textContent = 'Loading page ' + pageNum + '...';
    var siteTable = document.querySelector('#siteTable');
    if (siteTable) siteTable.appendChild(marker);

    fetch(nextUrl)
      .then(function(r) { return r.text(); })
      .then(function(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var newPosts = doc.querySelectorAll('#siteTable > .thing');
        var newNext = doc.querySelector('.next-button a');

        if (siteTable && newPosts.length > 0) {
          marker.textContent = 'Page ' + pageNum;
          newPosts.forEach(function(post) {
            siteTable.appendChild(post);
          });

          // Update next button for the following page
          var oldNext = document.querySelector('.next-button a');
          if (oldNext && newNext) {
            oldNext.href = newNext.href;
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
  .rank { color: #818384 !important; }
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

  /* Misc */
  hr, .thing .child { border-color: #343536 !important; }
  .clearleft + .clearleft { border-color: #343536 !important; }
  .expando { background-color: #272729 !important; border-color: #343536 !important; }
  .selftext, .usertext-edit { background-color: #272729 !important; }
  .nav-buttons, .nextprev a { color: #4fbcff !important; }
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
  ::-webkit-scrollbar { width: 12px; }
  ::-webkit-scrollbar-track { background: #1a1a1b; }
  ::-webkit-scrollbar-thumb { background: #343536; border-radius: 6px; }
  ::-webkit-scrollbar-thumb:hover { background: #4a4a4c; }
</style>`

      html = html.replace(/<head[^>]*>/i, `<head>${injectScript}${nightModeCSS}`)
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
