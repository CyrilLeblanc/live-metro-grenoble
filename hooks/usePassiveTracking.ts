'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { haversineDistance, makeSegmentKey, LatLng } from '../lib/geo'
import { Stop } from '../lib/gtfs'
import {
  ACCEL_IDLE_THRESHOLD,
  ACCEL_MOVE_THRESHOLD,
  PASSIVE_MAX_ACCURACY_M,
  PASSIVE_MAX_DISTANCE_TO_LINE_M,
  PASSIVE_MAX_SEGMENT_DURATION_S,
  PASSIVE_MIN_POINTS_PER_SEGMENT,
  PASSIVE_MIN_SPEED_MS,
  WALKING_STEP_FREQ_MIN_HZ,
  WALKING_STEP_FREQ_MAX_HZ,
} from '../lib/config'

type AccelState = 'IDLE' | 'MOVING' | 'UNCERTAIN' | 'WALKING'
type TripState = 'IDLE' | 'COLLECTING' | 'WAITING_END'
type GpsMode = 'active' | 'idle'

interface RawTracePoint {
  lat: number
  lng: number
  timestamp: number   // ms since epoch
  accuracy: number
  accelState: AccelState
}

interface AccelSample {
  x: number
  y: number
  z: number
  gravZ: number   // FIX 3: low-pass gravity estimate on Z axis
  t: number       // ms
}

// FIX 5: spatial grid index for fast edge lookup
interface GridEdge {
  aLat: number
  aLng: number
  bLat: number
  bLng: number
}

const ACCEL_WINDOW_MS = 2000
const OUT_OF_RANGE_TIMEOUT_MS = 30_000
const TRIP_START_MIN_FIXES = 3
const GPS_SPEED_WINDOW_MS = 5_000

// FIX 3
const ACCEL_GRAVITY_ALPHA = 0.02    // EMA α for gravity on Z; time constant ~50 samples ≈ 0.8 s @ 60 Hz
const WALK_PEAK_THRESHOLD = 1.5     // m/s² on gravity-subtracted Z to count as a step peak

// FIX 4
const TRACE_SAVE_INTERVAL_MS = 1000
const SESSION_TRACE_KEY = 'passive_trace_v1'

// FIX 5
const GRID_CELL_DEG = 0.005   // ~500 m cells; tram segment edges are typically shorter

// ---------------------------------------------------------------------------
// FIX 1 + 5: true edge-based perpendicular distance + spatial grid index
// ---------------------------------------------------------------------------

/**
 * Minimum distance from point (pLat, pLng) to segment A→B.
 * Uses flat-earth projection (accurate to < 0.1% within 1 km).
 */
function pointToEdgeDistance(
  pLat: number, pLng: number,
  aLat: number, aLng: number,
  bLat: number, bLng: number,
): number {
  const dLat = bLat - aLat
  const dLng = bLng - aLng
  const lenSq = dLat * dLat + dLng * dLng
  if (lenSq === 0) return haversineDistance(pLat, pLng, aLat, aLng)
  const t = Math.max(0, Math.min(1, ((pLat - aLat) * dLat + (pLng - aLng) * dLng) / lenSq))
  return haversineDistance(pLat, pLng, aLat + t * dLat, aLng + t * dLng)
}

function cellKey(lat: number, lng: number): string {
  return `${Math.floor(lat / GRID_CELL_DEG)},${Math.floor(lng / GRID_CELL_DEG)}`
}

function buildGridIndex(segmentPaths: Map<string, LatLng[]>): Map<string, GridEdge[]> {
  const index = new Map<string, GridEdge[]>()

  function insertEdge(edge: GridEdge, lat: number, lng: number) {
    const k = cellKey(lat, lng)
    if (!index.has(k)) index.set(k, [])
    index.get(k)!.push(edge)
  }

  for (const path of segmentPaths.values()) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1]
      const edge: GridEdge = { aLat: a.lat, aLng: a.lng, bLat: b.lat, bLng: b.lng }
      insertEdge(edge, a.lat, a.lng)
      // Insert into B's cell too when it differs (handles edges crossing cell boundaries)
      const bKey = cellKey(b.lat, b.lng)
      if (bKey !== cellKey(a.lat, a.lng)) insertEdge(edge, b.lat, b.lng)
    }
  }
  return index
}

