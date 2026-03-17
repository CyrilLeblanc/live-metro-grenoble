/**
 * Data-fetching and persistence helpers for the Admin Geodata tool.
 *
 * All functions are async and return plain data — no React state, no Leaflet.
 * The AdminMap coordinator calls these and forwards the results to setState.
 */

import type { Cluster } from '../../../lib/gtfs'
import { getClusterId } from '../../../lib/gtfs'
import { fetchGtfsStatic } from '../../../lib/api'
import { GRENOBLE_BOUNDS } from '../../../lib/config'
import type { LatLng } from '../../../lib/geo'
import type { OverpassData, OsmWay, OsmRelation, TripEntry, TripStop } from '../types'

// ─── Overpass cache ───────────────────────────────────────────────────────────

// Module-level so it survives React re-mounts within a browser session.
let overpassCache: OverpassData | null = null

/** Clears the cached Overpass result (useful for manual refresh). */
export function clearOverpassCache(): void {
  overpassCache = null
}

// ─── Stop / trip caches for the selectTrip flow ───────────────────────────────

// Stored after loadTripEntries() so that getTripStops() can be called without
// passing the full maps through component props.
let stopByIdCache: Map<string, TripStop> | null = null
let tripStopTimesCache: Map<string, Array<{ trip_id: string; stop_id: string; stop_sequence: number }>> | null = null

/**
 * Returns the ordered list of stops for a given trip_id.
 * Only works after loadTripEntries() has been called at least once.
 */
export function getTripStops(tripId: string): TripStop[] {
  if (!stopByIdCache || !tripStopTimesCache) return []
  const sts = [...(tripStopTimesCache.get(tripId) ?? [])]
  sts.sort((a, b) => a.stop_sequence - b.stop_sequence)
  return sts.map((st) => stopByIdCache!.get(st.stop_id)).filter(Boolean) as TripStop[]
}

// ─── Tram stops ───────────────────────────────────────────────────────────────

/**
 * Returns tram stops from the GTFS bundle.
 * stops.json is already filtered to tram-only stops by parse-gtfs.js.
 */
export async function loadTramStops(): Promise<TripStop[]> {
  const { stops } = await fetchGtfsStatic()
  return stops.map((s) => ({ stop_id: s.stop_id, stop_name: s.stop_name, stop_lat: s.stop_lat, stop_lon: s.stop_lon }))
}

// ─── Clusters ─────────────────────────────────────────────────────────────────

/**
 * Loads clusters for the Clusters mode.
 *
 * Tries `GET /api/admin/geodata?file=clusters` first. Falls back to deriving
 * cluster centroids from the GTFS stop/stop_time data when the file is absent.
 *
 * Also returns the raw GTFS stop list for the background dot overlay.
 */
export async function loadClusters(): Promise<{ stops: TripStop[]; clusters: Cluster[] }> {
  const { routes, stops, stopTimes, trips } = await fetchGtfsStatic()

  const gtfsStops: TripStop[] = stops.map((s) => ({
    stop_id: s.stop_id,
    stop_name: s.stop_name,
    stop_lat: s.stop_lat,
    stop_lon: s.stop_lon,
  }))

  // Try loading the saved clusters.json
  let saved: Cluster[] | null = null
  try {
    const res = await fetch('/api/admin/geodata?file=clusters')
    if (res.ok) saved = await res.json()
  } catch { /* ignore */ }

  if (saved && saved.length > 0) {
    return { stops: gtfsStops, clusters: saved }
  }

  // Fallback: derive cluster centroids from GTFS
  const tripRouteMap = new Map<string, string>()
  for (const t of trips) tripRouteMap.set(t.trip_id, t.route_id)

  const stopById = new Map(stops.map((s) => [s.stop_id, s]))

  // Group member stops by cluster ID
  const clusterStops = new Map<string, typeof stops>()
  for (const s of stops) {
    const cid = getClusterId(s)
    if (!clusterStops.has(cid)) clusterStops.set(cid, [])
    clusterStops.get(cid)!.push(s)
  }

  // Collect stop IDs and names per cluster from stop_times
  const clusterStopIds = new Map<string, Set<string>>()
  const clusterNames = new Map<string, string>()
  for (const st of stopTimes) {
    const stop = stopById.get(st.stop_id)
    if (!stop) continue
    const cid = getClusterId(stop)
    if (!clusterStopIds.has(cid)) clusterStopIds.set(cid, new Set())
    clusterStopIds.get(cid)!.add(st.stop_id)
    if (!clusterNames.has(cid)) clusterNames.set(cid, stop.stop_name)
  }

  const derived: Cluster[] = []
  for (const [cid, members] of clusterStops) {
    if (!clusterNames.has(cid)) continue
    const lat = members.reduce((s, m) => s + m.stop_lat, 0) / members.length
    const lng = members.reduce((s, m) => s + m.stop_lon, 0) / members.length
    derived.push({
      id: cid,
      name: clusterNames.get(cid)!,
      lat,
      lng,
      stopIds: [...(clusterStopIds.get(cid) ?? [])],
    })
  }

  return { stops: gtfsStops, clusters: derived }
}

