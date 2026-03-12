import { useEffect, useRef, useState } from 'react'

const DECEL_THRESHOLD = 20 // seconds before stop where deceleration begins
const MAX_SPEED = 6.94     // m/s (25 km/h)
const RAD = Math.PI / 180

interface LatLng { lat: number; lng: number }

export interface TramApiItem {
  id: string
  lat: number
  lng: number
  eta: number
  shapePath: LatLng[]
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
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * RAD
  const dLng = (lng2 - lng1) * RAD
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
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

export function useAnimatedTrams(apiTrams: TramApiItem[]): Map<string, LatLng> {
  const animStateRef = useRef<Map<string, TramAnimState>>(new Map())
  const lastApiTimeRef = useRef<number>(0)
  const rafRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number | null>(null)
  const [positions, setPositions] = useState<Map<string, LatLng>>(new Map())

  // Update anim state on each API update
  useEffect(() => {
    if (apiTrams.length === 0) return

    const now = performance.now()
    const elapsedSec = (now - lastApiTimeRef.current) / 1000
    lastApiTimeRef.current = now

    for (const item of apiTrams) {
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

      animStateRef.current.set(item.id, {
        path: item.shapePath,
        pathLengths: lengths,
        totalLength: total,
        progressMeters: progress,
        speedMs,
        etaAtUpdate: item.eta,
        updateTime: now,
        apiLat: item.lat,
        apiLng: item.lng,
      })
    }

    // Remove trams no longer in the API response
    const currentIds = new Set(apiTrams.map(t => t.id))
    for (const id of animStateRef.current.keys()) {
      if (!currentIds.has(id)) animStateRef.current.delete(id)
    }
  }, [apiTrams])

  // Animation loop
  useEffect(() => {
    function frame(now: number) {
      const dt = lastFrameTimeRef.current !== null ? (now - lastFrameTimeRef.current) / 1000 : 0
      lastFrameTimeRef.current = now

      const newPositions = new Map<string, LatLng>()

      for (const [id, state] of animStateRef.current) {
        const elapsedSec = (now - state.updateTime) / 1000
        const currentEta = state.etaAtUpdate - elapsedSec
        const factor = Math.max(0, Math.min(1, currentEta / DECEL_THRESHOLD))
        const moveDist = state.speedMs * factor * dt

        // Advance along path, clamped at stop (totalLength)
        state.progressMeters = Math.min(state.progressMeters + moveDist, state.totalLength)

        newPositions.set(id, positionAtProgress(state.path, state.pathLengths, state.progressMeters))
      }

      setPositions(new Map(newPositions))
      rafRef.current = requestAnimationFrame(frame)
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return positions
}
