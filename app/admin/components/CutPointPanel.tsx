/**
 * CutPointPanel — Step 3 sidebar panel.
 *
 * Shows instructions, the pending-cut assignment dialog (stop selector +
 * confirm button), the list of placed cut points, and a Back button.
 *
 * The snapping tool and auto-place button live in the toolbar (AdminMap),
 * not here, because they need to control Leaflet event handlers directly.
 */

import type { TripStop, CutPoint, PendingCut } from '../types'
import { hexColor } from '../lib/geo'

interface Props {
  /** Display label and accent colour for the current segment being cut. */
  header: { title: string; color: string }
  tripStops: TripStop[]
  cutPoints: CutPoint[]
  snappingActive: boolean
  /** The projected point waiting for a stop assignment; null when no click yet. */
  pendingCut: PendingCut | null
  pendingStopId: string
  onPendingStopChange: (stopId: string) => void
  onCommitCut: () => void
  onRemoveCut: (idx: number) => void
  onBack: () => void
}

export default function CutPointPanel({
  header,
  tripStops,
  cutPoints,
  snappingActive,
  pendingCut,
  pendingStopId,
  onPendingStopChange,
  onCommitCut,
  onRemoveCut,
  onBack,
}: Props) {
  return (
    <div>
      {/* Header */}
      <div style={{ fontWeight: 'bold', marginBottom: 6, color: hexColor(header.color) }}>
        Découpage — {header.title}
      </div>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
        Cliquez sur{' '}
        <strong style={{ color: '#5dade2' }}>⟳ Auto-placer</strong> pour projeter
        automatiquement chaque arrêt sur le tracé, ou utilisez l&apos;outil coupure
        manuelle pour affiner.
      </div>

      {/* Pending cut assignment — shown after a map click while snapping is active */}
      {snappingActive && pendingCut && (
        <div style={{ background: '#1e3a5f', padding: 8, borderRadius: 4, marginBottom: 8 }}>
          <div style={{ fontSize: 12, marginBottom: 4 }}>Associer ce point à :</div>
          <select
            value={pendingStopId}
            onChange={(e) => onPendingStopChange(e.target.value)}
            style={{ width: '100%', background: '#0d1b2a', color: '#eee', border: '1px solid #444', padding: 3, borderRadius: 3, fontSize: 12 }}
          >
            <option value="">— choisir un arrêt —</option>
            {tripStops.map((s) => (
              <option key={s.stop_id} value={s.stop_id}>{s.stop_name}</option>
            ))}
          </select>
          <button
            onClick={onCommitCut}
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
          <div
            key={i}
            style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #2a2a4a', fontSize: 12 }}
          >
            <span>{stop?.stop_name ?? cp.stopId}</span>
            <button
              onClick={() => onRemoveCut(i)}
              style={{ background: 'none', color: '#e74c3c', border: 'none', cursor: 'pointer', fontSize: 12 }}
            >
              ✕
            </button>
          </div>
        )
      })}

      <button
        onClick={onBack}
        style={{ marginTop: 10, background: '#555', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 12 }}
      >
        ← Retour étape 2
      </button>
    </div>
  )
}
