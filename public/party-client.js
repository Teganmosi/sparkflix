/**
 * SparkFlix Watch Party — client.
 *
 * Real cross-device rooms: every viewer keeps a Server-Sent Events stream open to
 * /api/party/:code/events and posts actions to /api/party/:code/send (see party.js).
 *
 *   • Start / join by code, invite link, QR code or the native share sheet
 *   • Synced play / pause / seek through the VidSpark postMessage API
 *   • Late joiners start at the room's current position (?t= on the embed URL)
 *   • Live chat, floating emoji reactions, avatars of who's watching
 *
 * Loaded after app.js and uses its globals: state, $, escapeHtml, showToast,
 * formatSeconds, buildVidSparkEmbedUrl, switchView, storage.
 */
'use strict';

const Party = (() => {
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L lookalikes
  const REACTIONS = ['😂', '😮', '❤️', '🔥', '👏', '😱', '🍿', '😭'];
  const ECHO_GUARD_MS = 1500;
  const QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';

  const s = {
    code: null,
    es: null,
    me: null,
    peers: new Map(),
    title: null,
    clockOffset: 0, // serverNow - Date.now()
    suppressUntil: 0,
    playerTime: 0,
    playerPaused: true,
    pendingStart: null, // { action, time } to apply once the player reports in
    lastReactAt: 0,
    unread: 0
  };

  // ---------- small helpers ----------
  const el = (id) => document.getElementById(id);

  function peerId() {
    let id = null;
    try {
      id = sessionStorage.getItem('sparkflix:party-peer');
    } catch (_) {}
    if (!id || !/^[a-z0-9]{10}$/.test(id)) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
      try {
        sessionStorage.setItem('sparkflix:party-peer', id);
      } catch (_) {}
    }
    return id;
  }

  function newCode() {
    return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  }

  function defaultName() {
    const saved = storage.get('sparkflix:party-name', '');
    if (saved) return saved;
    const p = state.profile;
    if (p && p.name !== 'Me') return p.name;
    return `Guest ${Math.floor(10 + Math.random() * 90)}`;
  }

  function myColor() {
    return (state.profile && state.profile.color) || '#E50914';
  }

  function inviteUrl() {
    return `${location.origin}/?party=${s.code}`;
  }

  function serverNow() {
    return Date.now() + s.clockOffset;
  }

  function parseOption(value) {
    const [type, id, season, episode, ...rest] = String(value).split(':');
    return { type, id, season: Number(season) || 1, episode: Number(episode) || 1, label: rest.join(':') };
  }

  function iframe() {
    return el('party-iframe');
  }

  const PLAYER_ORIGIN = 'https://vidspark.to';

  function postToPlayer(msg) {
    const f = iframe();
    // Commands only ever go to the VidSpark player's origin
    if (f?.contentWindow && f.src !== 'about:blank') f.contentWindow.postMessage(msg, PLAYER_ORIGIN);
  }

  // ---------- network ----------
  async function send(payload) {
    if (!s.code || !s.me) return false;
    try {
      const res = await fetch(`/api/party/${s.code}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer: s.me.id, ...payload })
      });
      if (res.status === 429) showToast('Slow down a little 🙂');
      return res.ok;
    } catch (_) {
      showToast('Connection problem, message not sent');
      return false;
    }
  }

  function connect(code, name) {
    disconnect();
    s.code = code;
    s.peers.clear();
    const params = new URLSearchParams({ peer: peerId(), name, color: myColor() });
    const es = new EventSource(`/api/party/${code}/events?${params}`);
    s.es = es;
    setConnection('connecting');
    es.onopen = () => setConnection('ok');
    es.onerror = () => setConnection(es.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting');
    es.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch (_) {
        return;
      }
      if (msg.serverNow) s.clockOffset = msg.serverNow - Date.now();
      handle(msg);
    };
  }

  function disconnect() {
    if (s.es) s.es.close();
    s.es = null;
  }

  function setConnection(status) {
    const pill = el('party-connection');
    if (!pill) return;
    pill.hidden = status === 'ok';
    pill.textContent = status === 'connecting' ? 'Connecting…' : status === 'closed' ? 'Disconnected' : 'Reconnecting…';
  }

  // ---------- incoming messages ----------
  function handle(msg) {
    switch (msg.type) {
      case 'welcome': {
        s.me = msg.you;
        s.peers = new Map(msg.room.peers.map((p) => [p.id, p]));
        renderPeople();
        el('party-feed').innerHTML = '';
        system(`You joined room ${msg.room.code}`);
        (msg.room.chat || []).forEach((c) => chatLine(c.from, c.text, c.from.id === s.me.id));
        if (msg.room.title) {
          // Catch up: if the room is playing, add the time that has passed since the last action
          const pb = msg.room.playback;
          const elapsed = pb.action === 'play' ? (msg.serverNow - pb.at) / 1000 : 0;
          const time = Math.floor(pb.time + elapsed);
          loadTitle(msg.room.title, { startAt: time, startPlaying: pb.action === 'play' });
          if (time > 5) system(`Catching up to ${formatSeconds(time)}`);
        } else {
          // Brand-new room: whoever created it sets the first title
          const pick = s.pendingTitle || parseOption(el('party-start-picker').value);
          s.pendingTitle = null;
          setTitle(pick);
        }
        showRoom();
        break;
      }
      case 'join':
        s.peers.set(msg.peer.id, msg.peer);
        renderPeople();
        system(`${msg.peer.name} joined`);
        if (state.currentView !== 'party') showToast(`${msg.peer.name} joined your Watch Party`);
        break;
      case 'leave':
        s.peers.delete(msg.peer.id);
        renderPeople();
        system(`${msg.peer.name} left`);
        break;
      case 'title':
        loadTitle(msg.title, { startAt: 0, startPlaying: false });
        system(`${msg.from.name} switched to ${msg.title.label}`);
        break;
      case 'cmd':
        applyRemote(msg);
        break;
      case 'chat':
        chatLine(msg.from, msg.text, false);
        if (state.currentView !== 'party') {
          s.unread++;
          updateBadge();
          showToast(`${msg.from.name}: ${msg.text.slice(0, 60)}`);
        }
        break;
      case 'react':
        floatReaction(msg.emoji, msg.from.name);
        break;
    }
  }

  function applyRemote(msg) {
    s.suppressUntil = Date.now() + ECHO_GUARD_MS;
    // Compensate for network delay when the sender was playing
    const lag = msg.action === 'play' ? Math.max(0, (serverNow() - msg.serverNow) / 1000) : 0;
    const target = msg.time + lag;
    if (msg.action === 'seek' || Math.abs(target - s.playerTime) > 2) postToPlayer({ action: 'seek', time: target });
    if (msg.action === 'play') postToPlayer({ action: 'play' });
    if (msg.action === 'pause') postToPlayer({ action: 'pause' });
    const verb = msg.action === 'seek' ? 'jumped to' : msg.action === 'play' ? 'played at' : 'paused at';
    system(`${msg.from.name} ${verb} ${formatSeconds(msg.time)}`);
  }

  // Player telemetry from the party iframe → broadcast what *this* viewer did
  window.addEventListener('message', (e) => {
    // Trust only messages from the VidSpark origin, from *our* party iframe
    if (e.origin !== PLAYER_ORIGIN || e.data?.source !== 'vidspark-player') return;
    const f = iframe();
    if (!f || e.source !== f.contentWindow) return;
    const d = e.data;
    if (d.currentTime !== undefined) s.playerTime = Number(d.currentTime) || 0;
    if (d.paused !== undefined) s.playerPaused = !!d.paused;
    if (d.event === 'play') s.playerPaused = false;
    if (d.event === 'pause') s.playerPaused = true;

    // First report from a freshly loaded player: apply the catch-up start
    if (s.pendingStart && (d.event === 'timeupdate' || d.event === 'playerstatus')) {
      const start = s.pendingStart;
      s.pendingStart = null;
      s.suppressUntil = Date.now() + ECHO_GUARD_MS;
      if (start.playing) postToPlayer({ action: 'play' });
    }

    if (!s.code || Date.now() < s.suppressUntil) return; // echo of a command we just applied
    if (d.event === 'play') send({ type: 'cmd', action: 'play', time: s.playerTime });
    else if (d.event === 'pause') send({ type: 'cmd', action: 'pause', time: s.playerTime });
    else if (d.event === 'seeked') send({ type: 'cmd', action: 'seek', time: s.playerTime });
  });

  // ---------- actions ----------
  function loadTitle(title, { startAt = 0, startPlaying = false } = {}) {
    s.title = title;
    s.playerTime = startAt;
    s.pendingStart = { playing: startPlaying };
    s.suppressUntil = Date.now() + 4000; // ignore the player's start-up events
    iframe().src = buildVidSparkEmbedUrl({
      type: title.type,
      id: title.id,
      season: title.season,
      episode: title.episode,
      startAt: startAt > 0 ? String(Math.floor(startAt)) : ''
    });
    el('party-now-playing').textContent = title.label;
    const picker = el('party-title-picker');
    const match = [...picker.options].find((o) => parseOption(o.value).id === String(title.id));
    if (match) picker.value = match.value;
    else {
      const opt = new Option(title.label, `${title.type}:${title.id}:${title.season}:${title.episode}:${title.label}`);
      picker.add(opt, 0);
      picker.value = opt.value;
    }
  }

  function setTitle(title) {
    loadTitle(title, { startAt: 0, startPlaying: false });
    send({ type: 'title', title });
    system(`You picked ${title.label}`);
  }

  function command(action, time) {
    s.suppressUntil = Date.now() + ECHO_GUARD_MS;
    if (action === 'seek') postToPlayer({ action: 'seek', time });
    else postToPlayer({ action });
    send({ type: 'cmd', action, time });
  }

  function react(emoji) {
    if (Date.now() - s.lastReactAt < 250) return;
    s.lastReactAt = Date.now();
    floatReaction(emoji, 'You');
    send({ type: 'react', emoji });
  }

  function start(name, title) {
    storage.set('sparkflix:party-name', name);
    s.pendingTitle = title;
    join(newCode(), name, { create: true });
  }

  async function join(code, name, { create = false } = {}) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) {
      showToast('Enter the 6-character party code');
      return;
    }
    // Joining (not starting): make sure the room exists, so a typo doesn't open an empty room
    if (!create) {
      try {
        const info = await (await fetch(`/api/party/${code}`)).json();
        if (!info.exists || !info.peers || info.peers.length === 0) {
          if (!s.code) {
            showLobby();
            el('party-code-input').value = code;
          }
          showToast(`No party is running with code ${code}. Check the code, or start your own.`);
          return;
        }
      } catch (_) {
        showToast('Could not reach the party server. Check your connection.');
        return;
      }
    }
    name = (name || defaultName()).trim().slice(0, 24) || defaultName();
    storage.set('sparkflix:party-name', name);
    connect(code, name);
    const url = new URL(location.href);
    url.searchParams.set('party', code);
    url.hash = 'party';
    history.replaceState({ view: 'party' }, '', url);
  }

  function leave() {
    disconnect();
    s.code = null;
    s.me = null;
    s.peers.clear();
    iframe().src = 'about:blank';
    const url = new URL(location.href);
    url.searchParams.delete('party');
    history.replaceState({ view: 'party' }, '', url.pathname + url.search + '#party');
    showLobby();
  }

  // ---------- rendering ----------
  function showRoom() {
    el('party-lobby').hidden = true;
    el('party-room').hidden = false;
    el('party-room-code').textContent = s.code;
  }

  function showLobby() {
    el('party-room').hidden = true;
    el('party-lobby').hidden = false;
    el('party-name-input').value = defaultName();
  }

  function renderPeople() {
    const box = el('party-avatars');
    box.innerHTML = '';
    const people = [...s.peers.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    people.slice(0, 6).forEach((p) => {
      const a = document.createElement('span');
      a.className = 'party-avatar';
      a.style.setProperty('--avatar', p.color);
      a.textContent = (p.name || '?').trim().charAt(0).toUpperCase();
      a.title = p.id === s.me?.id ? `${p.name} (you)` : p.name;
      box.appendChild(a);
    });
    if (people.length > 6) {
      const more = document.createElement('span');
      more.className = 'party-avatar more';
      more.textContent = `+${people.length - 6}`;
      box.appendChild(more);
    }
    el('party-peer-count').textContent = `${people.length} watching`;
  }

  function scrollFeed() {
    const feed = el('party-feed');
    feed.scrollTop = feed.scrollHeight;
  }

  function system(text) {
    const line = document.createElement('div');
    line.className = 'party-msg info';
    line.textContent = text;
    el('party-feed').appendChild(line);
    scrollFeed();
  }

  function chatLine(from, text, mine) {
    const line = document.createElement('div');
    line.className = `party-chat-line${mine ? ' mine' : ''}`;
    const av = document.createElement('span');
    av.className = 'party-avatar sm';
    av.style.setProperty('--avatar', from.color || '#555');
    av.textContent = (from.name || '?').charAt(0).toUpperCase();
    const body = document.createElement('div');
    body.className = 'party-chat-body';
    const who = document.createElement('span');
    who.className = 'party-chat-name';
    who.textContent = mine ? 'You' : from.name;
    const msg = document.createElement('span');
    msg.className = 'party-chat-text';
    msg.textContent = text;
    body.append(who, msg);
    line.append(av, body);
    el('party-feed').appendChild(line);
    scrollFeed();
  }

  function floatReaction(emoji, name) {
    const layer = el('party-reaction-layer');
    if (!layer) return;
    const b = document.createElement('div');
    b.className = 'party-float';
    b.style.left = `${8 + Math.random() * 78}%`;
    b.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 60)}px`);
    const e = document.createElement('span');
    e.className = 'party-float-emoji';
    e.textContent = emoji;
    const n = document.createElement('span');
    n.className = 'party-float-name';
    n.textContent = name;
    b.append(e, n);
    layer.appendChild(b);
    setTimeout(() => b.remove(), 2800);
  }

  function updateBadge() {
    document.querySelectorAll('[data-nav="party"]').forEach((btn) => {
      let badge = btn.querySelector('.party-unread');
      if (!s.unread) {
        if (badge) badge.remove();
        return;
      }
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'party-unread';
        btn.appendChild(badge);
      }
      badge.textContent = s.unread > 9 ? '9+' : String(s.unread);
    });
  }

  // ---------- invite sheet ----------
  let qrLoading = null;
  function loadQrLib() {
    if (window.qrcode) return Promise.resolve();
    if (!qrLoading) {
      qrLoading = new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = QR_LIB;
        sc.onload = resolve;
        sc.onerror = reject;
        document.head.appendChild(sc);
      });
    }
    return qrLoading;
  }

  async function openInvite() {
    el('party-invite-code').textContent = s.code;
    el('party-invite-link').value = inviteUrl();
    el('party-share-btn').hidden = !navigator.share;
    el('party-invite-modal').hidden = false;
    const box = el('party-qr');
    box.innerHTML = '<span class="party-qr-loading">Generating QR…</span>';
    try {
      await loadQrLib();
      const qr = window.qrcode(0, 'M');
      qr.addData(inviteUrl());
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    } catch (_) {
      box.innerHTML = '<span class="party-qr-loading">QR unavailable offline — share the link instead</span>';
    }
  }

  // ---------- public API used by app.js ----------
  function onEnterView() {
    s.unread = 0;
    updateBadge();
    if (!s.code) showLobby();
  }

  /** "Open in Watch Party" from a title page */
  function watchTitle(title) {
    switchView('party');
    if (s.code) setTitle(title);
    else {
      // Pre-select this title in the "Start a party" card
      const picker = el('party-start-picker');
      const value = `${title.type}:${title.id}:${title.season}:${title.episode}:${title.label}`;
      let opt = [...picker.options].find((o) => o.value === value);
      if (!opt) {
        opt = new Option(title.label, value);
        picker.add(opt, 0);
      }
      picker.value = value;
      showToast(`Start a party to watch ${title.label} together`);
      el('party-name-input').focus();
    }
  }

  function init() {
    // Reaction bar
    const bar = el('party-reaction-bar');
    REACTIONS.forEach((emoji) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'party-react-btn';
      b.textContent = emoji;
      b.setAttribute('aria-label', `React ${emoji}`);
      b.addEventListener('click', () => react(emoji));
      bar.appendChild(b);
    });

    el('party-name-input').value = defaultName();

    el('party-start-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = el('party-name-input').value.trim() || defaultName();
      start(name, parseOption(el('party-start-picker').value));
    });
    el('party-join-form').addEventListener('submit', (e) => {
      e.preventDefault();
      join(el('party-code-input').value, el('party-name-input').value);
    });
    el('party-code-input').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    });

    el('party-title-picker').addEventListener('change', (e) => setTitle(parseOption(e.target.value)));
    el('party-invite-btn').addEventListener('click', openInvite);
    el('party-leave-btn').addEventListener('click', leave);

    document.querySelectorAll('[data-party-cmd]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmd = btn.dataset.partyCmd;
        if (cmd === 'play' || cmd === 'pause') command(cmd, s.playerTime);
        else if (cmd === 'back') command('seek', Math.max(0, s.playerTime - 10));
        else if (cmd === 'fwd') command('seek', s.playerTime + 10);
      });
    });

    el('party-chat-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = el('party-chat-input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      chatLine({ name: (s.me && s.me.name) || 'You', color: myColor() }, text, true);
      send({ type: 'chat', text });
    });

    // Invite sheet
    const modal = el('party-invite-modal');
    el('party-invite-close').addEventListener('click', () => (modal.hidden = true));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.hidden = true;
    });
    el('party-copy-link-btn').addEventListener('click', () => copyText(inviteUrl(), 'Invite link copied'));
    el('party-share-btn').addEventListener('click', () => {
      navigator
        .share({ title: 'Join my SparkFlix Watch Party', text: `Watch ${s.title ? s.title.label : 'with me'} on SparkFlix — code ${s.code}`, url: inviteUrl() })
        .catch(() => {});
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) modal.hidden = true;
    });

    // Invite link: /?party=CODE joins straight away (and skips the profile picker)
    const invited = new URLSearchParams(location.search).get('party');
    if (invited) {
      if (!el('profile-gate').hidden && state.profile) selectProfile(state.profile.id);
      switchView('party', { fromHistory: true });
      join(invited, defaultName());
    } else {
      showLobby();
    }
  }

  return { init, onEnterView, watchTitle, start, join, react, _state: s };
})();

document.addEventListener('DOMContentLoaded', Party.init);
