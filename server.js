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

// Default curated Live Sports & TV channels (combines Kora Plus + YooyoTV AlbaPlayer + 24/7 HD HLS streams)
const DEFAULT_LIVE_CHANNELS = [
  {
    id: 'kora-plus-main',
    title: 'Kora Plus — Main Live Match Feed',
    category: 'sports',
    competition: 'Live Football · Kora Plus HD',
    badge: 'LIVE MATCH',
    quality: 'HD 1080p',
    language: 'Live Stadium',
    m3u8Url: 'https://a16.kora-plus.li/live/main.m3u8?token=gHJtOyIpEjyBUcKYr9K6T4FXi7M&exp=1795373530',
    embedUrl: '',
    sourceSite: 'a16.kora-plus.li',
    alwaysOnline: true,
    poster: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=900&q=80'
  },
  {
    id: 'yooyo-test-1',
    albaId: 'test-1',
    title: 'YooyoTV Main Match Feed (Server 1 HD)',
    category: 'sports',
    competition: 'Live Football · YooyoTV Primary Arena',
    badge: 'LIVE MATCH',
    quality: 'HD 1080p',
    language: 'Live Stadium',
    m3u8Url: '',
    fallbackM3u8Url:
      'https://play.aarray.cn/rrty/hd-zh-1-4518097_gqzm.m3u8?auth_key=1794695523-0-0-afae1a8fa2307546474308566c247e1c&token=b31b516187a32f20&device=4&platform=rrty',
    embedUrl: 'https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?id=test-1',
    proxyEmbedUrl: '/api/live/embed?id=test-1',
    pageUrl: 'https://yooyotvlive.com.ng/',
    sourceSite: 'yooyotvlive.com.ng',
    alwaysOnline: true,
    poster: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=900&q=80'
  },
  {
    id: 'yooyo-test-2',
    albaId: 'test-2',
    title: 'YooyoTV Match Arena 2 (Server 2 HD)',
    category: 'sports',
    competition: 'Premier League & European Football',
    badge: 'LIVE MATCH',
    quality: 'HD 1080p',
    language: 'Multi',
    m3u8Url: '',
    embedUrl: 'https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?id=test-2',
    proxyEmbedUrl: '/api/live/embed?id=test-2',
    pageUrl: 'https://yooyotvlive.com.ng/',
    sourceSite: 'yooyotvlive.com.ng',
    alwaysOnline: true,
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
    proxyEmbedUrl: '/api/live/embed?id=bein-1',
    pageUrl: 'https://yooyotvlive.com.ng/',
    sourceSite: 'yooyotvlive.com.ng',
    alwaysOnline: true,
    poster: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=900&q=80'
  },
  {
    id: 'yooyo-bein-2',
    albaId: 'bein-2',
    title: 'YooyoTV Sports Channel 4 (beIN Premium 2)',
    category: 'sports',
    competition: 'European Leagues & Cup Football',
    badge: 'LIVE SPORTS',
    quality: 'HD',
    language: 'EN / AR',
    m3u8Url: '',
    embedUrl: 'https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?id=bein-2',
    proxyEmbedUrl: '/api/live/embed?id=bein-2',
    pageUrl: 'https://yooyotvlive.com.ng/',
    sourceSite: 'yooyotvlive.com.ng',
    alwaysOnline: true,
    poster: 'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?auto=format&fit=crop&w=900&q=80'
  },
  {
    id: 'yooyo-ssc-1',
    albaId: 'ssc-1',
    title: 'YooyoTV Sports Channel 5 (SSC / Spotv)',
    category: 'sports',
    competition: 'Pro League & International Football',
    badge: 'LIVE SPORTS',
    quality: 'HD',
    language: 'Multi',
    m3u8Url: '',
    embedUrl: 'https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?id=ssc-1',
    proxyEmbedUrl: '/api/live/embed?id=ssc-1',
    pageUrl: 'https://yooyotvlive.com.ng/',
    sourceSite: 'yooyotvlive.com.ng',
    alwaysOnline: true,
    poster: 'https://images.unsplash.com/photo-1518091043644-c1d4457512c6?auto=format&fit=crop&w=900&q=80'
  },
  {
    id: 'realmadrid-tv',
    title: 'Real Madrid TV — Official Live Club Channel',
    category: 'sports',
    competition: 'LaLiga · Champions League · Real Madrid 24/7',
    badge: '24/7 HD',
    quality: 'HD 720p',
    language: 'ES / EN',
    m3u8Url: 'https://rmtv.akamaized.net/hls/live/2043153/rmtv-es-web/master.m3u8',
    embedUrl: '',
    sourceSite: 'rmtv.akamaized.net',
    poster: 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=900&q=80'
  },
  {
    id: 'cbs-sports-hq',
    title: 'CBS Sports HQ — 24/7 Live Sports & Champions League Desk',
    category: 'sports',
    competition: 'UEFA Champions League · Serie A · Live Scores & Highlights',
    badge: '24/7 HD',
    quality: 'FHD 1080p',
    language: 'EN',
    m3u8Url: 'https://dai.google.com/linear/hls/event/Sid4xiTQTkCT1SLu6rjUSQ/master.m3u8',
    embedUrl: '',
    sourceSite: 'dai.google.com',
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

// Per-channel session state for YooyoTV AlbaPlayer (stores PHPSESSID cookies & referers across resolve + proxy)
const yooyoSessions = new Map();
const yooyoCookieJar = new Map();

function storeSetCookies(setCookieHeader, albaId = '') {
  const list = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
  const pairs = [];
  for (const raw of list) {
    const firstPart = String(raw || '').split(';')[0].trim();
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx > 0) {
      const k = firstPart.slice(0, eqIdx).trim();
      const v = firstPart.slice(eqIdx + 1).trim();
      yooyoCookieJar.set(k, v);
      pairs.push(`${k}=${v}`);
    }
  }
  if (albaId && pairs.length) {
    const prev = yooyoSessions.get(albaId) || {};
    const mergedMap = new Map();
    if (prev.cookieHeader) {
      prev.cookieHeader.split(';').forEach((p) => {
        const [k, ...rest] = p.trim().split('=');
        if (k) mergedMap.set(k, rest.join('='));
      });
    }
    pairs.forEach((p) => {
      const [k, ...rest] = p.split('=');
      if (k) mergedMap.set(k, rest.join('='));
    });
    const cookieHeader = [...mergedMap.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    yooyoSessions.set(albaId, { ...prev, cookieHeader, updatedAt: Date.now() });
    return cookieHeader;
  }
  return [...yooyoCookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function getYooyoCookieHeader(albaId = '') {
  if (albaId && yooyoSessions.has(albaId)) {
    const s = yooyoSessions.get(albaId);
    if (s && s.cookieHeader) return s.cookieHeader;
  }
  return [...yooyoCookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Unpacks Dean Edwards packed JS blocks: eval(function(p,a,c,k,e,d){...}('payload',radix,count,'sym1|sym2'.split('|')))
 */
function unpackDeanEdwards(text) {
  if (!text || !text.includes('eval(function(p,a,c,k,e,')) return '';
  const regex =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*'((?:\\'|[^'])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:\\'|[^'])*)'\.split\('\|'\)/g;
  const unpackedChunks = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    let payload = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    const radix = parseInt(m[2], 10) || 36;
    let count = parseInt(m[3], 10) || 0;
    const symtab = m[4].split('|');
    const encodeBase = (num) => {
      const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      if (num < radix) {
        return num < 36 ? num.toString(36) : chars[num] || String(num);
      }
      return encodeBase(Math.floor(num / radix)) + encodeBase(num % radix);
    };
    while (count--) {
      if (symtab[count]) {
        const token = encodeBase(count);
        payload = payload.replace(new RegExp(`\\b${token}\\b`, 'g'), symtab[count]);
      }
    }
    unpackedChunks.push(payload);
  }
  return unpackedChunks.join('\n');
}

/**
 * Extracts any .m3u8 URL from raw HTML, JS, or JSON responses (including base64, hex, JSON fields, and packed scripts).
 */
function extractM3u8FromText(text, baseUrl = 'https://yooyotvlive.com.ng/') {
  if (!text) return '';

  const unpacked = unpackDeanEdwards(text);
  const combined = unpacked ? `${text}\n${unpacked}` : text;

  const unescaped = combined
    .replace(/\\\//g, '/')
    .replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u([0-9A-Fa-f]{4})/g, (_, u) => String.fromCharCode(parseInt(u, 16)))
    .replace(/&amp;/gi, '&');

  const directMatch = unescaped.match(/https?:\/\/[^\s"'<>\\`]+\.m3u8(?:\?[^\s"'<>\\`]*)?/i);
  if (directMatch) return directMatch[0];

  const protoRelMatch = unescaped.match(/\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\/[^\s"'<>\\`]+\.m3u8(?:\?[^\s"'<>\\`]*)?/i);
  if (protoRelMatch) return `https:${protoRelMatch[0]}`;

  try {
    const parsedJson = JSON.parse(combined);
    const candidateKeys = ['m3u8Url', 'm3u8', 'streamUrl', 'stream_url', 'stream', 'file', 'source', 'url', 'src', 'hls'];
    const inspectObj = (obj) => {
      if (!obj || typeof obj !== 'object') return '';
      for (const k of candidateKeys) {
        const val = obj[k];
        if (typeof val === 'string' && val.trim()) {
          const v = val.trim().replace(/\\\//g, '/');
          if (/\.m3u8(\?|$)/i.test(v)) {
            try {
              return new URL(v, baseUrl).toString();
            } catch (_) {
              return v;
            }
          }
          if (/^[A-Za-z0-9+/=]{20,}$/.test(v)) {
            try {
              const dec = Buffer.from(v, 'base64').toString('utf-8');
              const nested = extractM3u8FromText(dec, baseUrl);
              if (nested) return nested;
            } catch (_) {}
          }
        }
      }
      for (const val of Object.values(obj)) {
        if (val && typeof val === 'object') {
          const found = inspectObj(val);
          if (found) return found;
        }
      }
      return '';
    };
    const fromJson = inspectObj(parsedJson);
    if (fromJson) return fromJson;
  } catch (_) {}

  const b64Matches = unescaped.match(/(?:atob\s*\(\s*["']|["'])([A-Za-z0-9+/=_-]{24,})["']/g) || [];
  for (const raw of b64Matches) {
    const token = raw.replace(/^(?:atob\s*\(\s*)?["']|["']$/g, '');
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      if (decoded.includes('.m3u8') || decoded.includes('http')) {
        const m = decoded.match(/https?:\/\/[^\s"'<>\\`]+\.m3u8(?:\?[^\s"'<>\\`]*)?/i);
        if (m) return m[0];
      }
    } catch (_) {}
  }

  const relMatch = unescaped.match(
    /(?:file|source|src|stream|url|hls)\s*[:=]\s*["']([^"']+\.m3u8(?:\?[^"']*)?)["']/i
  );
  if (relMatch && relMatch[1]) {
    try {
      return new URL(relMatch[1], baseUrl).toString();
    } catch (_) {
      return relMatch[1];
    }
  }

  return '';
}

/**
 * Resolves a fresh .m3u8 URL from yooyotvlive.com.ng's AlbaPlayer endpoint.
 */
async function resolveAlbaPlayerChannel(albaId = 'test-1', { forceRefresh = false, matchUrl = '' } = {}) {
  const cleanId = String(albaId || 'test-1').replace(/[^a-zA-Z0-9_-]/g, '');
  const cacheKey = `alba:${cleanId}`;
  const cached = apiCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.timestamp < 1000 * 45) {
    return cached.data;
  }

  const embedUrl = `https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?id=${encodeURIComponent(cleanId)}`;
  const refererPage = matchUrl || 'https://yooyotvlive.com.ng/';
  let m3u8Url = '';
  let statusPayload = null;
  let cookieHeader = getYooyoCookieHeader(cleanId);

  try {
    const pageRes = await fetchRemoteBuffer(embedUrl, {
      timeoutMs: 6500,
      headers: {
        Referer: refererPage,
        Origin: 'https://yooyotvlive.com.ng',
        ...(cookieHeader ? { Cookie: cookieHeader } : {})
      }
    });

    cookieHeader = storeSetCookies(pageRes.headers['set-cookie'], cleanId) || cookieHeader;
    m3u8Url = extractM3u8FromText(pageRes.body, embedUrl);

    if (!m3u8Url) {
      const statusEndpoints = [
        `https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?status=1&_=${Date.now()}`,
        `https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?id=${encodeURIComponent(cleanId)}&status=1&_=${Date.now()}`
      ];

      for (const statusUrl of statusEndpoints) {
        if (m3u8Url) break;
        try {
          const statusRes = await fetchRemoteBuffer(statusUrl, {
            timeoutMs: 5000,
            headers: {
              Referer: embedUrl,
              Origin: 'https://yooyotvlive.com.ng',
              'X-Requested-With': 'XMLHttpRequest',
              Accept: 'application/json, text/javascript, */*; q=0.01',
              ...(cookieHeader ? { Cookie: cookieHeader } : {})
            }
          });
          cookieHeader = storeSetCookies(statusRes.headers['set-cookie'], cleanId) || cookieHeader;
          m3u8Url = extractM3u8FromText(statusRes.body, embedUrl);
          try {
            statusPayload = JSON.parse(statusRes.body);
          } catch (_) {}
        } catch (_) {}
      }
    }

    if (!m3u8Url && pageRes.body) {
      const iframeMatch = pageRes.body.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (iframeMatch && iframeMatch[1] && !iframeMatch[1].includes('about:blank')) {
        try {
          const nestedUrl = new URL(iframeMatch[1].replace(/&amp;/g, '&'), embedUrl).toString();
          const nestedRes = await fetchRemoteBuffer(nestedUrl, {
            timeoutMs: 5000,
            headers: {
              Referer: embedUrl,
              Origin: 'https://yooyotvlive.com.ng',
              ...(cookieHeader ? { Cookie: cookieHeader } : {})
            }
          });
          m3u8Url = extractM3u8FromText(nestedRes.body, nestedUrl);
        } catch (_) {}
      }
    }
  } catch (_) {}

  yooyoSessions.set(cleanId, {
    ...(yooyoSessions.get(cleanId) || {}),
    cookieHeader,
    refererUrl: embedUrl,
    m3u8Url,
    updatedAt: Date.now()
  });

  const result = {
    albaId: cleanId,
    embedUrl,
    proxyEmbedUrl: `/api/live/embed?id=${encodeURIComponent(cleanId)}`,
    m3u8Url,
    proxyM3u8Url: m3u8Url ? `/api/live/proxy?url=${encodeURIComponent(m3u8Url)}&albaId=${encodeURIComponent(cleanId)}` : '',
    statusPayload,
    resolvedAt: new Date().toISOString()
  };
  apiCache.set(cacheKey, { timestamp: Date.now(), data: result });
  return result;
}

/**
 * Parses an M3U playlist (such as https://iptv-org.github.io/iptv/categories/sports.m3u)
 * into SparkFlix channel objects, prioritizing football and major HD sports networks.
 */
function parseSportsM3uPlaylist(m3uText, maxChannels = 18) {
  if (!m3uText || !m3uText.includes('#EXTINF')) return [];
  const lines = m3uText.split(/\r?\n/);
  const candidates = [];
  let currentMeta = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
      const idMatch = line.match(/tvg-id="([^"]+)"/i);
      const commaIdx = line.lastIndexOf(',');
      const rawTitle = commaIdx !== -1 ? line.slice(commaIdx + 1).trim() : 'Live Sports Channel';
      const qualMatch = rawTitle.match(/\((1080p|720p|576p|480p|4K|FHD|HD)\)/i);
      const cleanTitle = rawTitle
        .replace(/\s*\(\d+p\)\s*/gi, ' ')
        .replace(/\s*\[[^\]]*\]\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      currentMeta = {
        tvgId: idMatch ? idMatch[1] : '',
        logo: logoMatch ? logoMatch[1] : '',
        title: cleanTitle || rawTitle,
        quality: qualMatch ? qualMatch[1].toUpperCase() : 'HD'
      };
    } else if (!line.startsWith('#') && currentMeta) {
      if (/^https:\/\/[^\s]+\.m3u8(\?[^\s]*)?$/i.test(line)) {
        const priority =
          /football|soccer|madrid|barca|fifa|uefa|bein|espn|sky|tnt|dazn|eurosport|cbs|fox|arena|sport\s*tv|supersport|premier|laliga|serie\s*a|bundesliga/i.test(
            `${currentMeta.title} ${currentMeta.tvgId}`
          )
            ? 2
            : /1080P|720P/.test(currentMeta.quality)
            ? 1
            : 0;
        let host = 'iptv-org';
        try {
          host = new URL(line).hostname;
        } catch (_) {}
        candidates.push({
          priority,
          channel: {
            id: `iptv-${(currentMeta.tvgId || currentMeta.title)
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .slice(0, 32)}`,
            title: currentMeta.title,
            category: 'sports',
            competition: `Direct Sports HLS · ${host}`,
            badge: 'DIRECT HLS',
            quality: currentMeta.quality,
            language: 'Live',
            m3u8Url: line,
            embedUrl: '',
            sourceSite: host,
            poster:
              currentMeta.logo ||
              'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=900&q=80'
          }
        });
      }
      currentMeta = null;
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  const unique = [];
  const seenUrls = new Set();
  for (const item of candidates) {
    if (seenUrls.has(item.channel.m3u8Url)) continue;
    seenUrls.add(item.channel.m3u8Url);
    unique.push(item.channel);
    if (unique.length >= maxChannels) break;
  }
  return unique;
}

/**
 * Fetches direct token-free sports .m3u8 channels from iptv-org's public sports playlist
 * and live football match feeds from Streamed.su's public match API.
 */
async function discoverDirectSportsFeeds(forceRefresh = false) {
  const cacheKey = 'live:direct:sports';
  const cached = apiCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const directChannels = [];

  await Promise.allSettled([
    // 1. Direct token-free HLS sports streams from iptv-org
    (async () => {
      const res = await fetchRemoteBuffer('https://iptv-org.github.io/iptv/categories/sports.m3u', {
        timeoutMs: 6500
      });
      if (res.statusCode === 200 && res.body) {
        const parsed = parseSportsM3uPlaylist(res.body, 14);
        directChannels.push(...parsed);
      }
    })(),

    // 2. Direct live football match embeds from Streamed.su public API
    (async () => {
      const res = await fetchRemoteBuffer('https://streamed.su/api/matches/football', {
        timeoutMs: 5500,
        headers: { Accept: 'application/json' }
      });
      if (res.statusCode === 200 && res.body) {
        const matches = JSON.parse(res.body);
        if (Array.isArray(matches)) {
          const now = Date.now();
          // Keep live or upcoming matches within [-3h, +6h] that have stream sources
          const active = matches
            .filter(
              (m) =>
                m &&
                Array.isArray(m.sources) &&
                m.sources.length > 0 &&
                (!m.date || (m.date >= now - 3.5 * 3600 * 1000 && m.date <= now + 8 * 3600 * 1000))
            )
            .slice(0, 8);

          active.forEach((m) => {
            const src = m.sources[0];
            const isLiveNow = m.date && m.date <= now && m.date >= now - 2.5 * 3600 * 1000;
            directChannels.push({
              id: `match-${m.id || src.id}`,
              title: `${m.title}`,
              category: 'sports',
              competition: `Direct Football Feed (${String(src.source || 'HD').toUpperCase()})`,
              badge: isLiveNow ? 'LIVE MATCH' : 'MATCH FEED',
              quality: 'HD 1080p',
              language: 'EN',
              m3u8Url: '',
              embedUrl: `https://embedme.top/embed/${encodeURIComponent(src.source)}/${encodeURIComponent(src.id)}/1`,
              sourceSite: 'streamed.su',
              alwaysOnline: true,
              poster: m.poster
                ? `https://streamed.su${m.poster}`
                : 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=900&q=80'
            });
          });
        }
      }
    })()
  ]);

  apiCache.set(cacheKey, { timestamp: Date.now(), data: directChannels });
  return directChannels;
}

function cleanHtmlText(raw) {
  return String(raw || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#8211;|&ndash;/gi, '–')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scrapes yooyotvlive.com.ng homepage AND linked match pages for live match cards, team names, and AlbaPlayer channel IDs.
 */
async function discoverYooyoLiveChannels(forceRefresh = false) {
  const cacheKey = 'live:channels:list';
  const cached = apiCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.timestamp < LIVE_CACHE_TTL_MS) {
    return cached.data;
  }

  const discovered = [];
  const seenIds = new Set();

  const addDiscoveredChannel = (albaId, meta = {}) => {
    const cleanId = String(albaId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanId || seenIds.has(cleanId)) return;
    seenIds.add(cleanId);
    const embedUrl = `https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?id=${encodeURIComponent(cleanId)}`;
    discovered.push({
      id: `yooyo-${cleanId}`,
      albaId: cleanId,
      title: meta.title || `YooyoTV Live Feed (${cleanId.toUpperCase()})`,
      category: 'sports',
      competition: meta.competition || 'YooyoTV Live Football',
      badge: meta.badge || 'LIVE MATCH',
      quality: 'HD',
      language: 'Live',
      m3u8Url: meta.m3u8Url || '',
      embedUrl,
      proxyEmbedUrl: `/api/live/embed?id=${encodeURIComponent(cleanId)}`,
      pageUrl: meta.pageUrl || 'https://yooyotvlive.com.ng/',
      sourceSite: 'yooyotvlive.com.ng',
      alwaysOnline: true,
      poster: meta.poster || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=900&q=80'
    });
  };

  try {
    const homeRes = await fetchRemoteBuffer('https://yooyotvlive.com.ng/', {
      timeoutMs: 6500,
      headers: { Referer: 'https://yooyotvlive.com.ng/' }
    });
    storeSetCookies(homeRes.headers['set-cookie']);

    const html = homeRes.body || '';

    const idRegex = /m3u8-player\.php\?id=([a-zA-Z0-9_-]+)/gi;
    let match;
    while ((match = idRegex.exec(html)) !== null) {
      addDiscoveredChannel(match[1]);
    }

    const matchLinks = [];
    const seenUrls = new Set();
    const linkRegex = /<a\b[^>]*href=["'](https?:\/\/(?:www\.)?yooyotvlive\.com\.ng\/[^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(html)) !== null && matchLinks.length < 6) {
      const url = linkMatch[1];
      const inner = linkMatch[2];
      if (
        seenUrls.has(url) ||
        /\/(wp-admin|wp-content|wp-includes|feed|author|tag|category|privacy|contact|about|dmca)\b/i.test(url) ||
        url.replace(/\/$/, '') === 'https://yooyotvlive.com.ng'
      ) {
        continue;
      }
      seenUrls.add(url);
      const titleAttr = (linkMatch[0].match(/title=["']([^"']+)["']/i) || [])[1] || '';
      const textTitle = cleanHtmlText(titleAttr || inner);
      matchLinks.push({ url, title: textTitle });
    }

    if (matchLinks.length) {
      await Promise.allSettled(
        matchLinks.map(async (item) => {
          const res = await fetchRemoteBuffer(item.url, {
            timeoutMs: 4500,
            headers: {
              Referer: 'https://yooyotvlive.com.ng/',
              Cookie: getYooyoCookieHeader()
            }
          });
          const body = res.body || '';
          const pageTitle =
            item.title && item.title.length > 4
              ? item.title
              : cleanHtmlText(((body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]) || '');

          const pageIdRegex = /m3u8-player\.php\?id=([a-zA-Z0-9_-]+)/gi;
          let m;
          let idx = 0;
          while ((m = pageIdRegex.exec(body)) !== null) {
            idx++;
            const albaId = m[1];
            const label = pageTitle
              ? idx > 1
                ? `YooyoTV: ${pageTitle} (${albaId.toUpperCase()})`
                : `YooyoTV: ${pageTitle}`
              : `YooyoTV Live Feed (${albaId.toUpperCase()})`;
            addDiscoveredChannel(albaId, {
              title: label,
              competition: 'YooyoTV Match Page · Live Football',
              pageUrl: item.url
            });
          }
        })
      );
    }
  } catch (_) {}

  const channels = DEFAULT_LIVE_CHANNELS.map((ch) => ({ ...ch }));
  discovered.forEach((d) => {
    const existing = channels.find((c) => c.albaId === d.albaId);
    if (existing) {
      if (d.title && d.title.startsWith('YooyoTV:') && !existing.title.startsWith('YooyoTV:')) {
        existing.title = d.title;
      }
      if (d.pageUrl && d.pageUrl !== 'https://yooyotvlive.com.ng/') {
        existing.pageUrl = d.pageUrl;
      }
    } else {
      channels.splice(1, 0, d);
    }
  });

  const yooyoToResolve = channels.filter((c) => c.albaId).slice(0, 6);
  const [, directFeedsResult] = await Promise.allSettled([
    Promise.allSettled(
      yooyoToResolve.map(async (ch) => {
        const resolved = await resolveAlbaPlayerChannel(ch.albaId, {
          forceRefresh,
          matchUrl: ch.pageUrl
        });
        if (resolved && resolved.m3u8Url) {
          ch.m3u8Url = resolved.m3u8Url;
          ch.proxyM3u8Url = resolved.proxyM3u8Url;
        }
      })
    ),
    discoverDirectSportsFeeds(forceRefresh)
  ]);

  if (directFeedsResult.status === 'fulfilled' && Array.isArray(directFeedsResult.value)) {
    const existingIds = new Set(channels.map((c) => c.id));
    const existingUrls = new Set(channels.map((c) => c.m3u8Url).filter(Boolean));
    directFeedsResult.value.forEach((df) => {
      if (!existingIds.has(df.id) && (!df.m3u8Url || !existingUrls.has(df.m3u8Url))) {
        existingIds.add(df.id);
        if (df.m3u8Url) existingUrls.add(df.m3u8Url);
        channels.push(df);
      }
    });
  }

  const payload = {
    result: true,
    updatedAt: new Date().toISOString(),
    source: 'Direct Sports (iptv-org + Streamed.su) + Kora Plus + YooyoTV',
    channels
  };

  apiCache.set(cacheKey, { timestamp: Date.now(), data: payload });
  return payload;
}

/**
 * Rewrites all segment URLs AND tag attributes (URI="...") in an HLS .m3u8 playlist to route through /api/live/proxy.
 */
function rewriteHlsPlaylist(body, targetUrl, albaId = '') {
  const baseObj = new URL(targetUrl);
  const albaSuffix = albaId ? `&albaId=${encodeURIComponent(albaId)}` : '';
  const toProxyUrl = (rawRef) => {
    try {
      const abs = new URL(rawRef.trim(), baseObj).toString();
      return `/api/live/proxy?url=${encodeURIComponent(abs)}${albaSuffix}`;
    } catch (_) {
      return rawRef;
    }
  };

  return String(body || '')
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        // Rewrite URI="..." inside #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA, #EXT-X-I-FRAME-STREAM-INF
        if (trimmed.includes('URI="')) {
          return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${toProxyUrl(uri)}"`);
        }
        return line;
      }
      return toProxyUrl(trimmed);
    })
    .join('\n');
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

  // 1. Live TV & Sports API: /api/live/channels
  if (pathname === '/api/live/channels') {
    const forceRefresh = parsedUrl.searchParams.get('refresh') === '1';
    let data;
    try {
      data = await discoverYooyoLiveChannels(forceRefresh);
    } catch (err) {
      data = { result: true, updatedAt: new Date().toISOString(), channels: DEFAULT_LIVE_CHANNELS };
    }
    const checked = await liveHealth.annotate(data.channels || []);
    const isProtected = (ch) =>
      Boolean(
        ch.alwaysOnline ||
          ch.id === 'kora-plus-main' ||
          ch.albaId ||
          ch.sourceSite === 'yooyotvlive.com.ng' ||
          String(ch.id || '').startsWith('yooyo-')
      );
    const online = checked.filter((ch) => ch.online || isProtected(ch));
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

  // 2. Live Channel Resolver: /api/live/resolve?id=test-1[&refresh=1]
  if (pathname === '/api/live/resolve') {
    const albaId = parsedUrl.searchParams.get('id') || 'test-1';
    const forceRefresh = parsedUrl.searchParams.get('refresh') === '1';
    const matchUrl = parsedUrl.searchParams.get('matchUrl') || '';
    try {
      const resolved = await resolveAlbaPlayerChannel(albaId, { forceRefresh, matchUrl });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ result: true, ...resolved }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ result: false, error: err.message }));
    }
    return;
  }

  // 2b. Same-Origin YooyoTV AlbaPlayer Embed Proxy: /api/live/embed?id=test-1
  if (pathname === '/api/live/embed') {
    const cleanId = String(parsedUrl.searchParams.get('id') || 'test-1').replace(/[^a-zA-Z0-9_-]/g, '');
    const targetEmbed = `https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?id=${encodeURIComponent(cleanId)}`;
    try {
      const cookieHeader = getYooyoCookieHeader(cleanId);
      const upstream = await fetchRemoteBuffer(targetEmbed, {
        timeoutMs: 8000,
        headers: {
          Referer: 'https://yooyotvlive.com.ng/',
          Origin: 'https://yooyotvlive.com.ng',
          ...(cookieHeader ? { Cookie: cookieHeader } : {})
        }
      });
      storeSetCookies(upstream.headers['set-cookie'], cleanId);
      const m3u8Url = extractM3u8FromText(upstream.body, targetEmbed);
      if (m3u8Url) {
        const prev = yooyoSessions.get(cleanId) || {};
        yooyoSessions.set(cleanId, { ...prev, m3u8Url, refererUrl: targetEmbed, updatedAt: Date.now() });
      }

      let html = upstream.body || '';
      const baseTag = '<base href="https://yooyotvlive.com.ng/albaplayer-package/" />';
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${baseTag}`);
      } else {
        html = `${baseTag}\n${html}`;
      }
      html = html.replace(
        /(?:https?:\/\/yooyotvlive\.com\.ng\/albaplayer-package\/)?m3u8-player\.php\?status=1/gi,
        `/api/live/embed-status?id=${encodeURIComponent(cleanId)}&status=1`
      );

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(html);
    } catch (err) {
      res.writeHead(302, { Location: targetEmbed });
      res.end();
    }
    return;
  }

  // 2c. AlbaPlayer ?status=1 Session Proxy for /api/live/embed
  if (pathname === '/api/live/embed-status') {
    const cleanId = String(parsedUrl.searchParams.get('id') || 'test-1').replace(/[^a-zA-Z0-9_-]/g, '');
    const embedUrl = `https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?id=${encodeURIComponent(cleanId)}`;
    const statusUrl = `https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?status=1&_=${Date.now()}`;
    try {
      let cookieHeader = getYooyoCookieHeader(cleanId);
      if (!cookieHeader) {
        await resolveAlbaPlayerChannel(cleanId, { forceRefresh: true });
        cookieHeader = getYooyoCookieHeader(cleanId);
      }
      const statusRes = await fetchRemoteBuffer(statusUrl, {
        timeoutMs: 6000,
        headers: {
          Referer: embedUrl,
          Origin: 'https://yooyotvlive.com.ng',
          'X-Requested-With': 'XMLHttpRequest',
          ...(cookieHeader ? { Cookie: cookieHeader } : {})
        }
      });
      storeSetCookies(statusRes.headers['set-cookie'], cleanId);
      res.writeHead(200, {
        'Content-Type': statusRes.headers['content-type'] || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(statusRes.body);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 3. HLS (.m3u8 / .ts / .m4s / key) CORS, Cookie & Referer Proxy: /api/live/proxy?url=<encodedUrl>[&albaId=<id>]
  if (pathname === '/api/live/proxy') {
    const target = parsedUrl.searchParams.get('url');
    const albaId = parsedUrl.searchParams.get('albaId') || '';
    if (!target || !/^https?:\/\//i.test(target)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Valid http/https URL required' }));
      return;
    }

    try {
      const isYooyoStream = Boolean(albaId || target.includes('yooyotvlive.com.ng') || target.includes('aarray.cn'));
      const targetOrigin = new URL(target).origin;
      const session = albaId ? yooyoSessions.get(albaId) : null;
      const cookieHeader = getYooyoCookieHeader(albaId);

      const reqHeaders = isYooyoStream
        ? {
            Referer: (session && session.refererUrl) || 'https://yooyotvlive.com.ng/',
            Origin: 'https://yooyotvlive.com.ng'
          }
        : {
            Referer: `${targetOrigin}/`,
            Origin: targetOrigin
          };

      if (cookieHeader && target.includes('yooyotvlive.com.ng')) {
        reqHeaders.Cookie = cookieHeader;
      }
      if (req.headers.range) {
        reqHeaders.Range = req.headers.range;
      }

      let upstream = await fetchRemoteBuffer(target, {
        timeoutMs: 9500,
        headers: reqHeaders
      });

      if (!isYooyoStream && (upstream.statusCode === 403 || upstream.statusCode === 401)) {
        const cleanHeaders = req.headers.range ? { Range: req.headers.range } : {};
        upstream = await fetchRemoteBuffer(target, {
          timeoutMs: 9500,
          headers: cleanHeaders
        });
      }

      const contentType = upstream.headers['content-type'] || 'application/vnd.apple.mpegurl';
      const isM3u8 =
        /\.m3u8(\?|$)/i.test(target) ||
        contentType.toLowerCase().includes('mpegurl') ||
        upstream.body.trimStart().startsWith('#EXTM3U');

      if (isM3u8) {
        const rewritten = rewriteHlsPlaylist(upstream.body, target, albaId);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(rewritten);
      } else {
        const outHeaders = {
          'Content-Type': contentType,
          'Cache-Control': 'max-age=60'
        };
        if (upstream.headers['content-range']) outHeaders['Content-Range'] = upstream.headers['content-range'];
        if (upstream.headers['accept-ranges']) outHeaders['Accept-Ranges'] = upstream.headers['accept-ranges'];
        res.writeHead(upstream.statusCode || 200, outHeaders);
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
