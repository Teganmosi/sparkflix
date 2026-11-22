/**
 * SparkFlix — Netflix-style streaming PWA built on the VidSpark APIs.
 *
 *  01/02  Movie & TV embeds        /movie/$id, /tv/$id/$s/$e, /tv/$id-$s-$e
 *  03     Player parameters        ?t=, ?startAt=, ?theme=  (+ auto-resume)
 *  04     window.postMessage API   player telemetry + remote commands (Watch Party: party-client.js)
 *  05     Discovery API            /api/discover/movies | tv | views
 *
 * Metadata (synopsis, cast, runtime, rating, artwork, episode lists) comes from
 * Cinemeta through the local proxy at /api/meta/:type/:imdbId (see server.js).
 */
'use strict';

// ==================== STATIC DATA ====================

// Hand-picked billboard titles. Text here is only a fallback: on load each one is
// enriched with live artwork, logo, genres and synopsis from Cinemeta.
const SPOTLIGHT_HEROES = [
  {
    title: 'Matchbox',
    tmdbid: '1148365',
    imdb_id: 'tt28498219',
    year: 2026,
    quality: 'HD',
    type: 'movie',
    genres: ['Action'],
    synopsis: 'Based on the iconic die-cast toy cars first created in 1953.'
  },
  {
    title: 'The Odyssey',
    logoWhite: true, // its official logo is dark navy; render white for contrast
    tmdbid: '1368337',
    imdb_id: 'tt33764258',
    year: 2026,
    quality: 'HD',
    type: 'movie',
    genres: ['Action', 'Adventure', 'Drama'],
    synopsis:
      'After the Trojan War, Odysseus faces a dangerous voyage back to Ithaca, meeting creatures and gods along the way.'
  },
  {
    title: 'Stranger Things',
    tmdbid: '66732',
    imdb_id: 'tt4574334',
    year: 2016,
    quality: 'HD',
    type: 'tv',
    season: 5,
    episode: 3,
    genres: ['Drama', 'Fantasy', 'Horror'],
    synopsis:
      'In 1980s Indiana, a group of young friends witness supernatural forces and secret government exploits.'
  },
  {
    title: 'TRON: Ares',
    tmdbid: '533533',
    imdb_id: 'tt6604188',
    year: 2025,
    quality: 'HD',
    type: 'movie',
    genres: ['Action', 'Adventure', 'Sci-Fi'],
    synopsis:
      'A highly sophisticated program, Ares, is sent from the digital world into the real world on a dangerous mission.'
  },
  {
    title: 'House of the Dragon',
    tmdbid: '94997',
    imdb_id: 'tt11198330',
    year: 2022,
    quality: 'HD',
    type: 'tv',
    season: 2,
    episode: 1,
    genres: ['Action', 'Adventure', 'Drama'],
    synopsis:
      'The story of House Targaryen, set 200 years before the events of Game of Thrones.'
  }
];

// Used only when the Discovery API is unreachable (offline demo, school Wi-Fi, etc.)
const FALLBACK_CATALOG = {
  movie: [
    SPOTLIGHT_HEROES[0],
    SPOTLIGHT_HEROES[1],
    SPOTLIGHT_HEROES[3],
    { title: 'Dune: Part Two', tmdbid: '693134', imdb_id: 'tt15239678', year: 2024, quality: 'HD', type: 'movie' },
    { title: 'Deadpool & Wolverine', tmdbid: '533535', imdb_id: 'tt6263850', year: 2024, quality: 'HD', type: 'movie' },
    { title: 'Oppenheimer', tmdbid: '872585', imdb_id: 'tt15398776', year: 2023, quality: 'HD', type: 'movie' },
    { title: 'Spider-Man: Across the Spider-Verse', tmdbid: '569094', imdb_id: 'tt9362722', year: 2023, quality: 'HD', type: 'movie' },
    { title: 'The Batman', tmdbid: '414906', imdb_id: 'tt1877830', year: 2022, quality: 'HD', type: 'movie' }
  ],
  tv: [
    SPOTLIGHT_HEROES[2],
    SPOTLIGHT_HEROES[4],
    { title: 'Severance', tmdbid: '95396', imdb_id: 'tt11280740', year: 2022, quality: 'HD', type: 'tv' },
    { title: 'Arcane', tmdbid: '94605', imdb_id: 'tt11126994', year: 2021, quality: 'HD', type: 'tv' },
    { title: 'The Last of Us', tmdbid: '100088', imdb_id: 'tt3581920', year: 2023, quality: 'HD', type: 'tv' },
    { title: 'The Boys', tmdbid: '76479', imdb_id: 'tt1190634', year: 2019, quality: 'HD', type: 'tv' },
    { title: 'Breaking Bad', tmdbid: '1396', imdb_id: 'tt0903747', year: 2008, quality: 'HD', type: 'tv' },
    { title: 'Rick and Morty', tmdbid: '60625', imdb_id: 'tt2861424', year: 2013, quality: 'HD', type: 'tv' }
  ]
};

const PROFILES = [
  { id: 'p1', name: 'Me', color: '#E50914' },
  { id: 'p2', name: 'Family', color: '#3B82F6' },
  { id: 'p3', name: 'Friends', color: '#F59E0B' },
  { id: 'kids', name: 'Kids', color: '#16A085' }
];

// Client-side fallback Live Sports & TV channels (also enriched by /api/live/channels on server.js)
const FALLBACK_LIVE_CHANNELS = [
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

// Gradient pairs for the placeholder shown while a poster loads (or if it 404s)
const POSTER_PALETTES = [
  ['#3a1c71', '#d76d77'],
  ['#0f2027', '#2c5364'],
  ['#8E0E00', '#1F1C18'],
  ['#141E30', '#243B55'],
  ['#4b134f', '#c94b4b'],
  ['#000428', '#004e92'],
  ['#1f4037', '#99f2c8']
];

const ICON_PLUS =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

// ==================== STORAGE (namespaced per profile) ====================
const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      /* storage full or blocked (private mode) — app still works, just won't persist */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (_) {}
  }
};

const profileKey = (name) => `sparkflix:${state.profile ? state.profile.id : 'guest'}:${name}`;

// ==================== APPLICATION STATE ====================
const state = {
  currentView: 'home',
  profile: null,
  themeHex: storage.get('sparkflix:theme', 'E50914'),
  heroIndex: 0,
  heroTimer: null,
  myList: [],
  continueWatching: [],
  catalog: { movie: [], tv: [] }, // rail data, reused for "More Like This"
  discover: {
    endpoint: 'movies',
    page: 1,
    ordering: 'views',
    direction: 'desc',
    viewsPeriod: 'week',
    year: '',
    flag: '',
    query: '',
    requestId: 0
  },
  activeModal: {
    item: null,
    idMode: 'tmdb', // 'tmdb' | 'imdb'
    tvFormat: 'slash', // 'slash' | 'hyphen'
    season: 1,
    episode: 1,
    startAt: '',
    isPlaying: false,
    isMuted: false,
    currentTime: 0,
    duration: 0,
    lastSavedAt: 0,
    seasonsMap: {},
    returnFocus: null
  },
  live: {
    // Filled from /api/live/channels, which only returns channels that pass a server-side health check
    channels: null,
    ready: false,
    loading: null,
    customChannels: storage.get('sparkflix:live_custom', []),
    activeChannel: null,
    engine: 'hls', // 'hls' | 'proxy' | 'embed'
    category: 'all', // 'all' | 'sports' | 'news' | 'custom'
    hlsInstance: null,
    loaded: false
  },
  deferredPrompt: null
};

// ==================== HELPERS ====================
const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeItem(raw, defaultType = 'movie') {
  const type = String(raw.type || defaultType).toLowerCase() === 'tv' ? 'tv' : 'movie';
  const imdb_id = raw.imdb_id || raw.imdbid || '';
  const tmdbid = raw.tmdbid != null && raw.tmdbid !== '' ? String(raw.tmdbid) : '';
  // Note: `last_update` is when the catalog entry changed, NOT the release year — don't use it here
  const year = raw.year || '';
  return {
    ...raw,
    title: raw.title || raw.orig_title || 'Untitled',
    type,
    quality: raw.quality || raw.Quality || 'HD',
    tmdbid,
    imdb_id,
    year,
    uid: `${type}:${tmdbid || imdb_id}`,
    posterUrl: raw.posterUrl || raw.poster || (imdb_id ? `https://images.metahub.space/poster/medium/${imdb_id}/img` : ''),
    backdropUrl:
      raw.backdropUrl || raw.backdrop || (imdb_id ? `https://images.metahub.space/background/medium/${imdb_id}/img` : '')
  };
}

// Strip transient / bulky fields before persisting an item to localStorage
function toStoredItem(item) {
  const { title, type, quality, tmdbid, imdb_id, year, uid, posterUrl, backdropUrl } = item;
  return { title, type, quality, tmdbid, imdb_id, year, uid, posterUrl, backdropUrl };
}

function getPaletteForId(idStr = '') {
  let sum = 0;
  for (let i = 0; i < idStr.length; i++) sum += idStr.charCodeAt(i);
  return POSTER_PALETTES[sum % POSTER_PALETTES.length];
}

