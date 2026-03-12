'use client'

import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useRef, useState } from 'react'
import { MapContainer, Polyline, TileLayer, useMap, useMapEvents, useMapEvent } from 'react-leaflet'
import { loadRoutes, loadShapes, loadStops, loadStopTimes, loadTrips, Route, ShapePoint, Stop } from '../lib/gtfs'
import { useAnimatedTrams } from '../hooks/useAnimatedTrams'
import StopDeparturePanel from './StopDeparturePanel'
import StopMarker from './StopMarker'
import CanvasTramLayer, { TramMarkerData } from './CanvasTramLayer'

function MapClickHandler({ onMapClick }: { onMapClick: () => void }) {
  useMapEvents({ click: () => onMapClick() })
  return null
}

function ZoomTracker({ onZoom }: { onZoom: (z: number) => void }) {
  useMapEvent('zoomend', (e) => onZoom((e.target as L.Map).getZoom()))
  return null
}

function MapController({ mapRef }: { mapRef: React.MutableRefObject<L.Map | null> }) {
  const map = useMap()
  useEffect(() => { mapRef.current = map }, [map])
  return null
}

// Fix Leaflet default marker icons broken by webpack
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const GRENOBLE_CENTER: [number, number] = [45.1885, 5.7245]
const GRENOBLE_BOUNDS: [[number, number], [number, number]] = [
  [44.95, 5.45], // SW
  [45.45, 6.05], // NE
]

function formatEta(secs: number): string {
  if (secs <= 0) return 'arriving'
  const mins = Math.round(secs / 60)
  return mins < 1 ? '< 1 min' : `in ${mins} min`
}

interface TramApiItem {
  id: string
  lat: number
  lng: number
  bearing: number
  line: string
  lineColor: string
  direction: string
  nextStop: string
  eta: number
  isRealtime: boolean
  shapePath: Array<{ lat: number; lng: number }>
}

