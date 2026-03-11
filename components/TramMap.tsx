'use client'

import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useState } from 'react'
import { MapContainer, Polyline, TileLayer } from 'react-leaflet'
import { loadRoutes, loadShapes, loadStops, loadStopTimes, loadTrips, Route, ShapePoint, Stop } from '../lib/gtfs'
import StopMarker from './StopMarker'

// Fix Leaflet default marker icons broken by webpack
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const GRENOBLE_CENTER: [number, number] = [45.1885, 5.7245]

export default function TramMap() {
  const [lineShapes, setLineShapes] = useState<Array<{ route: Route; points: ShapePoint[] }>>([])
  const [tramStops, setTramStops] = useState<Array<{ stop: Stop; color: string }>>([])

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
    }
    load()
  }, [])

  return (
    <div style={{ height: '100vh' }}>
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
          <StopMarker key={stop.stop_id} stop={stop} color={color} />
        ))}
      </MapContainer>
    </div>
  )
}
