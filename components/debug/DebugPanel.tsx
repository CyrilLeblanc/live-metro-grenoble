'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useDebugContext } from '../../contexts/DebugContext'
import { SpeedGraphRecord } from '../../lib/segmentSpeeds'
import { buildPathLengths, positionAtProgress } from '../../lib/pathUtils'
import { MAX_SEGMENT_SPEED_MS } from '../../lib/config'
import { interpolateSpeed } from '../../lib/speedUtils'
import ManualGraphEditor, { Pt } from './ManualGraphEditor'
import SpeedGraph from './SpeedGraph'
import EditableSpeed from './EditableSpeed'

/**
 * Precomputes a tSec→metres lookup table by numerically integrating the speed profile.
 * Uses the trapezoidal rule with 0.25 s steps. The resulting table maps each countdown
 * value (tSec counts down from duration to 0) to the cumulative distance travelled.
 * This allows the playback dot to move at the speed shown in the graph rather than
 * at a uniform rate.
 */
function buildPositionTable(rec: SpeedGraphRecord): Array<{ tSec: number; meters: number }> {
  const STEP = 0.25
  const dur = rec.totalDurationSec
  // interpolateSpeed requires ascending tSec order; normalize defensively
  const pts = [...rec.points].sort((a, b) => a.tSec - b.tSec)
  const table: Array<{ tSec: number; meters: number }> = []
  let meters = 0
  // tSec counts down: dur → 0 (start → end of segment)
  for (let i = 0, t = dur; t >= -STEP; i++, t = dur - i * STEP) {
    const tClamped = Math.max(0, t)
    table.push({ tSec: tClamped, meters })
    const s0 = interpolateSpeed(pts, tClamped)
    const s1 = interpolateSpeed(pts, Math.max(0, tClamped - STEP))
    meters += ((s0 + s1) / 2) * STEP
    if (tClamped === 0) break
  }
  return table
}

/** Look up metres-from-start at a given countdown tSec (linear interpolation). */
function lookupMeters(table: Array<{ tSec: number; meters: number }>, tSec: number): number {
  if (table.length === 0) return 0
  if (tSec >= table[0].tSec) return table[0].meters
  if (tSec <= table[table.length - 1].tSec) return table[table.length - 1].meters
  // Table is sorted descending by tSec
  for (let i = 1; i < table.length; i++) {
    if (table[i].tSec <= tSec) {
      const t0 = table[i - 1].tSec, t1 = table[i].tSec
      const m0 = table[i - 1].meters, m1 = table[i].meters
      const frac = (tSec - t0) / (t1 - t0)
      return m0 + frac * (m1 - m0)
    }
  }
  return table[table.length - 1].meters
}

/**
 * Normalised lookup: maps the speed-profile integral onto the actual path length.
 * The speed graph only provides a shape (relative speeds); the real distance
 * is always the path length. Without this, a narrow bell curve would leave the
 * dot stranded mid-segment at end-of-playback.
 */
