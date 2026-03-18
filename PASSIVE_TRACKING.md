# Passive Tram Tracking — Technical Reference

## Overview

The passive tracking system lets users contribute real-world tram speed data without any interaction beyond an initial opt-in toggle. Once enabled, the app silently collects GPS fixes and accelerometer samples in the background. When a tram trip is detected and validated post-hoc, speed data is automatically submitted to the same API endpoint used by the explicit "I'm on a tram" flow.

The two systems are fully independent and can run simultaneously. Passive tracking reads `rawStops` and `segmentPaths` from the already-loaded GTFS data; it never makes additional network requests for configuration.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  SettingsPanel.tsx                                       │
│  • gear icon button (bottom-left)                        │
│  • toggle persisted to localStorage                      │
│  • iOS DeviceMotion permission on first toggle-ON        │
│  • contribution toast (3 s, foreground-only)             │
└────────────────────┬─────────────────────────────────────┘
                     │ enabled / setEnabled
                     │ lastContributedCount / clearContributedCount
┌────────────────────▼─────────────────────────────────────┐
│  hooks/usePassiveTracking.ts                             │
│                                                          │
│  Sensors                                                 │
│  ├── navigator.geolocation.watchPosition  (GPS)          │
│  └── window.devicemotion                 (accelerometer) │
│                                                          │
│  State machine                                           │
│  IDLE ──► COLLECTING ──► WAITING_END ──► IDLE            │
│                ▲               │                         │
│                └───────────────┘  (back on line)         │
│                                                          │
│  On trip end: runPostHocMatching()                       │
│  └── POST /api/segment-speeds  (one call per segment)    │
└────────────────────┬─────────────────────────────────────┘
                     │ rawStops, segmentPaths
┌────────────────────▼─────────────────────────────────────┐
│  hooks/useGtfsData.ts                                    │
│  • rawStops: Stop[]          ← individual platforms      │
│  • segmentPaths: Map<key, LatLng[]>                      │
└──────────────────────────────────────────────────────────┘
                     │ POST