export default function TramMap() {
  const [lineShapes, setLineShapes] = useState<Array<{ route: Route; points: ShapePoint[] }>>([])
  const [tramStops, setTramStops] = useState<Array<{ stop: Stop; color: string }>>([])
  const [tramMarkers, setTramMarkers] = useState<TramMarkerData[]>([])
  const [apiTrams, setApiTrams] = useState<TramApiItem[]>([])
  const [dataLoaded, setDataLoaded] = useState(false)
  const [selectedStop, setSelectedStop] = useState<{ stop: Stop; color: string } | null>(null)
  const [tramRouteIds, setTramRouteIds] = useState<Set<string>>(new Set())
  const [routeColorMap, setRouteColorMap] = useState<Map<string, string>>(new Map())
  const [zoom, setZoom] = useState(13)
  const [highlightedTripId, setHighlightedTripId] = useState<string | null>(null)
  const [popupTram, setPopupTram] = useState<{ id: string; x: number; y: number; data: TramMarkerData } | null>(null)
  const positionsRef = useAnimatedTrams(apiTrams)
  const mapRef = useRef<L.Map | null>(null)
  const stopClickedRef = useRef(false)
  const [secondsLeft, setSecondsLeft] = useState(10)
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
      setLineShapes(result.reverse())
      setTramRouteIds(new Set(routes.map(r => r.route_id)))

      const tripRouteMap = new Map<string, string>()
      for (const trip of trips) tripRouteMap.set(trip.trip_id, trip.route_id)

      const routeColorMap = new Map<string, string>()
      for (const route of routes) routeColorMap.set(route.route_id, route.route_color)
      setRouteColorMap(routeColorMap)

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

      setDataLoaded(true)
    }
    load()
  }, [])

  useEffect(() => {
    if (!dataLoaded) return

    async function tick() {
      if (pollingInFlightRef.current) return
      pollingInFlightRef.current = true
      try {
        const res = await fetch('/api/trams')
        if (!res.ok) return
        const data: TramApiItem[] = await res.json()
        setApiTrams(data)
        setTramMarkers(data.map(item => ({
          id: item.id,
          position: [item.lat, item.lng] as [number, number],
          line: item.line,
          direction: item.direction,
          nextStop: item.nextStop,
          eta: formatEta(item.eta),
          isRealtime: item.isRealtime,
          color: item.lineColor.replace('#', ''),
          bearing: item.bearing,
        })))
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
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 1000, background: '#343139', color: '#ffffff', border: '1px solid #3d3a41' }}
             className="flex items-center gap-2 rounded px-2 py-1 text-sm shadow font-medium w-fit">
          <span style={{ color: 'rgba(255,255,255,0.6)' }}>{secondsLeft}s</span>
          <button
            onClick={() => tickRef.current?.()}
            className="flex items-center justify-center"
            style={{ color: '#96dbeb' }}
            title="Force reload"
            aria-label="Force reload"
          >
            ↻
          </button>
        </div>
      )}
      <MapContainer
        center={GRENOBLE_CENTER}
        zoom={13}
        minZoom={10}
        maxZoom={18}
        maxBounds={GRENOBLE_BOUNDS}
        maxBoundsViscosity={1.0}
        style={{ height: '100%' }}
      >
        <TileLayer
          url="/api/tiles/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        {lineShapes.map(({ route, points }) => (
          <Polyline
            key={`${route.route_id}-${points[0]?.shape_id}`}
            positions={points.map(p => [p.shape_pt_lat, p.shape_pt_lon])}
            pathOptions={{ color: `#${route.route_color}`, weight: 4 }}
          />
        ))}
        <MapClickHandler onMapClick={() => {
          if (stopClickedRef.current) { stopClickedRef.current = false; return }
          setSelectedStop(null)
          setPopupTram(null)
        }} />
        <ZoomTracker onZoom={setZoom} />
        <MapController mapRef={mapRef} />
        {tramStops.map(({ stop, color }) => (
          <StopMarker
            key={stop.stop_id}
            stop={stop}
            color={color}
            zoom={zoom}
            isSelected={selectedStop?.stop.stop_id === stop.stop_id}
            onClick={() => { stopClickedRef.current = true; setSelectedStop({ stop, color }); setHighlightedTripId(null) }}
          />
        ))}
        <CanvasTramLayer
          tramMarkers={tramMarkers}
          positionsRef={positionsRef}
          highlightedTripId={highlightedTripId}
          onTramClick={(id, x, y) => {
            const data = tramMarkers.find(m => m.id === id)
            if (data) setPopupTram({ id, x, y, data })
          }}
          onTramHover={(id) => setHighlightedTripId(id ? id.replace(/-\d+$/, '') : null)}
        />
      </MapContainer>
      {popupTram && (
        <div
          style={{
            position: 'absolute',
            left: popupTram.x + 16,
            top: popupTram.y - 16,
            zIndex: 1000,
            padding: '10px 12px',
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontSize: 13,
            background: '#343139',
            color: '#ffffff',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            minWidth: 180,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{
              background: `#${popupTram.data.color}`,
              color: '#fff',
              fontWeight: 'bold',
              fontSize: 13,
              padding: '2px 8px',
              borderRadius: 4,
              minWidth: 24,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {popupTram.data.line}
            </span>
            <span style={{ fontWeight: 600, color: '#ffffff', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
              {popupTram.data.direction}
            </span>
            <button
              onClick={() => setPopupTram(null)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}
              aria-label="Close"
            >×</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>Next stop</span>
            <span style={{ fontWeight: 500, color: '#ffffff', fontSize: 12, textAlign: 'right' }}>{popupTram.data.nextStop}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>ETA</span>
            <span style={{ fontWeight: 500, color: '#96dbeb', fontSize: 12, textAlign: 'right' }}>{popupTram.data.eta}</span>
          </div>
          <div style={{ marginTop: 8 }}>
            <span style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              background: popupTram.data.isRealtime ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.08)',
              color: popupTram.data.isRealtime ? '#4ade80' : 'rgba(255,255,255,0.5)',
              border: `1px solid ${popupTram.data.isRealtime ? 'rgba(74,222,128,0.4)' : 'rgba(255,255,255,0.15)'}`,
            }}>
              {popupTram.data.isRealtime ? 'Live' : 'Theoretical'}
            </span>
          </div>
        </div>
      )}
      {selectedStop && (
        <StopDeparturePanel
          stop={selectedStop.stop}
          color={selectedStop.color}
          tramRouteIds={tramRouteIds}
          routeColorMap={routeColorMap}
          onClose={() => { setSelectedStop(null); setHighlightedTripId(null) }}
          onHover={(tripId) => setHighlightedTripId(tripId)}
          onClick={(tripId) => {
            setHighlightedTripId(tripId)
            const tram = tramMarkers.find(m => m.id.startsWith(tripId + '-'))
            if (tram && mapRef.current) {
              const pos = positionsRef.current?.get(tram.id)
              const latLng: [number, number] = pos ? [pos.lat, pos.lng] : tram.position
              mapRef.current.flyTo(latLng, 16, { duration: 0.8 })
            }
          }}
        />
      )}
    </div>
  )
}
