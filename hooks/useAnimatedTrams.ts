import React, { useEffect, useRef } from 'react'
import { haversineDistance, makeSegmentKey, AveragedGraph } from '../lib/geo'

const DECEL_THRESHOLD = 20 // seconds before stop where deceleration begins
const MAX_SPEED = 6.94     // m/s (25 km/h)

interface LatLng { lat: number; lng: number }

export interface TramApiItem {
  id: string
  lat: number
  lng: number
  eta: number
  bearing: number
  shapePath: LatLng[]
  stopAId: string
  stopBId: string
  line: string
  lineColor: string
  direction: string
  nextStop: string
  isRealtime: boolean
}

export interface TramPosition {
  lat: number
  lng: number
  bearing: number
}

interface TramAnimState {
  path: LatLng[]
  pathLengths: number[]   // cumulative distances in meters, length = path.length
  totalLength: number
  progressMeters: number  // current position along path (mutated each frame)
  speedMs: number
  etaAtUpdate: number
  updateTime: number      // performance.now() at last API update
  apiLat: number          // position at last API update (for speed computation)
  apiLng: number
  bearing: number
  segmentKey: string
}

function buildPathLengths(path: LatLng[]): { lengths: number[]; total: number } {
  const lengths = [0]
  for (let i = 1; i < path.length; i++) {
    lengths.push(lengths[i - 1] + haversineDistance(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng))
  }
  return { lengths, total: lengths[lengths.length - 1] ?? 0 }
}

// Find the cumulative distance along path of the point nearest to pos
function findProgressOnPath(path: LatLng[], lengths: number[], pos: LatLng): number {
  let bestDist = Infinity
  let bestProgress = 0
  for (let i = 0; i < path.length; i++) {
    const d = haversineDistance(pos.lat, pos.lng, path[i].lat, path[i].lng)
    if (d < bestDist) {
      bestDist = d
      bestProgress = lengths[i]
    }
  }
  return bestProgress
}

function positionAtProgress(path: LatLng[], lengths: number[], progress: number): LatLng {
  if (path.length === 0) return { lat: 0, lng: 0 }
  if (path.length === 1) return path[0]
  for (let i = 1; i < path.length; i++) {
    if (lengths[i] >= progress || i === path.length - 1) {
      const segLen = lengths[i] - lengths[i - 1]
      const t = segLen === 0 ? 0 : Math.min(1, (progress - lengths[i - 1]) / segLen)
      return {
        lat: path[i - 1].lat + t * (path[i].lat - path[i - 1].lat),
        lng: path[i - 1].lng + t * (path[i].lng - path[i - 1].lng),
      }
    }
  }
  return path[path.length - 1]
}

function speedFromGraph(graph: AveragedGraph, eta: number): number {
  const t = graph.totalDurationSec - eta
  const pts = graph.points
  if (pts.length === 0) return 0
  if (t <= pts[0].tSec) return pts[0].speedMs
  if (t >= pts[pts.length - 1].tSec) return pts[pts.length - 1].speedMs
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].tSec >= t) {
      const prev = pts[i - 1]
      const next = pts[i]
      const span = next.tSec - prev.tSec
      const frac = span === 0 ? 0 : (t - prev.tSec) / span
      return prev.speedMs + frac * (next.speedMs - prev.speedMs)
    }
  }
  return pts[pts.length - 1].speedMs
}

export function useAnimatedTrams(
  apiTrams: TramApiItem[],
  segmentGraphs?: Map<string, AveragedGraph>,
  speedOverrides?: Map<string, number>,
): React.RefObject<Map<string, TramPosition>> {
  const animStateRef = useRef<Map<string, TramAnimState>>(new Map())
  const positionsRef = useRef<Map<string, TramPosition>>(new Map())
  const lastApiTimeRef = useRef<number>(0)
  const rafRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number | null>(null)
  const segmentGraphsRef = useRef<Map<string, AveragedGraph>>(segmentGraphs ?? new Map())
  const speedOverridesRef = useRef<Map<string, number>>(speedOverrides ?? new Map())

  useEffect(() => {
    segmentGraphsRef.current = segmentGraphs ?? new Map()
  }, [segmentGraphs])

  useEffect(() => {
    speedOverridesRef.current = speedOverrides ?? new Map()
  }, [speedOverrides])

  // Update anim state on each API update
  useEffect(() => {
    if (apiTrams.length === 0) return

    const now = performance.now()
    const elapsedSec = (now - lastApiTimeRef.current) / 1000
    lastApiTimeRef.current = now

    for (const item of apiTrams) {
      // Always write initial API position so trams without paths still appear
      if (!positionsRef.current.has(item.id)) {
        positionsRef.current.set(item.id, { lat: item.lat, lng: item.lng, bearing: item.bearing })
      }

      if (!item.shapePath || item.shapePath.length < 2) continue

      const prev = animStateRef.current.get(item.id)
      const { lengths, total } = buildPathLengths(item.shapePath)
      const progress = findProgressOnPath(item.shapePath, lengths, { lat: item.lat, lng: item.lng })

      let speedMs: number
      if (prev && elapsedSec > 0.1) {
        const dist = haversineDistance(prev.apiLat, prev.apiLng, item.lat, item.lng)
        speedMs = Math.min(dist / elapsedSec, MAX_SPEED)
      } else {
        speedMs = prev?.speedMs ?? MAX_SPEED / 2
      }

      let progressMeters: number
      if (prev) {
        const animatedPos = positionAtProgress(prev.path, prev.pathLengths, prev.progressMeters)
        const mappedProgress = findProgressOnPath(item.shapePath, lengths, animatedPos)
        // Forward: keep animated position (smooth). Backward: snap to API position.
        progressMeters = mappedProgress <= progress ? mappedProgress : progress
      } else {
        progressMeters = progress
      }

      animStateRef.current.set(item.id, {
        path: item.shapePath,
        pathLengths: lengths,
        totalLength: total,
        progressMeters,
        speedMs,
        etaAtUpdate: item.eta,
        updateTime: now,
        apiLat: item.lat,
        apiLng: item.lng,
        bearing: item.bearing,
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

  // Animation loop
  useEffect(() => {
    function frame(now: number) {
      const dt = lastFrameTimeRef.current !== null ? (now - lastFrameTimeRef.current) / 1000 : 0
      lastFrameTimeRef.current = now

      for (const [id, state] of animStateRef.current) {
        const elapsedSec = (now - state.updateTime) / 1000
        const currentEta = state.etaAtUpdate - elapsedSec
        const factor = Math.max(0, Math.min(1, currentEta / DECEL_THRESHOLD))

        const override = speedOverridesRef.current.get(id)
        const graph = segmentGraphsRef.current.get(state.segmentKey)
        let speedMs: number
        if (override !== undefined) {
          speedMs = override * factor
        } else if (graph) {
          speedMs = speedFromGraph(graph, currentEta) * factor
        } else {
          speedMs = state.speedMs * factor
        }
        const moveDist = speedMs * dt

        // Advance along path, clamped at stop (totalLength)
        state.progressMeters = Math.min(state.progressMeters + moveDist, state.totalLength)

        const pos = positionAtProgress(state.path, state.pathLengths, state.progressMeters)
        positionsRef.current.set(id, { lat: pos.lat, lng: pos.lng, bearing: state.bearing })
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
