/**
 * Live channel health checks.
 *
 * Every few minutes each channel is probed from the server:
 *   - HLS channels must answer 200 with a playlist that starts with "#EXTM3U"
 *   - embed-only channels must answer 200 without redirecting somewhere else
 * A channel with both counts as online if either check passes.
 * The client only ever sees channels that passed, so nobody lands on a black screen.
 */
'use strict';

const http = require('http');
const https = require('https');

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 6000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** url -> { ok: boolean, checkedAt: number } */
const results = new Map();
let inFlight = null;

function probe(url, { expectPlaylist }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      return done(false);
    }
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, timeout: PROBE_TIMEOUT_MS }, (res) => {
      // Redirects count as offline: dead embed pages bounce to a home page
      if (res.statusCode !== 200) {
        res.resume();
        return done(false);
      }
      if (!expectPlaylist) {
        res.resume();
        return done(true);
      }
      let head = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        head += chunk;
        if (head.length >= 16) {
          done(head.trimStart().startsWith('#EXTM3U'));
          req.destroy();
        }
      });
      res.on('end', () => done(head.trimStart().startsWith('#EXTM3U')));
    });
    req.on('timeout', () => {
      req.destroy();
      done(false);
    });
    req.on('error', () => done(false));
  });
}

async function checkChannel(ch) {
  const checks = [];
  if (ch.m3u8Url) checks.push(probe(ch.m3u8Url, { expectPlaylist: true }));
  if (ch.embedUrl) checks.push(probe(ch.embedUrl, { expectPlaylist: false }));
  if (!checks.length) return false;
  const outcomes = await Promise.all(checks);
  return outcomes.some(Boolean);
}

function keyFor(ch) {
  return ch.id || ch.m3u8Url || ch.embedUrl;
}

/** Probe all channels (one run at a time) and remember the results. */
function refresh(channels) {
  if (inFlight) return inFlight;
  inFlight = Promise.all(
    channels.map(async (ch) => {
      const ok = await checkChannel(ch);
      results.set(keyFor(ch), { ok, checkedAt: Date.now() });
    })
  ).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Returns the channels annotated with `online`, re-checking stale results first.
 * Results are reused for CHECK_INTERVAL_MS, so most requests return instantly.
 */
async function annotate(channels) {
  const stale = channels.some((ch) => {
    const r = results.get(keyFor(ch));
    return !r || Date.now() - r.checkedAt > CHECK_INTERVAL_MS;
  });
  if (stale) await refresh(channels);
  return channels.map((ch) => {
    const r = results.get(keyFor(ch));
    return { ...ch, online: r ? r.ok : false, checkedAt: r ? new Date(r.checkedAt).toISOString() : null };
  });
}

module.exports = { annotate, refresh, CHECK_INTERVAL_MS };
