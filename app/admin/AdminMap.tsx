'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState, useCallback } from 'react'
import type L from 'leaflet'
import type { Cluster } from '../../lib/gtfs'
import type { LatLng } from '../../lib/geo'
import { makeSegmentKey } from '../../lib/geo'
import { GRENOBLE_CENTER, GRENOBLE_BOUNDS } from '../../lib/config'

import type { OsmWay, OsmRelation, TripEntry, TripStop, CutPoint, PendingCut } from './types'
import {
  assembleWays,
  assembleOrderedWays,
  sortWayIdsByProximity,
  projectPointOnPolyline,
  buildSegmentPaths,
} from './lib/geo'
import {
  loadClusters,
  loadTramStops,
  loadTripEntries,
  loadLinePaths,
  loadSegmentPaths,
  fetchOsmData,
  saveClusters,
  saveSegments,
  saveLinePath,
  deleteSegment,
} from './lib/loaders'

import ClustersPanel from './components/ClustersPanel'
import SegmentStopPicker from './components/SegmentStopPicker'
import WayAssemblyPanel from './components/WayAssemblyPanel'
import CutPointPanel from './components/CutPointPanel'
import LinesPanel from './components/LinesPanel'

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'clusters' | 'segments' | 'lines'
type SegStep = 1 | 2 | 3

// ─── Constants ────────────────────────────────────────────────────────────────