function formatSeconds(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${rem}s`;
  return `${rem}s`;
}

function isIdLike(value) {
  return /^(tt\d{5,}|\d{2,})$/i.test(String(value).trim());
}

function showToast(message) {
  const container = $('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, 2800);
}

// ==================== EMBED URL BUILDER (SECTIONS 01–03) ====================
function buildVidSparkEmbedUrl({
  type = 'movie',
  id,
  season = 1,
  episode = 1,
  tvFormat = 'slash',
  themeHex = state.themeHex,
  startAt = ''
}) {
  const cleanId = encodeURIComponent(String(id || '').trim());
  let baseUrl;

  if (type === 'tv' || type === 'tv-hyphen') {
    const s = Math.max(1, parseInt(season, 10) || 1);
    const e = Math.max(1, parseInt(episode, 10) || 1);
    baseUrl =
      tvFormat === 'hyphen' || type === 'tv-hyphen'
        ? `https://vidspark.to/tv/${cleanId}-${s}-${e}`
        : `https://vidspark.to/tv/${cleanId}/${s}/${e}`;
  } else {
    baseUrl = `https://vidspark.to/movie/${cleanId}`;
  }

  const params = new URLSearchParams();
  const cleanStart = String(startAt || '').trim();
  if (cleanStart) {
    // Plain seconds → ?t=90 ; compound durations (1h5m30s) → ?startAt=
    params.set(/^\d+$/.test(cleanStart) ? 't' : 'startAt', cleanStart);
  }
  const cleanTheme = String(themeHex || '').replace(/^#/, '').trim();
  if (/^[0-9a-f]{6}$/i.test(cleanTheme)) params.set('theme', cleanTheme);

  const qs = params.toString();
  return qs ? `${baseUrl}?${qs}` : baseUrl;
}

// ==================== DATA CLIENTS ====================

// Section 05: Discovery API. Tries the local proxy, then the API directly, then offline data.
async function fetchVidSparkDiscover(endpoint, paramsObj = {}) {
  const qs = new URLSearchParams();
  Object.entries(paramsObj).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  });
  const queryString = qs.toString() ? `?${qs}` : '';

  for (const base of ['/api/discover/', 'https://vidspark.to/api/discover/']) {
    try {
      const res = await fetch(`${base}${endpoint}${queryString}`);
      if (res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.data)) return json;
      }
    } catch (_) {
      /* try next source */
    }
  }

  const list = endpoint === 'tv' ? FALLBACK_CATALOG.tv : FALLBACK_CATALOG.movie;
  return { result: true, data: list, current_page: 1, last_page: 1, total: list.length, offline: true };
}

// Cinemeta metadata, de-duplicated and cached for the session
const metaCache = new Map();
function fetchMeta(type, imdbId) {
  if (!imdbId || !/^tt\d+$/.test(imdbId)) return Promise.resolve(null);
  const key = `${type}:${imdbId}`;
  if (!metaCache.has(key)) {
    const p = fetch(`/api/meta/${type === 'tv' ? 'tv' : 'movie'}/${imdbId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d && d.meta) || null)
      .catch(() => null);
    metaCache.set(key, p);
  }
  return metaCache.get(key);
}

// ==================== CARDS & RAILS ====================
function createMediaCard(rawItem, options = {}) {
  const item = normalizeItem(rawItem, options.defaultType);
  const [c1, c2] = getPaletteForId(item.tmdbid || item.imdb_id || item.title);
  const card = document.createElement('article');
  card.className = `media-card${options.isContinue ? ' continue-card' : ''}`;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${item.title}${item.year ? ` (${item.year})` : ''}`);

  const typeLabel = item.type === 'tv' ? 'Series' : 'Movie';
  let sub = [item.year, typeLabel].filter(Boolean).join(' · ');
  if (options.isContinue) {
    const left = item.duration ? item.duration - item.savedTime : 0;
    const where = item.type === 'tv' ? `S${item.season}:E${item.episode} · ` : '';
    sub = `${where}${left > 0 ? `${formatSeconds(left)} left` : `at ${formatSeconds(item.savedTime)}`}`;
  }
  const showQuality = item.quality && item.quality.toUpperCase() !== 'HD';

  card.innerHTML = `
    <div class="poster-wrap">
      <div class="poster-fallback" style="--fallback-c1:${c1}; --fallback-c2:${c2}">
        <div class="poster-fallback-title">${escapeHtml(item.title)}</div>
      </div>
      ${
        item.posterUrl
          ? `<img class="poster-img" src="${escapeHtml(item.posterUrl)}" alt="" loading="lazy" decoding="async" />`
          : ''
      }
      ${showQuality ? `<span class="card-pill-quality">${escapeHtml(item.quality)}</span>` : ''}
      <div class="card-play-overlay" aria-hidden="true">
        <div class="play-circle-icon">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 4l15 8-15 8z" /></svg>
        </div>
      </div>
    </div>
    ${
      options.isContinue
        ? `<div class="continue-progress-track"><div class="continue-progress-fill" style="width:${Math.min(
            98,
            Math.max(3, Number(item.percentage) || 0)
          )}%"></div></div>`
        : ''
    }
    <div class="card-info">
      <div class="card-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
      <div class="card-sub">${
        options.matchPct ? `<span class="card-match">${Number(options.matchPct)}% match</span> · ` : ''
      }${escapeHtml(options.matchPct ? item.year || typeLabel : sub)}</div>
    </div>
  `;

  const img = card.querySelector('.poster-img');
  if (img) {
    img.addEventListener('load', () => card.classList.add('has-poster'));
    img.addEventListener('error', () => img.remove());
  }

  const open = () => {
    if (options.isContinue) {
      openTitle(item, {
        autoplay: true,
        season: item.season,
        episode: item.episode,
        startAt: item.savedTime ? String(Math.floor(item.savedTime)) : ''
      });
    } else {
      openTitle(item);
    }
  };
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });
  return card;
}

function renderSkeletons(container, count = 8) {
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    s.className = 'media-card skeleton-card';
    s.setAttribute('aria-hidden', 'true');
    container.appendChild(s);
  }
}

function renderRailError(container, retry) {
  container.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'rail-error';
  box.innerHTML = `<span>Couldn't load this row.</span>`;
  const btn = document.createElement('button');
  btn.className = 'btn-secondary-sm';
  btn.textContent = 'Retry';
  btn.addEventListener('click', retry);
  box.appendChild(btn);
  container.appendChild(box);
}

// Adds Netflix-style ‹ › paging buttons around a horizontal scroller (desktop only via CSS)
function enhanceRailScroller(scroller) {
  if (scroller.dataset.enhanced) return;
  scroller.dataset.enhanced = '1';
  const track = document.createElement('div');
  track.className = 'rail-track';
  scroller.parentNode.insertBefore(track, scroller);
  track.appendChild(scroller);

  const mk = (dir) => {
    const b = document.createElement('button');
    b.className = `rail-arrow rail-arrow-${dir}`;
    b.setAttribute('aria-label', dir === 'left' ? 'Scroll left' : 'Scroll right');
    b.innerHTML = dir === 'left' ? '&#8249;' : '&#8250;';
    b.addEventListener('click', () => {
      scroller.scrollBy({ left: (dir === 'left' ? -1 : 1) * scroller.clientWidth * 0.85, behavior: 'smooth' });
    });
    track.appendChild(b);
    return b;
  };
  const left = mk('left');
  const right = mk('right');
  const update = () => {
    left.hidden = scroller.scrollLeft < 8;
    right.hidden = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 8;
  };
  scroller.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(scroller);
  scroller._updateArrows = update;
}

function fillScroller(scroller, items, defaultType) {
  scroller.innerHTML = '';
  items.forEach((item) => scroller.appendChild(createMediaCard(item, { defaultType })));
  scroller.scrollLeft = 0;
  if (scroller._updateArrows) requestAnimationFrame(scroller._updateArrows);
}

function renderContinueWatchingRail() {
  const scroller = $('scroller-continue');
  const rail = $('rail-continue');
  scroller.innerHTML = '';
  rail.hidden = state.continueWatching.length === 0;
  state.continueWatching.forEach((item) => {
    scroller.appendChild(createMediaCard(item, { isContinue: true }));
  });
  if (scroller._updateArrows) requestAnimationFrame(scroller._updateArrows);
}

function rememberCatalog(type, items) {
  const seen = new Set(state.catalog[type].map((x) => x.uid));
  items.forEach((raw) => {
    const item = normalizeItem(raw, type);
    if (!seen.has(item.uid)) {
      seen.add(item.uid);
      state.catalog[type].push(item);
    }
  });
}

const HOME_RAILS = [
  {
    scroller: 'scroller-trending',
    endpoint: 'views',
    params: { type: 'movie', views: 'week', page: 1, resultsPerPage: 10 },
    type: 'movie',
    ranked: true
  },
  {
    scroller: 'scroller-movies',
    endpoint: 'movies',
    params: { page: 1, resultsPerPage: 20, ordering: 'views', direction: 'desc', slider: 1 },
    type: 'movie'
  },
  {
    scroller: 'scroller-tv',
    endpoint: 'tv',
    params: { page: 1, resultsPerPage: 20, ordering: 'views', direction: 'desc' },
    type: 'tv'
  },
  {
    scroller: 'scroller-2026',
    endpoint: 'movies',
    params: { page: 1, resultsPerPage: 20, ordering: 'updated_at', direction: 'desc' },
    type: 'movie'
  }
];

async function loadRail(rail) {
  const scroller = $(rail.scroller);
  renderSkeletons(scroller, rail.ranked ? 6 : 8);
  try {
    const res = await fetchVidSparkDiscover(rail.endpoint, rail.params);
    const items = (res.data || []).slice(0, rail.params.resultsPerPage);
    if (!items.length) throw new Error('empty');
    rememberCatalog(rail.type, items);

    if (rail.ranked) {
      scroller.innerHTML = '';
      items.forEach((item, idx) => {
        const wrap = document.createElement('div');
        wrap.className = 'ranked-card-wrap';
        wrap.innerHTML = `<span class="rank-number" aria-hidden="true">${idx + 1}</span>`;
        wrap.appendChild(createMediaCard(item, { defaultType: rail.type }));
        scroller.appendChild(wrap);
      });
      if (scroller._updateArrows) requestAnimationFrame(scroller._updateArrows);
    } else {
      fillScroller(scroller, items, rail.type);
    }
  } catch (_) {
    renderRailError(scroller, () => loadRail(rail));
  }
}