function scaledMeters(
  table: Array<{ tSec: number; meters: number }>,
  tSec: number,
  pathTotal: number,
): number {
  const tableTotal = table[table.length - 1]?.meters ?? 0
  const raw = lookupMeters(table, tSec)
  return tableTotal > 0 ? (raw / tableTotal) * pathTotal : (raw === 0 ? 0 : pathTotal)
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm} ${hh}:${min}`
}

/**
 * Generates a Gaussian (bell curve) speed profile for initializing the manual editor.
 * Models realistic tram behaviour: accelerate from stop, cruise at peak speed, decelerate
 * to next stop. The curve is sampled at N evenly-spaced points with σ=0.2 centred at 50%.
 * First and last points are forced to zero speed (stopped at stations).
 */
function bellCurve(durationSec: number, peakSpeedMs: number): Array<{ tSec: number; speedMs: number }> {
  const N = 13
  const pts = []
  const sigma = 0.2
  for (let i = 0; i < N; i++) {
    const x = i / (N - 1)
    const raw = Math.exp(-((x - 0.5) ** 2) / (2 * sigma ** 2))
    const speedMs = Math.min(peakSpeedMs * raw, MAX_SEGMENT_SPEED_MS)
    const tSec = durationSec * (1 - x)
    pts.push({ tSec, speedMs })
  }
  pts[0].speedMs = 0
  pts[N - 1].speedMs = 0
  return pts
}

// Height constant used in loading placeholder
const H = 80

export default function DebugPanel() {
  const { isPanelOpen, selectedSegmentKey, selectedSegment, closePanel, playbackPositionRef } = useDebugContext()

  const [records, setRecords] = useState<SpeedGraphRecord[]>([])
  // activeTab: -1 = MANUAL, 0..N-1 = GPS recording index
  const [activeTab, setActiveTab] = useState<number>(-1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [tSec, setTSec] = useState(0)

  // Manual editor state
  const [durationSec, setDurationSec] = useState<number | null>(null)
  const [durationIsEstimate, setDurationIsEstimate] = useState(false)
  const [manualPoints, setManualPoints] = useState<Array<{ tSec: number; speedMs: number }>>([])
  const [manualError, setManualError] = useState<string | null>(null)
  const [manualSuccess, setManualSuccess] = useState(false)

  const tSecRef = useRef(0)
  const playingRef = useRef(false)
  const speedRef = useRef(1)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const pathLengthsRef = useRef<{ lengths: number[]; total: number } | null>(null)
  const positionTableRef = useRef<Array<{ tSec: number; meters: number }> | null>(null)
  const lastThrottleRef = useRef(0)
  const isHoveringGraphRef = useRef(false)

  // Reset when segment changes
  useEffect(() => {
    if (!isPanelOpen || !selectedSegmentKey) return
    setRecords([])
    setActiveTab(-1)
    setIsPlaying(false)
    setTSec(0)
    tSecRef.current = 0
    playingRef.current = false
    setDurationSec(null)
    setDurationIsEstimate(false)
    setManualPoints([])
    setManualError(null)
    setManualSuccess(false)

    fetch(`/api/segment-speeds/records?key=${encodeURIComponent(selectedSegmentKey)}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: SpeedGraphRecord[]) => {
        setRecords(data)
        let dur: number
        let isEst = false
        if (data.length > 0) {
          dur = data[0].totalDurationSec
          tSecRef.current = dur
          setTSec(dur)
        } else {
          const pl = pathLengthsRef.current
          dur = pl ? pl.total / 8 : 30
          isEst = true
        }
        setDurationSec(dur)
        setDurationIsEstimate(isEst)
        // Initialize manual points with bell curve
        const pl = pathLengthsRef.current
        const total = pl ? pl.total : dur * 8
        const peakSpeedMs = Math.min((total / dur) * 1.6, MAX_SEGMENT_SPEED_MS)
        setManualPoints(bellCurve(dur, peakSpeedMs))
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPanelOpen, selectedSegmentKey])

  // Reset tSec when tab changes (GPS tabs only)
  useEffect(() => {
    if (activeTab < 0) return
    const rec = records[activeTab]
    if (!rec) return
    tSecRef.current = rec.totalDurationSec
    setTSec(rec.totalDurationSec)
    setIsPlaying(false)
    playingRef.current = false
    positionTableRef.current = buildPositionTable(rec)
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
      const rec = activeTab >= 0 ? records[activeTab] : null
      if (rec && playingRef.current) {
        const dt = lastFrameRef.current !== null ? (now - lastFrameRef.current) / 1000 : 0
        lastFrameRef.current = now

        tSecRef.current = Math.max(0, tSecRef.current - dt * speedRef.current)

        // Throttle React state updates to ~30fps
        if (now - lastThrottleRef.current > 33) {
          lastThrottleRef.current = now
          setTSec(tSecRef.current)
        }

        // Update playback dot position using integrated speed profile
        if (!isHoveringGraphRef.current && pathLengthsRef.current && selectedSegment?.shapePath) {
          const meters = positionTableRef.current
            ? scaledMeters(positionTableRef.current, tSecRef.current, pathLengthsRef.current.total)
            : (1 - tSecRef.current / rec.totalDurationSec) * pathLengthsRef.current.total
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

    if (pathLengthsRef.current && selectedSegment?.shapePath) {
      const meters = positionTableRef.current
        ? scaledMeters(positionTableRef.current, newTSec, pathLengthsRef.current.total)
        : (1 - newTSec / rec.totalDurationSec) * pathLengthsRef.current.total
      const pos = positionAtProgress(selectedSegment.shapePath, pathLengthsRef.current.lengths, meters)
      playbackPositionRef.current = pos
    }
  }, [records, activeTab, selectedSegment, playbackPositionRef])

  const handleDeleteRecord = useCallback(async (id: string) => {
    if (!selectedSegmentKey) return
    await fetch(`/api/segment-speeds/records?key=${encodeURIComponent(selectedSegmentKey)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setRecords(prev => {
      const next = prev.filter(r => r.id !== id)
      setActiveTab(t => t < 0 ? t : Math.min(t, Math.max(0, next.length - 1)))
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

  async function handleManualSave() {
    if (!selectedSegment || !durationSec) return
    if (manualPoints.length < 3) { setManualError('Need ≥3 points'); return }
    if (manualPoints.some(p => p.speedMs < 0 || p.speedMs > MAX_SEGMENT_SPEED_MS)) {
      setManualError(`Speed must be 0–${MAX_SEGMENT_SPEED_MS} m/s`); return
    }
    setManualError(null)
    try {
      const res = await fetch('/api/segment-speeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stopAId: selectedSegment.stopAId,
          stopBId: selectedSegment.stopBId,
          totalDurationSec: durationSec,
          // Store ascending by tSec — matches GPS recording format and interpolateSpeed contract
          points: [...manualPoints].sort((a, b) => a.tSec - b.tSec),
        }),
      })
      if (res.ok) {
        const data: SpeedGraphRecord[] = await fetch(
          `/api/segment-speeds/records?key=${encodeURIComponent(selectedSegmentKey ?? '')}`
        ).then(r => r.ok ? r.json() : [])
        setRecords(data)
        setActiveTab(0)
        setManualSuccess(true)
        setTimeout(() => setManualSuccess(false), 2000)
      } else {
        const body = await res.json().catch(() => ({}))
        setManualError(body.error ?? 'Save failed')
      }
    } catch {
      setManualError('Save failed')
    }
  }

  function handleGpsHover(tSec: number | null, activeRecord: SpeedGraphRecord) {
    if (tSec === null) {
      isHoveringGraphRef.current = false
      playbackPositionRef.current = null
      return
    }
    isHoveringGraphRef.current = true
    if (pathLengthsRef.current && selectedSegment?.shapePath) {
      const meters = positionTableRef.current
        ? scaledMeters(positionTableRef.current, tSec, pathLengthsRef.current.total)
        : (1 - tSec / activeRecord.totalDurationSec) * pathLengthsRef.current.total
      playbackPositionRef.current = positionAtProgress(selectedSegment.shapePath, pathLengthsRef.current.lengths, meters)
    }
  }

  const TAB_STYLE_BASE: React.CSSProperties = {
    borderRadius: '4px 4px 0 0',
    padding: '3px 10px',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
  }

  function tabStyle(isActive: boolean): React.CSSProperties {
    return {
      ...TAB_STYLE_BASE,
      background: isActive ? 'rgba(251,191,36,0.15)' : 'transparent',
      border: `1px solid ${isActive ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.1)'}`,
      color: isActive ? '#fbbf24' : 'rgba(255,255,255,0.5)',
    }
  }

  if (!isPanelOpen) return null

  const activeRecord = activeTab >= 0 ? records[activeTab] : null

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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, padding: '6px 16px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, overflowX: 'auto' }}>
        {/* MANUAL tab */}
        <button onClick={() => setActiveTab(-1)} style={tabStyle(activeTab === -1)}>
          MANUAL
        </button>
        {/* GPS tabs */}
        {records.map((rec, i) => (
          <div key={rec.id} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <button
              onClick={() => setActiveTab(i)}
              style={tabStyle(i === activeTab)}
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
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {activeTab === -1 ? (
          /* MANUAL tab content */
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
                Duration:{' '}
                {durationSec === null
                  ? '…'
                  : durationIsEstimate
                    ? `~${durationSec.toFixed(0)}s`
                    : `${durationSec.toFixed(0)}s`}
              </span>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '8px 8px 4px', border: '1px solid rgba(255,255,255,0.06)' }}>
              {durationSec !== null && selectedSegment ? (
                <ManualGraphEditor
                  points={manualPoints}
                  setPoints={setManualPoints}
                  durationSec={durationSec}
                  playbackPositionRef={playbackPositionRef}
                  shapePath={selectedSegment.shapePath}
                  pathLengthsRef={pathLengthsRef}
                />
              ) : (
                <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>
                  loading…
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <button
                onClick={() => {
                  if (!durationSec) return
                  const mid = durationSec / 2
                  setManualPoints(prev => [
                    ...prev,
                    { tSec: mid + 5, speedMs: 0 },
                    { tSec: mid - 5, speedMs: 0 },
                  ].sort((a, b) => b.tSec - a.tSec))
                }}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: 'rgba(255,255,255,0.6)',
                  borderRadius: 4,
                  padding: '4px 12px',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: 12,
                }}
              >
                + ADD STOP
              </button>
              <button
                onClick={handleManualSave}
                style={{
                  background: '#fbbf24',
                  border: 'none',
                  color: '#000',
                  borderRadius: 4,
                  padding: '4px 14px',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                SAVE
              </button>
              {manualError && (
                <span style={{ color: '#f87171', fontSize: 11 }}>{manualError}</span>
              )}
              {manualSuccess && (
                <span style={{ color: '#4ade80', fontSize: 11 }}>Saved!</span>
              )}
            </div>
            {/* Manual points table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace' }}>
                <thead>
                  <tr style={{ color: 'rgba(255,255,255,0.35)', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <th style={{ padding: '4px 8px', fontWeight: 500 }}>t (s)</th>
                    <th style={{ padding: '4px 8px', fontWeight: 500 }}>speed (m/s)</th>
                  </tr>
                </thead>
                <tbody>
                  {manualPoints.map((pt, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.7)' }}>
                      <td style={{ padding: '3px 8px' }}>{pt.tSec.toFixed(1)}</td>
                      <td style={{ padding: '3px 8px' }}>{pt.speedMs.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : activeRecord ? (
          /* GPS tab content */
          <>
            {/* Speed graph */}
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '8px 8px 4px', border: '1px solid rgba(255,255,255,0.06)' }}>
              <SpeedGraph
                record={activeRecord}
                tSec={tSec}
                onHoverTSec={t => handleGpsHover(t, activeRecord)}
              />
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
          </>
        ) : null}
      </div>
    </div>
  )
}
