/**
 * SparkFlix Watch Party — real-time rooms over Server-Sent Events (no dependencies).
 *
 *   GET  /api/party/:code/events?peer=&name=&color=   → event stream for one viewer
 *   POST /api/party/:code/send   { peer, type, ... }   → broadcast to the room
 *   GET  /api/party/:code                              → room summary (exists? who's in it?)
 *
 * Message types sent by clients:
 *   cmd    { action: 'play' | 'pause' | 'seek', time }   synced playback
 *   title  { title: { type, id, season, episode, label } } change what the room is watching
 *   chat   { text }                                      chat message
 *   react  { emoji }                                     floating reaction
 *
 * The server remembers the room's current title and playback position, so someone
 * who joins late starts at the right moment instead of at 0:00.
 * Rooms live in memory: fine for a single Render instance; they vanish on restart.
 */
'use strict';

const MAX_ROOMS = 200;
const MAX_PEERS_PER_ROOM = 20;
const MAX_BODY_BYTES = 4096;
const CHAT_HISTORY = 40;
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 20 * 1000;
const REACTIONS = ['😂', '😮', '❤️', '🔥', '👏', '😱', '🍿', '😭'];

const CODE_RE = /^[A-Z0-9]{4,8}$/;
const PEER_RE = /^[a-z0-9]{6,16}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** @type {Map<string, Room>} */
const rooms = new Map();

function now() {
  return Date.now();
}

function cleanText(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);
}

function getRoom(code, create) {
  let room = rooms.get(code);
  if (!room && create) {
    if (rooms.size >= MAX_ROOMS) evictIdleRoom();
    room = {
      code,
      peers: new Map(),
      title: null,
      playback: { action: 'pause', time: 0, at: now() },
      chat: [],
      createdAt: now(),
      lastActive: now(),
      emptySince: now()
    };
    rooms.set(code, room);
  }
  return room;
}

function evictIdleRoom() {
  let oldest = null;
  for (const room of rooms.values()) {
    if (room.peers.size === 0 && (!oldest || room.lastActive < oldest.lastActive)) oldest = room;
  }
  if (oldest) rooms.delete(oldest.code);
}

function publicPeer(p) {
  return { id: p.id, name: p.name, color: p.color, joinedAt: p.joinedAt };
}

function roomSnapshot(room) {
  return {
    code: room.code,
    peers: [...room.peers.values()].map(publicPeer),
    title: room.title,
    playback: room.playback,
    chat: room.chat
  };
}

function write(res, payload) {
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch (_) {
    /* connection already gone; cleanup happens on 'close' */
  }
}

function broadcast(room, payload, exceptPeerId) {
  const msg = { ...payload, serverNow: now() };
  for (const peer of room.peers.values()) {
    if (peer.id !== exceptPeerId) write(peer.res, msg);
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (_) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function openStream(req, res, room, query) {
  const peerId = query.get('peer') || '';
  if (!PEER_RE.test(peerId)) return sendJson(res, 400, { error: 'Invalid peer id' });

  const existing = room.peers.get(peerId);
  if (!existing && room.peers.size >= MAX_PEERS_PER_ROOM) {
    return sendJson(res, 403, { error: 'This party is full' });
  }

  const name = cleanText(query.get('name'), 24) || 'Guest';
  const colorParam = query.get('color') || '';
  const color = COLOR_RE.test(colorParam) ? colorParam : '#E50914';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no' // stop proxies from buffering the stream
  });
  res.write('retry: 3000\n\n');

  // A reconnect (EventSource retries automatically) replaces the old connection quietly
  if (existing) {
    try {
      existing.res.end();
    } catch (_) {}
  }

  const peer = { id: peerId, name, color, res, joinedAt: existing ? existing.joinedAt : now() };
  room.peers.set(peerId, peer);
  room.lastActive = now();
  room.emptySince = null;

  write(res, { type: 'welcome', you: publicPeer(peer), room: roomSnapshot(room), serverNow: now() });
  if (!existing) broadcast(room, { type: 'join', peer: publicPeer(peer) }, peerId);

  req.on('close', () => {
    // Only remove if this exact connection is still the active one for the peer
    if (room.peers.get(peerId) && room.peers.get(peerId).res === res) {
      room.peers.delete(peerId);
      broadcast(room, { type: 'leave', peer: publicPeer(peer) });
      if (room.peers.size === 0) room.emptySince = now();
    }
  });
}

