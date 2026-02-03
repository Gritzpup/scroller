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

// Get or create session cookies
function getSessionCookies(sessionId) {
  if (!sessionCookies.has(sessionId)) {
    sessionCookies.set(sessionId, []);
  }
  return sessionCookies.get(sessionId);
}

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

    // Store new cookies
    const setCookieHeader = response.headers.get('set-cookie');
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
      });
    }

    const contentType = response.headers.get('content-type');

    // Set CORS and framing headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('Content-Security-Policy-Report-Only');

    if (contentType && contentType.includes('text/html')) {
      let html = await response.text();

      // Remove CSP headers that block framing
      html = html.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

      // Add meta tags to allow framing and fix origin issues
      html = html.replace(
        '<head>',
        `<head>
  <meta name="referrer" content="no-referrer">
  <base href="https://old.reddit.com/">
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