function loadHomeRails() {
  renderContinueWatchingRail();
  loadLiveChannels();
  // Rails load in parallel; each one renders as soon as its own request resolves
  return Promise.all(HOME_RAILS.map(loadRail));
}

// ==================== HERO BILLBOARD ====================
async function enrichHero(hero) {
  if (hero._enriched) return hero;
  const meta = await fetchMeta(hero.type, hero.imdb_id);
  hero._enriched = true;
  if (meta) {
    if (meta.description) hero.synopsis = meta.description;
    if (Array.isArray(meta.genre || meta.genres) && (meta.genre || meta.genres).length) hero.genres = meta.genre || meta.genres;
    if (meta.background) hero.backdropUrl = meta.background;
    if (meta.logo) hero.logoUrl = meta.logo;
  }
  return hero;
}

function paintHero(hero) {
  const item = normalizeItem(hero);
  $('hero-backdrop').style.backgroundImage = item.backdropUrl ? `url("${item.backdropUrl}")` : '';
  $('hero-kind').textContent = item.type === 'tv' ? 'SERIES' : 'FILM';
  $('hero-quality').textContent = item.quality;
  $('hero-year').textContent = item.year || '';
  $('hero-title').textContent = item.title;
  $('hero-synopsis').textContent = hero.synopsis || '';
  $('hero-genres').innerHTML = (hero.genres || [])
    .slice(0, 3)
    .map((g, i) => `${i ? '<span class="dot-sep">&bull;</span>' : ''}<span>${escapeHtml(g)}</span>`)
    .join('');

  // Prefer the official title-treatment logo (like Netflix); fall back to the text title
  const logo = $('hero-logo');
  const title = $('hero-title');
  logo.classList.toggle('logo-white', !!hero.logoWhite);
  if (hero.logoUrl) {
    logo.onload = () => {
      logo.hidden = false;
      title.classList.add('sr-only');
    };
    logo.onerror = () => {
      logo.hidden = true;
      title.classList.remove('sr-only');
    };
    logo.alt = item.title;
    if (logo.getAttribute('src') !== hero.logoUrl) {
      logo.hidden = true;
      title.classList.remove('sr-only');
      logo.src = hero.logoUrl;
    }
  } else {
    logo.hidden = true;
    logo.removeAttribute('src');
    title.classList.remove('sr-only');
  }
}

function renderHeroSlide(index) {
  state.heroIndex = (index + SPOTLIGHT_HEROES.length) % SPOTLIGHT_HEROES.length;
  const hero = SPOTLIGHT_HEROES[state.heroIndex];
  paintHero(hero);

  enrichHero(hero).then(() => {
    if (SPOTLIGHT_HEROES[state.heroIndex] === hero) paintHero(hero);
  });
  // Warm up the next slide so the transition has artwork ready
  const next = SPOTLIGHT_HEROES[(state.heroIndex + 1) % SPOTLIGHT_HEROES.length];
  enrichHero(next).then((h) => {
    if (h.backdropUrl) new Image().src = h.backdropUrl;
  });

  const dotsEl = $('hero-dots');
  dotsEl.innerHTML = '';
  SPOTLIGHT_HEROES.forEach((h, idx) => {
    const dot = document.createElement('button');
    dot.className = `hero-dot${idx === state.heroIndex ? ' active' : ''}`;
    dot.setAttribute('aria-label', `Show ${h.title}`);
    dot.addEventListener('click', () => {
      renderHeroSlide(idx);
      resetHeroTimer();
    });
    dotsEl.appendChild(dot);
  });

  syncMyListButtons();
}

function resetHeroTimer() {
  clearInterval(state.heroTimer);
  state.heroTimer = setInterval(() => {
    // Don't rotate behind an open modal, on another view, or in a background tab
    if (document.hidden || state.currentView !== 'home' || !$('player-modal').hidden) return;
    renderHeroSlide(state.heroIndex + 1);
  }, 8000);
}

// ==================== DISCOVER / SEARCH ====================
const DISCOVER_HEADINGS = { movies: 'Movies', tv: 'TV Shows', views: 'New & Trending' };

// Discover uses infinite scroll: page 1 replaces the grid, later pages are appended
// when the user nears the bottom (IntersectionObserver) or taps "Load more".
async function loadDiscoverGrid({ append = false } = {}) {
  const d = state.discover;
  if (!append) {
    d.page = 1;
    // New tab / filter / search: start at the top so infinite scroll doesn't fire straight away
    // ('instant' because the page CSS sets scroll-behavior: smooth, and a slow scroll would
    //  leave the load-more sentinel on screen long enough to trigger page 2)
    if (state.currentView === 'discover' && window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'instant' });
  }
  const requestId = ++d.requestId;
  const grid = $('discover-grid');
  const countLabel = $('discover-count-label');
  const more = $('discover-more');
  d.loading = true;

  $('group-views-period').hidden = d.endpoint !== 'views';
  $('group-ordering').hidden = d.endpoint === 'views';
  $('group-direction').hidden = d.endpoint === 'views';
  $('group-year').hidden = d.endpoint === 'tv';
  $('discover-heading').textContent = d.query ? `Results for “${d.query}”` : DISCOVER_HEADINGS[d.endpoint];
  document.querySelectorAll('.discover-tab').forEach((t) => {
    const on = t.dataset.endpoint === d.endpoint;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  const params = { page: d.page, resultsPerPage: 24 };
  if (d.endpoint === 'views') {
    params.type = 'movie';
    params.views = d.viewsPeriod;
    if (d.year) params.year = d.year;
  } else {
    params.ordering = d.ordering;
    params.direction = d.direction;
    if (d.query && d.query.length >= 3) params.query = d.query;
    if (d.year && d.endpoint === 'movies') params.year = d.year;
    if (d.flag === 'slider') params.slider = 1;
    if (d.flag === 'featured') params.featured = 1;
  }

  $('discover-endpoint-display').textContent = `https://vidspark.to/api/discover/${d.endpoint}?${new URLSearchParams(
    params
  )}`;
  if (append) {
    more.classList.add('is-loading');
  } else {
    countLabel.textContent = 'Loading…';
    renderSkeletons(grid, 12);
    more.hidden = true;
  }

  const res = await fetchVidSparkDiscover(d.endpoint, params);
  if (requestId !== d.requestId) return; // a newer search/filter superseded this one
  d.loading = false;
  more.classList.remove('is-loading');

  const items = res.data || [];
  const total = Number(res.total || items.length);
  d.lastPage = res.offline ? 1 : res.last_page || 1;

  countLabel.textContent = res.offline
    ? 'Offline — showing saved picks'
    : d.query
    ? `${total.toLocaleString()} result${total === 1 ? '' : 's'}`
    : `${total.toLocaleString()} titles`;
  $('page-indicator').textContent = `Page ${d.page}`;
  $('prev-page-btn').disabled = d.page <= 1;
  $('next-page-btn').disabled = d.page >= d.lastPage;
  more.hidden = d.page >= d.lastPage || items.length === 0;

  if (!append) grid.innerHTML = '';
  if (!append && items.length === 0) {
    grid.innerHTML = d.query
      ? `<div class="empty-state"><strong>No results for “${escapeHtml(d.query)}”.</strong><br />Check the spelling, try another title, or paste a TMDB / IMDb ID and press Enter.</div>`
      : `<div class="empty-state">No titles match these filters.</div>`;
    return;
  }
  const defaultType = d.endpoint === 'tv' ? 'tv' : 'movie';
  rememberCatalog(defaultType, items);
  items.forEach((item) => grid.appendChild(createMediaCard(item, { defaultType })));
}

function loadMoreDiscover() {
  const d = state.discover;
  if (d.loading || state.currentView !== 'discover' || d.page >= (d.lastPage || 1)) return;
  d.page++;
  loadDiscoverGrid({ append: true });
}

// Direct lookup by TMDB ID (digits) or IMDb ID (tt…)
async function handleDirectIdLookup(rawId) {
  const input = String(rawId || '').trim();
  if (!input) return;
  if (!isIdLike(input)) {
    showToast('Enter a numeric TMDB ID (e.g. 1148365) or an IMDb ID (e.g. tt28498219)');
    return;
  }
  const isImdb = /^tt/i.test(input);
  showToast(`Looking up ${isImdb ? 'IMDb' : 'TMDB'} ID ${input}…`);

  const movieRes = await fetchVidSparkDiscover('movies', isImdb ? { imdb_id: input } : { tmdbid: input });
  if (!movieRes.offline && movieRes.data.length) return openTitle(normalizeItem(movieRes.data[0], 'movie'));

  const tvRes = await fetchVidSparkDiscover('tv', isImdb ? { imdbid: input } : { tmdbid: input });
  if (!tvRes.offline && tvRes.data.length) return openTitle(normalizeItem(tvRes.data[0], 'tv'));

  // Not in the catalog index — the embed player may still have it, so open it anyway
  let title = `Title ${input}`;
  if (isImdb) {
    const meta = await fetchMeta('movie', input);
    if (meta && meta.name) title = meta.name;
  }
  openTitle(
    { title, tmdbid: isImdb ? '' : input, imdb_id: isImdb ? input : '', type: 'movie' },
    { idMode: isImdb ? 'imdb' : 'tmdb' }
  );
}

// ==================== TITLE MODAL & PLAYER ====================
function setText(id, text) {
  const el = $(id);
  el.textContent = text || '';
  el.hidden = !text;
}

function openTitle(rawItem, opts = {}) {
  const item = normalizeItem(rawItem);
  const m = state.activeModal;
  const modal = $('player-modal');

  if (modal.hidden) m.returnFocus = document.activeElement;
  m.item = item;
  if (typeof Personal !== 'undefined' && !/^Custom embed/.test(item.title)) Personal.record(item, 'view');
  m.idMode = opts.idMode || (item.tmdbid ? 'tmdb' : 'imdb');
  m.tvFormat = opts.tvFormat || 'slash';
  m.season = Number(opts.season || item.season || 1);
  m.episode = Number(opts.episode || item.episode || 1);
  m.startAt = opts.startAt || '';
  m.seasonsMap = {};
  m.currentTime = 0;
  m.duration = 0;

  // Details
  $('modal-title').textContent = item.title;
  setText('modal-year', item.year ? String(item.year) : '');
  setText('modal-runtime', '');
  setText('modal-rating', '');
  $('modal-quality').textContent = item.quality;
  $('modal-type').textContent = item.type === 'tv' ? 'Series' : 'Movie';
  $('modal-overview').textContent = item.synopsis || '';
  $('modal-genres-line').textContent = item.genres ? `Genres: ${item.genres.join(', ')}` : '';
  $('modal-cast-line').textContent = '';
  $('modal-tmdb-badge').textContent = `TMDB ${item.tmdbid || '—'}`;
  $('modal-imdb-badge').textContent = `IMDb ${item.imdb_id || '—'}`;
  $('modal-start-input').value = m.startAt;
  $('stage-preview-img').style.backgroundImage = item.backdropUrl ? `url("${item.backdropUrl}")` : '';

  const resume = state.continueWatching.find((x) => x.uid === item.uid);
  $('modal-play-label').textContent = resume && !opts.startAt ? `Resume ${formatSeconds(resume.savedTime)}` : 'Play';

  const isTv = item.type === 'tv';
  $('tv-url-format-field').hidden = !isTv;
  $('modal-episodes-section').hidden = !isTv;
  $('modal-episodes-list').innerHTML = '';
  $('modal-season-select').innerHTML = '';

  document.querySelectorAll('#id-mode-toggle .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.idMode === m.idMode);
    btn.disabled = btn.dataset.idMode === 'imdb' ? !item.imdb_id : !item.tmdbid;
  });
  document.querySelectorAll('#tv-format-toggle .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tvFormat === m.tvFormat);
  });

  syncMyListButtons();
  stopPlayback();
  updateEmbedUrlDisplay();

  modal.hidden = false;
  modal.scrollTop = 0;
  document.body.classList.add('modal-open');
  $('modal-close-x').focus({ preventScroll: true });

  if (opts.autoplay) startPlayback();

  if (item.imdb_id) enrichModalMetadata(item);
  else if (isTv) renderFallbackSeasons(5, 10);

  renderSimilarGrid(item);
}