async function handleSend(req, res, room) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  const peer = room.peers.get(String(body.peer || ''));
  if (!peer) return sendJson(res, 403, { error: 'Join the party first' });

  // Simple flood protection: at most 8 messages per second per viewer
  const t = now();
  peer.window = (peer.window || []).filter((x) => t - x < 1000);
  if (peer.window.length >= 8) return sendJson(res, 429, { error: 'Slow down' });
  peer.window.push(t);
  room.lastActive = t;

  const from = publicPeer(peer);
  switch (body.type) {
    case 'cmd': {
      const action = ['play', 'pause', 'seek'].includes(body.action) ? body.action : null;
      const time = Math.max(0, Math.min(Number(body.time) || 0, 60 * 60 * 12));
      if (!action) return sendJson(res, 400, { error: 'Unknown action' });
      // A seek keeps the current play/pause state; play/pause update it
      const state = action === 'seek' ? room.playback.action : action;
      room.playback = { action: state, time, at: t };
      broadcast(room, { type: 'cmd', action, time, from }, peer.id);
      break;
    }
    case 'title': {
      const ti = body.title || {};
      const type = ti.type === 'tv' ? 'tv' : 'movie';
      const id = cleanText(ti.id, 20);
      if (!/^(tt)?\d+$/.test(id)) return sendJson(res, 400, { error: 'Invalid title id' });
      room.title = {
        type,
        id,
        season: Math.max(1, parseInt(ti.season, 10) || 1),
        episode: Math.max(1, parseInt(ti.episode, 10) || 1),
        label: cleanText(ti.label, 80) || 'Untitled'
      };
      room.playback = { action: 'pause', time: 0, at: t };
      broadcast(room, { type: 'title', title: room.title, from }, peer.id);
      break;
    }
    case 'chat': {
      const text = cleanText(body.text, 300);
      if (!text) return sendJson(res, 400, { error: 'Empty message' });
      const msg = { from, text, at: t };
      room.chat.push(msg);
      if (room.chat.length > CHAT_HISTORY) room.chat.shift();
      broadcast(room, { type: 'chat', ...msg }, peer.id);
      break;
    }
    case 'react': {
      if (!REACTIONS.includes(body.emoji)) return sendJson(res, 400, { error: 'Unknown reaction' });
      broadcast(room, { type: 'react', emoji: body.emoji, from }, peer.id);
      break;
    }
    default:
      return sendJson(res, 400, { error: 'Unknown message type' });
  }
  res.writeHead(204, { 'Cache-Control': 'no-store' });
  res.end();
}

/**
 * Route handler. Returns true when the request was a Watch Party request.
 */
function handlePartyRequest(req, res, pathname, query) {
  const m = pathname.match(/^\/api\/party\/([^/]+)(?:\/(events|send))?\/?$/);
  if (!m) return false;

  const code = decodeURIComponent(m[1]).toUpperCase();
  if (!CODE_RE.test(code)) {
    sendJson(res, 400, { error: 'Room codes are 4–8 letters or numbers' });
    return true;
  }

  const action = m[2];
  if (action === 'events' && req.method === 'GET') {
    openStream(req, res, getRoom(code, true), query);
  } else if (action === 'send' && req.method === 'POST') {
    const room = getRoom(code, false);
    if (!room) sendJson(res, 404, { error: 'Party not found' });
    else handleSend(req, res, room);
  } else if (!action && req.method === 'GET') {
    const room = getRoom(code, false);
    sendJson(res, 200, room ? { exists: true, ...roomSnapshot(room), chat: undefined } : { exists: false, code });
  } else {
    sendJson(res, 405, { error: 'Method not allowed' });
  }
  return true;
}

// Keep streams alive through proxies, and forget rooms that have been empty for a while
setInterval(() => {
  const t = now();
  for (const room of rooms.values()) {
    if (room.peers.size === 0 && room.emptySince && t - room.emptySince > EMPTY_ROOM_TTL_MS) {
      rooms.delete(room.code);
      continue;
    }
    for (const peer of room.peers.values()) {
      try {
        peer.res.write(': ping\n\n');
      } catch (_) {}
    }
  }
}, HEARTBEAT_MS).unref();

module.exports = { handlePartyRequest, REACTIONS, _rooms: rooms };
