import React, { useEffect, useRef } from 'react'
import { haversineDistance, makeSegmentKey, AveragedGraph, LatLng } from '../lib/geo'
import { DECEL_THRESHOLD, MAX_SPEED, MIN_ELAPSED_FOR_SPEED, WAGON_GAP_M } from '../lib/config'
import { interpolateSpeed } from '../lib/speedUtils'
import { buildPathLengths, findProgressOnPath, positionAtProgress, bearingAtProgress } from '../lib/pathUtils'

export interface TramApiItem {
  id: string
  lat: number
  lng: number
  eta: number
  stopAId: string
  stopBId: string
  line: string
  lineColor: string
  direction: string
  nextStop: string
  isRealtime: boolean
}

export interface WagonPosition {
  lat: number
  lng: number
  bearing: number
}

export interface AnimatedPosition {
  lat: number
  lng: number
  bearing: number
  /** Body wagon positions, ordered from closest to furthest behind the head.
   *  Only present when the tram has a shape path to rewind along. */
  wagons?: WagonPosition[]
}

/** Per-tram mutable animation state, updated each API tick and each rAF frame. */
interface TramAnimState {
  path: LatLng[]
  /** Cumulative distances in metres; lengths[i] = total metres from path[0] to path[i]. */
  pathLengths: number[]
  totalLength: number
  /** Current position along path in metres — mutated in place each frame. */
  progressMeters: number
  speedMs: number
  etaAtUpdate: number
  /** performance.now() timestamp of the last API update, used to compute elapsed time. */
  updateTime: number
  /** API-reported lat/lng at the last update, used to derive speed from displacement. */
  apiLat: number
  apiLng: number
  segmentKey: string
}

