import express from 'express';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 5177;

// Store cookies per session
const sessionCookies = new Map();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files from dist (after build) or through Vite dev server
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'scroller' });
});

// Handle CORS preflight requests
app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-modhash, X-Modhash, X-CSRF-Token, Accept, Accept-Language, Content-Language, Cache-Control, User-Agent, Cookie');
  res.setHeader('Access-Control-Expose-Headers', 'Set-Cookie, x-modhash, X-Modhash');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Content-Length', '0');
  res.sendStatus(204);
});

// Get or create session cookies
function getSessionCookies(sessionId) {
  if (!sessionCookies.has(sessionId)) {
    sessionCookies.set(sessionId, []);
  }
  return sessionCookies.get(sessionId);
}

// Proxy for static resources (CSS, JS, images from redditstatic)
app.all('/proxy-static/*', async (req, res) => {
  try {
    const path = req.path.substring('/proxy-static/'.length);
    const resourceUrl = `https://www.redditstatic.com/${path}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`;

    console.log(`📦 Proxying static: ${resourceUrl}`);

    const response = await fetch(resourceUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
      }
    });

    const contentType = response.headers.get('content-type');
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000');

    const buffer = await response.buffer();
    res.send(buffer);
  } catch (error) {
    console.error('❌ Static proxy error:', error.message);
    res.status(500).json({ error: 'Static proxy error', message: error.message });
  }
});

