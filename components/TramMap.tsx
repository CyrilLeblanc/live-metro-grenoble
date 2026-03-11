'use client'

import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { MapContainer, Polyline, TileLayer } from 'react-leaflet'
import { loadRoutes, loadShapes, loadStops, loadStopTimes, loadTrips, Route, ShapePoint, Stop, StopTime, Trip } from '../lib/gtfs'
import { fetchStopTimes } from '../lib/api'
import { interpolatePosition } from '../lib/interpolator'
import StopMarker from './StopMarker'
import TramMarker from './TramMarker'

// Fix Leaflet default marker icons broken by webpack
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const GRENOBLE_CENTER: [number, number] = [45.1885, 5.7245]

interface TramMarkerData {
  id: string
  position: [number, number]
  line: string
  direction: string
  nextStop: string
  eta: string
  isRealtime: boolean
  color: string
  bearing: number
}

function formatEta(secs: number): string {
  if (secs <= 0) return 'arriving'
  const mins = Math.round(secs / 60)
  return mins < 1 ? '< 1 min' : `in ${mins} min`
}

interface GtfsIndex {
  stopById: Map<string, Stop>
  tripById: Map<string, Trip>
  routeById: Map<string, Route>
  stopTimesByTrip: Map<string, StopTime[]>
  shapeByShapeId: Map<string, ShapePoint[]>
  activeClusterIds: string[]
}

