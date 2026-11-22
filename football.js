/**
 * Football: live scores + official match highlights.
 *
 *   GET /api/football/scores?date=YYYYMMDD   → matches for the major leagues on that day
 *   GET /api/football/highlights             → latest official highlight videos
 *
 * Scores come from ESPN's public scoreboard JSON (no key). Highlights come from the
 * official YouTube RSS feeds of leagues and rights-holding broadcasters; only videos
 * that YouTube allows to be embedded on other sites are returned.
 */
'use strict';

const https = require('https');

const LEAGUES = [
  { id: 'eng.1', name: 'Premier League', short: 'EPL' },
  { id: 'esp.1', name: 'LaLiga', short: 'LaLiga' },
  { id: 'uefa.champions', name: 'Champions League', short: 'UCL' },
  { id: 'ita.1', name: 'Serie A', short: 'Serie A' },
  { id: 'ger.1', name: 'Bundesliga', short: 'Bundesliga' },
  { id: 'fra.1', name: 'Ligue 1', short: 'Ligue 1' },
  { id: 'uefa.europa', name: 'Europa League', short: 'UEL' }
];

// Official league / rights-holder channels (channel ids verified against their RSS feeds)
const HIGHLIGHT_CHANNELS = [
  { id: 'UC4i_9WvfPRTuRWEaWyfKuFw', name: 'TNT Sports Football', league: 'Premier League' },
  { id: 'UCTv-XvfzLX3i4IGWAm4sbmA', name: 'LALIGA EA SPORTS', league: 'LaLiga' },
  { id: 'UCET00YnetHT7tOpu12v8jxg', name: 'CBS Sports Golazo', league: '' },
  { id: 'UCBJeMCIeLQos7wacox4hmLQ', name: 'Serie A', league: 'Serie A' },
  { id: 'UC6c1z7bA__85CIWZ_jpCK-Q', name: 'ESPN FC', league: '' }
];

const LEAGUE_PATTERNS = [
  ['Champions League', /champions league|\bucl\b/i],
  ['Europa League', /europa league|\buel\b/i],
  ['Premier League', /premier league/i],
  ['LaLiga', /laliga|la liga/i],
  ['Serie A', /serie a/i],
  ['Bundesliga', /bundesliga/i],
  ['Ligue 1', /ligue 1/i],
  ['MLS', /\bmls\b/i]
];

const cache = new Map(); // key -> { at, ttl, data }
const embeddable = new Map(); // videoId -> boolean

function get(url, { timeoutMs = 9000, maxBytes = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'SparkFlix/1.0 (school project)', Accept: '*/*' }, timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return get(new URL(res.headers.location, url).toString(), { timeoutMs, maxBytes }).then(resolve, reject);
      }
      let size = 0;
      const chunks = [];
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) req.destroy(new Error('Response too large'));
        else chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data;
  const data = await fn();
  cache.set(key, { at: Date.now(), ttl: typeof ttlMs === 'function' ? ttlMs(data) : ttlMs, data });
  return data;
}

// ---------- Scores ----------
function normalizeEvent(ev, league) {
  const comp = (ev.competitions || [])[0] || {};
  const status = (ev.status && ev.status.type) || {};
  const team = (side) => {
    const c = (comp.competitors || []).find((x) => x.homeAway === side) || {};
    const t = c.team || {};
    return {
      name: t.shortDisplayName || t.displayName || t.name || 'TBC',
      fullName: t.displayName || t.name || '',
      abbr: t.abbreviation || '',
      logo: t.logo || '',
      score: c.score != null && c.score !== '' ? String(c.score) : '',
      winner: !!c.winner
    };
  };
  return {
    id: String(ev.id),
    league: league.name,
    leagueId: league.id,
    kickoff: ev.date,
    state: status.state || 'pre', // 'pre' | 'in' | 'post'
    detail: status.shortDetail || status.detail || '',
    clock: (ev.status && ev.status.displayClock) || '',
    completed: !!status.completed,
    home: team('home'),
    away: team('away'),
    venue: (comp.venue && comp.venue.fullName) || ''
  };
}