/**
 * Returns the minimum distance to any segment edge using a 3×3 grid cell
 * neighbourhood — O(K) where K is edges in nearby cells, vs O(N) brute force.
 */
function distanceToNearestEdge(
  lat: number,
  lng: number,
  index: Map<string, GridEdge[]>,
): number {
  const ci = Math.floor(lat / GRID_CELL_DEG)
  const cj = Math.floor(lng / GRID_CELL_DEG)
  let minDist = Infinity
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      for (const edge of (index.get(`${ci + di},${cj + dj}`) ?? [])) {
        const d = pointToEdgeDistance(lat, lng, edge.aLat, edge.aLng, edge.bLat, edge.bLng)
        if (d < minDist) minDist = d
      }
    }
  }
  return minDist
}

// ---------------------------------------------------------------------------
// FIX 3: walking detection with gravity-subtracted Z
// ---------------------------------------------------------------------------

/**
 * Counts peaks on the gravity-subtracted Z signal.
 * A step impact produces a sharp positive spike on linear acceleration;
 * walking cadence is 1.5–2.5 Hz regardless of phone orientation.
 */
function detectWalkingFrequency(samples: AccelSample[]): number {
  if (samples.length < 3) return 0
  const durationSec = (samples[samples.length - 1].t - samples[0].t) / 1000
  if (durationSec <= 0) return 0
  let peaks = 0
  for (let i = 1; i < samples.length - 1; i++) {
    const prev = samples[i - 1].z - samples[i - 1].gravZ
    const cur  = samples[i].z     - samples[i].gravZ
    const next = samples[i + 1].z - samples[i + 1].gravZ
    if (cur > prev && cur > next && cur > WALK_PEAK_THRESHOLD) peaks++
  }
  return peaks / durationSec
}

// ---------------------------------------------------------------------------
// FIX 4: sessionStorage persistence for raw trace
// ---------------------------------------------------------------------------

function saveTrace(trace: RawTracePoint[]): void {
  try { sessionStorage.setItem(SESSION_TRACE_KEY, JSON.stringify(trace)) } catch { /* storage quota */ }
}

function loadTrace(): RawTracePoint[] | null {
  try {
    const raw = sessionStorage.getItem(SESSION_TRACE_KEY)
    return raw ? (JSON.parse(raw) as RawTracePoint[]) : null
  } catch { return null }
}

