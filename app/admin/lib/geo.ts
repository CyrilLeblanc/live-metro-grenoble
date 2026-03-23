/**
 * Pure geometry utilities for the Admin Geodata tool.
 *
 * No React, no Leaflet, no side effects — every function here takes plain
 * data and returns plain data. Safe to unit-test in isolation.
 */

import type { LatLng } from '../../../lib/geo'
import { makeSegmentKey } from '../../../lib/geo'
import type { OsmWay, CutPoint } from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Snap threshold in degrees (~10 m) used to detect overlapping polyline endpoints. */
const OVERLAP_SNAP_DEG = 0.0001

// ─── Colour helper ────────────────────────────────────────────────────────────

/** Ensures a GTFS route_color (may or may not have a leading #) is CSS-ready. */
export function hexColor(c: string): string {
  return c.startsWith('#') ? c : `#${c}`
}

// ─── Basic distance ───────────────────────────────────────────────────────────

/** Euclidean distance between two LatLng points (in degrees). */
export function distLatLng(a: LatLng, b: LatLng): number {
  return Math.hypot(a.lat - b.lat, a.lng - b.lng)
}

// ─── Orthogonal projection ────────────────────────────────────────────────────

/**
 * Projects `cursor` onto the nearest segment of `polyline`.
 * Returns the projected point, the segment index, and the interpolation
 * parameter t ∈ [0,1]. Returns null if the polyline has fewer than 2 points.
 */
export function projectPointOnPolyline(
  cursor: LatLng,
  polyline: LatLng[]
): { point: LatLng; segIdx: number; t: number } | null {
  if (polyline.length < 2) return null

  let bestDist = Infinity
  let best: { point: LatLng; segIdx: number; t: number } | null = null

  for (let i = 0; i < polyline.length - 1; i++) {
    const A = polyline[i]
    const B = polyline[i + 1]
    const dx = B.lng - A.lng
    const dy = B.lat - A.lat
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) continue

    const t = Math.max(0, Math.min(1, ((cursor.lng - A.lng) * dx + (cursor.lat - A.lat) * dy) / lenSq))
    const proj: LatLng = { lat: A.lat + t * dy, lng: A.lng + t * dx }
    const dist = Math.hypot(cursor.lat - proj.lat, cursor.lng - proj.lng)

    if (dist < bestDist) {
      bestDist = dist
      best = { point: proj, segIdx: i, t }
    }
  }

  return best
}

// ─── Polyline trimming ────────────────────────────────────────────────────────

/**
 * Trims `polyline` to the sub-path between the projections of `from` and `to`.
 * The result always runs from→to regardless of which endpoint appears first
 * along the raw polyline (reversing if necessary).
 * Returns the original polyline unchanged if either stop cannot be projected.
 */
export function trimPolylineBetweenPoints(
  polyline: LatLng[],
  from: LatLng,
  to: LatLng
): LatLng[] {
  if (polyline.length < 2) return polyline

  const projFrom = projectPointOnPolyline(from, polyline)
  const projTo   = projectPointOnPolyline(to,   polyline)
  if (!projFrom || !projTo) return polyline

  const posFrom = projFrom.segIdx + projFrom.t
  const posTo   = projTo.segIdx   + projTo.t

  const [startProj, endProj, reverse] =
    posFrom <= posTo
      ? [projFrom, projTo,   false]
      : [projTo,   projFrom, true]

  const result: LatLng[] = [startProj.point]
  for (let i = startProj.segIdx + 1; i <= endProj.segIdx; i++) {
    result.push(polyline[i])
  }
  result.push(endProj.point)

  return reverse ? result.reverse() : result
}

// ─── Way joining ──────────────────────────────────────────────────────────────

/** Returns the index of the first point in `polyline` within OVERLAP_SNAP_DEG of `p`, or -1. */
function findOverlapJunction(p: LatLng, polyline: LatLng[]): number {
  for (let i = 0; i < polyline.length; i++) {
    if (distLatLng(p, polyline[i]) < OVERLAP_SNAP_DEG) return i
  }
  return -1
}

type JoinAction = 'appendFwd' | 'appendRev' | 'prependFwd' | 'prependRev'

/**
 * Appends or prepends `coords` to `poly`, trimming any overlapping junction
 * point so that the resulting polyline has no duplicate vertex at the join.
 */
