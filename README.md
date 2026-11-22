# SparkFlix

A Netflix-style streaming web app, built as an installable **Progressive Web App** on top of the
**VidSpark Embed, `postMessage`, and Discovery APIs**. It is plain HTML, CSS and JavaScript with a
small Node.js server, and has no framework or build step.

SparkFlix does not host any video. Playback happens inside VidSpark's embeddable player (an `<iframe>`).
SparkFlix provides the browsing experience around it: catalog, search, profiles, My List,
Continue Watching, and synchronized Watch Parties.

## Quick start

Requires Node.js 18 or newer. There are no dependencies to install.

```bash
cd sparkflix
node server.js
```

Open **http://localhost:3000**. To try the Watch Party, start a party on one device and scan its QR code
with another (or open the invite link in a second browser).

---

## Standout features

### 1. Cross-device Watch Party
Watch the same title in sync with friends on **any phone or laptop**, not just tabs in one browser.
- **Start** a party (pick a name and a title) or **join** with a 6-character code. Invite friends with a
  **link, a QR code, or the phone's native share sheet**. Invite links open straight into the room.
- When anyone plays, pauses or skips, it happens for everyone, through the VidSpark `postMessage` API.
- **Late joiners catch up:** the server remembers the room's title and position, so someone joining
  mid-film starts at the right moment (via `?t=`), not at 0:00.
- **Live chat**, **floating emoji reactions** over the video, avatars of who's watching, join/leave
  notices, unread-message badges, and automatic reconnection.
- Built on **Server-Sent Events** with no external dependencies (`party.js` server, `public/party-client.js` client).

### 2. Personalised recommendations
Each profile gets its own **"Top picks for you"** and **"Because you watched …"** rows.
- First visit: tap a few genres under *What are you in the mood for?*. Rows appear instantly.
- SparkFlix then learns from behaviour: opening a title (weight 1), adding to My List (3) and pressing
  Play (4). Signals fade with a **two-week half-life**, so recent taste matters most.
- Candidates come from genre catalogs and are scored by **genre affinity + shared cast (×1.5) + shared
  director (×2) + rating**. The score is shown as a **"% match"**, and each row says why
  ("Because you like Sci-Fi & Comedy").
- The **Kids** profile only ever gets Family/Animation picks. Logic lives in `public/personal.js`.

### 3. Live TV that never shows a dead stream
The server **health-checks every channel every 5 minutes** (`health.js`): HLS streams must return a real
`#EXTM3U` playlist and embed players must load without redirecting. Only channels that pass are shown,
the player waits for the checked list before autoplaying, and if a stream drops mid-watch an
**offline panel** offers "Try another channel" instead of a black screen.

### 4. Football: live scores + official highlights
On the Live TV page (`football.js` server, `public/football-client.js` client):
- **Live scores** for the Premier League, LaLiga, Champions League, Serie A, Bundesliga, Ligue 1 and
  Europa League, with Yesterday / Today / Tomorrow tabs, league filters, club crests, kickoff times in
  the viewer's own time zone, and a pulsing **LIVE 67'** badge. Scores refresh every 30 s while a match is
  live, but only while the page is open and the tab is visible. Data: ESPN's public scoreboard feed
  (no API key), cached on the server (25 s while live, 5 min otherwise).
- **Official match highlights** from league and rights-holder YouTube channels (LALIGA, Serie A,
  TNT Sports, CBS Sports Golazo, ESPN FC), read from their public RSS feeds. The server keeps only
  real highlight videos (no Shorts or live streams) that the owners allow to be embedded.
- **Finished matches link to their highlights:** when an official video exists for a result, its score
  card gets a **▶ Highlights** button.
- **Region-aware player:** highlights use the YouTube IFrame Player API. If a video is blocked in the
  viewer's country, SparkFlix shows "This video can't play here" with **Play another highlight**, and
  hides that video for this viewer from then on.

---

## Features

### The Netflix experience
| Feature | Details |
|---|---|
| **"Who's watching?" profiles** | Four profiles. Each one has its own My List and Continue Watching (stored in `localStorage` under per-profile keys). |
| **Billboard hero** | Auto-rotating spotlight with full-bleed artwork and official title logos. Synopsis and genres are fetched live. It pauses while a title is open or the tab is hidden. |
| **Content rows** | Top 10 (with rank numbers), Featured, TV Shows, and Recently Added. Rows load **in parallel**, show skeleton loaders, and offer a Retry button if a request fails. On desktop there are ‹ › arrows; on touch devices you swipe. |
| **Title details page** | Opens with artwork and a Play button, and only loads the player when you press Play. Shows IMDb rating, runtime, cast, genres, and a full episode list with synopses for series. |
| **Continue Watching** | Built from real playback telemetry. It resumes where you stopped, shows time remaining, and removes titles once finished. |
| **My List** | Add or remove from the hero, the details page, or any card. Persists per profile. |
| **Search** | Live title search (debounced, minimum 3 characters). Pasting a **TMDB ID** (`1148365`) or **IMDb ID** (`tt28498219`) and pressing **Enter** opens that title directly. |
| **Header** | Transparent over the billboard, turns solid when you scroll. Mobile has category pills and a bottom tab bar. |
| **Routing** | Every page has a URL (`#discover`, `#mylist`, …), so the browser **Back** button works. Deep links: `/?play=<id>`, `/?tab=discover`. |
| **Theme colour** | Six presets or any hex value. It re-colours the UI and is passed to the player as `?theme=`. |