async function fetchLeague(league, date) {
  try {
    const { status, body } = await get(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league.id}/scoreboard?dates=${date}`);
    if (status !== 200) return { ...league, logo: '', matches: [] };
    const j = JSON.parse(body);
    const meta = (j.leagues || [])[0] || {};
    const logo = (meta.logos && meta.logos[0] && meta.logos[0].href) || '';
    return { ...league, logo, matches: (j.events || []).map((ev) => normalizeEvent(ev, league)) };
  } catch (_) {
    return { ...league, logo: '', matches: [], error: true };
  }
}

function getScores(date) {
  return cached(
    `scores:${date}`,
    // Refresh quickly while anything is live, slowly otherwise
    (data) => (data.leagues.some((l) => l.matches.some((m) => m.state === 'in')) ? 25 * 1000 : 5 * 60 * 1000),
    async () => {
      const leagues = await Promise.all(LEAGUES.map((l) => fetchLeague(l, date)));
      return { date, updatedAt: new Date().toISOString(), leagues: leagues.filter((l) => l.matches.length || l.error) };
    }
  );
}

// ---------- Highlights ----------
function decodeXml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function parseFeed(xml, channel) {
  return xml
    .split('<entry>')
    .slice(1)
    .map((e) => {
      const pick = (re) => ((e.match(re) || [])[1] || '').trim();
      const title = decodeXml(pick(/<title>([\s\S]*?)<\/title>/));
      const league = (LEAGUE_PATTERNS.find(([, re]) => re.test(title)) || [channel.league])[0] || '';
      return {
        videoId: pick(/<yt:videoId>([^<]+)<\/yt:videoId>/),
        title,
        published: pick(/<published>([^<]+)<\/published>/),
        isShort: /\/shorts\//.test(e),
        channel: channel.name,
        league
      };
    })
    .filter(
      (v) =>
        v.videoId &&
        !v.isShort &&
        /highlight|resumen|résumé|extended/i.test(v.title) &&
        !/college|nfl|\blive\b|🔴/i.test(v.title)
    );
}

async function isEmbeddable(videoId) {
  if (embeddable.has(videoId)) return embeddable.get(videoId);
  let ok = false;
  try {
    // oEmbed answers 401/403 when the owner has disabled playback on other websites
    const { status } = await get(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${videoId}`, { timeoutMs: 6000 });
    ok = status === 200;
  } catch (_) {}
  embeddable.set(videoId, ok);
  return ok;
}

function getHighlights() {
  return cached('highlights', 20 * 60 * 1000, async () => {
    const feeds = await Promise.all(
      HIGHLIGHT_CHANNELS.map(async (ch) => {
        try {
          const { status, body } = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`);
          return status === 200 ? parseFeed(body, ch) : [];
        } catch (_) {
          return [];
        }
      })
    );
    const all = feeds
      .flat()
      .sort((a, b) => new Date(b.published) - new Date(a.published))
      .slice(0, 36);
    const checks = await Promise.all(all.map((v) => isEmbeddable(v.videoId)));
    const videos = all
      .filter((_, i) => checks[i])
      .slice(0, 24)
      .map(({ isShort, ...v }) => ({ ...v, thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg` }));
    return { updatedAt: new Date().toISOString(), videos };
  });
}

// ---------- Route handler ----------
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function validDate(s) {
  if (!/^\d{8}$/.test(s)) return false;
  const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T12:00:00Z`);
  return !isNaN(d) && Math.abs(Date.now() - d) < 15 * 86400000;
}

/** Returns true when the request was a football API request. */
function handleFootballRequest(req, res, pathname, query) {
  if (pathname === '/api/football/scores') {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const date = query.get('date') || today;
    if (!validDate(date)) {
      sendJson(res, 400, { error: 'date must be YYYYMMDD within two weeks of today' });
      return true;
    }
    getScores(date).then(
      (d) => sendJson(res, 200, d),
      () => sendJson(res, 502, { error: 'Scores unavailable', leagues: [] })
    );
    return true;
  }
  if (pathname === '/api/football/highlights') {
    getHighlights().then(
      (d) => sendJson(res, 200, d),
      () => sendJson(res, 502, { error: 'Highlights unavailable', videos: [] })
    );
    return true;
  }
  return false;
}

module.exports = { handleFootballRequest, LEAGUES };
