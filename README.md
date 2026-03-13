# LiveMetro - Grenoble

A live map of Grenoble's tram network.

## Overview

Interactive Leaflet map showing live tram positions for lines A–E. Because Métropole de Grenoble discontinued its GTFS-RT feed, there is no GPS source available. Positions are **interpolated** between scheduled stops using departure/arrival times from the static GTFS timetable. When shape polylines are present, interpolation follows the actual track geometry; otherwise it falls back to linear (straight-line) interpolation.

Between API refreshes (~10s), tram markers are animated client-side: each tram continues moving from its current animated position along the path at an estimated speed. If GPS speed graphs are available for a segment (contributed by users on board), animation uses the averaged real-world speed profile instead of a flat estimate.

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

## Tile proxy & cache

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
hooks/
  useAnimatedTrams.ts               rAF animation loop; accepts segment graphs + speed overrides
  useGtfsData.ts                    Loads and transforms all five GTFS files; builds shapes, stops, colour maps
  usePolling.ts                     Manages 10-second tram position polling cycle with countdown timer
  useUserOnTram.ts                  GPS tracking, EWMA speed, segment buffer, auto-POST on stop crossing
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
