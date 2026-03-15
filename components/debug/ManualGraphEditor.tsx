'use client'

import { useEffect, useRef, useState } from 'react'
import { LatLng } from '../../lib/geo'
import { MAX_SEGMENT_SPEED_MS } from '../../lib/config'
import { positionAtProgress } from '../../lib/pathUtils'

// SVG editor constants
const W = 500, H = 80
const PAD = { left: 24, right: 8, top: 8, bottom: 16 }
const innerW = W - PAD.left - PAD.right
const innerH = H - PAD.top - PAD.bottom

export type Pt = { tSec: number; speedMs: number }

interface ManualGraphEditorProps {
  points: Pt[]
  setPoints: React.Dispatch<React.SetStateAction<Pt[]>>
  durationSec: number
  playbackPositionRef: React.RefObject<{ lat: number; lng: number } | null>
  shapePath: LatLng[]
  pathLengthsRef: React.RefObject<{ lengths: number[]; total: number } | null>
}

function ManualGraphEditor({ points, setPoints, durationSec, playbackPositionRef, shapePath, pathLengthsRef }: ManualGraphEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  // Live points during drag — index-stable (never re-sort mid-drag)
  const liveRef = useRef<Pt[]>(points)
  // Track dragging by index in liveRef (stable since we don't sort mid-drag)
  const dragRef = useRef<{ idx: number; lockTSec: number | null } | null>(null)
  // Hover state for visual feedback
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  // Trigger re-render during drag without touching parent state
  const [renderTick, setRenderTick] = useState(0)
  // Undo history
  const historyRef = useRef<Pt[][]>([])

  // Sync when points reset externally (segment change)
  useEffect(() => { liveRef.current = points }, [points])

  // Ctrl+Z undo
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        const prev = historyRef.current.pop()
        if (prev) { liveRef.current = prev; setPoints(prev) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPoints])

  function pushHistory() {
    historyRef.current.push([...liveRef.current])
    if (historyRef.current.length > 50) historyRef.current.shift()
  }

  // Coordinate mapping — uniform scale (no preserveAspectRatio="none")
  const toX = (tSec: number) => PAD.left + ((durationSec - tSec) / durationSec) * innerW
  const toY = (speedMs: number) => PAD.top + (1 - speedMs / MAX_SEGMENT_SPEED_MS) * innerH
  const fromX = (px: number) => durationSec - ((px - PAD.left) / innerW) * durationSec
  const fromY = (py: number) => Math.max(0, Math.min(MAX_SEGMENT_SPEED_MS, MAX_SEGMENT_SPEED_MS * (1 - (py - PAD.top) / innerH)))

  function toSvgCoords(e: React.MouseEvent<SVGSVGElement>): { px: number; py: number } {
    const rect = svgRef.current!.getBoundingClientRect()
    // Uniform scale: W/rect.width == H/rect.height (no preserveAspectRatio="none")
    const scale = W / rect.width
    return { px: (e.clientX - rect.left) * scale, py: (e.clientY - rect.top) * scale }
  }

  // Returns index of point within 8px, or -1
  function hitTestIdx(px: number, py: number): number {
    const pts = liveRef.current
    for (let i = 0; i < pts.length; i++) {
      const dx = toX(pts[i].tSec) - px
      const dy = toY(pts[i].speedMs) - py
      if (dx * dx + dy * dy <= 64) return i
    }
    return -1
  }

  function updateMapPosition(tSec: number) {
    if (pathLengthsRef.current && shapePath.length > 0) {
      const meters = (1 - tSec / durationSec) * pathLengthsRef.current.total
      playbackPositionRef.current = positionAtProgress(shapePath, pathLengthsRef.current.lengths, meters)
    }
  }

  function commit(pts: Pt[]) {
    const sorted = [...pts].sort((a, b) => b.tSec - a.tSec)
    liveRef.current = sorted
    setPoints(sorted)
  }

  function onMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    const { px, py } = toSvgCoords(e)
    const idx = hitTestIdx(px, py)
    if (idx === -1) return
    pushHistory()
    const n = liveRef.current.length
    // Determine tSec lock for first/last points (they're sorted desc, so idx 0 = highest tSec)
    const lockTSec = idx === 0 ? durationSec : idx === n - 1 ? 0 : null
    dragRef.current = { idx, lockTSec }
  }

  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const { px, py } = toSvgCoords(e)

    if (dragRef.current !== null) {
      const { idx, lockTSec } = dragRef.current
      const pts = [...liveRef.current]
      const newTSec = lockTSec !== null ? lockTSec : Math.max(0, Math.min(durationSec, fromX(px)))
      pts[idx] = { tSec: newTSec, speedMs: fromY(py) }
      liveRef.current = pts
      setRenderTick(n => n + 1)
      updateMapPosition(newTSec)
      return
    }

    // Hover detection
    const idx = hitTestIdx(px, py)
    setHoveredIdx(idx === -1 ? null : idx)

    const tSec = Math.max(0, Math.min(durationSec, fromX(px)))
    updateMapPosition(tSec)
  }

  function onMouseUp(e: React.MouseEvent<SVGSVGElement>) {
    const { px, py } = toSvgCoords(e)
    if (dragRef.current !== null) {
      commit(liveRef.current)
      dragRef.current = null
      return
    }
    // Click on empty area → insert point
    if (hitTestIdx(px, py) === -1) {
      pushHistory()
      const newPt: Pt = {
        tSec: Math.max(0, Math.min(durationSec, fromX(px))),
        speedMs: Math.max(0, Math.min(MAX_SEGMENT_SPEED_MS, fromY(py))),
      }
      commit([...liveRef.current, newPt])
    }
  }

  function onContextMenu(e: React.MouseEvent<SVGSVGElement>) {
    e.preventDefault()
    const { px, py } = toSvgCoords(e)
    const idx = hitTestIdx(px, py)
    if (idx !== -1 && liveRef.current.length > 2) {
      pushHistory()
      commit(liveRef.current.filter((_, i) => i !== idx))
    }
  }

  function onMouseLeave() {
    if (dragRef.current !== null) {
      commit(liveRef.current)
      dragRef.current = null
    }
    setHoveredIdx(null)
    playbackPositionRef.current = null
  }

  void renderTick
  const displayPoints = liveRef.current

  const pathD = displayPoints.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${toX(p.tSec).toFixed(1)} ${toY(p.speedMs).toFixed(1)}`
  ).join(' ')

  const ticks: number[] = []
  for (let t = 10; t < durationSec; t += 10) ticks.push(t)

  const isDragging = dragRef.current !== null

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', display: 'block', cursor: isDragging ? 'grabbing' : 'crosshair', userSelect: 'none' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
      onMouseLeave={onMouseLeave}
    >
      <rect x={0} y={0} width={W} height={H} fill="rgba(255,255,255,0.03)" />
      {ticks.map(t => {
        const x = toX(t)
        return (
          <g key={t}>
            <line x1={x} y1={H - PAD.bottom} x2={x} y2={H - PAD.bottom + 3} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
            <text x={x} y={H - 1} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize={7} fontFamily="monospace">{t}s</text>
          </g>
        )
      })}
      <text x={PAD.left - 2} y={PAD.top + 6} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize={7} fontFamily="monospace">m/s</text>
      {displayPoints.length > 1 && (
        <path d={pathD} fill="none" stroke="#fbbf24" strokeWidth={1.5} />
      )}
      {displayPoints.map((p, i) => {
        const isActive = i === hoveredIdx || (isDragging && i === dragRef.current?.idx)
        return (
          <circle
            key={i}
            cx={toX(p.tSec)}
            cy={toY(p.speedMs)}
            r={isActive ? 7 : 4}
            fill={isActive ? '#fff' : '#fbbf24'}
            stroke={isActive ? '#fbbf24' : 'none'}
            strokeWidth={2}
            style={{ transition: 'r 0.05s, fill 0.05s' }}
          />
        )
      })}
    </svg>
  )
}

export default ManualGraphEditor
