/**
 * SegmentStopPicker — Step 1 sidebar panel for Segments mode.
 *
 * Shows a searchable stop list; hovering a row highlights the stop on the map,
 * clicking it assigns it to FROM (first) then TO (second).
 * Also lists existing directional segment keys with delete buttons.
 */

import { useState, useMemo } from 'react'
import type { TripStop } from '../types'

interface Props {
  allStops: TripStop[]
  existingSegmentKeys: Set<string>
  fromStop: TripStop | null
  toStop: TripStop | null
  /** AdminMap handles the FROM→TO assignment logic. */
  onStopClick: (stop: TripStop) => void
  onFromClear: () => void
  onToClear: () => void
  onStopHover: (stopId: string | null) => void
  onSegmentHover: (key: string | null) => void
  onConfirm: () => void
  onDelete: (key: string) => void
}

export default function SegmentStopPicker({
  allStops,
  existingSegmentKeys,
  fromStop,
  toStop,
  onStopClick,
  onFromClear,
  onToClear,
  onStopHover,
  onSegmentHover,
  onConfirm,
  onDelete,
}: Props) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allStops.slice(0, 80)
    return allStops.filter(
      (s) => s.stop_name.toLowerCase().includes(q) || s.stop_id.includes(q)
    ).slice(0, 80)
  }, [allStops, query])

  const canConfirm = fromStop !== null && toStop !== null

  const nextRole = !fromStop ? 'FROM' : !toStop ? 'TO' : null

  return (
    <div>
      <div style={{ fontWeight: 'bold', marginBottom: 8, color: '#eee' }}>Segments — Étape 1</div>

      {/* FROM / TO selection display */}
      <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <StopBadge
          label="FROM"
          stop={fromStop}
          color="#2ecc71"
          onClear={onFromClear}
        />
        <StopBadge
          label="TO"
          stop={toStop}
          color="#e74c3c"
          onClear={onToClear}
        />
      </div>

      {/* Hint */}
      {nextRole && (
        <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
          Cliquer un arrêt sur la carte ou dans la liste pour définir{' '}
          <span style={{ color: nextRole === 'FROM' ? '#2ecc71' : '#e74c3c', fontWeight: 'bold' }}>
            {nextRole}
          </span>
        </div>
      )}

      <button
        onClick={onConfirm}
        disabled={!canConfirm}
        style={{
          background: canConfirm ? '#27ae60' : '#2a2a2a',
          color: canConfirm ? '#fff' : '#555',
          border: 'none',
          padding: '5px 12px',
          borderRadius: 4,
          cursor: canConfirm ? 'pointer' : 'not-allowed',
          fontSize: 12,
          marginBottom: 12,
          width: '100%',
        }}
      >
        Assembler les voies →
      </button>

      {/* Stop search + list */}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filtrer les arrêts…"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '4px 6px',
          background: '#0d1a2e',
          color: '#ddd',
          border: '1px solid #333',
          borderRadius: 4,
          fontSize: 12,
          marginBottom: 4,
        }}
      />
      <div style={{ maxHeight: 200, overflowY: 'auto', borderRadius: 4, background: '#0d1a2e', border: '1px solid #222', marginBottom: 14 }}>
        {filtered.map((stop) => {
          const isFrom = fromStop?.stop_id === stop.stop_id
          const isTo = toStop?.stop_id === stop.stop_id
          return (
            <div
              key={stop.stop_id}
              onClick={() => onStopClick(stop)}
              onMouseEnter={(e) => {
                onStopHover(stop.stop_id)
                if (!isFrom && !isTo) e.currentTarget.style.background = '#1e3050'
              }}
              onMouseLeave={(e) => {
                onStopHover(null)
                if (!isFrom && !isTo) e.currentTarget.style.background = 'transparent'
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 8px',
                cursor: 'pointer',
                fontSize: 12,
                color: isFrom ? '#2ecc71' : isTo ? '#e74c3c' : '#ccc',
                borderBottom: '1px solid #1a2a3e',
                background: isFrom ? '#1a3a1a' : isTo ? '#3a1a1a' : 'transparent',
              }}
            >
              <span style={{ fontSize: 10, flexShrink: 0, width: 14 }}>
                {isFrom ? '🟢' : isTo ? '🔴' : ''}
              </span>
              <span style={{ flex: 1 }}>
                {stop.stop_name}
                <span style={{ color: '#444', marginLeft: 4, fontSize: 10 }}>({stop.stop_id})</span>
              </span>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ padding: '6px 8px', color: '#555', fontSize: 12 }}>Aucun résultat</div>
        )}
      </div>

      {/* Existing segments list */}
      {existingSegmentKeys.size > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
            Segments existants ({existingSegmentKeys.size})
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {[...existingSegmentKeys].sort().map((key) => (
              <div
                key={key}
                onMouseEnter={() => onSegmentHover(key)}
                onMouseLeave={() => onSegmentHover(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 6px',
                  marginBottom: 2,
                  borderRadius: 3,
                  background: '#192840',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: '#ccc',
                  cursor: 'default',
                }}
              >
                <span style={{ flex: 1, wordBreak: 'break-all' }}>{key}</span>
                <button
                  onClick={() => onDelete(key)}
                  style={{ background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer', fontSize: 13, padding: '0 2px', flexShrink: 0 }}
                  title="Supprimer ce segment"
                >✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StopBadge({
  label,
  stop,
  color,
  onClear,
}: {
  label: string
  stop: TripStop | null
  color: string
  onClear: () => void
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 8px',
      borderRadius: 4,
      background: stop ? '#1a2a3e' : '#111',
      border: `1px solid ${stop ? color : '#222'}`,
      minHeight: 28,
    }}>
      <span style={{ fontSize: 11, color, fontWeight: 'bold', flexShrink: 0, width: 32 }}>{label}</span>
      {stop ? (
        <>
          <span style={{ flex: 1, fontSize: 12, color: '#ddd' }}>{stop.stop_name}</span>
          <button
            onClick={onClear}
            style={{ background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}
          >✕</button>
        </>
      ) : (
        <span style={{ flex: 1, fontSize: 11, color: '#444', fontStyle: 'italic' }}>non sélectionné</span>
      )}
    </div>
  )
}