┌────────────────────▼─────────────────────────────────────┐
│  app/api/segment-speeds/route.ts                         │
│  • coherence checks (duration, points, movement)         │
│  • outlier z-score check (|z| > 2.5 → HTTP 422)         │
│  └── appendSpeedGraph()                                  │
└────────────────────┬─────────────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────────────┐
│  lib/segmentSpeeds.ts                                    │
│  • data/segment-speeds/{key}.json  (≤ 10 records each)   │
│  • getAveragedGraph: temporal decay w = e^(-0.01*days)   │
└──────────────────────────────────────────────────────────┘
```

---

## Module Reference

### `hooks/usePassiveTracking.ts`

**Signature**
```ts
function usePassiveTracking(
  rawStops: Stop[],
  segmentPaths: Map<string, LatLng[]>,
  dataLoaded: boolean,
): {
  enabled: boolean
  setEnabled: (v: boolean) => void
  lastContributedCount: number
  clearContributedCount: () => void
}
```

**Responsibilities**
- Read and write `localStorage.passive_tracking_enabled`
- Open/close `watchPosition` and `devicemotion` listeners when enabled changes
- Implement the IDLE → COLLECTING → WAITING_END trip state machine
- Save the raw trace to `sessionStorage` on every fix (throttled to 1 write/s) and restore it on page reload
- Run post-hoc matching when a trip ends; submit valid segments
- Expose `lastContributedCount` for the toast in `SettingsPanel`

**Does NOT**
- Render any UI
- Manage DeviceMotion permission (that is the responsibility of `SettingsPanel`)
- Make any decisions about which trams are currently running

---

### `components/SettingsPanel.tsx`

**Props**
```ts
{
  enabled: boolean
  setEnabled: (v: boolean) => void
  lastContributedCount: number
  clearContributedCount: () => void
}
```

**Responsibilities**
- Render the gear icon and the settings overlay
- Call `DeviceMotionEvent.requestPermission()` on iOS when the toggle is switched ON (must be from a user gesture)
- Display "Précision réduite sans accéléromètre" if permission is denied
- Show a 3-second toast (foreground only) with the number of contributed segments:
  - `"1 trajet contribué ✓"` or `"N trajets contribués ✓"` (French pluralisation)

**Does NOT**
- Persist any state beyond the `motionWarning` flag

---

### `hooks/useGtfsData.ts`

Added `rawStops: Stop[]` to the returned `GtfsData` object. This is the unmodified `stops` array from the GTFS bundle — one entry per physical platform, with exact `stop_lat`/`stop_lon` coordinates.

Previously only `tramStops` (clustered station centroids) was available. For passive tracking, individual platform IDs are required so that `makeSegmentKey(stopA.stop_id, stopB.stop_id)` matches the keys in `segmentPaths`.

---

### `app/api/segment-speeds/route.ts`

The POST handler validates submissions in three layers before calling `appendSpeedGraph`:

1. **Basic shape** — `stopAId`, `stopBId`, `points` array present; `points.length >= 3`
2. **Speed range** — all `speedMs` values in `[0, MAX_SEGMENT_SPEED_MS]`
3. **Coherence checks**
   - `totalDurationSec <= 180`
   - `points.length >= PASSIVE_MIN_POINTS_PER_SEGMENT` (10)
   - At least 2 points with `speedMs > PASSIVE_MIN_SPEED_MS` (1.67 m/s)
4. **Outlier z-score** (only when ≥ 3 existing records exist):
   - Compute mean speed of the new submission and each existing record
   - If `|z-score| > 2.5` → reject with HTTP 422 `{ error: 'outlier' }`

---

### `lib/segmentSpeeds.ts`

`getAveragedGraph` applies a temporal decay weight to each record:

```
weight = e^(-0.01 × age_in_days)
```

| Age | Weight |
|-----|--------|
| 0 days (today) | 1.00 |
| 30 days | 0.74 |
| 70 days (half-life) | 0.50 |
| 180 days (6 months) | 0.16 |
| 365 days (1 year) | 0.03 |

Both the averaged speed at each grid point and the `meanDuration` are computed as weighted averages. This allows the system to self-correct if tram commercial speeds change (line modification, works, new schedule).

---

## Algorithms

### Accelerometer state machine

Every `devicemotion` event appends a sample `{ x, y, z, gravZ, t }` to a 2-second sliding window. After trimming old samples, the handler computes:

**1. Horizontal variance**

```
horizVariance = mean(var(X), var(Y))
```

X and Y are the horizontal axes (gravity lies mostly on Z when the phone is held normally). This variance distinguishes stationary from moving.

| horizVariance | State |
|---|---|
| < `ACCEL_IDLE_THRESHOLD` (0.15) | IDLE |
| > `ACCEL_MOVE_THRESHOLD` (0.50) | MOVING |
| between | UNCERTAIN |

**2. Walking detection (gravity-subtracted Z)**

Each sample stores a gravity estimate computed by an exponential moving average:

```
gravZ[i] = α × z[i] + (1 − α) × gravZ[i−1]     α = 0.02
```

`α = 0.02` gives a time constant of ~50 samples (~0.8 s at 60 Hz), which is slow enough to follow orientation changes but fast enough to not confuse step impacts with gravity drift.

Walking step impacts produce a sharp positive spike on `z − gravZ` (linear acceleration on Z). The detector counts local maxima above 1.5 m/s² in the 2-second window:

```
peaks_per_second = count(local_maxima on (z − gravZ) > 1.5) / window_duration_s
```

If `peaks_per_second ∈ [1.5, 2.5]` → state = **WALKING** (overrides variance-based state).

Walking detection is orientation-independent because it operates on `z − gravZ` rather than raw Z. Whether the phone is in a pocket, held upright, or lying flat, gravity is subtracted out.

**3. Battery optimisation (GPS mode switching)**

When the state transitions between `(IDLE or WALKING)` and `(MOVING or UNCERTAIN)`, the GPS watch is restarted with different `maximumAge`:

| GPS mode | `maximumAge` | Approx. fix rate |
|---|---|---|
| `active` | 1 000 ms | ~1 Hz |
| `idle` | 5 000 ms | ~0.2 Hz |

The watch is only restarted on a mode *boundary* crossing (tracked in `gpsModeRef`), not on every motion event.

---

### Trip state machine

```
IDLE
  │  onLine = true
  │  accelState ∈ {MOVING, UNCERTAIN}
  │  for TRIP_START_MIN_FIXES (3) consecutive fixes
  ▼
