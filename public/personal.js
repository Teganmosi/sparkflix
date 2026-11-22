/**
 * SparkFlix personalisation — "Top picks for you" and "Because you watched…" rows.
 *
 * How it works
 *  1. Signals: every profile keeps a small taste history. Opening a title counts 1,
 *     adding it to My List counts 3, pressing Play counts 4. Explicit genre picks count 3.
 *     Signals fade with a two-week half-life, so recent taste matters most.
 *  2. Each signal is enriched with Cinemeta metadata (genres, cast, director).
 *  3. Candidates come from Cinemeta "top" catalogs for the profile's strongest genres
 *     (via /api/catalog on our server), and every candidate gets a score:
 *        Σ genre weights  +  shared cast × 1.5  +  shared director × 2  +  rating bonus
 *     Titles the profile has already seen or saved are excluded.
 *  4. The score is shown as a "% match" on each card, and the row explains itself
 *     ("Because you like Sci-Fi & Action").
 *  The Kids profile only ever gets Family / Animation recommendations.
 *
 * Loaded after app.js and uses its globals: state, $, storage, profileKey, fetchMeta,
 * createMediaCard, normalizeItem, escapeHtml.
 */
'use strict';

const Personal = (() => {
  const WEIGHTS = { view: 1, list: 3, play: 4 };
  const GENRE_PICK_WEIGHT = 3;
  const HALF_LIFE_DAYS = 14;
  const MAX_TITLES = 40;
  const PICKABLE = ['Action', 'Comedy', 'Sci-Fi', 'Thriller', 'Horror', 'Romance', 'Animation', 'Drama', 'Crime', 'Fantasy', 'Adventure', 'Mystery', 'Family', 'Documentary'];
  const CATALOG_GENRES = new Set([...PICKABLE, 'Biography', 'History', 'Sport', 'War', 'Western']);
  const KIDS_GENRES = ['Animation', 'Family'];

  const catalogCache = new Map(); // `${type}:${genre}` -> Promise<metas[]>
  let renderToken = 0;
  let refreshTimer = null;

  // ---------- storage ----------
  function load() {
    const t = storage.get(profileKey('taste'), null);
    return t && Array.isArray(t.titles) ? t : { titles: [], genres: {} };
  }

  function save(taste) {
    storage.set(profileKey('taste'), taste);
  }

  function isKids() {
    return state.profile && state.profile.id === 'kids';
  }

  // ---------- signals ----------
  /** Record that the profile interacted with a title. kind: 'view' | 'list' | 'play' */
  async function record(rawItem, kind = 'view') {
    if (!rawItem || !state.profile) return;
    const item = normalizeItem(rawItem);
    if (!item.imdb_id && !item.tmdbid) return;
    const taste = load();
    let entry = taste.titles.find((t) => t.uid === item.uid);
    if (!entry) {
      entry = {
        uid: item.uid,
        type: item.type,
        imdb_id: item.imdb_id,
        tmdbid: item.tmdbid,
        title: item.title,
        genres: Array.isArray(item.genres) ? item.genres : [],
        cast: [],
        director: [],
        weight: 0,
        kind
      };
      taste.titles.unshift(entry);
    }
    entry.weight = Math.min(12, entry.weight + WEIGHTS[kind]);
    if (WEIGHTS[kind] >= WEIGHTS[entry.kind] || !entry.kind) entry.kind = kind;
    entry.at = Date.now();
    taste.titles.sort((a, b) => b.at - a.at);
    taste.titles = taste.titles.slice(0, MAX_TITLES);
    save(taste);

    // Enrich with genres / cast / director once
    if (item.imdb_id && (!entry.genres.length || !entry.cast.length)) {
      const meta = await fetchMeta(item.type, item.imdb_id);
      if (meta) {
        const fresh = load();
        const e = fresh.titles.find((t) => t.uid === item.uid);
        if (e) {
          e.genres = meta.genre || meta.genres || e.genres;
          e.cast = (meta.cast || []).slice(0, 6);
          e.director = Array.isArray(meta.director) ? meta.director.slice(0, 2) : [];
          if (meta.name && /^Title /.test(e.title)) e.title = meta.name;
          save(fresh);
        }
      }
    }
    scheduleRefresh();
  }

  function toggleGenre(genre) {
    const taste = load();
    if (taste.genres[genre]) delete taste.genres[genre];
    else taste.genres[genre] = GENRE_PICK_WEIGHT;
    save(taste);
    renderPicker();
    scheduleRefresh(150);
  }

  // ---------- scoring ----------
  function decay(at) {
    const days = (Date.now() - (at || Date.now())) / 86400000;
    return Math.pow(0.5, days / HALF_LIFE_DAYS);
  }

  function genreWeights(taste) {
    const gw = {};
    taste.titles.forEach((t) => {
      const w = t.weight * decay(t.at);
      (t.genres || []).forEach((g) => (gw[g] = (gw[g] || 0) + w));
    });
    Object.entries(taste.genres || {}).forEach(([g, w]) => (gw[g] = (gw[g] || 0) + w));
    if (isKids()) Object.keys(gw).forEach((g) => !KIDS_GENRES.includes(g) && delete gw[g]);
    return gw;
  }

  function topGenres(gw, n) {
    return Object.entries(gw)
      .filter(([g]) => CATALOG_GENRES.has(g))
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([g]) => g);
  }

  function fetchCatalog(type, genre) {
    const key = `${type}:${genre}`;
    if (!catalogCache.has(key)) {
      catalogCache.set(
        key,
        fetch(`/api/catalog/${type}/${encodeURIComponent(genre)}`)
          .then((r) => (r.ok ? r.json() : { metas: [] }))
          .then((d) => d.metas || [])
          .catch(() => {
            catalogCache.delete(key); // allow a retry later
            return [];
          })
      );
    }
    return catalogCache.get(key);
  }

  function seenIds(taste) {
    const ids = new Set();
    const add = (x) => {
      if (x.imdb_id) ids.add(x.imdb_id);
      if (x.tmdbid) ids.add(`${x.type}:${x.tmdbid}`);
    };
    taste.titles.forEach(add);
    (state.myList || []).forEach(add);
    (state.continueWatching || []).forEach(add);
    return ids;
  }

  function isSeen(seen, c) {
    return seen.has(c.imdb_id) || (c.tmdbid && seen.has(`${c.type}:${c.tmdbid}`));
  }

  function kidsOk(c) {
    return !isKids() || (c.genres || []).some((g) => KIDS_GENRES.includes(g));
  }

  function overlap(a = [], b = []) {
    const set = new Set(b);
    return a.filter((x) => set.has(x)).length;
  }

  function withMatch(scored) {
    const max = scored.length ? scored[0].score : 1;
    return scored.map((s) => ({ ...s, matchPct: Math.max(70, Math.min(99, Math.round(70 + (29 * s.score) / (max || 1)))) }));
  }

  async function topPicks(taste) {
    const gw = genreWeights(taste);
    const genres = topGenres(gw, 3);
    if (!genres.length) return { items: [], genres };

    // Mostly movies, plus series if the profile watches series
    const tvWeight = taste.titles.filter((t) => t.type === 'tv').reduce((s, t) => s + t.weight, 0);
    const jobs = genres.map((g) => fetchCatalog('movie', g));
    if (tvWeight > 0) jobs.push(fetchCatalog('tv', genres[0]));
    const lists = await Promise.all(jobs);

    const likedCast = new Set(taste.titles.flatMap((t) => t.cast || []));
    const likedDirectors = new Set(taste.titles.flatMap((t) => t.director || []));
    const seen = seenIds(taste);
    const byId = new Map();
    lists.flat().forEach((c) => {
      if (!c.imdb_id || isSeen(seen, c) || !kidsOk(c) || byId.has(c.imdb_id)) return;
      let score = (c.genres || []).reduce((s, g) => s + (gw[g] || 0), 0);
      score += (c.cast || []).filter((x) => likedCast.has(x)).length * 1.5;
      score += (c.director || []).filter((x) => likedDirectors.has(x)).length * 2;
      score += Math.max(0, (parseFloat(c.rating) || 6) - 6) * 0.4;
      byId.set(c.imdb_id, { ...c, score });
    });
    const items = withMatch([...byId.values()].sort((a, b) => b.score - a.score).slice(0, 20));
    return { items, genres };
  }

  async function becauseOf(anchor, taste) {
    const genres = (anchor.genres || []).filter((g) => CATALOG_GENRES.has(g)).slice(0, 2);
    const usable = isKids() ? genres.filter((g) => KIDS_GENRES.includes(g)) : genres;
    if (!usable.length) return [];
    const lists = await Promise.all(usable.map((g) => fetchCatalog(anchor.type === 'tv' ? 'tv' : 'movie', g)));
    const seen = seenIds(taste);
    const byId = new Map();
    lists.flat().forEach((c) => {
      if (!c.imdb_id || c.imdb_id === anchor.imdb_id || isSeen(seen, c) || !kidsOk(c) || byId.has(c.imdb_id)) return;
      let score = overlap(c.genres, anchor.genres) * 3;
      score += overlap(c.cast, anchor.cast) * 2.5;
      score += overlap(c.director, anchor.director) * 3;
      score += Math.max(0, (parseFloat(c.rating) || 6) - 6) * 0.5;
      byId.set(c.imdb_id, { ...c, score });
    });
    return withMatch([...byId.values()].sort((a, b) => b.score - a.score).slice(0, 16));
  }

  // ---------- rendering ----------
  function joinNice(list) {
    if (list.length <= 1) return list.join('');
    return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`;
  }

  function fillRow(scrollerId, items, used) {
    const scroller = $(scrollerId);
    scroller.innerHTML = '';
    let count = 0;
    items.forEach((it) => {
      if (used.has(it.imdb_id) || count >= 14) return;
      used.add(it.imdb_id);
      count++;
      scroller.appendChild(createMediaCard(it, { defaultType: it.type, matchPct: it.matchPct }));
    });
    scroller.scrollLeft = 0;
    if (scroller._updateArrows) requestAnimationFrame(scroller._updateArrows);
    return count;
  }

  function renderPicker(forceOpen) {
    const taste = load();
    const picked = Object.keys(taste.genres || {});
    const hasSignals = taste.titles.length > 0 || picked.length > 0;
    const rail = $('rail-taste-picker');
    const open = forceOpen === undefined ? !hasSignals || rail.dataset.open === '1' : forceOpen;
    // Stays open while the user is picking, until they press Done
    rail.dataset.open = open ? '1' : '';
    rail.hidden = !open;
    $('taste-done-btn').hidden = !hasSignals;
    const box = $('taste-chips');
    box.innerHTML = '';
    (isKids() ? ['Animation', 'Family', 'Adventure', 'Comedy', 'Fantasy'] : PICKABLE).forEach((g) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `taste-chip${taste.genres && taste.genres[g] ? ' on' : ''}`;
      b.textContent = g;
      b.setAttribute('aria-pressed', taste.genres && taste.genres[g] ? 'true' : 'false');
      b.addEventListener('click', () => toggleGenre(g));
      box.appendChild(b);
    });
  }

  async function refresh() {
    if (!state.profile || !$('rail-foryou')) return;
    const token = ++renderToken;
    const taste = load();
    renderPicker();
    $('foryou-name').textContent = state.profile.name === 'Me' ? 'you' : state.profile.name;

    const hasSignals = taste.titles.length > 0 || Object.keys(taste.genres || {}).length > 0;
    if (!hasSignals) {
      ['rail-foryou', 'rail-because-0', 'rail-because-1'].forEach((id) => ($(id).hidden = true));
      return;
    }

    // Anchors for "Because you…": strongest recent titles that have genre data
    const anchors = [...taste.titles]
      .filter((t) => (t.genres || []).length)
      .sort((a, b) => b.weight * decay(b.at) - a.weight * decay(a.at))
      .slice(0, 2);

    const [picks, ...because] = await Promise.all([topPicks(taste), ...anchors.map((a) => becauseOf(a, taste))]);
    if (token !== renderToken) return; // a newer refresh started

    const used = new Set();
    const forYou = $('rail-foryou');
    if (picks.items.length) {
      const shown = fillRow('scroller-foryou', picks.items, used);
      forYou.hidden = shown === 0;
      $('foryou-reason').textContent = isKids()
        ? 'Family-friendly picks for the Kids profile'
        : `Because you like ${joinNice(picks.genres.slice(0, 2))}`;
    } else {
      forYou.hidden = true;
    }

    [0, 1].forEach((i) => {
      const rail = $(`rail-because-${i}`);
      const anchor = anchors[i];
      const items = because[i] || [];
      if (!anchor || !items.length) {
        rail.hidden = true;
        return;
      }
      const verb = anchor.kind === 'play' ? 'watched' : anchor.kind === 'list' ? 'saved' : 'viewed';
      $(`because-title-${i}`).textContent = `Because you ${verb} ${anchor.title}`;
      rail.hidden = fillRow(`scroller-because-${i}`, items, used) === 0;
    });
  }

  function scheduleRefresh(delay = 400) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, delay);
  }

  function init() {
    $('taste-edit-btn').addEventListener('click', () => {
      renderPicker(true);
      $('rail-taste-picker').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $('taste-done-btn').addEventListener('click', () => renderPicker(false));
    refresh();
  }

  return { init, record, refresh, scheduleRefresh, _load: load };
})();

document.addEventListener('DOMContentLoaded', Personal.init);