function currentEmbedUrl() {
  const m = state.activeModal;
  const id = m.idMode === 'imdb' && m.item.imdb_id ? m.item.imdb_id : m.item.tmdbid || m.item.imdb_id;
  return buildVidSparkEmbedUrl({
    type: m.item.type,
    id,
    season: m.season,
    episode: m.episode,
    tvFormat: m.tvFormat,
    themeHex: state.themeHex,
    startAt: m.startAt
  });
}

function updateEmbedUrlDisplay() {
  if (state.activeModal.item) $('modal-embed-url-text').textContent = currentEmbedUrl();
}

function startPlayback() {
  const m = state.activeModal;
  if (!m.item) return;
  // Resume automatically if we have saved progress and no explicit start time
  if (!m.startAt) {
    const resume = state.continueWatching.find(
      (x) => x.uid === m.item.uid && (m.item.type !== 'tv' || (x.season === m.season && x.episode === m.episode))
    );
    if (resume && resume.savedTime > 10) m.startAt = String(Math.floor(resume.savedTime));
  }
  m.isPlaying = true;
  m.lastSavedAt = 0;
  if (typeof Personal !== 'undefined') Personal.record(m.item, 'play');
  $('main-player-iframe').src = currentEmbedUrl();
  updateEmbedUrlDisplay();
  $('player-modal').classList.add('is-playing');
  $('video-stage').scrollIntoView({ block: 'nearest' });
}

function stopPlayback() {
  state.activeModal.isPlaying = false;
  $('main-player-iframe').src = 'about:blank';
  $('player-modal').classList.remove('is-playing');
}

// Reload the iframe only if something is already playing; otherwise just update the URL preview
function applyPlayerOptions() {
  if (state.activeModal.isPlaying) startPlayback();
  else updateEmbedUrlDisplay();
}

async function enrichModalMetadata(item) {
  const meta = await fetchMeta(item.type, item.imdb_id);
  if (state.activeModal.item !== item) return; // user already opened something else

  if (!meta) {
    if (item.type === 'tv') renderFallbackSeasons(5, 10);
    return;
  }
  if (meta.name && /^Title /.test(item.title)) $('modal-title').textContent = meta.name;
  if (meta.description) $('modal-overview').textContent = meta.description;
  if (meta.runtime) setText('modal-runtime', meta.runtime);
  if (meta.imdbRating) setText('modal-rating', `★ ${meta.imdbRating}`);
  if (meta.background) $('stage-preview-img').style.backgroundImage = `url("${meta.background}")`;
  const genres = meta.genre || meta.genres;
  if (Array.isArray(genres) && genres.length) $('modal-genres-line').textContent = `Genres: ${genres.join(', ')}`;
  if (Array.isArray(meta.cast) && meta.cast.length) {
    $('modal-cast-line').textContent = `Starring: ${meta.cast.slice(0, 5).join(', ')}`;
  }

  if (item.type !== 'tv') return;
  const seasonsMap = {};
  (meta.videos || []).forEach((vid) => {
    const s = Number(vid.season);
    const e = Number(vid.episode || vid.number);
    if (!s || s <= 0 || !e) return;
    (seasonsMap[s] = seasonsMap[s] || []).push({
      season: s,
      episode: e,
      title: vid.name || vid.title || `Episode ${e}`,
      overview: vid.overview || vid.description || '',
      released: vid.released ? String(vid.released).slice(0, 10) : '',
      thumbnail: vid.thumbnail || ''
    });
  });
  Object.values(seasonsMap).forEach((eps) => eps.sort((a, b) => a.episode - b.episode));
  const seasonNums = Object.keys(seasonsMap).map(Number).sort((a, b) => a - b);
  if (!seasonNums.length) return renderFallbackSeasons(5, 10);

  state.activeModal.seasonsMap = seasonsMap;
  if (!seasonsMap[state.activeModal.season]) state.activeModal.season = seasonNums[0];
  renderSeasonSelect(seasonNums);
  renderModalEpisodesList(state.activeModal.season);
}

function renderSeasonSelect(seasonNums) {
  $('modal-season-select').innerHTML = seasonNums
    .map(
      (s) =>
        `<option value="${s}"${s === Number(state.activeModal.season) ? ' selected' : ''}>Season ${s}</option>`
    )
    .join('');
}

function renderFallbackSeasons(totalSeasons = 5, epsPerSeason = 10) {
  const seasonsMap = {};
  for (let s = 1; s <= totalSeasons; s++) {
    seasonsMap[s] = Array.from({ length: epsPerSeason }, (_, i) => ({
      season: s,
      episode: i + 1,
      title: `Episode ${i + 1}`,
      overview: '',
      released: ''
    }));
  }
  state.activeModal.seasonsMap = seasonsMap;
  renderSeasonSelect(Object.keys(seasonsMap).map(Number));
  renderModalEpisodesList(state.activeModal.season);
}

function renderModalEpisodesList(seasonNum) {
  const listEl = $('modal-episodes-list');
  const episodes = state.activeModal.seasonsMap[seasonNum] || [];
  listEl.innerHTML = '';

  episodes.forEach((ep) => {
    const btn = document.createElement('button');
    const isActive =
      Number(state.activeModal.season) === ep.season && Number(state.activeModal.episode) === ep.episode;
    btn.className = `episode-card${isActive ? ' active' : ''}`;
    btn.innerHTML = `
      <div class="ep-num">${ep.episode}</div>
      <div class="ep-meta">
        <div class="ep-title">${escapeHtml(ep.title)}</div>
        ${ep.overview ? `<div class="ep-overview">${escapeHtml(ep.overview)}</div>` : ''}
        <div class="ep-sub">S${ep.season}:E${ep.episode}${ep.released ? ` · ${escapeHtml(ep.released)}` : ''}</div>
      </div>
    `;
    btn.addEventListener('click', () => {
      state.activeModal.season = ep.season;
      state.activeModal.episode = ep.episode;
      state.activeModal.startAt = '';
      $('modal-start-input').value = '';
      startPlayback();
      renderModalEpisodesList(seasonNum);
    });
    listEl.appendChild(btn);
  });
}

function renderSimilarGrid(currentItem) {
  const grid = $('modal-similar-grid');
  grid.innerHTML = '';
  const pool = state.catalog[currentItem.type].length
    ? state.catalog[currentItem.type]
    : FALLBACK_CATALOG[currentItem.type].map((x) => normalizeItem(x, currentItem.type));
  // Shuffle a copy so "More Like This" isn't identical for every title
  const picks = pool
    .filter((x) => x.uid !== currentItem.uid)
    .map((x) => [Math.random(), x])
    .sort((a, b) => a[0] - b[0])
    .slice(0, 12)
    .map((pair) => pair[1]);
  picks.forEach((item) => grid.appendChild(createMediaCard(item, { defaultType: currentItem.type })));
}

function closePlayerModal() {
  const modal = $('player-modal');
  if (modal.hidden) return;
  stopPlayback();
  modal.hidden = true;
  document.body.classList.remove('modal-open');
  renderContinueWatchingRail();
  const back = state.activeModal.returnFocus;
  if (back && document.contains(back)) back.focus({ preventScroll: true });
}