COLLECTING
  │  onLine = false
  ▼
WAITING_END
  │  onLine = true again  ────────────────────► COLLECTING
  │                                             (red light / stop)
  │  still offLine for OUT_OF_RANGE_TIMEOUT_MS (30 s)
  ▼
IDLE  →  runPostHocMatching(trace)
```

**"On line"** means `distanceToNearestEdge(lat, lng, gridIndex) ≤ PASSIVE_MAX_DISTANCE_TO_LINE_M (50 m)`.

The 30-second grace period before finalising a trip means: brief GPS noise spikes off-track, red lights, and intermediate stops (where the tram is at the platform on the GTFS track) do not prematurely end the collection. Only walking away from the track triggers the trip end.

---

### Line proximity: spatial grid index

`distanceToNearestEdge` checks the minimum perpendicular distance from a GPS fix to any segment polyline edge using:

1. **Flat-earth projection onto edge A→B**:
   ```
   t = clamp(dot(AP, AB) / dot(AB, AB), 0, 1)
   closest = A + t × AB
   dist = haversine(P, closest)
   ```
   This gives the true perpendicular distance (not just the distance to endpoints), so a user at the midpoint of a long edge is correctly identified as on-line.

2. **Spatial grid** (cell size = 0.005° ≈ 500 m): segment edges are indexed by the cells of both their endpoints. A query checks the 3×3 neighbourhood (9 cells). For the Grenoble tram network (~1000–3000 total path vertices), this reduces edge candidates per query from O(N) to O(10–50) — a ~50–300× speedup.

The index is built once in a `useEffect` when `segmentPaths` first becomes non-empty, and stored in `gridIndexRef`.

---

### Post-hoc matching

Called once when a trip ends (state machine reaches IDLE after the 30-second timeout).

**Input**: raw trace `RawTracePoint[]` — one entry per GPS fix recorded during COLLECTING state.

**Steps**:

1. **Speed per point** — 5-second sliding window of haversine distances between consecutive fixes:
   ```
   speedMs = totalDist(fixes in window) / window_duration_s
   ```
   Returns `null` (mapped to 0) if fewer than 2 fixes are in the window.

2. **Stop association** — for each trace point, find the nearest individual platform stop (`rawStops`) within `PASSIVE_MAX_DISTANCE_TO_LINE_M (50 m)`. Points with no stop within range are unassociated.

3. **Stop sequence** — deduplicate: consecutive trace points associated to the same stop are collapsed into one entry `{ stop, firstTimestamp, lastTimestamp }`.

4. **Segment validation** — for each consecutive stop pair `(A, B)`:
   - `makeSegmentKey(A.stop_id, B.stop_id)` must exist in `segmentPaths` (known GTFS segment)
   - Extract trace points with `timestamp ∈ [A.firstTimestamp, B.firstTimestamp]`
   - Apply validation gate (all conditions must pass):

   | Check | Threshold |
   |---|---|
   | Point count | ≥ `PASSIVE_MIN_POINTS_PER_SEGMENT` (10) |
   | Duration | ≤ `PASSIVE_MAX_SEGMENT_DURATION_S` (180 s) |
   | Mean speed | > `PASSIVE_MIN_SPEED_MS` (1.67 m/s) |
   | Walking | No fix with `accelState = WALKING` in window |

5. **Submission** — valid segments are POSTed to `/api/segment-speeds`:
   ```json
   {
     "stopAId": "...",
     "stopBId": "...",
     "totalDurationSec": 47.3,
     "points": [{ "tSec": 0, "speedMs": 4.2 }, ...]
   }
   ```
   Each successful POST increments `lastContributedCount` which triggers the toast in `SettingsPanel`.

---

### sessionStorage trace persistence

The raw trace is serialised to `sessionStorage` under key `passive_trace_v1` at most once per second (throttled). On the next page load:

- If `passive_trace_v1` is non-empty → restore `rawTraceRef.current` and set `tripState = COLLECTING`
- The trip resumes as if the page had never reloaded; post-hoc matching fires normally at trip end

The key is deleted when:
- `runPostHocMatching` is called (trace processed)
- `stopTracking` is called (user disables passive tracking)
- `tripState` transitions to `COLLECTING` after a new trip start (fresh trace begins)

---

## Configuration Constants (`lib/config.ts`)

| Constant | Value | Unit | Purpose |
|---|---|---|---|
| `ACCEL_IDLE_THRESHOLD` | 0.15 | m²/s⁴ | Horizontal variance below which user is stationary |
| `ACCEL_MOVE_THRESHOLD` | 0.50 | m²/s⁴ | Horizontal variance above which user is moving |
| `PASSIVE_MAX_ACCURACY_M` | 35 | m | GPS fixes with worse accuracy are dropped |
| `PASSIVE_MAX_DISTANCE_TO_LINE_M` | 50 | m | Max perpendicular distance to a segment edge to be "on line" |
| `PASSIVE_MAX_SEGMENT_DURATION_S` | 180 | s | Segments longer than this are rejected (both client and server) |
| `PASSIVE_MIN_POINTS_PER_SEGMENT` | 10 | fixes | Minimum GPS points for a valid segment |
| `PASSIVE_MIN_SPEED_MS` | 1.67 | m/s | ~6 km/h; minimum mean speed (rejects stationary/walking trips) |
| `WALKING_STEP_FREQ_MIN_HZ` | 1.5 | Hz | Lower bound of walking cadence for Z-peak detection |
| `WALKING_STEP_FREQ_MAX_HZ` | 2.5 | Hz | Upper bound of walking cadence for Z-peak detection |

**Tuning guidance**:
- Raise `ACCEL_IDLE_THRESHOLD` if the system stays in IDLE too long when the phone is in a bag on a moving tram (bag dampens vibration).
- Lower `PASSIVE_MAX_DISTANCE_TO_LINE_M` if contributions are being generated for non-tram trips; raise it if tram trips are being missed in areas with GPS drift.
- Raise `PASSIVE_MIN_POINTS_PER_SEGMENT` if short, noisy segments are reaching the backend.

---

## Known Edge Cases and Limitations

**Page closed mid-trip**: The raw trace is recovered from `sessionStorage` on the next load. If the browser discards `sessionStorage` (e.g. private mode, storage pressure), the trace is lost and no submission is made — failure is always silent.

**iOS DeviceMotion permission**: `DeviceMotionEvent.requestPermission()` must be called from within a user-gesture handler. It is called inside `SettingsPanel.handleToggle()` which fires from a button click — this satisfies the iOS requirement. If the user denies permission, `window.devicemotion` events are never fired. The hook detects this implicitly: `accelSamplesRef.current` stays empty, `accelState` stays `UNCERTAIN` (its initial value), and the trip state machine still starts collecting when GPS places the user on a line, though walking exclusion is disabled (UNCERTAIN ≠ WALKING).

**GPS-only fallback**: With no accelerometer data (`accelState = UNCERTAIN`), the system cannot detect walking. A slow walk along a tram track could in theory generate a contribution. The `PASSIVE_MIN_SPEED_MS` threshold (1.67 m/s ≈ 6 km/h) mitigates this: normal walking speed (1.2–1.5 m/s) falls below the threshold and fails the mean speed check.

**Segment key mismatch**: `makeSegmentKey` sorts stop IDs alphabetically, so the key is direction-agnostic. A trip from A→B and a trip from B→A produce the same key. The speed profile accumulated in `data/segment-speeds/` therefore mixes both directions. For segments where the speed profile is highly asymmetric (steep grades), this averages them. The Grenoble tram network is mostly flat, so this is acceptable.

**Phone orientation changes**: The EMA gravity estimate on Z has a time constant of ~0.8 s. A sudden orientation change (e.g. pulling the phone out of a pocket) introduces a ~2–3 second transient where `z − gravZ` is large, potentially triggering false WALKING detection. This results in a short gap of suppressed contributions at the start of that segment — minor and self-correcting.

**Multiple segments per trip**: The post-hoc algorithm independently validates each `(stopA, stopB)` pair in the detected stop sequence. A 10-stop trip can yield up to 9 individual segment submissions, each counted separately in `lastContributedCount`. The toast correctly shows the total: `"9 trajets contribués ✓"`.
