/**
 * Football on the Live TV page: live scores + official match highlights.
 * Data: /api/football/scores?date=YYYYMMDD and /api/football/highlights (see football.js).
 *
 *  • Yesterday / Today / Tomorrow tabs, league filter chips, crests, kickoff in local time
 *  • Live matches show a pulsing minute badge; refreshes every 30 s while anything is live
 *    (only while the Live TV page is open and the browser tab is visible)
 *  • Finished matches link straight to their highlights when an official video exists
 *  • Highlights play in an in-app player (YouTube privacy-enhanced embed)
 *
 * Loaded after app.js and uses its globals: state, escapeHtml, showToast, storage.
 */
'use strict';

const Football = (() => {
  const el = (id) => document.getElementById(id);
  const s = {
    day: 0, // -1 yesterday, 0 today, 1 tomorrow
    league: 'all',
    data: null,
    highlights: [],
    timer: null,
    loadingToken: 0,
    lastFocus: null
  };

  function ymd(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  function kickoffTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  function relTime(iso) {
    const mins = Math.round((Date.now() - new Date(iso)) / 60000);
    if (mins < 60) return `${Math.max(1, mins)}m ago`;
    const h = Math.round(mins / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    return d === 1 ? 'yesterday' : `${d} days ago`;
  }

  // ---------- highlights ↔ matches ----------
  const norm = (t) =>
    String(t || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9 ]/g, ' ');

  function teamKeys(team) {
    // e.g. "Man City" → ["man city", "city"]; "Real Madrid" → ["real madrid", "madrid"]
    const names = [team.name, team.fullName].map(norm).filter(Boolean);
    const words = names.flatMap((n) => n.split(' ').filter((w) => w.length > 3 && !['real', 'club', 'united', 'city'].includes(w)));
    return [...new Set([...names, ...words])];
  }

  function findHighlight(match) {
    if (match.state !== 'post') return null;
    const home = teamKeys(match.home);
    const away = teamKeys(match.away);
    return (
      s.highlights.find((v) => {
        const t = ` ${norm(v.title)} `;
        return home.some((k) => t.includes(` ${k} `) || t.includes(k)) && away.some((k) => t.includes(` ${k} `) || t.includes(k));
      }) || null
    );
  }

  // ---------- rendering: scores ----------
  function renderDays() {
    const box = el('scores-days');
    box.innerHTML = '';
    [
      [-1, 'Yesterday'],
      [0, 'Today'],
      [1, 'Tomorrow']
    ].forEach(([offset, label]) => {
      const b = document.createElement('button');
      b.className = `discover-tab${s.day === offset ? ' active' : ''}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(s.day === offset));
      b.textContent = label;
      b.addEventListener('click', () => {
        if (s.day === offset) return;
        s.day = offset;
        s.league = 'all';
        renderDays();
        loadScores();
      });
      box.appendChild(b);
    });
  }

  function renderLeagueChips() {
    const box = el('scores-leagues');
    box.innerHTML = '';
    const leagues = (s.data && s.data.leagues) || [];
    if (leagues.length < 2) return;
    [{ id: 'all', short: 'All' }, ...leagues].forEach((l) => {
      const b = document.createElement('button');
      b.className = `score-chip${s.league === l.id ? ' on' : ''}`;
      const live = l.matches ? l.matches.filter((m) => m.state === 'in').length : 0;
      b.textContent = l.short || l.name;
      if (live) {
        const dot = document.createElement('span');
        dot.className = 'score-chip-live';
        dot.textContent = live;
        dot.title = `${live} live`;
        b.appendChild(dot);
      }
      b.addEventListener('click', () => {
        s.league = l.id;
        renderLeagueChips();
        renderScores();
      });
      box.appendChild(b);
    });
  }

  function statusBadge(m) {
    if (m.state === 'in') {
      const label = /half/i.test(m.detail) ? 'HT' : m.detail || 'LIVE';
      return `<span class="match-status live"><span class="live-pulse-dot"></span>${escapeHtml(label)}</span>`;
    }
    if (m.state === 'post') return `<span class="match-status ft">${escapeHtml(/pen|aet/i.test(m.detail) ? m.detail : 'FT')}</span>`;
    if (/postp|canc|susp/i.test(m.detail)) return `<span class="match-status off">${escapeHtml(m.detail)}</span>`;
    return `<span class="match-status pre">${escapeHtml(kickoffTime(m.kickoff))}</span>`;
  }

  function teamRow(t, m, side) {
    const showScore = m.state !== 'pre';
    const lead = m.state === 'post' ? t.winner : false;
    return `<div class="match-team${lead ? ' winner' : ''}">
      ${t.logo ? `<img src="${escapeHtml(t.logo)}" alt="" width="22" height="22" loading="lazy" />` : '<span class="crest-fallback"></span>'}
      <span class="match-team-name">${escapeHtml(t.name)}</span>
      <span class="match-score" aria-label="${side} score">${showScore ? escapeHtml(t.score || '0') : ''}</span>
    </div>`;
  }

  function matchCard(m) {
    const card = document.createElement('div');
    card.className = `match-card state-${m.state}`;
    card.innerHTML = `
      <div class="match-side">${statusBadge(m)}</div>
      <div class="match-teams">${teamRow(m.home, m, 'home')}${teamRow(m.away, m, 'away')}</div>`;
    const hl = findHighlight(m);
    if (hl) {
      const b = document.createElement('button');
      b.className = 'match-hl-btn';
      b.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M7 4.5l13 7.5-13 7.5z"/></svg>Highlights';
      b.setAttribute('aria-label', `Watch highlights: ${m.home.name} vs ${m.away.name}`);
      b.addEventListener('click', () => openHighlight(hl));
      card.appendChild(b);
    }
    return card;
  }

  function renderScores() {
    const list = el('scores-list');
    list.innerHTML = '';
    const leagues = ((s.data && s.data.leagues) || []).filter((l) => s.league === 'all' || l.id === s.league);
    const withMatches = leagues.filter((l) => l.matches.length);
    if (!withMatches.length) {
      const dayWord = s.day === 0 ? 'today' : s.day < 0 ? 'yesterday' : 'tomorrow';
      list.innerHTML = `<div class="scores-empty">No matches in these leagues ${dayWord}.${s.day !== 1 ? ' Try Tomorrow.' : ''}</div>`;
      return;
    }
    // Live leagues first, then by first kickoff
    withMatches
      .sort((a, b) => {
        const la = a.matches.some((m) => m.state === 'in') ? 0 : 1;
        const lb = b.matches.some((m) => m.state === 'in') ? 0 : 1;
        return la - lb || new Date(a.matches[0].kickoff) - new Date(b.matches[0].kickoff);
      })
      .forEach((l) => {
        const group = document.createElement('div');
        group.className = 'league-group';
        const head = document.createElement('div');
        head.className = 'league-head';
        head.innerHTML = `${l.logo ? `<img src="${escapeHtml(l.logo)}" alt="" width="20" height="20" loading="lazy" />` : ''}<span>${escapeHtml(l.name)}</span>`;
        group.appendChild(head);
        const grid = document.createElement('div');
        grid.className = 'league-matches';
        const order = { in: 0, pre: 1, post: 2 };
        [...l.matches]
          .sort((a, b) => order[a.state] - order[b.state] || new Date(a.kickoff) - new Date(b.kickoff))
          .forEach((m) => grid.appendChild(matchCard(m)));
        group.appendChild(grid);
        list.appendChild(group);
      });
  }

  function renderSkeleton() {
    el('scores-list').innerHTML = Array.from({ length: 4 }, () => '<div class="match-card skeleton-match"></div>').join('');
  }

  function anyLive() {
    return !!(s.data && s.data.leagues.some((l) => l.matches.some((m) => m.state === 'in')));
  }

  async function loadScores({ quiet = false } = {}) {
    const token = ++s.loadingToken;
    if (!quiet) renderSkeleton();
    try {
      const res = await fetch(`/api/football/scores?date=${ymd(s.day)}`);
      const data = await res.json();
      if (token !== s.loadingToken) return;
      if (!res.ok) throw new Error(data.error || 'Scores unavailable');
      s.data = data;
      renderLeagueChips();
      renderScores();
      const live = anyLive();
      el('scores-updated').textContent = `${live ? 'Live · updates every 30 seconds · ' : ''}Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (_) {
      if (token !== s.loadingToken) return;
      if (!quiet) {
        el('scores-list').innerHTML = '<div class="scores-empty">Scores are unavailable right now. <button class="btn-secondary-sm" id="scores-retry">Retry</button></div>';
        el('scores-retry').addEventListener('click', () => loadScores());
      }
    }
    schedule();
  }

  function schedule() {
    clearTimeout(s.timer);
    // Poll fast only when it matters: today, something live, page open and visible
    const delay = s.day === 0 && anyLive() ? 30000 : 120000;
    s.timer = setTimeout(() => {
      if (state.currentView === 'live' && !document.hidden) loadScores({ quiet: true });
      else schedule();
    }, delay);
  }

  // ---------- highlights ----------
  async function loadHighlights() {
    const scroller = el('scroller-highlights');
    scroller.innerHTML = Array.from({ length: 4 }, () => '<div class="highlight-tile skeleton-card"></div>').join('');
    try {
      const res = await fetch('/api/football/highlights');
      const data = await res.json();
      // Skip videos that already failed to play for this viewer (e.g. region-blocked)
      s.highlights = (data.videos || []).filter((v) => !blocked.has(v.videoId));
    } catch (_) {
      s.highlights = [];
    }
    scroller.innerHTML = '';
    if (!s.highlights.length) {
      scroller.innerHTML = '<div class="scores-empty">Highlights are unavailable right now.</div>';
      return;
    }
    s.highlights.forEach((v) => {
      const tile = document.createElement('button');
      tile.className = 'highlight-tile';
      tile.dataset.video = v.videoId;
      tile.innerHTML = `
        <span class="highlight-thumb">
          <img src="${escapeHtml(v.thumbnail)}" alt="" loading="lazy" />
          <span class="highlight-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 4.5l13 7.5-13 7.5z"/></svg></span>
          ${v.league ? `<span class="highlight-badge">${escapeHtml(v.league)}</span>` : ''}
        </span>
        <span class="highlight-name">${escapeHtml(v.title)}</span>
        <span class="highlight-sub">${escapeHtml(v.channel)} · ${escapeHtml(relTime(v.published))}</span>`;
      tile.addEventListener('click', () => openHighlight(v));
      scroller.appendChild(tile);
    });
    if (scroller._updateArrows) requestAnimationFrame(scroller._updateArrows);
    if (s.data) renderScores(); // add "Highlights" buttons to finished matches
  }

  // ---------- highlight player (YouTube IFrame Player API) ----------
  // The API tells us when a video can't play (region-blocked, removed, embedding off),
  // so we can offer another highlight instead of YouTube's dead-end error screen.
  const BLOCKED_KEY = 'sparkflix:blocked-highlights';
  const blocked = new Set(storage.get(BLOCKED_KEY, []));
  let ytApi = null;
  let player = null;
  let current = null;

  function loadYouTubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (!ytApi) {
      ytApi = new Promise((resolve, reject) => {
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          if (prev) prev();
          resolve();
        };
        const sc = document.createElement('script');
        sc.src = 'https://www.youtube.com/iframe_api';
        sc.onerror = reject;
        document.head.appendChild(sc);
        setTimeout(() => reject(new Error('YouTube API timeout')), 10000);
      }).catch((e) => {
        ytApi = null;
        throw e;
      });
    }
    return ytApi;
  }

  function showPlayerError() {
    el('highlight-error').hidden = false;
    el('highlight-next').hidden = !nextPlayable();
  }

  function markBlocked(videoId) {
    blocked.add(videoId);
    storage.set(BLOCKED_KEY, [...blocked].slice(-100));
    s.highlights = s.highlights.filter((v) => v.videoId !== videoId);
    const tile = document.querySelector(`#scroller-highlights [data-video="${CSS.escape(videoId)}"]`);
    if (tile) tile.remove();
    if (s.data) renderScores(); // drop its "Highlights" button too
  }

  function nextPlayable() {
    return s.highlights.find((v) => v.videoId !== (current && current.videoId) && !blocked.has(v.videoId)) || null;
  }

  function onPlayerError(e) {
    // 2 bad id · 5 HTML5 error · 100 removed/private · 101/150 owner blocks this embed or region
    if (!current) return;
    if ([100, 101, 150].includes(e.data)) markBlocked(current.videoId);
    showPlayerError();
  }

  async function playVideo(videoId) {
    try {
      await loadYouTubeApi();
      if (player && player.loadVideoById) {
        player.loadVideoById(videoId);
      } else {
        player = new window.YT.Player('highlight-player', {
          host: 'https://www.youtube-nocookie.com',
          videoId,
          width: '100%',
          height: '100%',
          playerVars: { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1 },
          events: { onError: onPlayerError }
        });
      }
    } catch (_) {
      // API unavailable (offline or blocked): fall back to a plain privacy-enhanced embed
      el('highlight-player').outerHTML = `<iframe id="highlight-player" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(
        videoId
      )}?autoplay=1&rel=0&playsinline=1" title="Match highlights" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
      player = null;
    }
  }

  function openHighlight(v) {
    if (!v) return;
    current = v;
    if (el('highlight-modal').hidden) s.lastFocus = document.activeElement;
    // Pause live TV so two things don't play at once
    const liveVideo = el('live-hls-video');
    if (liveVideo && !liveVideo.paused) liveVideo.pause();
    const ytUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(v.videoId)}`;
    el('highlight-title').textContent = v.title;
    el('highlight-league').textContent = v.league || 'Highlights';
    el('highlight-league').hidden = !v.league;
    el('highlight-channel').textContent = `Official video · ${v.channel}`;
    el('highlight-youtube').href = ytUrl;
    el('highlight-error-yt').href = ytUrl;
    el('highlight-error').hidden = true;
    el('highlight-modal').hidden = false;
    document.body.classList.add('modal-open');
    el('highlight-close').focus({ preventScroll: true });
    if (blocked.has(v.videoId)) showPlayerError();
    else playVideo(v.videoId);
  }

  function closeHighlight() {
    if (el('highlight-modal').hidden) return;
    try {
      if (player && player.stopVideo) player.stopVideo();
      else if (el('highlight-player').tagName === 'IFRAME') el('highlight-player').src = 'about:blank';
    } catch (_) {}
    current = null;
    el('highlight-modal').hidden = true;
    document.body.classList.remove('modal-open');
    if (s.lastFocus && document.contains(s.lastFocus)) s.lastFocus.focus({ preventScroll: true });
  }

  // ---------- lifecycle ----------
  let started = false;
  function onEnterLive() {
    if (!started) {
      started = true;
      renderDays();
      loadScores();
      loadHighlights();
    } else if (s.day === 0) {
      loadScores({ quiet: true });
    }
  }

  function init() {
    el('highlight-close').addEventListener('click', closeHighlight);
    el('highlight-next').addEventListener('click', () => openHighlight(nextPlayable()));
    el('highlight-modal').addEventListener('click', (e) => {
      if (e.target.id === 'highlight-modal') closeHighlight();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeHighlight();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.currentView === 'live' && started && s.day === 0) loadScores({ quiet: true });
    });
    if (state.currentView === 'live') onEnterLive();
  }

  return { init, onEnterLive, openHighlight, _state: s };
})();

document.addEventListener('DOMContentLoaded', Football.init);
