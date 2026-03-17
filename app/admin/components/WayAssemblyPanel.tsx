/**
 * WayAssemblyPanel — Step 2 sidebar panel.
 *
 * Shows the selected trip header, the list of OSM relations for hover-preview
 * and selection, and (when a relation is active) a drag-to-reorder list of its
 * member ways. Also exposes the "Save line path" and Reset/Back controls.
 *
 * All state changes are propagated upward via callbacks so that AdminMap can
 * keep the Leaflet layer styles in sync.
 */

import { useState } from 'react'
import type { OsmRelation, OsmWay, TripEntry, CutPoint } from '../types'
import type { LatLng } from '../../../lib/geo'
import { hexColor } from '../lib/geo'

interface Props {
  selectedTrip: TripEntry
  osmRelations: OsmRelation[]
  osmWays: OsmWay[]
  activeRelationId: number | null
  activeRelationWayIds: number[]
  hoveredRelationId: number | null
  hoveredWayId: number | null
  assembledPolyline: LatLng[]
  cutPoints: CutPoint[]
  /** Called when the user hovers a relation row (null = leave). */
  onRelationHover: (id: number | null) => void
  /** Called when the user clicks a relation row to toggle it on/off. */
  onRelationToggle: (id: number | null, wayIds?: number[]) => void
  /** Called when the user hovers a way row (null = leave). */
  onWayHover: (id: number | null) => void
  /** Called when the user drags a way from one position to another. */
  onWayReorder: (fromIdx: number, toIdx: number) => void
  /** Called when the user removes a way from the active relation list. */
  onWayRemove: (idx: number) => void
  onSaveLinePath: () => void
  onReset: () => void
  onBack: () => void
}

export default function WayAssemblyPanel({
  selectedTrip,
  osmRelations,
  osmWays,
  activeRelationId,
  activeRelationWayIds,
  hoveredRelationId,
  hoveredWayId,
  assembledPolyline,
  cutPoints,
  onRelationHover,
  onRelationToggle,
  onWayHover,
  onWayReorder,
  onWayRemove,
  onSaveLinePath,
  onReset,
  onBack,
}: Props) {
  // dragWayIdx is purely local UI state — only affects the visual drag indicator
  const [dragWayIdx, setDragWayIdx] = useState<number | null>(null)

  return (
    <div>
      {/* Trip header */}
      <div style={{ fontWeight: 'bold', marginBottom: 6 }}>
        <span style={{ color: hexColor(selectedTrip.route_color) }}>
          Ligne {selectedTrip.route_short_name}
        </span>
        {' → '}{selectedTrip.trip_headsign}
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
                onClick={() =>
                  isActive
                    ? onRelationToggle(null)
                    : onRelationToggle(rel.id, rel.wayIds)
                }
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

      {/* Ordered way list — shown when a relation is active; supports drag-to-reorder */}
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

      {/* Assembly stats */}
      <div style={{ fontSize: 12, color: '#bbb', marginBottom: 6 }}>
        {assembledPolyline.length} points assemblés
      </div>
      {cutPoints.length > 0 && (
        <div style={{ fontSize: 12, color: '#2ecc71', marginBottom: 6 }}>
          ✓ {cutPoints.length} point(s) de coupure conservés
        </div>
      )}

      {/* Save line path — available as soon as something is assembled */}
      {assembledPolyline.length > 0 && (
        <button
          onClick={onSaveLinePath}
          style={{ background: '#1a6e3a', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 12, marginBottom: 8, display: 'block' }}
          title={`Sauvegarde le tracé complet pour Ligne ${selectedTrip.route_short_name} direction ${selectedTrip.direction_id}`}
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
