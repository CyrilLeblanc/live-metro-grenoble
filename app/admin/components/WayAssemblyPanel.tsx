/**
 * WayAssemblyPanel — Step 2 sidebar panel.
 *
 * Shows a header, the list of OSM relations for hover-preview and selection,
 * and (when a relation is active) a drag-to-reorder list of its member ways.
 * Also exposes Reset and Back controls.
 */

import { useState } from 'react'
import type { OsmRelation, OsmWay } from '../types'
import { hexColor } from '../lib/geo'

interface Props {
  /** Display label and accent colour for the current segment being assembled. */
  header: { title: string; color: string }
  osmRelations: OsmRelation[]
  osmWays: OsmWay[]
  activeRelationId: number | null
  activeRelationWayIds: number[]
  hoveredRelationId: number | null
  hoveredWayId: number | null
  onRelationHover: (id: number | null) => void
  onRelationToggle: (id: number | null, wayIds?: number[]) => void
  onWayHover: (id: number | null) => void
  onWayReorder: (fromIdx: number, toIdx: number) => void
  onWayRemove: (idx: number) => void
  /** When provided, shows a "Save line path" button. */
  onSaveLinePath?: () => void
  onReset: () => void
  onBack: () => void
}

export default function WayAssemblyPanel({
  header,
  osmRelations,
  osmWays,
  activeRelationId,
  activeRelationWayIds,
  hoveredRelationId,
  hoveredWayId,
  onRelationHover,
  onRelationToggle,
  onWayHover,
  onWayReorder,
  onWayRemove,
  onSaveLinePath,
  onReset,
  onBack,
}: Props) {
  const [dragWayIdx, setDragWayIdx] = useState<number | null>(null)
  const accentColor = hexColor(header.color)

  return (
    <div>
      {/* Header */}
      <div style={{ fontWeight: 'bold', marginBottom: 6, color: accentColor }}>
        {header.title}
      </div>

      {/* OSM relations — always visible so the operator can switch between them */}
      {osmRelations.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
            Relations OSM
          </div>
          {osmRelations.map((rel) => {
            const isActive = activeRelationId === rel.id
            return (
              <div
                key={rel.id}
                onMouseEnter={() => onRelationHover(rel.id)}
                onMouseLeave={() => onRelationHover(null)}
                onClick={() => isActive ? onRelationToggle(null) : onRelationToggle(rel.id, rel.wayIds)}
                style={{
                  padding: '4px 8px',
                  marginBottom: 2,
                  borderRadius: 4,
                  cursor: 'pointer',
                  background: isActive ? '#1a3a5c' : '#1e2d50',
                  borderLeft: `3px solid ${isActive ? '#4a90d9' : 'transparent'}`,
                  opacity: hoveredRelationId === rel.id ? 1 : 0.85,
                }}
              >
                <div style={{ fontSize: 12, color: isActive ? '#7ec8f7' : '#ddd' }}>{rel.name}</div>
                <div style={{ fontSize: 10, color: '#888' }}>{rel.wayIds.length} voies · id {rel.id}</div>
              </div>
            )
          })}
        </div>
      )}

      {/* Ordered way list — shown when a relation is active */}
      {activeRelationId !== null && activeRelationWayIds.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
            Voies ({activeRelationWayIds.length}) — réordonner / supprimer
          </div>
          {activeRelationWayIds.map((wayId, idx) => {
            const way = osmWays.find((w) => w.id === wayId)
            const isHovered = hoveredWayId === wayId
            const isDragging = dragWayIdx === idx
            return (
              <div
                key={`${wayId}-${idx}`}
                draggable
                onDragStart={() => setDragWayIdx(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragWayIdx === null || dragWayIdx === idx) return
                  onWayReorder(dragWayIdx, idx)
                  setDragWayIdx(null)
                }}
                onDragEnd={() => setDragWayIdx(null)}
                onMouseEnter={() => onWayHover(wayId)}
                onMouseLeave={() => onWayHover(null)}
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
                <span style={{ flex: 1, fontSize: 11, color: '#ccc', fontFamily: 'monospace' }}>
                  {wayId}
                  {way && <span style={{ color: '#666' }}> · {way.coords.length}pts</span>}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onWayRemove(idx) }}
                  style={{ background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1 }}
                  title="Supprimer"
                >✕</button>
              </div>
            )
          })}
        </div>
      )}

      {/* Save line path — only shown when callback is provided */}
      {onSaveLinePath && (
        <button
          onClick={onSaveLinePath}
          style={{ background: '#1a6e3a', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 12, marginBottom: 8, display: 'block' }}
        >
          Sauvegarder tracé de ligne
        </button>
      )}

      {/* Reset / Back */}
      <button onClick={onReset} style={{ background: '#c0392b', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 12 }}>
        Réinitialiser
      </button>
      <button onClick={onBack} style={{ background: '#555', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 12, marginLeft: 6 }}>
        ← Retour
      </button>
    </div>
  )
}