### VidSpark API coverage
| Doc section | Where it's used |
|---|---|
| **01/02 Movie & TV embeds** | `buildVidSparkEmbedUrl()` in `app.js`. Supports `/movie/$id`, `/tv/$id/$s/$e`, and the hyphen form `/tv/$id-$s-$e`, with TMDB **or** IMDb IDs (toggle under *Player options*). |
| **03 Player parameters** | `?t=90` for plain seconds, `?startAt=1h5m30s` for compound durations, `?theme=HEX`. Auto-resume uses `?t=`. |
| **04 `postMessage` API** | The listener filters on `e.data?.source === 'vidspark-player'` and checks `e.source`, so each player's events go to the right place. The remote control bar sends `togglePlay`, `seek`, `mute`/`unmute`, `setVolume`, `setSpeed`, `enterFullscreen`, `getStatus`. |
| **04 Watch Party sync** | `public/party-client.js` turns local player events (`play`, `pause`, `seeked`) into room messages, and applies other viewers' actions with `play` / `pause` / `seek` commands. Commands are sent only to the `https://vidspark.to` origin, and only messages from that origin and our own iframe are trusted. |
| **05 Discovery API** | `/api/discover/movies`, `/tv`, `/views` with `page`, `resultsPerPage`, `ordering`, `direction`, `year`, `query`, `slider`, `featured`, `views`, `type`, `tmdbid`, `imdb_id`. On the **Discover** page, the **API filters** panel shows the exact request URL. |

### PWA
- `manifest.json` with app shortcuts, plus iOS/Android standalone meta tags. Installable from the **Install** button.
- `sw.js` pre-caches the app shell, so the UI opens offline. It is **network-first** for the app's own files, so users always get the latest version when online.
- If the Discovery API is unreachable, the app falls back to a built-in catalog so the UI never shows up empty.

---

## Architecture

```
Browser (public/)                              Node server                         Upstream
┌─────────────────────────────┐  /api/discover/*   ┌──────────────────────────┐   ┌───────────────────────┐
│ app.js         – core UI    │ ─────────────────▶ │ server.js  proxy + cache │──▶│ vidspark.to Discovery │
│ personal.js    – for-you    │  /api/meta, /api/catalog                      │   └───────────────────────┘
│ party-client.js– watch party│ ─────────────────▶ │            proxy + cache │──▶ Cinemeta (metadata, genres)
│ welcome.js     – onboarding │  /api/party/* (SSE)│ party.js   rooms in RAM  │
│ sw.js          – offline    │ ◀════════════════▶ │                          │
└──────────┬──────────────────┘  /api/live/channels│ health.js  5-min checks  │──▶ 24/7 live HLS broadcasters
           │                                       └──────────────────────────┘
           │ <iframe src="https://vidspark.to/movie/…">   ◀── postMessage events / commands ──▶
```

**Watch Party protocol.** Each viewer keeps one Server-Sent Events stream open
(`GET /api/party/:code/events`) and sends actions with `POST /api/party/:code/send`
(`cmd`, `title`, `chat`, `react`). The server validates every message: room codes, ids and
reaction types are checked, text is length-limited, and each viewer is limited to 8 messages
per second. It broadcasts each message to the rest of the room.

**Why a server proxy?** It avoids browser CORS problems, caches responses for fast reloads, and
gives the app one origin to talk to. If the app is hosted as static files with no server, `app.js`
falls back to calling the VidSpark API directly.

### Engineering notes
- **Security:** every API-supplied string is HTML-escaped (`escapeHtml`) before insertion, which prevents XSS from catalog data. The static server blocks path traversal.
- **Watch Party echo guard:** applying a friend's "play" makes our own player emit a "play" event. Without a guard that event would be re-broadcast forever between devices. The client ignores its own player's events for 1.5 s after applying a remote command.
- **Clock-skew-safe catch-up:** every server message carries `serverNow`, so late joiners and play commands correct for network delay and device clock differences.
- **Never cache streams:** the service worker skips `/api/party/` and `text/event-stream` requests, because caching an endless stream would hang.
- **Tested end-to-end:** the server suite drives two simulated viewers through a room (presence, chat, sync, late join, validation, flood limits); a browser suite runs two separate browsers as two devices joining through an invite link.
- **Race-safe search:** each Discover request gets an ID, and stale responses from earlier keystrokes are dropped.
- **Telemetry throttling:** `timeupdate` fires several times per second. Progress is saved every 10 s, plus immediately on pause, seek and end.
- **Accessibility:** keyboard-operable cards (Enter/Space), `Esc` closes overlays, focus returns to where you were, visible focus rings, `aria-live` toasts, and `prefers-reduced-motion` support.

## File overview
| File | Purpose |
|---|---|
| `server.js` | Static file server, API proxies, response cache, `/healthz` |
| `party.js` | Watch Party rooms over Server-Sent Events |
| `health.js` | Live channel health checks |
| `football.js` | Live scores + official highlights API (cached) |
| `public/football-client.js`, `football.css` | Scores panel, highlights row, highlight player |
| `public/index.html` | Page structure for all views and overlays |
| `public/app.js` | State, data fetching, rendering, player, profiles, Live TV |
| `public/party-client.js` | Watch Party client: rooms, sync, chat, reactions, invites/QR |
| `public/personal.js` | Taste profile and recommendation scoring |
| `public/welcome.js` | First-visit welcome sheet |
| `public/styles.css`, `ux.css`, `party.css` | Mobile-first responsive design |
| `public/sw.js` | Service worker (offline app shell) |
| `public/manifest.json` | PWA manifest |