export function useAnimatedTrams(
  apiTrams: TramApiItem[],
  segmentPaths: Map<string, LatLng[]> | undefined,
  segmentGraphs?: Map<string, AveragedGraph>,
  speedOverrides?: Map<string, number>,
  paused?: boolean,
): React.RefObject<Map<string, AnimatedPosition>> {
  const animStateRef = useRef<Map<string, TramAnimState>>(new Map())
  const positionsRef = useRef<Map<string, AnimatedPosition>>(new Map())
  const pathLengthsCacheRef = useRef<Map<string, { lengths: number[]; total: number }>>(new Map())
  const lastApiTimeRef = useRef<number>(0)
  const rafRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number | null>(null)
  const segmentGraphsRef = useRef<Map<string, AveragedGraph>>(segmentGraphs ?? new Map())
  const speedOverridesRef = useRef<Map<string, number>>(speedOverrides ?? new Map())
  const pausedRef = useRef(paused ?? false)

  useEffect(() => {
    segmentGraphsRef.current = segmentGraphs ?? new Map()
  }, [segmentGraphs])

  useEffect(() => {
    speedOverridesRef.current = speedOverrides ?? new Map()
  }, [speedOverrides])

  useEffect(() => {
    const wasPaused = pausedRef.current
    pausedRef.current = paused ?? false
    // On unpause: reset lastFrameTimeRef so we don't get a huge dt jump
    if (wasPaused && !pausedRef.current) {
      lastFrameTimeRef.current = null
    }
  }, [paused])

  // Update animation state on each API tick
  useEffect(() => {
    if (apiTrams.length === 0) return

    const now = performance.now()
    const elapsedSec = (now - lastApiTimeRef.current) / 1000
    lastApiTimeRef.current = now

    for (const item of apiTrams) {
      // Always write initial API position so trams without shape paths still appear
      if (!positionsRef.current.has(item.id)) {
        positionsRef.current.set(item.id, { lat: item.lat, lng: item.lng, bearing: 0 })
      }

      const shapePath = segmentPaths?.get(makeSegmentKey(item.stopAId, item.stopBId))
      if (!shapePath || shapePath.length < 2) continue

      const prev = animStateRef.current.get(item.id)
      const segKey = makeSegmentKey(item.stopAId, item.stopBId)
      let cached = pathLengthsCacheRef.current.get(segKey)
      if (!cached) {
        cached = buildPathLengths(shapePath)
        pathLengthsCacheRef.current.set(segKey, cached)
      }
      const { lengths, total } = cached
      const progress = findProgressOnPath(shapePath, lengths, { lat: item.lat, lng: item.lng })

      let speedMs: number
      if (prev && elapsedSec > MIN_ELAPSED_FOR_SPEED) {
        // Derive speed from displacement between consecutive API positions
        const dist = haversineDistance(prev.apiLat, prev.apiLng, item.lat, item.lng)
        speedMs = Math.min(dist / elapsedSec, MAX_SPEED)
      } else {
        speedMs = prev?.speedMs ?? MAX_SPEED / 2
      }

      // --- Forward-only constraint ---
      // The animation must never visibly move backward. If the animated position
      // is still behind the API position (mappedProgress ≤ progress), keep the
      // animated position so the tram moves forward naturally. If the API position
      // jumped backward (segment correction, data glitch), snap to the API
      // position to avoid the tram overshooting the actual location.
      let progressMeters: number
      if (prev) {
        const animatedPos = positionAtProgress(prev.path, prev.pathLengths, prev.progressMeters)
        const mappedProgress = findProgressOnPath(shapePath, lengths, animatedPos)
        progressMeters = mappedProgress <= progress ? mappedProgress : progress
      } else {
        progressMeters = progress
      }

      animStateRef.current.set(item.id, {
        path: shapePath,
        pathLengths: lengths,
        totalLength: total,
        progressMeters,
        speedMs,
        etaAtUpdate: item.eta,
        updateTime: now,
        apiLat: item.lat,
        apiLng: item.lng,
        segmentKey: makeSegmentKey(item.stopAId, item.stopBId),
      })
    }

    // Remove trams no longer in the API response
    const currentIds = new Set(apiTrams.map(t => t.id))
    for (const id of animStateRef.current.keys()) {
      if (!currentIds.has(id)) animStateRef.current.delete(id)
    }
    for (const id of positionsRef.current.keys()) {
      if (!currentIds.has(id)) positionsRef.current.delete(id)
    }
  }, [apiTrams])

  // requestAnimationFrame loop — throttled to ~10 fps
  useEffect(() => {
    function animationFrame(now: number) {
      if (pausedRef.current) {
        lastFrameTimeRef.current = null
        rafRef.current = requestAnimationFrame(animationFrame)
        return
      }

      // Throttle: skip frames that arrive sooner than 100 ms after the last one
      const prevTime = lastFrameTimeRef.current
      if (prevTime !== null && now - prevTime < 100) {
        rafRef.current = requestAnimationFrame(animationFrame)
        return
      }

      const dt = prevTime !== null ? (now - prevTime) / 1000 : 0
      lastFrameTimeRef.current = now

      for (const [id, state] of animStateRef.current) {
        const elapsedSec = (now - state.updateTime) / 1000
        const currentEta = state.etaAtUpdate - elapsedSec

        // Deceleration factor: linear ramp from 1→0 in the last DECEL_THRESHOLD seconds
        const factor = Math.max(0, Math.min(1, currentEta / DECEL_THRESHOLD))

        // --- Speed priority chain ---
        // Three sources of speed, in decreasing priority:
        //   1. GPS override  — measured from a user physically on the tram
        //   2. Segment graph — community-contributed speed profile (bell curve)
        //   3. API-derived   — estimated from displacement between API ticks
        // All are multiplied by `factor` (1→0 ramp near arrival) so the tram
        // decelerates smoothly into the stop rather than snapping to zero.
        const override = speedOverridesRef.current.get(id)
        const graph = segmentGraphsRef.current.get(state.segmentKey)
        let speedMs: number
        if (override !== undefined) {
          speedMs = override * factor
        } else if (graph) {
          speedMs = interpolateSpeed(graph.points, currentEta) * factor
        } else {
          speedMs = state.speedMs * factor
        }
        const moveDist = speedMs * dt

        // Advance along path, clamped at the next stop (totalLength)
        state.progressMeters = Math.min(state.progressMeters + moveDist, state.totalLength)

        const pos = positionAtProgress(state.path, state.pathLengths, state.progressMeters)
        const bearing = bearingAtProgress(state.path, state.pathLengths, state.progressMeters)

        // Compute body wagon positions by rewinding along the polyline
        const w1Progress = Math.max(0, state.progressMeters - WAGON_GAP_M)
        const w2Progress = Math.max(0, state.progressMeters - 2 * WAGON_GAP_M)
        const w1Pos = positionAtProgress(state.path, state.pathLengths, w1Progress)
        const w2Pos = positionAtProgress(state.path, state.pathLengths, w2Progress)
        const w1Bearing = bearingAtProgress(state.path, state.pathLengths, w1Progress)
        const w2Bearing = bearingAtProgress(state.path, state.pathLengths, w2Progress)

        positionsRef.current.set(id, {
          lat: pos.lat,
          lng: pos.lng,
          bearing,
          wagons: [
            { lat: w1Pos.lat, lng: w1Pos.lng, bearing: w1Bearing },
            { lat: w2Pos.lat, lng: w2Pos.lng, bearing: w2Bearing },
          ],
        })
      }
      rafRef.current = requestAnimationFrame(animationFrame)
    }

    rafRef.current = requestAnimationFrame(animationFrame)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return positionsRef
}
