const http = require('http');
const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { handlePartyRequest } = require('./party');
const liveHealth = require('./health');
const { handleFootballRequest } = require('./football');

const PORT = process.env.PORT || 3000;

// Genres Cinemeta's "top" catalogs accept (used by /api/catalog for recommendations)
const CATALOG_GENRES = [
  'Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama',
  'Family', 'Fantasy', 'History', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller',
  'War', 'Western'
];
const PUBLIC_DIR = path.join(__dirname, 'public');

// Simple in-memory response cache for fast UI reloads
const apiCache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 10; // 10 minutes
const LIVE_CACHE_TTL_MS = 1000 * 90; // 90 seconds for live sports feeds

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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

// Default curated Live Sports & TV channels (combines YooyoTV AlbaPlayer + RRTY + 24/7 HD HLS streams)
const DEFAULT_LIVE_CHANNELS = [
  {
    id: 'yooyo-test-1',
    albaId: 'test-1',
    title: 'YooyoTV Main Match Feed (RRTY HD)',
    category: 'sports',
    competition: 'Live Football · RenRen TiYu',
    badge: 'LIVE MATCH',
    quality: 'HD 1080p',
    language: 'Live Stadium / ZH',
    m3u8Url:
      'https://play.aarray.cn/rrty/hd-zh-1-4518097_gqzm.m3u8?auth_key=1794695523-0-0-afae1a8fa2307546474308566c247e1c&token=b31b516187a32f20&device=4&platform=rrty',
    embedUrl: 'https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?id=test-1',
    sourceSite: 'yooyotvlive.com.ng',
    poster: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=900&q=80'
  },
  {
    id: 'yooyo-test-2',
    albaId: 'test-2',
    title: 'YooyoTV Match Arena 2',
    category: 'sports',
    competition: 'Premier League & European Football',
    badge: 'LIVE SPORTS',
    quality: 'HD',
    language: 'Multi',
    m3u8Url: '',
    embedUrl: 'https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?id=test-2',
    sourceSite: 'yooyotvlive.com.ng',
    poster: 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=900&q=80'
  },
  {
    id: 'yooyo-bein-1',
    albaId: 'bein-1',
    title: 'YooyoTV Sports Channel 3 (beIN / Sky)',
    category: 'sports',
    competition: 'UEFA Champions League & LaLiga',
    badge: 'LIVE SPORTS',
    quality: 'HD',
    language: 'EN / AR',
    m3u8Url: '',
    embedUrl: 'https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?id=bein-1',
    sourceSite: 'yooyotvlive.com.ng',
    poster: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=900&q=80'
  },
  {
    id: 'redbull-tv',
    title: 'Red Bull TV — Live Action Sports',
    category: 'sports',
    competition: 'Motorsport · Rally · Extreme Sports 24/7',
    badge: '24/7 HD',
    quality: 'FHD 1080p',
    language: 'EN',
    m3u8Url: 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8',
    embedUrl: '',
    sourceSite: 'rbmn-live.akamaized.net',
    poster: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=900&q=80'
  },
  {
    id: 'sky-news-live',
    title: 'Sky News International & Sports Desk',
    category: 'news',
    competition: 'Breaking News & UK Sports Updates',
    badge: 'LIVE TV',
    quality: 'HD 720p',
    language: 'EN',
    m3u8Url: 'https://linear901-oo-hls0-prd-gtm.delivery.skycdp.com/17501/sde-fast-skynews/master.m3u8',
    embedUrl: '',
    sourceSite: 'skycdp.com',
    poster: 'https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=900&q=80'
  },
  {
    id: 'dw-english',
    title: 'DW English — Global News & Football',
    category: 'news',
    competition: 'Bundesliga Highlights & World News',
    badge: 'LIVE TV',
    quality: 'HD 1080p',
    language: 'EN',
    m3u8Url: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8',
    embedUrl: '',
    sourceSite: 'akamaized.net',
    poster: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=900&q=80'
  },
  {
    id: 'aljazeera-en',
    title: 'Al Jazeera English Live',
    category: 'news',
    competition: '24/7 World Broadcast & Sports',
    badge: 'LIVE TV',
    quality: 'HD 1080p',
    language: 'EN',
    m3u8Url: 'https://live-hls-web-aje.getaj.net/AJE/index.m3u8',
    embedUrl: '',
    sourceSite: 'getaj.net',
    poster: 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=900&q=80'
  },
  {
    id: 'nasa-tv',
    title: 'NASA TV Public — Live Space Station',
    category: 'entertainment',
    competition: 'ISS Earth Views & Mission Control',
    badge: 'LIVE 24/7',
    quality: 'HD',
    language: 'EN',
    m3u8Url: 'https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8',
    embedUrl: '',
    sourceSite: 'ntv1.akamaized.net',
    poster: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=900&q=80'
  }
];