export default function TramMap() {
  const [lineShapes, setLineShapes] = useState<Array<{ route: Route; points: ShapePoint[] }>>([])
  const [tramStops, setTramStops] = useState<Array<{ stop: Stop; color: string }>>([])
  const [tramMarkers, setTramMarkers] = useState<TramMarkerData[]>([])
  const [dataLoaded, setDataLoaded] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(10)
  const gtfsIndexRef = useRef<GtfsIndex | null>(null)
  const pollingInFlightRef = useRef(false)
  const tickRef = useRef<(() => Promise<void>) | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function resetTimers() {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    setSecondsLeft(10)
    countdownIntervalRef.current = setInterval(() => {
      setSecondsLeft(s => Math.max(0, s - 1))
    }, 1_000)
    pollIntervalRef.current = setInterval(() => {
      tickRef.current?.()
    }, 10_000)
  }

  useEffect(() => {
    async function load() {
      const [routes, trips, shapes, stops, stopTimes] = await Promise.all([
        loadRoutes(), loadTrips(), loadShapes(), loadStops(), loadStopTimes()
      ])

      const shapeMap = new Map<string, ShapePoint[]>()
      for (const pt of shapes) {
        if (!shapeMap.has(pt.shape_id)) shapeMap.set(pt.shape_id, [])
        shapeMap.get(pt.shape_id)!.push(pt)
      }
      for (const pts of shapeMap.values()) pts.sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence)

      const routeShapeIds = new Map<string, Set<string>>()
      for (const trip of trips) {
        if (!routeShapeIds.has(trip.route_id)) routeShapeIds.set(trip.route_id, new Set())
        routeShapeIds.get(trip.route_id)!.add(trip.shape_id)
      }

      const result: Array<{ route: Route; points: ShapePoint[] }> = []
      for (const route of routes) {
        for (const shapeId of routeShapeIds.get(route.route_id) ?? []) {
          const pts = shapeMap.get(shapeId)
          if (pts) result.push({ route, points: pts })
        }
      }
      setLineShapes(result)

      const tripRouteMap = new Map<string, string>()
      for (const trip of trips) tripRouteMap.set(trip.trip_id, trip.route_id)

      const routeColorMap = new Map<string, string>()
      for (const route of routes) routeColorMap.set(route.route_id, route.route_color)

      const stopById = new Map<string, Stop>()
      for (const stop of stops) stopById.set(stop.stop_id, stop)

      // Group tram stops by cluster (parent_station)
      type ClusterEntry = { stop_id: string; stop_name: string; lat: number; lon: number; colors: Set<string> }
      const clusterMap = new Map<string, ClusterEntry>()

      for (const st of stopTimes) {
        const routeId = tripRouteMap.get(st.trip_id)
        if (!routeId) continue
        const color = routeColorMap.get(routeId)
        if (!color) continue

        const stop = stopById.get(st.stop_id)
        if (!stop) continue

        const clusterId = stop.parent_station || stop.stop_id
        if (!clusterMap.has(clusterId)) {
          clusterMap.set(clusterId, { stop_id: clusterId, stop_name: stop.stop_name, lat: 0, lon: 0, colors: new Set() })
        }
        clusterMap.get(clusterId)!.colors.add(color)
      }

      // Compute centroid for each cluster
      const clusterStops = new Map<string, Stop[]>()
      for (const stop of stops) {
        const clusterId = stop.parent_station || stop.stop_id
        if (!clusterStops.has(clusterId)) clusterStops.set(clusterId, [])
        clusterStops.get(clusterId)!.push(stop)
      }

      const tramClusters: Array<{ stop: Stop; color: string }> = []
      for (const [clusterId, entry] of clusterMap) {
        const members = clusterStops.get(clusterId) ?? []
        const lat = members.reduce((s, m) => s + m.stop_lat, 0) / members.length
        const lon = members.reduce((s, m) => s + m.stop_lon, 0) / members.length
        const color = entry.colors.size === 1 ? [...entry.colors][0] : 'aaaaaa'
        tramClusters.push({
          stop: { stop_id: clusterId, stop_name: entry.stop_name, stop_lat: lat, stop_lon: lon, parent_station: '' },
          color,
        })
      }
      setTramStops(tramClusters)

      // Build index for polling
      const tripById = new Map(trips.map(t => [t.trip_id, t]))
      const routeById = new Map(routes.map(r => [r.route_id, r]))

      const stopTimesByTrip = new Map<string, StopTime[]>()
      for (const st of stopTimes) {
        if (!stopTimesByTrip.has(st.trip_id)) stopTimesByTrip.set(st.trip_id, [])
        stopTimesByTrip.get(st.trip_id)!.push(st)
      }
      for (const arr of stopTimesByTrip.values())
        arr.sort((a, b) => a.stop_sequence - b.stop_sequence)

      const activeClusterIds = [...clusterMap.keys()]

      gtfsIndexRef.current = { stopById, tripById, routeById, stopTimesByTrip, shapeByShapeId: shapeMap, activeClusterIds }
      setDataLoaded(true)
    }
    load()
  }, [])

  useEffect(() => {
    if (!dataLoaded) return

    async function tick() {
      if (pollingInFlightRef.current) return
      const index = gtfsIndexRef.current
      if (!index) return

      pollingInFlightRef.current = true
      try {
        const now = Date.now() / 1000

        const results: TramMarkerData[] = []
        const seenTrips = new Set<string>()

        const settled = await Promise.allSettled(
          index.activeClusterIds.map(clusterId => fetchStopTimes(clusterId))
        )

        let totalTimes = 0, noTrip = 0, noStopIdx = 0, noPos = 0

        for (let ci = 0; ci < settled.length; ci++) {
          const outcome = settled[ci]
          if (outcome.status === 'rejected') continue

          for (const group of outcome.value) {
            const headsign = group.pattern.desc
            for (const time of group.times) {
              const { tripId: rawTripId, stopId: rawStopId, realtimeDeparture, serviceDay, realtime } = time
              // Strip agency prefix (e.g. "SEM:31869701" → "31869701")
              const tripId = rawTripId.includes(':') ? rawTripId.split(':').slice(1).join(':') : rawTripId
              const stopId = rawStopId.includes(':') ? rawStopId.split(':').slice(1).join(':') : rawStopId

              if (seenTrips.has(tripId)) continue
              totalTimes++

              const trip = index.tripById.get(tripId)
              if (!trip) { noTrip++; continue }
              const route = index.routeById.get(trip.route_id)
              if (!route) continue

              const tripStops = index.stopTimesByTrip.get(tripId)
              if (!tripStops) continue

              const stopIdx = tripStops.findIndex(st => st.stop_id === stopId)
              if (stopIdx <= 0) { noStopIdx++; continue }

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
              if (!pos) {
                noPos++
              }

              if (pos) {
                seenTrips.add(tripId)
                const dLat = stopB.stop_lat - pos.lat
                const dLon = stopB.stop_lon - pos.lng
                const bearing = (Math.atan2(dLon, dLat) * 180) / Math.PI
                results.push({
                  id: `${tripId}-${stopIdx}`,
                  position: [pos.lat, pos.lng],
                  line: route.route_short_name,
                  direction: headsign,
                  nextStop: stopB.stop_name,
                  eta: formatEta(timeB - now),
                  isRealtime: realtime,
                  color: route.route_color,
                  bearing,
                })
              }
            }
          }
        }

        setTramMarkers(results)
      } finally {
        pollingInFlightRef.current = false
      }
      resetTimers()
    }

    tickRef.current = tick
    tick()

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    }
  }, [dataLoaded])

  return (
    <div style={{ height: '100vh', position: 'relative' }}>
      {dataLoaded && (
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 1000 }}
             className="flex items-center gap-2 bg-gray-800/90 text-white rounded px-2 py-1 text-sm shadow font-medium">
          <span>{secondsLeft}s</span>
          <button
            onClick={() => tickRef.current?.()}
            className="flex items-center justify-center hover:text-blue-300"
            title="Force reload"
            aria-label="Force reload"
          >
            ↻
          </button>
        </div>
      )}
      <MapContainer center={GRENOBLE_CENTER} zoom={13} style={{ height: '100%' }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        {lineShapes.map(({ route, points }) => (
          <Polyline
            key={`${route.route_id}-${points[0]?.shape_id}`}
            positions={points.map(p => [p.shape_pt_lat, p.shape_pt_lon])}
            pathOptions={{ color: `#${route.route_color}`, weight: 4 }}
          />
        ))}
        {tramStops.map(({ stop, color }) => (
          <StopMarker key={stop.stop_id} stop={stop} />
        ))}
        {tramMarkers.map(m => (
          <TramMarker
            key={m.id}
            position={m.position}
            line={m.line}
            direction={m.direction}
            nextStop={m.nextStop}
            eta={m.eta}
            isRealtime={m.isRealtime}
            color={m.color}
            bearing={m.bearing}
          />
        ))}
      </MapContainer>
    </div>
  )
}
