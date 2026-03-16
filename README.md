# LiveMetro - Grenoble

A live map of Grenoble's tram network.

## Overview

Interactive Leaflet map showing live tram positions for lines A–E. Because Métropole de Grenoble discontinued its GTFS-RT feed, there is no GPS source available. Positions are **interpolated** between scheduled stops using departure/arrival times from the static GTFS timetable. When shape polylines are present, interpolation follows the actual track geometry; otherwise it falls back to linear (straight-line) interpolation.

Between API refreshes (~10s), tram markers are animated client-side: each tram continues moving from its current animated position along the path at an estimated speed. If GPS speed graphs are available for a segment (contributed by users on board), animation uses the averaged real-world speed profile instead of a flat estimate.

## How it works

### Tram position pipeline

```
Métromobilité API (stop-time departures)
  → /api/trams  (server, every 10 s)
    → for each active stop cluster: fetch upcoming departures
    → for each departure: find the tram's current position on its GTFS shape
    → return { lat, lng, eta, shapePath, stopAId, stopBId, … } per tram
  → usePolling  (client)
    → feeds TramPosition objects into useAnimatedTrams
```

### Position interpolation (`lib/interpolator.ts`)

Each tram is known to be between **stop A** (just departed) and **stop B** (next stop, arriving in `eta` seconds). The server uses the GTFS shape polyline to find where along the path the tram should be right now:

1. Build the cumulative length array for the shape segment between A and B
2. Compute `ratio = elapsed / totalDuration` (0 = just left A, 1 = arrived at B)
3. Walk the polyline to the point at `ratio × totalLength`

This gives a lat/lng on the actual track geometry, not a straight-line guess.

### Client-side animation (`hooks/useAnimatedTrams.ts`)

The API only updates every 10 seconds. Between updates, trams are animated at ~60 fps using `requestAnimationFrame`:

1. On each API update, record the tram's position on the path as `progressMeters` and the estimated speed (derived from displacement between consecutive API positions)
2. Each frame: advance `progressMeters += speedMs × dt`
3. Near the next stop (within the last few seconds of `eta`), apply a linear deceleration factor so trams don't overshoot

Speed source priority (highest wins):
1. **Live GPS override** — if the current user confirmed they're on that tram
2. **Averaged segment graph** — community speed recordings for that stop pair
3. **API-estimated speed** — displacement ÷ elapsed time between the last two poll responses

### GPS speed recording (`hooks/useUserOnTram.ts`)

When a user confirms they're on a tram, the app opens a **segment buffer**:

