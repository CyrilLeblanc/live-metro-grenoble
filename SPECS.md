# Project Specification — Grenoble Tram Interactive Map

## Context

A web application displaying near-real-time estimated positions of trams on the TAG network (Grenoble), using the public Métromobilité API (`data.mobilites-m.fr`).

No raw GPS data is available: positions are **interpolated** between two stops based on real-time schedule data.

---

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router)
- **Map**: [Leaflet.js](https://leafletjs.com/) via `react-leaflet` (dynamically imported with `ssr: false`)
- **API calls**: via **Next.js Route Handlers** (`app/api/...`) — all calls to the Métromobilité API are made server-side, bypassing CORS entirely
- **Static GTFS data**: parsed via a Node.js script, stored as JSON in `/public/gtfs/`
- **API documentation**: [https://www.mobilites-m.fr/pages/opendata/OpenDataApi.html](https://www.mobilites-m.fr/pages/opendata/OpenDataApi.html)

---

## Data Sources

### Static GTFS
Download URL: `https://data.mobilites-m.fr/api/gtfs/TPV`

Files to parse (via `scripts/parse-gtfs.js`) and output as JSON into `/public/gtfs/`:
- `routes.txt` → tram lines list (filter `route_type = 0`)
- `stops.txt` → GPS coordinates for each stop
- `trips.txt` → trip_id ↔ route_id ↔ shape_id mapping
- `stop_times.txt` → theoretical schedules per trip and stop (sequence + time)
- `shapes.txt` → exact geometry of each line's path
- `calendar.txt` / `calendar_dates.txt` → active service days

### Real-time API
Full documentation: [https://www.mobilites-m.fr/pages/opendata/OpenDataApi.html](https://www.mobilites-m.fr/pages/opendata/OpenDataApi.html)

Main endpoint — schedules by stop:
```
GET http://data.mobilites-m.fr/api/routers/default/index/clusters/{STOP_ID}/stoptimes
```
Returns upcoming departures (real-time if available, theoretical otherwise), with a `realtime: true/false` field.

---

## Project Structure

```
/
├── app/
│   ├── page.tsx                        # main page, renders the map
│   ├── layout.tsx
│   └── api/
│       └── stoptimes/
│           └── route.ts                # Route Handler — proxy to Métromobilité API (solves CORS)
│               # GET /api/stoptimes?stopId=SEM:XXXXX
│               # → fetch("http://data.mobilites-m.fr/api/routers/default/index/clusters/{stopId}/stoptimes")
│               # → returns JSON to the client
├── components/
│   ├── TramMap.tsx                     # Leaflet map component (dynamically imported, ssr:false)
│   ├── TramMarker.tsx                  # tram marker with interpolated position
│   └── StopMarker.tsx                  # stop marker
├── lib/
│   ├── gtfs.ts                         # loading and typing of static GTFS data
│   ├── interpolator.ts                 # position calculation logic between two stops
│   └── api.ts                          # client-side calls to /api/stoptimes
├── public/
│   └── gtfs/                           # pre-parsed JSON from static GTFS
│       ├── stops.json
│       ├── shapes.json
│       ├── routes.json
│       ├── trips.json
│       └── stop_times.json
└── scripts/
    └── parse-gtfs.js                   # downloads + parses the GTFS zip → outputs /public/gtfs/*.json
```

---

## Data Flow

```
[scripts/parse-gtfs.js]  ← re-run manually when the transit plan changes
    → downloads data.mobilites-m.fr/api/gtfs/TPV
    → extracts stops, shapes, routes, trips, stop_times
    → writes /public/gtfs/*.json

[On page load]
    → fetch /public/gtfs/*.json  (static data)
    → initializes Leaflet map with line shapes and stops

[Every 30 seconds]
    → for each stop on each tram line:
        client → GET /api/stoptimes?stopId=...
        Route Handler → fetch Métromobilité API (server-side, no CORS)
        → returns upcoming departures to the client
    → interpolator.ts computes each tram's current position
    → TramMarkers updated on the map
```

---

## Interpolation Logic (detail)

```
Inputs:
- Current time T
- Stop A (coordinates, scheduled arrival time T_A)
- Stop B (coordinates, scheduled arrival time T_B)

Condition: T_A <= T <= T_B

Calculation:
  ratio = (T - T_A) / (T_B - T_A)   // between 0 and 1
  lat   = A.lat + ratio * (B.lat - A.lat)
  lng   = A.lng + ratio * (B.lng - A.lng)
```

If shape data is available: project the ratio onto the shape polyline instead of the direct stop-to-stop segment (better accuracy around curves).

---

## MVP Features

1. **Leaflet map** centered on Grenoble with OpenStreetMap tiles
2. **Tram line shapes** (A, B, C, D, E) displayed in distinct colors, from GTFS shapes
3. **Stop markers** displayed as small dots on each line
4. **Interpolated tram positions** refreshed every 30 seconds
5. **Click tooltip** on a tram: line, direction, next stop, estimated arrival time, real-time vs theoretical indicator

### Out of scope for MVP
- Bus display
- Alerts / disruptions
- Trip planner
- PWA / native mobile

---

## Known Constraints (document in code)

- The API provides no raw GPS position for vehicles — position is an **interpolated estimate**
- The official TAG GTFS-RT feed was discontinued by Métromobilité (data was too incomplete and unreliable)
- Schedules may be theoretical (`realtime: false`) — reflect this visually on the marker
- Static GTFS data must be re-parsed periodically as the transit plan changes — re-run `scripts/parse-gtfs.js`
- `react-leaflet` must be imported with `dynamic(..., { ssr: false })` — Leaflet depends on `window` and is not SSR-compatible

---

## Deliverables

- [ ] Working Next.js app (`npm run dev`)
- [ ] Documented and functional `scripts/parse-gtfs.js`
- [ ] README with setup instructions: run the GTFS script first, then start the dev server