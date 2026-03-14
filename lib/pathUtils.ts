import { haversineDistance } from './geo'

interface LatLng { lat: number; lng: number }

/**
 * Builds a cumulative-distance array for a polyline path.
 *
 * `lengths[i]` is the total metres from `path[0]` to `path[i]`.
 * `lengths[0]` is always 0. Uses the Haversine formula for accuracy.
 *
 * @returns `{ lengths, total }` where `total` is the full path length in metres.
 */
export function buildPathLengths(path: LatLng[]): { lengths: number[]; total: number } {
  const lengths = [0]
  for (let i = 1; i < path.length; i++) {
    lengths.push(lengths[i - 1] + haversineDistance(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng))
  }
  return { lengths, total: lengths[lengths.length - 1] ?? 0 }
}

/**
 * Finds the cumulative distance along `path` of the point nearest to `pos`.
 *
 * Used to map an API-reported lat/lng back onto the animation path so the
 * tram can smoothly continue from its animated position after each API update.
 */
export function findProgressOnPath(path: LatLng[], lengths: number[], pos: LatLng): number {
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

/**
 * Returns the bearing (degrees) of travel at a given distance `progress` along `path`,
 * by looking `lookaheadMeters` ahead. Used to rotate tram sprites in the direction they
 * are actually moving rather than using the stale API-reported bearing.
 */
export function bearingAtProgress(path: LatLng[], lengths: number[], progress: number, lookaheadMeters = 15): number {
  const total = lengths[lengths.length - 1] ?? 0
  const aheadProgress = Math.min(progress + lookaheadMeters, total)
  const from = positionAtProgress(path, lengths, progress)
  const to = positionAtProgress(path, lengths, aheadProgress)
  const dLat = to.lat - from.lat
  const dLon = to.lng - from.lng
  return (Math.atan2(dLon, dLat) * 180) / Math.PI
}

/**
 * Returns the smallest index i (1 ≤ i ≤ lengths.length-1) such that lengths[i] >= progress.
 * lengths is guaranteed sorted ascending by buildPathLengths.
 */
function upperBound(lengths: number[], progress: number): number {
  let lo = 1
  let hi = lengths.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (lengths[mid] < progress) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Returns the interpolated lat/lng on `path` at a given distance `progress` (metres).
 *
 * Uses binary search on the cumulative-distance array to find the segment containing
 * `progress`, then linearly interpolates between its two endpoints.
 */
export function positionAtProgress(path: LatLng[], lengths: number[], progress: number): LatLng {
  if (path.length === 0) return { lat: 0, lng: 0 }
  if (path.length === 1) return path[0]

  const i = upperBound(lengths, progress)

  const segLen = lengths[i] - lengths[i - 1]
  const t = segLen === 0 ? 0 : Math.min(1, (progress - lengths[i - 1]) / segLen)
  return {
    lat: path[i - 1].lat + t * (path[i].lat - path[i - 1].lat),
    lng: path[i - 1].lng + t * (path[i].lng - path[i - 1].lng),
  }
}