// ─── Trips ────────────────────────────────────────────────────────────────────

/**
 * Loads and deduplicates GTFS trips for the Step 1 selector.
 *
 * Fetches raw trips.json (not the bundle) because TripClient strips
 * direction_id and trip_headsign. Also populates the module-level stop
 * caches so that getTripStops() works after this call.
 */
export async function loadTripEntries(): Promise<{
  tripEntries: TripEntry[]
  routeColorMap: Map<string, string>
}> {
  const { routes, stops, stopTimes } = await fetchGtfsStatic()

  const colorMap = new Map<string, string>()
  const nameMap = new Map<string, string>()
  for (const r of routes) {
    colorMap.set(r.route_id, r.route_color)
    nameMap.set(r.route_id, r.route_short_name)
  }

  // Fetch full trips.json — the bundle's TripClient omits direction_id and trip_headsign
  type RawTrip = {
    trip_id: string
    route_id: string
    direction_id: string
    trip_headsign?: string
    shape_id: string
  }
  let rawTrips: RawTrip[] = []
  try {
    const res = await fetch('/gtfs/trips.json')
    if (res.ok) rawTrips = await res.json()
  } catch { /* ignore */ }

  // Deduplicate by (route_id, direction_id, trip_headsign)
  const seen = new Map<string, TripEntry>()
  for (const t of rawTrips) {
    const dirId = parseInt(t.direction_id, 10) || 0
    const headsign = t.trip_headsign ?? ''
    const key = `${t.route_id}|${dirId}|${headsign}`
    if (!seen.has(key)) {
      seen.set(key, {
        key,
        route_id: t.route_id,
        direction_id: dirId,
        trip_headsign: headsign,
        trip_id: t.trip_id,
        route_short_name: nameMap.get(t.route_id) ?? t.route_id,
        route_color: colorMap.get(t.route_id) ?? 'cccccc',
      })
    }
  }

  // Cache stop data for later use in getTripStops()
  stopByIdCache = new Map(
    stops.map((s) => [s.stop_id, { stop_id: s.stop_id, stop_name: s.stop_name, stop_lat: s.stop_lat, stop_lon: s.stop_lon }])
  )
  tripStopTimesCache = new Map<string, Array<{ trip_id: string; stop_id: string; stop_sequence: number }>>()
  for (const st of stopTimes) {
    if (!tripStopTimesCache.has(st.trip_id)) tripStopTimesCache.set(st.trip_id, [])
    tripStopTimesCache.get(st.trip_id)!.push(st)
  }

  return { tripEntries: [...seen.values()], routeColorMap: colorMap }
}

// ─── OSM / Overpass ───────────────────────────────────────────────────────────

/**
 * Fetches OSM tram ways and route relations from Overpass, using a
 * session-level cache to avoid redundant network requests.
 *
 * The query fetches both individual ways (railway=tram) and tram route
 * relations in a single round-trip.
 */
