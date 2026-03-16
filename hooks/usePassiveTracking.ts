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

interface RawTracePoint {
  lat: number
  lng: number
  timestamp: number   // ms since epoch
  accuracy: number
  accelState: AccelState
}

// Sliding window entry for accelerometer variance computation
interface AccelSample {
  x: number
  y: number
  z: number
  t: number // ms
}

const ACCEL_WINDOW_MS = 2000   // 2-second sliding window
const OUT_OF_RANGE_TIMEOUT_MS = 30_000  // 30 seconds off-line before finalising trip
const TRIP_START_MIN_FIXES = 3   // consecutive on-line MOVING fixes to start a trip
const GPS_SPEED_WINDOW_MS = 5_000  // 5-second sliding window for speed computation

/**
 * Returns the minimum distance in metres from `point` to any vertex in any
 * segment path. This is a fast approximation (vertex-only, not true
 * perpendicular distance) but sufficient given segment path resolution.
 */
function distanceToNearestPathPoint(
  lat: number,
  lng: number,
  segmentPaths: Map<string, LatLng[]>,
): number {
  let minDist = Infinity
  for (const path of segmentPaths.values()) {
    for (const pt of path) {
      const d = haversineDistance(lat, lng, pt.lat, pt.lng)
      if (d < minDist) minDist = d
    }
  }
  return minDist
}

/**
 * Computes GPS speed over a sliding time window ending at `now` using
 * haversine distance between consecutive fixes.
 */