const STOP_DOT_STYLE = { color: 'rgba(255,255,255,0.4)', fillColor: 'rgba(255,255,255,0.6)', fillOpacity: 1, radius: 4, weight: 1 } as const
const STOP_DOT_HIGHLIGHT_STYLE = { color: '#fff', fillColor: '#ffe066', fillOpacity: 1, radius: 6, weight: 2 } as const

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminMap() {
  // ── Refs (Leaflet imperative handles) ────────────────────────────────────────
  const mapRef = useRef<L.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const leafletRef = useRef<typeof import('leaflet') | null>(null)

  // Leaflet layer refs — kept for cleanup between renders
  const clusterMarkersRef = useRef<Map<string, L.Marker>>(new Map())
  const stopDotsRef = useRef<Map<string, L.CircleMarker>>(new Map())
  const wayLayersRef = useRef<Map<number, L.Polyline>>(new Map())
  const assembledLayerRef = useRef<L.Polyline | null>(null)
  const stopMarkersRef = useRef<L.CircleMarker[]>([])
  const segStopMarkersRef = useRef<Map<string, L.CircleMarker>>(new Map())
  const cutMarkersRef = useRef<L.Marker[]>([])
  const snapMarkerRef = useRef<L.Marker | null>(null)
  const existingSegLayersRef = useRef<Map<string, L.Polyline>>(new Map())
  const segmentLayersRef = useRef<Map<string, L.Polyline>>(new Map())
  const linePreviewLayersRef = useRef<L.Polyline[]>([])
  const clustersHistoryRef = useRef<Cluster[][]>([])

  // Refs for FROM/TO stops — avoids stale closures in map click handlers
  const fromStopRef = useRef<TripStop | null>(null)
  const toStopRef = useRef<TripStop | null>(null)

  // ── Shared state ─────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('clusters')
  const [status, setStatus] = useState<string>('')

  // ── Clusters state ───────────────────────────────────────────────────────────
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [allStops, setAllStops] = useState<TripStop[]>([])
  const [clusterStopIdSet, setClusterStopIdSet] = useState<Set<string>>(new Set())

  // ── Segments state ───────────────────────────────────────────────────────────
  const [segStep, setSegStep] = useState<SegStep>(1)
  const [fromStop, setFromStop] = useState<TripStop | null>(null)
  const [toStop, setToStop] = useState<TripStop | null>(null)
  const [existingSegmentKeys, setExistingSegmentKeys] = useState<Set<string>>(new Set())
  const [existingSegmentPathsForMap, setExistingSegmentPathsForMap] = useState<Record<string, LatLng[]>>({})
  const [osmWays, setOsmWays] = useState<OsmWay[]>([])
  const [osmRelations, setOsmRelations] = useState<OsmRelation[]>([])
  const [hoveredRelationId, setHoveredRelationId] = useState<number | null>(null)
  const [activeRelationId, setActiveRelationId] = useState<number | null>(null)
  const [activeRelationWayIds, setActiveRelationWayIds] = useState<number[]>([])
  const [hoveredWayId, setHoveredWayId] = useState<number | null>(null)
  const [selectedWayIds, setSelectedWayIds] = useState<Set<number>>(new Set())
  const [assembledPolyline, setAssembledPolyline] = useState<LatLng[]>([])
  // tripStops: the two confirmed stops for step 2/3 context markers
  const [tripStops, setTripStops] = useState<TripStop[]>([])
  const [cutPoints, setCutPoints] = useState<CutPoint[]>([])
  const [snappingActive, setSnappingActive] = useState(false)
  const [pendingCut, setPendingCut] = useState<PendingCut | null>(null)
  const [pendingStopId, setPendingStopId] = useState<string>('')
  const [hoveredStopId, setHoveredStopId] = useState<string | null>(null)
  const [hoveredSegmentKey, setHoveredSegmentKey] = useState<string | null>(null)

  // ── Lines state ───────────────────────────────────────────────────────────────
  const [tripEntries, setTripEntries] = useState<TripEntry[]>([])
  const [allSegmentPaths, setAllSegmentPaths] = useState<Record<string, LatLng[]>>({})
  const [linePaths, setLinePaths] = useState<Record<string, string[]>>({})
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null)
  const [segmentSequence, setSegmentSequence] = useState<string[]>([])
  const [highlightedSegmentKey, setHighlightedSegmentKey] = useState<string | null>(null)
  const [hoveredLineKey, setHoveredLineKey] = useState<string | null>(null)

  // ── Effect: Init Leaflet map ─────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return

    import('leaflet').then((L) => {
      leafletRef.current = L

      delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const map = L.map(mapContainerRef.current!, {
        center: GRENOBLE_CENTER as [number, number],
        zoom: 13,
        maxBounds: GRENOBLE_BOUNDS as [[number, number], [number, number]],
      })
      L.tileLayer('/api/tiles/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(map)
      mapRef.current = map
    })

    return () => { mapRef.current?.remove(); mapRef.current = null }
  }, [])

  // ── Effect: Load data when mode changes ──────────────────────────────────────
  useEffect(() => {
    if (mode === 'clusters') loadClustersData()
    if (mode === 'segments') loadSegmentsData()
    if (mode === 'lines') loadLinesData()
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect: Render cluster markers (draggable) ───────────────────────────────
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map || mode !== 'clusters') return

    clusterMarkersRef.current.forEach((m) => m.remove())
    clusterMarkersRef.current.clear()

    for (const cluster of clusters) {
      const marker = L.marker([cluster.lat, cluster.lng], { draggable: true })
        .addTo(map)
        .bindTooltip(cluster.name, { permanent: false, direction: 'top' })

      marker.on('dragstart', () => {
        clustersHistoryRef.current.push(clusters.map((c) => ({ ...c })))
      })
      marker.on('mouseover', () => {
        for (const sid of cluster.stopIds) stopDotsRef.current.get(sid)?.setStyle(STOP_DOT_HIGHLIGHT_STYLE)
      })
      marker.on('mouseout', () => {
        for (const sid of cluster.stopIds) stopDotsRef.current.get(sid)?.setStyle(STOP_DOT_STYLE)
      })
      marker.on('dragend', () => {
        const { lat, lng } = marker.getLatLng()
        setClusters((prev) => prev.map((c) => (c.id === cluster.id ? { ...c, lat, lng } : c)))
      })
      clusterMarkersRef.current.set(cluster.id, marker)
    }

    return () => { clusterMarkersRef.current.forEach((m) => m.remove()); clusterMarkersRef.current.clear() }
  }, [clusters, mode])

  // ── Effect: Create OSM way polyline layers ────────────────────────────────────
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map || mode !== 'segments') return

    wayLayersRef.current.forEach((l) => l.remove())
    wayLayersRef.current.clear()

    for (const way of osmWays) {
      const line = L.polyline(
        way.coords.map((p) => [p.lat, p.lng] as [number, number]),
        { color: '#999', weight: 3, opacity: 1 }
      ).addTo(map)

      line.on('mouseover', () => { if (!selectedWayIds.has(way.id)) line.setStyle({ opacity: 0.5 }) })
      line.on('mouseout',  () => { if (!selectedWayIds.has(way.id)) line.setStyle({ opacity: 1 }) })
      line.on('click', (e) => {
        e.originalEvent?.stopPropagation()
        setActiveRelationId(null)
        setSelectedWayIds((prev) => {
          const next = new Set(prev)
          if (next.has(way.id)) next.delete(way.id)
          else next.add(way.id)
          return next
        })
      })
      wayLayersRef.current.set(way.id, line)
    }

    return () => { wayLayersRef.current.forEach((l) => l.remove()); wayLayersRef.current.clear() }
  }, [osmWays, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect: Update way styles when selection / hover / active relation changes ─
  useEffect(() => {
    const routeColor = '#0074d9'
    const hoveredRelWayIds = hoveredRelationId
      ? new Set(osmRelations.find((r) => r.id === hoveredRelationId)?.wayIds ?? [])
      : null

    for (const [wayId, line] of wayLayersRef.current) {
      const isRelHovered = hoveredRelWayIds?.has(wayId) ?? false
      const isItemHovered = wayId === hoveredWayId
      const isGlowed = isRelHovered || isItemHovered

      if (activeRelationId !== null && !isGlowed) {
        line.setStyle({ color: '#999', weight: 3, opacity: 0.2 })
        const el = line.getElement() as SVGElement | null
        if (el) el.style.filter = ''
        continue
      }

      const isSelected = selectedWayIds.has(wayId)
      line.setStyle({
        color: isSelected ? routeColor : isGlowed ? '#fff' : '#999',
        weight: isSelected ? 5 : isGlowed ? 7 : 3,
        opacity: 1,
      })
      const el = line.getElement() as SVGElement | null
      if (el) el.style.filter = isGlowed ? 'drop-shadow(0 0 4px #fff) drop-shadow(0 0 8px rgba(255,255,255,0.6))' : ''
    }
  }, [selectedWayIds, hoveredRelationId, osmRelations, activeRelationId, hoveredWayId])

  // ── Effect: Render stop dots (clusters mode background overlay) ──────────────
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map) return

    stopDotsRef.current.forEach((m) => m.remove())
    stopDotsRef.current.clear()

    if (mode !== 'clusters' || allStops.length === 0) return

    for (const stop of allStops.filter((s) => clusterStopIdSet.has(s.stop_id))) {
      const dot = L.circleMarker([stop.stop_lat, stop.stop_lon], { ...STOP_DOT_STYLE, interactive: false }).addTo(map)
      stopDotsRef.current.set(stop.stop_id, dot)
    }

    return () => { stopDotsRef.current.forEach((m) => m.remove()); stopDotsRef.current.clear() }
  }, [allStops, clusterStopIdSet, mode])

  // ── Effect: Rebuild assembled polyline when way selection changes ────────────
  useEffect(() => {
    if (activeRelationId !== null && activeRelationWayIds.length > 0) {
      setAssembledPolyline(assembleOrderedWays(osmWays, activeRelationWayIds))
      return
    }
    setAssembledPolyline(assembleWays(osmWays.filter((w) => selectedWayIds.has(w.id))))
  }, [selectedWayIds, osmWays, activeRelationId, activeRelationWayIds])

  // ── Effect: Render assembled polyline layer ──────────────────────────────────
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map) return

    assembledLayerRef.current?.remove()
    assembledLayerRef.current = null

    if (assembledPolyline.length > 1 && (segStep === 2 || segStep === 3)) {
      assembledLayerRef.current = L.polyline(
        assembledPolyline.map((p) => [p.lat, p.lng] as [number, number]),
        { color: '#0074d9', weight: 4, opacity: 0.8 }
      ).addTo(map)
    }

    return () => { assembledLayerRef.current?.remove() }
  }, [assembledPolyline, segStep])

  // ── Effect: Render trip stop markers (steps 2 & 3) ──────────────────────────
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map || mode !== 'segments') return

    stopMarkersRef.current.forEach((m) => m.remove())
    stopMarkersRef.current = []

    for (const stop of tripStops) {
      const m = L.circleMarker([stop.stop_lat, stop.stop_lon], {
        radius: 7,
        color: '#fff',
        fillColor: '#0074d9',
        fillOpacity: 1,
        weight: 2,
      }).addTo(map).bindTooltip(stop.stop_name, { direction: 'top' })
      stopMarkersRef.current.push(m)
    }

    return () => { stopMarkersRef.current.forEach((m) => m.remove()); stopMarkersRef.current = [] }
  }, [tripStops, mode])

  // ── Effect: Render existing segments as faint grey polylines (seg step 1) ────
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map) return

    existingSegLayersRef.current.forEach((l) => l.remove())
    existingSegLayersRef.current.clear()

    if (mode !== 'segments' || segStep !== 1) return

    for (const [key, coords] of Object.entries(existingSegmentPathsForMap)) {
      if (coords.length < 2) continue
      const line = L.polyline(
        coords.map((p) => [p.lat, p.lng] as [number, number]),
        { color: '#555', weight: 2, opacity: 0.6, interactive: false }
      ).addTo(map)
      existingSegLayersRef.current.set(key, line)
    }

    return () => { existingSegLayersRef.current.forEach((l) => l.remove()); existingSegLayersRef.current.clear() }
  }, [existingSegmentPathsForMap, mode, segStep])

  // ── Effect: Update existing segment styles on hover ───────────────────────────
  useEffect(() => {
    for (const [key, line] of existingSegLayersRef.current) {
      const isHov = hoveredSegmentKey === key
      line.setStyle({ color: isHov ? '#fff' : '#555', weight: isHov ? 4 : 2, opacity: isHov ? 1 : 0.6 })
      const el = line.getElement() as SVGElement | null
      if (el) el.style.filter = isHov ? 'drop-shadow(0 0 4px #fff)' : ''
    }
  }, [hoveredSegmentKey])

  // ── Effect: Keep fromStop/toStop refs in sync (for map click handlers) ───────
  useEffect(() => { fromStopRef.current = fromStop }, [fromStop])
  useEffect(() => { toStopRef.current = toStop }, [toStop])

  // ── Effect: Create stop markers for segments step 1 ───────────────────────────
  // Markers are created once per stop list; styles are updated imperatively below.
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map) return

    segStopMarkersRef.current.forEach((m) => m.remove())
    segStopMarkersRef.current.clear()

    const showForSegments = mode === 'segments' && segStep === 1
    const showForLines = mode === 'lines'
    if ((!showForSegments && !showForLines) || allStops.length === 0) return

    for (const stop of allStops) {
      const m = L.circleMarker([stop.stop_lat, stop.stop_lon], {
        radius: 5,
        color: '#aaa',
        fillColor: '#555',
        fillOpacity: 1,
        weight: 1,
        interactive: showForSegments,
      }).addTo(map).bindTooltip(stop.stop_name, { direction: 'top', opacity: 0.9 })

      if (showForSegments) {
        m.on('click', (e) => {
          e.originalEvent?.stopPropagation()
          const from = fromStopRef.current
          const to = toStopRef.current
          if (!from) {
            setFromStop(stop)
          } else if (!to) {
            setToStop(stop)
          } else {
            setFromStop(stop)
            setToStop(null)
          }
        })
      }

      segStopMarkersRef.current.set(stop.stop_id, m)
    }

    return () => { segStopMarkersRef.current.forEach((m) => m.remove()); segStopMarkersRef.current.clear() }
  }, [allStops, mode, segStep]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect: Update stop marker styles when selection/hover changes ─────────
  useEffect(() => {
    for (const [stopId, marker] of segStopMarkersRef.current) {
      const isFrom = fromStop?.stop_id === stopId
      const isTo = toStop?.stop_id === stopId
      const isHov = hoveredStopId === stopId
      marker.setRadius(isFrom || isTo ? 9 : isHov ? 7 : 5)
      marker.setStyle({
        color: isFrom ? '#2ecc71' : isTo ? '#e74c3c' : isHov ? '#fff' : '#aaa',
        fillColor: isFrom ? '#2ecc71' : isTo ? '#e74c3c' : isHov ? '#ccc' : '#555',
        weight: isFrom || isTo || isHov ? 2 : 1,
      })
      const el = marker.getElement() as SVGElement | null
      if (el) el.style.filter = isHov && !isFrom && !isTo ? 'drop-shadow(0 0 3px #fff)' : ''
    }
  }, [fromStop, toStop, hoveredStopId])

  // ── Effect: Render cut point markers ────────────────────────────────────────
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map) return

    cutMarkersRef.current.forEach((m) => m.remove())
    cutMarkersRef.current = []

    for (const cp of cutPoints) {
      const stop = tripStops.find((s) => s.stop_id === cp.stopId)
      const label = stop ? `✂ ${stop.stop_name}` : '✂'
      const m = L.marker([cp.latlng.lat, cp.latlng.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="background:#e74c3c;color:#fff;padding:2px 5px;border-radius:3px;white-space:nowrap;font-size:11px">${label}</div>`,
        }),
      }).addTo(map)
      cutMarkersRef.current.push(m)
    }

    return () => { cutMarkersRef.current.forEach((m) => m.remove()); cutMarkersRef.current = [] }
  }, [cutPoints, tripStops])

  // ── Effect: Render line preview polylines on hover (Lines mode step 1) ────────
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    linePreviewLayersRef.current.forEach((l) => l.remove())
    linePreviewLayersRef.current = []

    if (!L || !map || !hoveredLineKey || selectedLineKey !== null) return

    const segKeys = linePaths[hoveredLineKey]
    if (!segKeys || segKeys.length === 0) return

    const [shortName, dirStr] = hoveredLineKey.split('|')
    const entry = tripEntries.find(
      (e) => e.route_short_name === shortName && e.direction_id === parseInt(dirStr, 10)
    )
    const color = entry ? `#${entry.route_color}` : '#4a90d9'

    for (const sk of segKeys) {
      const coords = allSegmentPaths[sk]
      if (!coords || coords.length < 2) continue
      linePreviewLayersRef.current.push(
        L.polyline(coords.map((p) => [p.lat, p.lng] as [number, number]), {
          color,
          weight: 4,
          opacity: 0.85,
          interactive: false,
        }).addTo(map)
      )
    }

    return () => { linePreviewLayersRef.current.forEach((l) => l.remove()); linePreviewLayersRef.current = [] }
  }, [hoveredLineKey, selectedLineKey, linePaths, allSegmentPaths, tripEntries])

  // ── Effect: Render clickable segment polylines for Lines mode ─────────────────
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map) return

    segmentLayersRef.current.forEach((l) => l.remove())
    segmentLayersRef.current.clear()

    if (mode !== 'lines' || selectedLineKey === null) return

    for (const [sk, coords] of Object.entries(allSegmentPaths)) {
      if (coords.length < 2) continue

      const inSequence = segmentSequence.includes(sk)
      const isHighlighted = highlightedSegmentKey === sk

      const line = L.polyline(
        coords.map((p) => [p.lat, p.lng] as [number, number]),
        {
          color: isHighlighted ? '#fff' : inSequence ? '#27ae60' : '#666',
          weight: isHighlighted ? 6 : inSequence ? 5 : 3,
          opacity: isHighlighted ? 1 : inSequence ? 0.9 : 0.6,
        }
      ).addTo(map)

      line.on('mouseover', () => {
        setHighlightedSegmentKey(sk)
      })
      line.on('mouseout', () => {
        setHighlightedSegmentKey(null)
      })
      line.on('click', (e) => {
        e.originalEvent?.stopPropagation()
        setSegmentSequence((prev) => [...prev, sk])
      })

      segmentLayersRef.current.set(sk, line)
    }

    return () => { segmentLayersRef.current.forEach((l) => l.remove()); segmentLayersRef.current.clear() }
  }, [allSegmentPaths, mode, selectedLineKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect: Update segment layer styles when sequence/highlight changes ───────
  useEffect(() => {
    for (const [sk, line] of segmentLayersRef.current) {
      const inSequence = segmentSequence.includes(sk)
      const isHighlighted = highlightedSegmentKey === sk
      line.setStyle({
        color: isHighlighted ? '#fff' : inSequence ? '#27ae60' : '#666',
        weight: isHighlighted ? 6 : inSequence ? 5 : 3,
        opacity: isHighlighted ? 1 : inSequence ? 0.9 : 0.6,
      })
      const el = line.getElement() as SVGElement | null
      if (el) el.style.filter = isHighlighted ? 'drop-shadow(0 0 4px #fff)' : ''
    }
  }, [segmentSequence, highlightedSegmentKey])

  // ── Effect: Attach / detach map event handlers when snapping changes ─────────
  const handleMouseMove = useCallback(
    (e: L.LeafletMouseEvent) => {
      if (!snappingActive || assembledPolyline.length < 2) return
      const result = projectPointOnPolyline({ lat: e.latlng.lat, lng: e.latlng.lng }, assembledPolyline)
      if (!result) return
      setPendingCut(result)

      const L = leafletRef.current
      const map = mapRef.current
      if (!L || !map) return

      if (!snapMarkerRef.current) {
        snapMarkerRef.current = L.marker([result.point.lat, result.point.lng], {
          icon: L.divIcon({
            className: '',
            html: '<div style="width:12px;height:12px;background:#e74c3c;border:2px solid #fff;border-radius:50%;margin:-6px 0 0 -6px"></div>',
          }),
          interactive: false,
        }).addTo(map)
      } else {
        snapMarkerRef.current.setLatLng([result.point.lat, result.point.lng])
      }
    },
    [snappingActive, assembledPolyline]
  )

  const handleMapClick = useCallback(
    (_e: L.LeafletMouseEvent) => {
      if (!snappingActive || !pendingCut) return
      const usedStops = new Set(cutPoints.map((c) => c.stopId))
      const firstFree = tripStops.find((s) => !usedStops.has(s.stop_id))
      setPendingStopId(firstFree?.stop_id ?? '')
    },
    [snappingActive, pendingCut, cutPoints, tripStops]
  )

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.on('mousemove', handleMouseMove)
    map.on('click', handleMapClick)
    return () => { map.off('mousemove', handleMouseMove); map.off('click', handleMapClick) }
  }, [handleMouseMove, handleMapClick])

  // ── Effect: Ctrl+Z undo ───────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && mode === 'clusters') {
        e.preventDefault()
        const prev = clustersHistoryRef.current.pop()
        if (prev) setClusters(prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode])

  // ── Effect: Remove snap marker when snapping is disabled ─────────────────────
  useEffect(() => {
    if (!snappingActive) {
      snapMarkerRef.current?.remove()
      snapMarkerRef.current = null
    }
  }, [snappingActive])

  // ── Data loaders ─────────────────────────────────────────────────────────────

  async function loadClustersData() {
    setStatus('Chargement des clusters…')
    try {
      const { stops, clusters: loaded } = await loadClusters()
      setAllStops(stops)
      setClusters(loaded)
      setClusterStopIdSet(new Set(loaded.flatMap((c) => c.stopIds)))
      clustersHistoryRef.current = []
      setStatus(`${loaded.length} clusters chargés`)
    } catch (e) {
      setStatus(`Erreur GTFS: ${e}`)
    }
  }

  async function loadSegmentsData() {
    setStatus('Chargement des données segments…')
    try {
      const [{ ways, relations }, existing, tramStops] = await Promise.all([
        fetchOsmData(),
        loadSegmentPaths(),
        loadTramStops(),
      ])
      setOsmWays(ways)
      setOsmRelations(relations)
      setExistingSegmentKeys(new Set(Object.keys(existing)))
      setExistingSegmentPathsForMap(existing)
      setAllStops(tramStops)
      setSegStep(1)
      setFromStop(null)
      setToStop(null)
      setStatus(`${ways.length} voies OSM, ${Object.keys(existing).length} segments existants`)
    } catch (e) {
      setStatus(`Erreur: ${e}`)
    }
  }

  async function loadLinesData() {
    setStatus('Chargement des données lignes…')
    try {
      const [{ tripEntries: entries }, segPaths, linePaths, tramStops] = await Promise.all([
        loadTripEntries(),
        loadSegmentPaths(),
        loadLinePaths(),
        loadTramStops(),
      ])
      setTripEntries(entries)
      setAllSegmentPaths(segPaths)
      setLinePaths(linePaths)
      setAllStops(tramStops)
      setSelectedLineKey(null)
      setSegmentSequence([])
      setStatus(`${Object.keys(segPaths).length} segments disponibles`)
    } catch (e) {
      setStatus(`Erreur: ${e}`)
    }
  }

  // ── Cluster operations ────────────────────────────────────────────────────────

  function autoCenterClusters() {
    const stopById = new Map(allStops.map((s) => [s.stop_id, s]))
    clustersHistoryRef.current.push(clusters.map((c) => ({ ...c })))
    setClusters((prev) => prev.map((cluster) => {
      const members = cluster.stopIds.map((id) => stopById.get(id)).filter(Boolean) as TripStop[]
      if (members.length === 0) return cluster
      const lat = members.reduce((sum, s) => sum + s.stop_lat, 0) / members.length
      const lng = members.reduce((sum, s) => sum + s.stop_lon, 0) / members.length
      return { ...cluster, lat, lng }
    }))
  }

  // ── Segments: stop selection (FROM → TO) ────────────────────────────────────

  function handleStopClick(stop: TripStop) {
    if (!fromStop) {
      setFromStop(stop)
    } else if (!toStop) {
      setToStop(stop)
    } else {
      setFromStop(stop)
      setToStop(null)
    }
  }

  // ── Segments: confirm stop pair and advance to step 2 ────────────────────────

  function confirmStopPair() {
    if (!fromStop || !toStop) return
    setTripStops([fromStop, toStop])
    setSegStep(2)
    setSelectedWayIds(new Set())
    setActiveRelationId(null)
    setActiveRelationWayIds([])
    setAssembledPolyline([])
    setCutPoints([])
    setSnappingActive(false)
  }

  // ── Cut point operations ──────────────────────────────────────────────────────

  function commitCutPoint() {
    if (!pendingCut || !pendingStopId) return
    setCutPoints((prev) => [
      ...prev,
      { latlng: pendingCut.point, stopId: pendingStopId, indexOnPolyline: pendingCut.segIdx, tOnSegment: pendingCut.t },
    ])
    setPendingStopId('')
  }

  function autoPlaceCutPoints() {
    if (assembledPolyline.length < 2) return
    const cuts: CutPoint[] = []
    for (const stop of tripStops) {
      const proj = projectPointOnPolyline({ lat: stop.stop_lat, lng: stop.stop_lon }, assembledPolyline)
      if (!proj) continue
      cuts.push({ latlng: proj.point, stopId: stop.stop_id, indexOnPolyline: proj.segIdx, tOnSegment: proj.t })
    }
    setCutPoints(cuts)
  }

  // ── Way assembly callbacks (passed to WayAssemblyPanel) ───────────────────────

  function handleRelationToggle(id: number | null, wayIds?: number[]) {
    if (!id) {
      setActiveRelationId(null)
      setActiveRelationWayIds([])
      setSelectedWayIds(new Set())
    } else {
      setActiveRelationId(id)
      setActiveRelationWayIds(sortWayIdsByProximity(osmWays, wayIds!))
      setSelectedWayIds(new Set(wayIds!))
    }
  }

  function handleWayReorder(fromIdx: number, toIdx: number) {
    setActiveRelationWayIds((prev) => {
      const next = [...prev]
      const [item] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, item)
      return next
    })
  }

  function handleWayRemove(idx: number) {
    const wayId = activeRelationWayIds[idx]
    setActiveRelationWayIds((prev) => prev.filter((_, i) => i !== idx))
    setSelectedWayIds((prev) => { const next = new Set(prev); next.delete(wayId); return next })
  }

  function handleWayReset() {
    setSelectedWayIds(new Set())
    setActiveRelationId(null)
    setActiveRelationWayIds([])
    setAssembledPolyline([])
    setCutPoints([])
  }

  // ── Persistence handlers ──────────────────────────────────────────────────────

  async function handleSaveClusters() {
    setStatus('Sauvegarde des clusters…')
    try {
      await saveClusters(clusters)
      setStatus('Clusters sauvegardés ✓')
    } catch (e) {
      setStatus(`Erreur sauvegarde: ${e}`)
    }
  }

  async function handleSaveSegments() {
    setStatus('Sauvegarde des segments…')
    try {
      let newSegments: Record<string, LatLng[]>
      if (cutPoints.length >= 2) {
        newSegments = buildSegmentPaths(assembledPolyline, cutPoints)
      } else {
        // Single segment: whole polyline from fromStop → toStop
        newSegments = { [makeSegmentKey(fromStop!.stop_id, toStop!.stop_id)]: assembledPolyline }
      }
      await saveSegments(newSegments)
      // Update local state
      const newKeys = Object.keys(newSegments)
      setExistingSegmentKeys((prev) => new Set([...prev, ...newKeys]))
      setExistingSegmentPathsForMap((prev) => ({ ...prev, ...newSegments }))
      setStatus(`${newKeys.length} segment(s) sauvegardé(s) ✓`)
    } catch (e) {
      setStatus(`Erreur sauvegarde: ${e}`)
    }
  }

  async function handleDeleteSegment(key: string) {
    setStatus(`Suppression de ${key}…`)
    try {
      await deleteSegment(key)
      setExistingSegmentKeys((prev) => { const next = new Set(prev); next.delete(key); return next })
      setExistingSegmentPathsForMap((prev) => { const next = { ...prev }; delete next[key]; return next })
      setStatus(`Segment supprimé ✓`)
    } catch (e) {
      setStatus(`Erreur suppression: ${e}`)
    }
  }

  async function handleSaveLinePath() {
    if (!selectedLineKey || segmentSequence.length === 0) return
    setStatus('Sauvegarde du tracé de ligne…')
    try {
      await saveLinePath(selectedLineKey, segmentSequence)
      setLinePaths((prev) => ({ ...prev, [selectedLineKey]: segmentSequence }))
      setStatus(`Tracé ${selectedLineKey} sauvegardé ✓`)
    } catch (e) {
      setStatus(`Erreur sauvegarde: ${e}`)
    }
  }

  // ── Lines callbacks (passed to LinesPanel) ────────────────────────────────────

  function handleSelectLine(key: string) {
    setSelectedLineKey(key)
    setSegmentSequence(linePaths[key] ?? [])
  }

  function handleSegmentReorder(fromIdx: number, toIdx: number) {
    setSegmentSequence((prev) => {
      const next = [...prev]
      const [item] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, item)
      return next
    })
  }

  // ── Computed values ───────────────────────────────────────────────────────────

  const segmentCount = cutPoints.length > 1 ? cutPoints.length - 1 : 0

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif', fontSize: 14 }}>

      {/* Toolbar */}
      <div style={{ background: '#1a1a2e', color: '#eee', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ marginRight: 8 }}>Admin Geodata</strong>

        {/* Mode switcher */}
        <button onClick={() => { setMode('clusters'); setSegStep(1) }}
          style={{ background: mode === 'clusters' ? '#4a90d9' : '#333', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}>
          Clusters
        </button>
        <button onClick={() => setMode('segments')}
          style={{ background: mode === 'segments' ? '#4a90d9' : '#333', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}>
          Segments
        </button>
        <button onClick={() => setMode('lines')}
          style={{ background: mode === 'lines' ? '#4a90d9' : '#333', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}>
          Lignes
        </button>

        <span style={{ flex: 1 }} />

        {/* Clusters mode actions */}
        {mode === 'clusters' && (
          <>
            <button onClick={autoCenterClusters}
              style={{ background: '#2980b9', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}>
              ⟳ Centrer sur arrêts
            </button>
            <button onClick={handleSaveClusters}
              style={{ background: '#27ae60', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}>
              Sauvegarder clusters
            </button>
          </>
        )}

        {/* Segments step 2 action: advance to step 3 */}
        {mode === 'segments' && segStep === 2 && assembledPolyline.length > 1 && (
          <button onClick={() => setSegStep(3)}
            style={{ background: '#8e44ad', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}>
            Étape 3 — Découpage →
          </button>
        )}

        {/* Segments step 3 actions */}
        {mode === 'segments' && segStep === 3 && (
          <>
            <button onClick={autoPlaceCutPoints}
              style={{ background: '#2980b9', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}>
              ⟳ Auto-placer depuis arrêts
            </button>
            <button onClick={() => setSnappingActive((v) => !v)}
              style={{ background: snappingActive ? '#e74c3c' : '#555', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}>
              {snappingActive ? '✂ Coupure active' : '✂ Activer coupure'}
            </button>
            <button onClick={handleSaveSegments}
              style={{ background: '#27ae60', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}>
              Sauvegarder segments ({segmentCount})
            </button>
          </>
        )}

        <span style={{ color: '#aaa', fontSize: 12 }}>{status}</span>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Side panel */}
        <div style={{ width: 320, background: '#16213e', color: '#ddd', overflowY: 'auto', padding: 10, flexShrink: 0 }}>

          {mode === 'clusters' && (
            <ClustersPanel clusters={clusters} />
          )}

          {mode === 'segments' && segStep === 1 && (
            <SegmentStopPicker
              allStops={allStops}
              existingSegmentKeys={existingSegmentKeys}
              fromStop={fromStop}
              toStop={toStop}
              onStopClick={handleStopClick}
              onFromClear={() => setFromStop(null)}
              onToClear={() => setToStop(null)}
              onStopHover={setHoveredStopId}
              onSegmentHover={setHoveredSegmentKey}
              onConfirm={confirmStopPair}
              onDelete={handleDeleteSegment}
            />
          )}

          {mode === 'segments' && segStep === 2 && fromStop && toStop && (
            <WayAssemblyPanel
              header={{ title: `${fromStop.stop_name} → ${toStop.stop_name}`, color: '0074d9' }}
              osmRelations={osmRelations}
              osmWays={osmWays}
              activeRelationId={activeRelationId}
              activeRelationWayIds={activeRelationWayIds}
              hoveredRelationId={hoveredRelationId}
              hoveredWayId={hoveredWayId}
              assembledPolyline={assembledPolyline}
              cutPoints={cutPoints}
              onRelationHover={setHoveredRelationId}
              onRelationToggle={handleRelationToggle}
              onWayHover={setHoveredWayId}
              onWayReorder={handleWayReorder}
              onWayRemove={handleWayRemove}
              onReset={handleWayReset}
              onBack={() => setSegStep(1)}
            />
          )}

          {mode === 'segments' && segStep === 3 && fromStop && toStop && (
            <CutPointPanel
              header={{ title: `${fromStop.stop_name} → ${toStop.stop_name}`, color: '0074d9' }}
              tripStops={tripStops}
              cutPoints={cutPoints}
              snappingActive={snappingActive}
              pendingCut={pendingCut}
              pendingStopId={pendingStopId}
              onPendingStopChange={setPendingStopId}
              onCommitCut={commitCutPoint}
              onRemoveCut={(idx) => setCutPoints((prev) => prev.filter((_, i) => i !== idx))}
              onBack={() => { setSegStep(2); setSnappingActive(false) }}
            />
          )}

          {mode === 'lines' && (
            <LinesPanel
              tripEntries={tripEntries}
              existingLinePaths={linePaths}
              selectedLineKey={selectedLineKey}
              segmentSequence={segmentSequence}
              highlightedSegmentKey={highlightedSegmentKey}
              onLineHover={setHoveredLineKey}
              onSelectLine={handleSelectLine}
              onBack={() => { setSelectedLineKey(null); setSegmentSequence([]) }}
              onSegmentReorder={handleSegmentReorder}
              onSegmentRemove={(idx) => setSegmentSequence((prev) => prev.filter((_, i) => i !== idx))}
              onSegmentHighlight={setHighlightedSegmentKey}
              onSave={handleSaveLinePath}
            />
          )}
        </div>

        {/* Map container — Leaflet mounts here */}
        <div ref={mapContainerRef} style={{ flex: 1 }} />
      </div>
    </div>
  )
}
