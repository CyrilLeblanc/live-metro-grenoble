import React, { useEffect, useRef } from 'react'
import { haversineDistance, makeSegmentKey, AveragedGraph, LatLng } from '../lib/geo'
import { DECEL_THRESHOLD, MAX_SPEED } from '../lib/config'
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

export interface AnimatedPosition {
  lat: number
  lng: number
  bearing: number
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
      if (prev && elapsedSec > 0.1) {
        // Derive speed from displacement between consecutive API positions
        const dist = haversineDistance(prev.apiLat, prev.apiLng, item.lat, item.lng)
        speedMs = Math.min(dist / elapsedSec, MAX_SPEED)
      } else {
        speedMs = prev?.speedMs ?? MAX_SPEED / 2
      }

      let progressMeters: number
      if (prev) {
        // Map the current animated position onto the new path
        const animatedPos = positionAtProgress(prev.path, prev.pathLengths, prev.progressMeters)
        const mappedProgress = findProgressOnPath(shapePath, lengths, animatedPos)
        // Forward-only: keep animated position for smooth movement.
        // Backward jump (e.g. API correction): snap to the API position.
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

  // requestAnimationFrame loop — runs at ~60 fps
  useEffect(() => {
    function frame(now: number) {
      if (pausedRef.current) {
        lastFrameTimeRef.current = null
        rafRef.current = requestAnimationFrame(frame)
        return
      }

      const dt = lastFrameTimeRef.current !== null ? (now - lastFrameTimeRef.current) / 1000 : 0
      lastFrameTimeRef.current = now

      for (const [id, state] of animStateRef.current) {
        const elapsedSec = (now - state.updateTime) / 1000
        const currentEta = state.etaAtUpdate - elapsedSec

        // Deceleration factor: linear ramp from 1→0 in the last DECEL_THRESHOLD seconds
        const factor = Math.max(0, Math.min(1, currentEta / DECEL_THRESHOLD))

        const override = speedOverridesRef.current.get(id)
        const graph = segmentGraphsRef.current.get(state.segmentKey)
        let speedMs: number
        if (override !== undefined) {
          // GPS user's measured speed takes highest priority
          speedMs = override * factor
        } else if (graph) {
          // Community-contributed speed profile for this segment
          speedMs = interpolateSpeed(graph.points, currentEta) * factor
        } else {
          // Fall back to API-derived speed estimate
          speedMs = state.speedMs * factor
        }
        const moveDist = speedMs * dt

        // Advance along path, clamped at the next stop (totalLength)
        state.progressMeters = Math.min(state.progressMeters + moveDist, state.totalLength)

        const pos = positionAtProgress(state.path, state.pathLengths, state.progressMeters)
        const bearing = bearingAtProgress(state.path, state.pathLengths, state.progressMeters)
        positionsRef.current.set(id, { lat: pos.lat, lng: pos.lng, bearing })
      }
      rafRef.current = requestAnimationFrame(frame)
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return positionsRef
}