function applyJoin(poly: LatLng[], coords: LatLng[], action: JoinAction): LatLng[] {
  switch (action) {
    case 'appendFwd': {
      const idx = findOverlapJunction(poly[poly.length - 1], coords)
      return [...poly, ...(idx >= 0 ? coords.slice(idx + 1) : coords)]
    }
    case 'appendRev': {
      const rev = [...coords].reverse()
      const idx = findOverlapJunction(poly[poly.length - 1], rev)
      return [...poly, ...(idx >= 0 ? rev.slice(idx + 1) : rev)]
    }
    case 'prependFwd': {
      const idx = findOverlapJunction(poly[0], coords)
      return [...(idx >= 0 ? coords.slice(0, idx) : coords), ...poly]
    }
    case 'prependRev': {
      const rev = [...coords].reverse()
      const idx = findOverlapJunction(poly[0], rev)
      return [...(idx >= 0 ? rev.slice(0, idx) : rev), ...poly]
    }
  }
}

// ─── Way assembly ─────────────────────────────────────────────────────────────

/**
 * Assembles a set of disjoint OSM ways into a single continuous polyline.
 *
 * Uses a greedy nearest-neighbour algorithm with direction-continuity scoring:
 * at each step, the candidate score is `distance × penalty` where the penalty
 * grows as the joining angle increases (up to 6× for a full U-turn). This
 * prevents the algorithm from choosing a branching or looping way when a
 * straight-ahead continuation is available nearby.
 */
export function assembleWays(ways: OsmWay[]): LatLng[] {
  if (ways.length === 0) return []
  if (ways.length === 1) return [...ways[0].coords]

  type Dir = { dlat: number; dlng: number }
  const dir = (a: LatLng, b: LatLng): Dir => ({ dlat: b.lat - a.lat, dlng: b.lng - a.lng })

  // Score = dist × penalty.
  // penalty ≈ 1 when the incoming direction aligns with the existing direction
  // (cos ≈ 1), rising to 6× for a direct U-turn (cos = -1).
  const score = (dist: number, incomingDir: Dir | null, existingDir: Dir | null): number => {
    if (!incomingDir || !existingDir) return dist
    const wLen = Math.hypot(incomingDir.dlat, incomingDir.dlng)
    const pLen = Math.hypot(existingDir.dlat, existingDir.dlng)
    if (wLen === 0 || pLen === 0) return dist
    const cos =
      (incomingDir.dlat * existingDir.dlat + incomingDir.dlng * existingDir.dlng) / (wLen * pLen)
    const penalty = cos < 0 ? 1 + (-cos) * 5 : 1
    return dist * penalty
  }

  const remaining = [...ways]
  let poly: LatLng[] = [...remaining.splice(0, 1)[0].coords]

  while (remaining.length > 0) {
    const polyStart = poly[0]
    const polyEnd = poly[poly.length - 1]
    // Direction the polyline is travelling at its two endpoints
    const endDir: Dir | null = poly.length >= 2 ? dir(poly[poly.length - 2], poly[poly.length - 1]) : null
    const startDir: Dir | null = poly.length >= 2 ? dir(poly[1], poly[0]) : null

    let bestIdx = 0
    let bestScore = Infinity
    let bestAction: JoinAction = 'appendFwd'

    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i].coords
      const n = c.length

      const opts: [number, JoinAction][] = [
        [score(distLatLng(polyEnd, c[0]),     n >= 2 ? dir(c[0], c[1])         : null, endDir),   'appendFwd'],
        [score(distLatLng(polyEnd, c[n - 1]), n >= 2 ? dir(c[n - 1], c[n - 2]) : null, endDir),   'appendRev'],
        [score(distLatLng(polyStart, c[n - 1]), n >= 2 ? dir(c[n - 2], c[n - 1]) : null, startDir), 'prependFwd'],
        [score(distLatLng(polyStart, c[0]),     n >= 2 ? dir(c[1], c[0])         : null, startDir), 'prependRev'],
      ]

      for (const [s, action] of opts) {
        if (s < bestScore) { bestScore = s; bestIdx = i; bestAction = action }
      }
    }

    const [way] = remaining.splice(bestIdx, 1)
    poly = applyJoin(poly, way.coords, bestAction)
  }

  return poly
}