function fetchRemoteBuffer(targetUrl, { timeoutMs = 8000, headers = {}, redirectsLeft = 4 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (err) {
      return reject(err);
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.get(
      targetUrl,
      {
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: '*/*',
          'Accept-Encoding': 'gzip, deflate',
          ...headers
        },
        timeout: timeoutMs
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          const nextUrl = new URL(res.headers.location, targetUrl).toString();
          res.resume();
          return fetchRemoteBuffer(nextUrl, { timeoutMs, headers, redirectsLeft: redirectsLeft - 1 })
            .then(resolve)
            .catch(reject);
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const rawBuf = Buffer.concat(chunks);
          const encoding = (res.headers['content-encoding'] || '').toLowerCase();
          const finish = (buf) =>
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: buf.toString('utf-8'),
              buffer: buf
            });

          if (encoding === 'gzip') {
            zlib.gunzip(rawBuf, (err, decoded) => finish(err ? rawBuf : decoded));
          } else if (encoding === 'deflate') {
            zlib.inflate(rawBuf, (err, decoded) => finish(err ? rawBuf : decoded));
          } else {
            finish(rawBuf);
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

function fetchRemoteJson(targetUrl, timeoutMs = 8000) {
  const cached = apiCache.get(targetUrl);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return Promise.resolve(cached.data);
  }

  return fetchRemoteBuffer(targetUrl, {
    timeoutMs,
    headers: {
      'User-Agent': 'SparkFlix-PWA/1.0 (Educational Project)',
      Accept: 'application/json'
    }
  }).then(({ statusCode, body }) => {
    const parsed = JSON.parse(body);
    if (statusCode >= 200 && statusCode < 300) {
      apiCache.set(targetUrl, { timestamp: Date.now(), data: parsed });
    }
    return parsed;
  });
}

/**
 * Extracts any .m3u8 URL from raw HTML, JS, or JSON responses (including base64 encoded strings in AlbaPlayer).
 */
function extractM3u8FromText(text) {
  if (!text) return '';

  // 1. Direct https://...m3u8 URL (unescaped or JSON-escaped)
  const unescaped = text.replace(/\\\//g, '/');
  const directMatch = unescaped.match(/https?:\/\/[^\s"'<>\\]+\.m3u8(?:\?[^\s"'<>\\]*)?/i);
  if (directMatch) {
    return directMatch[0];
  }

  // 2. Check base64 strings (AlbaPlayer frequently encodes links with base64 / atob)
  const b64Matches = unescaped.match(/(?:atob\s*\(\s*["']|["'])(aHR0c[A-Za-z0-9+/=]{16,})["']/g) || [];
  for (const raw of b64Matches) {
    const token = raw.replace(/^(?:atob\s*\(\s*)?["']|["']$/g, '');
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      const m = decoded.match(/https?:\/\/[^\s"'<>\\]+\.m3u8(?:\?[^\s"'<>\\]*)?/i);
      if (m) return m[0];
    } catch (_) {
      /* ignore invalid base64 */
    }
  }

  return '';
}

/**
 * Resolves a fresh .m3u8 URL from yooyotvlive.com.ng's AlbaPlayer endpoint:
 * 1) Fetches /albaplayer-package/m3u8-player.php?id=<albaId> and captures PHPSESSID cookie
 * 2) Checks HTML for embedded .m3u8
 * 3) Polls /albaplayer-package/m3u8-player.php?status=1&_=<ts> with that session cookie
 */
async function resolveAlbaPlayerChannel(albaId = 'test-1') {
  const cleanId = String(albaId || 'test-1').replace(/[^a-zA-Z0-9_-]/g, '');
  const cacheKey = `alba:${cleanId}`;
  const cached = apiCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < LIVE_CACHE_TTL_MS) {
    return cached.data;
  }

  const embedUrl = `https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?id=${encodeURIComponent(cleanId)}`;
  let m3u8Url = '';
  let statusPayload = null;

  try {
    const pageRes = await fetchRemoteBuffer(embedUrl, {
      timeoutMs: 6500,
      headers: {
        Referer: 'https://yooyotvlive.com.ng/',
        Origin: 'https://yooyotvlive.com.ng'
      }
    });

    m3u8Url = extractM3u8FromText(pageRes.body);

    const setCookies = pageRes.headers['set-cookie'] || [];
    const cookieHeader = (Array.isArray(setCookies) ? setCookies : [setCookies])
      .map((c) => String(c).split(';')[0])
      .filter(Boolean)
      .join('; ');

    if (!m3u8Url) {
      const statusUrl = `https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?status=1&_=${Date.now()}`;
      const statusRes = await fetchRemoteBuffer(statusUrl, {
        timeoutMs: 5500,
        headers: {
          Referer: embedUrl,
          Origin: 'https://yooyotvlive.com.ng',
          ...(cookieHeader ? { Cookie: cookieHeader } : {})
        }
      });

      m3u8Url = extractM3u8FromText(statusRes.body);
      try {
        statusPayload = JSON.parse(statusRes.body);
      } catch (_) {
        statusPayload = null;
      }
    }
  } catch (_) {
    /* Upstream unreachable or timed out; fallback used */
  }

  // Fallback for test-1 if upstream didn't expose raw m3u8 in initial scrape
  if (!m3u8Url && cleanId === 'test-1') {
    m3u8Url = DEFAULT_LIVE_CHANNELS[0].m3u8Url;
  }

  const result = {
    albaId: cleanId,
    embedUrl,
    m3u8Url,
    statusPayload,
    resolvedAt: new Date().toISOString()
  };
  apiCache.set(cacheKey, { timestamp: Date.now(), data: result });
  return result;
}

/**
 * Scrapes yooyotvlive.com.ng homepage for any live match cards and AlbaPlayer channel IDs.
 */
async function discoverYooyoLiveChannels(forceRefresh = false) {
  const cacheKey = 'live:channels:list';
  const cached = apiCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.timestamp < LIVE_CACHE_TTL_MS) {
    return cached.data;
  }

  const discovered = [];
  const seenIds = new Set();

  try {
    const homeRes = await fetchRemoteBuffer('https://yooyotvlive.com.ng/', {
      timeoutMs: 6500,
      headers: { Referer: 'https://yooyotvlive.com.ng/' }
    });

    const html = homeRes.body || '';

    // Find any m3u8-player.php?id=XYZ references in the homepage
    const idRegex = /m3u8-player\.php\?id=([a-zA-Z0-9_-]+)/gi;
    let match;
    while ((match = idRegex.exec(html)) !== null) {
      const albaId = match[1];
      if (!seenIds.has(albaId)) {
        seenIds.add(albaId);
        discovered.push({
          id: `yooyo-${albaId}`,
          albaId,
          title: `YooyoTV Live Feed (${albaId.toUpperCase()})`,
          category: 'sports',
          competition: 'YooyoTV Live Football',
          badge: 'LIVE MATCH',
          quality: 'HD',
          language: 'Live',
          m3u8Url: '',
          embedUrl: `https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?id=${encodeURIComponent(albaId)}`,
          sourceSite: 'yooyotvlive.com.ng',
          poster: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=900&q=80'
        });
      }
    }
  } catch (_) {
    /* ignore scrape errors and fall back to default channels */
  }

  // Resolve fresh .m3u8 for test-1 in the background or inline
  const resolvedTest1 = await resolveAlbaPlayerChannel('test-1');

  const channels = DEFAULT_LIVE_CHANNELS.map((ch) => {
    if (ch.albaId === 'test-1' && resolvedTest1 && resolvedTest1.m3u8Url) {
      return { ...ch, m3u8Url: resolvedTest1.m3u8Url };
    }
    return { ...ch };
  });

  // Merge any extra AlbaPlayer IDs discovered on yooyotvlive.com.ng
  discovered.forEach((d) => {
    if (!channels.some((c) => c.albaId === d.albaId)) {
      channels.unshift(d);
    }
  });

  const payload = {
    result: true,
    updatedAt: new Date().toISOString(),
    source: 'yooyotvlive.com.ng + SparkFlix Live Hub',
    channels
  };

  apiCache.set(cacheKey, { timestamp: Date.now(), data: payload });
  return payload;
}

const server = http.createServer(async (req, res) => {
  // Enable CORS for local dev and webviews
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 0a. Cheap health endpoint for uptime pings (keeps the free Render instance awake)
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('ok');
    return;
  }

  // 0b. Watch Party rooms (Server-Sent Events): /api/party/:code[/events|/send]
  if (pathname.startsWith('/api/party/') && handlePartyRequest(req, res, pathname, parsedUrl.searchParams)) {
    return;
  }

  // 0b2. Football: live scores + official highlights
  if (pathname.startsWith('/api/football/') && handleFootballRequest(req, res, pathname, parsedUrl.searchParams)) {
    return;
  }

  // 0c. Recommendation catalog: /api/catalog/:movie|tv/:genre → trimmed Cinemeta "top" list
  if (pathname.startsWith('/api/catalog/')) {
    const parts = pathname.split('/').filter(Boolean); // ['api','catalog',type,genre]
    const type = parts[2] === 'tv' || parts[2] === 'series' ? 'series' : 'movie';
    const genre = decodeURIComponent(parts[3] || '');
    if (!CATALOG_GENRES.includes(genre)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown genre' }));
      return;
    }
    try {
      const data = await fetchRemoteJson(
        `https://v3-cinemeta.strem.io/catalog/${type}/top/genre=${encodeURIComponent(genre)}.json`,
        8000
      );
      const metas = (data.metas || []).map((m) => ({
        imdb_id: m.imdb_id || m.id,
        tmdbid: m.moviedb_id ? String(m.moviedb_id) : '',
        title: m.name,
        year: m.year || m.releaseInfo || '',
        type: type === 'series' ? 'tv' : 'movie',
        genres: m.genres || m.genre || [],
        cast: (m.cast || []).slice(0, 6),
        director: Array.isArray(m.director) ? m.director.slice(0, 2) : [],
        rating: m.imdbRating || '',
        poster: m.poster ? m.poster.replace('/poster/small/', '/poster/medium/') : ''
      }));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=1800' });
      res.end(JSON.stringify({ genre, type, metas }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Catalog unavailable', metas: [] }));
    }
    return;
  }

  // 1. Live TV & Sports API: /api/live/channels — only channels that pass a health check
  if (pathname === '/api/live/channels') {
    const forceRefresh = parsedUrl.searchParams.get('refresh') === '1';
    let data;
    try {
      data = await discoverYooyoLiveChannels(forceRefresh);
    } catch (err) {
      data = { result: true, updatedAt: new Date().toISOString(), channels: DEFAULT_LIVE_CHANNELS };
    }
    const checked = await liveHealth.annotate(data.channels || []);
    const isYooyo = (ch) =>
      Boolean(ch.albaId || ch.sourceSite === 'yooyotvlive.com.ng' || String(ch.id || '').startsWith('yooyo-'));
    const online = checked.filter((ch) => ch.online || isYooyo(ch));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(
      JSON.stringify({
        ...data,
        channels: online,
        offlineCount: checked.length - online.length,
        checkedAt: new Date().toISOString()
      })
    );
    return;
  }

  // 2. Live Channel Resolver: /api/live/resolve?id=test-1
  if (pathname === '/api/live/resolve') {
    const albaId = parsedUrl.searchParams.get('id') || 'test-1';
    try {
      const resolved = await resolveAlbaPlayerChannel(albaId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ result: true, ...resolved }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ result: false, error: err.message }));
    }
    return;
  }

  // 3. HLS (.m3u8 / .ts) CORS & Referer Proxy: /api/live/proxy?url=<encodedUrl>
  if (pathname === '/api/live/proxy') {
    const target = parsedUrl.searchParams.get('url');
    if (!target || !/^https?:\/\//i.test(target)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Valid http/https URL required' }));
      return;
    }

    try {
      const upstream = await fetchRemoteBuffer(target, {
        timeoutMs: 9000,
        headers: {
          Referer: 'https://yooyotvlive.com.ng/',
          Origin: 'https://yooyotvlive.com.ng'
        }
      });

      const contentType = upstream.headers['content-type'] || 'application/vnd.apple.mpegurl';
      const isM3u8 =
        target.includes('.m3u8') ||
        contentType.includes('mpegurl') ||
        upstream.body.trimStart().startsWith('#EXTM3U');

      if (isM3u8) {
        // Rewrite relative segment/playlist paths to absolute URLs (proxied through /api/live/proxy)
        const baseObj = new URL(target);
        const rewritten = upstream.body
          .split(/\r?\n/)
          .map((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return line;
            try {
              const abs = new URL(trimmed, baseObj).toString();
              return `/api/live/proxy?url=${encodeURIComponent(abs)}`;
            } catch (_) {
              return line;
            }
          })
          .join('\n');

        res.writeHead(200, {
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Cache-Control': 'no-cache'
        });
        res.end(rewritten);
      } else {
        res.writeHead(upstream.statusCode || 200, {
          'Content-Type': contentType,
          'Cache-Control': 'max-age=60'
        });
        res.end(upstream.buffer);
      }
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to proxy stream', details: err.message }));
    }
    return;
  }

  // 4. Proxy VidSpark Discovery API: /api/discover/movies, /api/discover/tv, /api/discover/views
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

  // 5. Enrich Metadata (Posters, Backdrops, Plot, Cast, Episodes) via Cinemeta by IMDb ID
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

  // 6. Serve Static PWA Files
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

// Warm up the live-channel health checks so the first visitor gets an instant, filtered list
discoverYooyoLiveChannels()
  .then((data) => liveHealth.refresh(data.channels || []))
  .catch(() => liveHealth.refresh(DEFAULT_LIVE_CHANNELS));

server.listen(PORT, () => {
  console.log(`\n🎬 SparkFlix (VidSpark Netflix PWA + Live Sports Hub) running at:`);
  console.log(`   👉 Local:   http://localhost:${PORT}`);
});