export async function fetchOsmData(): Promise<OverpassData> {
  if (overpassCache) return overpassCache

  const bounds = GRENOBLE_BOUNDS as [[number, number], [number, number]]
  const bbox = `${bounds[0][0]},${bounds[0][1]},${bounds[1][0]},${bounds[1][1]}`
  const q = `[out:json];(way[railway=tram](${bbox});relation[route=tram](${bbox}););out geom;`

  const res = await fetch(`/api/admin/overpass?q=${encodeURIComponent(q)}`)
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`)
  const data = await res.json()

  // Parse raw elements into OsmWay and OsmRelation objects
  type RawEl = {
    type: string
    id: number
    geometry?: Array<{ lat: number; lon: number }>
    tags?: Record<string, string>
    members?: Array<{
      type: string
      ref: number
      role: string
      geometry?: Array<{ lat: number; lon: number }>
    }>
  }

  const wayMap = new Map<number, OsmWay>()
  const relations: OsmRelation[] = []

  // Track which way IDs are track ways (non-platform relation members).
  // Top-level ways from the bbox query may include platform ways that share
  // the railway=tram tag — we exclude them by only keeping ways that appear
  // as track members in at least one relation.
  const trackWayIds = new Set<number>()

  for (const el of (data.elements ?? []) as RawEl[]) {
    if (el.type === 'way' && (el.geometry?.length ?? 0) > 1) {
      wayMap.set(el.id, {
        id: el.id,
        coords: el.geometry!.map((n) => ({ lat: n.lat, lng: n.lon })),
      })
    } else if (el.type === 'relation') {
      const wayIds: number[] = []
      for (const member of el.members ?? []) {
        if (member.type !== 'way') continue
        // Skip platform and stop members — they are station infrastructure, not track
        if (member.role === 'platform' || member.role === 'stop') continue
        wayIds.push(member.ref)
        trackWayIds.add(member.ref)
        // Capture geometry from relation members not already present as direct ways
        if (!wayMap.has(member.ref) && (member.geometry?.length ?? 0) > 1) {
          wayMap.set(member.ref, {
            id: member.ref,
            coords: member.geometry!.map((n) => ({ lat: n.lat, lng: n.lon })),
          })
        }
      }
      if (wayIds.length > 0) {
        const ref = el.tags?.ref ?? ''
        const name = el.tags?.name ?? el.tags?.['name:fr'] ?? (ref ? `Ligne ${ref}` : `Relation ${el.id}`)
        relations.push({ id: el.id, name, ref, wayIds })
      }
    }
  }

  // Only keep ways that are actual track members of a relation (excludes platform ways)
  const ways = [...wayMap.values()].filter((w) => w.coords.length > 1 && trackWayIds.has(w.id))
  overpassCache = { ways, relations }
  return overpassCache
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/** POSTs `body` to `/api/admin/geodata?file=<file>`. Throws on HTTP error. */
async function postGeodata(file: string, body: unknown): Promise<void> {
  const res = await fetch(`/api/admin/geodata?file=${file}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

/**
 * Loads the saved line-paths.json.
 * Key format: "routeShortName|directionId" (e.g. "A|0", "B|1").
 * Values are ordered arrays of segment keys.
 * Returns an empty object if the file doesn't exist yet.
 */
export async function loadLinePaths(): Promise<Record<string, string[]>> {
  try {
    const res = await fetch('/api/admin/geodata?file=line-paths')
    if (res.ok) return await res.json()
  } catch { /* ignore */ }
  return {}
}

/**
 * Loads the saved segment-paths.json.
 * Returns an empty object if the file doesn't exist yet.
 */
export async function loadSegmentPaths(): Promise<Record<string, LatLng[]>> {
  try {
    const res = await fetch('/api/admin/geodata?file=segment-paths')
    if (res.ok) return await res.json()
  } catch { /* ignore */ }
  return {}
}

/** Saves the full clusters array to clusters.json. */
export async function saveClusters(clusters: Cluster[]): Promise<void> {
  await postGeodata('clusters', clusters)
}

/**
 * Merges `newSegments` into the existing segment-paths.json and saves.
 * Existing segments for other stop pairs are preserved.
 */
export async function saveSegments(newSegments: Record<string, LatLng[]>): Promise<void> {
  let existing: Record<string, LatLng[]> = {}
  try {
    const res = await fetch('/api/admin/geodata?file=segment-paths')
    if (res.ok) existing = await res.json()
  } catch { /* ignore */ }

  await postGeodata('segment-paths', { ...existing, ...newSegments })
}

/**
 * Saves the segment-key sequence for one route direction to line-paths.json.
 * Key format: "routeShortName|directionId" (e.g. "A|0", "B|1").
 */
export async function saveLinePath(key: string, segmentKeys: string[]): Promise<void> {
  let existing: Record<string, string[]> = {}
  try {
    const res = await fetch('/api/admin/geodata?file=line-paths')
    if (res.ok) existing = await res.json()
  } catch { /* ignore */ }

  await postGeodata('line-paths', { ...existing, [key]: segmentKeys })
}

/**
 * Deletes a segment from segment-paths.json by key.
 */
export async function deleteSegment(key: string): Promise<void> {
  let existing: Record<string, LatLng[]> = {}
  try {
    const res = await fetch('/api/admin/geodata?file=segment-paths')
    if (res.ok) existing = await res.json()
  } catch { /* ignore */ }

  delete existing[key]
  await postGeodata('segment-paths', existing)
}
