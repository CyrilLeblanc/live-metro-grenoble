'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type L from 'leaflet'
import type { Cluster } from '../../lib/gtfs'
import type { LatLng } from '../../lib/geo'
import { makeSegmentKey } from '../../lib/geo'
import { GRENOBLE_CENTER, GRENOBLE_BOUNDS } from '../../lib/config'
import { fetchGtfsStatic } from '../../lib/api'
import type { Route, TripClient } from '../../lib/gtfs'
import { getClusterId } from '../../lib/gtfs'

// ─── Types ────────────────────────────────────────────────────────────────────

interface OsmWay {
  id: number
  coords: LatLng[]
}

interface TripEntry {
  key: string // "routeId|directionId|headsign"
  route_id: string
  direction_id: number
  trip_headsign: string
  trip_id: string // a representative trip_id for stop list lookup
  route_short_name: string
  route_color: string
}

interface CutPoint {
  latlng: LatLng
  stopId: string
  indexOnPolyline: number // index of the closest segment start
  tOnSegment: number // interpolation t within that segment [0,1]
}

// ─── Orthogonal projection helper ─────────────────────────────────────────────

function projectPointOnPolyline(
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

// ─── Way joining logic ─────────────────────────────────────────────────────────

function distLatLng(a: LatLng, b: LatLng): number {
  return Math.hypot(a.lat - b.lat, a.lng - b.lng)
}

const OVERLAP_SNAP_DEG = 0.0001 // ~10m in degrees

/** Finds the index in `polyline` of the point nearest to `p` if within snap radius */
function findOverlapJunction(p: LatLng, polyline: LatLng[]): number {
  for (let i = 0; i < polyline.length; i++) {
    if (distLatLng(p, polyline[i]) < OVERLAP_SNAP_DEG) return i
  }
  return -1
}

/**
 * Appends `way` to the existing `assembledPolyline`.
 * - Tries all 4 endpoint combos (way forward/reversed vs polyline start/end).
 * - Picks the combo with minimum junction gap.
 * - Handles partial overlap by trimming the way from the overlap junction.
 * Returns the new full polyline.
 */
function joinWay(assembledPolyline: LatLng[], way: OsmWay): LatLng[] {
  if (assembledPolyline.length === 0) return [...way.coords]

  const wayFwd = way.coords
  const wayRev = [...way.coords].reverse()

  const polyStart = assembledPolyline[0]
  const polyEnd = assembledPolyline[assembledPolyline.length - 1]

  const candidates: Array<{ dist: number; fn: () => LatLng[] }> = [
    // Append way-forward to polyline end
    {
      dist: distLatLng(polyEnd, wayFwd[0]),
      fn: () => {
        const overlapIdx = findOverlapJunction(polyEnd, wayFwd)
        const slice = overlapIdx >= 0 ? wayFwd.slice(overlapIdx + 1) : wayFwd
        return [...assembledPolyline, ...slice]
      },
    },
    // Append way-reversed to polyline end
    {
      dist: distLatLng(polyEnd, wayRev[0]),
      fn: () => {
        const overlapIdx = findOverlapJunction(polyEnd, wayRev)
        const slice = overlapIdx >= 0 ? wayRev.slice(overlapIdx + 1) : wayRev
        return [...assembledPolyline, ...slice]
      },
    },
    // Prepend way-forward before polyline start
    {
      dist: distLatLng(wayFwd[wayFwd.length - 1], polyStart),
      fn: () => {
        const overlapIdx = findOverlapJunction(polyStart, wayFwd)
        const slice = overlapIdx >= 0 ? wayFwd.slice(0, overlapIdx) : wayFwd
        return [...slice, ...assembledPolyline]
      },
    },
    // Prepend way-reversed before polyline start
    {
      dist: distLatLng(wayRev[wayRev.length - 1], polyStart),
      fn: () => {
        const overlapIdx = findOverlapJunction(polyStart, wayRev)
        const slice = overlapIdx >= 0 ? wayRev.slice(0, overlapIdx) : wayRev
        return [...slice, ...assembledPolyline]
      },
    },
  ]

  candidates.sort((a, b) => a.dist - b.dist)
  return candidates[0].fn()
}

// ─── Colour helpers ────────────────────────────────────────────────────────────

function hexColor(c: string): string {
  return c.startsWith('#') ? c : `#${c}`
}

// ─── Main component ────────────────────────────────────────────────────────────

type Mode = 'clusters' | 'segments'
type SegStep = 1 | 2 | 3

export default function AdminMap() {
  const mapRef = useRef<L.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const leafletRef = useRef<typeof import('leaflet') | null>(null)

  // Shared
  const [mode, setMode] = useState<Mode>('clusters')
  const [status, setStatus] = useState<string>('')

  // Clusters mode
  const [clusters, setClusters] = useState<Cluster[]>([])
  const clusterMarkersRef = useRef<Map<string, L.Marker>>(new Map())

  // Segments mode
  const [segStep, setSegStep] = useState<SegStep>(1)
  const [tripEntries, setTripEntries] = useState<TripEntry[]>([])
  const [routeColorMap, setRouteColorMap] = useState<Map<string, string>>(new Map())
  const [selectedTrip, setSelectedTrip] = useState<TripEntry | null>(null)
  const [osmWays, setOsmWays] = useState<OsmWay[]>([])
  const [selectedWayIds, setSelectedWayIds] = useState<Set<number>>(new Set())
  const [assembledPolyline, setAssembledPolyline] = useState<LatLng[]>([])
  const [tripStops, setTripStops] = useState<Array<{ stop_id: string; stop_name: string; stop_lat: number; stop_lon: number }>>([])
  const [cutPoints, setCutPoints] = useState<CutPoint[]>([])
  const [snappingActive, setSnappingActive] = useState(false)
  const [pendingCut, setPendingCut] = useState<{ latlng: LatLng; segIdx: number; t: number } | null>(null)
  const [pendingStopId, setPendingStopId] = useState<string>('')

  // Leaflet layer refs for cleanup
  const wayLayersRef = useRef<Map<number, L.Polyline>>(new Map())
  const assembledLayerRef = useRef<L.Polyline | null>(null)
  const stopMarkersRef = useRef<L.CircleMarker[]>([])
  const cutMarkersRef = useRef<L.Marker[]>([])
  const snapMarkerRef = useRef<L.Marker | null>(null)

  // ── Init Leaflet map ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return

    import('leaflet').then((L) => {
      leafletRef.current = L

      // Fix default marker icon paths
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
        maxZoom: 19,
      }).addTo(map)

      mapRef.current = map
    })

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // ── Load data based on mode ──────────────────────────────────────────────────
  useEffect(() => {
    if (mode === 'clusters') loadClustersData()
    if (mode === 'segments') loadTripsData()
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadClustersData() {
    setStatus('Chargement des clusters…')
    let loaded: Cluster[] | null = null

    try {
      const res = await fetch('/api/admin/geodata?file=clusters')
      if (res.ok) loaded = await res.json()
    } catch { /* ignore */ }

    if (!loaded || loaded.length === 0) {
      // Fallback: derive clusters from GTFS
      setStatus('clusters.json absent — dérivation depuis GTFS…')
      try {
        const { routes, stops, stopTimes, trips } = await fetchGtfsStatic()
        const tripRouteMap = new Map<string, string>()
        for (const t of trips) tripRouteMap.set(t.trip_id, t.route_id)
        const colorMap = new Map<string, string>()
        for (const r of routes) colorMap.set(r.route_id, r.route_color)
        const stopById = new Map(stops.map((s) => [s.stop_id, s]))

        const clusterStops = new Map<string, typeof stops>()
        for (const s of stops) {
          const cid = getClusterId(s)
          if (!clusterStops.has(cid)) clusterStops.set(cid, [])
          clusterStops.get(cid)!.push(s)
        }

        // Collect stop_ids per cluster that appear in stop_times
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
        loaded = derived
      } catch (e) {
        setStatus(`Erreur GTFS: ${e}`)
        return
      }
    }

    setClusters(loaded ?? [])
    setStatus(`${loaded?.length ?? 0} clusters chargés`)
  }

  async function loadTripsData() {
    setStatus('Chargement des trips…')
    try {
      const { routes, trips, stops, stopTimes } = await fetchGtfsStatic()

      const colorMap = new Map<string, string>()
      const nameMap = new Map<string, string>()
      for (const r of routes) {
        colorMap.set(r.route_id, r.route_color)
        nameMap.set(r.route_id, r.route_short_name)
      }
      setRouteColorMap(colorMap)

      // Fetch raw trips.json for trip_headsign (not in the trimmed bundle)
      let rawTrips: Array<{ trip_id: string; route_id: string; direction_id: string; trip_headsign?: string; shape_id: string }> = []
      try {
        const res = await fetch('/gtfs/trips.json')
        if (res.ok) rawTrips = await res.json()
      } catch { /* ignore */ }

      const headsignMap = new Map<string, string>()
      for (const t of rawTrips) headsignMap.set(t.trip_id, t.trip_headsign ?? '')

      // Deduplicate by (route_id, direction_id, trip_headsign)
      const seen = new Map<string, TripEntry>()
      for (const t of trips as TripClient[]) {
        const headsign = headsignMap.get(t.trip_id) ?? ''
        const key = `${t.route_id}|${(t as unknown as { direction_id?: number }).direction_id ?? 0}|${headsign}`
        if (!seen.has(key)) {
          seen.set(key, {
            key,
            route_id: t.route_id,
            direction_id: (t as unknown as { direction_id?: number }).direction_id ?? 0,
            trip_headsign: headsign,
            trip_id: t.trip_id,
            route_short_name: nameMap.get(t.route_id) ?? t.route_id,
            route_color: colorMap.get(t.route_id) ?? 'cccccc',
          })
        }
      }

      // Store stop data for step 3 later
      const stopById = new Map(stops.map((s) => [s.stop_id, s]))
      const tripStopTimesMap = new Map<string, typeof stopTimes>()
      for (const st of stopTimes) {
        if (!tripStopTimesMap.has(st.trip_id)) tripStopTimesMap.set(st.trip_id, [])
        tripStopTimesMap.get(st.trip_id)!.push(st)
      }

      // Attach stopById and tripStopTimesMap to window for later use in step 3
      ;(window as unknown as Record<string, unknown>).__adminStopById = stopById
      ;(window as unknown as Record<string, unknown>).__adminTripStopTimesMap = tripStopTimesMap

      setTripEntries([...seen.values()])
      setStatus(`${seen.size} trajets chargés`)
    } catch (e) {
      setStatus(`Erreur: ${e}`)
    }
  }

  // ── Render cluster markers ───────────────────────────────────────────────────
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map || mode !== 'clusters') return

    // Remove old markers
    clusterMarkersRef.current.forEach((m) => m.remove())
    clusterMarkersRef.current.clear()

    for (const cluster of clusters) {
      const marker = L.marker([cluster.lat, cluster.lng], { draggable: true })
        .addTo(map)
        .bindTooltip(cluster.name, { permanent: false, direction: 'top' })

      marker.on('dragend', () => {
        const { lat, lng } = marker.getLatLng()
        setClusters((prev) =>
          prev.map((c) => (c.id === cluster.id ? { ...c, lat, lng } : c))
        )
      })

      clusterMarkersRef.current.set(cluster.id, marker)
    }

    return () => {
      clusterMarkersRef.current.forEach((m) => m.remove())
      clusterMarkersRef.current.clear()
    }
  }, [clusters, mode])

  // ── Render OSM ways (step 2) ─────────────────────────────────────────────────
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map || mode !== 'segments' || segStep !== 2) return

    // Clear old way layers
    wayLayersRef.current.forEach((l) => l.remove())
    wayLayersRef.current.clear()

    const color = selectedTrip ? hexColor(selectedTrip.route_color) : '#0074d9'

    for (const way of osmWays) {
      const isSelected = selectedWayIds.has(way.id)
      const line = L.polyline(
        way.coords.map((p) => [p.lat, p.lng] as [number, number]),
        {
          color: isSelected ? color : '#999',
          weight: isSelected ? 5 : 3,
          opacity: 1,
        }
      ).addTo(map)

      line.on('mouseover', () => { if (!isSelected) line.setStyle({ opacity: 0.5 }) })
      line.on('mouseout', () => { if (!isSelected) line.setStyle({ opacity: 1 }) })
      line.on('click', () => {
        setSelectedWayIds((prev) => {
          const next = new Set(prev)
          if (next.has(way.id)) {
            next.delete(way.id)
          } else {
            next.add(way.id)
          }
          return next
        })
      })

      wayLayersRef.current.set(way.id, line)
    }

    return () => {
      wayLayersRef.current.forEach((l) => l.remove())
      wayLayersRef.current.clear()
    }
  }, [osmWays, selectedWayIds, selectedTrip, mode, segStep])

  // ── Rebuild assembled polyline whenever selection changes ────────────────────
  useEffect(() => {
    let poly: LatLng[] = []
    for (const way of osmWays) {
      if (selectedWayIds.has(way.id)) {
        poly = joinWay(poly, way)
      }
    }
    setAssembledPolyline(poly)
  }, [selectedWayIds, osmWays])

  // ── Render assembled polyline ────────────────────────────────────────────────
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

    return () => {
      assembledLayerRef.current?.remove()
    }
  }, [assembledPolyline, selectedTrip, segStep])

  // ── Render trip stops (step 3) ───────────────────────────────────────────────
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map || mode !== 'segments' || segStep !== 3) return

    stopMarkersRef.current.forEach((m) => m.remove())
    stopMarkersRef.current = []

    for (const stop of tripStops) {
      const m = L.circleMarker([stop.stop_lat, stop.stop_lon], {
        radius: 7,
        color: '#fff',
        fillColor: selectedTrip ? hexColor(selectedTrip.route_color) : '#0074d9',
        fillOpacity: 1,
        weight: 2,
      })
        .addTo(map)
        .bindTooltip(stop.stop_name, { direction: 'top' })
      stopMarkersRef.current.push(m)
    }

    return () => {
      stopMarkersRef.current.forEach((m) => m.remove())
      stopMarkersRef.current = []
    }
  }, [tripStops, selectedTrip, mode, segStep])

  // ── Render cut point markers ─────────────────────────────────────────────────
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
        icon: L.divIcon({ className: '', html: `<div style="background:#e74c3c;color:#fff;padding:2px 5px;border-radius:3px;white-space:nowrap;font-size:11px">${label}</div>` }),
      }).addTo(map)
      cutMarkersRef.current.push(m)
    }

    return () => {
      cutMarkersRef.current.forEach((m) => m.remove())
      cutMarkersRef.current = []
    }
  }, [cutPoints, tripStops])

  // ── Snapping mousemove handler ────────────────────────────────────────────────
  const handleMouseMove = useCallback(
    (e: L.LeafletMouseEvent) => {
      if (!snappingActive || assembledPolyline.length < 2) return
      const cursor: LatLng = { lat: e.latlng.lat, lng: e.latlng.lng }
      const result = projectPointOnPolyline(cursor, assembledPolyline)
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
      // Open stop assignment dialog by setting pendingStopId to first unassigned stop
      const usedStops = new Set(cutPoints.map((c) => c.stopId))
      const firstFree = tripStops.find((s) => !usedStops.has(s.stop_id))
      setPendingStopId(firstFree?.stop_id ?? '')
      // The actual cut is committed when user picks a stop in the UI
    },
    [snappingActive, pendingCut, cutPoints, tripStops]
  )

  // Attach/detach map event handlers when snapping toggles
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    map.on('mousemove', handleMouseMove)
    map.on('click', handleMapClick)

    return () => {
      map.off('mousemove', handleMouseMove)
      map.off('click', handleMapClick)
    }
  }, [handleMouseMove, handleMapClick])

  // Cleanup snap marker when snapping disabled
  useEffect(() => {
    if (!snappingActive) {
      snapMarkerRef.current?.remove()
      snapMarkerRef.current = null
    }
  }, [snappingActive])

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function loadOsmWays() {
    setStatus('Chargement des voies OSM…')
    const bounds = GRENOBLE_BOUNDS as [[number, number], [number, number]]
    const bbox = `${bounds[0][0]},${bounds[0][1]},${bounds[1][0]},${bounds[1][1]}`
    const q = `[out:json];way[railway=tram](${bbox});(._;>;);out geom;`

    try {
      const res = await fetch(`/api/admin/overpass?q=${encodeURIComponent(q)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()

      const ways: OsmWay[] = (data.elements ?? [])
        .filter((el: { type: string }) => el.type === 'way')
        .map((el: { id: number; geometry?: Array<{ lat: number; lon: number }> }) => ({
          id: el.id,
          coords: (el.geometry ?? []).map((n: { lat: number; lon: number }) => ({ lat: n.lat, lng: n.lon })),
        }))
        .filter((w: OsmWay) => w.coords.length > 1)

      setOsmWays(ways)
      setStatus(`${ways.length} voies OSM chargées`)
    } catch (e) {
      setStatus(`Erreur Overpass: ${e}`)
    }
  }

  function selectTrip(entry: TripEntry) {
    setSelectedTrip(entry)
    setSegStep(2)
    setSelectedWayIds(new Set())
    setAssembledPolyline([])
    setCutPoints([])
    setSnappingActive(false)
    loadOsmWays()

    // Load stop sequence for this trip
    const stopById = (window as unknown as Record<string, unknown>).__adminStopById as Map<string, { stop_id: string; stop_name: string; stop_lat: number; stop_lon: number }> | undefined
    const tripStopTimesMap = (window as unknown as Record<string, unknown>).__adminTripStopTimesMap as Map<string, Array<{ trip_id: string; stop_id: string; stop_sequence: number }>> | undefined
    if (!stopById || !tripStopTimesMap) return

    const sts = tripStopTimesMap.get(entry.trip_id) ?? []
    sts.sort((a, b) => a.stop_sequence - b.stop_sequence)
    const stopsForTrip = sts
      .map((st) => stopById.get(st.stop_id))
      .filter(Boolean) as Array<{ stop_id: string; stop_name: string; stop_lat: number; stop_lon: number }>
    setTripStops(stopsForTrip)
  }

  function commitCutPoint() {
    if (!pendingCut || !pendingStopId) return
    setCutPoints((prev) => [
      ...prev,
      { latlng: pendingCut.point, stopId: pendingStopId, indexOnPolyline: pendingCut.segIdx, tOnSegment: pendingCut.t },
    ])
    setPendingStopId('')
  }

  function removeCutPoint(idx: number) {
    setCutPoints((prev) => prev.filter((_, i) => i !== idx))
  }

  /** Extract sub-polyline between two cut points (or polyline ends) */
  function extractSubPolyline(poly: LatLng[], from: CutPoint | null, to: CutPoint | null): LatLng[] {
    const startIdx = from ? from.indexOnPolyline : 0
    const endIdx = to ? to.indexOnPolyline + 1 : poly.length - 1

    const result: LatLng[] = []
    if (from) result.push(from.latlng)
    for (let i = startIdx + 1; i < endIdx; i++) result.push(poly[i])
    if (to) result.push(to.latlng)
    return result
  }

  function buildSegmentPaths(): Record<string, LatLng[]> {
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
      const key = makeSegmentKey(from.stopId, to.stopId)
      result[key] = extractSubPolyline(assembledPolyline, from, to)
    }

    return result
  }

  async function saveClusters() {
    setStatus('Sauvegarde des clusters…')
    try {
      const res = await fetch('/api/admin/geodata?file=clusters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clusters),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setStatus('Clusters sauvegardés ✓')
    } catch (e) {
      setStatus(`Erreur sauvegarde: ${e}`)
    }
  }

  async function saveSegments() {
    setStatus('Sauvegarde des segments…')
    try {
      // Load existing segment-paths and merge
      let existing: Record<string, LatLng[]> = {}
      try {
        const res = await fetch('/api/admin/geodata?file=segment-paths')
        if (res.ok) existing = await res.json()
      } catch { /* ignore */ }

      const newSegments = buildSegmentPaths()
      const merged = { ...existing, ...newSegments }

      const res = await fetch('/api/admin/geodata?file=segment-paths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setStatus(`${Object.keys(newSegments).length} segments sauvegardés ✓`)
    } catch (e) {
      setStatus(`Erreur sauvegarde: ${e}`)
    }
  }

  // ── Grouped trips for display ────────────────────────────────────────────────
  const groupedTrips = tripEntries.reduce<Map<string, TripEntry[]>>((acc, t) => {
    if (!acc.has(t.route_short_name)) acc.set(t.route_short_name, [])
    acc.get(t.route_short_name)!.push(t)
    return acc
  }, new Map())

  const segmentCount = cutPoints.length > 1 ? cutPoints.length - 1 : 0

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif', fontSize: 14 }}>
      {/* Toolbar */}
      <div style={{ background: '#1a1a2e', color: '#eee', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ marginRight: 8 }}>Admin Geodata</strong>

        <button
          onClick={() => { setMode('clusters'); setSegStep(1) }}
          style={{ background: mode === 'clusters' ? '#4a90d9' : '#333', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
        >
          Clusters
        </button>
        <button
          onClick={() => setMode('segments')}
          style={{ background: mode === 'segments' ? '#4a90d9' : '#333', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
        >
          Segments
        </button>

        <span style={{ flex: 1 }} />

        {mode === 'clusters' && (
          <button
            onClick={saveClusters}
            style={{ background: '#27ae60', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
          >
            Sauvegarder clusters
          </button>
        )}

        {mode === 'segments' && segStep === 3 && (
          <>
            <button
              onClick={() => setSnappingActive((v) => !v)}
              style={{ background: snappingActive ? '#e74c3c' : '#555', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
            >
              {snappingActive ? '✂ Coupure active' : '✂ Activer coupure'}
            </button>
            <button
              onClick={saveSegments}
              style={{ background: '#27ae60', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
            >
              Sauvegarder segments ({segmentCount})
            </button>
          </>
        )}

        {mode === 'segments' && segStep === 2 && assembledPolyline.length > 1 && (
          <button
            onClick={() => setSegStep(3)}
            style={{ background: '#8e44ad', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}
          >
            Étape 3 — Découpage →
          </button>
        )}

        <span style={{ color: '#aaa', fontSize: 12 }}>{status}</span>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Side panel */}
        <div style={{ width: 320, background: '#16213e', color: '#ddd', overflowY: 'auto', padding: 10, flexShrink: 0 }}>

          {/* CLUSTERS panel */}
          {mode === 'clusters' && (
            <div>
              <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Clusters ({clusters.length})</div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                Déplacez les marqueurs sur la carte pour corriger les positions.
              </div>
              <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                {clusters.map((c) => (
                  <div key={c.id} style={{ padding: '4px 0', borderBottom: '1px solid #2a2a4a', fontSize: 12 }}>
                    <div style={{ color: '#eee' }}>{c.name}</div>
                    <div style={{ color: '#888', fontSize: 11 }}>
                      {c.lat.toFixed(5)}, {c.lng.toFixed(5)} — {c.stopIds.length} stop(s)
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SEGMENTS step 1 panel */}
          {mode === 'segments' && segStep === 1 && (
            <div>
              <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Sélectionner un trajet</div>
              {[...groupedTrips.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([line, entries]) => (
                  <div key={line} style={{ marginBottom: 10 }}>
                    <div style={{ color: hexColor(entries[0].route_color), fontWeight: 'bold', marginBottom: 4 }}>
                      Ligne {line}
                    </div>
                    {entries.map((e) => (
                      <div
                        key={e.key}
                        onClick={() => selectTrip(e)}
                        style={{
                          padding: '5px 8px',
                          cursor: 'pointer',
                          borderRadius: 4,
                          marginBottom: 3,
                          background: '#1e2d50',
                        }}
                        onMouseEnter={(ev) => (ev.currentTarget.style.background = '#2a3f6f')}
                        onMouseLeave={(ev) => (ev.currentTarget.style.background = '#1e2d50')}
                      >
                        <span style={{ color: '#aaa', fontSize: 11 }}>Sens {e.direction_id} → </span>
                        <span>{e.trip_headsign || '(sans terminus)'}</span>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          )}

          {/* SEGMENTS step 2 panel */}
          {mode === 'segments' && segStep === 2 && (
            <div>
              <div style={{ fontWeight: 'bold', marginBottom: 6 }}>
                <span style={{ color: hexColor(selectedTrip?.route_color ?? 'cccccc') }}>
                  Ligne {selectedTrip?.route_short_name}
                </span>
                {' → '}{selectedTrip?.trip_headsign}
              </div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                Cliquez les voies OSM dans l&apos;ordre du trajet pour assembler le polyline.
              </div>
              <div style={{ fontSize: 12, color: '#bbb', marginBottom: 6 }}>
                {selectedWayIds.size} voie(s) sélectionnée(s) — {assembledPolyline.length} points
              </div>
              <button
                onClick={() => { setSelectedWayIds(new Set()); setAssembledPolyline([]) }}
                style={{ background: '#c0392b', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 12 }}
              >
                Réinitialiser
              </button>
              <button
                onClick={() => setSegStep(1)}
                style={{ background: '#555', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 12, marginLeft: 6 }}
              >
                ← Retour
              </button>
            </div>
          )}

          {/* SEGMENTS step 3 panel */}
          {mode === 'segments' && segStep === 3 && (
            <div>
              <div style={{ fontWeight: 'bold', marginBottom: 6 }}>
                Découpage — <span style={{ color: hexColor(selectedTrip?.route_color ?? 'cccccc') }}>
                  {selectedTrip?.route_short_name}
                </span> → {selectedTrip?.trip_headsign}
              </div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                Activez l&apos;outil coupure, cliquez sur le polyline pour placer un point, puis associez-le à un arrêt.
              </div>

              {/* Pending cut assignment */}
              {snappingActive && pendingCut && pendingStopId !== undefined && (
                <div style={{ background: '#1e3a5f', padding: 8, borderRadius: 4, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>Associer ce point à :</div>
                  <select
                    value={pendingStopId}
                    onChange={(e) => setPendingStopId(e.target.value)}
                    style={{ width: '100%', background: '#0d1b2a', color: '#eee', border: '1px solid #444', padding: 3, borderRadius: 3, fontSize: 12 }}
                  >
                    <option value="">— choisir un arrêt —</option>
                    {tripStops.map((s) => (
                      <option key={s.stop_id} value={s.stop_id}>{s.stop_name}</option>
                    ))}
                  </select>
                  <button
                    onClick={commitCutPoint}
                    disabled={!pendingStopId}
                    style={{ marginTop: 6, background: '#27ae60', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 12 }}
                  >
                    Confirmer
                  </button>
                </div>
              )}

              {/* Cut points list */}
              <div style={{ fontSize: 12, marginBottom: 4 }}>{cutPoints.length} point(s) de coupure</div>
              {cutPoints.map((cp, i) => {
                const stop = tripStops.find((s) => s.stop_id === cp.stopId)
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #2a2a4a', fontSize: 12 }}>
                    <span>{stop?.stop_name ?? cp.stopId}</span>
                    <button
                      onClick={() => removeCutPoint(i)}
                      style={{ background: 'none', color: '#e74c3c', border: 'none', cursor: 'pointer', fontSize: 12 }}
                    >
                      ✕
                    </button>
                  </div>
                )
              })}

              <button
                onClick={() => setSegStep(2)}
                style={{ marginTop: 10, background: '#555', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 12 }}
              >
                ← Retour étape 2
              </button>
            </div>
          )}
        </div>

        {/* Map container */}
        <div ref={mapContainerRef} style={{ flex: 1 }} />
      </div>
    </div>
  )
}
