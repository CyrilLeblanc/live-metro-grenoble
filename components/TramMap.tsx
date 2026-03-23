'use client'

import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, /* useMemo, */ useRef, useState } from 'react'
import { MapContainer, Polyline, TileLayer, useMap, useMapEvents, useMapEvent } from 'react-leaflet'
import { /* makeSegmentKey, */ TramMarkerData } from '../lib/geo'
import { GRENOBLE_CENTER, GRENOBLE_BOUNDS, PANEL_BG, PANEL_BORDER, ACCENT_BLUE } from '../lib/config'
import { useGtfsData } from '../hooks/useGtfsData'
import { usePolling } from '../hooks/usePolling'
import { useAnimatedTrams } from '../hooks/useAnimatedTrams'
// import { useUserOnTram } from '../hooks/useUserOnTram'
import { useUserLocation } from '../hooks/useUserLocation'
import StopDeparturePanel from './StopDeparturePanel'
import StopMarker from './StopMarker'
import CanvasTramLayer from './CanvasTramLayer'
// import OnTramOverlay from './OnTramOverlay'
import UserLocationMarker from './UserLocationMarker'
import { Stop } from '../lib/gtfs'
import { useDebugContext } from '../contexts/DebugContext'
import DebugSegmentLayer from './debug/DebugSegmentLayer'
import DebugPlaybackLayer from './debug/DebugPlaybackLayer'
import DebugPanel from './debug/DebugPanel'
import TramPopup, { PopupTram } from './TramPopup'
// import { useFetchSegmentGraphs } from '../hooks/useFetchSegmentGraphs'

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

function parseHashPosition(): { center: [number, number]; zoom: number } | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash.slice(1)
  const parts = hash.split(',')
  if (parts.length !== 3) return null
  const lat = parseFloat(parts[0])
  const lng = parseFloat(parts[1])
  const zoom = parseInt(parts[2], 10)
  if (isNaN(lat) || isNaN(lng) || isNaN(zoom)) return null
  if (lat < 44.95 || lat > 45.45 || lng < 5.45 || lng > 6.05) return null
  if (zoom < 10 || zoom > 18) return null
  return { center: [lat, lng], zoom }
}

function MapPositionSync() {
  useMapEvents({
    moveend(e) {
      const map = e.target as L.Map
      const { lat, lng } = map.getCenter()
      const z = map.getZoom()
      window.location.hash = `${lat.toFixed(5)},${lng.toFixed(5)},${z}`
    },
  })
  return null
}

// Fix Leaflet default marker icons broken by webpack
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

