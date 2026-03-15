'use client'

import { useRef } from 'react'
import { SpeedGraphRecord } from '../../lib/segmentSpeeds'

interface SpeedGraphProps {
  record: SpeedGraphRecord
  tSec: number
  onHoverTSec?: (tSec: number | null) => void
}

function SpeedGraph({ record, tSec, onHoverTSec }: SpeedGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const W = 500, H = 80
  const PAD = { left: 8, right: 8, top: 8, bottom: 8 }

  if (record.points.length === 0) return <div style={{ color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', fontSize: 12 }}>no data</div>

  const maxSpeed = Math.max(...record.points.map(p => p.speedMs), 0.1)
  const dur = record.totalDurationSec

  const toX = (t: number) => PAD.left + (t / dur) * (W - PAD.left - PAD.right)
  const toY = (s: number) => PAD.top + (1 - s / maxSpeed) * (H - PAD.top - PAD.bottom)

  const pathD = record.points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${toX(p.tSec).toFixed(1)} ${toY(p.speedMs).toFixed(1)}`
  ).join(' ')

  // Elapsed = totalDurationSec - tSec (tSec counts down)
  const elapsed = dur - tSec
  const cursorX = toX(elapsed)

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!onHoverTSec || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const scale = W / rect.width  // uniform: no preserveAspectRatio="none"
    const px = (e.clientX - rect.left) * scale
    const graphW = W - PAD.left - PAD.right
    const t = Math.max(0, Math.min(dur, (px - PAD.left) / graphW * dur))
    onHoverTSec(t)
  }

  function handleMouseLeave() {
    onHoverTSec?.(null)
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', display: 'block' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <path d={pathD} fill="none" stroke="#fbbf24" strokeWidth={1.5} />
      <line x1={cursorX} y1={PAD.top} x2={cursorX} y2={H - PAD.bottom} stroke="#fbbf24" strokeWidth={1} strokeDasharray="3 2" opacity={0.8} />
    </svg>
  )
}

export default SpeedGraph
