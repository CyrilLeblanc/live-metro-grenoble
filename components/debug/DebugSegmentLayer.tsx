'use client'

import { useEffect, useMemo, useState } from 'react'
import { Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useDebugContext, SegmentInfo } from '../../contexts/DebugContext'
import { LatLng } from '../../lib/geo'

/** Squared distance from point (px,py) to segment (ax,ay)-(bx,by) in pixels. */
function pointToSegmentDistSq(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return (px - ax) ** 2 + (py - ay) ** 2
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
}

const HIT_PX = 10

interface Props {
  segmentPaths: Map<string, LatLng[]>
  segmentStops: Map<string, { stopAId: string; stopBId: string }>
}

export default function DebugSegmentLayer({ segmentPaths, segmentStops }: Props) {
  const { selectedSegmentKey, openPanel } = useDebugContext()
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const map = useMap()

  const segments = useMemo(() => {
    const result: SegmentInfo[] = []
    for (const [key, path] of segmentPaths.entries()) {
      if (path.length < 2) continue
      result.push({
        segmentKey: key,
        shapePath: path,
        stopAId: segmentStops.get(key)?.stopAId ?? '',
        stopBId: segmentStops.get(key)?.stopBId ?? '',
      })
    }
    return result
  }, [segmentPaths, segmentStops])

  // Use map-level events: the canvas layer (z-index 650) blocks polyline-level
  // mouseover/mouseout, so we compute pixel-space distances ourselves.
  useEffect(() => {
    const threshold2 = HIT_PX * HIT_PX

    function findNearest(containerPoint: L.Point): SegmentInfo | null {
      const { x: mx, y: my } = containerPoint
      let best: SegmentInfo | null = null
      let bestDist2 = threshold2
      for (const seg of segments) {
        for (let i = 1; i < seg.shapePath.length; i++) {
          const a = map.latLngToContainerPoint(seg.shapePath[i - 1])
          const b = map.latLngToContainerPoint(seg.shapePath[i])
          const d2 = pointToSegmentDistSq(mx, my, a.x, a.y, b.x, b.y)
          if (d2 < bestDist2) { bestDist2 = d2; best = seg }
        }
      }
      return best
    }

    function onMouseMove(e: L.LeafletMouseEvent) {
      const seg = findNearest(e.containerPoint)
      setHoveredKey(seg?.segmentKey ?? null)
      map.getContainer().style.cursor = seg ? 'crosshair' : ''
    }

    function onClick(e: L.LeafletMouseEvent) {
      const seg = findNearest(e.containerPoint)
      if (seg) openPanel(seg)
    }

    map.on('mousemove', onMouseMove)
    map.on('click', onClick)
    return () => {
      map.off('mousemove', onMouseMove)
      map.off('click', onClick)
      map.getContainer().style.cursor = ''
    }
  }, [map, segments, openPanel])

  return (
    <>
      {/* Hover highlight */}
      {hoveredKey && hoveredKey !== selectedSegmentKey && (() => {
        const seg = segments.find(s => s.segmentKey === hoveredKey)
        if (!seg) return null
        return (
          <Polyline
            key={`hover-${seg.segmentKey}`}
            positions={seg.shapePath.map(p => [p.lat, p.lng] as [number, number])}
            pathOptions={{ weight: 3, color: '#fbbf24', opacity: 0.6, interactive: false }}
          />
        )
      })()}
      {/* Selected segment — dashed yellow */}
      {selectedSegmentKey && (() => {
        const seg = segments.find(s => s.segmentKey === selectedSegmentKey)
        if (!seg) return null
        return (
          <Polyline
            key={`sel-${seg.segmentKey}`}
            positions={seg.shapePath.map(p => [p.lat, p.lng] as [number, number])}
            pathOptions={{ weight: 4, color: '#fbbf24', dashArray: '8 4', opacity: 1, interactive: false }}
          />
        )
      })()}
    </>
  )
}
