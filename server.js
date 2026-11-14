const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Simple in-memory response cache for fast UI reloads
const apiCache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 10; // 10 minutes

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function fetchRemoteJson(targetUrl, timeoutMs = 8000) {
  const cached = apiCache.get(targetUrl);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return Promise.resolve(cached.data);
  }

  return new Promise((resolve, reject) => {
    const req = https.get(
      targetUrl,
      {
        headers: {
          'User-Agent': 'SparkFlix-PWA/1.0 (Educational Project)',
          'Accept': 'application/json'
        },
        timeout: timeoutMs
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchRemoteJson(res.headers.location, timeoutMs).then(resolve).catch(reject);
        }
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              apiCache.set(targetUrl, { timestamp: Date.now(), data: parsed });
            }
            resolve(parsed);
          } catch (err) {
            reject(new Error(`Invalid JSON from ${targetUrl}: ${err.message}`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Request timeout after ${timeoutMs}ms: ${targetUrl}`));
    });
    req.on('error', (err) => reject(err));
  });
}

const server = http.createServer(async (req, res) => {
  // Enable CORS for local dev and webviews
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 1. Proxy VidSpark Discovery API: /api/discover/movies, /api/discover/tv, /api/discover/views
  if (pathname.startsWith('/api/discover/')) {
    const endpoint = pathname.replace('/api/discover/', '');
    const allowed = ['movies', 'tv', 'views'];
    if (!allowed.includes(endpoint)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: false, error: 'Invalid discovery endpoint' }));
      return;
    }

    const remoteUrl = `https://vidspark.to/api/discover/${endpoint}${parsedUrl.search}`;
    try {
      const data = await fetchRemoteJson(remoteUrl, 9000);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          result: false,
          error: 'Upstream VidSpark API unreachable, using client fallback',
          details: err.message
        })
      );
    }
    return;
  }

  // 2. Enrich Metadata (Posters, Backdrops, Plot, Cast, Episodes) via Cinemeta by IMDb ID
  if (pathname.startsWith('/api/meta/')) {
    const parts = pathname.split('/').filter(Boolean); // ['api', 'meta', type, imdbId]
    const mediaType = parts[2] === 'tv' || parts[2] === 'series' ? 'series' : 'movie';
    const imdbId = parts[3];

    if (!imdbId || !imdbId.startsWith('tt')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Valid IMDb ID (tt...) required' }));
      return;
    }

    const cinemetaUrl = `https://v3-cinemeta.strem.io/meta/${mediaType}/${encodeURIComponent(imdbId)}.json`;
    try {
      const data = await fetchRemoteJson(cinemetaUrl, 6000);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ meta: null, error: err.message }));
    }
    return;
  }

  // 3. Serve Static PWA Files
  let safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  if (safePath === '/' || safePath === '\\') {
    safePath = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // SPA Fallback to index.html
      const indexFile = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexFile, (readErr, content) => {
        if (readErr) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': contentType };
    if (safePath.endsWith('sw.js')) {
      headers['Service-Worker-Allowed'] = '/';
      headers['Cache-Control'] = 'no-cache';
    }

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500);
        res.end('Internal Server Error');
        return;
      }
      res.writeHead(200, headers);
      res.end(content);
    });
  });
});

server.listen(PORT, () => {
  console.log(`\n🎬 SparkFlix (VidSpark Netflix PWA) running at:`);
  console.log(`   👉 Local:   http://localhost:${PORT}`);
});

