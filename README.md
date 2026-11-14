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

Open **http://localhost:3000**. To try the Watch Party, open the app in two tabs.

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
| **04 `WatchPartyController`** | Syncs play/pause/seek between tabs via `BroadcastChannel`. Also has chat, join/leave presence, a live viewer count, and shared title changes. |
| **05 Discovery API** | `/api/discover/movies`, `/tv`, `/views` with `page`, `resultsPerPage`, `ordering`, `direction`, `year`, `query`, `slider`, `featured`, `views`, `type`, `tmdbid`, `imdb_id`. On the **Discover** page, the **API filters** panel shows the exact request URL. |

### PWA
- `manifest.json` with app shortcuts, plus iOS/Android standalone meta tags. Installable from the **Install** button.
- `sw.js` pre-caches the app shell, so the UI opens offline. It is **network-first** for the app's own files, so users always get the latest version when online.
- If the Discovery API is unreachable, the app falls back to a built-in catalog so the UI never shows up empty.

---

## Architecture

```
Browser (public/)                          Node server (server.js)              Upstream
┌──────────────────────────┐   /api/discover/*   ┌───────────────────────┐   ┌──────────────────────┐
│ index.html  – layout     │ ──────────────────▶ │ proxy + 10-min cache  │──▶│ vidspark.to Discovery │
│ styles.css  – design     │   /api/meta/:t/:id  │                       │   └──────────────────────┘
│ app.js      – all logic  │ ──────────────────▶ │ proxy + 10-min cache  │──▶ Cinemeta (metadata)
│ sw.js       – offline    │                     │ static files + SPA    │
└──────────┬───────────────┘                     └───────────────────────┘
           │ <iframe src="https://vidspark.to/movie/…">   ◀── postMessage events / commands ──▶
```

**Why a server proxy?** It avoids browser CORS problems, caches responses for fast reloads, and
gives the app one origin to talk to. If the app is hosted as static files with no server, `app.js`
falls back to calling the VidSpark API directly.

### Engineering notes
- **Security:** every API-supplied string is HTML-escaped (`escapeHtml`) before insertion, which prevents XSS from catalog data. The static server blocks path traversal.
- **Watch Party echo guard:** applying a peer's "play" makes our own player emit a "play" event. Without a guard that event would be re-broadcast forever between tabs. The controller ignores its own player's events for 1.5 s after applying a remote command.
- **Race-safe search:** each Discover request gets an ID, and stale responses from earlier keystrokes are dropped.
- **Telemetry throttling:** `timeupdate` fires several times per second. Progress is saved every 10 s, plus immediately on pause, seek and end.
- **Accessibility:** keyboard-operable cards (Enter/Space), `Esc` closes overlays, focus returns to where you were, visible focus rings, `aria-live` toasts, and `prefers-reduced-motion` support.

## File overview
| File | Purpose |
|---|---|
| `server.js` | Static file server, API proxies, response cache |
| `public/index.html` | Page structure for all views and overlays |
| `public/app.js` | State, data fetching, rendering, player, Watch Party, profiles |
| `public/styles.css` | Mobile-first responsive design |
| `public/sw.js` | Service worker (offline app shell) |
| `public/manifest.json` | PWA manifest |