// Silently handle tracking requests to prevent CORS errors
app.all('/tracking/*', async (req, res) => {
  try {
    const pathAfterTracking = req.path.substring('/tracking/'.length);
    let trackingUrl;

    if (pathAfterTracking.startsWith('w3-reporting/')) {
      const path = pathAfterTracking.substring('w3-reporting/'.length);
      trackingUrl = `https://w3-reporting.reddit.com/${path}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`;
    } else if (pathAfterTracking.startsWith('error/')) {
      const path = pathAfterTracking.substring('error/'.length);
      trackingUrl = `https://error-tracking.reddit.com/${path}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`;
    } else if (pathAfterTracking.startsWith('rlcdn/')) {
      const path = pathAfterTracking.substring('rlcdn/'.length);
      trackingUrl = `https://id.rlcdn.com/${path}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`;
    }

    if (trackingUrl) {
      console.log(`📊 Proxying tracking request: ${trackingUrl}`);
      try {
        const response = await fetch(trackingUrl, {
          method: req.method,
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
            'Referer': 'https://www.reddit.com/'
          },
          redirect: 'follow',
          timeout: 3000
        });

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Content-Type', 'application/json');

        if (response.ok) {
          const data = await response.text();
          res.send(data || '{}');
        } else {
          res.status(response.status).send('{}');
        }
      } catch (error) {
        console.log(`📊 Tracking request failed (OK to ignore): ${error.message}`);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(204).send('');
      }
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(204).send('');
    }
  } catch (error) {
    console.log(`📊 Tracking handler error (OK to ignore): ${error.message}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(204).send('');
  }
});

// Direct proxy for Reddit API/pages
app.all('/api/*', async (req, res) => {
  try {
    const sessionId = req.query._session || 'default';

    // Use new Reddit for login/auth pages, old Reddit for everything else
    const isLoginPage = req.path.includes('/login') || req.path.includes('/auth');
    const domain = isLoginPage ? 'https://www.reddit.com' : 'https://old.reddit.com';
    const redditUrl = `${domain}${req.path.substring('/api'.length)}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`;

    console.log(`📡 Proxying: ${redditUrl}`);

    // Build headers
    const headers = {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'identity',
      'Referer': 'https://www.reddit.com/'
    };

    // Add stored cookies
    const cookies = getSessionCookies(sessionId);
    if (cookies.length > 0) {
      headers['Cookie'] = cookies.join('; ');
    }

    // Add request body if present
    const fetchOptions = {
      method: req.method,
      headers,
      redirect: 'follow'
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && Object.keys(req.body).length > 0) {
      fetchOptions.body = new URLSearchParams(req.body).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const response = await fetch(redditUrl, fetchOptions);

    const contentType = response.headers.get('content-type');

    // Store cookies server-side and rewrite for browser storage
    const setCookieHeader = response.headers.get('set-cookie');
    const setCookieHeaders = [];
    if (setCookieHeader) {
      const cookieStrings = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
      cookieStrings.forEach(cookieStr => {
        const cookiePair = cookieStr.split(';')[0];
        const cookieName = cookiePair.split('=')[0];
        const existing = cookies.findIndex(c => c.split('=')[0] === cookieName);
        if (existing >= 0) {
          cookies[existing] = cookiePair;
        } else {
          cookies.push(cookiePair);
        }

        let rewritten = cookieStr.replace(/;\s*Domain=[^;]*/gi, '');
        rewritten = rewritten.replace(/;\s*SameSite=None/gi, '');
        setCookieHeaders.push(rewritten);
      });
    }

    // Set CORS and framing headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-modhash, X-Modhash, X-CSRF-Token, Accept, Accept-Language, Content-Language, Cache-Control, User-Agent, Cookie');
    res.setHeader('Access-Control-Expose-Headers', 'Set-Cookie, x-modhash, X-Modhash');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('Content-Security-Policy-Report-Only');

    if (setCookieHeaders.length > 0) {
      res.setHeader('Set-Cookie', setCookieHeaders);
    }

    if (contentType && contentType.includes('text/html')) {
      let html = await response.text();

      html = html.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
      html = html.replace(/<script[^>]*sentry[^>]*>[\s\S]*?<\/script>/gi, '');
      html = html.replace(/window\.sentryLoaded[^;]*;/gi, '');

      html = html.replace(/https:\/\/old\.reddit\.com/g, '');
      html = html.replace(/https:\/\/www\.reddit\.com/g, '');
      html = html.replace(/https:\/\/reddit\.com/g, '');
      html = html.replace(/https:\/\/www\.redditstatic\.com/g, '/proxy-static');
      html = html.replace(/https:\/\/redditstatic\.com/g, '/proxy-static');

      html = html.replace(
        /<head[^>]*>/i,
        `<head>
  <meta name="referrer" content="no-referrer">
  <script>
    const OriginalMutationObserver = window.MutationObserver;
    window.MutationObserver = function(...args) {
      const observer = new OriginalMutationObserver(...args);
      const originalObserve = observer.observe;
      observer.observe = function(target, options) {
        if (target && target.nodeType) {
          return originalObserve.call(this, target, options);
        }
        return observer;
      };
      return observer;
    };
    window.MutationObserver.prototype = OriginalMutationObserver.prototype;

    window.addEventListener('error', (event) => {
      if (event.filename && event.filename.includes('web-client-content-script')) {
        event.preventDefault();
      }
    }, true);

    window.__proxyIntercept = true;

    function rewriteUrl(url) {
      if (typeof url !== 'string') return url;
      if (url.startsWith('https://old.reddit.com')) {
        return url.substring('https://old.reddit.com'.length) || '/';
      }
      if (url.startsWith('https://www.reddit.com')) {
        return url.substring('https://www.reddit.com'.length) || '/';
      }
      if (url.startsWith('https://reddit.com')) {
        return url.substring('https://reddit.com'.length) || '/';
      }
      if (url.startsWith('https://www.redditstatic.com')) {
        return '/proxy-static/' + url.substring('https://www.redditstatic.com/'.length);
      }
      if (url.startsWith('https://redditstatic.com')) {
        return '/proxy-static/' + url.substring('https://redditstatic.com/'.length);
      }
      if (url.startsWith('https://w3-reporting.reddit.com')) {
        return '/tracking/w3-reporting/' + url.substring('https://w3-reporting.reddit.com/'.length);
      }
      if (url.startsWith('https://error-tracking.reddit.com')) {
        return '/tracking/error/' + url.substring('https://error-tracking.reddit.com/'.length);
      }
      if (url.startsWith('https://id.rlcdn.com')) {
        return '/tracking/rlcdn/' + url.substring('https://id.rlcdn.com/'.length);
      }
      return url;
    }

    const OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function() {
      const xhr = new OriginalXHR();
      const originalOpen = xhr.open;
      xhr.open = function(method, url, ...args) {
        if (typeof url === 'string') {
          url = rewriteUrl(url);
        }
        return originalOpen.apply(this, [method, url, ...args]);
      };
      return xhr;
    };
    window.XMLHttpRequest.prototype = OriginalXHR.prototype;

    const originalFetch = window.fetch;
    window.fetch = function(resource, init) {
      if (typeof resource === 'string') {
        resource = rewriteUrl(resource);
      }
      return originalFetch.apply(this, [resource, init]).catch(err => {
        if (typeof resource === 'string' && (resource.includes('error-tracking') || resource.includes('w3-reporting') || resource.includes('rlcdn'))) {
          return new Response('{}', { status: 204, headers: { 'Content-Type': 'application/json' } });
        }
        throw err;
      });
    };
  </script>
  <script>
(function() {
  var PROXY_PREFIX = '';
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
`
      );

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('X-Frame-Options', 'ALLOWALL');
      res.send(html);
    } else if (contentType && contentType.includes('application/json')) {
      const json = await response.json();
      res.setHeader('Content-Type', 'application/json');
      res.json(json);
    } else {
      const buffer = await response.buffer();
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      res.send(buffer);
    }
  } catch (error) {
    console.error('❌ Proxy error:', error.message);
    res.status(500).json({ error: 'Proxy error', message: error.message });
  }
});

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Frontend not built. Run: npm run build');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Scroller running on http://localhost:${PORT}`);
});
