'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState, useCallback } from 'react'
import type L from 'leaflet'
import type { Cluster } from '../../lib/gtfs'
import type { LatLng } from '../../lib/geo'
import { GRENOBLE_CENTER, GRENOBLE_BOUNDS } from '../../lib/config'

import type { OsmWay, OsmRelation, TripEntry, TripStop, CutPoint, PendingCut } from './types'
import {
  assembleWays,
  assembleOrderedWays,
  sortWayIdsByProximity,
  projectPointOnPolyline,
  buildSegmentPaths,
  hexColor,
} from './lib/geo'
import {
  loadClusters,
  loadTripEntries,
  getTripStops,
  fetchOsmData,
  saveClusters,
  saveSegments,
  saveLinePath,
} from './lib/loaders'

import ClustersPanel from './components/ClustersPanel'
import TripSelector from './components/TripSelector'
import WayAssemblyPanel from './components/WayAssemblyPanel'
import CutPointPanel from './components/CutPointPanel'

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'clusters' | 'segments'
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
  const cutMarkersRef = useRef<L.Marker[]>([])
  const snapMarkerRef = useRef<L.Marker | null>(null)
  const previewStopMarkersRef = useRef<L.CircleMarker[]>([])
  const clustersHistoryRef = useRef<Cluster[][]>([])

  // ── Shared state ─────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('clusters')
  const [status, setStatus] = useState<string>('')

  // ── Clusters state ───────────────────────────────────────────────────────────
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [allStops, setAllStops] = useState<TripStop[]>([])
  // Derived once at load time — stopIds don't change at runtime, only positions do.
  // Kept separate so dragging a cluster doesn't trigger stop-dot re-creation.
  const [clusterStopIdSet, setClusterStopIdSet] = useState<Set<string>>(new Set())

  // ── Segments state ───────────────────────────────────────────────────────────
  const [segStep, setSegStep] = useState<SegStep>(1)
  const [tripEntries, setTripEntries] = useState<TripEntry[]>([])
  const [routeColorMap, setRouteColorMap] = useState<Map<string, string>>(new Map())
  const [selectedTrip, setSelectedTrip] = useState<TripEntry | null>(null)
  const [osmWays, setOsmWays] = useState<OsmWay[]>([])
  const [osmRelations, setOsmRelations] = useState<OsmRelation[]>([])
  // hoveredRelationId and hoveredWayId drive Leaflet style updates imperatively
  const [hoveredRelationId, setHoveredRelationId] = useState<number | null>(null)
  const [activeRelationId, setActiveRelationId] = useState<number | null>(null)
  const [activeRelationWayIds, setActiveRelationWayIds] = useState<number[]>([])
  const [hoveredWayId, setHoveredWayId] = useState<number | null>(null)
  const [selectedWayIds, setSelectedWayIds] = useState<Set<number>>(new Set())
  const [assembledPolyline, setAssembledPolyline] = useState<LatLng[]>([])
  const [tripStops, setTripStops] = useState<TripStop[]>([])
  const [previewStops, setPreviewStops] = useState<TripStop[]>([])
  const [cutPoints, setCutPoints] = useState<CutPoint[]>([])
  const [snappingActive, setSnappingActive] = useState(false)
  const [pendingCut, setPendingCut] = useState<PendingCut | null>(null)
  const [pendingStopId, setPendingStopId] = useState<string>('')

  // ── Effect: Init Leaflet map ─────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return

    import('leaflet').then((L) => {
      leafletRef.current = L

      // Fix default marker icon paths broken by webpack
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
    if (mode === 'segments') loadTripsData()
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

  // ── Effect: Create OSM way polyline layers (separated from style updates) ────
  // Layers are never recreated on selection change — recreating them would race
  // with click events and cause the toggle to fail.
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
        setActiveRelationId(null) // manual toggle breaks relation-order mode
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
    const routeColor = selectedTrip ? hexColor(selectedTrip.route_color) : '#0074d9'
    const hoveredRelWayIds = hoveredRelationId
      ? new Set(osmRelations.find((r) => r.id === hoveredRelationId)?.wayIds ?? [])
      : null

    for (const [wayId, line] of wayLayersRef.current) {
      const isRelHovered = hoveredRelWayIds?.has(wayId) ?? false
      const isItemHovered = wayId === hoveredWayId
      const isGlowed = isRelHovered || isItemHovered

      if (activeRelationId !== null && !isGlowed) {
        // Dim all raw ways when a relation is active — the assembled polyline is the visual
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
  }, [selectedWayIds, selectedTrip, hoveredRelationId, osmRelations, activeRelationId, hoveredWayId])

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
  // When activeRelationId is set, use the canonical OSM relation member order to
  // exclude sidings and depot ways that cause loops. Falls back to nearest-
  // neighbour assembly for manual selections.
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
        { color: selectedTrip ? hexColor(selectedTrip.route_color) : '#0074d9', weight: 4, opacity: 0.8 }
      ).addTo(map)
    }

    return () => { assembledLayerRef.current?.remove() }
  }, [assembledPolyline, selectedTrip, segStep])

  // ── Effect: Render trip stop markers (steps 2 & 3) ──────────────────────────
  // Markers are shown as soon as a trip is selected and persist when navigating
  // back from step 3, giving the operator context during way assembly.
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map || mode !== 'segments' || !selectedTrip) return

    stopMarkersRef.current.forEach((m) => m.remove())
    stopMarkersRef.current = []

    for (const stop of tripStops) {
      const m = L.circleMarker([stop.stop_lat, stop.stop_lon], {
        radius: 7,
        color: '#fff',
        fillColor: selectedTrip ? hexColor(selectedTrip.route_color) : '#0074d9',
        fillOpacity: 1,
        weight: 2,
      }).addTo(map).bindTooltip(stop.stop_name, { direction: 'top' })
      stopMarkersRef.current.push(m)
    }

    return () => { stopMarkersRef.current.forEach((m) => m.remove()); stopMarkersRef.current = [] }
  }, [tripStops, selectedTrip, mode])

  // ── Effect: Render hover-preview stop markers (step 1 only) ─────────────────
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map) return

    previewStopMarkersRef.current.forEach((m) => m.remove())
    previewStopMarkersRef.current = []

    if (mode !== 'segments' || segStep !== 1 || previewStops.length === 0) return

    for (const stop of previewStops) {
      const m = L.circleMarker([stop.stop_lat, stop.stop_lon], {
        radius: 7,
        color: '#fff',
        fillColor: '#4a90d9',
        fillOpacity: 1,
        weight: 2,
        interactive: false,
      }).addTo(map).bindTooltip(stop.stop_name, { direction: 'top' })
      previewStopMarkersRef.current.push(m)
    }

    return () => { previewStopMarkersRef.current.forEach((m) => m.remove()); previewStopMarkersRef.current = [] }
  }, [previewStops, mode, segStep])

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
      // Pre-select the first stop that doesn't already have a cut point
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

  async function loadTripsData() {
    setStatus('Chargement des trips…')
    try {
      const { tripEntries: entries, routeColorMap: colorMap } = await loadTripEntries()
      setTripEntries(entries)
      setRouteColorMap(colorMap)
      setStatus(`${entries.length} trajets chargés`)
    } catch (e) {
      setStatus(`Erreur: ${e}`)
    }
  }

  async function loadOsmWays() {
    setStatus('Chargement des voies OSM…')
    try {
      const { ways, relations } = await fetchOsmData()
      setOsmWays(ways)
      setOsmRelations(relations)
      setStatus(`${ways.length} voies, ${relations.length} relations OSM`)
    } catch (e) {
      setStatus(`Erreur Overpass: ${e}`)
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

  // ── Trip selection ────────────────────────────────────────────────────────────

  function handleTripHover(entry: TripEntry | null) {
    setPreviewStops(entry ? getTripStops(entry.trip_id) : [])
  }

  function selectTrip(entry: TripEntry) {
    setPreviewStops([])
    setSelectedTrip(entry)
    setSegStep(2)
    setSelectedWayIds(new Set())
    setActiveRelationId(null)
    setActiveRelationWayIds([])
    setAssembledPolyline([])
    setCutPoints([])
    setSnappingActive(false)
    setTripStops(getTripStops(entry.trip_id))
    loadOsmWays()
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
      const newSegments = buildSegmentPaths(assembledPolyline, cutPoints)
      await saveSegments(newSegments)
      setStatus(`${Object.keys(newSegments).length} segments sauvegardés ✓`)
    } catch (e) {
      setStatus(`Erreur sauvegarde: ${e}`)
    }
  }

  async function handleSaveLinePath() {
    if (!assembledPolyline.length || !selectedTrip) return
    const key = `${selectedTrip.route_short_name}|${selectedTrip.direction_id}`
    setStatus('Sauvegarde du tracé de ligne…')
    try {
      await saveLinePath(key, assembledPolyline)
      setStatus(`Tracé ${key} sauvegardé ✓`)
    } catch (e) {
      setStatus(`Erreur sauvegarde: ${e}`)
    }
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
            <TripSelector tripEntries={tripEntries} onSelect={selectTrip} onHover={handleTripHover} />
          )}

          {mode === 'segments' && segStep === 2 && selectedTrip && (
            <WayAssemblyPanel
              selectedTrip={selectedTrip}
              osmRelations={osmRelations}
              osmWays={osmWays}
              activeRelationId={activeRelationId}
              activeRelationWayIds={activeRelationWayIds}
              hoveredRelationId={hoveredRelationId}
              hoveredWayId={hoveredWayId}
              assembledPolyline={assembledPolyline}
              cutPoints={cutPoints}
              onRelationHover={setHoveredRelationId}
              onRelationToggle={(id, wayIds) => {
                if (!id) {
                  setActiveRelationId(null)
                  setActiveRelationWayIds([])
                  setSelectedWayIds(new Set())
                } else {
                  // Sort geographically — OSM relation member order is often arbitrary
                  setActiveRelationId(id)
                  setActiveRelationWayIds(sortWayIdsByProximity(osmWays, wayIds!))
                  setSelectedWayIds(new Set(wayIds!))
                }
              }}
              onWayHover={setHoveredWayId}
              onWayReorder={(fromIdx, toIdx) => {
                setActiveRelationWayIds((prev) => {
                  const next = [...prev]
                  const [item] = next.splice(fromIdx, 1)
                  next.splice(toIdx, 0, item)
                  return next
                })
              }}
              onWayRemove={(idx) => {
                const wayId = activeRelationWayIds[idx]
                setActiveRelationWayIds((prev) => prev.filter((_, i) => i !== idx))
                setSelectedWayIds((prev) => { const next = new Set(prev); next.delete(wayId); return next })
              }}
              onSaveLinePath={handleSaveLinePath}
              onReset={() => {
                setSelectedWayIds(new Set())
                setActiveRelationId(null)
                setActiveRelationWayIds([])
                setAssembledPolyline([])
                setCutPoints([])
              }}
              onBack={() => setSegStep(1)}
            />
          )}

          {mode === 'segments' && segStep === 3 && selectedTrip && (
            <CutPointPanel
              selectedTrip={selectedTrip}
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
        </div>

        {/* Map container — Leaflet mounts here */}
        <div ref={mapContainerRef} style={{ flex: 1 }} />
      </div>
    </div>
  )
}
