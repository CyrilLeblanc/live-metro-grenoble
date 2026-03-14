/**
 * GET /api/trams
 *
 * Aggregates real-time departure data from the Métromobilité API across every
 * stop cluster and computes the interpolated position of each tram currently
 * in transit. Returns an array of TramPosition objects for the client to render.
 *
 * Stale-cache fallback: if all upstream requests fail, the last successful
 * response is returned so the map does not go blank during a brief API outage.
 */

import { interpolatePosition } from '../../../lib/interpolator'
import { loadRoutes, loadTrips, loadShapes, loadStops, loadStopTimes, getClusterId, Route, Stop, Trip, StopTime, ShapePoint } from '../../../lib/gtfs'
import { UPSTREAM_API_BASE } from '../../../lib/config'

interface GtfsIndex {
  stopById: Map<string, Stop>
  tripById: Map<string, Trip>
  routeById: Map<string, Route>
  stopTimesByTrip: Map<string, StopTime[]>
  shapeByShapeId: Map<string, ShapePoint[]>
  activeClusterIds: string[]
}

export interface TramPosition {
  id: string
  lat: number
  lng: number
  line: string
  lineColor: string
  direction: string
  nextStop: string
  eta: number
  isRealtime: boolean
  stopAId: string
  stopBId: string
}

// Module-level cache: GTFS data is large and static — build once per server process.
let gtfsIndex: GtfsIndex | null = null
let lastGoodResponse: TramPosition[] | null = null

// Shared response cache: all users within the same 10 s window get the same result.
// inFlightFetch deduplicates concurrent requests during a cache miss.
const RESPONSE_CACHE_TTL_MS = 10_000
let cachedResponse: { data: TramPosition[]; fetchedAt: number } | null = null
let inFlightFetch: Promise<TramPosition[]> | null = null


async function buildGtfsIndex(): Promise<GtfsIndex> {
  const [routes, trips, shapes, stops, stopTimes] = await Promise.all([
    loadRoutes(), loadTrips(), loadShapes(), loadStops(), loadStopTimes()
  ])

  const stopById = new Map(stops.map(s => [s.stop_id, s]))
  const tripById = new Map(trips.map(t => [t.trip_id, t]))
  const routeById = new Map(routes.map(r => [r.route_id, r]))

  const stopTimesByTrip = new Map<string, StopTime[]>()
  for (const st of stopTimes) {
    if (!stopTimesByTrip.has(st.trip_id)) stopTimesByTrip.set(st.trip_id, [])
    stopTimesByTrip.get(st.trip_id)!.push(st)
  }
  for (const arr of stopTimesByTrip.values())
    arr.sort((a, b) => a.stop_sequence - b.stop_sequence)

  const shapeByShapeId = new Map<string, ShapePoint[]>()
  for (const pt of shapes) {
    if (!shapeByShapeId.has(pt.shape_id)) shapeByShapeId.set(pt.shape_id, [])
    shapeByShapeId.get(pt.shape_id)!.push(pt)
  }
  for (const pts of shapeByShapeId.values())
    pts.sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence)

  // Collect the unique cluster ID for every stop referenced in the schedule
  const clusterIdSet = new Set<string>()
  for (const st of stopTimes) {
    const stop = stopById.get(st.stop_id)
    if (!stop) continue
    clusterIdSet.add(getClusterId(stop))
  }
  const activeClusterIds = [...clusterIdSet]

  return { stopById, tripById, routeById, stopTimesByTrip, shapeByShapeId, activeClusterIds }
}

