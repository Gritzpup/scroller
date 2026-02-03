import express from 'express';
import fetch from 'node-fetch';

const app = express();
const PORT = 5178;

// Store cookies per session
const sessionCookies = new Map();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'scroller-proxy' });
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

// Direct proxy for any path
app.all('/*', async (req, res) => {
  try {
    const sessionId = req.query._session || 'default';
    const redditUrl = `https://old.reddit.com${req.path}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`;

    console.log(`📡 Proxying: ${redditUrl}`);

    // Build headers
    const headers = {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'identity',
      'Referer': 'https://old.reddit.com/'
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
        // Store in server-side session
        const cookiePair = cookieStr.split(';')[0];
        const cookieName = cookiePair.split('=')[0];
        const existing = cookies.findIndex(c => c.split('=')[0] === cookieName);
        if (existing >= 0) {
          cookies[existing] = cookiePair;
        } else {
          cookies.push(cookiePair);
        }

        // Rewrite for browser storage (remove Domain so it becomes host-only cookie)
        let rewritten = cookieStr.replace(/;\s*Domain=[^;]*/gi, '');
        rewritten = rewritten.replace(/;\s*SameSite=None/gi, '');
        setCookieHeaders.push(rewritten);
      });
    }

    // Set CORS and framing headers - allow Reddit auth headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-modhash, X-Modhash, X-CSRF-Token, Accept, Accept-Language, Content-Language, Cache-Control, User-Agent, Cookie');
    res.setHeader('Access-Control-Expose-Headers', 'Set-Cookie, x-modhash, X-Modhash');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('Content-Security-Policy-Report-Only');

    // Set the rewritten cookies
    if (setCookieHeaders.length > 0) {
      res.setHeader('Set-Cookie', setCookieHeaders);
    }

    if (contentType && contentType.includes('text/html')) {
      let html = await response.text();

      // Remove CSP headers that block framing
      html = html.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

      // Rewrite all resource URLs to use proxy
      // This ensures ALL requests (scripts, images, etc.) go through the proxy
      html = html.replace(/https:\/\/old\.reddit\.com/g, '');
      html = html.replace(/https:\/\/reddit\.com/g, '');
      html = html.replace(/https:\/\/www\.reddit\.com/g, '');
      html = html.replace(/https:\/\/www\.redditstatic\.com/g, '/proxy-static');
      html = html.replace(/https:\/\/redditstatic\.com/g, '/proxy-static');

      // Inject early interception script before any other scripts run
      html = html.replace(
        /<head[^>]*>/i,
        `<head>
  <meta name="referrer" content="no-referrer">
  <script>
    window.__proxyIntercept = true;

    function rewriteUrl(url) {
      if (typeof url !== 'string') return url;
      // Route reddit URLs through proxy
      if (url.startsWith('https://old.reddit.com')) {
        return url.substring('https://old.reddit.com'.length) || '/';
      }
      if (url.startsWith('https://reddit.com')) {
        return url.substring('https://reddit.com'.length) || '/';
      }
      if (url.startsWith('https://www.reddit.com')) {
        return url.substring('https://www.reddit.com'.length) || '/';
      }
      // Route external static resources through proxy
      if (url.startsWith('https://www.redditstatic.com')) {
        return '/proxy-static/' + url.substring('https://www.redditstatic.com/'.length);
      }
      return url;
    }

    // Override XMLHttpRequest before any other code runs
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

    // Override fetch before any other code runs
    const originalFetch = window.fetch;
    window.fetch = function(resource, config) {
      if (typeof resource === 'string') {
        resource = rewriteUrl(resource);
      }
      return originalFetch.apply(this, [resource, config]);
    };
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
      // Pass through binary content
      const buffer = await response.buffer();
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      res.send(buffer);
    }
  } catch (error) {
    console.error('❌ Proxy error:', error.message);
    res.status(500).json({ error: 'Proxy error', message: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Scroller proxy running on port ${PORT}`);
  console.log(`📡 Access Reddit via: http://localhost:${PORT}/`);
});