function computeWindowSpeed(
  trace: RawTracePoint[],
  windowEndIdx: number,
  windowMs: number,
): number | null {
  const endPt = trace[windowEndIdx]
  const windowStart = endPt.timestamp - windowMs
  // Collect points in window (inclusive of windowEndIdx)
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

/**
 * Counts local maxima on the Z-axis signal in the `samples` array.
 * A local maximum is a sample whose Z value exceeds both its neighbours
 * and a threshold (gravity ± 2 m/s²). Returns peaks per second.
 */
function detectWalkingFrequency(samples: AccelSample[]): number {
  if (samples.length < 3) return 0
  const durationSec = (samples[samples.length - 1].t - samples[0].t) / 1000
  if (durationSec <= 0) return 0
  const PEAK_THRESHOLD = 2.0  // m/s² above baseline
  let peaks = 0
  for (let i = 1; i < samples.length - 1; i++) {
    const prev = samples[i - 1].z
    const cur = samples[i].z
    const next = samples[i + 1].z
    if (cur > prev && cur > next && cur > PEAK_THRESHOLD) peaks++
  }
  return peaks / durationSec
}

export function usePassiveTracking(
  tramStops: Array<{ stop: Stop; color: string }>,
  segmentPaths: Map<string, LatLng[]>,
  dataLoaded: boolean,
) {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('passive_tracking_enabled') === 'true'
  })
  const [lastContributedCount, setLastContributedCount] = useState(0)

  // Internal refs — avoid stale closures in callbacks
  const enabledRef = useRef(enabled)
  const accelStateRef = useRef<AccelState>('UNCERTAIN')
  const tripStateRef = useRef<TripState>('IDLE')
  const rawTraceRef = useRef<RawTracePoint[]>([])
  const accelSamplesRef = useRef<AccelSample[]>([])
  const watchIdRef = useRef<number | null>(null)
  const consecutiveOnLineFixes = useRef(0)
  const outOfRangeStartRef = useRef<number | null>(null)
  const gpsOptionsRef = useRef<PositionOptions>({ enableHighAccuracy: true, maximumAge: 1000 })
  const segmentPathsRef = useRef(segmentPaths)
  const tramStopsRef = useRef(tramStops)

  // Keep refs in sync with props
  useEffect(() => { segmentPathsRef.current = segmentPaths }, [segmentPaths])
  useEffect(() => { tramStopsRef.current = tramStops }, [tramStops])

  // ---------------------------------------------------------------------------
  // Accelerometer handler
  // ---------------------------------------------------------------------------
  const onDeviceMotion = useCallback((e: DeviceMotionEvent) => {
    const ag = e.accelerationIncludingGravity
    if (!ag) return
    const now = Date.now()
    accelSamplesRef.current.push({ x: ag.x ?? 0, y: ag.y ?? 0, z: ag.z ?? 0, t: now })

    // Trim to 2-second window
    const cutoff = now - ACCEL_WINDOW_MS
    const samples = accelSamplesRef.current
    while (samples.length > 0 && samples[0].t < cutoff) samples.shift()

    if (samples.length < 10) return  // not enough data yet

    // Variance on horizontal axes (X, Y)
    const xMean = samples.reduce((s, p) => s + p.x, 0) / samples.length
    const yMean = samples.reduce((s, p) => s + p.y, 0) / samples.length
    const xVar = samples.reduce((s, p) => s + (p.x - xMean) ** 2, 0) / samples.length
    const yVar = samples.reduce((s, p) => s + (p.y - yMean) ** 2, 0) / samples.length
    const horizVariance = (xVar + yVar) / 2

    // Walking detection via Z-axis peak frequency
    const walkFreq = detectWalkingFrequency(samples)
    if (walkFreq >= WALKING_STEP_FREQ_MIN_HZ && walkFreq <= WALKING_STEP_FREQ_MAX_HZ) {
      accelStateRef.current = 'WALKING'
      // Battery optimisation: if idle, reduce GPS polling
      gpsOptionsRef.current = { enableHighAccuracy: true, maximumAge: 5000 }
      return
    }

    if (horizVariance < ACCEL_IDLE_THRESHOLD) {
      accelStateRef.current = 'IDLE'
      gpsOptionsRef.current = { enableHighAccuracy: true, maximumAge: 5000 }
    } else if (horizVariance > ACCEL_MOVE_THRESHOLD) {
      accelStateRef.current = 'MOVING'
      gpsOptionsRef.current = { enableHighAccuracy: true, maximumAge: 1000 }
    } else {
      accelStateRef.current = 'UNCERTAIN'
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Post-hoc matching
  // ---------------------------------------------------------------------------
  function runPostHocMatching(trace: RawTracePoint[]): void {
    if (trace.length < PASSIVE_MIN_POINTS_PER_SEGMENT) return

    // 1. Compute per-point speed
    const pointsWithSpeed = trace.map((pt, idx) => ({
      ...pt,
      speedMs: computeWindowSpeed(trace, idx, GPS_SPEED_WINDOW_MS) ?? 0,
    }))

    // 2. Associate each point to nearest tram stop (within threshold)
    const stops = tramStopsRef.current
    const associated = pointsWithSpeed.map(pt => {
      let nearestStop: Stop | null = null
      let minDist = PASSIVE_MAX_DISTANCE_TO_LINE_M
      for (const { stop } of stops) {
        const d = haversineDistance(pt.lat, pt.lng, stop.stop_lat, stop.stop_lon)
        if (d < minDist) { minDist = d; nearestStop = stop }
      }
      return { ...pt, nearestStop }
    })

    // 3. Reconstruct ordered stop sequence (deduplicated, first occurrence)
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

    // 4. For each consecutive stop pair, validate against GTFS segmentPaths
    const segPaths = segmentPathsRef.current
    for (let i = 0; i < stopSequence.length - 1; i++) {
      const stopA = stopSequence[i]
      const stopB = stopSequence[i + 1]
      const key = makeSegmentKey(stopA.stop.stop_id, stopB.stop.stop_id)

      // Validate: this must be a known GTFS segment
      if (!segPaths.has(key)) continue

      // 5. Extract segment points
      const segPoints = pointsWithSpeed.filter(
        pt => pt.timestamp >= stopA.firstTimestamp && pt.timestamp <= stopB.firstTimestamp,
      )
      if (segPoints.length < PASSIVE_MIN_POINTS_PER_SEGMENT) continue

      // 6. Validate the candidate segment
      const durationSec = (segPoints[segPoints.length - 1].timestamp - segPoints[0].timestamp) / 1000
      if (durationSec > PASSIVE_MAX_SEGMENT_DURATION_S) continue

      const meanSpeed = segPoints.reduce((s, p) => s + p.speedMs, 0) / segPoints.length
      if (meanSpeed <= PASSIVE_MIN_SPEED_MS) continue

      // Reject if any sub-interval in the original trace has WALKING accelState
      const hasWalking = trace
        .filter(pt => pt.timestamp >= stopA.firstTimestamp && pt.timestamp <= stopB.firstTimestamp)
        .some(pt => pt.accelState === 'WALKING')
      if (hasWalking) continue

      // 7. Build payload
      const startTs = segPoints[0].timestamp
      const payload = {
        stopAId: stopA.stop.stop_id,
        stopBId: stopB.stop.stop_id,
        totalDurationSec: durationSec,
        points: segPoints.map(p => ({ tSec: (p.timestamp - startTs) / 1000, speedMs: p.speedMs })),
      }

      // Submit — fire-and-forget; increment counter on success
      fetch('/api/segment-speeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(res => { if (res.ok) setLastContributedCount(c => c + 1) })
        .catch(() => { /* silent */ })
    }
  }

  // ---------------------------------------------------------------------------
  // GPS handler
  // ---------------------------------------------------------------------------
  const onGpsPosition = useCallback((pos: GeolocationPosition) => {
    const { latitude, longitude, accuracy } = pos.coords
    if (accuracy > PASSIVE_MAX_ACCURACY_M) return

    const accelState = accelStateRef.current
    const tripState = tripStateRef.current
    const now = pos.timestamp
    const segPaths = segmentPathsRef.current

    const distToLine = distanceToNearestPathPoint(latitude, longitude, segPaths)
    const onLine = distToLine <= PASSIVE_MAX_DISTANCE_TO_LINE_M

    if (tripState === 'IDLE') {
      if (onLine && (accelState === 'MOVING' || accelState === 'UNCERTAIN')) {
        consecutiveOnLineFixes.current++
        if (consecutiveOnLineFixes.current >= TRIP_START_MIN_FIXES) {
          tripStateRef.current = 'COLLECTING'
          rawTraceRef.current = []
          outOfRangeStartRef.current = null
        }
      } else {
        consecutiveOnLineFixes.current = 0
      }
      return
    }

    // Record the current point
    rawTraceRef.current.push({ lat: latitude, lng: longitude, timestamp: now, accuracy, accelState })

    if (tripState === 'COLLECTING') {
      if (!onLine) {
        tripStateRef.current = 'WAITING_END'
        outOfRangeStartRef.current = now
      }
      return
    }

    if (tripState === 'WAITING_END') {
      if (onLine) {
        // Back on line — resume collecting
        tripStateRef.current = 'COLLECTING'
        outOfRangeStartRef.current = null
        return
      }
      // Still off-line: check 30s timeout
      if (outOfRangeStartRef.current !== null && now - outOfRangeStartRef.current >= OUT_OF_RANGE_TIMEOUT_MS) {
        // Trip ended — run post-hoc matching
        const trace = rawTraceRef.current.slice()
        rawTraceRef.current = []
        tripStateRef.current = 'IDLE'
        consecutiveOnLineFixes.current = 0
        outOfRangeStartRef.current = null
        runPostHocMatching(trace)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------------------
  // Start / stop tracking
  // ---------------------------------------------------------------------------
  function startTracking() {
    if (!navigator.geolocation) return
    watchIdRef.current = navigator.geolocation.watchPosition(
      onGpsPosition,
      () => { /* ignore GPS errors silently */ },
      gpsOptionsRef.current,
    )
    if (typeof window !== 'undefined') {
      window.addEventListener('devicemotion', onDeviceMotion as EventListener)
    }
  }

  function stopTracking() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('devicemotion', onDeviceMotion as EventListener)
    }
    // Finalise any in-progress trip
    if (tripStateRef.current !== 'IDLE' && rawTraceRef.current.length > 0) {
      runPostHocMatching(rawTraceRef.current.slice())
    }
    tripStateRef.current = 'IDLE'
    rawTraceRef.current = []
    accelSamplesRef.current = []
    consecutiveOnLineFixes.current = 0
    outOfRangeStartRef.current = null
  }

  // ---------------------------------------------------------------------------
  // Enable / disable
  // ---------------------------------------------------------------------------
  const setEnabled = useCallback((value: boolean) => {
    enabledRef.current = value
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

  // Auto-start on mount if enabled and data is loaded
  useEffect(() => {
    if (!dataLoaded || !enabled) return
    startTracking()
    return () => { stopTracking() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoaded])

  const clearContributedCount = useCallback(() => setLastContributedCount(0), [])

  return { enabled, setEnabled, lastContributedCount, clearContributedCount }
}