/**
 * Sorts a set of way IDs into a geographically sequential order using greedy
 * nearest-endpoint search. Returns the sorted ID array.
 *
 * Used to reorder OSM relation members whose list order may be arbitrary.
 */
export function sortWayIdsByProximity(ways: OsmWay[], wayIds: number[]): number[] {
  const wayMap = new Map(ways.map((w) => [w.id, w]))
  const toSort = wayIds.map((id) => wayMap.get(id)).filter(Boolean) as OsmWay[]
  if (toSort.length <= 1) return toSort.map((w) => w.id)

  const remaining = [...toSort]
  const result: OsmWay[] = [remaining.splice(0, 1)[0]]
  let currentEnd = result[0].coords[result[0].coords.length - 1]

  while (remaining.length > 0) {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i].coords
      const d = Math.min(distLatLng(currentEnd, c[0]), distLatLng(currentEnd, c[c.length - 1]))
      if (d < bestDist) { bestDist = d; bestIdx = i }
    }
    const [way] = remaining.splice(bestIdx, 1)
    result.push(way)
    const c = way.coords
    currentEnd = distLatLng(currentEnd, c[0]) <= distLatLng(currentEnd, c[c.length - 1])
      ? c[c.length - 1]
      : c[0]
  }
  return result.map((w) => w.id)
}

/**
 * Assembles ways in a fixed order, choosing fwd/rev for each way based on
 * which endpoint is closest to the current polyline tail.
 *
 * Used when an OSM relation provides a canonical member sequence.
 */
export function assembleOrderedWays(ways: OsmWay[], orderedIds: number[]): LatLng[] {
  const wayMap = new Map(ways.map((w) => [w.id, w]))
  const ordered = orderedIds.map((id) => wayMap.get(id)).filter(Boolean) as OsmWay[]
  if (ordered.length === 0) return []
  if (ordered.length === 1) return [...ordered[0].coords]

  let poly: LatLng[] = [...ordered[0].coords]
  for (let i = 1; i < ordered.length; i++) {
    const c = ordered[i].coords
    const polyEnd = poly[poly.length - 1]
    const action: JoinAction =
      distLatLng(polyEnd, c[0]) <= distLatLng(polyEnd, c[c.length - 1]) ? 'appendFwd' : 'appendRev'
    poly = applyJoin(poly, c, action)
  }
  return poly
}

// ─── Segment extraction ───────────────────────────────────────────────────────

/**
 * Extracts the sub-polyline between two cut points (or from/to a polyline
 * endpoint when `from`/`to` is null). The returned segment starts at
 * `from.latlng` and ends at `to.latlng` with the intermediate vertices taken
 * from `poly`.
 */
export function extractSubPolyline(
  poly: LatLng[],
  from: CutPoint | null,
  to: CutPoint | null
): LatLng[] {
  const startIdx = from ? from.indexOnPolyline : 0
  const endIdx = to ? to.indexOnPolyline + 1 : poly.length - 1

  const result: LatLng[] = []
  if (from) result.push(from.latlng)
  for (let i = startIdx + 1; i < endIdx; i++) result.push(poly[i])
  if (to) result.push(to.latlng)
  return result
}

/**
 * Builds the full segment-paths record from an assembled polyline and its cut
 * points. Returns a `Record<segmentKey, LatLng[]>` ready to be merged into
 * `segment-paths.json`.
 *
 * Cut points are sorted by their position along the polyline before extraction.
 */
export function buildSegmentPaths(
  assembledPolyline: LatLng[],
  cutPoints: CutPoint[]
): Record<string, LatLng[]> {
  const sorted = [...cutPoints].sort((a, b) =>
    a.indexOnPolyline !== b.indexOnPolyline
      ? a.indexOnPolyline - b.indexOnPolyline
      : a.tOnSegment - b.tOnSegment
  )

  const result: Record<string, LatLng[]> = {}
  const allPoints = [null, ...sorted, null]

  for (let i = 0; i < allPoints.length - 1; i++) {
    const from = allPoints[i] as CutPoint | null
    const to = allPoints[i + 1] as CutPoint | null
    if (!from || !to) continue
    result[makeSegmentKey(from.stopId, to.stopId)] = extractSubPolyline(assembledPolyline, from, to)
  }

  return result
}