// ==================== SECTION 04: postMessage API ====================
function sendPlayerCommand(iframeEl, payload) {
  if (!iframeEl || !iframeEl.contentWindow || iframeEl.src === 'about:blank') {
    showToast('Start playback first');
    return;
  }
  iframeEl.contentWindow.postMessage(payload, '*');
  appendPostMessageLog('cmd', `→ ${JSON.stringify(payload)}`);
}

function appendPostMessageLog(type, text) {
  const box = $('postmessage-log');
  if (!box) return;
  const div = document.createElement('div');
  div.className = `log-entry ${type}`;
  div.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  box.prepend(div);
  while (box.children.length > 60) box.lastElementChild.remove();
}

// Player telemetry, filtered exactly as the docs describe (e.data?.source === 'vidspark-player')
window.addEventListener('message', (e) => {
  if (e.data?.source !== 'vidspark-player') return;
  const { event, currentTime, duration, percentage } = e.data;
  const fromMain = e.source === $('main-player-iframe').contentWindow;


  // Only the main player feeds Continue Watching
  if (!fromMain || !state.activeModal.item) return;
  const m = state.activeModal;
  if (currentTime !== undefined) m.currentTime = Number(currentTime);
  if (duration !== undefined) m.duration = Number(duration);

  const now = Date.now();
  const important = event === 'pause' || event === 'ended' || event === 'seeked';
  if (event === 'ended') {
    removeContinueProgress(m.item.uid);
  } else if (m.currentTime > 5 && (important || now - m.lastSavedAt > 10000)) {
    m.lastSavedAt = now;
    saveContinueProgress(m.item, m.currentTime, m.duration, percentage);
  }
});

function saveContinueProgress(item, currentTime, duration, percentage) {
  const pct = Number(percentage) || (duration ? (currentTime / duration) * 100 : 0);
  if (pct >= 95) return removeContinueProgress(item.uid); // basically finished
  const entry = {
    ...toStoredItem(item),
    season: state.activeModal.season,
    episode: state.activeModal.episode,
    savedTime: Math.floor(currentTime),
    duration: Math.floor(duration || 0),
    percentage: Math.round(pct)
  };
  state.continueWatching = [entry, ...state.continueWatching.filter((x) => x.uid !== item.uid)].slice(0, 12);
  storage.set(profileKey('continue'), state.continueWatching);
}

function removeContinueProgress(uid) {
  state.continueWatching = state.continueWatching.filter((x) => x.uid !== uid);
  storage.set(profileKey('continue'), state.continueWatching);
}

// ==================== MY LIST ====================
function isInMyList(uid) {
  return state.myList.some((x) => x.uid === uid);
}

function toggleMyList(rawItem) {
  const item = normalizeItem(rawItem);
  if (isInMyList(item.uid)) {
    state.myList = state.myList.filter((x) => x.uid !== item.uid);
    showToast(`Removed “${item.title}” from My List`);
  } else {
    state.myList.unshift(toStoredItem(item));
    showToast(`Added “${item.title}” to My List`);
    if (typeof Personal !== 'undefined') Personal.record(item, 'list');
  }
  storage.set(profileKey('mylist'), state.myList);
  updateMyListCount();
  syncMyListButtons();
  if (state.currentView === 'mylist') renderMyListView();
}

function updateMyListCount() {
  $('nav-mylist-count').textContent = state.myList.length;
  $('nav-mylist-count').hidden = state.myList.length === 0;
}

function paintMyListButton(btn, inList) {
  btn.innerHTML = inList ? ICON_CHECK : ICON_PLUS;
  btn.classList.toggle('in-list', inList);
  const label = inList ? 'Remove from My List' : 'Add to My List';
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

function syncMyListButtons() {
  const hero = normalizeItem(SPOTLIGHT_HEROES[state.heroIndex]);
  paintMyListButton($('hero-mylist-btn'), isInMyList(hero.uid));
  if (state.activeModal.item) paintMyListButton($('modal-mylist-btn'), isInMyList(state.activeModal.item.uid));
}

function renderMyListView() {
  const grid = $('mylist-grid');
  grid.innerHTML = '';
  if (state.myList.length === 0) {
    grid.innerHTML = `
      <div class="empty-state empty-state-rich">
        <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
        <h2>Your list is empty</h2>
        <p>Tap <strong>+</strong> on any movie or show to save it here for later.</p>
        <button class="btn-hero-play" type="button" data-empty-browse>Browse movies</button>
      </div>`;
    grid.querySelector('[data-empty-browse]').addEventListener('click', () =>
      switchView('discover', { endpoint: 'movies', year: '', clearQuery: true })
    );
    return;
  }
  state.myList.forEach((item) => grid.appendChild(createMediaCard(item)));
}

// ==================== PROFILES ====================
function renderProfileGate() {
  const grid = $('profile-grid');
  grid.innerHTML = '';
  PROFILES.forEach((p) => {
    const btn = document.createElement('button');
    btn.className = 'profile-tile';
    btn.innerHTML = `<span class="profile-avatar" style="--avatar:${p.color}">${escapeHtml(p.name[0])}</span>
      <span class="profile-name">${escapeHtml(p.name)}</span>`;
    btn.addEventListener('click', () => selectProfile(p.id));
    grid.appendChild(btn);
  });
}

function showProfileGate() {
  renderProfileGate();
  $('profile-gate').hidden = false;
  document.body.classList.add('modal-open');
  const first = $('profile-grid').querySelector('button');
  if (first) first.focus();
}

function selectProfile(id) {
  const profile = PROFILES.find((p) => p.id === id) || PROFILES[0];
  state.profile = profile;
  storage.set('sparkflix:profile', profile.id);

  state.myList = storage.get(profileKey('mylist'), []);
  state.continueWatching = storage.get(profileKey('continue'), []);

  const avatar = $('profile-avatar');
  avatar.textContent = profile.name[0];
  avatar.style.setProperty('--avatar', profile.color);
  $('continue-profile-name').textContent = profile.name === 'Me' ? 'you' : profile.name;

  $('profile-gate').hidden = true;
  document.body.classList.remove('modal-open');
  updateMyListCount();
  syncMyListButtons();
  renderContinueWatchingRail();
  if (state.currentView === 'mylist') renderMyListView();
  if (typeof Personal !== 'undefined') Personal.refresh(); // each profile has its own taste
}

// ==================== THEME (?theme=HEX) ====================
function shadeHex(hex, amount) {
  const n = parseInt(hex, 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amount);
  const g = clamp(((n >> 8) & 0xff) + amount);
  const b = clamp((n & 0xff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function applyThemeHex(rawHex, { silent = false } = {}) {
  const hex = String(rawHex || 'E50914').replace(/^#/, '').trim();
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
    showToast('Enter a valid 6-digit hex colour, e.g. 16A085');
    return;
  }
  state.themeHex = hex.toUpperCase();
  storage.set('sparkflix:theme', state.themeHex);

  const root = document.documentElement.style;
  root.setProperty('--accent', `#${hex}`);
  root.setProperty('--accent-dark', shadeHex(hex, -70));
  root.setProperty('--accent-glow', `#${hex}55`);

  $('custom-hex-input').value = state.themeHex;
  document.querySelectorAll('.swatch-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.hex.toLowerCase() === hex.toLowerCase());
  });

  if (state.activeModal.item && !$('player-modal').hidden) applyPlayerOptions();
  if (!silent) showToast(`Theme set to #${state.themeHex} — the player uses ?theme=${state.themeHex}`);
}

// ==================== LIVE SPORTS & TV HUB (HLS .m3u8 + YOOYOTV ALBAPLAYER) ====================
function getAllLiveChannels() {
  const custom = (state.live.customChannels || []).map((c) => ({ ...c, isCustom: true }));
  return [...custom, ...(state.live.channels || [])];
}

// Shown over the live player when a stream can't be played (instead of a black screen)
function showLiveOffline(message) {
  const panel = $('live-offline');
  if (!panel) return;
  $('live-offline-msg').textContent = message || 'This channel is offline right now.';
  const others = getAllLiveChannels().filter((c) => !state.live.activeChannel || c.id !== state.live.activeChannel.id);
  $('live-offline-next').hidden = others.length === 0;
  panel.hidden = false;
}

function hideLiveOffline() {
  const panel = $('live-offline');
  if (panel) panel.hidden = true;
}

function playNextLiveChannel() {
  const all = getAllLiveChannels();
  if (!all.length) return;
  const i = state.live.activeChannel ? all.findIndex((c) => c.id === state.live.activeChannel.id) : -1;
  playLiveChannel(all[(i + 1) % all.length], { autoplay: true });
}

function getFilteredLiveChannels() {
  const all = getAllLiveChannels();
  const cat = state.live.category;
  if (cat === 'all') return all;
  if (cat === 'custom') return all.filter((c) => c.isCustom);
  if (cat === 'sports') return all.filter((c) => c.category === 'sports');
  return all.filter((c) => c.category !== 'sports');
}

function createLiveBroadcastCard(channel) {
  const card = document.createElement('article');
  const isActive = state.live.activeChannel && state.live.activeChannel.id === channel.id;
  card.className = `live-broadcast-card${isActive ? ' active' : ''}`;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `Watch ${channel.title} Live`);

  const engineTag = channel.m3u8Url ? 'HLS .m3u8' : 'AlbaPlayer';
  card.innerHTML = `
    <div class="live-card-thumb">
      <img src="${escapeHtml(
        channel.poster || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=900&q=80'
      )}" alt="" loading="lazy" decoding="async" />
      <div class="live-card-shade"></div>
      <div class="live-card-top-badges">
        <span class="live-badge-pill"><span class="live-pulse-dot"></span> ${escapeHtml(channel.badge || 'LIVE')}</span>
        <span class="live-quality-pill">${escapeHtml(channel.quality || 'HD')}</span>
      </div>
      <div class="live-card-play-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 4l15 8-15 8z" /></svg>
      </div>
      <span class="live-engine-chip">${escapeHtml(engineTag)}</span>
    </div>
    <div class="live-card-body">
      <div class="live-card-title" title="${escapeHtml(channel.title)}">${escapeHtml(channel.title)}</div>
      <div class="live-card-sub">${escapeHtml(channel.competition || channel.sourceSite || 'Live Stream')}</div>
    </div>
  `;

  const trigger = () => {
    if (state.currentView !== 'live') {
      switchView('live');
    }
    playLiveChannel(channel, { autoplay: true });
    const shell = $('live-video-shell');
    if (shell) shell.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  card.addEventListener('click', trigger);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      trigger();
    }
  });
  return card;
}