export default function TramMap() {
  const [initialPosition] = useState(() => parseHashPosition())
  const initialCenter = initialPosition?.center ?? GRENOBLE_CENTER
  const initialZoom = initialPosition?.zoom ?? 13
  const [zoom, setZoom] = useState(initialZoom)
  const [highlightedTripId, setHighlightedTripId] = useState<string | null>(null)
  const [selectedStop, setSelectedStop] = useState<{ stop: Stop; color: string } | null>(null)
  const [popupTram, setPopupTram] = useState<PopupTram | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const stopClickedRef = useRef(false)

  // Debug mode context
  const { isDebug, frozenByPanel } = useDebugContext()

  // Load static GTFS data (routes, stops, shapes)
  const { lineShapes, tramStops, tramRouteIds, routeColorMap, segmentPaths, segmentStops, dataLoaded } = useGtfsData()

  // Poll real-time tram positions every 10 seconds
  const { apiTrams, tramMarkers, secondsLeft, refresh } = usePolling(dataLoaded, frozenByPanel)

  // // Segment graphs for animation refinement (contributions disabled)
  // const segmentKeys = useMemo(
  //   () => [...new Set(apiTrams.map(t => makeSegmentKey(t.stopAId, t.stopBId)))],
  //   [apiTrams],
  // )
  // const segmentGraphs = useFetchSegmentGraphs(segmentKeys)

  // // GPS user-on-tram tracking (disabled)
  // // positionsRef is needed before useAnimatedTrams — use a stable ref that gets populated
  // const positionsPlaceholderRef = useRef<Map<string, import('../hooks/useAnimatedTrams').AnimatedPosition>>(new Map())

  // const {
  //   isTracking,
  //   isConfirmed,
  //   userTramId,
  //   nearbyTrams,
  //   currentSpeedMs,
  //   gpsAccuracy,
  //   startTracking,
  //   stopTracking,
  //   confirmTram,
  //   cancelConfirmation,
  // } = useUserOnTram(apiTrams, positionsPlaceholderRef)

  // // Build speed overrides: propagate the GPS user's speed to their confirmed tram (disabled)
  // const speedOverrides = useMemo(() => {
  //   if (!isConfirmed || !userTramId || currentSpeedMs === null) return undefined
  //   return new Map([[userTramId, currentSpeedMs]])
  // }, [isConfirmed, userTramId, currentSpeedMs])

  const positionsRef = useAnimatedTrams(apiTrams, segmentPaths, undefined, undefined, frozenByPanel)

  // // Keep placeholder ref in sync so useUserOnTram gets real animated positions (disabled)
  // useEffect(() => {
  //   positionsPlaceholderRef.current = positionsRef.current ?? new Map()
  // })

  // User's own location (auto-prompted on load)
  const { position: userPosition, isPending: locationPending } = useUserLocation()

  return (
    <div style={{ height: '100vh', position: 'relative' }}>
      {dataLoaded && (
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 1000, background: PANEL_BG, color: '#ffffff', border: `1px solid ${PANEL_BORDER}` }}
             className="flex items-center gap-2 rounded px-2 py-1 text-sm shadow font-medium w-fit">
          <span style={{ color: 'rgba(255,255,255,0.6)' }}>{secondsLeft}s</span>
          <button
            onClick={refresh}
            className="flex items-center justify-center"
            style={{ color: ACCENT_BLUE }}
            title="Force reload"
            aria-label="Force reload"
          >
            ↻
          </button>
        </div>
      )}
      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        minZoom={10}
        maxZoom={18}
        maxBounds={GRENOBLE_BOUNDS}
        maxBoundsViscosity={1.0}
        style={{ height: '100%' }}
      >
        <TileLayer
          url="/api/tiles/{z}/{x}/{y}.png"
        />
        {lineShapes.map(({ route, points }) => (
          <Polyline
            key={`${route.route_id}-${points[0]?.shape_id}`}
            positions={points.map(p => [p.shape_pt_lat, p.shape_pt_lon])}
            pathOptions={{ color: `#${route.route_color}`, weight: 1 }}
            smoothFactor={0.1}
          />
        ))}
        {userPosition && (
          <UserLocationMarker position={userPosition} isPending={locationPending} />
        )}
        <MapClickHandler onMapClick={() => {
          if (stopClickedRef.current) { stopClickedRef.current = false; return }
          setSelectedStop(null)
          setPopupTram(null)
        }} />
        <ZoomTracker onZoom={setZoom} />
        <MapController mapRef={mapRef} />
        <MapPositionSync />
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
          opacity={frozenByPanel ? 0.3 : 1}
        />
        {isDebug && <DebugSegmentLayer segmentPaths={segmentPaths} segmentStops={segmentStops} />}
        {isDebug && <DebugPlaybackLayer />}
      </MapContainer>
      {isDebug && <DebugPanel />}
      {popupTram && <TramPopup popupTram={popupTram} onClose={() => setPopupTram(null)} />}
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
      {/* OnTramOverlay disabled
      <OnTramOverlay
        isTracking={isTracking}
        isConfirmed={isConfirmed}
        nearbyTrams={nearbyTrams}
        currentSpeedMs={currentSpeedMs}
        gpsAccuracy={gpsAccuracy}
        onStart={startTracking}
        onStop={stopTracking}
        onConfirm={confirmTram}
        onCancel={cancelConfirmation}
      />
      */}
    </div>
  )
}