function clearTrace(): void {
  try { sessionStorage.removeItem(SESSION_TRACE_KEY) } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Speed computation (module-level; pure)
// ---------------------------------------------------------------------------

function computeWindowSpeed(
  trace: RawTracePoint[],
  windowEndIdx: number,
  windowMs: number,
): number | null {
  const endPt = trace[windowEndIdx]
  const windowStart = endPt.timestamp - windowMs
  const pts: RawTracePoint[] = []
  for (let i = windowEndIdx; i >= 0; i--) {
    if (trace[i].timestamp < windowStart) break
    pts.unshift(trace[i])
  }
  if (pts.length < 2) return null
  let totalDist = 0
  for (let i = 1; i < pts.length; i++) {
    totalDist += haversineDistance(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng)
  }
  const elapsed = (pts[pts.length - 1].timestamp - pts[0].timestamp) / 1000
  return elapsed > 0 ? totalDist / elapsed : null
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePassiveTracking(
  rawStops: Stop[],                        // FIX 6: individual platform stops (not cluster centroids)
  segmentPaths: Map<string, LatLng[]>,
  dataLoaded: boolean,
) {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('passive_tracking_enabled') === 'true'
  })
  const [lastContributedCount, setLastContributedCount] = useState(0)

  // Stable refs — accessed inside useCallback([]) handlers
  const accelStateRef    = useRef<AccelState>('UNCERTAIN')
  const gpsModeRef       = useRef<GpsMode>('active')          // FIX 2
  const tripStateRef     = useRef<TripState>('IDLE')
  const rawTraceRef      = useRef<RawTracePoint[]>([])
  const accelSamplesRef  = useRef<AccelSample[]>([])
  const watchIdRef       = useRef<number | null>(null)
  const isTrackingRef    = useRef(false)
  const consecutiveOnLineFixes = useRef(0)
  const outOfRangeStartRef     = useRef<number | null>(null)
  const lastTraceSaveRef       = useRef(0)                    // FIX 4: throttle
  const segmentPathsRef  = useRef(segmentPaths)
  const rawStopsRef      = useRef(rawStops)                   // FIX 6
  const gridIndexRef     = useRef<Map<string, GridEdge[]>>(new Map())

  // Indirection refs so useCallback([]) handlers always call the latest function version
  const runPostHocMatchingRef  = useRef<(trace: RawTracePoint[]) => void>(() => {})
  const restartGpsWatchRef     = useRef<(mode: GpsMode) => void>(() => {})

  // Keep data refs in sync with props
  useEffect(() => { segmentPathsRef.current = segmentPaths }, [segmentPaths])
  useEffect(() => { rawStopsRef.current = rawStops }, [rawStops])

  // FIX 5: build spatial index once when segmentPaths arrives
  useEffect(() => {
    if (segmentPaths.size === 0) return
    gridIndexRef.current = buildGridIndex(segmentPaths)
  }, [segmentPaths])

  // ---------------------------------------------------------------------------
  // Post-hoc matching (reads refs, calls stable state setter)
  // ---------------------------------------------------------------------------
  function runPostHocMatching(trace: RawTracePoint[]): void {
    clearTrace()   // FIX 4: discard persisted trace now that it's being processed
    if (trace.length < PASSIVE_MIN_POINTS_PER_SEGMENT) return

    // 1. Compute per-point GPS speed
    const pointsWithSpeed = trace.map((pt, idx) => ({
      ...pt,
      speedMs: computeWindowSpeed(trace, idx, GPS_SPEED_WINDOW_MS) ?? 0,
    }))

    // 2. FIX 6: associate each point to the nearest individual platform stop
    const stops = rawStopsRef.current
    const associated = pointsWithSpeed.map(pt => {
      let nearestStop: Stop | null = null
      let minDist = PASSIVE_MAX_DISTANCE_TO_LINE_M
      for (const stop of stops) {
        const d = haversineDistance(pt.lat, pt.lng, stop.stop_lat, stop.stop_lon)
        if (d < minDist) { minDist = d; nearestStop = stop }
      }
      return { ...pt, nearestStop }
    })

    // 3. Deduplicated ordered stop sequence (first occurrence per stop)
    const stopSequence: Array<{ stop: Stop; firstTimestamp: number; lastTimestamp: number }> = []
    for (const pt of associated) {
      if (!pt.nearestStop) continue
      const last = stopSequence[stopSequence.length - 1]
      if (last && last.stop.stop_id === pt.nearestStop.stop_id) {
        last.lastTimestamp = pt.timestamp
      } else {
        stopSequence.push({ stop: pt.nearestStop, firstTimestamp: pt.timestamp, lastTimestamp: pt.timestamp })
      }
    }
    if (stopSequence.length < 2) return

    const segPaths = segmentPathsRef.current

    // 4–7. Validate and submit each consecutive stop pair
    for (let i = 0; i < stopSequence.length - 1; i++) {
      const stopA = stopSequence[i]
      const stopB = stopSequence[i + 1]
      const key = makeSegmentKey(stopA.stop.stop_id, stopB.stop.stop_id)
      if (!segPaths.has(key)) continue

      const segPoints = pointsWithSpeed.filter(
        pt => pt.timestamp >= stopA.firstTimestamp && pt.timestamp <= stopB.firstTimestamp,
      )
      if (segPoints.length < PASSIVE_MIN_POINTS_PER_SEGMENT) continue

      const durationSec = (segPoints[segPoints.length - 1].timestamp - segPoints[0].timestamp) / 1000
      if (durationSec > PASSIVE_MAX_SEGMENT_DURATION_S) continue

      const meanSpeed = segPoints.reduce((s, p) => s + p.speedMs, 0) / segPoints.length
      if (meanSpeed <= PASSIVE_MIN_SPEED_MS) continue

      const hasWalking = trace
        .filter(pt => pt.timestamp >= stopA.firstTimestamp && pt.timestamp <= stopB.firstTimestamp)
        .some(pt => pt.accelState === 'WALKING')
      if (hasWalking) continue

      const startTs = segPoints[0].timestamp
      const payload = {
        stopAId: stopA.stop.stop_id,
        stopBId: stopB.stop.stop_id,
        totalDurationSec: durationSec,
        points: segPoints.map(p => ({ tSec: (p.timestamp - startTs) / 1000, speedMs: p.speedMs })),
      }

      fetch('/api/segment-speeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(res => { if (res.ok) setLastContributedCount(c => c + 1) })
        .catch(() => { /* silent */ })
    }
  }
  // Keep indirection ref up to date
  runPostHocMatchingRef.current = runPostHocMatching

  // ---------------------------------------------------------------------------
  // FIX 2: GPS watch restart helper
  // ---------------------------------------------------------------------------
  function restartGpsWatch(mode: GpsMode) {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      onGpsPosition,
      () => { /* ignore GPS errors */ },
      { enableHighAccuracy: true, maximumAge: mode === 'idle' ? 5000 : 1000 },
    )
  }
  restartGpsWatchRef.current = restartGpsWatch

  // ---------------------------------------------------------------------------
  // Accelerometer handler
  // ---------------------------------------------------------------------------
  const onDeviceMotion = useCallback((e: DeviceMotionEvent) => {
    const ag = e.accelerationIncludingGravity
    if (!ag) return
    const now = Date.now()

    // FIX 3: maintain per-sample gravity estimate via EMA on Z
    const samples = accelSamplesRef.current
    const prevGravZ = samples[samples.length - 1]?.gravZ ?? (ag.z ?? 0)
    const gravZ = ACCEL_GRAVITY_ALPHA * (ag.z ?? 0) + (1 - ACCEL_GRAVITY_ALPHA) * prevGravZ
    samples.push({ x: ag.x ?? 0, y: ag.y ?? 0, z: ag.z ?? 0, gravZ, t: now })

    // Trim to 2-second window
    const cutoff = now - ACCEL_WINDOW_MS
    while (samples.length > 0 && samples[0].t < cutoff) samples.shift()
    if (samples.length < 10) return

    // Variance on horizontal axes
    const xMean = samples.reduce((s, p) => s + p.x, 0) / samples.length
    const yMean = samples.reduce((s, p) => s + p.y, 0) / samples.length
    const xVar  = samples.reduce((s, p) => s + (p.x - xMean) ** 2, 0) / samples.length
    const yVar  = samples.reduce((s, p) => s + (p.y - yMean) ** 2, 0) / samples.length
    const horizVariance = (xVar + yVar) / 2

    // FIX 3: walking detection on gravity-subtracted Z
    const walkFreq = detectWalkingFrequency(samples)
    let newState: AccelState
    if (walkFreq >= WALKING_STEP_FREQ_MIN_HZ && walkFreq <= WALKING_STEP_FREQ_MAX_HZ) {
      newState = 'WALKING'
    } else if (horizVariance < ACCEL_IDLE_THRESHOLD) {
      newState = 'IDLE'
    } else if (horizVariance > ACCEL_MOVE_THRESHOLD) {
      newState = 'MOVING'
    } else {
      newState = 'UNCERTAIN'
    }
    accelStateRef.current = newState

    // FIX 2: restart GPS watch only when mode boundary is crossed
    if (!isTrackingRef.current) return
    const newGpsMode: GpsMode = (newState === 'IDLE' || newState === 'WALKING') ? 'idle' : 'active'
    if (newGpsMode !== gpsModeRef.current) {
      gpsModeRef.current = newGpsMode
      restartGpsWatchRef.current(newGpsMode)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // GPS handler
  // ---------------------------------------------------------------------------
  const onGpsPosition = useCallback((pos: GeolocationPosition) => {
    const { latitude, longitude, accuracy } = pos.coords
    if (accuracy > PASSIVE_MAX_ACCURACY_M) return

    const accelState = accelStateRef.current
    const tripState  = tripStateRef.current
    const now        = pos.timestamp
    const index      = gridIndexRef.current

    // FIX 1 + 5: edge-based perpendicular distance via spatial index
    const distToLine = distanceToNearestEdge(latitude, longitude, index)
    const onLine     = distToLine <= PASSIVE_MAX_DISTANCE_TO_LINE_M

    if (tripState === 'IDLE') {
      if (onLine && (accelState === 'MOVING' || accelState === 'UNCERTAIN')) {
        consecutiveOnLineFixes.current++
        if (consecutiveOnLineFixes.current >= TRIP_START_MIN_FIXES) {
          tripStateRef.current = 'COLLECTING'
          rawTraceRef.current  = []
          outOfRangeStartRef.current = null
          clearTrace()
        }
      } else {
        consecutiveOnLineFixes.current = 0
      }
      return
    }

    // Record the fix
    rawTraceRef.current.push({ lat: latitude, lng: longitude, timestamp: now, accuracy, accelState })

    // FIX 4: throttled sessionStorage save
    if (now - lastTraceSaveRef.current > TRACE_SAVE_INTERVAL_MS) {
      saveTrace(rawTraceRef.current)
      lastTraceSaveRef.current = now
    }

    if (tripState === 'COLLECTING') {
      if (!onLine) {
        tripStateRef.current       = 'WAITING_END'
        outOfRangeStartRef.current = now
      }
      return
    }

    if (tripState === 'WAITING_END') {
      if (onLine) {
        tripStateRef.current       = 'COLLECTING'
        outOfRangeStartRef.current = null
        return
      }
      if (outOfRangeStartRef.current !== null && now - outOfRangeStartRef.current >= OUT_OF_RANGE_TIMEOUT_MS) {
        const trace = rawTraceRef.current.slice()
        rawTraceRef.current        = []
        tripStateRef.current       = 'IDLE'
        consecutiveOnLineFixes.current = 0
        outOfRangeStartRef.current = null
        runPostHocMatchingRef.current(trace)
      }
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Start / stop
  // ---------------------------------------------------------------------------
  function startTracking() {
    if (!navigator.geolocation) return
    isTrackingRef.current = true
    gpsModeRef.current    = 'active'
    watchIdRef.current    = navigator.geolocation.watchPosition(
      onGpsPosition,
      () => { /* ignore GPS errors */ },
      { enableHighAccuracy: true, maximumAge: 1000 },
    )
    if (typeof window !== 'undefined') {
      window.addEventListener('devicemotion', onDeviceMotion as EventListener)
    }
    // FIX 4: restore in-progress trace if the page was reloaded mid-trip
    const saved = loadTrace()
    if (saved && saved.length > 0) {
      rawTraceRef.current  = saved
      tripStateRef.current = 'COLLECTING'
    }
  }

  function stopTracking() {
    isTrackingRef.current = false
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('devicemotion', onDeviceMotion as EventListener)
    }
    if (tripStateRef.current !== 'IDLE' && rawTraceRef.current.length > 0) {
      runPostHocMatchingRef.current(rawTraceRef.current.slice())
    }
    tripStateRef.current           = 'IDLE'
    rawTraceRef.current            = []
    accelSamplesRef.current        = []
    consecutiveOnLineFixes.current = 0
    outOfRangeStartRef.current     = null
    clearTrace()
  }

  // ---------------------------------------------------------------------------
  // Enable / disable
  // ---------------------------------------------------------------------------
  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value)
    if (typeof window !== 'undefined') {
      localStorage.setItem('passive_tracking_enabled', String(value))
    }
    if (value) {
      startTracking()
    } else {
      stopTracking()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-start on mount if the toggle was already on and data is ready
  useEffect(() => {
    if (!dataLoaded || !enabled) return
    startTracking()
    return () => { stopTracking() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoaded])

  const clearContributedCount = useCallback(() => setLastContributedCount(0), [])

  return { enabled, setEnabled, lastContributedCount, clearContributedCount }
}