function renderLiveHomeRail() {
  const scroller = $('scroller-live');
  if (!scroller) return;
  scroller.innerHTML = '';
  const list = getAllLiveChannels();
  list.forEach((ch) => scroller.appendChild(createLiveBroadcastCard(ch)));
  if (scroller._updateArrows) requestAnimationFrame(scroller._updateArrows);
}

function renderLiveHubLists() {
  const guideEl = $('live-guide-list');
  const gridEl = $('live-cards-grid');
  const countEl = $('live-channel-count');
  if (!guideEl || !gridEl) return;

  const all = getAllLiveChannels();
  const filtered = getFilteredLiveChannels();
  if (countEl) countEl.textContent = `${all.length} channels`;

  guideEl.innerHTML = '';
  if (!state.live.ready) {
    guideEl.innerHTML = `<div class="live-guide-empty"><span class="discover-more-spinner live-inline-spinner"></span>Checking which channels are on air…</div>`;
    if (countEl) countEl.textContent = '';
  } else if (filtered.length === 0) {
    guideEl.innerHTML =
      state.live.category === 'custom' || state.live.category === 'saved'
        ? `<div class="live-guide-empty">No saved channels yet. Add your own stream link below the player.</div>`
        : `<div class="live-guide-empty">No channels in this category are on air right now. Check back soon.</div>`;
  } else {
    filtered.forEach((ch) => {
      const item = document.createElement('div');
      const isActive = state.live.activeChannel && state.live.activeChannel.id === ch.id;
      item.className = `live-guide-item${isActive ? ' active' : ''}`;
      item.innerHTML = `
        <div class="live-guide-item-main" role="button" tabindex="0">
          <span class="live-pulse-dot"></span>
          <div class="live-guide-text">
            <div class="live-guide-name">${escapeHtml(ch.title)}</div>
            <div class="live-guide-meta">${escapeHtml(ch.competition || ch.sourceSite || 'Live')} &bull; ${escapeHtml(
        ch.quality || 'HD'
      )}</div>
          </div>
          <span class="live-guide-tag">${ch.m3u8Url ? 'M3U8' : 'EMBED'}</span>
        </div>
        ${
          ch.isCustom
            ? `<button class="live-guide-del" title="Remove saved channel" aria-label="Remove">&times;</button>`
            : ''
        }
      `;
      item.querySelector('.live-guide-item-main').addEventListener('click', () => {
        playLiveChannel(ch, { autoplay: true });
      });
      const delBtn = item.querySelector('.live-guide-del');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeCustomLiveChannel(ch.id);
        });
      }
      guideEl.appendChild(item);
    });
  }

  gridEl.innerHTML = '';
  all.forEach((ch) => gridEl.appendChild(createLiveBroadcastCard(ch)));
}

function loadLiveChannels({ forceRefresh = false } = {}) {
  if (state.live.loading && !forceRefresh) return state.live.loading;
  renderLiveHubLists();

  state.live.loading = (async () => {
    let loaded = false;
    try {
      const res = await fetch(`/api/live/channels${forceRefresh ? '?refresh=1' : ''}`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.channels)) {
          // The server already removed channels that failed its health check
          state.live.channels = data.channels;
          loaded = true;
        }
      }
    } catch (_) {
      /* offline or server unreachable: fall back below */
    }
    if (!loaded && !state.live.channels) {
      // No server: offer only the official 24/7 broadcaster streams from the built-in list
      state.live.channels = FALLBACK_LIVE_CHANNELS.filter((ch) => ch.m3u8Url && !ch.albaId);
    }
    state.live.ready = true;
    state.live.loading = null;
    renderLiveHomeRail();
    renderLiveHubLists();
    if (forceRefresh) showToast(`${state.live.channels.length} channels on air`);
  })();
  return state.live.loading;
}

function stopLivePlayback() {
  if (state.live.hlsInstance) {
    try {
      state.live.hlsInstance.destroy();
    } catch (_) {}
    state.live.hlsInstance = null;
  }
  const video = $('live-hls-video');
  if (video) {
    video.onerror = null; // clearing the source can fire 'error'; don't let it trigger a retry
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  const iframe = $('live-embed-iframe');
  if (iframe) {
    iframe.src = 'about:blank';
  }
}

function syncLiveEngineButtons() {
  document.querySelectorAll('#live-engine-toggle .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.liveEngine === state.live.engine);
  });
}