async function fetchTramPositions(): Promise<TramPosition[]> {
  if (!gtfsIndex) {
    gtfsIndex = await buildGtfsIndex()
  }
  const index = gtfsIndex
  const now = Date.now() / 1000
  const results: TramPosition[] = []
  const seenTrips = new Set<string>()

  type UpstreamTime = {
    stopId: string
    tripId: string
    realtimeDeparture: number
    serviceDay: number
    realtime: boolean
  }
  type UpstreamGroup = { pattern: { id: string; desc: string }; times: UpstreamTime[] }

  // Fan out to all active clusters in parallel; failures are silently ignored via allSettled
  const CLUSTER_TIMEOUT_MS = 3000
  const settled = await Promise.allSettled(
    index.activeClusterIds.map(id => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), CLUSTER_TIMEOUT_MS)
      return fetch(`${UPSTREAM_API_BASE}/routers/default/index/clusters/SEM:GEN${id}/stoptimes`, {
        headers: { Origin: 'http://localhost:3000' },
        signal: controller.signal,
      })
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json() as Promise<UpstreamGroup[]>
        })
        .catch(err => {
          if (err.name === 'AbortError') console.log(`[trams] cluster ${id} fetch aborted`)
          throw err
        })
        .finally(() => clearTimeout(timer))
    })
  )

  for (const outcome of settled) {
    if (outcome.status === 'rejected') continue
    if (!Array.isArray(outcome.value)) continue

    for (const group of outcome.value) {
      const headsign = group.pattern.desc
      for (const time of group.times) {
        const { tripId: rawTripId, stopId: rawStopId, realtimeDeparture, serviceDay, realtime } = time
        const tripId = rawTripId.includes(':') ? rawTripId.split(':').slice(1).join(':') : rawTripId
        const stopId = rawStopId.includes(':') ? rawStopId.split(':').slice(1).join(':') : rawStopId

        if (seenTrips.has(tripId)) continue

        const trip = index.tripById.get(tripId)
        if (!trip) continue
        const route = index.routeById.get(trip.route_id)
        if (!route) continue

        const tripStops = index.stopTimesByTrip.get(tripId)
        if (!tripStops) continue

        const stopIdx = tripStops.findIndex(st => st.stop_id === stopId)
        if (stopIdx <= 0) continue

        const stA = tripStops[stopIdx - 1]
        const stB = tripStops[stopIdx]

        const stopA = index.stopById.get(stA.stop_id)
        const stopB = index.stopById.get(stB.stop_id)
        if (!stopA || !stopB) continue

        const [h, m, s] = stA.departure_time.split(':').map(Number)
        const timeA = serviceDay + h * 3600 + m * 60 + s
        const timeB = serviceDay + realtimeDeparture

        const shape = index.shapeByShapeId.get(trip.shape_id)

        const pos = interpolatePosition({
          currentTime: now,
          stopA: { lat: stopA.stop_lat, lng: stopA.stop_lon, time: timeA },
          stopB: { lat: stopB.stop_lat, lng: stopB.stop_lon, time: timeB },
          shape: shape?.map(p => ({ lat: p.shape_pt_lat, lon: p.shape_pt_lon })),
        })

        if (pos) {
          seenTrips.add(tripId)
          results.push({
            id: `${tripId}-${stopIdx}`,
            lat: pos.lat,
            lng: pos.lng,
            line: route.route_short_name,
            lineColor: `#${route.route_color}`,
            direction: headsign,
            nextStop: stopB.stop_name,
            eta: timeB - now,
            isRealtime: realtime,
            stopAId: stA.stop_id,
            stopBId: stB.stop_id,
          })
        }
      }
    }
  }

  if (results.length > 0) {
    lastGoodResponse = results
    return results
  }

  if (lastGoodResponse) return lastGoodResponse
  return []
}

export async function GET() {
  // Serve cached result if still fresh
  if (cachedResponse && Date.now() - cachedResponse.fetchedAt < RESPONSE_CACHE_TTL_MS) {
    return Response.json(cachedResponse.data)
  }

  // Deduplicate concurrent requests: if a fetch is already in-flight, await it
  if (!inFlightFetch) {
    inFlightFetch = fetchTramPositions().then(data => {
      cachedResponse = { data, fetchedAt: Date.now() }
      inFlightFetch = null
      return data
    }).catch(err => {
      inFlightFetch = null
      throw err
    })
  }

  const data = await inFlightFetch
  return Response.json(data)
}
