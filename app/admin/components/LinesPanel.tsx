/**
 * LinesPanel — Full side panel for Lines mode.
 *
 * Step 1: List of 10 line directions (A|0…E|1).
 *         Shows a ✓ badge for directions already saved in line-paths.json.
 *         Clicking a row enters Step 2 for that direction.
 *
 * Step 2: Instruction banner + drag-to-reorder list of segment keys in the
 *         current sequence. Click segments on the map to add them.
 *         "← Retour" goes back to Step 1. "Sauvegarder" calls onSave.
 */

import { useState, useMemo } from 'react'
import type { TripEntry } from '../types'
import { hexColor } from '../lib/geo'

interface Props {
  tripEntries: TripEntry[]
  existingLinePaths: Record<string, string[]>
  selectedLineKey: string | null
  segmentSequence: string[]
  highlightedSegmentKey: string | null
  onLineHover: (key: string | null) => void
  onSelectLine: (key: string) => void
  onBack: () => void
  onSegmentReorder: (fromIdx: number, toIdx: number) => void
  onSegmentRemove: (idx: number) => void
  onSegmentHighlight: (key: string | null) => void
  onSave: () => void
}

// Deduplicate tripEntries to one representative per (route_short_name, direction_id).
function deduplicateLineDirections(tripEntries: TripEntry[]): TripEntry[] {
  const seen = new Map<string, TripEntry>()
  for (const e of tripEntries) {
    const k = `${e.route_short_name}|${e.direction_id}`
    if (!seen.has(k)) seen.set(k, e)
  }
  return [...seen.values()].sort((a, b) => {
    if (a.route_short_name !== b.route_short_name) return a.route_short_name.localeCompare(b.route_short_name)
    return a.direction_id - b.direction_id
  })
}

export default function LinesPanel({
  tripEntries,
  existingLinePaths,
  selectedLineKey,
  segmentSequence,
  highlightedSegmentKey,
  onLineHover,
  onSelectLine,
  onBack,
  onSegmentReorder,
  onSegmentRemove,
  onSegmentHighlight,
  onSave,
}: Props) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const lineDirections = useMemo(() => deduplicateLineDirections(tripEntries), [tripEntries])

  // ── Step 1: direction picker ─────────────────────────────────────────────────
  if (selectedLineKey === null) {
    return (
      <div>
        <div style={{ fontWeight: 'bold', marginBottom: 10, color: '#eee' }}>Lignes</div>
        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 10 }}>
          Choisir une direction pour composer son tracé à partir des segments.
        </div>
        {lineDirections.map((e) => {
          const key = `${e.route_short_name}|${e.direction_id}`
          const saved = key in existingLinePaths
          return (
            <div
              key={key}
              onClick={() => onSelectLine(key)}
              onMouseEnter={(el) => { el.currentTarget.style.background = '#243560'; onLineHover(key) }}
              onMouseLeave={(el) => { el.currentTarget.style.background = '#1e2d50'; onLineHover(null) }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                marginBottom: 3,
                borderRadius: 4,
                cursor: 'pointer',
                background: '#1e2d50',
                borderLeft: `3px solid #${e.route_color}`,
              }}
            >
              <span style={{ color: hexColor(e.route_color), fontWeight: 'bold', fontSize: 13 }}>
                {e.route_short_name}
              </span>
              <span style={{ flex: 1, fontSize: 12, color: '#ccc' }}>
                dir. {e.direction_id}{e.trip_headsign ? ` — ${e.trip_headsign}` : ''}
              </span>
              {saved && (
                <span style={{ color: '#2ecc71', fontSize: 13 }} title="Tracé sauvegardé">✓</span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // ── Step 2: segment sequence editor ─────────────────────────────────────────
  return (
    <div>
      <div style={{ fontWeight: 'bold', marginBottom: 6, color: '#eee' }}>
        Ligne {selectedLineKey}
      </div>
      <div style={{ fontSize: 12, color: '#aaa', background: '#0d1a2e', padding: '6px 8px', borderRadius: 4, marginBottom: 10, lineHeight: 1.5 }}>
        Cliquer les segments sur la carte dans l'ordre du trajet.
      </div>

      {segmentSequence.length === 0 && (
        <div style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>Aucun segment sélectionné.</div>
      )}

      {segmentSequence.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
            Séquence ({segmentSequence.length} segments)
          </div>
          {segmentSequence.map((sk, idx) => {
            const isHovered = highlightedSegmentKey === sk
            const isDragging = dragIdx === idx
            return (
              <div
                key={`${sk}-${idx}`}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIdx === null || dragIdx === idx) return
                  onSegmentReorder(dragIdx, idx)
                  setDragIdx(null)
                }}
                onDragEnd={() => setDragIdx(null)}
                onMouseEnter={() => onSegmentHighlight(sk)}
                onMouseLeave={() => onSegmentHighlight(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 6px',
                  marginBottom: 2,
                  borderRadius: 3,
                  cursor: 'grab',
                  background: isHovered ? '#1e3a5c' : isDragging ? '#2a3a50' : '#192840',
                  border: `1px solid ${isHovered ? '#4a90d9' : 'transparent'}`,
                  opacity: isDragging ? 0.5 : 1,
                  userSelect: 'none',
                }}
              >
                <span style={{ color: '#555', fontSize: 13, lineHeight: 1, flexShrink: 0 }}>≡</span>
                <span style={{ flex: 1, fontSize: 11, color: '#ccc', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {idx + 1}. {sk}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onSegmentRemove(idx) }}
                  style={{ background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                  title="Supprimer"
                >✕</button>
              </div>
            )
          })}
        </div>
      )}

      <button
        onClick={onSave}
        disabled={segmentSequence.length === 0}
        style={{
          background: segmentSequence.length > 0 ? '#27ae60' : '#333',
          color: segmentSequence.length > 0 ? '#fff' : '#666',
          border: 'none',
          padding: '5px 12px',
          borderRadius: 4,
          cursor: segmentSequence.length > 0 ? 'pointer' : 'not-allowed',
          fontSize: 12,
          width: '100%',
          marginBottom: 6,
        }}
      >
        Sauvegarder ({segmentSequence.length} segments)
      </button>

      <button
        onClick={onBack}
        style={{ background: '#555', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
      >
        ← Retour
      </button>
    </div>
  )
}