async function playLiveChannel(channel, { engineOverride = null, autoplay = true } = {}) {
  if (!channel) return;
  state.live.activeChannel = channel;
  state.live.loaded = true;

  if (engineOverride) {
    state.live.engine = engineOverride;
  } else if (!channel.m3u8Url && channel.embedUrl && !channel.albaId) {
    state.live.engine = 'embed';
  } else if (state.live.engine === 'embed' && !channel.embedUrl && channel.m3u8Url) {
    state.live.engine = 'hls';
  }

  hideLiveOffline();
  $('live-playing-title').textContent = channel.title;
  $('live-playing-badge').textContent = channel.badge || 'LIVE';
  syncLiveEngineButtons();
  renderLiveHomeRail();
  renderLiveHubLists();

  stopLivePlayback();

  const video = $('live-hls-video');
  const iframe = $('live-embed-iframe');
  const qualityWrap = $('live-quality-wrap');
  const qualitySelect = $('live-quality-select');

  // If this is a YooyoTV AlbaPlayer channel without a resolved m3u8Url yet, ask /api/live/resolve
  if (channel.albaId && !channel.m3u8Url && state.live.engine !== 'embed') {
    $('live-active-source-display').textContent = `/api/live/resolve?id=${channel.albaId}`;
    try {
      const res = await fetch(`/api/live/resolve?id=${encodeURIComponent(channel.albaId)}`);
      if (res.ok) {
        const resolved = await res.json();
        if (resolved && resolved.m3u8Url) {
          channel.m3u8Url = resolved.m3u8Url;
        }
      }
    } catch (_) {
      /* fallback below */
    }
  }

  // Decide final playback mode
  let mode = state.live.engine;
  if ((mode === 'hls' || mode === 'proxy') && !channel.m3u8Url && channel.embedUrl) {
    mode = 'embed';
    state.live.engine = 'embed';
    syncLiveEngineButtons();
  }

  if (mode === 'embed') {
    const targetEmbed =
      channel.embedUrl ||
      (channel.albaId
        ? `https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?id=${encodeURIComponent(channel.albaId)}`
        : channel.m3u8Url);
    video.hidden = true;
    iframe.hidden = false;
    qualityWrap.hidden = true;
    iframe.src = targetEmbed;
    $('live-active-source-display').textContent = targetEmbed;
    return;
  }

  // HLS (.m3u8) playback (Direct or via Server Proxy)
  const rawM3u8 = channel.m3u8Url;
  const playUrl = mode === 'proxy' ? `/api/live/proxy?url=${encodeURIComponent(rawM3u8)}` : rawM3u8;
  $('live-active-source-display').textContent = playUrl;

  iframe.hidden = true;
  video.hidden = false;
  qualityWrap.hidden = false;
  qualitySelect.innerHTML = '<option value="-1">Auto (Adaptive)</option>';
  if (channel.poster) video.poster = channel.poster;

  if (window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls({
      enableWorker: true,
      lowLatencyMode: true
    });
    state.live.hlsInstance = hls;
    hls.loadSource(playUrl);
    hls.attachMedia(video);

    hls.on(window.Hls.Events.MANIFEST_PARSED, (_, data) => {
      const levels = data.levels || [];
      qualitySelect.innerHTML = '<option value="-1">Auto (Adaptive)</option>';
      levels.forEach((lvl, idx) => {
        const label = lvl.height ? `${lvl.height}p (${Math.round((lvl.bitrate || 0) / 1000)} kbps)` : `Level ${idx + 1}`;
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = label;
        qualitySelect.appendChild(opt);
      });
      if (autoplay) {
        video.play().catch(() => {});
      }
    });

    hls.on(window.Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      // Automatic fallback cascade: Direct HLS -> Server Proxy HLS -> YooyoTV AlbaPlayer Embed
      if (mode === 'hls') {
        showToast('Reconnecting through the SparkFlix server…');
        playLiveChannel(channel, { engineOverride: 'proxy', autoplay: true });
      } else if (channel.embedUrl || channel.albaId) {
        showToast('Trying this channel’s backup player…');
        playLiveChannel(channel, { engineOverride: 'embed', autoplay: true });
      } else {
        showLiveOffline(`${channel.title} is offline right now.`);
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS on iOS / macOS Safari
    video.onerror = () => {
      if (state.live.activeChannel !== channel) return;
      if (mode === 'hls') playLiveChannel(channel, { engineOverride: 'proxy', autoplay: true });
      else showLiveOffline(`${channel.title} is offline right now.`);
    };
    video.src = playUrl;
    if (autoplay) video.play().catch(() => {});
  } else if (channel.embedUrl) {
    playLiveChannel(channel, { engineOverride: 'embed', autoplay: true });
  }
}

function buildCustomChannelFromInput(rawInput, rawTitle = '') {
  const input = String(rawInput || '').trim();
  if (!input) return null;

  const isM3u8 = /\.m3u8(\?|$)/i.test(input);
  const isAlbaUrl = /m3u8-player\.php\?id=([a-zA-Z0-9_-]+)/i.test(input);
  const isShortId = /^[a-zA-Z0-9_-]{2,24}$/.test(input) && !/^https?:\/\//i.test(input);

  let albaId = '';
  let m3u8Url = '';
  let embedUrl = '';

  if (isM3u8) {
    m3u8Url = input;
  } else if (isAlbaUrl) {
    albaId = input.match(/m3u8-player\.php\?id=([a-zA-Z0-9_-]+)/i)[1];
    embedUrl = `https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?id=${encodeURIComponent(albaId)}`;
  } else if (isShortId) {
    albaId = input;
    embedUrl = `https://yooyotvlive.com.ng/albaplayer-package/m3u8-player.php?id=${encodeURIComponent(albaId)}`;
  } else {
    embedUrl = input;
  }

  const title =
    rawTitle.trim() ||
    (albaId
      ? `YooyoTV Feed (${albaId.toUpperCase()})`
      : isM3u8
      ? `Custom HLS Stream (${new URL(input, location.origin).hostname})`
      : 'Custom Live Stream');

  return {
    id: `custom-${Date.now()}`,
    albaId,
    title,
    category: 'sports',
    competition: albaId ? 'YooyoTV AlbaPlayer Channel' : 'Custom Live Feed',
    badge: 'CUSTOM LIVE',
    quality: 'HD',
    language: 'Live',
    m3u8Url,
    embedUrl,
    sourceSite: albaId ? 'yooyotvlive.com.ng' : 'Custom URL',
    poster: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=900&q=80',
    isCustom: true
  };
}

function saveCustomLiveChannel(channel) {
  state.live.customChannels = [channel, ...(state.live.customChannels || []).filter((x) => x.title !== channel.title)];
  storage.set('sparkflix:live_custom', state.live.customChannels);
  renderLiveHomeRail();
  renderLiveHubLists();
  showToast(`Saved “${channel.title}” to Live Channels`);
}

function removeCustomLiveChannel(id) {
  state.live.customChannels = (state.live.customChannels || []).filter((x) => x.id !== id);
  storage.set('sparkflix:live_custom', state.live.customChannels);
  renderLiveHomeRail();
  renderLiveHubLists();
  showToast('Removed custom channel');
}

// ==================== NAVIGATION ====================
const VIEWS = ['home', 'discover', 'live', 'party', 'mylist'];

function syncNavHighlight() {
  const ep = state.discover.endpoint;
  const filterFor = { movies: 'movie', tv: 'tv', views: 'views' };
  document.querySelectorAll('.desktop-nav [data-nav], .mobile-bottom-nav [data-nav]').forEach((btn) => {
    const sameView = btn.dataset.nav === state.currentView;
    const ft = btn.dataset.filterType;
    btn.classList.toggle('active', sameView && (!ft || ft === filterFor[ep]));
  });
  const pill =
    state.currentView === 'home'
      ? 'all'
      : state.currentView === 'live'
      ? 'live'
      : state.currentView === 'mylist'
      ? 'mylist'
      : state.currentView === 'discover'
      ? { movies: 'movies', tv: 'tv', views: 'trending' }[ep]
      : '';
  document.querySelectorAll('.cat-pill').forEach((p) => p.classList.toggle('active', p.dataset.pill === pill));
}

function switchView(viewName, options = {}) {
  if (!VIEWS.includes(viewName)) viewName = 'home';
  if (state.currentView === 'live' && viewName !== 'live') {
    stopLivePlayback();
  }
  state.currentView = viewName;
  document.querySelectorAll('.view-section').forEach((sec) => {
    sec.classList.toggle('active', sec.id === `view-${viewName}`);
  });
  document.body.dataset.view = viewName;

  if (viewName === 'discover') {
    if (options.endpoint) {
      state.discover.endpoint = options.endpoint;
      $('filter-endpoint').value = options.endpoint;
      state.discover.page = 1;
    }
    if (options.year !== undefined) {
      state.discover.year = options.year;
      $('filter-year').value = options.year;
    }
    if (options.clearQuery) {
      state.discover.query = '';
      $('global-search-input').value = '';
      $('search-clear-btn').hidden = true;
    }
    loadDiscoverGrid();
  } else if (viewName === 'live') {
    renderLiveHubLists();
    if (typeof Football !== 'undefined') Football.onEnterLive();
    // Wait for the health-checked channel list before autoplaying anything
    Promise.resolve(state.live.ready ? null : loadLiveChannels()).then(() => {
      if (state.currentView !== 'live') return;
      const initialChannel = state.live.activeChannel || getAllLiveChannels()[0];
      if (initialChannel) playLiveChannel(initialChannel, { autoplay: true });
      else showLiveOffline('No channels are on air right now. Check back soon.');
    });
  } else if (viewName === 'mylist') {
    renderMyListView();
  } else if (viewName === 'party' && typeof Party !== 'undefined') {
    Party.onEnterView();
  }

  syncNavHighlight();
  if (!options.fromHistory && location.hash !== `#${viewName}`) history.pushState({ view: viewName }, '', `#${viewName}`);
  window.scrollTo({ top: 0 });
}

function copyText(text, message) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(
      () => showToast(message),
      () => showToast('Copy failed — select the text manually')
    );
  } else {
    showToast('Clipboard needs HTTPS or localhost');
  }
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  applyThemeHex(state.themeHex, { silent: true });

  // Profile: restore last one, otherwise ask "Who's watching?"
  const savedProfile = storage.get('sparkflix:profile', null);
  if (savedProfile && PROFILES.some((p) => p.id === savedProfile)) selectProfile(savedProfile);
  else {
    selectProfile(PROFILES[0].id);
    showProfileGate();
  }
  $('profile-btn').addEventListener('click', showProfileGate);

  // Hero & rails
  renderHeroSlide(0);
  resetHeroTimer();
  document.querySelectorAll('.rail-scroller').forEach(enhanceRailScroller);
  loadHomeRails();

  // Header goes solid once you scroll past the billboard (or on any other page)
  const header = $('top-header');
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 30);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Navigation
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ft = btn.dataset.filterType;
      if (ft) switchView('discover', { endpoint: { movie: 'movies', tv: 'tv', views: 'views' }[ft], year: '', clearQuery: true });
      else switchView(btn.dataset.nav);
    });
  });
  $('brand-logo').addEventListener('click', (e) => {
    e.preventDefault();
    switchView('home');
  });
  document.querySelectorAll('.cat-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      const kind = pill.dataset.pill;
      if (kind === 'all') switchView('home');
      else if (kind === 'live') switchView('live');
      else if (kind === 'movies') switchView('discover', { endpoint: 'movies', year: '', clearQuery: true });
      else if (kind === 'tv') switchView('discover', { endpoint: 'tv', year: '', clearQuery: true });
      else if (kind === 'trending') switchView('discover', { endpoint: 'views', year: '', clearQuery: true });
      else if (kind === 'mylist') switchView('mylist');
    });
  });

  // Live TV & Sports Hub controls
  if ($('home-goto-live-btn')) {
    $('home-goto-live-btn').addEventListener('click', () => switchView('live'));
  }
  if ($('live-refresh-btn')) {
    $('live-refresh-btn').addEventListener('click', () => loadLiveChannels({ forceRefresh: true }));
  }
  $('live-offline-next').addEventListener('click', playNextLiveChannel);
  document.querySelectorAll('#live-engine-toggle .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const engine = btn.dataset.liveEngine;
      if (state.live.activeChannel) {
        playLiveChannel(state.live.activeChannel, { engineOverride: engine, autoplay: true });
      } else {
        state.live.engine = engine;
        syncLiveEngineButtons();
      }
    });
  });
  if ($('live-quality-select')) {
    $('live-quality-select').addEventListener('change', (e) => {
      if (state.live.hlsInstance) {
        state.live.hlsInstance.currentLevel = Number(e.target.value);
        showToast(e.target.value === '-1' ? 'Quality: Auto (Adaptive)' : `Quality locked to ${e.target.selectedOptions[0].textContent}`);
      }
    });
  }
  if ($('live-copy-stream-btn')) {
    $('live-copy-stream-btn').addEventListener('click', () => {
      const ch = state.live.activeChannel;
      const url = ch ? ch.m3u8Url || ch.embedUrl : $('live-active-source-display').textContent;
      if (url) copyText(url, 'Live stream URL copied to clipboard');
    });
  }
  if ($('live-fullscreen-btn')) {
    $('live-fullscreen-btn').addEventListener('click', () => {
      const shell = $('live-video-shell');
      if (!shell) return;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (shell.requestFullscreen) shell.requestFullscreen().catch(() => {});
    });
  }
  document.querySelectorAll('#live-cat-tabs .live-cat-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.live.category = tab.dataset.liveCat;
      document.querySelectorAll('#live-cat-tabs .live-cat-tab').forEach((t) => t.classList.toggle('active', t === tab));
      renderLiveHubLists();
    });
  });
  if ($('live-custom-form')) {
    $('live-custom-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const ch = buildCustomChannelFromInput($('live-custom-url').value, $('live-custom-title').value);
      if (!ch) return;
      playLiveChannel(ch, {
        engineOverride: ch.m3u8Url ? 'hls' : 'embed',
        autoplay: true
      });
      showToast(`Playing ${ch.title}`);
    });
  }
  if ($('live-save-custom-btn')) {
    $('live-save-custom-btn').addEventListener('click', () => {
      const ch = buildCustomChannelFromInput($('live-custom-url').value, $('live-custom-title').value);
      if (!ch) {
        showToast('Paste a live stream link first');
        return;
      }
      saveCustomLiveChannel(ch);
      playLiveChannel(ch, {
        engineOverride: ch.m3u8Url ? 'hls' : 'embed',
        autoplay: true
      });
      $('live-custom-url').value = '';
      $('live-custom-title').value = '';
    });
  }
  document.querySelectorAll('[data-goto-discover]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.gotoDiscover;
      const endpoint = t === 'tv' ? 'tv' : t === 'views' ? 'views' : 'movies';
      state.discover.ordering = t === 'recent' ? 'updated_at' : 'views';
      $('filter-ordering').value = state.discover.ordering;
      switchView('discover', { endpoint, year: '', clearQuery: true });
    });
  });
  window.addEventListener('popstate', () => {
    if (!$('player-modal').hidden) closePlayerModal();
    switchView(location.hash.slice(1) || 'home', { fromHistory: true });
  });

  // Hero buttons
  $('hero-play-btn').addEventListener('click', () => {
    const h = SPOTLIGHT_HEROES[state.heroIndex];
    openTitle(h, { autoplay: true, season: h.season, episode: h.episode });
  });
  $('hero-info-btn').addEventListener('click', () => openTitle(SPOTLIGHT_HEROES[state.heroIndex]));
  $('hero-mylist-btn').addEventListener('click', () => toggleMyList(SPOTLIGHT_HEROES[state.heroIndex]));

  $('clear-history-btn').addEventListener('click', () => {
    state.continueWatching = [];
    storage.remove(profileKey('continue'));
    renderContinueWatchingRail();
    showToast('Continue Watching cleared');
  });

  // Search: titles are debounced (API needs ≥ 3 chars); IDs are looked up on Enter
  const searchBox = $('search-box');
  const searchInput = $('global-search-input');
  const searchClear = $('search-clear-btn');
  let searchTimeout = null;

  $('search-toggle-btn').addEventListener('click', () => {
    searchBox.classList.add('expanded');
    searchInput.focus();
  });
  searchInput.addEventListener('blur', () => {
    if (!searchInput.value) searchBox.classList.remove('expanded');
  });
  searchInput.addEventListener('input', () => {
    const val = searchInput.value.trim();
    searchClear.hidden = !val;
    clearTimeout(searchTimeout);
    if (!val) {
      if (state.discover.query) {
        state.discover.query = '';
        if (state.currentView === 'discover') loadDiscoverGrid();
      }
      return;
    }
    if (val.length < 3 || isIdLike(val)) return;
    searchTimeout = setTimeout(() => {
      state.discover.query = val;
      state.discover.page = 1;
      if (state.discover.endpoint === 'views') {
        state.discover.endpoint = 'movies';
        $('filter-endpoint').value = 'movies';
      }
      if (state.currentView === 'discover') loadDiscoverGrid();
      else switchView('discover');
    }, 350);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const val = searchInput.value.trim();
    if (isIdLike(val)) handleDirectIdLookup(val);
  });
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.hidden = true;
    state.discover.query = '';
    searchInput.focus();
    if (state.currentView === 'discover') loadDiscoverGrid();
  });

  // Theme popover
  const themeBtn = $('theme-Menu-btn');
  const themePopover = $('theme-popover');
  themeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    themePopover.hidden = !themePopover.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!themePopover.hidden && !themePopover.contains(e.target) && !themeBtn.contains(e.target)) {
      themePopover.hidden = true;
    }
  });
  document.querySelectorAll('.swatch-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyThemeHex(btn.dataset.hex));
  });
  $('apply-hex-btn').addEventListener('click', () => applyThemeHex($('custom-hex-input').value));
  $('custom-hex-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyThemeHex(e.target.value);
  });

  // Discover filters
  ['filter-endpoint', 'filter-ordering', 'filter-views-period', 'filter-direction', 'filter-year', 'filter-flags'].forEach(
    (id) => {
      $(id).addEventListener('change', () => {
        Object.assign(state.discover, {
          endpoint: $('filter-endpoint').value,
          ordering: $('filter-ordering').value,
          viewsPeriod: $('filter-views-period').value,
          direction: $('filter-direction').value,
          year: $('filter-year').value,
          flag: $('filter-flags').value,
          page: 1
        });
        syncNavHighlight();
        loadDiscoverGrid();
      });
    }
  );
  $('prev-page-btn').addEventListener('click', () => {
    if (state.discover.page > 1) {
      state.discover.page--;
      loadDiscoverGrid();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
  $('next-page-btn').addEventListener('click', () => {
    state.discover.page++;
    loadDiscoverGrid();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Discover: type tabs + infinite scroll
  document.querySelectorAll('.discover-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const sel = $('filter-endpoint');
      if (sel.value === tab.dataset.endpoint && !state.discover.query) return;
      sel.value = tab.dataset.endpoint;
      state.discover.query = '';
      searchInput.value = '';
      searchClear.hidden = true;
      sel.dispatchEvent(new Event('change'));
    });
  });
  $('discover-more-btn').addEventListener('click', loadMoreDiscover);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMoreDiscover(), {
      rootMargin: '600px 0px'
    }).observe($('discover-more'));
  }
  $('btn-direct-lookup').addEventListener('click', () => handleDirectIdLookup($('filter-direct-id').value));
  $('filter-direct-id').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleDirectIdLookup(e.target.value);
  });

  // Modal
  $('modal-close-btn').addEventListener('click', closePlayerModal);
  $('modal-close-x').addEventListener('click', closePlayerModal);
  $('player-modal').addEventListener('click', (e) => {
    if (e.target.id === 'player-modal') closePlayerModal();
  });
  $('stage-play-btn').addEventListener('click', startPlayback);
  $('modal-play-btn').addEventListener('click', startPlayback);
  $('modal-mylist-btn').addEventListener('click', () => {
    if (state.activeModal.item) toggleMyList(state.activeModal.item);
  });
  $('modal-copy-url-btn').addEventListener('click', () =>
    copyText($('modal-embed-url-text').textContent, 'Embed URL copied')
  );

  document.querySelectorAll('#id-mode-toggle .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeModal.idMode = btn.dataset.idMode;
      document.querySelectorAll('#id-mode-toggle .seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      applyPlayerOptions();
    });
  });
  document.querySelectorAll('#tv-format-toggle .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeModal.tvFormat = btn.dataset.tvFormat;
      document.querySelectorAll('#tv-format-toggle .seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      applyPlayerOptions();
    });
  });
  $('modal-apply-time-btn').addEventListener('click', () => {
    state.activeModal.startAt = $('modal-start-input').value.trim();
    startPlayback();
    showToast(`Starting at ${state.activeModal.startAt || '0:00'}`);
  });
  $('modal-season-select').addEventListener('change', (e) => {
    renderModalEpisodesList(Number(e.target.value));
  });
  $('modal-watchparty-btn').addEventListener('click', () => {
    const m = state.activeModal;
    const item = m.item;
    if (!item) return;
    closePlayerModal();
    Party.watchTitle({
      type: item.type,
      id: item.tmdbid || item.imdb_id,
      season: m.season,
      episode: m.episode,
      label: item.type === 'tv' ? `${item.title} S${m.season}:E${m.episode}` : item.title
    });
  });

  // postMessage remote (main player)
  const mainIframe = $('main-player-iframe');
  document.querySelectorAll('[data-pm-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.pmAction;
      const t = state.activeModal.currentTime || 0;
      if (act === 'togglePlay') sendPlayerCommand(mainIframe, { action: 'togglePlay' });
      else if (act === 'seek-back') sendPlayerCommand(mainIframe, { action: 'seek', time: Math.max(0, t - 15) });
      else if (act === 'seek-fwd') sendPlayerCommand(mainIframe, { action: 'seek', time: t + 30 });
      else if (act === 'enterFullscreen') sendPlayerCommand(mainIframe, { action: 'enterFullscreen' });
      else if (act === 'muteToggle') {
        state.activeModal.isMuted = !state.activeModal.isMuted;
        sendPlayerCommand(mainIframe, { action: state.activeModal.isMuted ? 'mute' : 'unmute' });
        btn.textContent = state.activeModal.isMuted ? 'Unmute' : 'Mute';
      }
    });
  });
  $('pm-volume-slider').addEventListener('change', (e) =>
    sendPlayerCommand(mainIframe, { action: 'setVolume', volume: Number(e.target.value) })
  );
  $('pm-speed-select').addEventListener('change', (e) =>
    sendPlayerCommand(mainIframe, { action: 'setSpeed', rate: Number(e.target.value) })
  );

  // (Watch Party controls are wired up in party-client.js)

  // Keyboard: Esc closes the topmost overlay
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!themePopover.hidden) themePopover.hidden = true;
    else if (!$('pwa-guide-modal').hidden) $('pwa-guide-modal').hidden = true;
    else if (!$('player-modal').hidden) closePlayerModal();
  });

  // PWA
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredPrompt = e;
  });
  const pwaModal = $('pwa-guide-modal');
  $('pwa-install-btn').addEventListener('click', async () => {
    if (state.deferredPrompt) {
      state.deferredPrompt.prompt();
      await state.deferredPrompt.userChoice;
      state.deferredPrompt = null;
    } else {
      pwaModal.hidden = false;
    }
  });
  $('pwa-modal-close').addEventListener('click', () => (pwaModal.hidden = true));
  $('pwa-native-trigger-btn').addEventListener('click', () => (pwaModal.hidden = true));

  // Deep links: /?play=<id>&type=movie|tv , /?tab=discover , /#mylist
  const urlParams = new URLSearchParams(location.search);
  const playId = urlParams.get('play');
  const tab = urlParams.get('tab') || location.hash.slice(1);
  if (tab && tab !== 'home') switchView(tab, { fromHistory: true });
  else history.replaceState({ view: 'home' }, '', '#home');
  if (playId) {
    const known = SPOTLIGHT_HEROES.find((h) => h.tmdbid === playId || h.imdb_id === playId);
    if (known) openTitle(known);
    else handleDirectIdLookup(playId);
  }
});
