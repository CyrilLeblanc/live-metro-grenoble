'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useDebugContext } from '../../contexts/DebugContext'
import { SpeedGraphRecord } from '../../lib/segmentSpeeds'
import { buildPathLengths, positionAtProgress } from '../../lib/pathUtils'

function formatDate(ts: number): string {
  const d = new Date(ts)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm} ${hh}:${min}`
}

interface SpeedGraphProps {
  record: SpeedGraphRecord
  tSec: number
}

function SpeedGraph({ record, tSec }: SpeedGraphProps) {
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

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
      <path d={pathD} fill="none" stroke="#fbbf24" strokeWidth={1.5} />
      <line x1={cursorX} y1={PAD.top} x2={cursorX} y2={H - PAD.bottom} stroke="#fbbf24" strokeWidth={1} strokeDasharray="3 2" opacity={0.8} />
    </svg>
  )
}

interface EditableSpeedProps {
  value: number
  onSave: (v: number) => void
}

function EditableSpeed({ value, onSave }: EditableSpeedProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value.toFixed(2)))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function commit() {
    const v = parseFloat(draft)
    if (!isNaN(v) && v >= 0 && v <= 10) onSave(v)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        style={{
          width: 64, background: '#1a1a1a', border: '1px solid #fbbf24',
          color: '#fbbf24', fontFamily: 'monospace', fontSize: 12, padding: '1px 4px',
          borderRadius: 3, outline: 'none',
        }}
      />
    )
  }
  return (
    <span
      onClick={() => { setEditing(true); setDraft(String(value.toFixed(2))) }}
      title="Click to edit"
      style={{ cursor: 'text', color: '#fbbf24', fontFamily: 'monospace', fontSize: 12, borderBottom: '1px dashed rgba(251,191,36,0.4)' }}
    >
      {value.toFixed(2)}
    </span>
  )
}

export default function DebugPanel() {
  const { isPanelOpen, selectedSegmentKey, selectedSegment, closePanel, playbackPositionRef } = useDebugContext()

  const [records, setRecords] = useState<SpeedGraphRecord[]>([])
  const [activeTab, setActiveTab] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [tSec, setTSec] = useState(0)

  const tSecRef = useRef(0)
  const playingRef = useRef(false)
  const speedRef = useRef(1)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const pathLengthsRef = useRef<{ lengths: number[]; total: number } | null>(null)
  const lastThrottleRef = useRef(0)

  // Reset when segment changes
  useEffect(() => {
    if (!isPanelOpen || !selectedSegmentKey) return
    setRecords([])
    setActiveTab(0)
    setIsPlaying(false)
    setTSec(0)
    tSecRef.current = 0
    playingRef.current = false

    fetch(`/api/segment-speeds/records?key=${encodeURIComponent(selectedSegmentKey)}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: SpeedGraphRecord[]) => {
        setRecords(data)
        if (data.length > 0) {
          tSecRef.current = data[0].totalDurationSec
          setTSec(data[0].totalDurationSec)
        }
      })
      .catch(() => {})
  }, [isPanelOpen, selectedSegmentKey])

  // Reset tSec when tab changes
  useEffect(() => {
    const rec = records[activeTab]
    if (!rec) return
    tSecRef.current = rec.totalDurationSec
    setTSec(rec.totalDurationSec)
    setIsPlaying(false)
    playingRef.current = false
  }, [activeTab, records])

  // Build path lengths for playback dot
  useEffect(() => {
    if (selectedSegment?.shapePath) {
      pathLengthsRef.current = buildPathLengths(selectedSegment.shapePath)
    } else {
      pathLengthsRef.current = null
    }
  }, [selectedSegment])

  // rAF playback loop
  useEffect(() => {
    playingRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    speedRef.current = playbackSpeed
  }, [playbackSpeed])

  useEffect(() => {
    function frame(now: number) {
      const rec = records[activeTab]
      if (rec && playingRef.current) {
        const dt = lastFrameRef.current !== null ? (now - lastFrameRef.current) / 1000 : 0
        lastFrameRef.current = now

        tSecRef.current = Math.max(0, tSecRef.current - dt * speedRef.current)

        // Throttle React state updates to ~30fps
        if (now - lastThrottleRef.current > 33) {
          lastThrottleRef.current = now
          setTSec(tSecRef.current)
        }

        // Update playback dot position
        if (pathLengthsRef.current && selectedSegment?.shapePath) {
          const progress = 1 - tSecRef.current / rec.totalDurationSec
          const meters = progress * pathLengthsRef.current.total
          const pos = positionAtProgress(selectedSegment.shapePath, pathLengthsRef.current.lengths, meters)
          playbackPositionRef.current = pos
        }

        if (tSecRef.current <= 0) {
          playingRef.current = false
          setIsPlaying(false)
          lastFrameRef.current = null
        }
      } else {
        lastFrameRef.current = null
      }

      rafRef.current = requestAnimationFrame(frame)
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      playbackPositionRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, activeTab, selectedSegment])

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const rec = records[activeTab]
    if (!rec) return
    const elapsed = parseFloat(e.target.value)
    const newTSec = rec.totalDurationSec - elapsed
    tSecRef.current = newTSec
    setTSec(newTSec)

    // Update dot immediately on scrub
    if (pathLengthsRef.current && selectedSegment?.shapePath) {
      const progress = 1 - newTSec / rec.totalDurationSec
      const meters = progress * pathLengthsRef.current.total
      const pos = positionAtProgress(selectedSegment.shapePath, pathLengthsRef.current.lengths, meters)
      playbackPositionRef.current = pos
    }
  }, [records, activeTab, selectedSegment, playbackPositionRef])

  const handleDeleteRecord = useCallback(async (id: string) => {
    if (!selectedSegmentKey) return
    await fetch(`/api/segment-speeds/records?key=${encodeURIComponent(selectedSegmentKey)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setRecords(prev => {
      const next = prev.filter(r => r.id !== id)
      setActiveTab(t => Math.min(t, Math.max(0, next.length - 1)))
      return next
    })
  }, [selectedSegmentKey])

  const handleDeleteStep = useCallback(async (recordId: string, tSec: number) => {
    if (!selectedSegmentKey) return
    const rec = records.find(r => r.id === recordId)
    if (!rec) return
    const newPoints = rec.points.filter(p => p.tSec !== tSec)
    await fetch(`/api/segment-speeds/records?key=${encodeURIComponent(selectedSegmentKey)}&id=${encodeURIComponent(recordId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: newPoints }),
    })
    setRecords(prev => prev.map(r => r.id === recordId ? { ...r, points: newPoints } : r))
  }, [records, selectedSegmentKey])

  const handleEditSpeed = useCallback(async (recordId: string, pointTSec: number, speedMs: number) => {
    if (!selectedSegmentKey) return
    const rec = records.find(r => r.id === recordId)
    if (!rec) return
    const newPoints = rec.points.map(p => p.tSec === pointTSec ? { ...p, speedMs } : p)
    await fetch(`/api/segment-speeds/records?key=${encodeURIComponent(selectedSegmentKey)}&id=${encodeURIComponent(recordId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: newPoints }),
    })
    setRecords(prev => prev.map(r => r.id === recordId ? { ...r, points: newPoints } : r))
  }, [records, selectedSegmentKey])

  if (!isPanelOpen) return null

  const activeRecord = records[activeTab]

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      height: '50vh',
      zIndex: 1500,
      background: 'rgba(13,13,13,0.95)',
      backdropFilter: 'blur(4px)',
      borderTop: '1px solid rgba(251,191,36,0.3)',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'monospace',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <span style={{ color: '#fbbf24', fontWeight: 700, fontSize: 13, letterSpacing: '0.05em' }}>SEGMENT INSPECTOR</span>
        <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {selectedSegmentKey ?? '—'}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>{records.length} recording{records.length !== 1 ? 's' : ''}</span>
        <button
          onClick={closePanel}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 18, padding: '0 4px', lineHeight: 1 }}
          aria-label="Close"
        >×</button>
      </div>

      {records.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>
          No recordings for this segment
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2, padding: '6px 16px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, overflowX: 'auto' }}>
            {records.map((rec, i) => (
              <div key={rec.id} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <button
                  onClick={() => setActiveTab(i)}
                  style={{
                    background: i === activeTab ? 'rgba(251,191,36,0.15)' : 'transparent',
                    border: `1px solid ${i === activeTab ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.1)'}`,
                    color: i === activeTab ? '#fbbf24' : 'rgba(255,255,255,0.5)',
                    borderRadius: '4px 4px 0 0',
                    padding: '3px 10px',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontFamily: 'monospace',
                  }}
                >
                  {formatDate(rec.recordedAt)}
                </button>
                <button
                  onClick={() => handleDeleteRecord(rec.id)}
                  title="Delete recording"
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1 }}
                >×</button>
              </div>
            ))}
          </div>

          {/* Content */}
          {activeRecord && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Speed graph */}
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '8px 8px 4px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <SpeedGraph record={activeRecord} tSec={tSec} />
              </div>

              {/* Playback controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <button
                  onClick={() => {
                    if (tSec <= 0) {
                      tSecRef.current = activeRecord.totalDurationSec
                      setTSec(activeRecord.totalDurationSec)
                    }
                    setIsPlaying(p => !p)
                    lastFrameRef.current = null
                  }}
                  style={{
                    background: 'rgba(251,191,36,0.15)',
                    border: '1px solid rgba(251,191,36,0.4)',
                    color: '#fbbf24',
                    borderRadius: 4,
                    padding: '4px 14px',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {isPlaying ? '⏸' : '▶'}
                </button>

                {/* Speed selector */}
                {([1, 2, 4, 8] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setPlaybackSpeed(s)}
                    style={{
                      background: playbackSpeed === s ? 'rgba(251,191,36,0.2)' : 'transparent',
                      border: `1px solid ${playbackSpeed === s ? 'rgba(251,191,36,0.6)' : 'rgba(255,255,255,0.12)'}`,
                      color: playbackSpeed === s ? '#fbbf24' : 'rgba(255,255,255,0.4)',
                      borderRadius: 4,
                      padding: '4px 8px',
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: 12,
                    }}
                  >
                    {s}×
                  </button>
                ))}

                {/* Time display */}
                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginLeft: 'auto' }}>
                  {(activeRecord.totalDurationSec - tSec).toFixed(1)}s / {activeRecord.totalDurationSec.toFixed(1)}s
                </span>
              </div>

              {/* Scrubber */}
              <input
                type="range"
                min={0}
                max={activeRecord.totalDurationSec}
                step={0.1}
                value={activeRecord.totalDurationSec - tSec}
                onChange={handleScrub}
                style={{ width: '100%', accentColor: '#fbbf24', cursor: 'pointer' }}
              />

              {/* Step table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace' }}>
                  <thead>
                    <tr style={{ color: 'rgba(255,255,255,0.35)', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <th style={{ padding: '4px 8px', fontWeight: 500 }}>t (s)</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500 }}>speed (m/s)</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRecord.points.map((pt) => (
                      <tr key={pt.tSec} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.7)' }}>
                        <td style={{ padding: '3px 8px' }}>{pt.tSec.toFixed(1)}</td>
                        <td style={{ padding: '3px 8px' }}>
                          <EditableSpeed
                            value={pt.speedMs}
                            onSave={v => handleEditSpeed(activeRecord.id, pt.tSec, v)}
                          />
                        </td>
                        <td style={{ padding: '3px 8px', textAlign: 'right' }}>
                          <button
                            onClick={() => handleDeleteStep(activeRecord.id, pt.tSec)}
                            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: 12, padding: '0 2px' }}
                            title="Delete step"
                          >×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