- Every GPS fix appends `{ tSec, speedMs }` where `tSec` = seconds remaining until the next stop (i.e. the API's `eta` at confirmation minus elapsed time since confirmation)
- `speedMs` is an EWMA-smoothed speed computed over a 10-second rolling GPS window
- When the tram crosses a stop (its API ID changes), the buffer is finalised: points are reversed to ascending `tSec` order and POSTed to `/api/segment-speeds`

Recording `tSec` as "seconds until stop B" ensures recordings made mid-segment (user boards partway through) are correctly anchored — they start near the actual remaining time rather than at zero.

### Segment speed averaging (`lib/segmentSpeeds.ts`)

Up to 10 recordings per stop pair are kept on disk (JSONL). On each GET request the server:

1. Reads all recordings for the requested segment keys
2. Grids each recording onto a 2-second time axis (0 → `totalDurationSec`)
3. Averages the speed values across recordings at each grid point
4. Returns the averaged `[{ tSec, speedMs }]` array

The animation hook then calls `interpolateSpeed(graph.points, currentEta)` to look up the expected speed at the tram's current position in the segment.

## Prerequisites

- Node.js v24 (see `.nvmrc`; use [nvm](https://github.com/nvm-sh/nvm) if needed)
- npm (bundled with Node)
- Internet access (GTFS download + live API calls)

## Installation

```bash
git clone <repo-url>
cd metro-viewer
npm install
```

## Step 1 — Generate static GTFS data (required before first run)

> **The app will not work without this step.** `public/gtfs/` is git-ignored and must be generated locally.

```bash
npm run parse-gtfs
# or: node scripts/parse-gtfs.js
```

This script:
- Downloads the GTFS ZIP from `data.mobilites-m.fr/api/gtfs/SEM`
- Extracts and filters tram routes (route_type 0)
- Writes 5 JSON files to `public/gtfs/`

Re-run this command whenever Métromobilité publishes an updated timetable.

## Step 2 — Start the dev server

```bash
npm run dev
# Open http://localhost:3000
```

## Production build

```bash
npm run build
npm start
```

## Updating GTFS data

Re-run `npm run parse-gtfs` whenever the timetable changes. The script overwrites the existing files in `public/gtfs/`.

## Server-side caching

All upstream Métromobilité API calls are cached server-side so that load scales with time, not user count.

### Tram positions (`/api/trams`)

The most expensive endpoint: it fans out to every active stop cluster in parallel on each call. The result is cached in memory for **10 seconds**. All users polling within the same window share a single upstream fetch. Concurrent requests during a cache miss are deduplicated — only one fan-out is issued; the others await its result.

### Stop times (`/api/stoptimes`)

Responses are cached per stop ID in memory for **10 seconds**. Multiple users clicking the same stop within that window share one upstream call.

### Map tiles (`/api/tiles`)

Map tiles are not fetched directly by the browser. Instead the frontend requests
tiles from `/api/tiles/{z}/{x}/{y}.png`, which:

1. Checks `.cache/tiles/{z}/{x}/{y}.png` for a cached copy less than 30 days old
2. If found: serves the cached file immediately
3. If not found or expired: fetches the tile from `data.mobilites-m.fr/carte-dark`
   (Métromobilité's dark-themed map, based on OpenStreetMap data), writes it to
   `.cache/` in the background, and streams the response

The `.cache/` directory is git-ignored and created automatically on first use. Cached
tiles persist across server restarts. Re-deploying the app to a new machine will start
with an empty cache; tiles are re-fetched on demand.

### GTFS static data

The GTFS index (stops, trips, routes, stop times, shapes) is loaded from disk once per server process and held in memory for the lifetime of the process.

## "I'm on a tram" — GPS speed graphs

Users can opt in to GPS tracking by tapping **"I'm on a tram"** in the bottom-left corner. The app uses `navigator.geolocation.watchPosition` to:

1. Detect nearby trams (within 80 m) and ask the user to confirm which one they're on
2. Record a speed graph `[{tSec, speedMs}]` as the tram travels from one stop to the next
3. POST the graph to `POST /api/segment-speeds` when the tram crosses a stop (its API ID changes) or the user exits

Graphs are stored in `data/segment-speeds/` (one JSON file per stop pair, gitignored). Up to the last 10 traversals are kept per segment and averaged onto a 2-second time grid. All users viewing the same segment — including those without GPS — benefit from the averaged profile via `GET /api/segment-speeds?keys=...`.

The animation hook prefers speed sources in this order:
1. GPS override from the current user (if confirmed on that tram)
2. Averaged segment graph (from past GPS recordings)
3. API-estimated speed (distance delta between the last two poll responses)

## Passive speed contribution (opt-in)

In the settings panel (gear icon ⚙, bottom-left of the map), users can enable **passive contribution**. Once active, the app silently collects GPS fixes and accelerometer data — no further interaction required. When the app detects that a tram journey has ended (the user moves away from all GTFS track geometry for more than 30 seconds), it runs a post-hoc matching algorithm:

1. Compute per-point GPS speed (5-second sliding window of haversine distances)
2. Associate each GPS point to the nearest tram stop (within 50 m)
3. Reconstruct the ordered stop sequence and validate each consecutive pair against known GTFS segments
4. For each valid segment: validate duration (≤ 180 s), point count (≥ 10), mean speed (> 1.67 m/s) and absence of walking signature
5. Submit each valid segment to `POST /api/segment-speeds`

**Accelerometer**: a 2-second sliding variance window on the horizontal axes (X/Y) distinguishes stopped / moving / uncertain states. Walking is detected by counting Z-axis peaks in the 1.5–2.5 Hz range and excluded from contributions even when GPS speed looks tram-like. On iOS 13+, `DeviceMotionEvent.requestPermission()` is prompted on the first toggle-on. If denied, the system falls back to GPS-only detection with a subtle warning shown in the panel.

**Temporal decay**: `getAveragedGraph` weights each recording by `e^{−0.01 × age_days}` (half-life ≈ 70 days), so the system naturally adapts if commercial speeds change over time.

**Outlier filtering**: the backend rejects a new recording whose mean speed deviates more than 2.5 standard deviations from the existing distribution for that segment (HTTP 422), preventing corrupt data from distorting the averaged profile.

The passive system feeds the same `data/segment-speeds/` store as the explicit "I'm on a tram" flow, and benefits all users viewing those segments.

## Known limitations

- **Positions are estimates** — no raw GPS signal; positions are interpolated between scheduled stops
- **GTFS-RT discontinued** — Métropole no longer publishes a real-time vehicle feed; most positions are theoretical
- Markers show "Live" (green) when the API returns real-time departure data, "Theoretical" (grey) otherwise
- Positions refresh every 10 seconds; a countdown timer and manual refresh button are shown in the top-right corner
- Tram markers are directional arrows rotated by bearing; opacity is reduced for theoretical positions
- Clicking a stop opens a side panel listing upcoming departures for that stop

## Project structure

```
app/
  page.tsx                          Entry point — renders TramMapLoader
  layout.tsx                        Root layout + metadata
  api/stoptimes/route.ts            Proxy for Métromobilité API (CORS bypass)
  api/trams/route.ts                Server-side tram position computation (GTFS index + interpolation)
  api/tiles/[...path]/route.ts      Tile proxy (data.mobilites-m.fr dark map) with 30-day filesystem cache
  api/segment-speeds/route.ts       GET + POST for GPS-derived speed graphs per stop-to-stop segment
components/
  TramMap.tsx                       Core map: fetches tram positions, wires GPS tracking, renders map
  TramMapLoader.tsx                 Dynamic import wrapper (ssr: false — Leaflet needs window)
  StopMarker.tsx                    Stop circle marker (unified purple colour)
  StopDeparturePanel.tsx            Side panel showing next departures for a selected stop
  CanvasTramLayer.tsx               Canvas-based tram marker layer
  OnTramOverlay.tsx                 Fixed overlay: idle / searching / confirm / active GPS states
  SettingsPanel.tsx                 Gear-icon toggle for passive tracking opt-in; contribution toast
hooks/
  useAnimatedTrams.ts               rAF animation loop; accepts segment graphs + speed overrides
  useGtfsData.ts                    Loads and transforms all five GTFS files; builds shapes, stops, colour maps
  usePolling.ts                     Manages 10-second tram position polling cycle with countdown timer
  useUserOnTram.ts                  GPS tracking, EWMA speed, segment buffer, auto-POST on stop crossing
  usePassiveTracking.ts             Passive GPS+accel collection, post-hoc trip matching, auto-submission
lib/
  config.ts                         Centralised constants (viewport bounds, animation, GPS, polling thresholds)
  gtfs.ts                           Loads & caches public/gtfs/*.json
  interpolator.ts                   Time-based position interpolation along shape polylines
  pathUtils.ts                      Path geometry utilities: cumulative lengths, progress interpolation, bearing
  speedUtils.ts                     Linear speed interpolation for GPS-derived speed graphs
  api.ts                            Client fetch wrapper for /api/stoptimes
  geo.ts                            haversineDistance, makeSegmentKey, AveragedGraph type
  segmentSpeeds.ts                  Server-only: file I/O for speed graph records, averaging logic
scripts/
  parse-gtfs.js                     Downloads GTFS and writes public/gtfs/ JSON files
public/gtfs/                        Pre-parsed static data (git-ignored; must be generated)
  routes.json                       Tram line definitions
  stops.json                        Stop locations
  trips.json                        Trip → route/shape mapping
  stop_times.json                   Scheduled arrivals/departures (tram only)
  shapes.json                       Polyline geometry for each shape_id
data/segment-speeds/                GPS speed graph records per segment (git-ignored; created on first POST)
```
