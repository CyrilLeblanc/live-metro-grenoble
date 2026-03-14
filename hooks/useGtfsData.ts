/**
 * useGtfsData — loads and transforms static GTFS data for the map.
 *
 * Fetches all five GTFS files in parallel on mount, then builds:
 *  - `lineShapes`    — polyline points per route shape, for drawing tracks
 *  - `tramStops`     — one clustered stop marker per station with its blended colour
 *  - `tramRouteIds`  — set of route IDs (used to filter departure panels)
 *  - `routeColorMap` — map from route_id → hex colour string
 *  - `dataLoaded`    — true once the async load completes
 */

import { useEffect, useState } from 'react'
import { loadRoutes, loadShapes, loadStops, loadStopTimes, loadTrips, loadSegmentPaths, getClusterId, Route, ShapePoint, Stop } from '../lib/gtfs'
import { makeSegmentKey } from '../lib/geo'

interface LatLng { lat: number; lng: number }

export interface GtfsData {
  lineShapes: Array<{ route: Route; points: ShapePoint[] }>
  tramStops: Array<{ stop: Stop; color: string }>
  tramRouteIds: Set<string>
  routeColorMap: Map<string, string>
  segmentPaths: Map<string, LatLng[]>
  segmentStops: Map<string, { stopAId: string; stopBId: string }>
  dataLoaded: boolean
}

export function useGtfsData(): GtfsData {
  const [lineShapes, setLineShapes] = useState<Array<{ route: Route; points: ShapePoint[] }>>([])
  const [tramStops, setTramStops] = useState<Array<{ stop: Stop; color: string }>>([])
  const [tramRouteIds, setTramRouteIds] = useState<Set<string>>(new Set())
  const [routeColorMap, setRouteColorMap] = useState<Map<string, string>>(new Map())
  const [segmentPaths, setSegmentPaths] = useState<Map<string, LatLng[]>>(new Map())
  const [segmentStops, setSegmentStops] = useState<Map<string, { stopAId: string; stopBId: string }>>(new Map())
  const [dataLoaded, setDataLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      const [routes, trips, shapes, stops, stopTimes, segPaths] = await Promise.all([
        loadRoutes(), loadTrips(), loadShapes(), loadStops(), loadStopTimes(), loadSegmentPaths()
      ])

      // --- Build shape map: shape_id → sorted ShapePoint[] ---
      const shapeMap = new Map<string, ShapePoint[]>()
      for (const pt of shapes) {
        if (!shapeMap.has(pt.shape_id)) shapeMap.set(pt.shape_id, [])
        shapeMap.get(pt.shape_id)!.push(pt)
      }
      for (const pts of shapeMap.values()) pts.sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence)

      // --- Collect shape IDs per route ---
      const routeShapeIds = new Map<string, Set<string>>()
      for (const trip of trips) {
        if (!routeShapeIds.has(trip.route_id)) routeShapeIds.set(trip.route_id, new Set())
        routeShapeIds.get(trip.route_id)!.add(trip.shape_id)
      }

      // --- One entry per (route, shape) pair for drawing polylines ---
      const result: Array<{ route: Route; points: ShapePoint[] }> = []
      for (const route of routes) {
        for (const shapeId of routeShapeIds.get(route.route_id) ?? []) {
          const pts = shapeMap.get(shapeId)
          if (pts) result.push({ route, points: pts })
        }
      }
      setLineShapes(result.reverse())
      setTramRouteIds(new Set(routes.map(r => r.route_id)))

      // --- Route lookup maps ---
      const tripRouteMap = new Map<string, string>()
      for (const trip of trips) tripRouteMap.set(trip.trip_id, trip.route_id)

      const colorMap = new Map<string, string>()
      for (const route of routes) colorMap.set(route.route_id, route.route_color)
      setRouteColorMap(colorMap)

      // --- Build one clustered stop marker per station ---
      // First pass: collect which line colours serve each cluster
      const stopById = new Map<string, Stop>()
      for (const stop of stops) stopById.set(stop.stop_id, stop)

      type ClusterMeta = { stop_name: string; colors: Set<string> }
      const clusterMeta = new Map<string, ClusterMeta>()

      for (const st of stopTimes) {
        const routeId = tripRouteMap.get(st.trip_id)
        if (!routeId) continue
        const color = colorMap.get(routeId)
        if (!color) continue
        const stop = stopById.get(st.stop_id)
        if (!stop) continue

        const clusterId = getClusterId(stop)
        if (!clusterMeta.has(clusterId)) {
          clusterMeta.set(clusterId, { stop_name: stop.stop_name, colors: new Set() })
        }
        clusterMeta.get(clusterId)!.colors.add(color)
      }

      // Second pass: compute centroid lat/lon for each cluster from its member stops
      const clusterStops = new Map<string, Stop[]>()
      for (const stop of stops) {
        const clusterId = getClusterId(stop)
        if (!clusterStops.has(clusterId)) clusterStops.set(clusterId, [])
        clusterStops.get(clusterId)!.push(stop)
      }

      const tramClusters: Array<{ stop: Stop; color: string }> = []
      for (const [clusterId, meta] of clusterMeta) {
        const members = clusterStops.get(clusterId) ?? []
        const lat = members.reduce((s, m) => s + m.stop_lat, 0) / members.length
        const lon = members.reduce((s, m) => s + m.stop_lon, 0) / members.length
        // Use a neutral grey when a cluster is served by multiple lines
        const color = meta.colors.size === 1 ? [...meta.colors][0] : 'aaaaaa'
        tramClusters.push({
          stop: { stop_id: clusterId, stop_name: meta.stop_name, stop_lat: lat, stop_lon: lon, parent_station: '' },
          color,
        })
      }
      setTramStops(tramClusters)
      setSegmentPaths(segPaths)

      // Build segmentStops: segmentKey → { stopAId, stopBId }
      const tripStopTimes = new Map<string, typeof stopTimes>()
      for (const st of stopTimes) {
        if (!tripStopTimes.has(st.trip_id)) tripStopTimes.set(st.trip_id, [])
        tripStopTimes.get(st.trip_id)!.push(st)
      }
      const segStops = new Map<string, { stopAId: string; stopBId: string }>()
      for (const times of tripStopTimes.values()) {
        times.sort((a, b) => a.stop_sequence - b.stop_sequence)
        for (let i = 0; i < times.length - 1; i++) {
          const aId = times[i].stop_id
          const bId = times[i + 1].stop_id
          const key = makeSegmentKey(aId, bId)
          if (!segStops.has(key)) segStops.set(key, { stopAId: aId, stopBId: bId })
        }
      }
      setSegmentStops(segStops)

      setDataLoaded(true)
    }
    load()
  }, [])

  return { lineShapes, tramStops, tramRouteIds, routeColorMap, segmentPaths, segmentStops, dataLoaded }
}
