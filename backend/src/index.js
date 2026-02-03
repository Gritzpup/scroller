import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import cookieParser from 'cookie-parser';

const app = express();
const PORT = 5178;

// Store cookies per session
const sessionCookies = new Map();

app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(cookieParser());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'scroller-proxy' });
});

// Proxy endpoint for Reddit
app.get('/reddit-proxy', async (req, res) => {
  try {
    const redditUrl = req.query.url || 'https://old.reddit.com/';

    console.log(`📡 Proxying: ${redditUrl}`);

    const response = await fetch(redditUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      redirect: 'follow'
    });

    const html = await response.text();

    // Remove X-Frame-Options header to allow embedding
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');

    // Set headers to allow framing
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    // Send the HTML with modified base tag
    const modifiedHtml = html.replace(
      '<head>',
      '<head><base href="' + redditUrl + '">'
    );

    res.send(modifiedHtml);
  } catch (error) {
    console.error('❌ Proxy error:', error.message);
    res.status(500).json({ error: 'Failed to fetch Reddit', details: error.message });
  }
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
    const sessionId = req.cookies.sessionId || 'default';
    const redditUrl = `https://old.reddit.com${req.path}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`;

    console.log(`📡 Proxying: ${redditUrl} [Session: ${sessionId}]`);

    // Build headers with stored cookies
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate'
    };

    // Add stored cookies from previous requests
    const cookies = getSessionCookies(sessionId);
    if (cookies.length > 0) {
      headers['Cookie'] = cookies.join('; ');
    }

    const response = await fetch(redditUrl, {
      method: req.method,
      headers,
      redirect: 'follow',
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined
    });

    // Store new cookies from response
    const setCookieHeader = response.headers.get('set-cookie');
    if (setCookieHeader) {
      const newCookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
      newCookies.forEach(cookieStr => {
        const cookieName = cookieStr.split('=')[0];
        // Only store if not already present
        if (!cookies.some(c => c.startsWith(cookieName))) {
          cookies.push(cookieStr.split(';')[0]); // Store just name=value
        } else {
          // Update existing cookie
          const idx = cookies.findIndex(c => c.startsWith(cookieName));
          cookies[idx] = cookieStr.split(';')[0];
        }
      });
    }

    const contentType = response.headers.get('content-type');

    // Remove frame-blocking headers
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');

    if (contentType && contentType.includes('text/html')) {
      const html = await response.text();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('X-Frame-Options', 'ALLOWALL');
      res.setHeader('Access-Control-Allow-Credentials', 'true');

      // Add base tag for relative URLs
      const modifiedHtml = html.replace(
        '<head>',
        '<head><base href="https://old.reddit.com/">'
      );

      res.send(modifiedHtml);
    } else {
      // For non-HTML content, pass through as-is
      const buffer = await response.buffer();
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      res.send(buffer);
    }
  } catch (error) {
    console.error('❌ Proxy error:', error.message);
    res.status(500).send(`Error: ${error.message}`);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Scroller proxy running on port ${PORT}`);
  console.log(`📡 Proxy endpoint: http://localhost:${PORT}/`);
  console.log(`🌐 Access Reddit via iframe: http://localhost:${PORT}/`);
});
